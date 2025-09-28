const mongoose = require('mongoose');
const slugify = require('slugify');
const { v4: uuidv4 } = require('uuid');

const productSchema = new mongoose.Schema({
  // Basic Product Information
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    maxlength: [200, 'Product name cannot exceed 200 characters'],
    minlength: [3, 'Product name must be at least 3 characters']
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
  brand: {
    type: String,
    trim: true,
    maxlength: [100, 'Brand name cannot exceed 100 characters']
  },

  // Vendor and Store Information
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Vendor is required']
  },
  store: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: [true, 'Store is required']
  },

  // Category and Classification
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Category is required']
  },
  subcategories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  }],
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],

  // Product Images and Media
  images: [{
    url: {
      type: String,
      required: true
    },
    public_id: {
      type: String,
      required: true
    },
    thumbnail: String,
    alt: String,
    isPrimary: {
      type: Boolean,
      default: false
    },
    order: {
      type: Number,
      default: 0
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  videos: [{
    url: String,
    public_id: String,
    thumbnail: String,
    title: String,
    duration: Number,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],

  // Product Variants
  variants: [{
    name: {
      type: String,
      required: true
    },
    type: {
      type: String,
      enum: ['color', 'size', 'weight', 'volume', 'style', 'material', 'custom'],
      required: true
    },
    values: [{
      value: {
        type: String,
        required: true
      },
      displayValue: String,
      image: String,
      colorCode: String, // For color variants
      priceModifier: {
        type: Number,
        default: 0
      },
      weightModifier: {
        type: Number,
        default: 0
      }
    }]
  }],

  // Pricing Information
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
  currency: {
    type: String,
    default: 'USD',
    enum: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY', 'INR']
  },

  // Discount and Promotions
  discount: {
    type: {
      type: String,
      enum: ['percentage', 'fixed_amount'],
      default: 'percentage'
    },
    value: {
      type: Number,
      min: [0, 'Discount value cannot be negative'],
      max: [100, 'Percentage discount cannot exceed 100%']
    },
    startDate: Date,
    endDate: Date,
    isActive: {
      type: Boolean,
      default: false
    }
  },
  bulkDiscount: [{
    minQuantity: {
      type: Number,
      required: true,
      min: 2
    },
    discountPercentage: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    }
  }],

  // Inventory Management
  inventory: {
    quantity: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [0, 'Quantity cannot be negative']
    },
    lowStockThreshold: {
      type: Number,
      default: 5,
      min: 0
    },
    trackQuantity: {
      type: Boolean,
      default: true
    },
    allowBackorders: {
      type: Boolean,
      default: false
    },
    stockStatus: {
      type: String,
      enum: ['in_stock', 'out_of_stock', 'pre_order', 'discontinued'],
      default: 'in_stock'
    }
  },

  // Shipping Information
  shipping: {
    weight: {
      type: Number,
      min: [0, 'Weight cannot be negative']
    },
    dimensions: {
      length: Number,
      width: Number,
      height: Number
    },
    shippingClass: {
      type: String,
      enum: ['standard', 'expedited', 'overnight', 'free', 'pickup'],
      default: 'standard'
    },
    requiresShipping: {
      type: Boolean,
      default: true
    },
    shipsFrom: {
      country: String,
      state: String,
      city: String,
      zipCode: String
    },
    estimatedDelivery: {
      minDays: Number,
      maxDays: Number
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
    type: {
      type: String,
      enum: ['text', 'number', 'boolean', 'date', 'color', 'size'],
      default: 'text'
    },
    isVisible: {
      type: Boolean,
      default: true
    },
    isSearchable: {
      type: Boolean,
      default: false
    }
  }],

  // SEO and Marketing
  seo: {
    metaTitle: String,
    metaDescription: String,
    keywords: [String],
    canonicalUrl: String
  },
  searchKeywords: [String],

  // Product Status and Visibility
  status: {
    type: String,
    enum: ['draft', 'published', 'unpublished', 'archived', 'pending_review'],
    default: 'draft'
  },
  visibility: {
    type: String,
    enum: ['public', 'private', 'vendor_only', 'hidden'],
    default: 'public'
  },
  featured: {
    type: Boolean,
    default: false
  },
  isDigital: {
    type: Boolean,
    default: false
  },

  // Reviews and Ratings
  rating: {
    average: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    count: {
      type: Number,
      default: 0
    },
    distribution: {
      1: { type: Number, default: 0 },
      2: { type: Number, default: 0 },
      3: { type: Number, default: 0 },
      4: { type: Number, default: 0 },
      5: { type: Number, default: 0 }
    }
  },

  // Analytics and Performance
  stats: {
    views: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    conversions: { type: Number, default: 0 },
    wishlistCount: { type: Number, default: 0 },
    cartCount: { type: Number, default: 0 },
    salesCount: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    lastViewed: Date,
    lastPurchased: Date
  },

  // Product Options
  options: {
    allowReviews: { type: Boolean, default: true },
    allowQuestions: { type: Boolean, default: true },
    requireApproval: { type: Boolean, default: false },
    autoPublish: { type: Boolean, default: true },
    notifyOnLowStock: { type: Boolean, default: true },
    allowPreOrders: { type: Boolean, default: false }
  },

  // Custom Fields
  customFields: [{
    name: String,
    value: mongoose.Schema.Types.Mixed,
    type: String,
    required: Boolean
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
  bundles: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    },
    quantity: {
      type: Number,
      default: 1,
      min: 1
    },
    discountPercentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    }
  }],

  // Product History and Versions
  versions: [{
    version: {
      type: Number,
      required: true
    },
    changes: [{
      field: String,
      oldValue: mongoose.Schema.Types.Mixed,
      newValue: mongoose.Schema.Types.Mixed,
      changedAt: {
        type: Date,
        default: Date.now
      },
      changedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    }],
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],

  // Compliance and Legal
  compliance: {
    ageRestriction: {
      type: Number,
      min: 0,
      max: 21
    },
    countryRestrictions: [String],
    certifications: [String],
    warnings: [String],
    ingredients: [String],
    nutritionalInfo: mongoose.Schema.Types.Mixed
  },

  // Product Timeline
  publishedAt: Date,
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
productSchema.index({ name: 'text', description: 'text', brand: 'text' });
productSchema.index({ slug: 1 });
productSchema.index({ sku: 1 });
productSchema.index({ vendor: 1 });
productSchema.index({ category: 1 });
productSchema.index({ tags: 1 });
productSchema.index({ price: 1 });
productSchema.index({ rating: -1 });
productSchema.index({ 'inventory.stockStatus': 1 });
productSchema.index({ status: 1 });
productSchema.index({ featured: 1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ 'stats.views': -1 });
productSchema.index({ 'stats.salesCount': -1 });

// Compound indexes
productSchema.index({ vendor: 1, status: 1 });
productSchema.index({ category: 1, status: 1, featured: 1 });
productSchema.index({ price: 1, rating: -1 });
productSchema.index({ 'inventory.quantity': 1, 'inventory.stockStatus': 1 });

// Virtual for discount percentage
productSchema.virtual('discountPercentage').get(function() {
  if (this.compareAtPrice && this.price < this.compareAtPrice) {
    return Math.round(((this.compareAtPrice - this.price) / this.compareAtPrice) * 100);
  }
  return 0;
});

// Virtual for discounted price
productSchema.virtual('discountedPrice').get(function() {
  return this.price;
});

// Virtual for availability
productSchema.virtual('isAvailable').get(function() {
  return this.inventory.stockStatus === 'in_stock' ||
         (this.inventory.allowBackorders && this.inventory.stockStatus !== 'discontinued');
});

// Virtual for profit margin
productSchema.virtual('profitMargin').get(function() {
  if (this.costPrice && this.price > this.costPrice) {
    return Math.round(((this.price - this.costPrice) / this.price) * 100);
  }
  return 0;
});

// Virtual for stock level
productSchema.virtual('stockLevel').get(function() {
  const quantity = this.inventory.quantity;
  if (quantity === 0) return 'out_of_stock';
  if (quantity <= this.inventory.lowStockThreshold) return 'low_stock';
  return 'in_stock';
});

// Pre-save middleware
productSchema.pre('save', function(next) {
  // Generate slug if not exists
  if (this.isModified('name') && !this.slug) {
    this.slug = slugify(this.name, {
      lower: true,
      strict: true,
      remove: /[*+~.()'"!:@]/g
    }) + '-' + uuidv4().substring(0, 6);
  }

  // Update published date
  if (this.isModified('status') && this.status === 'published' && !this.publishedAt) {
    this.publishedAt = new Date();
  }

  // Calculate search keywords
  if (this.isModified('name') || this.isModified('description') || this.isModified('brand')) {
    const keywords = [
      this.name,
      this.brand,
      ...this.tags,
      this.category?.name,
      ...this.subcategories?.map(cat => cat.name) || []
    ].filter(Boolean);

    // Extract keywords from description
    const descriptionWords = this.description
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 3)
      .slice(0, 20);

    this.searchKeywords = [...new Set([...keywords, ...descriptionWords])];
  }

  next();
});

// Instance methods
productSchema.methods = {
  // Generate product URL
  generateUrl() {
    return `/products/${this.slug}`;
  },

  // Check if product is in stock
  isInStock() {
    return this.inventory.stockStatus === 'in_stock' &&
           this.inventory.quantity > 0;
  },

  // Get applicable discount
  getApplicableDiscount(quantity = 1) {
    // Check bulk discount
    const bulkDiscount = this.bulkDiscount
      .filter(discount => quantity >= discount.minQuantity)
      .sort((a, b) => b.discountPercentage - a.discountPercentage)[0];

    if (bulkDiscount) {
      return {
        type: 'bulk',
        value: bulkDiscount.discountPercentage,
        amount: (this.price * bulkDiscount.discountPercentage) / 100
      };
    }

    // Check regular discount
    if (this.discount.isActive &&
        (!this.discount.startDate || this.discount.startDate <= new Date()) &&
        (!this.discount.endDate || this.discount.endDate >= new Date())) {
      return {
        type: 'regular',
        value: this.discount.value,
        amount: this.discount.type === 'percentage' ?
          (this.price * this.discount.value) / 100 :
          this.discount.value
      };
    }

    return null;
  },

  // Calculate final price
  calculatePrice(quantity = 1, variant = null) {
    let basePrice = this.price;

    // Apply variant price modifier
    if (variant && variant.priceModifier) {
      basePrice += variant.priceModifier;
    }

    // Apply discount
    const discount = this.getApplicableDiscount(quantity);
    if (discount) {
      basePrice -= discount.amount;
    }

    return Math.max(basePrice, 0) * quantity;
  },

  // Check if product can be purchased
  canBePurchased(quantity = 1) {
    if (!this.isAvailable) return false;
    if (!this.inventory.trackQuantity) return true;
    if (this.inventory.allowBackorders) return true;

    return this.inventory.quantity >= quantity;
  },

  // Reduce inventory
  async reduceInventory(quantity) {
    if (!this.inventory.trackQuantity) return true;

    const newQuantity = this.inventory.quantity - quantity;
    if (newQuantity < 0 && !this.inventory.allowBackorders) {
      throw new Error('Insufficient inventory');
    }

    // Update stock status
    let stockStatus = 'in_stock';
    if (newQuantity <= 0) {
      stockStatus = this.inventory.allowBackorders ? 'pre_order' : 'out_of_stock';
    } else if (newQuantity <= this.inventory.lowStockThreshold) {
      stockStatus = 'low_stock';
    }

    await this.updateOne({
      'inventory.quantity': newQuantity,
      'inventory.stockStatus': stockStatus
    });

    return true;
  },

  // Add product view
  async addView() {
    await this.updateOne({
      $inc: { 'stats.views': 1 },
      $set: { 'stats.lastViewed': new Date() }
    });
  },

  // Add to cart
  async addToCart() {
    await this.updateOne({
      $inc: { 'stats.cartCount': 1 }
    });
  },

  // Record purchase
  async recordPurchase(quantity, revenue) {
    await this.updateOne({
      $inc: {
        'stats.salesCount': 1,
        'stats.conversions': 1,
        'inventory.quantity': -quantity
      },
      $set: { 'stats.lastPurchased': new Date() }
    });

    // Update vendor stats
    await mongoose.model('User').findByIdAndUpdate(this.vendor, {
      $inc: {
        'vendorProfile.performance.totalSales': revenue,
        'vendorProfile.performance.totalOrders': 1
      }
    });
  },

  // Update rating
  async updateRating(newRating) {
    const currentStats = this.rating;
    const newCount = currentStats.count + 1;
    const newAverage = ((currentStats.average * currentStats.count) + newRating) / newCount;

    // Update distribution
    const newDistribution = { ...currentStats.distribution };
    if (newDistribution[newRating]) {
      newDistribution[newRating]++;
    }

    await this.updateOne({
      rating: {
        average: Math.round(newAverage * 10) / 10,
        count: newCount,
        distribution: newDistribution
      }
    });
  },

  // Add related product
  async addRelatedProduct(productId, type = 'related') {
    const exists = this.relatedProducts.some(rp => rp.product.toString() === productId.toString());
    if (exists) return;

    await this.updateOne({
      $push: {
        relatedProducts: {
          product: productId,
          type
        }
      }
    });
  },

  // Create product variant
  async createVariant(variantData) {
    await this.updateOne({
      $push: { variants: variantData }
    });
  },

  // Archive product
  async archive() {
    await this.updateOne({
      status: 'archived',
      'inventory.stockStatus': 'discontinued'
    });
  },

  // Clone product
  async clone(newVendorId = null) {
    const productData = this.toObject();
    delete productData._id;
    delete productData.slug;
    delete productData.createdAt;
    delete productData.updatedAt;
    delete productData.stats;
    delete productData.rating;

    if (newVendorId) {
      productData.vendor = newVendorId;
    }

    productData.status = 'draft';
    productData.name = `${productData.name} (Copy)`;

    const Product = mongoose.model('Product');
    return new Product(productData).save();
  }
};

// Static methods
productSchema.statics = {
  // Find products by vendor
  async findByVendor(vendorId, options = {}) {
    const { status, category, featured, limit = 20, skip = 0 } = options;

    let query = { vendor: vendorId, isDeleted: false };

    if (status) query.status = status;
    if (category) query.category = category;
    if (featured !== undefined) query.featured = featured;

    return this.find(query)
      .populate('category', 'name slug')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip);
  },

  // Search products
  async search(searchTerm, options = {}) {
    const {
      category,
      vendor,
      minPrice,
      maxPrice,
      rating,
      inStock,
      featured,
      sortBy = 'relevance',
      limit = 20,
      skip = 0
    } = options;

    let query = {
      $and: [
        {
          $or: [
            { name: { $regex: searchTerm, $options: 'i' } },
            { description: { $regex: searchTerm, $options: 'i' } },
            { brand: { $regex: searchTerm, $options: 'i' } },
            { tags: { $in: [new RegExp(searchTerm, 'i')] } },
            { searchKeywords: { $in: [searchTerm.toLowerCase()] } }
          ]
        },
        { status: 'published', isDeleted: false }
      ]
    };

    // Add filters
    if (category) query.$and.push({ category });
    if (vendor) query.$and.push({ vendor });
    if (minPrice || maxPrice) {
      query.$and.push({
        price: {
          ...(minPrice && { $gte: minPrice }),
          ...(maxPrice && { $lte: maxPrice })
        }
      });
    }
    if (rating) {
      query.$and.push({ 'rating.average': { $gte: rating } });
    }
    if (inStock) {
      query.$and.push({
        $or: [
          { 'inventory.trackQuantity': false },
          { 'inventory.quantity': { $gt: 0 } },
          { 'inventory.allowBackorders': true }
        ]
      });
    }
    if (featured !== undefined) {
      query.$and.push({ featured });
    }

    // Sort options
    let sort = {};
    switch (sortBy) {
      case 'price_asc':
        sort = { price: 1 };
        break;
      case 'price_desc':
        sort = { price: -1 };
        break;
      case 'rating':
        sort = { 'rating.average': -1 };
        break;
      case 'newest':
        sort = { createdAt: -1 };
        break;
      case 'popular':
        sort = { 'stats.views': -1 };
        break;
      case 'bestselling':
        sort = { 'stats.salesCount': -1 };
        break;
      default:
        sort = { score: { $meta: 'textScore' } };
    }

    return this.find(query)
      .populate('vendor', 'firstName lastName')
      .populate('category', 'name slug')
      .sort(sort)
      .limit(limit)
      .skip(skip);
  },

  // Get featured products
  async getFeaturedProducts(limit = 20) {
    return this.find({
      status: 'published',
      featured: true,
      isDeleted: false
    })
    .populate('vendor', 'firstName lastName')
    .populate('category', 'name slug')
    .sort({ 'stats.views': -1 })
    .limit(limit);
  },

  // Get products by category
  async getByCategory(categoryId, options = {}) {
    const { limit = 20, skip = 0, sortBy = 'createdAt' } = options;

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
      default:
        sort = { createdAt: -1 };
    }

    return this.find({
      category: categoryId,
      status: 'published',
      isDeleted: false
    })
    .populate('vendor', 'firstName lastName')
    .sort(sort)
    .limit(limit)
    .skip(skip);
  },

  // Get product statistics
  async getProductStats(vendorId = null) {
    let matchStage = { isDeleted: false };

    if (vendorId) {
      matchStage.vendor = mongoose.Types.ObjectId(vendorId);
    }

    const stats = await this.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalValue: { $sum: { $multiply: ['$price', '$inventory.quantity'] } },
          avgPrice: { $avg: '$price' },
          avgRating: { $avg: '$rating.average' },
          totalViews: { $sum: '$stats.views' },
          totalSales: { $sum: '$stats.salesCount' }
        }
      }
    ]);

    return stats;
  },

  // Get low stock products
  async getLowStockProducts(vendorId = null) {
    let query = {
      'inventory.trackQuantity': true,
      'inventory.quantity': { $lte: '$inventory.lowStockThreshold' },
      'inventory.stockStatus': { $ne: 'out_of_stock' },
      isDeleted: false
    };

    if (vendorId) {
      query.vendor = vendorId;
    }

    return this.find(query)
      .populate('vendor', 'firstName lastName')
      .sort({ 'inventory.quantity': 1 });
  },

  // Bulk update products
  async bulkUpdate(productIds, updates) {
    return this.updateMany(
      { _id: { $in: productIds } },
      { $set: updates }
    );
  },

  // Get trending products
  async getTrendingProducts(days = 7, limit = 20) {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    return this.find({
      status: 'published',
      isDeleted: false,
      'stats.lastViewed': { $gte: cutoffDate }
    })
    .populate('vendor', 'firstName lastName')
    .populate('category', 'name slug')
    .sort({ 'stats.views': -1 })
    .limit(limit);
  },

  // Get products by price range
  async getByPriceRange(minPrice, maxPrice, options = {}) {
    const { limit = 20, skip = 0 } = options;

    return this.find({
      price: { $gte: minPrice, $lte: maxPrice },
      status: 'published',
      isDeleted: false
    })
    .populate('vendor', 'firstName lastName')
    .populate('category', 'name slug')
    .sort({ price: 1 })
    .limit(limit)
    .skip(skip);
  }
};

module.exports = mongoose.model('Product', productSchema);
