const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  // Basic Order Information
  orderNumber: {
    type: String,
    required: [true, 'Order number is required'],
    unique: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User is required']
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Vendor is required']
  },
  
  // Order Items
  items: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    productName: {
      type: String,
      required: true
    },
    productImage: String,
    sku: String,
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
      min: [1, 'Quantity must be at least 1']
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
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned', 'refunded'],
      default: 'pending'
    },
    tracking: {
      number: String,
      carrier: String,
      url: String,
      shippedAt: Date,
      deliveredAt: Date,
      estimatedDelivery: Date
    },
    notes: String
  }],
  
  // Pricing Information
  subtotal: {
    type: Number,
    required: true,
    min: [0, 'Subtotal cannot be negative']
  },
  tax: {
    type: Number,
    default: 0,
    min: [0, 'Tax cannot be negative']
  },
  shipping: {
    cost: {
      type: Number,
      default: 0,
      min: [0, 'Shipping cost cannot be negative']
    },
    method: {
      type: String,
      enum: ['standard', 'express', 'overnight', 'pickup', 'free']
    },
    estimatedDays: {
      type: Number,
      min: [1, 'Estimated days must be at least 1']
    }
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
  totalAmount: {
    type: Number,
    required: true,
    min: [0, 'Total amount cannot be negative']
  },
  currency: {
    type: String,
    default: 'USD',
    enum: ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR']
  },
  
  // Payment Information
  payment: {
    method: {
      type: String,
      required: true,
      enum: ['credit_card', 'debit_card', 'paypal', 'bank_transfer', 'cash_on_delivery', 'wallet', 'crypto']
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded', 'partially_refunded'],
      default: 'pending'
    },
    transactionId: String,
    paymentIntentId: String,
    gateway: {
      type: String,
      enum: ['stripe', 'paypal', 'square', 'authorize_net', 'braintree']
    },
    card: {
      last4: String,
      brand: String,
      expiryMonth: Number,
      expiryYear: Number
    },
    billingAddress: {
      name: String,
      street: String,
      city: String,
      state: String,
      country: String,
      zipCode: String
    },
    paidAt: Date,
    refundedAt: Date,
    refundAmount: {
      type: Number,
      default: 0
    }
  },
  
  // Shipping Information
  shippingAddress: {
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
    phone: String,
    email: String,
    coordinates: {
      latitude: Number,
      longitude: Number
    },
    instructions: String
  },
  
  // Order Status
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned', 'refunded'],
    default: 'pending'
  },
  statusHistory: [{
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned', 'refunded']
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    notes: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    location: String,
    metadata: mongoose.Schema.Types.Mixed
  }],
  
  // Timeline
  timeline: [{
    event: {
      type: String,
      enum: ['order_placed', 'payment_confirmed', 'processing_started', 'shipped', 'out_for_delivery', 'delivered', 'return_requested', 'return_approved', 'refunded']
    },
    description: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    location: String,
    metadata: mongoose.Schema.Types.Mixed
  }],
  
  // Important Dates
  orderDate: {
    type: Date,
    default: Date.now
  },
  confirmedAt: Date,
  processingAt: Date,
  shippedAt: Date,
  deliveredAt: Date,
  cancelledAt: Date,
  returnRequestedAt: Date,
  returnApprovedAt: Date,
  refundedAt: Date,
  
  // Fulfillment
  fulfillment: {
    status: {
      type: String,
      enum: ['unfulfilled', 'partially_fulfilled', 'fulfilled', 'restocked'],
      default: 'unfulfilled'
    },
    provider: {
      type: String,
      enum: ['vendor', 'third_party', 'dropshipping', 'warehouse']
    },
    tracking: [{
      carrier: String,
      trackingNumber: String,
      url: String,
      shippedAt: Date,
      deliveredAt: Date,
      status: String
    }],
    notes: String
  },
  
  // Returns and Refunds
  returns: [{
    reason: {
      type: String,
      enum: ['wrong_item', 'defective', 'not_as_described', 'changed_mind', 'duplicate', 'other']
    },
    description: String,
    status: {
      type: String,
      enum: ['requested', 'approved', 'rejected', 'received', 'inspected', 'refunded', 'completed']
    },
    requestedAt: {
      type: Date,
      default: Date.now
    },
    approvedAt: Date,
    receivedAt: Date,
    refundedAt: Date,
    refundAmount: Number,
    items: [{
      productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
      },
      quantity: Number,
      reason: String
    }],
    trackingNumber: String,
    notes: String
  }],
  
  // Customer Information
  customer: {
    name: String,
    email: String,
    phone: String,
    notes: String
  },
  
  // Vendor Information
  vendorNotes: String,
  internalNotes: String,
  
  // Tags and Labels
  tags: [String],
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  },
  
  // Communication
  communication: {
    customerNotified: {
      type: Boolean,
      default: false
    },
    lastNotificationSent: Date,
    notificationHistory: [{
      type: {
        type: String,
        enum: ['email', 'sms', 'push']
      },
      event: String,
      sentAt: {
        type: Date,
        default: Date.now
      },
      status: {
        type: String,
        enum: ['sent', 'delivered', 'failed']
      }
    }]
  },
  
  // Risk Assessment
  risk: {
    score: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    factors: [String],
    requiresReview: {
      type: Boolean,
      default: false
    },
    fraudSuspected: {
      type: Boolean,
      default: false
    }
  },
  
  // Analytics
  analytics: {
    source: {
      type: String,
      enum: ['website', 'mobile', 'api', 'admin', 'marketplace']
    },
    campaign: String,
    referrer: String,
    utm: {
      source: String,
      medium: String,
      campaign: String,
      term: String,
      content: String
    }
  },
  
  // Cancellation
  cancellation: {
    reason: String,
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    requestedAt: Date,
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    approvedAt: Date,
    refundAmount: Number,
    notes: String
  },
  
  // Subscription (for recurring orders)
  subscription: {
    isSubscription: {
      type: Boolean,
      default: false
    },
    frequency: {
      type: String,
      enum: ['weekly', 'monthly', 'quarterly', 'yearly']
    },
    nextOrderDate: Date,
    totalOrders: {
      type: Number,
      default: 1
    },
    subscriptionId: String
  },
  
  // Multi-vendor Order Support
  isMultiVendor: {
    type: Boolean,
    default: false
  },
  subOrders: [{
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    items: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OrderItem'
    }],
    subtotal: Number,
    status: String,
    tracking: String
  }],
  
  // External Order IDs
  externalIds: {
    amazon: String,
    ebay: String,
    shopify: String,
    woocommerce: String
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ vendor: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ 'payment.status': 1 });
orderSchema.index({ 'items.product': 1 });
orderSchema.index({ orderDate: -1 });
orderSchema.index({ totalAmount: -1 });
orderSchema.index({ 'shippingAddress.zipCode': 1 });

