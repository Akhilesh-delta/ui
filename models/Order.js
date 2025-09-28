const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const orderSchema = new mongoose.Schema({
  // Order Identification
  orderNumber: {
    type: String,
    unique: true,
    required: true,
    default: () => `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
  },
  shortId: {
    type: String,
    unique: true,
    required: true,
    default: () => Math.random().toString(36).substring(2, 8).toUpperCase()
  },

  // Customer Information
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User is required']
  },
  customerInfo: {
    firstName: String,
    lastName: String,
    email: String,
    phone: String,
    company: String
  },

  // Order Items (Multi-vendor support)
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
      min: 1
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
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'preparing', 'ready', 'shipped', 'delivered', 'cancelled', 'refunded'],
      default: 'pending'
    },
    tracking: {
      number: String,
      url: String,
      carrier: String,
      shippedAt: Date,
      deliveredAt: Date,
      estimatedDelivery: Date
    },
    notes: String
  }],

  // Order Status and Timeline
  status: {
    type: String,
    enum: [
      'pending',           // Order placed, payment pending
      'payment_failed',    // Payment failed
      'payment_confirmed', // Payment confirmed
      'processing',        // Order being processed
      'ready',            // Ready for pickup/shipment
      'shipped',          // Order shipped
      'out_for_delivery', // Out for delivery
      'delivered',        // Delivered
      'completed',        // Completed
      'cancelled',        // Cancelled
      'refunded',         // Refunded
      'partially_refunded', // Partially refunded
      'disputed'          // Under dispute
    ],
    default: 'pending'
  },
  statusHistory: [{
    status: {
      type: String,
      required: true
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
    ipAddress: String
  }],

  // Payment Information
  payment: {
    method: {
      type: String,
      enum: ['credit_card', 'debit_card', 'paypal', 'bank_transfer', 'cash_on_delivery', 'wallet'],
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'cancelled', 'refunded', 'partially_refunded'],
      default: 'pending'
    },
    transactionId: String,
    paymentGateway: String,
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      default: 'USD'
    },
    paidAt: Date,
    refundAmount: {
      type: Number,
      default: 0
    },
    refundReason: String,
    refundTransactionId: String
  },

  // Pricing Breakdown
  pricing: {
    subtotal: {
      type: Number,
      required: true,
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
    insurance: {
      type: Number,
      default: 0,
      min: 0
    },
    handling: {
      type: Number,
      default: 0,
      min: 0
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0
    },
    vendorAmounts: [{
      vendor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      store: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store'
      },
      subtotal: Number,
      commission: Number,
      payoutAmount: Number
    }]
  },

  // Shipping Information
  shipping: {
    method: {
      type: String,
      enum: ['standard', 'express', 'overnight', 'pickup', 'local_delivery'],
      required: true
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
      phone: String,
      coordinates: {
        type: {
          type: String,
          enum: ['Point']
        },
        coordinates: [Number]
      }
    },
    cost: {
      type: Number,
      default: 0,
      min: 0
    },
    trackingNumber: String,
    trackingUrl: String,
    carrier: String,
    shippedAt: Date,
    deliveredAt: Date,
    estimatedDelivery: Date,
    actualDelivery: Date
  },

  // Billing Information
  billing: {
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
    sameAsShipping: {
      type: Boolean,
      default: true
    }
  },

  // Order Notes and Communication
  notes: {
    customer: String,
    vendor: String,
    internal: String,
    admin: String
  },
  tags: [String],

  // Coupons and Promotions
  coupon: {
    code: String,
    discountType: {
      type: String,
      enum: ['percentage', 'fixed_amount']
    },
    discountValue: Number,
    description: String,
    appliedAt: Date
  },

  // Order Fulfillment
  fulfillment: {
    type: {
      type: String,
      enum: ['shipped', 'pickup', 'digital', 'service'],
      default: 'shipped'
    },
    status: {
      type: String,
      enum: ['unfulfilled', 'partially_fulfilled', 'fulfilled', 'restocked'],
      default: 'unfulfilled'
    },
    fulfilledAt: Date,
    fulfilledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },

  // Vendor-specific Order Status
  vendorOrders: [{
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
    items: [{
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
      },
      quantity: Number,
      price: Number,
      status: {
        type: String,
        enum: ['pending', 'confirmed', 'preparing', 'ready', 'shipped', 'delivered', 'cancelled'],
        default: 'pending'
      }
    }],
    subtotal: Number,
    status: {
      type: String,
      enum: ['pending', 'processing', 'ready', 'shipped', 'delivered', 'cancelled'],
      default: 'pending'
    },
    tracking: {
      number: String,
      url: String,
      carrier: String
    },
    notes: String,
    shippedAt: Date,
    deliveredAt: Date
  }],

  // Return and Refund Information
  returns: [{
    items: [{
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
      },
      quantity: Number,
      reason: {
        type: String,
        enum: ['defective', 'wrong_item', 'not_as_described', 'changed_mind', 'duplicate', 'other']
      },
      condition: {
        type: String,
        enum: ['new', 'used', 'damaged']
      }
    }],
    reason: String,
    status: {
      type: String,
      enum: ['requested', 'approved', 'rejected', 'received', 'refunded', 'completed'],
      default: 'requested'
    },
    returnLabel: String,
    refundAmount: Number,
    requestedAt: {
      type: Date,
      default: Date.now
    },
    approvedAt: Date,
    receivedAt: Date,
    refundedAt: Date
  }],

  // Risk and Fraud Detection
  risk: {
    score: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    factors: [String],
    flagged: {
      type: Boolean,
      default: false
    },
    reviewed: {
      type: Boolean,
      default: false
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewedAt: Date
  },

  // Delivery and Logistics
  delivery: {
    instructions: String,
    preferredTime: String,
    signatureRequired: {
      type: Boolean,
      default: false
    },
    adultSignatureRequired: {
      type: Boolean,
      default: false
    },
    leaveAtDoor: {
      type: Boolean,
      default: false
    }
  },

  // Order Metadata
  source: {
    type: String,
    enum: ['web', 'mobile', 'api', 'pos', 'marketplace'],
    default: 'web'
  },
  channel: {
    type: String,
    enum: ['direct', 'google', 'facebook', 'instagram', 'email', 'referral'],
    default: 'direct'
  },
  referrer: String,
  utm: {
    source: String,
    medium: String,
    campaign: String,
    term: String,
    content: String
  },

  // Timestamps and Audit
  orderedAt: {
    type: Date,
    default: Date.now
  },
  confirmedAt: Date,
  shippedAt: Date,
  deliveredAt: Date,
  cancelledAt: Date,
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
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ shortId: 1 });
orderSchema.index({ user: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ 'payment.status': 1 });
orderSchema.index({ 'shipping.address.coordinates': '2dsphere' });
orderSchema.index({ orderedAt: -1 });
orderSchema.index({ createdAt: -1 });

// Compound indexes
orderSchema.index({ user: 1, status: 1 });
orderSchema.index({ status: 1, orderedAt: -1 });
orderSchema.index({ 'items.vendor': 1, status: 1 });
orderSchema.index({ 'vendorOrders.vendor': 1, 'vendorOrders.status': 1 });

// Virtual for order age
orderSchema.virtual('orderAge').get(function() {
  return Math.floor((Date.now() - this.orderedAt) / (1000 * 60 * 60 * 24));
});

// Virtual for is overdue
orderSchema.virtual('isOverdue').get(function() {
  if (this.status === 'delivered' || this.status === 'completed' || this.status === 'cancelled') {
    return false;
  }

  const overdueDays = 30; // Configurable
  const overdueDate = new Date(this.orderedAt.getTime() + overdueDays * 24 * 60 * 60 * 1000);

  return Date.now() > overdueDate;
});

// Virtual for delivery status
orderSchema.virtual('deliveryStatus').get(function() {
  if (this.deliveredAt) return 'delivered';
  if (this.shippedAt) return 'shipped';
  if (this.status === 'ready') return 'ready';
  return 'processing';
});

// Pre-save middleware
orderSchema.pre('save', function(next) {
  // Update timestamps based on status changes
  if (this.isModified('status')) {
    const now = new Date();

    switch (this.status) {
      case 'payment_confirmed':
        this.confirmedAt = now;
        break;
      case 'shipped':
      case 'ready':
        this.shippedAt = now;
        break;
      case 'delivered':
      case 'completed':
        this.deliveredAt = now;
        break;
      case 'cancelled':
        this.cancelledAt = now;
        break;
    }
  }

  // Calculate total amounts
  if (this.isModified('items') || this.isModified('pricing')) {
    this.calculateTotals();
  }

  next();
});

// Instance methods
orderSchema.methods = {
  // Calculate order totals
  calculateTotals() {
    let subtotal = 0;
    let vendorAmounts = [];

    // Calculate subtotal from items
    this.items.forEach(item => {
      const itemTotal = item.price * item.quantity;
      subtotal += itemTotal;

      // Track vendor amounts
      const vendorIndex = vendorAmounts.findIndex(va => va.vendor.equals(item.vendor));
      if (vendorIndex >= 0) {
        vendorAmounts[vendorIndex].subtotal += itemTotal;
      } else {
        vendorAmounts.push({
          vendor: item.vendor,
          store: item.store,
          subtotal: itemTotal
        });
      }
    });

    // Calculate commission and payout amounts
    vendorAmounts = vendorAmounts.map(va => {
      const store = this.items.find(item => item.store.equals(va.store));
      let commissionRate = 10; // Default

      if (store && store.product.category) {
        // Get commission rate from store settings
        commissionRate = 10; // This would be fetched from store settings
      }

      const commission = (va.subtotal * commissionRate) / 100;
      const payoutAmount = va.subtotal - commission;

      return {
        ...va,
        commission,
        payoutAmount
      };
    });

    // Calculate final totals
    const discount = this.pricing?.discount || 0;
    const couponDiscount = this.pricing?.couponDiscount || 0;
    const tax = this.pricing?.tax || 0;
    const shipping = this.pricing?.shipping || 0;

    const totalAmount = subtotal - discount - couponDiscount + tax + shipping;

    this.pricing = {
      ...this.pricing,
      subtotal,
      totalAmount,
      vendorAmounts
    };
  },

  // Add status to history
  async addStatusHistory(status, changedBy, notes = '', location = '', ipAddress = '') {
    await this.updateOne({
      $push: {
        statusHistory: {
          status,
          changedBy,
          notes,
          timestamp: new Date(),
          location,
          ipAddress
        }
      }
    });
  },

  // Update order status
  async updateStatus(newStatus, changedBy, notes = '', location = '', ipAddress = '') {
    const oldStatus = this.status;
    this.status = newStatus;

    // Add to status history
    await this.addStatusHistory(newStatus, changedBy, notes, location, ipAddress);

    // Update item statuses based on order status
    if (newStatus === 'cancelled') {
      this.items.forEach(item => {
        item.status = 'cancelled';
      });
    } else if (newStatus === 'shipped') {
      this.items.forEach(item => {
        if (item.status !== 'cancelled') {
          item.status = 'shipped';
        }
      });
    } else if (newStatus === 'delivered') {
      this.items.forEach(item => {
        if (item.status !== 'cancelled') {
          item.status = 'delivered';
        }
      });
    }

    await this.save();

    // Trigger notifications and updates
    await this.triggerStatusUpdate(oldStatus, newStatus, changedBy);

    return this;
  },

  // Trigger actions based on status change
  async triggerStatusUpdate(oldStatus, newStatus, changedBy) {
    // Update product stats when order is completed
    if (newStatus === 'completed' || newStatus === 'delivered') {
      for (const item of this.items) {
        await mongoose.model('Product').findByIdAndUpdate(item.product, {
          $inc: {
            'stats.salesCount': item.quantity,
            'stats.conversions': 1
          },
          $set: { 'stats.lastPurchased': new Date() }
        });

        // Update vendor stats
        await mongoose.model('User').findByIdAndUpdate(item.vendor, {
          $inc: {
            'vendorProfile.performance.totalSales': item.price * item.quantity,
            'vendorProfile.performance.totalOrders': 1
          }
        });
      }
    }

    // Handle payment confirmation
    if (newStatus === 'payment_confirmed' && oldStatus !== 'payment_confirmed') {
      await this.processPaymentConfirmation(changedBy);
    }

    // Handle shipping
    if (newStatus === 'shipped' && oldStatus !== 'shipped') {
      await this.processShipping(changedBy);
    }

    // Handle delivery
    if (newStatus === 'delivered' && oldStatus !== 'delivered') {
      await this.processDelivery(changedBy);
    }

    // Handle cancellation
    if (newStatus === 'cancelled' && oldStatus !== 'cancelled') {
      await this.processCancellation(changedBy);
    }
  },

  // Process payment confirmation
  async processPaymentConfirmation(confirmedBy) {
    this.payment.status = 'completed';
    this.payment.paidAt = new Date();

    // Update product inventory
    for (const item of this.items) {
      await mongoose.model('Product').findByIdAndUpdate(item.product, {
        $inc: { 'inventory.quantity': -item.quantity }
      });
    }

    await this.save();
  },

  // Process shipping
  async processShipping(shippedBy) {
    // Update shipping information
    if (!this.shipping.shippedAt) {
      this.shipping.shippedAt = new Date();
    }

    // Generate tracking information if not exists
    if (!this.shipping.trackingNumber) {
      this.shipping.trackingNumber = `TRK${Date.now()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    }

    await this.save();

    // Notify customer and vendors
    await this.sendShippingNotification();
  },

  // Process delivery
  async processDelivery(deliveredBy) {
    this.deliveredAt = new Date();

    // Update delivery date
    this.shipping.deliveredAt = new Date();

    await this.save();

    // Update order to completed if all items delivered
    const allDelivered = this.items.every(item => item.status === 'delivered');
    if (allDelivered) {
      await this.updateStatus('completed', deliveredBy, 'All items delivered');
    }

    // Notify customer
    await this.sendDeliveryNotification();
  },

  // Process cancellation
  async processCancellation(cancelledBy) {
    this.cancelledAt = new Date();

    // Restore product inventory
    for (const item of this.items) {
      if (item.status !== 'cancelled') {
        await mongoose.model('Product').findByIdAndUpdate(item.product, {
          $inc: { 'inventory.quantity': item.quantity }
        });
      }
    }

    // Process refund if payment was made
    if (this.payment.status === 'completed') {
      await this.processRefund('Order cancelled by user', cancelledBy);
    }

    await this.save();
  },

  // Process refund
  async processRefund(reason, processedBy, amount = null) {
    const refundAmount = amount || this.payment.amount;

    this.payment.refundAmount = (this.payment.refundAmount || 0) + refundAmount;
    this.payment.refundReason = reason;

    if (this.payment.refundAmount >= this.payment.amount) {
      this.payment.status = 'refunded';
      this.status = 'refunded';
    } else {
      this.status = 'partially_refunded';
    }

    await this.save();

    // Add status history
    await this.addStatusHistory(
      this.status,
      processedBy,
      `Refund processed: $${refundAmount} - ${reason}`
    );

    return this;
  },

  // Create return request
  async createReturnRequest(returnData, requestedBy) {
    const returnRequest = {
      ...returnData,
      status: 'requested',
      requestedAt: new Date()
    };

    await this.updateOne({
      $push: { returns: returnRequest }
    });

    // Update order status if all items are being returned
    const totalReturnQuantity = returnData.items.reduce((sum, item) => sum + item.quantity, 0);
    const totalOrderQuantity = this.items.reduce((sum, item) => sum + item.quantity, 0);

    if (totalReturnQuantity >= totalOrderQuantity) {
      await this.updateStatus('refunded', requestedBy, 'Return request for all items');
    }

    return this;
  },

  // Get vendor-specific order data
  getVendorOrder(vendorId) {
    const vendorItems = this.items.filter(item => item.vendor.equals(vendorId));
    const vendorOrder = this.vendorOrders.find(vo => vo.vendor.equals(vendorId));

    return {
      orderNumber: this.orderNumber,
      orderDate: this.orderedAt,
      customer: this.customerInfo,
      items: vendorItems,
      status: vendorOrder ? vendorOrder.status : this.status,
      subtotal: vendorOrder ? vendorOrder.subtotal : 0,
      tracking: vendorOrder ? vendorOrder.tracking : null,
      shipping: this.shipping
    };
  },

  // Calculate estimated delivery date
  calculateEstimatedDelivery() {
    const processingDays = 1; // Business configurable
    const shippingDays = this.shipping.method === 'express' ? 2 :
                        this.shipping.method === 'overnight' ? 1 : 5;

    const estimatedDate = new Date();
    estimatedDate.setDate(estimatedDate.getDate() + processingDays + shippingDays);

    return estimatedDate;
  },

  // Check if order can be cancelled
  canBeCancelled() {
    const cancellableStatuses = ['pending', 'payment_confirmed', 'processing'];
    return cancellableStatuses.includes(this.status);
  },

  // Check if order can be returned
  canBeReturned() {
    const returnableStatuses = ['delivered', 'completed'];
    const returnWindow = 30; // days

    if (!returnableStatuses.includes(this.status)) return false;
    if (!this.deliveredAt) return false;

    const daysSinceDelivery = Math.floor((Date.now() - this.deliveredAt) / (1000 * 60 * 60 * 24));
    return daysSinceDelivery <= returnWindow;
  },

  // Send notifications
  async sendShippingNotification() {
    // Implementation for sending shipping notifications
    console.log(`Shipping notification for order ${this.orderNumber}`);
  },

  async sendDeliveryNotification() {
    // Implementation for sending delivery notifications
    console.log(`Delivery notification for order ${this.orderNumber}`);
  }
};

// Static methods
orderSchema.statics = {
  // Generate unique order number
  async generateOrderNumber() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `ORD-${timestamp}-${random}`;
  },

  // Find orders by user
  async findByUser(userId, options = {}) {
    const { status, limit = 20, skip = 0, sortBy = 'orderedAt' } = options;

    let query = { user: userId, isDeleted: false };

    if (status) query.status = status;

    let sort = {};
    switch (sortBy) {
      case 'date':
        sort = { orderedAt: -1 };
        break;
      case 'amount':
        sort = { 'pricing.totalAmount': -1 };
        break;
      default:
        sort = { orderedAt: -1 };
    }

    return this.find(query)
      .populate('items.product', 'name slug images')
      .populate('items.vendor', 'firstName lastName')
      .sort(sort)
      .limit(limit)
      .skip(skip);
  },

  // Find orders by vendor
  async findByVendor(vendorId, options = {}) {
    const { status, limit = 20, skip = 0, sortBy = 'orderedAt' } = options;

    let query = {
      'items.vendor': vendorId,
      isDeleted: false
    };

    if (status) query.status = status;

    let sort = {};
    switch (sortBy) {
      case 'date':
        sort = { orderedAt: -1 };
        break;
      case 'amount':
        sort = { 'pricing.totalAmount': -1 };
        break;
      default:
        sort = { orderedAt: -1 };
    }

    return this.find(query)
      .populate('user', 'firstName lastName email')
      .populate('items.product', 'name slug images')
      .sort(sort)
      .limit(limit)
      .skip(skip);
  },

  // Get order statistics
  async getOrderStats(dateRange = 30) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const stats = await this.aggregate([
      {
        $match: {
          orderedAt: { $gte: startDate },
          isDeleted: false
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$pricing.totalAmount' },
          avgAmount: { $avg: '$pricing.totalAmount' }
        }
      }
    ]);

    return stats;
  },

  // Get sales analytics
  async getSalesAnalytics(vendorId = null, dateRange = 30) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    let matchStage = {
      status: { $in: ['completed', 'delivered'] },
      orderedAt: { $gte: startDate },
      isDeleted: false
    };

    if (vendorId) {
      matchStage['items.vendor'] = mongoose.Types.ObjectId(vendorId);
    }

    const analytics = await this.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$orderedAt' } },
            vendor: '$items.vendor'
          },
          orders: { $sum: 1 },
          revenue: { $sum: '$pricing.totalAmount' },
          items: { $sum: { $sum: '$items.quantity' } }
        }
      },
      {
        $group: {
          _id: '$_id.date',
          totalOrders: { $sum: '$orders' },
          totalRevenue: { $sum: '$revenue' },
          totalItems: { $sum: '$items' },
          vendors: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    return analytics;
  },

  // Get pending orders
  async getPendingOrders() {
    return this.find({
      status: { $in: ['pending', 'processing', 'ready'] },
      isDeleted: false
    })
    .populate('user', 'firstName lastName email')
    .populate('items.product', 'name images')
    .sort({ orderedAt: 1 });
  },

  // Get overdue orders
  async getOverdueOrders() {
    const overdueDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    return this.find({
      status: { $nin: ['delivered', 'completed', 'cancelled', 'refunded'] },
      orderedAt: { $lt: overdueDate },
      isDeleted: false
    })
    .populate('user', 'firstName lastName email')
    .sort({ orderedAt: 1 });
  },

  // Bulk update orders
  async bulkUpdate(orderIds, updates) {
    return this.updateMany(
      { _id: { $in: orderIds }, isDeleted: false },
      { $set: updates }
    );
  }
};

module.exports = mongoose.model('Order', orderSchema);
