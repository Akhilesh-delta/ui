const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const cartSchema = new mongoose.Schema({
  // Cart Identification
  cartId: {
    type: String,
    unique: true,
    required: true,
    default: () => uuidv4()
  },
  sessionId: String, // For guest users

  // User Association
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null // Null for guest carts
  },

  // Cart Items (Multi-vendor support)
  items: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true
    },
    name: {
      type: String,
      required: true
    },
    slug: String,
    sku: String,
    image: String,
    price: {
      type: Number,
      required: true,
      min: 0
    },
    originalPrice: {
      type: Number,
      min: 0
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      max: 999
    },
    weight: Number,
    dimensions: {
      length: Number,
      width: Number,
      height: Number
    },
    variant: {
      name: String,
      type: String,
      values: mongoose.Schema.Types.Mixed
    },
    customizations: mongoose.Schema.Types.Mixed,
    notes: String,
    addedAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  }],

  // Cart Pricing Breakdown
  pricing: {
    subtotal: {
      type: Number,
      default: 0,
      min: 0
    },
    discount: {
      type: Number,
      default: 0,
      min: 0
    },
    couponDiscount: {
      type: Number,
      default: 0,
      min: 0
    },
    tax: {
      type: Number,
      default: 0,
      min: 0
    },
    shipping: {
      type: Number,
      default: 0,
      min: 0
    },
    totalItems: {
      type: Number,
      default: 0,
      min: 0
    },
    totalVendors: {
      type: Number,
      default: 0,
      min: 0
    },
    totalAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    vendorBreakdown: [{
      vendor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      store: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store'
      },
      subtotal: Number,
      itemCount: Number,
      shipping: Number,
      tax: Number
    }]
  },

  // Coupons and Promotions
  coupon: {
    code: String,
    discountType: {
      type: String,
      enum: ['percentage', 'fixed_amount']
    },
    discountValue: Number,
    minimumAmount: Number,
    maximumDiscount: Number,
    description: String,
    appliedAt: Date,
    validUntil: Date,
    isActive: {
      type: Boolean,
      default: true
    }
  },

  // Shipping Information
  shipping: {
    method: {
      type: String,
      enum: ['standard', 'express', 'overnight', 'pickup', 'local_delivery'],
      default: 'standard'
    },
    address: {
      firstName: String,
      lastName: String,
      company: String,
      street: String,
      city: String,
      state: String,
      country: String,
      zipCode: String,
      phone: String
    },
    cost: {
      type: Number,
      default: 0,
      min: 0
    },
    estimatedDays: {
      type: Number,
      default: 3,
      min: 1
    },
    freeShippingThreshold: Number,
    eligibleForFreeShipping: {
      type: Boolean,
      default: false
    }
  },

  // Cart Metadata
  source: {
    type: String,
    enum: ['web', 'mobile', 'api', 'pos'],
    default: 'web'
  },
  referrer: String,
  utm: {
    source: String,
    medium: String,
    campaign: String,
    term: String,
    content: String
  },

  // Cart Status and Settings
  status: {
    type: String,
    enum: ['active', 'abandoned', 'converted', 'expired'],
    default: 'active'
  },
  isGuest: {
    type: Boolean,
    default: false
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
  },

  // Cart Analytics
  analytics: {
    createdAt: {
      type: Date,
      default: Date.now
    },
    lastModified: {
      type: Date,
      default: Date.now
    },
    viewCount: {
      type: Number,
      default: 0
    },
    itemAddCount: {
      type: Number,
      default: 0
    },
    itemRemoveCount: {
      type: Number,
      default: 0
    },
    itemUpdateCount: {
      type: Number,
      default: 0
    },
    checkoutAttempts: {
      type: Number,
      default: 0
    },
    abandonedAt: Date,
    convertedAt: Date
  },

  // Cart Preferences
  preferences: {
    currency: {
      type: String,
      default: 'USD',
      enum: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY', 'INR']
    },
    language: {
      type: String,
      default: 'en'
    },
    saveForLater: {
      type: Boolean,
      default: true
    },
    autoUpdatePrices: {
      type: Boolean,
      default: true
    }
  },

  // Wishlist Items (Saved for later)
  wishlist: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    },
    addedAt: {
      type: Date,
      default: Date.now
    },
    notes: String
  }],

  // Cart History and Versions
  history: [{
    action: {
      type: String,
      enum: ['item_added', 'item_removed', 'item_updated', 'coupon_applied', 'coupon_removed', 'checkout_started', 'abandoned', 'converted'],
      required: true
    },
    details: mongoose.Schema.Types.Mixed,
    timestamp: {
      type: Date,
      default: Date.now
    },
    ipAddress: String,
    userAgent: String
  }],

  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
