const mongoose = require('mongoose');
const slugify = require('slugify');
const { v4: uuidv4 } = require('uuid');

const categorySchema = new mongoose.Schema({
  // Basic Category Information
  name: {
    type: String,
    required: [true, 'Category name is required'],
    trim: true,
    maxlength: [100, 'Category name cannot exceed 100 characters'],
    minlength: [2, 'Category name must be at least 2 characters']
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true
  },
  description: {
    type: String,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  shortDescription: {
    type: String,
    maxlength: [200, 'Short description cannot exceed 200 characters']
  },

  // Visual Assets
  icon: {
    type: String,
    validate: {
      validator: function(v) {
        // Basic URL validation for icon
        return !v || /^https?:\/\/.+/.test(v);
      },
      message: 'Icon must be a valid URL'
    }
  },
  image: {
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
  color: {
    type: String,
    default: '#3498db',
    validate: {
      validator: function(v) {
        return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(v);
      },
      message: 'Color must be a valid hex color code'
    }
  },

  // Hierarchical Structure
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null
  },
  children: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  }],
  ancestors: [{
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category'
    },
    name: String,
    slug: String,
    level: Number
  }],

  // Category Level and Position
  level: {
    type: Number,
    default: 0,
    min: 0,
    max: 5 // Maximum 5 levels deep
  },
  position: {
    type: Number,
    default: 0
  },
  isRoot: {
    type: Boolean,
    default: false
  },

  // Category Type and Purpose
  type: {
    type: String,
    enum: ['product', 'service', 'digital', 'physical', 'marketplace'],
    default: 'product'
  },
  purpose: {
    type: String,
    enum: ['selling', 'browsing', 'information', 'navigation'],
    default: 'selling'
  },

  // Vendor and Store Restrictions
  allowedVendors: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  restrictedVendors: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  vendorRequirements: {
    minimumRating: {
      type: Number,
      min: 0,
      max: 5,
      default: 0
    },
    minimumSales: {
      type: Number,
      default: 0
    },
    verificationRequired: {
      type: Boolean,
      default: false
    },
    subscriptionRequired: {
      type: Boolean,
      default: false
    }
  },

  // Product Restrictions and Rules
  productRestrictions: {
    minPrice: {
      type: Number,
      min: 0
    },
    maxPrice: {
      type: Number,
      min: 0
    },
    allowedBrands: [String],
    restrictedBrands: [String],
    requiredAttributes: [String],
    forbiddenAttributes: [String],
    maxProductsPerVendor: {
      type: Number,
      min: 1
    }
  },

  // Display and UI Settings
  displaySettings: {
    showInMenu: {
      type: Boolean,
      default: true
    },
    showInSearch: {
      type: Boolean,
      default: true
    },
    showProductCount: {
      type: Boolean,
      default: true
    },
    showSubcategories: {
      type: Boolean,
      default: true
    },
    sortOrder: {
      type: String,
      enum: ['name', 'position', 'product_count', 'created_at'],
      default: 'position'
    },
    defaultView: {
      type: String,
      enum: ['grid', 'list', 'masonry'],
      default: 'grid'
    }
  },

  // SEO and Marketing
  seo: {
    metaTitle: String,
    metaDescription: String,
    keywords: [String],
    canonicalUrl: String,
    ogImage: String,
    ogTitle: String,
    ogDescription: String
  },
  searchKeywords: [String],
  featured: {
    type: Boolean,
    default: false
  },

  // Analytics and Performance
  stats: {
    productCount: {
      type: Number,
      default: 0
    },
    activeProductCount: {
      type: Number,
      default: 0
    },
    vendorCount: {
      type: Number,
      default: 0
    },
    viewCount: {
      type: Number,
      default: 0
    },
    clickCount: {
      type: Number,
      default: 0
    },
    conversionRate: {
      type: Number,
      default: 0
    },
    lastCalculated: Date
  },

  // Category Status and Visibility
  status: {
    type: String,
    enum: ['active', 'inactive', 'hidden', 'archived', 'pending'],
    default: 'active'
  },
  visibility: {
    type: String,
    enum: ['public', 'private', 'restricted'],
    default: 'public'
  },

  // Content and Rich Media
  content: {
    overview: String,
    features: [String],
    benefits: [String],
    specifications: mongoose.Schema.Types.Mixed,
    faqs: [{
      question: String,
      answer: String
    }],
    guides: [{
      title: String,
      content: String,
      type: {
        type: String,
        enum: ['text', 'video', 'image'],
        default: 'text'
      },
      media: String
    }]
  },

  // Category Relationships
  relatedCategories: [{
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category'
    },
    type: {
      type: String,
      enum: ['related', 'accessory', 'complementary', 'alternative'],
      default: 'related'
    },
    strength: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.5
    }
  }],

  // Promotions and Campaigns
  promotions: [{
    title: String,
    description: String,
    type: {
      type: String,
      enum: ['discount', 'featured', 'seasonal', 'clearance'],
      default: 'discount'
    },
    discount: {
      percentage: Number,
      fixedAmount: Number
    },
    startDate: Date,
    endDate: Date,
    isActive: {
      type: Boolean,
      default: false
    },
    banner: String
  }],

  // Geographic and Localization
  availableCountries: [String],
  restrictedCountries: [String],
  localizedNames: [{
    language: {
      type: String,
      required: true
    },
    name: {
      type: String,
      required: true
    },
    description: String
  }],

  // Business Rules
  businessRules: {
    commissionRate: {
      type: Number,
      min: 0,
      max: 100,
      default: 10
    },
    shippingRules: {
      freeShippingThreshold: Number,
      standardShippingDays: Number,
      expressShippingDays: Number
    },
    returnPolicy: {
      days: {
        type: Number,
        default: 30
      },
      conditions: [String]
    }
  },

  // Tags and Labels
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  labels: [{
    name: String,
    color: String,
    type: {
      type: String,
      enum: ['new', 'sale', 'featured', 'trending', 'limited', 'custom'],
      default: 'custom'
    }
  }],

  // Category Management
  managedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: Date,

  // Audit and History
  history: [{
    action: {
      type: String,
      enum: ['created', 'updated', 'approved', 'rejected', 'activated', 'deactivated'],
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
categorySchema.index({ name: 'text', description: 'text' });
categorySchema.index({ slug: 1 });
categorySchema.index({ parent: 1 });
categorySchema.index({ level: 1 });
categorySchema.index({ position: 1 });
categorySchema.index({ status: 1 });
categorySchema.index({ featured: 1 });
categorySchema.index({ type: 1 });
categorySchema.index({ tags: 1 });
categorySchema.index({ 'stats.productCount': -1 });
categorySchema.index({ createdAt: -1 });

// Virtual for full path
categorySchema.virtual('fullPath').get(function() {
  if (!this.ancestors || this.ancestors.length === 0) {
    return this.name;
  }

  const path = this.ancestors.map(ancestor => ancestor.name).join(' > ');
  return `${path} > ${this.name}`;
});

// Virtual for subcategory count
categorySchema.virtual('subcategoryCount').get(function() {
  return this.children ? this.children.length : 0;
});

// Virtual for depth in hierarchy
categorySchema.virtual('depth').get(function() {
  return this.ancestors ? this.ancestors.length : 0;
});

// Pre-save middleware
categorySchema.pre('save', function(next) {
  // Generate slug if not exists
  if (this.isModified('name') && !this.slug) {
    this.slug = slugify(this.name, {
      lower: true,
      strict: true,
      remove: /[*+~.()'"!:@]/g
    }) + '-' + uuidv4().substring(0, 6);
  }

  // Update level based on parent
  if (this.isModified('parent')) {
    if (this.parent) {
      // This is a subcategory
      this.level = 1;
      this.isRoot = false;
    } else {
      // This is a root category
      this.level = 0;
      this.isRoot = true;
    }
  }

  // Calculate search keywords
  if (this.isModified('name') || this.isModified('description')) {
    const keywords = [
      this.name,
      this.description,
      ...this.tags
    ].filter(Boolean);

    this.searchKeywords = [...new Set(keywords.map(k => k.toLowerCase()))];
  }

  next();
});

// Instance methods
categorySchema.methods = {
  // Get full category hierarchy
  async getHierarchy() {
    const hierarchy = [];
    let currentCategory = this;

    while (currentCategory) {
      hierarchy.unshift({
        _id: currentCategory._id,
        name: currentCategory.name,
        slug: currentCategory.slug,
        level: currentCategory.level
      });

      if (currentCategory.parent) {
        currentCategory = await mongoose.model('Category').findById(currentCategory.parent);
      } else {
        break;
      }
    }

    return hierarchy;
  },

  // Add subcategory
  async addSubcategory(subcategoryData) {
    const subcategory = new (mongoose.model('Category'))({
      ...subcategoryData,
      parent: this._id,
      level: this.level + 1
    });

    const savedSubcategory = await subcategory.save();

    // Update this category's children array
    await this.updateOne({
      $push: { children: savedSubcategory._id }
    });

    // Update ancestors for the subcategory
    const ancestors = await this.getHierarchy();
    await savedSubcategory.updateOne({
      ancestors: ancestors.slice(0, -1) // Exclude self
    });

    return savedSubcategory;
  },

  // Remove subcategory
  async removeSubcategory(subcategoryId) {
    const subcategory = await mongoose.model('Category').findById(subcategoryId);
    if (!subcategory || !subcategory.parent.equals(this._id)) {
      throw new Error('Subcategory not found or not a child of this category');
    }

    // Remove from children array
    await this.updateOne({
      $pull: { children: subcategoryId }
    });

    // Archive the subcategory instead of deleting
    await subcategory.updateOne({
      status: 'archived',
      parent: null
    });

    return true;
  },

  // Get all products in this category
  async getProducts(options = {}) {
    const {
      limit = 20,
      skip = 0,
      sortBy = 'createdAt',
      includeSubcategories = true
    } = options;

    let query = { category: this._id, status: 'published', isDeleted: false };

    if (includeSubcategories && this.children && this.children.length > 0) {
      const subcategoryIds = await this.getAllSubcategoryIds();
      query = {
        $or: [
          { category: this._id },
          { category: { $in: subcategoryIds } }
        ],
        status: 'published',
        isDeleted: false
      };
    }

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
      default:
        sort = { createdAt: -1 };
    }

    return mongoose.model('Product').find(query)
      .populate('vendor', 'firstName lastName')
      .sort(sort)
      .limit(limit)
      .skip(skip);
  },

  // Get all subcategory IDs recursively
  async getAllSubcategoryIds() {
    const subcategoryIds = [this._id];

    const getChildren = async (parentId) => {
      const children = await mongoose.model('Category').find({
        parent: parentId,
        status: 'active',
        isDeleted: false
      }).select('_id');

      for (const child of children) {
        subcategoryIds.push(child._id);
        await getChildren(child._id);
      }
    };

    if (this.children && this.children.length > 0) {
      for (const childId of this.children) {
        await getChildren(childId);
      }
    }

    return subcategoryIds;
  },

  // Update category statistics
  async updateStats() {
    const productStats = await mongoose.model('Product').aggregate([
      {
        $match: {
          category: this._id,
          status: 'published',
          isDeleted: false
        }
      },
      {
        $group: {
          _id: null,
          productCount: { $sum: 1 },
          activeProductCount: {
            $sum: {
              $cond: [
                { $eq: ['$inventory.stockStatus', 'in_stock'] },
                1,
                0
              ]
            }
          },
          avgPrice: { $avg: '$price' },
          totalViews: { $sum: '$stats.views' }
        }
      }
    ]);

    const vendorStats = await mongoose.model('Product').distinct('vendor', {
      category: this._id,
      status: 'published',
      isDeleted: false
    });

    const stats = productStats[0] || {
      productCount: 0,
      activeProductCount: 0,
      avgPrice: 0,
      totalViews: 0
    };

    await this.updateOne({
      stats: {
        productCount: stats.productCount,
        activeProductCount: stats.activeProductCount,
        vendorCount: vendorStats.length,
        viewCount: stats.totalViews,
        avgPrice: Math.round(stats.avgPrice * 100) / 100,
        lastCalculated: new Date()
      }
    });
  },

  // Move category to new parent
  async moveToParent(newParentId) {
    const newParent = await mongoose.model('Category').findById(newParentId);
    if (!newParent) {
      throw new Error('New parent category not found');
    }

    if (newParent._id.equals(this._id)) {
      throw new Error('Cannot move category to itself');
    }

    // Check for circular reference
    const newParentHierarchy = await newParent.getHierarchy();
    if (newParentHierarchy.some(cat => cat._id.equals(this._id))) {
      throw new Error('Cannot move category to its own subcategory');
    }

    const oldParentId = this.parent;
    const oldLevel = this.level;

    // Update this category
    this.parent = newParentId;
    this.level = newParent.level + 1;
    this.ancestors = await newParent.getHierarchy();

    await this.save();

    // Update old parent's children array
    if (oldParentId) {
      await mongoose.model('Category').findByIdAndUpdate(oldParentId, {
        $pull: { children: this._id }
      });
    }

    // Update new parent's children array
    await newParent.updateOne({
      $push: { children: this._id }
    });

    // Update all descendants
    await this.updateDescendantsHierarchy();

    return this;
  },

  // Update descendants hierarchy
  async updateDescendantsHierarchy() {
    const updateDescendants = async (parentId, ancestors) => {
      const children = await mongoose.model('Category').find({
        parent: parentId,
        isDeleted: false
      });

      for (const child of children) {
        child.ancestors = [...ancestors];
        child.level = ancestors.length;
        await child.save();

        await updateDescendants(child._id, [...ancestors, {
          _id: child._id,
          name: child.name,
          slug: child.slug,
          level: child.level
        }]);
      }
    };

    const currentAncestors = await this.getHierarchy();
    await updateDescendants(this._id, currentAncestors.slice(0, -1));
  },

  // Archive category and all subcategories
  async archive() {
    await this.updateOne({
      status: 'archived'
    });

    // Archive all subcategories
    const children = await mongoose.model('Category').find({
      parent: this._id,
      isDeleted: false
    });

    for (const child of children) {
      await child.archive();
    }
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

  // Get category performance metrics
  async getPerformanceMetrics(days = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const metrics = await mongoose.model('Product').aggregate([
      {
        $match: {
          category: this._id,
          status: 'published',
          isDeleted: false,
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          totalViews: { $sum: '$stats.views' },
          totalSales: { $sum: '$stats.salesCount' },
          totalRevenue: { $sum: '$stats.revenue' },
          avgRating: { $avg: '$rating.average' },
          uniqueVendors: { $addToSet: '$vendor' }
        }
      }
    ]);

    return metrics[0] || {
      totalProducts: 0,
      totalViews: 0,
      totalSales: 0,
      totalRevenue: 0,
      avgRating: 0,
      uniqueVendors: []
    };
  }
};

// Static methods
categorySchema.statics = {
  // Get root categories
  async getRootCategories() {
    return this.find({
      parent: null,
      status: 'active',
      isDeleted: false
    })
    .sort({ position: 1, name: 1 })
    .populate('children', 'name slug icon');
  },

  // Get category tree
  async getCategoryTree() {
    const rootCategories = await this.getRootCategories();

    const buildTree = async (categories) => {
      const tree = [];

      for (const category of categories) {
        const subcategories = await this.find({
          parent: category._id,
          status: 'active',
          isDeleted: false
        }).sort({ position: 1 });

        const categoryWithChildren = {
          ...category.toObject(),
          children: subcategories.length > 0 ? await buildTree(subcategories) : []
        };

        tree.push(categoryWithChildren);
      }

      return tree;
    };

    return buildTree(rootCategories);
  },

  // Search categories
  async search(searchTerm, options = {}) {
    const { includeInactive = false } = options;

    let query = {
      $or: [
        { name: { $regex: searchTerm, $options: 'i' } },
        { description: { $regex: searchTerm, $options: 'i' } },
        { tags: { $in: [new RegExp(searchTerm, 'i')] } },
        { searchKeywords: { $in: [searchTerm.toLowerCase()] } }
      ]
    };

    if (!includeInactive) {
      query.status = 'active';
    }
    query.isDeleted = false;

    return this.find(query)
      .populate('parent', 'name slug')
      .sort({ level: 1, position: 1, name: 1 });
  },

  // Get categories by type
  async getByType(type) {
    return this.find({
      type,
      status: 'active',
      isDeleted: false
    }).sort({ name: 1 });
  },

  // Get featured categories
  async getFeaturedCategories(limit = 10) {
    return this.find({
      featured: true,
      status: 'active',
      isDeleted: false
    })
    .sort({ 'stats.productCount': -1 })
    .limit(limit);
  },

  // Get popular categories
  async getPopularCategories(limit = 10) {
    return this.find({
      status: 'active',
      isDeleted: false
    })
    .sort({ 'stats.viewCount': -1 })
    .limit(limit);
  },

  // Bulk update categories
  async bulkUpdate(categoryIds, updates) {
    return this.updateMany(
      { _id: { $in: categoryIds }, isDeleted: false },
      { $set: updates }
    );
  },

  // Rebuild category hierarchy
  async rebuildHierarchy() {
    const categories = await this.find({ isDeleted: false }).sort({ level: 1 });

    for (const category of categories) {
      if (category.parent) {
        const parent = await this.findById(category.parent);
        if (parent) {
          category.ancestors = await parent.getHierarchy();
          category.level = parent.level + 1;
          await category.save();
        }
      }
    }

    return true;
  },

  // Get category statistics
  async getCategoryStats() {
    const stats = await this.aggregate([
      {
        $match: { isDeleted: false }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          avgLevel: { $avg: '$level' },
          totalProducts: { $sum: '$stats.productCount' },
          totalViews: { $sum: '$stats.viewCount' }
        }
      }
    ]);

    return stats;
  },

  // Clean up orphaned categories
  async cleanupOrphaned() {
    const categories = await this.find({
      isDeleted: false,
      status: { $ne: 'active' }
    });

    let cleanedCount = 0;

    for (const category of categories) {
      const hasActiveProducts = await mongoose.model('Product').exists({
        category: category._id,
        status: 'published',
        isDeleted: false
      });

      if (!hasActiveProducts && category.children.length === 0) {
        await category.updateOne({
          isDeleted: true,
          deletedAt: new Date()
        });
        cleanedCount++;
      }
    }

    return cleanedCount;
  }
};

module.exports = mongoose.model('Category', categorySchema);
