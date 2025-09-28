const User = require('../models/User');
const Cart = require('../models/Cart');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Review = require('../models/Review');
const Notification = require('../models/Notification');
const Store = require('../models/Store');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { validationResult } = require('express-validator');
const speakeasy = require('speakeasy');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

// Email transporter configuration
const emailTransporter = nodemailer.createTransporter({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// SMS client configuration
const smsClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

class UserController {
  // ===============================
  // AUTHENTICATION & REGISTRATION
  // ===============================

  // Register new user
  register = catchAsync(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const {
      firstName,
      lastName,
      email,
      password,
      phone,
      dateOfBirth,
      gender,
      role = 'customer',
      referralCode
    } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        { email: email.toLowerCase() },
        { phone }
      ]
    });

    if (existingUser) {
      if (existingUser.email === email.toLowerCase()) {
        throw new AppError('Email already registered', 400, true, 'EMAIL_EXISTS');
      }
      if (existingUser.phone === phone) {
        throw new AppError('Phone number already registered', 400, true, 'PHONE_EXISTS');
      }
    }

    // Handle referral
    let referredBy = null;
    if (referralCode) {
      const referrer = await User.findOne({ referralCode });
      if (referrer) {
        referredBy = referrer._id;
      }
    }

    // Create new user
    const user = new User({
      firstName,
      lastName,
      email: email.toLowerCase(),
      password,
      phone,
      dateOfBirth,
      gender,
      role,
      referredBy,
      preferences: {
        notifications: {
          email: {
            orderUpdates: true,
            promotions: role === 'customer',
            securityAlerts: true,
            newsletter: false
          },
          sms: {
            orderUpdates: true,
            promotions: false,
            securityAlerts: true
          },
          push: {
            orderUpdates: true,
            promotions: false
          }
        }
      }
    });

    await user.save();

    // Create welcome notification
    await Notification.createNotification(user._id, {
      type: 'account',
      category: 'informational',
      title: 'Welcome to our platform!',
      message: `Welcome ${user.firstName}! Your account has been created successfully.`,
      priority: 'normal',
      actions: [
        {
          type: 'link',
          label: 'Complete Profile',
          url: '/profile',
          action: 'complete_profile'
        }
      ]
    });

    // Handle referral rewards
    if (referredBy) {
      await this.processReferralReward(referrer._id, user._id);
    }

    // Generate tokens
    const token = user.generateAuthToken();
    const refreshToken = user.generateRefreshToken();

    // Set refresh token in HTTP-only cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    // Log registration
    logger.info('User registered', {
      userId: user._id,
      email: user.email,
      role: user.role,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: user.getPublicProfile(),
        token,
        refreshToken
      }
    });
  });

  // Login user
  login = catchAsync(async (req, res) => {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      throw new AppError('Email and password are required', 400, true, 'MISSING_CREDENTIALS');
    }

    // Find user and include password
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

    if (!user) {
      throw new AppError('Invalid email or password', 401, true, 'INVALID_CREDENTIALS');
    }

    // Check if account is locked
    if (user.isLocked()) {
      throw new AppError('Account temporarily locked due to too many failed attempts', 423, true, 'ACCOUNT_LOCKED');
    }

    // Check password
    const isPasswordCorrect = await user.comparePassword(password);

    if (!isPasswordCorrect) {
      await user.incrementLoginAttempts();
      throw new AppError('Invalid email or password', 401, true, 'INVALID_CREDENTIALS');
    }

    // Reset login attempts on successful login
    await user.resetLoginAttempts();

    // Add login history
    await user.addLoginHistory(
      req.ip,
      req.get('User-Agent'),
      'Unknown', // Location would be determined here
      true
    );

    // Update last login
    user.lastLogin = new Date();
    user.lastLoginIP = req.ip;
    await user.save();

    // Generate tokens
    const token = user.generateAuthToken();
    const refreshToken = user.generateRefreshToken();

    // Set refresh token in HTTP-only cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    // Send welcome back notification if user hasn't logged in recently
    const daysSinceLastLogin = user.lastLogin ?
      Math.floor((Date.now() - user.lastLogin) / (1000 * 60 * 60 * 24)) : 999;

    if (daysSinceLastLogin > 7) {
      await Notification.createNotification(user._id, {
        type: 'account',
        category: 'informational',
        title: 'Welcome back!',
        message: `Welcome back ${user.firstName}! It's been ${daysSinceLastLogin} days since your last visit.`,
        priority: 'low'
      });
    }

    logger.info('User logged in', {
      userId: user._id,
      email: user.email,
      role: user.role,
      ip: req.ip
    });

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: user.getPublicProfile(),
        token,
        refreshToken
      }
    });
  });

  // Logout user
  logout = catchAsync(async (req, res) => {
    // Clear refresh token cookie
    res.clearCookie('refreshToken');

    // Add logout history
    await req.user.addLoginHistory(
      req.ip,
      req.get('User-Agent'),
      'Unknown',
      true
    );

    logger.info('User logged out', {
      userId: req.user._id,
      email: req.user.email
    });

    res.status(200).json({
      success: true,
      message: 'Logout successful'
    });
  });

  // Refresh access token
  refreshToken = catchAsync(async (req, res) => {
    const { refreshToken } = req.cookies;

    if (!refreshToken) {
      throw new AppError('Refresh token not provided', 401, true, 'NO_REFRESH_TOKEN');
    }

    try {
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

      // Find user
      const user = await User.findById(decoded.id);

      if (!user) {
        throw new AppError('User not found', 401, true, 'USER_NOT_FOUND');
      }

      // Generate new tokens
      const newToken = user.generateAuthToken();
      const newRefreshToken = user.generateRefreshToken();

      // Set new refresh token
      res.cookie('refreshToken', newRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      res.status(200).json({
        success: true,
        message: 'Token refreshed successfully',
        data: {
          token: newToken,
          refreshToken: newRefreshToken
        }
      });
    } catch (error) {
      throw new AppError('Invalid refresh token', 401, true, 'INVALID_REFRESH_TOKEN');
    }
  });

  // Forgot password
  forgotPassword = catchAsync(async (req, res) => {
    const { email } = req.body;

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      // Don't reveal that user doesn't exist
      return res.status(200).json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent'
      });
    }

    // Generate reset token
    const resetToken = user.createPasswordResetToken();
    await user.save();

    // Send reset email
    const resetUrl = `${process.env.CLIENT_URL}/reset-password/${resetToken}`;

    try {
      await emailTransporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: user.email,
        subject: 'Password Reset Request',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Password Reset Request</h2>
            <p>Hello ${user.firstName},</p>
            <p>You have requested to reset your password. Click the link below to reset it:</p>
            <p><a href="${resetUrl}" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Password</a></p>
            <p>If you didn't request this, please ignore this email.</p>
            <p>This link will expire in 10 minutes.</p>
            <p>Best regards,<br>The Team</p>
          </div>
        `
      });

      logger.info('Password reset email sent', { userId: user._id, email: user.email });

      res.status(200).json({
        success: true,
        message: 'Password reset link sent to your email'
      });
    } catch (error) {
      // Reset token if email fails
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save();

      logger.error('Failed to send password reset email', { userId: user._id, error: error.message });

      throw new AppError('Failed to send reset email', 500, false, 'EMAIL_SEND_FAILED');
    }
  });

  // Reset password
  resetPassword = catchAsync(async (req, res) => {
    const { token, password } = req.body;

    // Hash token to compare
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() }
    });

    if (!user) {
      throw new AppError('Invalid or expired reset token', 400, true, 'INVALID_RESET_TOKEN');
    }

    // Set new password
    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.passwordResetAttempts = 0;
    await user.save();

    // Send confirmation email
    await emailTransporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: 'Password Reset Successful',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Password Reset Successful</h2>
          <p>Hello ${user.firstName},</p>
          <p>Your password has been successfully reset. You can now log in with your new password.</p>
          <p>If you didn't make this change, please contact support immediately.</p>
          <p>Best regards,<br>The Team</p>
        </div>
      `
    });

    logger.info('Password reset successful', { userId: user._id });

    res.status(200).json({
      success: true,
      message: 'Password reset successful'
    });
  });

  // Change password
  changePassword = catchAsync(async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user.id).select('+password');

    // Check current password
    const isCurrentPasswordCorrect = await user.comparePassword(currentPassword);

    if (!isCurrentPasswordCorrect) {
      throw new AppError('Current password is incorrect', 400, true, 'INVALID_CURRENT_PASSWORD');
    }

    // Update password
    user.password = newPassword;
    await user.save();

    // Send confirmation email
    await emailTransporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: 'Password Changed',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Password Changed</h2>
          <p>Hello ${user.firstName},</p>
          <p>Your password has been successfully changed.</p>
          <p>If you didn't make this change, please contact support immediately.</p>
          <p>Best regards,<br>The Team</p>
        </div>
      `
    });

    logger.info('Password changed', { userId: user._id });

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });
  });

  // ===============================
  // TWO-FACTOR AUTHENTICATION
  // ===============================

  // Enable 2FA
  enableTwoFactor = catchAsync(async (req, res) => {
    const user = await User.findById(req.user.id);

    if (user.twoFactorEnabled) {
      throw new AppError('2FA is already enabled', 400, true, 'TWO_FA_ALREADY_ENABLED');
    }

    // Generate 2FA secret
    const secret = user.generateTwoFactorSecret();

    // Generate QR code URL
    const serviceName = process.env.APP_NAME || 'E-commerce';
    const qrCodeUrl = `otpauth://totp/${serviceName}:${user.email}?secret=${secret.base32}&issuer=${serviceName}`;

    await user.save();

    res.status(200).json({
      success: true,
      message: '2FA setup initiated',
      data: {
        secret: secret.base32,
        qrCodeUrl,
        manualEntryKey: secret.base32
      }
    });
  });

  // Verify and enable 2FA
  verifyTwoFactor = catchAsync(async (req, res) => {
    const { token } = req.body;

    const user = await User.findById(req.user.id).select('+twoFactorSecret');

    if (!user.twoFactorSecret) {
      throw new AppError('2FA setup not initiated', 400, true, 'TWO_FA_NOT_INITIATED');
    }

    // Verify token
    const isValid = user.verifyTwoFactorToken(token);

    if (!isValid) {
      throw new AppError('Invalid verification code', 400, true, 'INVALID_TWO_FA_TOKEN');
    }

    // Enable 2FA
    user.twoFactorEnabled = true;
    await user.save();

    // Generate backup codes
    const backupCodes = user.generateBackupCodes();

    // Send confirmation email
    await emailTransporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: 'Two-Factor Authentication Enabled',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Two-Factor Authentication Enabled</h2>
          <p>Hello ${user.firstName},</p>
          <p>Two-factor authentication has been successfully enabled for your account.</p>
          <p><strong>Important:</strong> Please save your backup codes in a safe place:</p>
          <ul>
            ${backupCodes.map(code => `<li><code>${code}</code></li>`).join('')}
          </ul>
          <p>You can use these codes to access your account if you lose your device.</p>
          <p>Best regards,<br>The Team</p>
        </div>
      `
    });

    logger.info('2FA enabled', { userId: user._id });

    res.status(200).json({
      success: true,
      message: '2FA enabled successfully',
      data: {
        backupCodes
      }
    });
  });

  // Disable 2FA
  disableTwoFactor = catchAsync(async (req, res) => {
    const { password, token } = req.body;

    const user = await User.findById(req.user.id).select('+password +twoFactorSecret');

    // Verify password
    const isPasswordCorrect = await user.comparePassword(password);
    if (!isPasswordCorrect) {
      throw new AppError('Password is incorrect', 400, true, 'INVALID_PASSWORD');
    }

    // Verify 2FA token if enabled
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      const isTokenValid = user.verifyTwoFactorToken(token);
      if (!isTokenValid) {
        throw new AppError('Invalid 2FA token', 400, true, 'INVALID_TWO_FA_TOKEN');
      }
    }

    // Disable 2FA
    user.twoFactorEnabled = false;
    user.twoFactorSecret = undefined;
    user.twoFactorBackupCodes = [];
    await user.save();

    // Send confirmation email
    await emailTransporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: 'Two-Factor Authentication Disabled',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Two-Factor Authentication Disabled</h2>
          <p>Hello ${user.firstName},</p>
          <p>Two-factor authentication has been disabled for your account.</p>
          <p>If you didn't make this change, please contact support immediately.</p>
          <p>Best regards,<br>The Team</p>
        </div>
      `
    });

    logger.info('2FA disabled', { userId: user._id });

    res.status(200).json({
      success: true,
      message: '2FA disabled successfully'
    });
  });

  // ===============================
  // USER PROFILE MANAGEMENT
  // ===============================

  // Get user profile
  getProfile = catchAsync(async (req, res) => {
    const user = await User.findById(req.user.id)
      .populate('referredBy', 'firstName lastName')
      .populate('referrals.user', 'firstName lastName email');

    if (!user) {
      throw new AppError('User not found', 404, true, 'USER_NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      data: {
        profile: user.getPublicProfile(),
        stats: {
          totalOrders: user.totalOrders,
          totalSpent: user.totalSpent,
          loyaltyPoints: user.customerProfile?.loyaltyPoints || 0,
          membershipTier: user.customerProfile?.membershipTier || 'bronze',
          accountAge: user.accountAge,
          activityScore: user.activityScore
        },
        preferences: user.preferences,
        security: {
          twoFactorEnabled: user.twoFactorEnabled,
          emailVerified: user.isEmailVerified,
          phoneVerified: user.isPhoneVerified,
          lastLogin: user.lastLogin,
          loginAttempts: user.loginAttempts
        }
      }
    });
  });

  // Update user profile
  updateProfile = catchAsync(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const allowedFields = [
      'firstName', 'lastName', 'phone', 'dateOfBirth', 'gender',
      'bio', 'website', 'socialLinks', 'timezone', 'language', 'currency'
    ];

    const updates = {};
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    // Handle address update
    if (req.body.address) {
      updates.address = req.body.address;
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { ...updates, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!user) {
      throw new AppError('User not found', 404, true, 'USER_NOT_FOUND');
    }

    // Recalculate activity score
    await user.calculateActivityScore();

    logger.info('User profile updated', { userId: user._id });

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: user.getPublicProfile()
    });
  });

  // Update user avatar
  updateAvatar = catchAsync(async (req, res) => {
    if (!req.file) {
      throw new AppError('No image file provided', 400, true, 'NO_IMAGE_FILE');
    }

    const user = await User.findById(req.user.id);

    // Delete old avatar from Cloudinary if exists
    if (user.avatar && user.avatar.public_id) {
      await cloudinary.uploader.destroy(user.avatar.public_id);
    }

    // Upload new avatar
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'avatars',
      width: 300,
      height: 300,
      crop: 'fill',
      quality: 'auto'
    });

    user.avatar = {
      public_id: result.public_id,
      url: result.secure_url,
      thumbnail: result.secure_url.replace('/upload/', '/upload/w_150,h_150,c_fill/')
    };

    await user.save();

    // Recalculate activity score
    await user.calculateActivityScore();

    logger.info('User avatar updated', { userId: user._id });

    res.status(200).json({
      success: true,
      message: 'Avatar updated successfully',
      data: {
        avatar: user.avatar
      }
    });
  });

  // Delete user account
  deleteAccount = catchAsync(async (req, res) => {
    const { password, reason } = req.body;

    const user = await User.findById(req.user.id).select('+password');

    // Verify password
    const isPasswordCorrect = await user.comparePassword(password);
    if (!isPasswordCorrect) {
      throw new AppError('Password is incorrect', 400, true, 'INVALID_PASSWORD');
    }

    // Soft delete user
    user.isDeleted = true;
    user.deletedAt = new Date();
    user.deletedBy = user._id;
    await user.save();

    // Cancel active subscriptions
    await this.cancelUserSubscriptions(user._id);

    // Anonymize user data
    await this.anonymizeUserData(user._id);

    // Send confirmation email
    await emailTransporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: 'Account Deletion Confirmed',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Account Deletion Confirmed</h2>
          <p>Hello ${user.firstName},</p>
          <p>Your account has been successfully deleted.</p>
          <p>Reason: ${reason || 'Not provided'}</p>
          <p>If you change your mind, you can contact support within 30 days to restore your account.</p>
          <p>Best regards,<br>The Team</p>
        </div>
      `
    });

    logger.info('User account deleted', { userId: user._id, reason });

    res.status(200).json({
      success: true,
      message: 'Account deleted successfully'
    });
  });

  // ===============================
  // EMAIL & PHONE VERIFICATION
  // ===============================

  // Send email verification
  sendEmailVerification = catchAsync(async (req, res) => {
    const user = await User.findById(req.user.id);

    if (user.isEmailVerified) {
      throw new AppError('Email already verified', 400, true, 'EMAIL_ALREADY_VERIFIED');
    }

    // Generate verification token
    const verificationToken = user.createEmailVerificationToken();
    await user.save();

    // Send verification email
    const verificationUrl = `${process.env.CLIENT_URL}/verify-email/${verificationToken}`;

    await emailTransporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: 'Verify Your Email Address',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Verify Your Email Address</h2>
          <p>Hello ${user.firstName},</p>
          <p>Please click the link below to verify your email address:</p>
          <p><a href="${verificationUrl}" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Verify Email</a></p>
          <p>If you didn't create an account, please ignore this email.</p>
          <p>This link will expire in 24 hours.</p>
          <p>Best regards,<br>The Team</p>
        </div>
      `
    });

    logger.info('Email verification sent', { userId: user._id });

    res.status(200).json({
      success: true,
      message: 'Verification email sent'
    });
  });

  // Verify email
  verifyEmail = catchAsync(async (req, res) => {
    const { token } = req.params;

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      throw new AppError('Invalid or expired verification token', 400, true, 'INVALID_VERIFICATION_TOKEN');
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    // Add loyalty points for email verification
    await user.addLoyaltyPoints(50, 'Email verification');

    // Send welcome email
    await emailTransporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: 'Welcome! Email Verified',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Welcome! Email Verified</h2>
          <p>Hello ${user.firstName},</p>
          <p>Your email has been successfully verified. Thank you for joining us!</p>
          <p>You've earned 50 loyalty points for verifying your email.</p>
          <p>Best regards,<br>The Team</p>
        </div>
      `
    });

    logger.info('Email verified', { userId: user._id });

    res.status(200).json({
      success: true,
      message: 'Email verified successfully'
    });
  });

  // Send phone verification
  sendPhoneVerification = catchAsync(async (req, res) => {
    const user = await User.findById(req.user.id);

    if (!user.phone) {
      throw new AppError('Phone number not provided', 400, true, 'NO_PHONE_NUMBER');
    }

    if (user.isPhoneVerified) {
      throw new AppError('Phone already verified', 400, true, 'PHONE_ALREADY_VERIFIED');
    }

    // Generate verification token
    const verificationToken = user.createPhoneVerificationToken();
    await user.save();

    // Send SMS
    try {
      await smsClient.messages.create({
        body: `Your verification code is: ${verificationToken}`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: user.phone
      });

      logger.info('Phone verification SMS sent', { userId: user._id });

      res.status(200).json({
        success: true,
        message: 'Verification code sent to your phone'
      });
    } catch (error) {
      // Reset token if SMS fails
      user.phoneVerificationToken = undefined;
      user.phoneVerificationExpires = undefined;
      await user.save();

      logger.error('Failed to send phone verification SMS', { userId: user._id, error: error.message });

      throw new AppError('Failed to send verification SMS', 500, false, 'SMS_SEND_FAILED');
    }
  });

  // Verify phone
  verifyPhone = catchAsync(async (req, res) => {
    const { token } = req.body;

    const user = await User.findById(req.user.id);

    if (!user.phoneVerificationToken) {
      throw new AppError('Phone verification not initiated', 400, true, 'PHONE_VERIFICATION_NOT_INITIATED');
    }

    // Hash token to compare
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    if (user.phoneVerificationToken !== hashedToken) {
      throw new AppError('Invalid verification code', 400, true, 'INVALID_VERIFICATION_CODE');
    }

    if (user.phoneVerificationExpires < Date.now()) {
      throw new AppError('Verification code expired', 400, true, 'EXPIRED_VERIFICATION_CODE');
    }

    user.isPhoneVerified = true;
    user.phoneVerificationToken = undefined;
    user.phoneVerificationExpires = undefined;
    await user.save();

    // Add loyalty points for phone verification
    await user.addLoyaltyPoints(25, 'Phone verification');

    logger.info('Phone verified', { userId: user._id });

    res.status(200).json({
      success: true,
      message: 'Phone verified successfully'
    });
  });

  // ===============================
  // USER PREFERENCES
  // ===============================

  // Get user preferences
  getPreferences = catchAsync(async (req, res) => {
    const user = await User.findById(req.user.id);

    res.status(200).json({
      success: true,
      data: user.preferences
    });
  });

  // Update notification preferences
  updateNotificationPreferences = catchAsync(async (req, res) => {
    const { notifications } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        'preferences.notifications': notifications,
        updatedAt: new Date()
      },
      { new: true }
    );

    // Update all existing notifications with new preferences
    await Notification.updateMany(
      { user: req.user.id },
      { preferences: user.preferences }
    );

    logger.info('Notification preferences updated', { userId: user._id });

    res.status(200).json({
      success: true,
      message: 'Notification preferences updated',
      data: user.preferences.notifications
    });
  });

  // Update privacy preferences
  updatePrivacyPreferences = catchAsync(async (req, res) => {
    const { privacy } = req.body;

    await User.findByIdAndUpdate(
      req.user.id,
      {
        'preferences.privacy': privacy,
        updatedAt: new Date()
      }
    );

    logger.info('Privacy preferences updated', { userId: req.user.id });

    res.status(200).json({
      success: true,
      message: 'Privacy preferences updated'
    });
  });

  // Update shopping preferences
  updateShoppingPreferences = catchAsync(async (req, res) => {
    const { shopping } = req.body;

    await User.findByIdAndUpdate(
      req.user.id,
      {
        'preferences.shopping': shopping,
        updatedAt: new Date()
      }
    );

    logger.info('Shopping preferences updated', { userId: req.user.id });

    res.status(200).json({
      success: true,
      message: 'Shopping preferences updated'
    });
  });

  // ===============================
  // VENDOR MANAGEMENT
  // ===============================

  // Become a vendor
  becomeVendor = catchAsync(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const user = await User.findById(req.user.id);

    if (user.role === 'vendor') {
      throw new AppError('User is already a vendor', 400, true, 'ALREADY_VENDOR');
    }

    const {
      storeName,
      storeDescription,
      businessType,
      businessRegistration,
      taxId,
      bankAccount
    } = req.body;

    // Update user role
    user.role = 'vendor';

    // Initialize vendor profile
    user.vendorProfile = {
      storeName,
      storeDescription,
      businessType,
      businessRegistration,
      taxId,
      isVerified: false,
      bankAccount,
      payoutSettings: {
        method: 'bank_transfer',
        frequency: 'weekly',
        minimumAmount: 10
      },
      performance: {
        rating: 0,
        totalSales: 0,
        totalOrders: 0,
        joinedAt: new Date()
      }
    };

    await user.save();

    // Create default store
    const store = new Store({
      name: storeName,
      description: storeDescription,
      owner: user._id,
      businessInfo: {
        businessType,
        businessRegistration,
        taxId
      },
      financial: {
        bankAccount,
        payoutSettings: {
          method: 'bank_transfer',
          frequency: 'weekly',
          minimumAmount: 10
        }
      },
      status: 'pending',
      verificationStatus: 'unverified'
    });

    await store.save();

    // Update user with store reference
    user.vendorProfile.store = store._id;
    await user.save();

    // Send welcome vendor email
    await emailTransporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: 'Welcome to Vendor Program!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Welcome to Our Vendor Program!</h2>
          <p>Hello ${user.firstName},</p>
          <p>Congratulations! You have successfully joined our vendor program.</p>
          <p>Your store "${storeName}" is currently under review. We'll notify you once it's approved.</p>
          <p>In the meantime, you can start adding products and setting up your store.</p>
          <p>Best regards,<br>The Team</p>
        </div>
      `
    });

    logger.info('User became vendor', { userId: user._id, storeId: store._id });

    res.status(200).json({
      success: true,
      message: 'Successfully joined vendor program',
      data: {
        user: user.getPublicProfile(),
        store: store
      }
    });
  });

  // Get vendor dashboard
  getVendorDashboard = catchAsync(async (req, res) => {
    const user = await User.findById(req.user.id);
    const store = await Store.findById(user.vendorProfile.store);

    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Get recent orders
    const recentOrders = await Order.findByVendor(user._id, { limit: 10 });

    // Get pending orders
    const pendingOrders = await Order.findByVendor(user._id, {
      status: 'pending',
      limit: 5
    });

    // Get store products
    const products = await store.getProducts({ limit: 10 });

    // Get analytics data
    const analytics = await store.getDashboardData(30);

    res.status(200).json({
      success: true,
      data: {
        store: {
          ...store.toObject(),
          isActive: store.isActive
        },
        stats: {
          totalProducts: store.analytics.totalProducts,
          totalOrders: store.analytics.totalOrders,
          totalSales: store.analytics.totalSales,
          averageOrderValue: store.analytics.averageOrderValue,
          rating: store.analytics.rating,
          customerCount: store.analytics.customerCount
        },
        recentOrders,
        pendingOrders,
        products,
        analytics,
        notifications: await this.getVendorNotifications(user._id)
      }
    });
  });

  // Update vendor profile
  updateVendorProfile = catchAsync(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const allowedFields = [
      'storeName', 'storeDescription', 'businessType',
      'businessRegistration', 'taxId'
    ];

    const updates = {};
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[`vendorProfile.${field}`] = req.body[field];
      }
    });

    // Handle bank account update
    if (req.body.bankAccount) {
      updates['vendorProfile.bankAccount'] = req.body.bankAccount;
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { ...updates, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    // Update store information
    if (user.vendorProfile.store) {
      await Store.findByIdAndUpdate(user.vendorProfile.store, {
        name: user.vendorProfile.storeName,
        description: user.vendorProfile.storeDescription,
        businessInfo: {
          businessType: user.vendorProfile.businessType,
          businessRegistration: user.vendorProfile.businessRegistration,
          taxId: user.vendorProfile.taxId
        },
        financial: {
          bankAccount: user.vendorProfile.bankAccount
        }
      });
    }

    logger.info('Vendor profile updated', { userId: user._id });

    res.status(200).json({
      success: true,
      message: 'Vendor profile updated successfully',
      data: user.vendorProfile
    });
  });

  // ===============================
  // ADMIN FUNCTIONS
  // ===============================

  // Get all users (admin only)
  getAllUsers = catchAsync(async (req, res) => {
    const {
      role,
      status,
      verified,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      limit = 20
    } = req.query;

    let query = {};

    // Role filter
    if (role) query.role = role;

    // Status filter
    if (status === 'active') query.isActive = true;
    if (status === 'inactive') query.isActive = false;
    if (status === 'verified') query.isVerified = true;
    if (status === 'unverified') query.isVerified = false;

    // Verification filter
    if (verified === 'email') query.isEmailVerified = true;
    if (verified === 'phone') query.isPhoneVerified = true;

    // Search filter
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    // Sorting
    let sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const users = await User.find(query)
      .select('-password -twoFactorSecret -twoFactorBackupCodes')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('referrals.user', 'firstName lastName');

    const total = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalUsers: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Get user by ID (admin only)
  getUserById = catchAsync(async (req, res) => {
    const { id } = req.params;

    const user = await User.findById(id)
      .select('-password -twoFactorSecret -twoFactorBackupCodes')
      .populate('referrals.user', 'firstName lastName')
      .populate('referredBy', 'firstName lastName');

    if (!user) {
      throw new AppError('User not found', 404, true, 'USER_NOT_FOUND');
    }

    // Get user's recent activity
    const recentActivity = await this.getUserActivity(id);

    res.status(200).json({
      success: true,
      data: {
        user,
        recentActivity,
        stats: {
          totalOrders: user.totalOrders,
          totalSpent: user.totalSpent,
          loyaltyPoints: user.customerProfile?.loyaltyPoints || 0,
          accountAge: user.accountAge,
          lastLogin: user.lastLogin,
          loginHistory: user.loginHistory.slice(0, 10)
        }
      }
    });
  });

  // Update user (admin only)
  updateUser = catchAsync(async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    // Prevent updating sensitive fields
    const forbiddenFields = ['password', 'twoFactorSecret', 'twoFactorBackupCodes', '_id'];
    forbiddenFields.forEach(field => {
      delete updates[field];
    });

    const user = await User.findByIdAndUpdate(
      id,
      { ...updates, updatedAt: new Date(), updatedBy: req.user.id },
      { new: true, runValidators: true }
    );

    if (!user) {
      throw new AppError('User not found', 404, true, 'USER_NOT_FOUND');
    }

    logger.info('User updated by admin', {
      updatedBy: req.user.id,
      userId: id,
      updates: Object.keys(updates)
    });

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: user
    });
  });

  // Delete user (admin only)
  deleteUser = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;

    const user = await User.findById(id);

    if (!user) {
      throw new AppError('User not found', 404, true, 'USER_NOT_FOUND');
    }

    // Soft delete
    user.isDeleted = true;
    user.deletedAt = new Date();
    user.deletedBy = req.user.id;
    await user.save();

    // Cancel subscriptions
    await this.cancelUserSubscriptions(id);

    // Anonymize data
    await this.anonymizeUserData(id);

    logger.info('User deleted by admin', {
      deletedBy: req.user.id,
      userId: id,
      reason
    });

    res.status(200).json({
      success: true,
      message: 'User deleted successfully'
    });
  });

  // Suspend user (admin only)
  suspendUser = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { reason, duration = 24 } = req.body; // duration in hours

    const user = await User.findById(id);

    if (!user) {
      throw new AppError('User not found', 404, true, 'USER_NOT_FOUND');
    }

    // Suspend user
    user.isActive = false;
    user.suspendedAt = new Date();
    user.suspendedBy = req.user.id;
    user.suspensionReason = reason;
    user.suspensionExpires = new Date(Date.now() + duration * 60 * 60 * 1000);
    await user.save();

    // Send notification
    await Notification.createNotification(id, {
      type: 'account',
      category: 'security',
      title: 'Account Suspended',
      message: `Your account has been suspended. Reason: ${reason}`,
      priority: 'high',
      actions: [{
        type: 'link',
        label: 'Contact Support',
        url: '/support',
        action: 'contact_support'
      }]
    });

    logger.info('User suspended by admin', {
      suspendedBy: req.user.id,
      userId: id,
      reason,
      duration
    });

    res.status(200).json({
      success: true,
      message: 'User suspended successfully'
    });
  });

  // Activate user (admin only)
  activateUser = catchAsync(async (req, res) => {
    const { id } = req.params;

    const user = await User.findById(id);

    if (!user) {
      throw new AppError('User not found', 404, true, 'USER_NOT_FOUND');
    }

    user.isActive = true;
    user.suspendedAt = undefined;
    user.suspendedBy = undefined;
    user.suspensionReason = undefined;
    user.suspensionExpires = undefined;
    await user.save();

    // Send notification
    await Notification.createNotification(id, {
      type: 'account',
      category: 'informational',
      title: 'Account Activated',
      message: 'Your account has been activated and is now fully functional.',
      priority: 'normal'
    });

    logger.info('User activated by admin', {
      activatedBy: req.user.id,
      userId: id
    });

    res.status(200).json({
      success: true,
      message: 'User activated successfully'
    });
  });

  // Get user statistics (admin only)
  getUserStats = catchAsync(async (req, res) => {
    const stats = await User.getUserStats();

    // Get additional analytics
    const totalUsers = await User.countDocuments({ isDeleted: false });
    const activeUsers = await User.countDocuments({ isActive: true, isDeleted: false });
    const verifiedUsers = await User.countDocuments({ isVerified: true, isDeleted: false });
    const vendors = await User.countDocuments({ role: 'vendor', isDeleted: false });

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalUsers,
          activeUsers,
          verifiedUsers,
          vendors,
          customers: totalUsers - vendors
        },
        roleDistribution: stats,
        recentActivity: await this.getRecentUserActivity()
      }
    });
  });

  // ===============================
  // HELPER METHODS
  // ===============================

  // Process referral reward
  async processReferralReward(referrerId, referredUserId) {
    const referrer = await User.findById(referrerId);
    const referredUser = await User.findById(referredUserId);

    // Add loyalty points to referrer
    await referrer.addLoyaltyPoints(100, `Referral: ${referredUser.firstName} joined`);

    // Add to referrer's referrals
    referrer.referrals.push({
      user: referredUserId,
      joinedAt: new Date(),
      rewardEarned: 100
    });

    await referrer.save();

    // Send notification to referrer
    await Notification.createNotification(referrerId, {
      type: 'account',
      category: 'informational',
      title: 'Referral Reward Earned!',
      message: `${referredUser.firstName} joined using your referral code. You've earned 100 loyalty points!`,
      priority: 'normal'
    });
  }

  // Cancel user subscriptions
  async cancelUserSubscriptions(userId) {
    // Implementation for canceling subscriptions
    // This would integrate with payment processors
    logger.info('User subscriptions cancelled', { userId });
  }

  // Anonymize user data
  async anonymizeUserData(userId) {
    // Anonymize sensitive user data
    await User.findByIdAndUpdate(userId, {
      firstName: 'Deleted',
      lastName: 'User',
      email: `deleted.${userId}@anonymous.local`,
      phone: null,
      avatar: null,
      bio: null,
      socialLinks: {},
      address: null,
      preferences: {},
      isEmailVerified: false,
      isPhoneVerified: false
    });

    logger.info('User data anonymized', { userId });
  }

  // Get user activity
  async getUserActivity(userId) {
    const activities = [];

    // Get recent orders
    const recentOrders = await Order.findByUser(userId, { limit: 5 });
    activities.push(...recentOrders.map(order => ({
      type: 'order',
      description: `Ordered ${order.items.length} items`,
      amount: order.pricing.totalAmount,
      date: order.createdAt,
      data: { orderNumber: order.orderNumber }
    })));

    // Get recent reviews
    const recentReviews = await Review.findByUser(userId, { limit: 5 });
    activities.push(...recentReviews.map(review => ({
      type: 'review',
      description: `Reviewed "${review.product.name}"`,
      rating: review.rating,
      date: review.createdAt,
      data: { productId: review.product }
    })));

    return activities.sort((a, b) => b.date - a.date).slice(0, 10);
  }

  // Get recent user activity (admin)
  async getRecentUserActivity() {
    // Get recent registrations
    const recentUsers = await User.find({ isDeleted: false })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('firstName lastName email role createdAt');

    // Get recent logins
    const recentLogins = await User.find({ isDeleted: false })
      .sort({ lastLogin: -1 })
      .limit(10)
      .select('firstName lastName email lastLogin');

    return {
      recentRegistrations: recentUsers,
      recentLogins: recentLogins
    };
  }

  // Get vendor notifications
  async getVendorNotifications(userId) {
    const notifications = await Notification.findByUser(userId, {
      type: { $in: ['order', 'product', 'vendor', 'payment'] },
      limit: 10
    });

    return notifications;
  }
}

module.exports = new UserController();
