const User = require('../models/User');
const Cart = require('../models/Cart');
const { 
  generateToken, 
  generateRefreshToken, 
  hashPassword, 
  comparePassword,
  generateEmailVerificationToken,
  generatePasswordResetToken,
  hashToken,
  isValidEmail,
  isValidPhone,
  sanitizeInput,
  authRateLimit
} = require('../middleware/authMiddleware');
const { sendEmail } = require('../services/emailService');
const { sendSMS } = require('../services/smsService');

// @desc    Register new user
// @route   POST /api/users/register
// @access  Public
const registerUser = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      password,
      confirmPassword,
      role = 'user',
      referralCode,
      acceptTerms,
      marketingEmails
    } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        error: 'Please provide all required fields'
      });
    }

    // Sanitize inputs
    const sanitizedFirstName = sanitizeInput(firstName);
    const sanitizedLastName = sanitizeInput(lastName);
    const sanitizedEmail = sanitizeInput(email).toLowerCase();
    const sanitizedPhone = phone ? sanitizeInput(phone) : null;

    // Validate email format
    if (!isValidEmail(sanitizedEmail)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid email address'
      });
    }

    // Validate phone format if provided
    if (sanitizedPhone && !isValidPhone(sanitizedPhone)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid phone number'
      });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters long'
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        error: 'Passwords do not match'
      });
    }

    // Validate terms acceptance
    if (!acceptTerms) {
      return res.status(400).json({
        success: false,
        error: 'Please accept the terms and conditions'
      });
    }

    // Check if user already exists
    const existingUser = await User.findByEmailOrPhone(sanitizedEmail);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'User with this email already exists'
      });
    }

    // Check if phone already exists (if provided)
    if (sanitizedPhone) {
      const phoneExists = await User.findOne({ phone: sanitizedPhone });
      if (phoneExists) {
        return res.status(400).json({
          success: false,
          error: 'User with this phone number already exists'
        });
      }
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Generate email verification token
    const emailVerificationToken = generateEmailVerificationToken();
    const hashedEmailToken = hashToken(emailVerificationToken);

    // Handle referral code
    let referredBy = null;
    if (referralCode) {
      const referrer = await User.findOne({ 'referral.code': referralCode });
      if (referrer) {
        referredBy = referrer._id;
      }
    }

    // Create user
    const user = await User.create({
      firstName: sanitizedFirstName,
      lastName: sanitizedLastName,
      email: sanitizedEmail,
      phone: sanitizedPhone,
      password: hashedPassword,
      role,
      emailVerificationToken: hashedEmailToken,
      emailVerificationExpires: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      referral: {
        referredBy,
        code: `REF${Date.now()}${Math.random().toString(36).substr(2, 9).toUpperCase()}`
      },
      preferences: {
        notifications: {
          email: {
            promotions: marketingEmails || false
          }
        }
      }
    });

    // Create cart for user
    await Cart.create({
      user: user._id,
      metadata: {
        createdFrom: 'registration'
      }
    });

    // Generate tokens
    const token = generateToken(user._id, user.email, user.role);
    const refreshToken = generateRefreshToken(user._id);

    // Send verification email
    try {
      await sendEmail({
        to: user.email,
        subject: 'Verify Your Email Address',
        template: 'emailVerification',
        data: {
          firstName: user.firstName,
          verificationUrl: `${process.env.FRONTEND_URL}/verify-email/${emailVerificationToken}`,
          expiresIn: '24 hours'
        }
      });
    } catch (emailError) {
      console.error('Failed to send verification email:', emailError);
      // Don't fail registration if email fails
    }

    // Send welcome SMS if phone provided
    if (sanitizedPhone) {
      try {
        await sendSMS({
          to: sanitizedPhone,
          message: `Welcome to our platform, ${user.firstName}! Your account has been created successfully.`
        });
      } catch (smsError) {
        console.error('Failed to send welcome SMS:', smsError);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Registration successful! Please check your email to verify your account.',
      data: {
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          emailVerified: user.emailVerified,
          status: user.status
        },
        token,
        refreshToken
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Registration failed. Please try again.'
    });
  }
};