// Virtual for order age (days since order)
orderSchema.virtual('orderAge').get(function() {
  return Math.floor((Date.now() - this.orderDate) / (1000 * 60 * 60 * 24));
});

// Virtual for is overdue
orderSchema.virtual('isOverdue').get(function() {
  if (this.status === 'delivered' || this.status === 'cancelled') return false;
  // Consider order overdue if it's been pending for more than 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return this.orderDate < sevenDaysAgo;
});

// Virtual for days until delivery
orderSchema.virtual('daysUntilDelivery').get(function() {
  if (!this.timeline.find(t => t.event === 'shipped')) return null;
  const shippedEvent = this.timeline.find(t => t.event === 'shipped');
  const estimatedDelivery = new Date(shippedEvent.timestamp);
  estimatedDelivery.setDate(estimatedDelivery.getDate() + (this.shipping?.estimatedDays || 5));
  return Math.ceil((estimatedDelivery - Date.now()) / (1000 * 60 * 60 * 24));
});

// Instance methods
orderSchema.methods = {
  // Generate order number
  generateOrderNumber: function() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    this.orderNumber = `ORD${year}${month}${day}${random}`;
  },
  
  // Add status change to history
  addStatusChange: function(newStatus, changedBy, notes = '') {
    this.statusHistory.push({
      status: newStatus,
      changedBy,
      notes,
      timestamp: new Date()
    });
    
    // Update main status
    this.status = newStatus;
    
    // Update relevant timestamps
    switch (newStatus) {
      case 'confirmed':
        this.confirmedAt = new Date();
        break;
      case 'processing':
        this.processingAt = new Date();
        break;
      case 'shipped':
        this.shippedAt = new Date();
        break;
      case 'delivered':
        this.deliveredAt = new Date();
        break;
      case 'cancelled':
        this.cancelledAt = new Date();
        break;
    }
    
    return this.save();
  },
  
  // Add timeline event
  addTimelineEvent: function(event, description, location = '', metadata = {}) {
    this.timeline.push({
      event,
      description,
      timestamp: new Date(),
      location,
      metadata
    });
    return this.save();
  },
  
  // Calculate totals
  calculateTotals: function() {
    this.subtotal = this.items.reduce((sum, item) => sum + item.totalPrice, 0);
    
    // Apply discount
    if (this.discount && this.discount.amount) {
      if (this.discount.type === 'percentage') {
        this.discount.amount = this.subtotal * (this.discount.percentage / 100);
      }
    }
    
    // Calculate total
    this.totalAmount = this.subtotal + this.tax + this.shipping.cost - (this.discount?.amount || 0);
    return this.save();
  },
  
  // Update payment status
  updatePaymentStatus: function(status, transactionId = '', metadata = {}) {
    this.payment.status = status;
    
    if (transactionId) {
      this.payment.transactionId = transactionId;
    }
    
    if (status === 'completed') {
      this.payment.paidAt = new Date();
      this.addTimelineEvent('payment_confirmed', 'Payment has been confirmed');
    }
    
    if (status === 'refunded' || status === 'partially_refunded') {
      this.payment.refundedAt = new Date();
    }
    
    return this.save();
  },
  
  // Check if order can be cancelled
  canBeCancelled: function() {
    return ['pending', 'confirmed'].includes(this.status) && 
           this.payment.status !== 'completed';
  },
  
  // Check if order can be returned
  canBeReturned: function() {
    return this.status === 'delivered' && 
           this.deliveredAt && 
           (Date.now() - this.deliveredAt.getTime()) < (30 * 24 * 60 * 60 * 1000); // 30 days
  },
  
  // Process return request
  processReturnRequest: function(reason, description, items, requestedBy) {
    if (!this.canBeReturned()) {
      throw new Error('Order cannot be returned');
    }
    
    this.returns.push({
      reason,
      description,
      status: 'requested',
      requestedAt: new Date(),
      items: items.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
        reason: item.reason
      }))
    });
    
    this.returnRequestedAt = new Date();
    this.addStatusChange('return_requested', requestedBy, `Return requested: ${description}`);
    
    return this.save();
  },
  
  // Get order summary
  getSummary: function() {
    return {
      orderNumber: this.orderNumber,
      status: this.status,
      totalAmount: this.totalAmount,
      itemCount: this.items.length,
      orderDate: this.orderDate,
      customer: this.customer,
      shippingAddress: this.shippingAddress
    };
  },
  
  // Get vendor earnings
  getVendorEarnings: function() {
    const vendorItems = this.items.filter(item => 
      item.product.vendor.toString() === this.vendor.toString()
    );
    const subtotal = vendorItems.reduce((sum, item) => sum + item.totalPrice, 0);
    const commission = subtotal * 0.10; // 10% commission
    const earnings = subtotal - commission;
    
    return {
      subtotal,
      commission,
      earnings,
      itemCount: vendorItems.length
    };
  }
};

