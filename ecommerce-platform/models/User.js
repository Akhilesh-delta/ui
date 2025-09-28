const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { config } = require('../config/environment');

const userSchema = new mongoose.Schema({
  // Basic Information
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    maxlength: [50, 'First name cannot exceed 50 characters']
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
    maxlength: [50, 'Last name cannot exceed 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    validate: {
      validator: function(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      },
      message: 'Please provide a valid email'
    }
  },
  phone: {
    type: String,
    validate: {
      validator: function(phone) {
        return /^\+?[\d\s\-\(\)]{10,}$/.test(phone);
      },
      message: 'Please provide a valid phone number'
    }
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false
  },
  
  // Profile Information
  profile: {
    avatar: {
      type: String,
      default: ''
    },
    bio: {
      type: String,
      maxlength: [500, 'Bio cannot exceed 500 characters']
    },
    dateOfBirth: {
      type: Date
    },
    gender: {
      type: String,
      enum: ['male', 'female', 'other', 'prefer-not-to-say']
    },
    website: {
      type: String,
      validate: {
        validator: function(url) {
          if (!url) return true;
          return /^https?:\/\/.+/.test(url);
        },
        message: 'Please provide a valid URL'
      }
    }
  },
  
  // Address Information
  addresses: [{
    type: {
      type: String,
      required: true,
      enum: ['home', 'work', 'other']
    },
    name: {
      type: String,
      required: true
    },
    street: {
      type: String,
      required: true
    },
    city: {
      type: String,
      required: true
    },
    state: {
      type: String,
      required: true
    },
    country: {
      type: String,
      required: true,
      default: 'US'
    },
    zipCode: {
      type: String,
      required: true
    },
    coordinates: {
      latitude: Number,
      longitude: Number
    },
    isDefault: {
      type: Boolean,
      default: false
    }
  }],
  
  // Account Information
  role: {
    type: String,
    enum: ['user', 'vendor', 'admin', 'moderator'],
    default: 'user'
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended', 'pending', 'verified'],
    default: 'pending'
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  phoneVerified: {
    type: Boolean,
    default: false
  },
  
  // Verification
  verificationToken: String,
  verificationTokenExpires: Date,
  passwordResetToken: String,
  passwordResetExpires: Date,
  emailVerificationToken: String,
  emailVerificationExpires: Date,
  
  // Social Login
  socialLogin: {
    google: {
      id: String,
      email: String
    },
    facebook: {
      id: String,
      email: String
    },
    amazon: {
      id: String,
      email: String
    }
  },
  
  // Preferences
  preferences: {
    language: {
      type: String,
      default: 'en',
      enum: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ko']
    },
    currency: {
      type: String,
      default: 'USD',
      enum: ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR']
    },
    timezone: {
      type: String,
      default: 'America/New_York'
    },
    notifications: {
      email: {
        orderUpdates: { type: Boolean, default: true },
        promotions: { type: Boolean, default: true },
        reviews: { type: Boolean, default: true },
        security: { type: Boolean, default: true }
      },
      push: {
        orderUpdates: { type: Boolean, default: true },
        promotions: { type: Boolean, default: false },
        reviews: { type: Boolean, default: true }
      },
      sms: {
        orderUpdates: { type: Boolean, default: false },
        security: { type: Boolean, default: true }
      }
    },
    privacy: {
      profileVisible: { type: Boolean, default: true },
      showOnlineStatus: { type: Boolean, default: true },
      allowMessages: { type: Boolean, default: true }
    }
  },
  
  // Shopping Information
  shopping: {
    favoriteCategories: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category'
    }],
    favoriteVendors: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    wishList: [{
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
      },
      addedAt: {
        type: Date,
        default: Date.now
      }
    }],
    recentlyViewed: [{
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
      },
      viewedAt: {
        type: Date,
        default: Date.now
      }
    }],
    cartItemsCount: {
      type: Number,
      default: 0
    },
    totalOrders: {
      type: Number,
      default: 0
    },
    totalSpent: {
      type: Number,
      default: 0
    }
  },
  
  // Vendor Information (for vendor role)
  vendorProfile: {
    businessName: String,
    businessType: {
      type: String,
      enum: ['individual', 'business', 'nonprofit']
    },
    taxId: String,
    businessLicense: String,
    businessAddress: {
      street: String,
      city: String,
      state: String,
      country: String,
      zipCode: String
    },
    bankAccount: {
      accountNumber: String,
      routingNumber: String,
      bankName: String,
      accountHolderName: String
    },
    commissionRate: {
      type: Number,
      default: 0.10
    },
    totalEarnings: {
      type: Number,
      default: 0
    },
    availableBalance: {
      type: Number,
      default: 0
    },
    productsCount: {
      type: Number,
      default: 0
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    reviewCount: {
      type: Number,
      default: 0
    },
    isVerified: {
      type: Boolean,
      default: false
    },
    verificationDocuments: [{
      type: {
        type: String,
        enum: ['id', 'business_license', 'tax_document', 'bank_statement']
      },
      filename: String,
      url: String,
      uploadedAt: {
        type: Date,
        default: Date.now
      },
      status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
      }
    }]
  },
  
  // Activity Tracking
  lastLogin: {
    type: Date,
    default: Date.now
  },
  loginCount: {
    type: Number,
    default: 0
  },
  lastActive: {
    type: Date,
    default: Date.now
  },
  deviceInfo: [{
    deviceId: String,
    deviceType: String,
    browser: String,
    ipAddress: String,
    location: String,
    lastSeen: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Security
  security: {
    twoFactorEnabled: {
      type: Boolean,
      default: false
    },
    twoFactorSecret: String,
    passwordChangedAt: Date,
    failedLoginAttempts: {
      type: Number,
      default: 0
    },
    lockedUntil: Date,
    securityQuestions: [{
      question: String,
      answer: String
    }]
  },
  
  // Referral System
  referral: {
    code: String,
    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    referredUsers: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    totalReferrals: {
      type: Number,
      default: 0
    },
    referralEarnings: {
      type: Number,
      default: 0
    }
  },
  
  // Subscription/Membership
  subscription: {
    type: {
      type: String,
      enum: ['free', 'premium', 'vip'],
      default: 'free'
    },
    startDate: Date,
    endDate: Date,
    autoRenew: {
      type: Boolean,
      default: false
    },
    benefits: [String]
  },
  
  // Admin Notes
  adminNotes: [{
    note: String,
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    addedAt: {
      type: Date,
      default: Date.now
    },
    type: {
      type: String,
      enum: ['warning', 'suspension', 'note', 'complaint']
    }
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ 'addresses.zipCode': 1 });
userSchema.index({ role: 1, status: 1 });
userSchema.index({ 'shopping.favoriteCategories': 1 });
userSchema.index({ 'shopping.wishList.product': 1 });
userSchema.index({ createdAt: -1 });

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual for age
userSchema.virtual('age').get(function() {
  if (!this.profile.dateOfBirth) return null;
  const today = new Date();
  const birthDate = new Date(this.profile.dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  
  return age;
});

// Virtual for account status
userSchema.virtual('accountStatus').get(function() {
  if (this.security.lockedUntil && this.security.lockedUntil > new Date()) {
    return 'locked';
  }
  return this.status;
});

// Instance methods
userSchema.methods = {
  // Generate JWT token
  generateAuthToken: function() {
    return jwt.sign(
      { id: this._id, email: this.email, role: this.role },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRE }
    );
  },
  
  // Generate refresh token
  generateRefreshToken: function() {
    return jwt.sign(
      { id: this._id },
      config.JWT_REFRESH_SECRET,
      { expiresIn: config.JWT_REFRESH_EXPIRE }
    );
  },
  
  // Compare password
  comparePassword: async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
  },
  
  // Generate password reset token
  generatePasswordResetToken: function() {
    const resetToken = crypto.randomBytes(32).toString('hex');
    
    this.passwordResetToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
      
    this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    
    return resetToken;
  },
  
  // Generate email verification token
  generateEmailVerificationToken: function() {
    const verificationToken = crypto.randomBytes(32).toString('hex');
    
    this.emailVerificationToken = crypto
      .createHash('sha256')
      .update(verificationToken)
      .digest('hex');
      
    this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    
    return verificationToken;
  },
  
  // Check if account is locked
  isLocked: function() {
    return !!(this.security.lockedUntil && this.security.lockedUntil > Date.now());
  },
  
  // Increment login attempts
  incrementLoginAttempts: function() {
    if (this.security.lockedUntil && this.security.lockedUntil < Date.now()) {
      return this.updateOne({
        $unset: { 'security.lockedUntil': 1 },
        $set: { 'security.failedLoginAttempts': 1 }
      });
    }
    
    const updates = { $inc: { 'security.failedLoginAttempts': 1 } };
    
    if (this.security.failedLoginAttempts + 1 >= 5 && !this.security.lockedUntil) {
      updates.$set = { 'security.lockedUntil': Date.now() + 2 * 60 * 60 * 1000 }; // 2 hours
    }
    
    return this.updateOne(updates);
  },
  
  // Reset login attempts
  resetLoginAttempts: function() {
    return this.updateOne({
      $unset: { 'security.lockedUntil': 1 },
      $set: { 'security.failedLoginAttempts': 0 }
    });
  },
  
  // Update last login
  updateLastLogin: function() {
    return this.updateOne({
      $set: { 
        lastLogin: new Date(),
        lastActive: new Date()
      },
      $inc: { loginCount: 1 }
    });
  },
  
  // Add to wishlist
  addToWishlist: function(productId) {
    const existingIndex = this.shopping.wishList.findIndex(
      item => item.product.toString() === productId.toString()
    );
    
    if (existingIndex === -1) {
      this.shopping.wishList.push({
        product: productId,
        addedAt: new Date()
      });
      return this.save();
    }
    
    return Promise.resolve(this);
  },
  
  // Remove from wishlist
  removeFromWishlist: function(productId) {
    this.shopping.wishList = this.shopping.wishList.filter(
      item => item.product.toString() !== productId.toString()
    );
    return this.save();
  },
  
  // Add recently viewed product
  addRecentlyViewed: function(productId) {
    const existingIndex = this.shopping.recentlyViewed.findIndex(
      item => item.product.toString() === productId.toString()
    );
    
    if (existingIndex !== -1) {
      this.shopping.recentlyViewed[existingIndex].viewedAt = new Date();
    } else {
      this.shopping.recentlyViewed.unshift({
        product: productId,
        viewedAt: new Date()
      });
      
      // Keep only last 50 items
      if (this.shopping.recentlyViewed.length > 50) {
        this.shopping.recentlyViewed = this.shopping.recentlyViewed.slice(0, 50);
      }
    }
    
    return this.save();
  },
  
  // Calculate total spent
  calculateTotalSpent: function() {
    return this.model('Order')
      .aggregate([
        { $match: { user: this._id, status: 'delivered' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ])
      .then(result => result[0]?.total || 0);
  },
  
  // Get user statistics
  getStatistics: function() {
    return {
      totalOrders: this.shopping.totalOrders,
      totalSpent: this.shopping.totalSpent,
      wishlistCount: this.shopping.wishList.length,
      favoriteCategoriesCount: this.shopping.favoriteCategories.length,
      favoriteVendorsCount: this.shopping.favoriteVendors.length,
      accountAge: Math.floor((Date.now() - this.createdAt) / (1000 * 60 * 60 * 24)), // days
      lastActiveDays: Math.floor((Date.now() - this.lastActive) / (1000 * 60 * 60 * 24))
    };
  }
};

// Static methods
userSchema.statics = {
  // Find user by email or phone
  findByEmailOrPhone: function(identifier) {
    return this.findOne({
      $or: [
        { email: identifier.toLowerCase() },
        { phone: identifier }
      ]
    });
  },
  
  // Find users by role
  findByRole: function(role) {
    return this.find({ role });
  },
  
  // Get user statistics
  getUserStats: function() {
    return this.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
          },
          verified: {
            $sum: { $cond: [{ $eq: ['$emailVerified', true] }, 1, 0] }
          }
        }
      }
    ]);
  },
  
  // Find active users
  findActiveUsers: function() {
    return this.find({ status: 'active' });
  },
  
  // Find users needing verification reminder
  findUsersNeedingVerification: function() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return this.find({
      emailVerified: false,
      createdAt: { $lte: sevenDaysAgo }
    });
  }
};

// Pre-save middleware
userSchema.pre('save', async function(next) {
  // Hash password if modified
  if (this.isModified('password')) {
    const salt = await bcrypt.genSalt(config.BCRYPT_ROUNDS);
    this.password = await bcrypt.hash(this.password, salt);
    this.security.passwordChangedAt = Date.now() - 1000;
  }
  
  // Generate referral code if not exists
  if (!this.referral.code && this.isNew) {
    this.referral.code = `REF${this._id.toString().slice(-8).toUpperCase()}`;
  }
  
  // Set default address
  if (this.addresses.length > 0 && !this.addresses.some(addr => addr.isDefault)) {
    this.addresses[0].isDefault = true;
  }
  
  next();
});

// Post-save middleware
userSchema.post('save', function(error, doc, next) {
  if (error.name === 'MongoError' && error.code === 11000) {
    next(new Error('Email already exists'));
  } else {
    next(error);
  }
});

module.exports = mongoose.model('User', userSchema);