// @desc    Login user
// @route   POST /api/users/login
// @access  Public
const loginUser = async (req, res) => {
  try {
    const { email, password, rememberMe = false } = req.body;

    // Rate limiting
    authRateLimit(5, 15 * 60 * 1000)(req, res, async () => {
      // Validate required fields
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Please provide email and password'
        });
      }

      // Sanitize inputs
      const sanitizedEmail = sanitizeInput(email).toLowerCase();

      // Validate email format
      if (!isValidEmail(sanitizedEmail)) {
        return res.status(400).json({
          success: false,
          error: 'Please provide a valid email address'
        });
      }

      // Find user
      const user = await User.findByEmailOrPhone(sanitizedEmail).select('+password');

      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'Invalid credentials'
        });
      }

      // Check if account is locked
      if (user.isLocked()) {
        return res.status(423).json({
          success: false,
          error: 'Account is locked due to too many failed login attempts. Please contact support.'
        });
      }

      // Check password
      const isPasswordValid = await comparePassword(password, user.password);

      if (!isPasswordValid) {
        // Increment failed attempts
        await user.incrementLoginAttempts();
        return res.status(401).json({
          success: false,
          error: 'Invalid credentials'
        });
      }

      // Check if user needs verification
      if (!user.emailVerified) {
        return res.status(403).json({
          success: false,
          error: 'Please verify your email address before logging in',
          requiresVerification: true
        });
      }

      // Check if account is active
      if (user.status !== 'active') {
        return res.status(403).json({
          success: false,
          error: 'Your account is not active. Please contact support.'
        });
      }

      // Reset failed login attempts
      await user.resetLoginAttempts();

      // Update last login
      await user.updateLastLogin();

      // Update device info
      const deviceInfo = {
        deviceId: req.headers['user-agent'] ? require('crypto').createHash('md5').update(req.headers['user-agent']).digest('hex') : 'unknown',
        deviceType: getDeviceType(req.headers['user-agent']),
        browser: getBrowser(req.headers['user-agent']),
        ipAddress: req.ip || req.connection.remoteAddress,
        location: await getLocationFromIP(req.ip),
        lastSeen: new Date()
      };

      user.deviceInfo.push(deviceInfo);
      await user.save();

      // Generate tokens
      const token = generateToken(user._id, user.email, user.role);
      const refreshToken = generateRefreshToken(user._id);

      // Set refresh token as httpOnly cookie if remember me
      if (rememberMe) {
        res.cookie('refreshToken', refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });
      }

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: {
            id: user._id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            phone: user.phone,
            role: user.role,
            emailVerified: user.emailVerified,
            phoneVerified: user.phoneVerified,
            status: user.status,
            profile: user.profile,
            preferences: user.preferences,
            shopping: user.shopping,
            subscription: user.subscription
          },
          token,
          refreshToken: rememberMe ? undefined : refreshToken,
          statistics: user.getStatistics()
        }
      });
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed. Please try again.'
    });
  }
};