cartSchema.index({ cartId: 1 });
cartSchema.index({ sessionId: 1 });
cartSchema.index({ user: 1 });
cartSchema.index({ status: 1 });
cartSchema.index({ expiresAt: 1 });
cartSchema.index({ 'items.product': 1 });
cartSchema.index({ 'items.vendor': 1 });
cartSchema.index({ 'analytics.lastModified': -1 });
cartSchema.index({ createdAt: -1 });

// Compound indexes
cartSchema.index({ user: 1, status: 1 });
cartSchema.index({ sessionId: 1, status: 1 });
cartSchema.index({ status: 1, expiresAt: 1 });

// Virtual for cart age
cartSchema.virtual('cartAge').get(function() {
  return Math.floor((Date.now() - this.createdAt) / (1000 * 60 * 60 * 24));
});

// Virtual for is expired
cartSchema.virtual('isExpired').get(function() {
  return Date.now() > this.expiresAt;
});

// Virtual for item count
cartSchema.virtual('itemCount').get(function() {
  return this.items.reduce((total, item) => total + item.quantity, 0);
});

// Virtual for unique vendors count
cartSchema.virtual('uniqueVendorsCount').get(function() {
  const vendorIds = [...new Set(this.items.map(item => item.vendor.toString()))];
  return vendorIds.length;
});

// Pre-save middleware
cartSchema.pre('save', function(next) {
  // Update timestamps
  this.updatedAt = new Date();
  this.analytics.lastModified = new Date();

  // Calculate totals
  this.calculateTotals();

  // Update item updatedAt timestamps
  this.items.forEach(item => {
    item.updatedAt = new Date();
  });

  next();
});

