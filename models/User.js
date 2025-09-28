const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const speakeasy = require('speakeasy');
const { v4: uuidv4 } = require('uuid');

const userSchema = new mongoose.Schema({
  // Basic Information
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    maxlength: [50, 'First name cannot exceed 50 characters'],
    minlength: [2, 'First name must be at least 2 characters']
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
    maxlength: [50, 'Last name cannot exceed 50 characters'],
    minlength: [2, 'Last name must be at least 2 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    validate: [validator.isEmail, 'Please provide a valid email']
  },
  phone: {
    type: String,
    validate: {
      validator: function(v) {
        return /^[\+]?[1-9][\d]{0,15}$/.test(v);
      },
      message: 'Please provide a valid phone number'
    }
  },
  dateOfBirth: {
    type: Date,
    validate: {
      validator: function(v) {
        return v < new Date();
      },
      message: 'Date of birth must be in the past'
    }
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'other', 'prefer-not-to-say'],
    default: 'prefer-not-to-say'
  },

  // Authentication
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false // Don't include in queries by default
  },
  passwordChangedAt: Date,
  passwordResetToken: String,
  passwordResetExpires: Date,
  passwordResetAttempts: {
    type: Number,
    default: 0,
    maxlength: 5
  },

  // Account Status
  isActive: {
    type: Boolean,
    default: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  isPhoneVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: String,
  emailVerificationExpires: Date,
  phoneVerificationToken: String,
  phoneVerificationExpires: Date,

  // Roles and Permissions
  role: {
    type: String,
    enum: ['customer', 'vendor', 'admin', 'moderator', 'support'],
    default: 'customer'
  },
  permissions: [{
    type: String,
    enum: [
      'read_products', 'write_products', 'delete_products',
      'read_orders', 'write_orders', 'delete_orders',
      'read_users', 'write_users', 'delete_users',
      'read_analytics', 'write_analytics',
      'manage_vendors', 'manage_payments', 'manage_support'
    ]
  }],

  // Profile Information
  avatar: {
    public_id: String,
    url: String,
    thumbnail: String
  },
  bio: {
    type: String,
    maxlength: [500, 'Bio cannot exceed 500 characters']
  },
  website: {
    type: String,
    validate: [validator.isURL, 'Please provide a valid URL']
  },
  socialLinks: {
    facebook: String,
    twitter: String,
    instagram: String,
    linkedin: String,
    youtube: String
  },

  // Location Information
  address: {
    street: String,
    city: String,
    state: String,
    country: String,
    zipCode: String,
    coordinates: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number],
        default: [0, 0]
      }
    }
  },
  timezone: {
    type: String,
    default: 'UTC'
  },
  language: {
    type: String,
    default: 'en',
    enum: ['en', 'es', 'fr', 'de', 'zh', 'ja', 'ar', 'pt', 'ru', 'hi']
  },
  currency: {
    type: String,
    default: 'USD',
    enum: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY', 'INR']
  },

  // Two-Factor Authentication
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  twoFactorSecret: {
    type: String,
    select: false
  },
  twoFactorBackupCodes: [{
    code: {
      type: String,
      select: false
    },
    used: {
      type: Boolean,
      default: false
    },
    usedAt: Date
  }],

  // Account Security
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: Date,
  lastLogin: Date,
  lastLoginIP: String,
  loginHistory: [{
    ip: String,
    userAgent: String,
    location: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    success: {
      type: Boolean,
      default: true
    }
  }],

  // Preferences
  preferences: {
    notifications: {
      email: {
        orderUpdates: { type: Boolean, default: true },
        promotions: { type: Boolean, default: true },
        securityAlerts: { type: Boolean, default: true },
        newsletter: { type: Boolean, default: false }
      },
      sms: {
        orderUpdates: { type: Boolean, default: true },
        promotions: { type: Boolean, default: false },
        securityAlerts: { type: Boolean, default: true }
      },
      push: {
        orderUpdates: { type: Boolean, default: true },
        promotions: { type: Boolean, default: false }
      }
    },
    privacy: {
      profileVisibility: {
        type: String,
        enum: ['public', 'friends', 'private'],
        default: 'public'
      },
      showOnlineStatus: { type: Boolean, default: true },
      allowFriendRequests: { type: Boolean, default: true }
    },
    shopping: {
      defaultPaymentMethod: String,
      defaultShippingAddress: String,
      wishlistPublic: { type: Boolean, default: false },
      priceAlerts: { type: Boolean, default: true }
    }
  },

  // Vendor Information (for vendor users)
  vendorProfile: {
    storeName: String,
    storeDescription: String,
    businessType: {
      type: String,
      enum: ['individual', 'business', 'nonprofit']
    },
    businessRegistration: String,
    taxId: String,
    isVerified: { type: Boolean, default: false },
    verificationDocuments: [{
      type: String,
      url: String,
      uploadedAt: { type: Date, default: Date.now }
    }],
    bankAccount: {
      accountNumber: String,
      routingNumber: String,
      accountHolderName: String
    },
    payoutSettings: {
      method: {
        type: String,
        enum: ['bank_transfer', 'paypal', 'stripe'],
        default: 'bank_transfer'
      },
      frequency: {
        type: String,
        enum: ['daily', 'weekly', 'monthly'],
        default: 'weekly'
      },
      minimumAmount: { type: Number, default: 10 }
    },
    storeSettings: {
      logo: String,
      banner: String,
      theme: String,
      customDomain: String,
      seoSettings: {
        title: String,
        description: String,
        keywords: [String]
      }
    },
    performance: {
      rating: { type: Number, default: 0 },
      totalSales: { type: Number, default: 0 },
      totalOrders: { type: Number, default: 0 },
      joinedAt: { type: Date, default: Date.now }
    }
  },

  // Customer Information
  customerProfile: {
    loyaltyPoints: { type: Number, default: 0 },
    membershipTier: {
      type: String,
      enum: ['bronze', 'silver', 'gold', 'platinum'],
      default: 'bronze'
    },
    wishlist: [{
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
      },
      addedAt: { type: Date, default: Date.now }
    }],
    savedAddresses: [{
      type: String,
      street: String,
      city: String,
      state: String,
      country: String,
      zipCode: String,
      isDefault: { type: Boolean, default: false },
      coordinates: {
        type: { type: String, enum: ['Point'] },
        coordinates: [Number]
      }
    }],
    paymentMethods: [{
      type: {
        type: String,
        enum: ['credit_card', 'debit_card', 'paypal', 'bank_transfer']
      },
      token: String,
      last4: String,
      brand: String,
      expiryMonth: Number,
      expiryYear: Number,
      isDefault: { type: Boolean, default: false },
      billingAddress: {
        street: String,
        city: String,
        state: String,
        country: String,
        zipCode: String
      }
    }]
  },

  // Admin Information
  adminProfile: {
    department: String,
    employeeId: String,
    accessLevel: {
      type: String,
      enum: ['super', 'senior', 'junior'],
      default: 'junior'
    },
    managedCategories: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category'
    }],
    permissions: [String]
  },

  // Activity Tracking
  activityScore: { type: Number, default: 0 },
  lastActivity: Date,
  sessionCount: { type: Number, default: 0 },
  totalSpent: { type: Number, default: 0 },
  totalOrders: { type: Number, default: 0 },

  // Referral System
  referralCode: {
    type: String,
    unique: true,
    sparse: true
  },
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  referrals: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    joinedAt: { type: Date, default: Date.now },
    rewardEarned: { type: Number, default: 0 }
  }],

  // API Access
  apiKeys: [{
    key: String,
    name: String,
    permissions: [String],
    createdAt: { type: Date, default: Date.now },
    lastUsed: Date,
    isActive: { type: Boolean, default: true }
  }],

  // Metadata
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Soft Delete
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: Date,
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ 'address.coordinates': '2dsphere' });
userSchema.index({ role: 1 });
userSchema.index({ isActive: 1, isVerified: 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ lastLogin: -1 });
userSchema.index({ 'vendorProfile.performance.rating': -1 });
userSchema.index({ 'customerProfile.loyaltyPoints': -1 });

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual for account age
userSchema.virtual('accountAge').get(function() {
  return Math.floor((Date.now() - this.createdAt) / (1000 * 60 * 60 * 24));
});