// @desc    Get current user profile
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('shopping.favoriteCategories', 'name slug')
      .populate('shopping.favoriteVendors', 'firstName lastName businessName')
      .populate('vendorProfile');

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Get user's recent orders
    const recentOrders = await require('../models/Order').find({ user: user._id })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('orderNumber status totalAmount createdAt');

    // Get user's wishlist count
    const wishlistCount = user.shopping.wishList.length;

    // Get user's cart summary
    const cart = await Cart.findByUser(user._id);
    const cartSummary = cart ? cart.getCartValue() : { itemCount: 0, total: 0 };

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          role: user.role,
          status: user.status,
          emailVerified: user.emailVerified,
          phoneVerified: user.phoneVerified,
          profile: user.profile,
          addresses: user.addresses,
          preferences: user.preferences,
          shopping: {
            ...user.shopping.toObject(),
            wishList: undefined, // Don't send full wishlist
            recentlyViewed: undefined // Don't send full recently viewed
          },
          vendorProfile: user.role === 'vendor' ? user.vendorProfile : undefined,
          subscription: user.subscription,
          referral: user.referral,
          statistics: user.getStatistics()
        },
        recentOrders,
        wishlistCount,
        cartSummary,
        lastLogin: user.lastLogin,
        memberSince: user.createdAt
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch profile'
    });
  }
};

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
const updateUserProfile = async (req, res) => {
  try {
    const updates = req.body;
    const userId = req.user._id;

    // Fields that can be updated
    const allowedUpdates = [
      'firstName', 'lastName', 'phone', 'profile.bio', 'profile.dateOfBirth',
      'profile.gender', 'profile.website', 'preferences.language', 'preferences.currency',
      'preferences.timezone', 'preferences.notifications', 'preferences.privacy'
    ];

    // Filter updates to only allowed fields
    const filteredUpdates = {};
    Object.keys(updates).forEach(key => {
      if (allowedUpdates.includes(key)) {
        filteredUpdates[key] = sanitizeInput(updates[key]);
      }
    });

    // Validate phone if provided
    if (filteredUpdates.phone && !isValidPhone(filteredUpdates.phone)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid phone number'
      });
    }

    // Validate website if provided
    if (filteredUpdates['profile.website']) {
      const websiteRegex = /^https?:\/\/.+/;
      if (!websiteRegex.test(filteredUpdates['profile.website'])) {
        return res.status(400).json({
          success: false,
          error: 'Please provide a valid website URL'
        });
      }
    }

    // Update user
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: filteredUpdates },
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          profile: user.profile,
          preferences: user.preferences
        }
      }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update profile'
    });
  }
};

// @desc    Change password
// @route   PUT /api/users/change-password
// @access  Private
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.user._id;

    // Validate required fields
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        error: 'Please provide current password, new password, and confirmation'
      });
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 8 characters long'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        error: 'New passwords do not match'
      });
    }

    // Get user with password
    const user = await User.findById(userId).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await comparePassword(currentPassword, user.password);

    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        error: 'Current password is incorrect'
      });
    }

    // Hash new password
    const hashedNewPassword = await hashPassword(newPassword);

    // Update password
    user.password = hashedNewPassword;
    user.security.passwordChangedAt = Date.now();
    await user.save();

    // Invalidate all refresh tokens (force re-login)
    // This would typically involve clearing refresh tokens from database

    res.json({
      success: true,
      message: 'Password changed successfully. Please login again with your new password.'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to change password'
    });
  }
};

// @desc    Forgot password
// @route   POST /api/users/forgot-password
// @access  Public
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Please provide your email address'
      });
    }

    const sanitizedEmail = sanitizeInput(email).toLowerCase();

    if (!isValidEmail(sanitizedEmail)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid email address'
      });
    }

    const user = await User.findOne({ email: sanitizedEmail });

    if (!user) {
      // Don't reveal if email exists or not
      return res.json({
        success: true,
        message: 'If an account with that email exists, we have sent a password reset link.'
      });
    }

    // Generate reset token
    const resetToken = generatePasswordResetToken();
    const hashedResetToken = hashToken(resetToken);

    // Save reset token to user
    user.passwordResetToken = hashedResetToken;
    user.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    await user.save();

    // Send reset email
    try {
      await sendEmail({
        to: user.email,
        subject: 'Password Reset Request',
        template: 'passwordReset',
        data: {
          firstName: user.firstName,
          resetUrl: `${process.env.FRONTEND_URL}/reset-password/${resetToken}`,
          expiresIn: '10 minutes'
        }
      });

      res.json({
        success: true,
        message: 'Password reset link sent to your email'
      });

    } catch (emailError) {
      console.error('Failed to send reset email:', emailError);
      res.status(500).json({
        success: false,
        error: 'Failed to send reset email. Please try again.'
      });
    }

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process password reset request'
    });
  }
};