// Instance methods
cartSchema.methods = {
  // Add item to cart
  async addItem(productId, quantity = 1, variant = null, customizations = null) {
    const Product = mongoose.model('Product');
    const product = await Product.findById(productId);

    if (!product) {
      throw new Error('Product not found');
    }

    if (!product.isAvailable) {
      throw new Error('Product is not available');
    }

    // Check if item already exists in cart
    const existingItemIndex = this.items.findIndex(item =>
      item.product.equals(productId) &&
      JSON.stringify(item.variant) === JSON.stringify(variant) &&
      JSON.stringify(item.customizations) === JSON.stringify(customizations)
    );

    if (existingItemIndex >= 0) {
      // Update existing item quantity
      this.items[existingItemIndex].quantity += quantity;
      this.items[existingItemIndex].updatedAt = new Date();
    } else {
      // Add new item
      const newItem = {
        product: productId,
        vendor: product.vendor,
        store: product.store,
        name: product.name,
        slug: product.slug,
        sku: product.sku,
        image: product.images[0]?.url,
        price: product.price,
        originalPrice: product.compareAtPrice || product.price,
        quantity,
        variant,
        customizations,
        addedAt: new Date(),
        updatedAt: new Date()
      };

      this.items.push(newItem);
    }

    // Add history entry
    await this.addHistoryEntry('item_added', {
      productId,
      quantity,
      variant,
      customizations
    });

    await this.save();
    return this;
  },

  // Remove item from cart
  async removeItem(productId, variant = null, customizations = null) {
    const itemIndex = this.items.findIndex(item =>
      item.product.equals(productId) &&
      JSON.stringify(item.variant) === JSON.stringify(variant) &&
      JSON.stringify(item.customizations) === JSON.stringify(customizations)
    );

    if (itemIndex === -1) {
      throw new Error('Item not found in cart');
    }

    const removedItem = this.items.splice(itemIndex, 1)[0];

    // Add history entry
    await this.addHistoryEntry('item_removed', {
      productId,
      quantity: removedItem.quantity,
      variant,
      customizations
    });

    await this.save();
    return this;
  },

  // Update item quantity
  async updateItemQuantity(productId, quantity, variant = null, customizations = null) {
    const itemIndex = this.items.findIndex(item =>
      item.product.equals(productId) &&
      JSON.stringify(item.variant) === JSON.stringify(variant) &&
      JSON.stringify(item.customizations) === JSON.stringify(customizations)
    );

    if (itemIndex === -1) {
      throw new Error('Item not found in cart');
    }

    if (quantity <= 0) {
      return this.removeItem(productId, variant, customizations);
    }

    const oldQuantity = this.items[itemIndex].quantity;
    this.items[itemIndex].quantity = quantity;
    this.items[itemIndex].updatedAt = new Date();

    // Add history entry
    await this.addHistoryEntry('item_updated', {
      productId,
      oldQuantity,
      newQuantity: quantity,
      variant,
      customizations
    });

    await this.save();
    return this;
  },

  // Apply coupon to cart
  async applyCoupon(couponCode) {
    const Coupon = mongoose.model('Coupon');
    const coupon = await Coupon.findOne({
      code: couponCode.toUpperCase(),
      isActive: true,
      startDate: { $lte: new Date() },
      $or: [
        { endDate: { $exists: false } },
        { endDate: { $gte: new Date() } }
      ]
    });

    if (!coupon) {
      throw new Error('Invalid or expired coupon');
    }

    // Check minimum amount requirement
    if (coupon.minimumAmount && this.pricing.subtotal < coupon.minimumAmount) {
      throw new Error(`Minimum order amount of $${coupon.minimumAmount} required for this coupon`);
    }

    // Check if coupon is already applied
    if (this.coupon && this.coupon.code === couponCode.toUpperCase()) {
      throw new Error('Coupon already applied');
    }

    // Calculate discount
    let discount = 0;
    if (coupon.discountType === 'percentage') {
      discount = (this.pricing.subtotal * coupon.discountPercentage) / 100;
      if (coupon.maximumDiscount && discount > coupon.maximumDiscount) {
        discount = coupon.maximumDiscount;
      }
    } else {
      discount = Math.min(coupon.discountAmount, this.pricing.subtotal);
    }

    // Apply coupon
    this.coupon = {
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: discount,
      minimumAmount: coupon.minimumAmount,
      maximumDiscount: coupon.maximumDiscount,
      description: coupon.description,
      appliedAt: new Date(),
      validUntil: coupon.endDate
    };

    // Add history entry
    await this.addHistoryEntry('coupon_applied', {
      couponCode,
      discount
    });

    await this.save();
    return this;
  },

  // Remove coupon from cart
  async removeCoupon() {
    if (!this.coupon) {
      throw new Error('No coupon applied');
    }

    const couponCode = this.coupon.code;
    this.coupon = null;

    // Add history entry
    await this.addHistoryEntry('coupon_removed', {
      couponCode
    });

    await this.save();
    return this;
  },

  // Update shipping method
  async updateShippingMethod(method, address = null) {
    this.shipping.method = method;

    if (address) {
      this.shipping.address = address;
    }

    // Recalculate shipping cost
    await this.calculateShippingCost();

    // Add history entry
    await this.addHistoryEntry('shipping_updated', {
      method,
      address: address ? 'updated' : 'unchanged'
    });

    await this.save();
    return this;
  },

  // Calculate cart totals
  calculateTotals() {
    let subtotal = 0;
    let totalItems = 0;
    let vendorBreakdown = [];
    let totalVendors = 0;

    // Calculate subtotal from items
    this.items.forEach(item => {
      const itemTotal = item.price * item.quantity;
      subtotal += itemTotal;
      totalItems += item.quantity;

      // Track vendor breakdown
      const vendorIndex = vendorBreakdown.findIndex(vb =>
        vb.vendor && item.vendor && vb.vendor.equals(item.vendor)
      );

      if (vendorIndex >= 0) {
        vendorBreakdown[vendorIndex].subtotal += itemTotal;
        vendorBreakdown[vendorIndex].itemCount += item.quantity;
      } else {
        vendorBreakdown.push({
          vendor: item.vendor,
          store: item.store,
          subtotal: itemTotal,
          itemCount: item.quantity,
          shipping: 0,
          tax: 0
        });
      }
    });

    totalVendors = vendorBreakdown.length;

    // Calculate discount
    const discount = this.pricing?.discount || 0;
    const couponDiscount = this.coupon?.discountValue || 0;

    // Calculate tax (simplified - in real app, would be more complex)
    const tax = Math.round((subtotal - discount - couponDiscount) * 0.08 * 100) / 100; // 8% tax

    // Calculate shipping
    const shipping = this.calculateShippingCost();

    // Calculate final total
    const totalAmount = subtotal - discount - couponDiscount + tax + shipping;

    this.pricing = {
      subtotal,
      discount,
      couponDiscount,
      tax,
      shipping,
      totalItems,
      totalVendors,
      totalAmount,
      vendorBreakdown
    };
  },

  // Calculate shipping cost
  calculateShippingCost() {
    if (!this.shipping.method) return 0;

    let baseShipping = 0;

    // Calculate shipping based on vendors and items
    const vendorCount = this.uniqueVendorsCount;
    const totalWeight = this.items.reduce((total, item) => {
      return total + ((item.weight || 1) * item.quantity);
    }, 0);

    // Simple shipping calculation
    switch (this.shipping.method) {
      case 'standard':
        baseShipping = 5.99 + (vendorCount - 1) * 2.99; // $5.99 base + $2.99 per additional vendor
        break;
      case 'express':
        baseShipping = 12.99 + (vendorCount - 1) * 5.99;
        break;
      case 'overnight':
        baseShipping = 24.99 + (vendorCount - 1) * 10.99;
        break;
      case 'pickup':
        baseShipping = 0;
        break;
      case 'local_delivery':
        baseShipping = 3.99;
        break;
    }

    // Weight surcharge for heavy items
    if (totalWeight > 10) {
      baseShipping += Math.ceil((totalWeight - 10) / 5) * 2.99;
    }

    // Free shipping calculation
    if (this.shipping.freeShippingThreshold && subtotal >= this.shipping.freeShippingThreshold) {
      baseShipping = 0;
      this.shipping.eligibleForFreeShipping = true;
    }

    this.shipping.cost = Math.round(baseShipping * 100) / 100;
    return this.shipping.cost;
  },

  // Add to wishlist
  async addToWishlist(productId, notes = '') {
    const exists = this.wishlist.some(item => item.product.equals(productId));
    if (exists) {
      throw new Error('Product already in wishlist');
    }

    this.wishlist.push({
      product: productId,
      addedAt: new Date(),
      notes
    });

    await this.save();
    return this;
  },

  // Remove from wishlist
  async removeFromWishlist(productId) {
    const itemIndex = this.wishlist.findIndex(item => item.product.equals(productId));
    if (itemIndex === -1) {
      throw new Error('Product not found in wishlist');
    }

    this.wishlist.splice(itemIndex, 1);
    await this.save();
    return this;
  },

  // Convert to order
  async convertToOrder(orderData = {}) {
    if (this.items.length === 0) {
      throw new Error('Cart is empty');
    }

    const Order = mongoose.model('Order');
    const order = new Order({
      user: this.user,
      items: this.items,
      pricing: this.pricing,
      coupon: this.coupon,
      shipping: this.shipping,
      source: this.source,
      referrer: this.referrer,
      utm: this.utm,
      ...orderData
    });

    const savedOrder = await order.save();

    // Update cart status
    this.status = 'converted';
    this.analytics.convertedAt = new Date();

    // Add history entry
    await this.addHistoryEntry('converted', {
      orderId: savedOrder._id,
      orderNumber: savedOrder.orderNumber
    });

    await this.save();

    // Clear cart items
    this.items = [];
    this.coupon = null;
    this.pricing = {
      subtotal: 0,
      discount: 0,
      couponDiscount: 0,
      tax: 0,
      shipping: 0,
      totalItems: 0,
      totalVendors: 0,
      totalAmount: 0,
      vendorBreakdown: []
    };

    await this.save();

    return savedOrder;
  },

  // Mark as abandoned
  async markAsAbandoned() {
    if (this.status === 'active' && this.analytics.viewCount > 0) {
      this.status = 'abandoned';
      this.analytics.abandonedAt = new Date();

      // Add history entry
      await this.addHistoryEntry('abandoned', {
        viewCount: this.analytics.viewCount,
        itemCount: this.itemCount
      });

      await this.save();
    }
    return this;
  },

  // Add history entry
  async addHistoryEntry(action, details = {}) {
    this.history.push({
      action,
      details,
      timestamp: new Date(),
      ipAddress: details.ipAddress,
      userAgent: details.userAgent
    });

    // Keep only last 50 history entries
    if (this.history.length > 50) {
      this.history = this.history.slice(-50);
    }

    return this;
  },

  // Get cart summary
  getCartSummary() {
    return {
      cartId: this.cartId,
      itemCount: this.itemCount,
      uniqueVendorsCount: this.uniqueVendorsCount,
      subtotal: this.pricing.subtotal,
      discount: this.pricing.discount,
      couponDiscount: this.pricing.couponDiscount,
      tax: this.pricing.tax,
      shipping: this.pricing.shipping,
      totalAmount: this.pricing.totalAmount,
      currency: this.preferences.currency,
      hasCoupon: !!this.coupon,
      isExpired: this.isExpired,
      lastModified: this.analytics.lastModified
    };
  },

  // Validate cart items availability
  async validateItemsAvailability() {
    const Product = mongoose.model('Product');
    const unavailableItems = [];

    for (const item of this.items) {
      const product = await Product.findById(item.product);

      if (!product) {
        unavailableItems.push({
          productId: item.product,
          reason: 'Product not found'
        });
        continue;
      }

      if (!product.isAvailable) {
        unavailableItems.push({
          productId: item.product,
          reason: 'Product not available'
        });
        continue;
      }

      if (product.inventory.trackQuantity &&
          product.inventory.quantity < item.quantity) {
        unavailableItems.push({
          productId: item.product,
          reason: 'Insufficient quantity',
          availableQuantity: product.inventory.quantity,
          requestedQuantity: item.quantity
        });
      }

      if (product.price !== item.price) {
        item.price = product.price;
        item.originalPrice = product.compareAtPrice || product.price;
      }
    }

    if (unavailableItems.length > 0) {
      await this.save();
    }

    return unavailableItems;
  }
};