// Virtual for loyalty tier progress
userSchema.virtual('loyaltyProgress').get(function() {
  const tiers = {
    bronze: { min: 0, max: 1000, next: 'silver' },
    silver: { min: 1000, max: 5000, next: 'gold' },
    gold: { min: 5000, max: 10000, next: 'platinum' },
    platinum: { min: 10000, max: Infinity, next: null }
  };

  const currentTier = tiers[this.customerProfile?.membershipTier || 'bronze'];
  const progress = ((this.customerProfile?.loyaltyPoints || 0) - currentTier.min) /
                   (currentTier.max - currentTier.min) * 100;

  return {
    current: this.customerProfile?.membershipTier || 'bronze',
    points: this.customerProfile?.loyaltyPoints || 0,
    progress: Math.min(Math.max(progress, 0), 100),
    nextTier: currentTier.next,
    pointsToNext: currentTier.next ? currentTier.max - (this.customerProfile?.loyaltyPoints || 0) : 0
  };
});

// Pre-save middleware
userSchema.pre('save', async function(next) {
  // Hash password if modified
  if (this.isModified('password')) {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
  }

  // Generate referral code if not exists
  if (!this.referralCode && this.role === 'customer') {
    this.referralCode = uuidv4().substring(0, 8).toUpperCase();
  }

  // Update password changed timestamp
  if (this.isModified('password') && !this.isNew) {
    this.passwordChangedAt = Date.now() - 1000;
  }

  next();
});