// @desc    Reset password
// @route   PUT /api/users/reset-password/:token
// @access  Public
const resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password, confirmPassword } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Reset token is required'
      });
    }

    if (!password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        error: 'Please provide new password and confirmation'
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        error: 'Passwords do not match'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters long'
      });
    }

    // Hash the token to compare with stored hash
    const hashedToken = hashToken(token);

    // Find user with valid reset token
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired reset token'
      });
    }

    // Hash new password
    const hashedPassword = await hashPassword(password);

    // Update user
    user.password = hashedPassword;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.security.passwordChangedAt = Date.now();
    await user.save();

    res.json({
      success: true,
      message: 'Password reset successfully'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset password'
    });
  }
};

// @desc    Verify email
// @route   GET /api/users/verify-email/:token
// @access  Public
const verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Verification token is required'
      });
    }

    // Hash the token to compare with stored hash
    const hashedToken = hashToken(token);

    // Find user with valid verification token
    const user = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired verification token'
      });
    }

    // Update user verification status
    user.emailVerified = true;
    user.status = 'active';
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    // Send welcome email
    try {
      await sendEmail({
        to: user.email,
        subject: 'Welcome to Our Platform!',
        template: 'welcome',
        data: {
          firstName: user.firstName,
          loginUrl: `${process.env.FRONTEND_URL}/login`
        }
      });
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError);
    }

    res.json({
      success: true,
      message: 'Email verified successfully! Your account is now active.'
    });

  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify email'
    });
  }
};

// @desc    Resend verification email
// @route   POST /api/users/resend-verification
// @access  Public
const resendVerification = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Please provide your email address'
      });
    }

    const sanitizedEmail = sanitizeInput(email).toLowerCase();

    if (!isValidEmail(sanitizedEmail)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid email address'
      });
    }

    const user = await User.findOne({ email: sanitizedEmail });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'No account found with this email address'
      });
    }

    if (user.emailVerified) {
      return res.status(400).json({
        success: false,
        error: 'Email is already verified'
      });
    }

    // Check if we can resend (prevent spam)
    const lastSent = user.updatedAt;
    const timeDiff = Date.now() - lastSent.getTime();
    const cooldownPeriod = 5 * 60 * 1000; // 5 minutes

    if (timeDiff < cooldownPeriod) {
      const remainingTime = Math.ceil((cooldownPeriod - timeDiff) / 1000);
      return res.status(429).json({
        success: false,
        error: `Please wait ${remainingTime} seconds before requesting another verification email`
      });
    }

    // Generate new verification token
    const emailVerificationToken = generateEmailVerificationToken();
    const hashedEmailToken = hashToken(emailVerificationToken);

    user.emailVerificationToken = hashedEmailToken;
    user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    await user.save();

    // Send verification email
    try {
      await sendEmail({
        to: user.email,
        subject: 'Verify Your Email Address',
        template: 'emailVerification',
        data: {
          firstName: user.firstName,
          verificationUrl: `${process.env.FRONTEND_URL}/verify-email/${emailVerificationToken}`,
          expiresIn: '24 hours'
        }
      });

      res.json({
        success: true,
        message: 'Verification email sent successfully'
      });

    } catch (emailError) {
      console.error('Failed to send verification email:', emailError);
      res.status(500).json({
        success: false,
        error: 'Failed to send verification email. Please try again.'
      });
    }

  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to resend verification email'
    });
  }
};