// Static methods
cartSchema.statics = {
  // Find cart by ID or create new one
  async findOrCreateCart(cartId, sessionId, userId = null) {
    let cart;

    if (cartId) {
      cart = await this.findOne({ cartId });
    }

    if (!cart && sessionId) {
      cart = await this.findOne({ sessionId, user: null });
    }

    if (!cart && userId) {
      cart = await this.findOne({ user: userId, status: 'active' });
    }

    if (!cart) {
      cart = new this({
        sessionId: sessionId || null,
        user: userId || null,
        isGuest: !userId
      });
      await cart.save();
    }

    return cart;
  },

  // Merge guest cart with user cart
  async mergeCarts(guestCartId, userId) {
    const guestCart = await this.findOne({ cartId: guestCartId, user: null });
    const userCart = await this.findOne({ user: userId, status: 'active' });

    if (!guestCart) {
      throw new Error('Guest cart not found');
    }

    if (!userCart) {
      // Convert guest cart to user cart
      guestCart.user = userId;
      guestCart.isGuest = false;
      await guestCart.save();
      return guestCart;
    }

    // Merge items from guest cart to user cart
    for (const item of guestCart.items) {
      await userCart.addItem(
        item.product,
        item.quantity,
        item.variant,
        item.customizations
      );
    }

    // Copy other data
    if (guestCart.coupon && !userCart.coupon) {
      userCart.coupon = guestCart.coupon;
    }

    if (guestCart.shipping.address && !userCart.shipping.address) {
      userCart.shipping = guestCart.shipping;
    }

    // Mark guest cart as converted
    guestCart.status = 'converted';
    await guestCart.save();

    await userCart.save();
    return userCart;
  },

  // Get abandoned carts
  async getAbandonedCarts(daysOld = 7) {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    return this.find({
      status: 'active',
      'analytics.lastModified': { $lt: cutoffDate },
      'analytics.viewCount': { $gt: 0 },
      $or: [
        { user: { $exists: false } },
        { user: null }
      ]
    })
    .populate('items.product', 'name images price')
    .sort({ 'analytics.lastModified': 1 });
  },

  // Clean up expired carts
  async cleanupExpiredCarts() {
    const result = await this.updateMany(
      {
        expiresAt: { $lt: new Date() },
        status: { $ne: 'converted' }
      },
      {
        status: 'expired'
      }
    );

    return result.modifiedCount;
  },

  // Get cart statistics
  async getCartStats() {
    const stats = await this.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          avgItems: { $avg: { $size: '$items' } },
          avgValue: { $avg: '$pricing.totalAmount' },
          totalValue: { $sum: '$pricing.totalAmount' }
        }
      }
    ]);

    return stats;
  }
};

module.exports = mongoose.model('Cart', cartSchema);
