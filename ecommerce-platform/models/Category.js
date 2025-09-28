const mongoose = require('mongoose');
const slugify = require('slugify');

const categorySchema = new mongoose.Schema({
  // Basic Information
  name: {
    type: String,
    required: [true, 'Category name is required'],
    trim: true,
    maxlength: [100, 'Category name cannot exceed 100 characters']
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
  
  // Hierarchy
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null
  },
  children: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  }],
  
  // Media
  image: {
    url: String,
    alt: String,
    metadata: {
      width: Number,
      height: Number,
      size: Number,
      format: String
    }
  },
  icon: {
    type: String,
    default: ''
  },
  
  // SEO
  seo: {
    metaTitle: {
      type: String,
      maxlength: [60, 'Meta title cannot exceed 60 characters']
    },
    metaDescription: {
      type: String,
      maxlength: [160, 'Meta description cannot exceed 160 characters']
    },
    metaKeywords: [String],
    canonicalUrl: String
  },
  
  // Status and Visibility
  status: {
    type: String,
    enum: ['active', 'inactive', 'hidden'],
    default: 'active'
  },
  visibility: {
    type: String,
    enum: ['public', 'private', 'featured'],
    default: 'public'
  },
  featured: {
    type: Boolean,
    default: false
  },
  
  // Statistics
  statistics: {
    productCount: {
      type: Number,
      default: 0
    },
    subcategoryCount: {
      type: Number,
      default: 0
    },
    totalViews: {
      type: Number,
      default: 0
    },
    totalClicks: {
      type: Number,
      default: 0
    }
  },
  
  // Category Attributes
  attributes: [{
    name: {
      type: String,
      required: true
    },
    type: {
      type: String,
      enum: ['text', 'number', 'boolean', 'select', 'multiselect'],
      default: 'text'
    },
    required: {
      type: Boolean,
      default: false
    },
    options: [String], // For select/multiselect types
    unit: String, // For number types (kg, cm, etc.)
    searchable: {
      type: Boolean,
      default: true
    },
    filterable: {
      type: Boolean,
      default: true
    }
  }],
  
  // Sorting and Display
  sortOrder: {
    type: Number,
    default: 0
  },
  displayType: {
    type: String,
    enum: ['grid', 'list', 'featured'],
    default: 'grid'
  },
  
  // Category-specific Settings
  settings: {
    showProductCount: {
      type: Boolean,
      default: true
    },
    showSubcategories: {
      type: Boolean,
      default: true
    },
    allowSorting: {
      type: Boolean,
      default: true
    },
    defaultSortBy: {
      type: String,
      enum: ['name', 'price', 'rating', 'newest', 'popular'],
      default: 'name'
    },
    productsPerPage: {
      type: Number,
      default: 20,
      min: [1, 'Products per page must be at least 1'],
      max: [100, 'Products per page cannot exceed 100']
    }
  },
  
  // Breadcrumbs
  breadcrumb: [{
    name: String,
    slug: String,
    level: Number
  }],
  
  // Category Path (for hierarchical categories)
  path: {
    type: String,
    default: ''
  },
  
  // External IDs
  externalIds: {
    amazon: {
      browseNodeId: String,
      categoryId: String
    },
    google: {
      categoryId: String
    }
  },
  
  // Analytics
  analytics: {
    impressions: {
      type: Number,
      default: 0
    },
    clicks: {
      type: Number,
      default: 0
    },
    conversions: {
      type: Number,
      default: 0
    },
    revenue: {
      type: Number,
      default: 0
    }
  },
  
  // Category-specific Rules
  rules: {
    minimumPrice: {
      type: Number,
      min: [0, 'Minimum price cannot be negative']
    },
    maximumPrice: {
      type: Number,
      min: [0, 'Maximum price cannot be negative']
    },
    allowedVendors: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    restrictedProducts: [{
      type: String,
      enum: ['alcohol', 'tobacco', 'adult', 'weapons', 'pharmaceuticals']
    }]
  },
  
  // Seasonal Categories
  seasonal: {
    isSeasonal: {
      type: Boolean,
      default: false
    },
    season: {
      type: String,
      enum: ['spring', 'summer', 'fall', 'winter', 'holiday', 'back_to_school', 'valentines', 'mothers_day', 'fathers_day']
    },
    startDate: Date,
    endDate: Date
  },
  
  // Category Collections
  collections: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Collection'
  }],
  
  // Promotional Content
  promotional: {
    banner: {
      image: String,
      link: String,
      alt: String
    },
    featuredProducts: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    }],
    promotionalText: String
  },
  
  // History
  history: [{
    action: {
      type: String,
      enum: ['created', 'updated', 'moved', 'merged', 'status_changed']
    },
    details: String,
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
categorySchema.index({ slug: 1 });
categorySchema.index({ name: 'text', description: 'text' });
categorySchema.index({ parent: 1 });
categorySchema.index({ status: 1, visibility: 1 });
categorySchema.index({ featured: 1 });
categorySchema.index({ sortOrder: 1 });
categorySchema.index({ 'seasonal.season': 1 });
categorySchema.index({ path: 1 });

// Virtual for level (depth in hierarchy)
categorySchema.virtual('level').get(function() {
  return this.path ? this.path.split('.').length : 0;
});

// Virtual for full path
categorySchema.virtual('fullPath').get(function() {
  return this.breadcrumb.map(b => b.name).join(' > ');
});

// Virtual for is root category
categorySchema.virtual('isRoot').get(function() {
  return !this.parent;
});

// Virtual for has children
categorySchema.virtual('hasChildren').get(function() {
  return this.children && this.children.length > 0;
});

// Instance methods
categorySchema.methods = {
  // Generate slug
  generateSlug: function() {
    this.slug = slugify(this.name, {
      lower: true,
      strict: true
    });
  },
  
  // Add child category
  addChild: function(childId) {
    if (!this.children.includes(childId)) {
      this.children.push(childId);
      return this.save();
    }
    return Promise.resolve(this);
  },
  
  // Remove child category
  removeChild: function(childId) {
    this.children = this.children.filter(id => id.toString() !== childId.toString());
    return this.save();
  },
  
  // Update path
  updatePath: function() {
    if (this.parent) {
      return this.populate('parent').then(category => {
        if (category.parent) {
          this.path = `${category.parent.path}.${category._id}`;
        } else {
          this.path = category._id.toString();
        }
        return this.save();
      });
    } else {
      this.path = this._id.toString();
      return this.save();
    }
  },
  
  // Update breadcrumb
  updateBreadcrumb: function() {
    if (this.parent) {
      return this.populate({
        path: 'parent',
        populate: { path: 'parent' }
      }).then(category => {
        const breadcrumb = [];
        let current = category;
        
        while (current) {
          breadcrumb.unshift({
            name: current.name,
            slug: current.slug,
            level: breadcrumb.length
          });
          
          if (current.parent) {
            // We need to fetch the parent separately since populate has limits
            return this.model('Category').findById(current.parent).then(parent => {
              current = parent;
              return current;
            });
          } else {
            current = null;
          }
        }
        
        this.breadcrumb = breadcrumb;
        return this.save();
      });
    } else {
      this.breadcrumb = [{
        name: this.name,
        slug: this.slug,
        level: 0
      }];
      return this.save();
    }
  },
  
  // Get all descendants
  getAllDescendants: async function() {
    const descendants = [];
    const queue = [...this.children];
    
    while (queue.length > 0) {
      const childId = queue.shift();
      const child = await this.model('Category').findById(childId);
      
      if (child) {
        descendants.push(child);
        queue.push(...child.children);
      }
    }
    
    return descendants;
  },
  
  // Get all ancestors
  getAllAncestors: async function() {
    const ancestors = [];
    let current = this.parent;
    
    while (current) {
      const parent = await this.model('Category').findById(current);
      if (parent) {
        ancestors.unshift(parent);
        current = parent.parent;
      } else {
        current = null;
      }
    }
    
    return ancestors;
  },
  
  // Update product count
  updateProductCount: function() {
    return this.model('Product').countDocuments({ 
      $or: [
        { category: this._id },
        { subCategory: this._id }
      ],
      status: 'active'
    }).then(count => {
      this.statistics.productCount = count;
      return this.save();
    });
  },
  
  // Update subcategory count
  updateSubcategoryCount: function() {
    return this.model('Category').countDocuments({ parent: this._id }).then(count => {
      this.statistics.subcategoryCount = count;
      return this.save();
    });
  },
  
  // Add view
  addView: function() {
    this.statistics.totalViews += 1;
    this.analytics.impressions += 1;
    return this.save();
  },
  
  // Add click
  addClick: function() {
    this.statistics.totalClicks += 1;
    this.analytics.clicks += 1;
    return this.save();
  },
  
  // Record conversion
  recordConversion: function(revenue = 0) {
    this.analytics.conversions += 1;
    this.analytics.revenue += revenue;
    return this.save();
  }
};

// Static methods
categorySchema.statics = {
  // Get root categories
  getRootCategories: function() {
    return this.find({ parent: null }).sort({ sortOrder: 1, name: 1 });
  },
  
  // Get category tree
  getCategoryTree: function() {
    return this.find({}).sort({ sortOrder: 1, name: 1 }).then(categories => {
      const buildTree = (parentId = null) => {
        return categories
          .filter(cat => cat.parent?.toString() === parentId?.toString())
          .map(cat => ({
            ...cat.toObject(),
            children: buildTree(cat._id)
          }));
      };
      
      return buildTree();
    });
  },
  
  // Find by slug with population
  findBySlug: function(slug) {
    return this.findOne({ slug }).populate('parent');
  },
  
  // Search categories
  search: function(query) {
    return this.find({
      $or: [
        { $text: { $search: query } },
        { name: { $regex: query, $options: 'i' } },
        { description: { $regex: query, $options: 'i' } }
      ],
      status: 'active'
    }).sort({ sortOrder: 1 });
  },
  
  // Get featured categories
  getFeatured: function(limit = 10) {
    return this.find({ featured: true, status: 'active' })
               .sort({ sortOrder: 1, 'statistics.totalViews': -1 })
               .limit(limit);
  },
  
  // Get seasonal categories
  getSeasonal: function(season) {
    const now = new Date();
    return this.find({
      'seasonal.isSeasonal': true,
      'seasonal.season': season,
      'seasonal.startDate': { $lte: now },
      'seasonal.endDate': { $gte: now },
      status: 'active'
    }).sort({ sortOrder: 1 });
  },
  
  // Get category statistics
  getCategoryStats: function() {
    return this.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          featured: { $sum: { $cond: ['$featured', 1, 0] } },
          totalProducts: { $sum: '$statistics.productCount' },
          totalViews: { $sum: '$statistics.totalViews' }
        }
      }
    ]);
  },
  
  // Find categories with products
  findWithProducts: function(minProducts = 1) {
    return this.find({
      'statistics.productCount': { $gte: minProducts },
      status: 'active'
    }).sort({ 'statistics.productCount': -1 });
  },
  
  // Get popular categories
  getPopular: function(limit = 10) {
    return this.find({ status: 'active' })
               .sort({ 'statistics.totalViews': -1 })
               .limit(limit);
  }
};

// Pre-save middleware
categorySchema.pre('save', function(next) {
  // Generate slug if not exists
  if (this.isModified('name') && !this.slug) {
    this.generateSlug();
  }
  
  // Update path and breadcrumb if parent changed
  if (this.isModified('parent')) {
    this.updatePath();
    this.updateBreadcrumb();
  }
  
  next();
});

// Post-save middleware
categorySchema.post('save', async function(doc) {
  // Update parent category children array
  if (doc.parent) {
    await mongoose.model('Category').findByIdAndUpdate(doc.parent, {
      $addToSet: { children: doc._id }
    });
  }
  
  // Update product counts
  await doc.updateProductCount();
  await doc.updateSubcategoryCount();
});

module.exports = mongoose.model('Category', categorySchema);