// Instance methods
userSchema.methods = {
  // Generate JWT token
  generateAuthToken() {
    return jwt.sign(
      {
        id: this._id,
        email: this.email,
        role: this.role
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );
  },

  // Generate refresh token
  generateRefreshToken() {
    return jwt.sign(
      { id: this._id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRE }
    );
  },

  // Compare password
  async comparePassword(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
  },

  // Check if password was changed after token was issued
  changedPasswordAfter(JWTTimestamp) {
    if (this.passwordChangedAt) {
      const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
      return JWTTimestamp < changedTimestamp;
    }
    return false;
  },

  // Generate password reset token
  createPasswordResetToken() {
    const resetToken = crypto.randomBytes(32).toString('hex');

    this.passwordResetToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');

    this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

    return resetToken;
  },

  // Generate email verification token
  createEmailVerificationToken() {
    const verificationToken = crypto.randomBytes(32).toString('hex');

    this.emailVerificationToken = crypto
      .createHash('sha256')
      .update(verificationToken)
      .digest('hex');

    this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    return verificationToken;
  },

  // Generate 2FA secret
  generateTwoFactorSecret() {
    const secret = speakeasy.generateSecret({
      name: `E-commerce (${this.email})`,
      issuer: process.env.APP_NAME || 'E-commerce'
    });

    this.twoFactorSecret = secret.base32;
    return secret;
  },

  // Verify 2FA token
  verifyTwoFactorToken(token) {
    return speakeasy.totp.verify({
      secret: this.twoFactorSecret,
      encoding: 'base32',
      token: token,
      window: 2 // Allow 30 seconds window
    });
  },

  // Generate backup codes
  generateBackupCodes() {
    const codes = [];
    for (let i = 0; i < 10; i++) {
      const code = Math.random().toString(36).substring(2, 10).toUpperCase();
      codes.push({
        code: crypto.createHash('sha256').update(code).digest('hex'),
        used: false
      });
    }
    this.twoFactorBackupCodes = codes;
    return codes.map(c => c.code);
  },

  // Check if account is locked
  isLocked() {
    return !!(this.lockUntil && this.lockUntil > Date.now());
  },

  // Increment login attempts
  async incrementLoginAttempts() {
    if (this.lockUntil && this.lockUntil < Date.now()) {
      return this.updateOne({
        $unset: { loginAttempts: 1, lockUntil: 1 }
      });
    }

    const updates = { $inc: { loginAttempts: 1 } };

    if (this.loginAttempts + 1 >= 5 && !this.isLocked()) {
      updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 }; // 2 hours
    }

    return this.updateOne(updates);
  },

  // Reset login attempts
  async resetLoginAttempts() {
    return this.updateOne({
      $unset: { loginAttempts: 1, lockUntil: 1 },
      $set: { lastLogin: new Date() }
    });
  },

  // Add login history
  async addLoginHistory(ip, userAgent, location, success = true) {
    const loginEntry = {
      ip,
      userAgent,
      location,
      timestamp: new Date(),
      success
    };

    return this.updateOne({
      $push: {
        loginHistory: {
          $each: [loginEntry],
          $slice: -50 // Keep only last 50 entries
        }
      }
    });
  },

  // Calculate activity score
  async calculateActivityScore() {
    let score = 0;

    // Base score from account age
    const accountAge = this.accountAge;
    score += Math.min(accountAge * 2, 100);

    // Login frequency bonus
    const recentLogins = this.loginHistory.filter(
      entry => entry.success &&
      entry.timestamp > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    ).length;
    score += recentLogins * 5;

    // Purchase history bonus
    score += Math.min(this.totalOrders * 10, 200);

    // Profile completion bonus
    if (this.avatar) score += 20;
    if (this.bio) score += 10;
    if (this.phone) score += 15;
    if (this.address) score += 25;

    this.activityScore = Math.min(score, 1000);
    await this.save();
  },

  // Update membership tier
  async updateMembershipTier() {
    const points = this.customerProfile?.loyaltyPoints || 0;
    let newTier = 'bronze';

    if (points >= 10000) newTier = 'platinum';
    else if (points >= 5000) newTier = 'gold';
    else if (points >= 1000) newTier = 'silver';

    if (this.customerProfile?.membershipTier !== newTier) {
      this.customerProfile.membershipTier = newTier;
      await this.save();
    }
  },

  // Add loyalty points
  async addLoyaltyPoints(points, reason) {
    this.customerProfile.loyaltyPoints += points;

    // Update membership tier if needed
    await this.updateMembershipTier();

    // Recalculate activity score
    await this.calculateActivityScore();

    return this.save();
  },

  // Create API key
  createApiKey(name, permissions = []) {
    const apiKey = uuidv4();
    const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');

    this.apiKeys.push({
      key: hashedKey,
      name,
      permissions,
      createdAt: new Date(),
      isActive: true
    });

    return { apiKey, keyId: this.apiKeys[this.apiKeys.length - 1]._id };
  },

  // Validate API key
  validateApiKey(providedKey) {
    const hashedKey = crypto.createHash('sha256').update(providedKey).digest('hex');
    return this.apiKeys.find(key =>
      key.key === hashedKey && key.isActive
    );
  }
};