// Static methods
orderSchema.statics = {
  // Find orders by user
  findByUser: function(userId, filters = {}) {
    let query = { user: userId };
    
    if (filters.status) query.status = filters.status;
    if (filters.startDate) query.createdAt = { $gte: filters.startDate };
    if (filters.endDate) query.createdAt = { ...query.createdAt, $lte: filters.endDate };
    
    return this.find(query).sort({ createdAt: -1 });
  },
  
  // Find orders by vendor
  findByVendor: function(vendorId, filters = {}) {
    let query = { vendor: vendorId };
    
    if (filters.status) query.status = filters.status;
    if (filters.startDate) query.createdAt = { $gte: filters.startDate };
    if (filters.endDate) query.createdAt = { ...query.createdAt, $lte: filters.endDate };
    
    return this.find(query).sort({ createdAt: -1 });
  },
  
  // Get order statistics
  getOrderStats: function(vendorId = null) {
    const matchStage = vendorId ? { vendor: mongoose.Types.ObjectId(vendorId) } : {};
    
    return this.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
          averageAmount: { $avg: '$totalAmount' }
        }
      }
    ]);
  },
  
  // Get revenue statistics
  getRevenueStats: function(startDate, endDate, vendorId = null) {
    const matchStage = {
      'payment.status': 'completed',
      orderDate: { $gte: startDate, $lte: endDate }
    };
    
    if (vendorId) {
      matchStage.vendor = mongoose.Types.ObjectId(vendorId);
    }
    
    return this.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: {
            year: { $year: '$orderDate' },
            month: { $month: '$orderDate' },
            day: { $dayOfMonth: '$orderDate' }
          },
          totalRevenue: { $sum: '$totalAmount' },
          orderCount: { $sum: 1 },
          averageOrderValue: { $avg: '$totalAmount' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);
  },
  
  // Find pending orders
  findPending: function(hoursOld = 24) {
    const cutoffDate = new Date(Date.now() - hoursOld * 60 * 60 * 1000);
    return this.find({
      status: 'pending',
      createdAt: { $lt: cutoffDate }
    });
  },
  
  // Find orders requiring attention
  findRequiringAttention: function() {
    return this.find({
      $or: [
        { 'risk.requiresReview': true },
        { 'risk.fraudSuspected': true },
        { status: 'pending', orderDate: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        { status: 'return_requested' }
      ]
    });
  }
};

// Pre-save middleware
orderSchema.pre('save', function(next) {
  // Generate order number if not exists
  if (this.isNew && !this.orderNumber) {
    this.generateOrderNumber();
  }
  
  // Calculate totals if items were modified
  if (this.isModified('items')) {
    this.calculateTotals();
  }
  
  // Set customer info from user
  if (this.isNew && this.user) {
    this.customer = {
      name: `${this.user.firstName} ${this.user.lastName}`,
      email: this.user.email,
      phone: this.user.phone
    };
  }
  
  next();
});

// Post-save middleware
orderSchema.post('save', async function(doc) {
  // Update product inventory
  for (const item of doc.items) {
    await mongoose.model('Product').findByIdAndUpdate(item.product, {
      $inc: { 'inventory.quantity': -item.quantity }
    });
  }
  
  // Update user statistics
  if (doc.user) {
    await mongoose.model('User').findByIdAndUpdate(doc.user, {
      $inc: { 
        'shopping.totalOrders': 1,
        'shopping.totalSpent': doc.totalAmount
      }
    });
  }
});

module.exports = mongoose.model('Order', orderSchema);
