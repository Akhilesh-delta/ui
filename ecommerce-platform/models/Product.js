const mongoose = require('mongoose');
const slugify = require('slugify');

const productSchema = new mongoose.Schema({
  // Basic Information
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    maxlength: [200, 'Product name cannot exceed 200 characters']
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true
  },
  description: {
    type: String,
    required: [true, 'Product description is required'],
    maxlength: [5000, 'Description cannot exceed 5000 characters']
  },
  shortDescription: {
    type: String,
    maxlength: [500, 'Short description cannot exceed 500 characters']
  },
  sku: {
    type: String,
    required: [true, 'SKU is required'],
    unique: true,
    uppercase: true
  },
  
  // Vendor Information
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Vendor is required']
  },
  
  // Category and Brand
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Category is required']
  },
  subCategory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  },
  brand: {
    type: String,
    trim: true,
    maxlength: [100, 'Brand name cannot exceed 100 characters']
  },
  
  // Pricing
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: [0, 'Price cannot be negative']
  },
  compareAtPrice: {
    type: Number,
    min: [0, 'Compare at price cannot be negative']
  },
  costPrice: {
    type: Number,
    min: [0, 'Cost price cannot be negative']
  },
  discount: {
    type: {
      amount: {
        type: Number,
        min: [0, 'Discount amount cannot be negative']
      },
      percentage: {
        type: Number,
        min: [0, 'Discount percentage cannot be negative'],
        max: [100, 'Discount percentage cannot exceed 100']
      },
      type: {
        type: String,
        enum: ['fixed', 'percentage'],
        default: 'percentage'
      },
      startDate: Date,
      endDate: Date
    }
  },
  
  // Inventory
  inventory: {
    quantity: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [0, 'Quantity cannot be negative'],
      default: 0
    },
    trackQuantity: {
      type: Boolean,
      default: true
    },
    lowStockThreshold: {
      type: Number,
      default: 5,
      min: [0, 'Low stock threshold cannot be negative']
    },
    stockStatus: {
      type: String,
      enum: ['in_stock', 'low_stock', 'out_of_stock', 'pre_order', 'discontinued'],
      default: 'in_stock'
    },
    allowBackorder: {
      type: Boolean,
      default: false
    },
    maxOrderQuantity: {
      type: Number,
      min: [1, 'Max order quantity must be at least 1'],
      default: 10
    }
  },
  
  // Product Variants
  variants: [{
    name: {
      type: String,
      required: true
    },
    type: {
      type: String,
      enum: ['color', 'size', 'material', 'style', 'weight', 'volume', 'other'],
      default: 'other'
    },
    options: [{
      value: {
        type: String,
        required: true
      },
      priceModifier: {
        type: Number,
        default: 0
      },
      sku: String,
      inventory: {
        quantity: {
          type: Number,
          default: 0,
          min: [0, 'Variant quantity cannot be negative']
        },
        sku: String
      }
    }]
  }],
  
  // Media
  images: [{
    url: {
      type: String,
      required: true
    },
    alt: {
      type: String,
      maxlength: [200, 'Alt text cannot exceed 200 characters']
    },
    isPrimary: {
      type: Boolean,
      default: false
    },
    order: {
      type: Number,
      default: 0
    },
    metadata: {
      width: Number,
      height: Number,
      size: Number,
      format: String
    }
  }],
  
  // Videos
  videos: [{
    url: {
      type: String,
      required: true
    },
    thumbnail: String,
    title: String,
    description: String,
    duration: Number,
    platform: {
      type: String,
      enum: ['youtube', 'vimeo', 'cloudinary', 'local'],
      default: 'cloudinary'
    }
  }],
  
  // Specifications
  specifications: [{
    name: {
      type: String,
      required: true
    },
    value: {
      type: String,
      required: true
    },
    unit: String,
    group: String
  }],
  
  // Features and Benefits
  features: [String],
  benefits: [String],
  
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
    canonicalUrl: String,
    structuredData: mongoose.Schema.Types.Mixed
  },
  
  // Tags
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  
  // Dimensions and Weight
  dimensions: {
    length: {
      type: Number,
      min: [0, 'Length cannot be negative']
    },
    width: {
      type: Number,
      min: [0, 'Width cannot be negative']
    },
    height: {
      type: Number,
      min: [0, 'Height cannot be negative']
    },
    unit: {
      type: String,
      enum: ['mm', 'cm', 'in', 'ft'],
      default: 'cm'
    }
  },
  weight: {
    value: {
      type: Number,
      min: [0, 'Weight cannot be negative']
    },
    unit: {
      type: String,
      enum: ['g', 'kg', 'oz', 'lb'],
      default: 'kg'
    }
  },
  
  // Shipping
  shipping: {
    requiresShipping: {
      type: Boolean,
      default: true
    },
    shippingClass: {
      type: String,
      enum: ['standard', 'express', 'overnight', 'free', 'pickup'],
      default: 'standard'
    },
    shippingWeight: {
      value: Number,
      unit: {
        type: String,
        enum: ['g', 'kg', 'oz', 'lb'],
        default: 'kg'
      }
    },
    shippingDimensions: {
      length: Number,
      width: Number,
      height: Number,
      unit: {
        type: String,
        enum: ['mm', 'cm', 'in', 'ft'],
        default: 'cm'
      }
    },
    handlingTime: {
      type: Number,
      default: 1,
      min: [0, 'Handling time cannot be negative']
    },
    freeShipping: {
      type: Boolean,
      default: false
    },
    freeShippingMinimum: {
      type: Number,
      min: [0, 'Free shipping minimum cannot be negative']
    }
  },
  
  // Status and Visibility
  status: {
    type: String,
    enum: ['draft', 'active', 'inactive', 'archived', 'pending'],
    default: 'draft'
  },
  visibility: {
    type: String,
    enum: ['public', 'private', 'hidden'],
    default: 'public'
  },
  featured: {
    type: Boolean,
    default: false
  },
  trending: {
    type: Boolean,
    default: false
  },
  
  // Reviews and Ratings
  rating: {
    average: {
      type: Number,
      default: 0,
      min: [0, 'Rating cannot be negative'],
      max: [5, 'Rating cannot exceed 5']
    },
    count: {
      type: Number,
      default: 0,
      min: [0, 'Review count cannot be negative']
    },
    distribution: {
      1: { type: Number, default: 0 },
      2: { type: Number, default: 0 },
      3: { type: Number, default: 0 },
      4: { type: Number, default: 0 },
      5: { type: Number, default: 0 }
    }
  },
  
  // Statistics
  statistics: {
    views: {
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
    favorites: {
      type: Number,
      default: 0
    },
    shares: {
      type: Number,
      default: 0
    },
    lastViewed: Date,
    lastPurchased: Date
  },
  
  // Product Options
  options: {
    allowReviews: {
      type: Boolean,
      default: true
    },
    requireReviewAfterPurchase: {
      type: Boolean,
      default: false
    },
    showRelatedProducts: {
      type: Boolean,
      default: true
    },
    showRecentlyViewed: {
      type: Boolean,
      default: true
    },
    allowWishlist: {
      type: Boolean,
      default: true
    }
  },
  
  // External Integrations
  externalIds: {
    amazon: {
      asin: String,
      productId: String
    },
    ebay: {
      itemId: String
    },
    shopify: {
      productId: String
    },
    woocommerce: {
      productId: String
    }
  },
  
  // Product Attributes
  attributes: [{
    name: {
      type: String,
      required: true
    },
    value: {
      type: String,
      required: true
    },
    visible: {
      type: Boolean,
      default: true
    },
    searchable: {
      type: Boolean,
      default: false
    }
  }],
  
  // Product Collections
  collections: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Collection'
  }],
  
  // Product Relationships
  relatedProducts: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    },
    type: {
      type: String,
      enum: ['related', 'upsell', 'cross_sell', 'accessory', 'replacement'],
      default: 'related'
    }
  }],
  
  // Product History
  history: [{
    action: {
      type: String,
      enum: ['created', 'updated', 'price_changed', 'inventory_updated', 'status_changed', 'featured', 'unfeatured']
    },
    oldValue: mongoose.Schema.Types.Mixed,
    newValue: mongoose.Schema.Types.Mixed,
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Product Analytics
  analytics: {
    impressions: {
      type: Number,
      default: 0
    },
    uniqueViews: {
      type: Number,
      default: 0
    },
    addToCart: {
      type: Number,
      default: 0
    },
    conversionRate: {
      type: Number,
      default: 0
    },
    revenue: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
productSchema.index({ name: 'text', description: 'text', brand: 'text', tags: 'text' });
productSchema.index({ slug: 1 });
productSchema.index({ sku: 1 });
productSchema.index({ vendor: 1 });
productSchema.index({ category: 1, subCategory: 1 });
productSchema.index({ price: 1 });
productSchema.index({ 'inventory.quantity': 1 });
productSchema.index({ status: 1, visibility: 1 });
productSchema.index({ featured: 1, trending: 1 });
productSchema.index({ 'rating.average': -1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ 'statistics.views': -1 });
productSchema.index({ tags: 1 });

// Virtual for discounted price
productSchema.virtual('discountedPrice').get(function() {
  if (!this.discount || !this.isDiscountActive()) return this.price;
  
  if (this.discount.type === 'fixed') {
    return Math.max(0, this.price - this.discount.amount);
  } else {
    return this.price * (1 - this.discount.percentage / 100);
  }
});

// Virtual for savings amount
productSchema.virtual('savingsAmount').get(function() {
  if (!this.discount || !this.isDiscountActive()) return 0;
  return this.price - this.discountedPrice;
});

// Virtual for savings percentage
productSchema.virtual('savingsPercentage').get(function() {
  if (!this.price || !this.discount || !this.isDiscountActive()) return 0;
  return Math.round(((this.price - this.discountedPrice) / this.price) * 100);
});

// Virtual for availability status
productSchema.virtual('availabilityStatus').get(function() {
  if (this.status !== 'active') return 'unavailable';
  if (this.inventory.stockStatus === 'out_of_stock') return 'out_of_stock';
  if (this.inventory.stockStatus === 'pre_order') return 'pre_order';
  return 'available';
});

// Virtual for stock status
productSchema.virtual('stockStatus').get(function() {
  return this.inventory.stockStatus;
});

// Instance methods
productSchema.methods = {
  // Generate slug
  generateSlug: function() {
    this.slug = slugify(`${this.name}-${this.sku}`, {
      lower: true,
      strict: true
    });
  },
  
  // Check if discount is active
  isDiscountActive: function() {
    if (!this.discount) return false;
    
    const now = new Date();
    const startDate = this.discount.startDate ? new Date(this.discount.startDate) : null;
    const endDate = this.discount.endDate ? new Date(this.discount.endDate) : null;
    
    if (startDate && now < startDate) return false;
    if (endDate && now > endDate) return false;
    
    return true;
  },
  
  // Update inventory
  updateInventory: function(quantity, operation = 'subtract') {
    let newQuantity;
    
    if (operation === 'subtract') {
      newQuantity = Math.max(0, this.inventory.quantity - quantity);
    } else if (operation === 'add') {
      newQuantity = this.inventory.quantity + quantity;
    } else {
      newQuantity = quantity;
    }
    
    this.inventory.quantity = newQuantity;
    this.updateStockStatus();
    
    return this.save();
  },
  
  // Update stock status
  updateStockStatus: function() {
    const { quantity, lowStockThreshold, trackQuantity } = this.inventory;
    
    if (!trackQuantity) {
      this.inventory.stockStatus = 'in_stock';
      return;
    }
    
    if (quantity === 0) {
      this.inventory.stockStatus = 'out_of_stock';
    } else if (quantity <= lowStockThreshold) {
      this.inventory.stockStatus = 'low_stock';
    } else {
      this.inventory.stockStatus = 'in_stock';
    }
  },
  
  // Add product view
  addView: function() {
    this.statistics.views += 1;
    this.statistics.lastViewed = new Date();
    this.analytics.impressions += 1;
    
    return this.save();
  },
  
  // Add to favorites
  addToFavorites: function() {
    this.statistics.favorites += 1;
    return this.save();
  },
  
  // Remove from favorites
  removeFromFavorites: function() {
    this.statistics.favorites = Math.max(0, this.statistics.favorites - 1);
    return this.save();
  },
  
  // Record purchase
  recordPurchase: function(quantity = 1) {
    this.statistics.conversions += 1;
    this.statistics.lastPurchased = new Date();
    this.analytics.conversions += 1;
    this.analytics.revenue += this.discountedPrice * quantity;
    
    return this.save();
  },
  
  // Add review
  addReview: function(rating, count = 1) {
    const oldAverage = this.rating.average;
    const oldCount = this.rating.count;
    
    const newCount = oldCount + count;
    const newAverage = ((oldAverage * oldCount) + (rating * count)) / newCount;
    
    this.rating.count = newCount;
    this.rating.average = Math.round(newAverage * 10) / 10;
    
    // Update rating distribution
    this.rating.distribution[rating] = (this.rating.distribution[rating] || 0) + count;
    
    return this.save();
  },
  
  // Get product analytics
  getAnalytics: function(startDate, endDate) {
    // This would typically query a separate analytics collection
    // For now, return basic stats
    return {
      views: this.statistics.views,
      conversions: this.statistics.conversions,
      conversionRate: this.statistics.views > 0 ? (this.statistics.conversions / this.statistics.views) * 100 : 0,
      revenue: this.analytics.revenue,
      rating: this.rating.average,
      reviewCount: this.rating.count
    };
  },
  
  // Check if product is available
  isAvailable: function() {
    return this.status === 'active' && 
           this.visibility === 'public' && 
           (this.inventory.stockStatus === 'in_stock' || 
            this.inventory.stockStatus === 'low_stock' || 
            (this.inventory.stockStatus === 'out_of_stock' && this.inventory.allowBackorder));
  },
  
  // Get primary image
  getPrimaryImage: function() {
    const primaryImage = this.images.find(img => img.isPrimary);
    return primaryImage || this.images[0];
  },
  
  // Get formatted specifications
  getFormattedSpecifications: function() {
    const grouped = this.specifications.reduce((acc, spec) => {
      if (!acc[spec.group]) acc[spec.group] = [];
      acc[spec.group].push(spec);
      return acc;
    }, {});
    
    return grouped;
  }
};

// Static methods
productSchema.statics = {
  // Find products by vendor
  findByVendor: function(vendorId) {
    return this.find({ vendor: vendorId });
  },
  
  // Find products by category
  findByCategory: function(categoryId, includeSubcategories = false) {
    if (includeSubcategories) {
      return this.find({ $or: [{ category: categoryId }, { subCategory: categoryId }] });
    }
    return this.find({ category: categoryId });
  },
  
  // Find featured products
  findFeatured: function(limit = 10) {
    return this.find({ featured: true, status: 'active', visibility: 'public' })
               .sort({ 'statistics.views': -1 })
               .limit(limit);
  },
  
  // Find trending products
  findTrending: function(limit = 10) {
    return this.find({ trending: true, status: 'active', visibility: 'public' })
               .sort({ 'statistics.views': -1 })
               .limit(limit);
  },
  
  // Search products
  search: function(query, filters = {}) {
    const searchQuery = {
      $and: [
        {
          $or: [
            { $text: { $search: query } },
            { name: { $regex: query, $options: 'i' } },
            { description: { $regex: query, $options: 'i' } },
            { brand: { $regex: query, $options: 'i' } },
            { tags: { $in: [new RegExp(query, 'i')] } }
          ]
        },
        { status: 'active' },
        { visibility: 'public' }
      ]
    };
    
    // Apply filters
    if (filters.category) searchQuery.$and.push({ category: filters.category });
    if (filters.vendor) searchQuery.$and.push({ vendor: filters.vendor });
    if (filters.minPrice !== undefined) searchQuery.$and.push({ price: { $gte: filters.minPrice } });
    if (filters.maxPrice !== undefined) searchQuery.$and.push({ price: { $lte: filters.maxPrice } });
    if (filters.inStock === true) {
      searchQuery.$and.push({ 
        $or: [
          { 'inventory.stockStatus': 'in_stock' },
          { 'inventory.stockStatus': 'low_stock' }
        ]
      });
    }
    
    let queryBuilder = this.find(searchQuery);
    
    // Sorting
    switch (filters.sortBy) {
      case 'price_asc':
        queryBuilder = queryBuilder.sort({ price: 1 });
        break;
      case 'price_desc':
        queryBuilder = queryBuilder.sort({ price: -1 });
        break;
      case 'rating':
        queryBuilder = queryBuilder.sort({ 'rating.average': -1 });
        break;
      case 'newest':
        queryBuilder = queryBuilder.sort({ createdAt: -1 });
        break;
      case 'popular':
        queryBuilder = queryBuilder.sort({ 'statistics.views': -1 });
        break;
      default:
        queryBuilder = queryBuilder.sort({ score: { $meta: 'textScore' } });
    }
    
    return queryBuilder;
  },
  
  // Get product statistics
  getProductStats: function() {
    return this.aggregate([
      {
        $match: { status: 'active' }
      },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          averagePrice: { $avg: '$price' },
          totalInventory: { $sum: '$inventory.quantity' },
          featuredProducts: { $sum: { $cond: ['$featured', 1, 0] } },
          averageRating: { $avg: '$rating.average' }
        }
      }
    ]);
  }
};

// Pre-save middleware
productSchema.pre('save', function(next) {
  // Generate slug if not exists
  if (this.isModified('name') && !this.slug) {
    this.generateSlug();
  }
  
  // Update stock status
  this.updateStockStatus();
  
  // Update discount if expired
  if (this.discount && this.discount.endDate && new Date() > new Date(this.discount.endDate)) {
    this.discount = undefined;
  }
  
  next();
});

// Post-save middleware
productSchema.post('save', function(doc) {
  // Update vendor's product count
  if (doc.vendor) {
    mongoose.model('User').updateOne(
      { _id: doc.vendor },
      { $inc: { 'vendorProfile.productsCount': 1 } }
    ).exec();
  }
});

module.exports = mongoose.model('Product', productSchema);