// @desc    Add address
// @route   POST /api/users/addresses
// @access  Private
const addAddress = async (req, res) => {
  try {
    const {
      type,
      name,
      street,
      city,
      state,
      country,
      zipCode,
      phone,
      isDefault = false
    } = req.body;

    const userId = req.user._id;

    // Validate required fields
    if (!type || !name || !street || !city || !state || !country || !zipCode) {
      return res.status(400).json({
        success: false,
        error: 'Please provide all required fields'
      });
    }

    // Sanitize inputs
    const sanitizedName = sanitizeInput(name);
    const sanitizedStreet = sanitizeInput(street);
    const sanitizedCity = sanitizeInput(city);
    const sanitizedState = sanitizeInput(state);
    const sanitizedCountry = sanitizeInput(country);
    const sanitizedZipCode = sanitizeInput(zipCode);

    // Validate address type
    const validTypes = ['home', 'work', 'other'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid address type'
      });
    }

    // If this is set as default, remove default from other addresses
    if (isDefault) {
      await User.updateOne(
        { _id: userId },
        { $unset: { 'addresses.$[].isDefault': 1 } }
      );
    }

    // Add new address
    const user = await User.findByIdAndUpdate(
      userId,
      {
        $push: {
          addresses: {
            type,
            name: sanitizedName,
            street: sanitizedStreet,
            city: sanitizedCity,
            state: sanitizedState,
            country: sanitizedCountry,
            zipCode: sanitizedZipCode,
            phone: phone ? sanitizeInput(phone) : undefined,
            isDefault: isDefault || false
          }
        }
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const newAddress = user.addresses[user.addresses.length - 1];

    res.status(201).json({
      success: true,
      message: 'Address added successfully',
      data: {
        address: newAddress
      }
    });

  } catch (error) {
    console.error('Add address error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add address'
    });
  }
};

// @desc    Update address
// @route   PUT /api/users/addresses/:addressId
// @access  Private
const updateAddress = async (req, res) => {
  try {
    const { addressId } = req.params;
    const updates = req.body;
    const userId = req.user._id;

    // Fields that can be updated in address
    const allowedUpdates = [
      'type', 'name', 'street', 'city', 'state', 'country', 'zipCode', 'phone', 'isDefault'
    ];

    // Filter updates
    const filteredUpdates = {};
    Object.keys(updates).forEach(key => {
      if (allowedUpdates.includes(key)) {
        filteredUpdates[`addresses.$.${key}`] = sanitizeInput(updates[key]);
      }
    });

    // Validate address type if provided
    if (filteredUpdates['addresses.$.type']) {
      const validTypes = ['home', 'work', 'other'];
      if (!validTypes.includes(filteredUpdates['addresses.$.type'])) {
        return res.status(400).json({
          success: false,
          error: 'Invalid address type'
        });
      }
    }

    // If setting as default, remove default from other addresses
    if (filteredUpdates['addresses.$.isDefault'] === true) {
      await User.updateOne(
        { _id: userId },
        { $unset: { 'addresses.$[].isDefault': 1 } }
      );
    }

    // Update address
    const user = await User.findOneAndUpdate(
      {
        _id: userId,
        'addresses._id': addressId
      },
      { $set: filteredUpdates },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Address not found'
      });
    }

    const updatedAddress = user.addresses.id(addressId);

    res.json({
      success: true,
      message: 'Address updated successfully',
      data: {
        address: updatedAddress
      }
    });

  } catch (error) {
    console.error('Update address error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update address'
    });
  }
};

// @desc    Delete address
// @route   DELETE /api/users/addresses/:addressId
// @access  Private
const deleteAddress = async (req, res) => {
  try {
    const { addressId } = req.params;
    const userId = req.user._id;

    const user = await User.findByIdAndUpdate(
      userId,
      { $pull: { addresses: { _id: addressId } } },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // If deleted address was default, set another as default
    const deletedAddress = user.addresses.find(addr => addr._id.toString() === addressId);
    if (deletedAddress && deletedAddress.isDefault && user.addresses.length > 0) {
      user.addresses[0].isDefault = true;
      await user.save();
    }

    res.json({
      success: true,
      message: 'Address deleted successfully'
    });

  } catch (error) {
    console.error('Delete address error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete address'
    });
  }
};

