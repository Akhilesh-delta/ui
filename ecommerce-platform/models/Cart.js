const mongoose = require('mongoose');

const cartSchema = new mongoose.Schema({
  // User association
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User is required']
  },
  
  // Session ID for guest users
  sessionId: {
    type: String,
    required: function() {
      return !this.user;
    }
  },
  
  // Cart Items
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
    variant: {
      name: String,
      value: String,
      priceModifier: {
        type: Number,
        default: 0
      }
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, 'Quantity must be at least 1'],
      max: [100, 'Quantity cannot exceed 100 per item']
    },
    price: {
      type: Number,
      required: true,
      min: [0, 'Price cannot be negative']
    },
    discount: {
      amount: {
        type: Number,
        default: 0
      },
      percentage: {
        type: Number,
        default: 0
      }
    },
    totalPrice: {
      type: Number,
      required: true
    },
    addedAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date,
      default: Date.now
    },
    notes: String
  }],
  
  // Cart Summary
  summary: {
    subtotal: {
      type: Number,
      default: 0,
      min: [0, 'Subtotal cannot be negative']
    },
    tax: {
      type: Number,
      default: 0,
      min: [0, 'Tax cannot be negative']
    },
    shipping: {
      type: Number,
      default: 0,
      min: [0, 'Shipping cannot be negative']
    },
    discount: {
      amount: {
        type: Number,
        default: 0
      },
      code: String,
      type: {
        type: String,
        enum: ['fixed', 'percentage', 'free_shipping']
      }
    },
    total: {
      type: Number,
      default: 0,
      min: [0, 'Total cannot be negative']
    },
    itemCount: {
      type: Number,
      default: 0,
      min: [0, 'Item count cannot be negative']
    },
    uniqueVendors: {
      type: Number,
      default: 0
    }
  },
  
  // Discount Codes
  appliedCoupons: [{
    code: {
      type: String,
      required: true
    },
    discountType: {
      type: String,
      enum: ['fixed', 'percentage', 'free_shipping'],
      required: true
    },
    discountValue: {
      type: Number,
      required: true,
      min: [0, 'Discount value cannot be negative']
    },
    minimumAmount: {
      type: Number,
      default: 0
    },
    appliedAt: {
      type: Date,
      default: Date.now
    },
    expiresAt: Date,
    used: {
      type: Boolean,
      default: false
    }
  }],
  
  // Shipping Information
  shippingAddress: {
    name: String,
    street: String,
    city: String,
    state: String,
    country: {
      type: String,
      default: 'US'
    },
    zipCode: String,
    phone: String,
    email: String
  },
  
  // Cart Preferences
  preferences: {
    currency: {
      type: String,
      default: 'USD',
      enum: ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR']
    },
    saveForLater: [String], // Product IDs
    compareList: [String], // Product IDs for comparison
    notifications: {
      priceDrop: {
        type: Boolean,
        default: false
      },
      backInStock: {
        type: Boolean,
        default: true
      },
      promotions: {
        type: Boolean,
        default: false
      }
    }
  },
  
  // Cart Metadata
  metadata: {
    lastActivity: {
      type: Date,
      default: Date.now
    },
    createdFrom: {
      type: String,
      enum: ['website', 'mobile', 'api', 'guest'],
      default: 'website'
    },
    userAgent: String,
    ipAddress: String,
    referrer: String,
    utm: {
      source: String,
      medium: String,
      campaign: String,
      term: String,
      content: String
    }
  },
  
  // Cart Status
  status: {
    type: String,
    enum: ['active', 'abandoned', 'converted', 'expired'],
    default: 'active'
  },
  
  // Expiration
  expiresAt: {
    type: Date,
    default: function() {
      // Cart expires after 30 days of inactivity
      return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }
  },
  
  // Cart History
  history: [{
    action: {
      type: String,
      enum: ['item_added', 'item_removed', 'quantity_changed', 'coupon_applied', 'coupon_removed', 'address_updated']
    },
    productId: mongoose.Schema.Types.ObjectId,
    details: mongoose.Schema.Types.Mixed,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Wishlist Items
  wishlist: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Recently Viewed (for recommendations)
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
  
  // Cart Recommendations
  recommendations: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    },
    score: {
      type: Number,
      min: 0,
      max: 1
    },
    reason: {
      type: String,
      enum: ['frequently_bought_together', 'similar_items', 'trending', 'personalized', 'category_based']
    },
    generatedAt: {
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
cartSchema.index({ user: 1 });
cartSchema.index({ sessionId: 1 });
cartSchema.index({ status: 1, expiresAt: 1 });
cartSchema.index({ 'metadata.lastActivity': -1 });
cartSchema.index({ 'items.product': 1 });
cartSchema.index({ 'wishlist.product': 1 });

// Virtual for cart age
cartSchema.virtual('cartAge').get(function() {
  return Math.floor((Date.now() - this.createdAt) / (1000 * 60 * 60 * 24)); // days
});

// Virtual for is abandoned
cartSchema.virtual('isAbandoned').get(function() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return this.metadata.lastActivity < sevenDaysAgo && this.status === 'active';
});

// Virtual for total weight (for shipping calculations)
cartSchema.virtual('totalWeight').get(function() {
  return this.items.reduce((total, item) => {
    // This would need to be populated with product weight data
    return total + (item.product?.weight?.value || 0) * item.quantity;
  }, 0);
});

// Instance methods
cartSchema.methods = {
  // Add item to cart
  addItem: function(productId, quantity = 1, variant = null, vendorId = null) {
    return this.populate('items.product').then(cart => {
      const existingItem = cart.items.find(item => 
        item.product._id.toString() === productId.toString() &&
        JSON.stringify(item.variant) === JSON.stringify(variant)
      );
      
      if (existingItem) {
        existingItem.quantity += quantity;
        existingItem.totalPrice = existingItem.quantity * existingItem.price;
        existingItem.updatedAt = new Date();
      } else {
        cart.items.push({
          product: productId,
          vendor: vendorId,
          variant,
          quantity,
          price: 0, // Will be set when product is populated
          totalPrice: 0, // Will be calculated
          addedAt: new Date()
        });
      }
      
      cart.updateSummary();
      cart.addHistory('item_added', productId, { quantity, variant });
      
      return cart.save();
    });
  },
  
  // Remove item from cart
  removeItem: function(productId, variant = null) {
    this.items = this.items.filter(item => 
      !(item.product.toString() === productId.toString() &&
        JSON.stringify(item.variant) === JSON.stringify(variant))
    );
    
    this.updateSummary();
    this.addHistory('item_removed', productId, { variant });
    
    return this.save();
  },
  
  // Update item quantity
  updateQuantity: function(productId, quantity, variant = null) {
    const item = this.items.find(item => 
      item.product.toString() === productId.toString() &&
      JSON.stringify(item.variant) === JSON.stringify(variant)
    );
    
    if (!item) {
      throw new Error('Item not found in cart');
    }
    
    const oldQuantity = item.quantity;
    item.quantity = Math.max(1, quantity);
    item.totalPrice = item.quantity * item.price;
    item.updatedAt = new Date();
    
    this.updateSummary();
    this.addHistory('quantity_changed', productId, { 
      oldQuantity, 
      newQuantity: item.quantity, 
      variant 
    });
    
    return this.save();
  },
  
  // Apply coupon code
  applyCoupon: function(couponCode, couponDetails) {
    // Check if coupon already applied
    const existingCoupon = this.appliedCoupons.find(c => c.code === couponCode);
    
    if (existingCoupon) {
      throw new Error('Coupon already applied');
    }
    
    this.appliedCoupons.push({
      code: couponCode,
      discountType: couponDetails.type,
      discountValue: couponDetails.value,
      minimumAmount: couponDetails.minimumAmount,
      expiresAt: couponDetails.expiresAt
    });
    
    this.updateSummary();
    this.addHistory('coupon_applied', null, { couponCode, discountType: couponDetails.type });
    
    return this.save();
  },
  
  // Remove coupon code
  removeCoupon: function(couponCode) {
    this.appliedCoupons = this.appliedCoupons.filter(c => c.code !== couponCode);
    
    this.updateSummary();
    this.addHistory('coupon_removed', null, { couponCode });
    
    return this.save();
  },
  
  // Update cart summary
  updateSummary: function() {
    // Calculate subtotal
    this.summary.subtotal = this.items.reduce((sum, item) => sum + item.totalPrice, 0);
    
    // Calculate item count
    this.summary.itemCount = this.items.reduce((sum, item) => sum + item.quantity, 0);
    
    // Get unique vendors
    const vendorIds = [...new Set(this.items.map(item => item.vendor?.toString()))];
    this.summary.uniqueVendors = vendorIds.length;
    
    // Apply coupons
    let discountAmount = 0;
    this.appliedCoupons.forEach(coupon => {
      if (this.summary.subtotal >= coupon.minimumAmount) {
        if (coupon.discountType === 'percentage') {
          discountAmount += this.summary.subtotal * (coupon.discountValue / 100);
        } else if (coupon.discountType === 'fixed') {
          discountAmount += coupon.discountValue;
        }
      }
    });
    
    this.summary.discount.amount = discountAmount;
    
    // Calculate total
    this.summary.total = this.summary.subtotal + this.summary.tax + this.summary.shipping - discountAmount;
    
    // Update last activity
    this.metadata.lastActivity = new Date();
    
    return this;
  },
  
  // Add to history
  addHistory: function(action, productId = null, details = {}) {
    this.history.push({
      action,
      productId,
      details,
      timestamp: new Date()
    });
    
    // Keep only last 100 history items
    if (this.history.length > 100) {
      this.history = this.history.slice(-100);
    }
    
    return this;
  },
  
  // Add to wishlist
  addToWishlist: function(productId) {
    const existing = this.wishlist.find(item => item.product.toString() === productId.toString());
    
    if (!existing) {
      this.wishlist.push({
        product: productId,
        addedAt: new Date()
      });
      
      // Keep only last 50 wishlist items
      if (this.wishlist.length > 50) {
        this.wishlist = this.wishlist.slice(-50);
      }
      
      return this.save();
    }
    
    return Promise.resolve(this);
  },
  
  // Remove from wishlist
  removeFromWishlist: function(productId) {
    this.wishlist = this.wishlist.filter(item => item.product.toString() !== productId.toString());
    return this.save();
  },
  
  // Add recently viewed
  addRecentlyViewed: function(productId) {
    const existingIndex = this.recentlyViewed.findIndex(item => 
      item.product.toString() === productId.toString()
    );
    
    if (existingIndex !== -1) {
      this.recentlyViewed[existingIndex].viewedAt = new Date();
    } else {
      this.recentlyViewed.unshift({
        product: productId,
        viewedAt: new Date()
      });
      
      // Keep only last 20 items
      if (this.recentlyViewed.length > 20) {
        this.recentlyViewed = this.recentlyViewed.slice(0, 20);
      }
    }
    
    return this.save();
  },
  
  // Clear cart
  clearCart: function() {
    this.items = [];
    this.appliedCoupons = [];
    this.updateSummary();
    this.addHistory('cart_cleared');
    
    return this.save();
  },
  
  // Convert to order
  convertToOrder: function(orderData) {
    this.status = 'converted';
    this.convertedAt = new Date();
    
    return this.save();
  },
  
  // Get cart value
  getCartValue: function() {
    return {
      subtotal: this.summary.subtotal,
      tax: this.summary.tax,
      shipping: this.summary.shipping,
      discount: this.summary.discount.amount,
      total: this.summary.total,
      itemCount: this.summary.itemCount,
      uniqueVendors: this.summary.uniqueVendors
    };
  },
  
  // Check if cart is empty
  isEmpty: function() {
    return this.items.length === 0;
  },
  
  // Check if cart has minimum amount for checkout
  hasMinimumAmount: function(minimumAmount = 0) {
    return this.summary.subtotal >= minimumAmount;
  },
  
  // Get items by vendor
  getItemsByVendor: function(vendorId) {
    return this.items.filter(item => item.vendor.toString() === vendorId.toString());
  },
  
  // Validate cart before checkout
  validateForCheckout: function() {
    const errors = [];
    
    // Check if cart is empty
    if (this.isEmpty()) {
      errors.push('Cart is empty');
    }
    
    // Check if all items are available
    this.items.forEach(item => {
      if (item.quantity > item.product.inventory.quantity) {
        errors.push(`Insufficient stock for ${item.product.name}`);
      }
    });
    
    // Check coupon validity
    this.appliedCoupons.forEach(coupon => {
      if (coupon.expiresAt && coupon.expiresAt < new Date()) {
        errors.push(`Coupon ${coupon.code} has expired`);
      }
    });
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
};

// Static methods
cartSchema.statics = {
  // Find cart by user
  findByUser: function(userId) {
    return this.findOne({ user: userId, status: 'active' });
  },
  
  // Find cart by session
  findBySession: function(sessionId) {
    return this.findOne({ sessionId, status: 'active' });
  },
  
  // Create or get cart
  findOrCreate: function(userId = null, sessionId = null) {
    const query = userId ? { user: userId } : { sessionId };
    
    return this.findOne({ ...query, status: 'active' }).then(cart => {
      if (cart) {
        // Update last activity
        cart.metadata.lastActivity = new Date();
        return cart.save();
      }
      
      // Create new cart
      return this.create({
        user: userId,
        sessionId,
        metadata: {
          createdFrom: userId ? 'website' : 'guest',
          lastActivity: new Date()
        }
      });
    });
  },
  
  // Get abandoned carts
  getAbandonedCarts: function(daysOld = 7) {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    
    return this.find({
      status: 'active',
      'metadata.lastActivity': { $lt: cutoffDate }
    }).populate('user', 'firstName lastName email');
  },
  
  // Get cart statistics
  getCartStats: function() {
    return this.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalValue: { $sum: '$summary.total' },
          averageValue: { $avg: '$summary.total' },
          totalItems: { $sum: '$summary.itemCount' }
        }
      }
    ]);
  },
  
  // Clean expired carts
  cleanExpiredCarts: function() {
    return this.updateMany(
      { expiresAt: { $lt: new Date() } },
      { status: 'expired' }
    );
  },
  
  // Merge guest cart with user cart
  mergeCarts: function(guestCartId, userId) {
    return Promise.all([
      this.findById(guestCartId),
      this.findByUser(userId)
    ]).then(([guestCart, userCart]) => {
      if (!guestCart) {
        throw new Error('Guest cart not found');
      }
      
      if (!userCart) {
        // Convert guest cart to user cart
        guestCart.user = userId;
        guestCart.sessionId = undefined;
        return guestCart.save();
      }
      
      // Merge items
      guestCart.items.forEach(guestItem => {
        const existingItem = userCart.items.find(item => 
          item.product.toString() === guestItem.product.toString() &&
          JSON.stringify(item.variant) === JSON.stringify(guestItem.variant)
        );
        
        if (existingItem) {
          existingItem.quantity += guestItem.quantity;
          existingItem.totalPrice = existingItem.quantity * existingItem.price;
        } else {
          userCart.items.push(guestItem);
        }
      });
      
      // Merge wishlist
      guestCart.wishlist.forEach(guestItem => {
        const existing = userCart.wishlist.find(item => 
          item.product.toString() === guestItem.product.toString()
        );
        if (!existing) {
          userCart.wishlist.push(guestItem);
        }
      });
      
      userCart.updateSummary();
      
      // Delete guest cart
      return Promise.all([
        userCart.save(),
        this.findByIdAndDelete(guestCartId)
      ]).then(([savedCart]) => savedCart);
    });
  }
};

// Pre-save middleware
cartSchema.pre('save', function(next) {
  // Update summary if items were modified
  if (this.isModified('items') || this.isModified('appliedCoupons')) {
    this.updateSummary();
  }
  
  // Set expiration date
  if (this.isNew) {
    this.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }
  
  next();
});

// Post-save middleware
cartSchema.post('save', function(doc) {
  // Update user's cart items count
  if (doc.user) {
    mongoose.model('User').updateOne(
      { _id: doc.user },
      { 'shopping.cartItemsCount': doc.summary.itemCount }
    ).exec();
  }
});

module.exports = mongoose.model('Cart', cartSchema);
