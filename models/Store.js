const mongoose = require('mongoose');
const slugify = require('slugify');
const { v4: uuidv4 } = require('uuid');

const storeSchema = new mongoose.Schema({
  // Basic Store Information
  name: {
    type: String,
    required: [true, 'Store name is required'],
    trim: true,
    maxlength: [100, 'Store name cannot exceed 100 characters'],
    minlength: [3, 'Store name must be at least 3 characters']
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true
  },
  description: {
    type: String,
    required: [true, 'Store description is required'],
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  tagline: {
    type: String,
    maxlength: [200, 'Tagline cannot exceed 200 characters']
  },

  // Store Owner/Manager
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Store owner is required']
  },
  managers: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    role: {
      type: String,
      enum: ['admin', 'manager', 'editor', 'viewer'],
      default: 'manager'
    },
    permissions: [String],
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],

  // Store Branding and Visual Identity
  branding: {
    logo: {
      url: String,
      public_id: String,
      thumbnail: String,
      alt: String
    },
    banner: {
      url: String,
      public_id: String,
      alt: String
    },
    favicon: String,
    primaryColor: {
      type: String,
      default: '#3498db',
      validate: {
        validator: function(v) {
          return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(v);
        },
        message: 'Primary color must be a valid hex color code'
      }
    },
    secondaryColor: String,
    theme: {
      type: String,
      enum: ['light', 'dark', 'modern', 'classic', 'minimalist'],
      default: 'modern'
    }
  },

  // Store Contact Information
  contact: {
    email: {
      type: String,
      required: [true, 'Contact email is required'],
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
    whatsapp: String,
    website: {
      type: String,
      validate: [validator.isURL, 'Please provide a valid URL']
    },
    socialMedia: {
      facebook: String,
      twitter: String,
      instagram: String,
      linkedin: String,
      youtube: String,
      tiktok: String
    }
  },

  // Store Location and Address
  address: {
    street: String,
    city: String,
    state: String,
    country: {
      type: String,
      default: 'US'
    },
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

  // Business Information
  businessInfo: {
    businessType: {
      type: String,
      enum: ['individual', 'partnership', 'llc', 'corporation', 'nonprofit'],
      required: [true, 'Business type is required']
    },
    businessRegistration: String,
    taxId: String,
    industry: String,
    yearEstablished: Number,
    businessLicense: String,
    certifications: [String],
    insurance: {
      provider: String,
      policyNumber: String,
      coverage: String
    }
  },

  // Store Status and Verification
  status: {
    type: String,
    enum: ['pending', 'active', 'suspended', 'inactive', 'rejected', 'under_review'],
    default: 'pending'
  },
  verificationStatus: {
    type: String,
    enum: ['unverified', 'pending', 'verified', 'rejected'],
    default: 'unverified'
  },
  verificationDocuments: [{
    type: {
      type: String,
      enum: ['business_license', 'tax_id', 'identity', 'address_proof', 'bank_statement'],
      required: true
    },
    url: {
      type: String,
      required: true
    },
    public_id: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    },
    verifiedAt: Date,
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    rejectionReason: String
  }],

  // Store Settings and Configuration
  settings: {
    currency: {
      type: String,
      default: 'USD',
      enum: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY', 'INR']
    },
    language: {
      type: String,
      default: 'en',
      enum: ['en', 'es', 'fr', 'de', 'zh', 'ja', 'ar', 'pt', 'ru', 'hi']
    },
    timezone: {
      type: String,
      default: 'UTC'
    },
    autoPublishProducts: {
      type: Boolean,
      default: false
    },
    requireApproval: {
      type: Boolean,
      default: true
    },
    allowGuestCheckout: {
      type: Boolean,
      default: true
    },
    minimumOrderAmount: {
      type: Number,
      default: 0,
      min: 0
    }
  },

  // Store Policies
  policies: {
    returnPolicy: {
      days: {
        type: Number,
        default: 30,
        min: 0
      },
      conditions: [String],
      exceptions: [String]
    },
    shippingPolicy: {
      processingTime: {
        type: Number,
        default: 1,
        min: 0
      }, // days
      shippingMethods: [{
        name: String,
        cost: Number,
        estimatedDays: Number,
        description: String
      }]
    },
    privacyPolicy: String,
    termsOfService: String
  },

  // Financial Information
  financial: {
    bankAccount: {
      accountNumber: String,
      routingNumber: String,
      accountHolderName: String,
      bankName: String,
      accountType: {
        type: String,
        enum: ['checking', 'savings']
      }
    },
    payoutSettings: {
      method: {
        type: String,
        enum: ['bank_transfer', 'paypal', 'stripe', 'check'],
        default: 'bank_transfer'
      },
      frequency: {
        type: String,
        enum: ['daily', 'weekly', 'monthly'],
        default: 'weekly'
      },
      minimumAmount: {
        type: Number,
        default: 10,
        min: 1
      }
    },
    taxSettings: {
      collectTax: {
        type: Boolean,
        default: false
      },
      taxRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
      },
      taxId: String
    }
  },

  // Store Analytics and Performance
  analytics: {
    totalSales: {
      type: Number,
      default: 0
    },
    totalOrders: {
      type: Number,
      default: 0
    },
    totalProducts: {
      type: Number,
      default: 0
    },
    averageOrderValue: {
      type: Number,
      default: 0
    },
    conversionRate: {
      type: Number,
      default: 0
    },
    customerCount: {
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
    lastCalculated: Date
  },

  // Store Features and Capabilities
  features: {
    customDomain: String,
    customTheme: {
      type: Boolean,
      default: false
    },
    advancedAnalytics: {
      type: Boolean,
      default: false
    },
    marketingTools: {
      type: Boolean,
      default: false
    },
    inventoryManagement: {
      type: Boolean,
      default: true
    },
    orderManagement: {
      type: Boolean,
      default: true
    },
    customerSupport: {
      type: Boolean,
      default: false
    },
    multiLanguage: {
      type: Boolean,
      default: false
    },
    abandonedCartRecovery: {
      type: Boolean,
      default: false
    }
  },

  // Subscription and Billing
  subscription: {
    plan: {
      type: String,
      enum: ['free', 'basic', 'professional', 'enterprise'],
      default: 'free'
    },
    status: {
      type: String,
      enum: ['active', 'past_due', 'canceled', 'unpaid'],
      default: 'active'
    },
    currentPeriodStart: Date,
    currentPeriodEnd: Date,
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false
    },
    trialEndsAt: Date
  },

  // Store Categories and Specializations
  categories: [{
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category'
    },
    isPrimary: {
      type: Boolean,
      default: false
    },
    commissionRate: {
      type: Number,
      default: 10,
      min: 0,
      max: 100
    }
  }],
  specializations: [String],
  keywords: [String],

  // Store Hours and Availability
  businessHours: {
    monday: { open: String, close: String, closed: { type: Boolean, default: false } },
    tuesday: { open: String, close: String, closed: { type: Boolean, default: false } },
    wednesday: { open: String, close: String, closed: { type: Boolean, default: false } },
    thursday: { open: String, close: String, closed: { type: Boolean, default: false } },
    friday: { open: String, close: String, closed: { type: Boolean, default: false } },
    saturday: { open: String, close: String, closed: { type: Boolean, default: false } },
    sunday: { open: String, close: String, closed: { type: Boolean, default: false } },
    timezone: String
  },

  // Store History and Audit
  history: [{
    action: {
      type: String,
      enum: ['created', 'updated', 'verified', 'suspended', 'activated', 'rejected'],
      required: true
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    details: mongoose.Schema.Types.Mixed,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],

  // SEO and Marketing
  seo: {
    metaTitle: String,
    metaDescription: String,
    keywords: [String],
    canonicalUrl: String
  },

  // Custom Fields
  customFields: [{
    name: String,
    value: mongoose.Schema.Types.Mixed,
    type: String,
    required: Boolean
  }],

  // Timestamps
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
storeSchema.index({ name: 'text', description: 'text' });
storeSchema.index({ slug: 1 });
storeSchema.index({ owner: 1 });
storeSchema.index({ status: 1 });
storeSchema.index({ verificationStatus: 1 });
storeSchema.index({ 'contact.email': 1 });
storeSchema.index({ 'address.coordinates': '2dsphere' });
storeSchema.index({ 'categories.category': 1 });
storeSchema.index({ 'analytics.totalSales': -1 });
storeSchema.index({ 'analytics.rating': -1 });
storeSchema.index({ createdAt: -1 });

// Compound indexes
storeSchema.index({ status: 1, verificationStatus: 1 });
storeSchema.index({ owner: 1, status: 1 });
storeSchema.index({ 'subscription.plan': 1, 'subscription.status': 1 });

// Virtual for store URL
storeSchema.virtual('storeUrl').get(function() {
  return `/stores/${this.slug}`;
});

// Virtual for is verified
storeSchema.virtual('isVerified').get(function() {
  return this.verificationStatus === 'verified';
});

// Virtual for subscription status
storeSchema.virtual('isActive').get(function() {
  return this.status === 'active' && this.subscription.status === 'active';
});

// Pre-save middleware
storeSchema.pre('save', function(next) {
  // Generate slug if not exists
  if (this.isModified('name') && !this.slug) {
    this.slug = slugify(this.name, {
      lower: true,
      strict: true,
      remove: /[*+~.()'"!:@]/g
    }) + '-' + uuidv4().substring(0, 6);
  }

  // Update analytics last calculated
  if (this.isModified()) {
    this.analytics.lastCalculated = new Date();
  }

  next();
});

// Instance methods
storeSchema.methods = {
  // Add manager to store
  async addManager(userId, role = 'manager', permissions = []) {
    const existingManager = this.managers.find(m => m.user.equals(userId));
    if (existingManager) {
      throw new Error('User is already a manager of this store');
    }

    await this.updateOne({
      $push: {
        managers: {
          user: userId,
          role,
          permissions,
          addedAt: new Date()
        }
      }
    });

    return this;
  },

  // Remove manager from store
  async removeManager(userId) {
    await this.updateOne({
      $pull: {
        managers: { user: userId }
      }
    });

    return this;
  },

  // Update manager permissions
  async updateManagerPermissions(userId, permissions) {
    await this.updateOne(
      { 'managers.user': userId },
      { $set: { 'managers.$.permissions': permissions } }
    );

    return this;
  },

  // Add product category
  async addCategory(categoryId, isPrimary = false, commissionRate = 10) {
    const existingCategory = this.categories.find(c => c.category.equals(categoryId));
    if (existingCategory) {
      throw new Error('Category already exists for this store');
    }

    // If this is primary, remove primary flag from others
    if (isPrimary) {
      await this.updateOne(
        { 'categories.isPrimary': true },
        { $set: { 'categories.$.isPrimary': false } }
      );
    }

    await this.updateOne({
      $push: {
        categories: {
          category: categoryId,
          isPrimary,
          commissionRate
        }
      }
    });

    return this;
  },

  // Update store analytics
  async updateAnalytics() {
    const productStats = await mongoose.model('Product').aggregate([
      {
        $match: {
          store: this._id,
          status: 'published',
          isDeleted: false
        }
      },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          activeProducts: {
            $sum: {
              $cond: [
                { $eq: ['$inventory.stockStatus', 'in_stock'] },
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    const orderStats = await mongoose.model('Order').aggregate([
      {
        $match: {
          'vendor.store': this._id,
          status: { $in: ['delivered', 'completed'] }
        }
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalSales: { $sum: '$totalAmount' },
          averageOrderValue: { $avg: '$totalAmount' }
        }
      }
    ]);

    const customerStats = await mongoose.model('Order').distinct('user', {
      'vendor.store': this._id,
      status: { $in: ['delivered', 'completed'] }
    });

    const reviewStats = await mongoose.model('Review').aggregate([
      {
        $match: { store: this._id }
      },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 }
        }
      }
    ]);

    const stats = productStats[0] || { totalProducts: 0, activeProducts: 0 };
    const orderData = orderStats[0] || { totalOrders: 0, totalSales: 0, averageOrderValue: 0 };
    const reviewData = reviewStats[0] || { averageRating: 0, totalReviews: 0 };

    await this.updateOne({
      analytics: {
        totalProducts: stats.totalProducts,
        totalOrders: orderData.totalOrders,
        totalSales: orderData.totalSales,
        averageOrderValue: Math.round(orderData.averageOrderValue * 100) / 100,
        customerCount: customerStats.length,
        rating: Math.round(reviewData.averageRating * 10) / 10,
        reviewCount: reviewData.totalReviews,
        lastCalculated: new Date()
      }
    });

    return this;
  },

  // Submit for verification
  async submitForVerification() {
    if (this.verificationStatus === 'verified') {
      throw new Error('Store is already verified');
    }

    await this.updateOne({
      verificationStatus: 'pending',
      status: 'under_review'
    });

    // Add history entry
    await this.addHistoryEntry('verification_submitted', this.owner);

    return this;
  },

  // Verify store
  async verifyStore(verifiedBy, documents = []) {
    await this.updateOne({
      verificationStatus: 'verified',
      status: 'active',
      'verificationDocuments': documents
    });

    // Add history entry
    await this.addHistoryEntry('verified', verifiedBy, { documents: documents.length });

    return this;
  },

  // Suspend store
  async suspendStore(suspendedBy, reason) {
    await this.updateOne({
      status: 'suspended'
    });

    // Add history entry
    await this.addHistoryEntry('suspended', suspendedBy, { reason });

    return this;
  },

  // Reactivate store
  async reactivateStore(reactivatedBy) {
    await this.updateOne({
      status: 'active'
    });

    // Add history entry
    await this.addHistoryEntry('reactivated', reactivatedBy);

    return this;
  },

  // Add history entry
  async addHistoryEntry(action, performedBy, details = {}) {
    await this.updateOne({
      $push: {
        history: {
          action,
          performedBy,
          details,
          timestamp: new Date()
        }
      }
    });
  },

  // Get store products
  async getProducts(options = {}) {
    const {
      category,
      status = 'published',
      featured,
      limit = 20,
      skip = 0,
      sortBy = 'createdAt'
    } = options;

    let query = {
      store: this._id,
      status,
      isDeleted: false
    };

    if (category) query.category = category;
    if (featured !== undefined) query.featured = featured;

    let sort = {};
    switch (sortBy) {
      case 'price':
        sort = { price: 1 };
        break;
      case 'rating':
        sort = { 'rating.average': -1 };
        break;
      case 'popular':
        sort = { 'stats.views': -1 };
        break;
      case 'newest':
        sort = { createdAt: -1 };
        break;
      case 'bestselling':
        sort = { 'stats.salesCount': -1 };
        break;
      default:
        sort = { createdAt: -1 };
    }

    return mongoose.model('Product').find(query)
      .populate('category', 'name slug')
      .sort(sort)
      .limit(limit)
      .skip(skip);
  },

  // Get store orders
  async getOrders(options = {}) {
    const {
      status,
      startDate,
      endDate,
      limit = 20,
      skip = 0
    } = options;

    let query = { 'vendor.store': this._id };

    if (status) query.status = status;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = startDate;
      if (endDate) query.createdAt.$lte = endDate;
    }

    return mongoose.model('Order').find(query)
      .populate('user', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip);
  },

  // Get store reviews
  async getReviews(options = {}) {
    const { rating, limit = 20, skip = 0 } = options;

    let query = { store: this._id };

    if (rating) query.rating = rating;

    return mongoose.model('Review').find(query)
      .populate('user', 'firstName lastName')
      .populate('product', 'name slug')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip);
  },

  // Calculate commission for an order
  calculateCommission(orderAmount, categoryId = null) {
    let commissionRate = 10; // Default commission

    if (categoryId) {
      const category = this.categories.find(c => c.category.equals(categoryId));
      if (category && category.commissionRate) {
        commissionRate = category.commissionRate;
      }
    }

    return (orderAmount * commissionRate) / 100;
  },

  // Process payout
  async processPayout(amount, method = null) {
    const payoutMethod = method || this.financial.payoutSettings.method;

    // Here you would integrate with payment processors
    // For now, just record the payout

    await this.updateOne({
      $inc: { 'analytics.totalSales': -amount }
    });

    return {
      amount,
      method: payoutMethod,
      processedAt: new Date(),
      status: 'processed'
    };
  },

  // Get dashboard data
  async getDashboardData(dateRange = 30) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const [
      recentOrders,
      productStats,
      revenueData,
      topProducts
    ] = await Promise.all([
      this.getOrders({
        startDate,
        limit: 10
      }),
      mongoose.model('Product').find({
        store: this._id,
        status: 'published'
      }).countDocuments(),
      mongoose.model('Order').aggregate([
        {
          $match: {
            'vendor.store': this._id,
            status: { $in: ['delivered', 'completed'] },
            createdAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            revenue: { $sum: '$totalAmount' },
            orders: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      mongoose.model('Product').find({
        store: this._id,
        status: 'published'
      })
      .sort({ 'stats.salesCount': -1 })
      .limit(5)
      .select('name stats.salesCount')
    ]);

    return {
      recentOrders,
      productStats,
      revenueData,
      topProducts,
      analytics: this.analytics
    };
  }
};

// Static methods
storeSchema.statics = {
  // Find stores by owner
  async findByOwner(ownerId) {
    return this.find({ owner: ownerId, isDeleted: false })
      .sort({ createdAt: -1 });
  },

  // Get verified stores
  async getVerifiedStores(options = {}) {
    const { category, limit = 20, skip = 0, sortBy = 'rating' } = options;

    let query = {
      verificationStatus: 'verified',
      status: 'active',
      isDeleted: false
    };

    if (category) {
      query['categories.category'] = category;
    }

    let sort = {};
    switch (sortBy) {
      case 'newest':
        sort = { createdAt: -1 };
        break;
      case 'popular':
        sort = { 'analytics.totalSales': -1 };
        break;
      case 'rating':
      default:
        sort = { 'analytics.rating': -1 };
    }

    return this.find(query)
      .populate('owner', 'firstName lastName')
      .populate('categories.category', 'name slug')
      .sort(sort)
      .limit(limit)
      .skip(skip);
  },

  // Search stores
  async search(searchTerm, options = {}) {
    const { category, verified = true, limit = 20, skip = 0 } = options;

    let query = {
      $or: [
        { name: { $regex: searchTerm, $options: 'i' } },
        { description: { $regex: searchTerm, $options: 'i' } },
        { tagline: { $regex: searchTerm, $options: 'i' } },
        { keywords: { $in: [new RegExp(searchTerm, 'i')] } },
        { 'contact.email': { $regex: searchTerm, $options: 'i' } }
      ],
      isDeleted: false
    };

    if (verified) {
      query.verificationStatus = 'verified';
      query.status = 'active';
    }

    if (category) {
      query['categories.category'] = category;
    }

    return this.find(query)
      .populate('owner', 'firstName lastName')
      .populate('categories.category', 'name slug')
      .sort({ 'analytics.rating': -1 })
      .limit(limit)
      .skip(skip);
  },

  // Get store statistics
  async getStoreStats() {
    const stats = await this.aggregate([
      {
        $match: { isDeleted: false }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          verifiedCount: {
            $sum: { $cond: ['$verificationStatus', 1, 0] }
          },
          totalProducts: { $sum: '$analytics.totalProducts' },
          totalSales: { $sum: '$analytics.totalSales' },
          avgRating: { $avg: '$analytics.rating' }
        }
      }
    ]);

    return stats;
  },

  // Get top performing stores
  async getTopStores(limit = 10) {
    return this.find({
      verificationStatus: 'verified',
      status: 'active',
      isDeleted: false
    })
    .sort({ 'analytics.totalSales': -1 })
    .limit(limit)
    .populate('owner', 'firstName lastName');
  },

  // Update all store analytics
  async updateAllAnalytics() {
    const stores = await this.find({ isDeleted: false });

    for (const store of stores) {
      await store.updateAnalytics();
    }

    return stores.length;
  }
};

module.exports = mongoose.model('Store', storeSchema);