// @desc    Add to wishlist
// @route   POST /api/users/wishlist
// @access  Private
const addToWishlist = async (req, res) => {
  try {
    const { productId } = req.body;
    const userId = req.user._id;

    if (!productId) {
      return res.status(400).json({
        success: false,
        error: 'Product ID is required'
      });
    }

    // Check if product exists
    const Product = require('../models/Product');
    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    const user = await User.findById(userId);

    // Add to wishlist
    await user.addToWishlist(productId);

    res.json({
      success: true,
      message: 'Product added to wishlist'
    });

  } catch (error) {
    console.error('Add to wishlist error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add to wishlist'
    });
  }
};

// @desc    Remove from wishlist
// @route   DELETE /api/users/wishlist/:productId
// @access  Private
const removeFromWishlist = async (req, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user._id;

    const user = await User.findById(userId);

    // Remove from wishlist
    await user.removeFromWishlist(productId);

    res.json({
      success: true,
      message: 'Product removed from wishlist'
    });

  } catch (error) {
    console.error('Remove from wishlist error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove from wishlist'
    });
  }
};

// @desc    Get wishlist
// @route   GET /api/users/wishlist
// @access  Private
const getWishlist = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const user = await User.findById(userId)
      .populate({
        path: 'shopping.wishList.product',
        select: 'name slug price images rating category',
        populate: {
          path: 'category',
          select: 'name slug'
        }
      });

    const wishlistItems = user.shopping.wishList
      .slice(skip, skip + limit)
      .map(item => ({
        product: item.product,
        addedAt: item.addedAt
      }));

    res.json({
      success: true,
      data: {
        wishlist: wishlistItems,
        pagination: {
          page,
          limit,
          total: user.shopping.wishList.length,
          pages: Math.ceil(user.shopping.wishList.length / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get wishlist error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch wishlist'
    });
  }
};

// @desc    Add recently viewed product
// @route   POST /api/users/recently-viewed
// @access  Private
const addRecentlyViewed = async (req, res) => {
  try {
    const { productId } = req.body;
    const userId = req.user._id;

    if (!productId) {
      return res.status(400).json({
        success: false,
        error: 'Product ID is required'
      });
    }

    const user = await User.findById(userId);

    // Add to recently viewed
    await user.addRecentlyViewed(productId);

    res.json({
      success: true,
      message: 'Product added to recently viewed'
    });

  } catch (error) {
    console.error('Add recently viewed error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add to recently viewed'
    });
  }
};

// @desc    Get recently viewed products
// @route   GET /api/users/recently-viewed
// @access  Private
const getRecentlyViewed = async (req, res) => {
  try {
    const userId = req.user._id;
    const limit = parseInt(req.query.limit) || 20;

    const user = await User.findById(userId)
      .populate({
        path: 'shopping.recentlyViewed.product',
        select: 'name slug price images rating category',
        populate: {
          path: 'category',
          select: 'name slug'
        }
      });

    const recentlyViewedItems = user.shopping.recentlyViewed
      .slice(0, limit)
      .map(item => ({
        product: item.product,
        viewedAt: item.viewedAt
      }));

    res.json({
      success: true,
      data: {
        recentlyViewed: recentlyViewedItems
      }
    });

  } catch (error) {
    console.error('Get recently viewed error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recently viewed products'
    });
  }
};

// @desc    Logout user
// @route   POST /api/users/logout
// @access  Private
const logoutUser = async (req, res) => {
  try {
    const userId = req.user._id;
    const deviceId = req.headers['user-agent'] ? 
      require('crypto').createHash('md5').update(req.headers['user-agent']).digest('hex') : 
      'unknown';

    // Remove device from user's device info
    await User.updateOne(
      { _id: userId },
      { $pull: { deviceInfo: { deviceId } } }
    );

    // Clear refresh token cookie
    res.clearCookie('refreshToken');

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Logout failed'
    });
  }
};