// Static methods
userSchema.statics = {
  // Find user by email with populated data
  async findByEmail(email) {
    return this.findOne({ email: email.toLowerCase() })
      .populate('referredBy', 'firstName lastName')
      .populate('referrals.user', 'firstName lastName email');
  },

  // Find users by role
  async findByRole(role) {
    return this.find({ role, isActive: true, isDeleted: false });
  },

  // Get user statistics
  async getUserStats() {
    const stats = await this.aggregate([
      {
        $match: { isDeleted: false }
      },
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 },
          activeUsers: {
            $sum: { $cond: ['$isActive', 1, 0] }
          },
          verifiedUsers: {
            $sum: { $cond: ['$isVerified', 1, 0] }
          },
          avgActivityScore: { $avg: '$activityScore' }
        }
      }
    ]);

    return stats;
  },

  // Clean up inactive users
  async cleanupInactiveUsers(daysInactive = 365) {
    const cutoffDate = new Date(Date.now() - daysInactive * 24 * 60 * 60 * 1000);

    const result = await this.updateMany(
      {
        lastLogin: { $lt: cutoffDate },
        isActive: true,
        role: { $in: ['customer', 'vendor'] }
      },
      {
        $set: { isActive: false }
      }
    );

    return result.modifiedCount;
  }
};

// Post-save middleware
userSchema.post('save', function(error, doc, next) {
  if (error.name === 'MongoServerError' && error.code === 11000) {
    next(new Error('Email already exists'));
  } else {
    next(error);
  }
});

module.exports = mongoose.model('User', userSchema);