// @desc    Refresh token
// @route   POST /api/users/refresh-token
// @access  Public
const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'Refresh token is required'
      });
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);

    // Find user
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid refresh token'
      });
    }

    if (user.status !== 'active') {
      return res.status(401).json({
        success: false,
        error: 'Account is not active'
      });
    }

    // Generate new tokens
    const newToken = generateToken(user._id, user.email, user.role);
    const newRefreshToken = generateRefreshToken(user._id);

    res.json({
      success: true,
      data: {
        token: newToken,
        refreshToken: newRefreshToken,
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role
        }
      }
    });

  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(401).json({
      success: false,
      error: 'Invalid refresh token'
    });
  }
};

// @desc    Get user statistics
// @route   GET /api/users/statistics
// @access  Private
const getUserStatistics = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId);

    // Get order statistics
    const Order = require('../models/Order');
    const orderStats = await Order.aggregate([
      { $match: { user: user._id } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalSpent: { $sum: '$totalAmount' },
          averageOrderValue: { $avg: '$totalAmount' },
          lastOrderDate: { $max: '$orderDate' }
        }
      }
    ]);

    // Get review statistics
    const Review = require('../models/Review');
    const reviewStats = await Review.aggregate([
      { $match: { user: user._id } },
      {
        $group: {
          _id: null,
          totalReviews: { $sum: 1 },
          averageRating: { $avg: '$rating' },
          helpfulVotes: { $sum: '$helpful' }
        }
      }
    ]);

    // Get cart statistics
    const cart = await Cart.findByUser(userId);
    const cartStats = cart ? cart.getCartValue() : { itemCount: 0, total: 0 };

    const stats = {
      account: user.getStatistics(),
      orders: orderStats[0] || { totalOrders: 0, totalSpent: 0, averageOrderValue: 0 },
      reviews: reviewStats[0] || { totalReviews: 0, averageRating: 0, helpfulVotes: 0 },
      cart: cartStats,
      wishlist: {
        count: user.shopping.wishList.length
      },
      activity: {
        lastLogin: user.lastLogin,
        loginCount: user.loginCount,
        memberSince: user.createdAt
      }
    };

    res.json({
      success: true,
      data: { statistics: stats }
    });

  } catch (error) {
    console.error('Get user statistics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user statistics'
    });
  }
};

// Helper functions
const getDeviceType = (userAgent) => {
  if (!userAgent) return 'unknown';
  
  if (/mobile|android|iphone|ipad|phone/i.test(userAgent)) {
    return 'mobile';
  }
  if (/tablet/i.test(userAgent)) {
    return 'tablet';
  }
  return 'desktop';
};

const getBrowser = (userAgent) => {
  if (!userAgent) return 'unknown';
  
  if (userAgent.includes('Chrome')) return 'Chrome';
  if (userAgent.includes('Firefox')) return 'Firefox';
  if (userAgent.includes('Safari')) return 'Safari';
  if (userAgent.includes('Edge')) return 'Edge';
  if (userAgent.includes('Opera')) return 'Opera';
  
  return 'unknown';
};

const getLocationFromIP = async (ip) => {
  try {
    // This would typically use a geolocation service
    return 'Unknown';
  } catch (error) {
    return 'Unknown';
  }
};

module.exports = {
  registerUser,
  loginUser,
  getUserProfile,
  updateUserProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  addAddress,
  updateAddress,
  deleteAddress,
  addToWishlist,
  removeFromWishlist,
  getWishlist,
  addRecentlyViewed,
  getRecentlyViewed,
  logoutUser,
  refreshToken,
  getUserStatistics
};
