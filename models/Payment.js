const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const paymentSchema = new mongoose.Schema({
  // Payment Identification
  paymentId: {
    type: String,
    unique: true,
    required: true,
    default: () => `PAY-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
  },
  transactionId: {
    type: String,
    unique: true,
    sparse: true // Allow null values but ensure uniqueness when present
  },
  referenceId: String,

  // User and Order Association
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User is required']
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: [true, 'Order is required']
  },

  // Payment Method Details
  paymentMethod: {
    type: {
      type: String,
      enum: [
        'credit_card', 'debit_card', 'paypal', 'apple_pay', 'google_pay',
        'bank_transfer', 'cash_on_delivery', 'wallet', 'cryptocurrency',
        'buy_now_pay_later', 'gift_card', 'store_credit'
      ],
      required: true
    },
    provider: {
      type: String,
      enum: ['stripe', 'paypal', 'square', 'authorize_net', 'braintree', 'adyen', 'worldpay'],
      required: true
    },
    details: {
      // Credit/Debit Card
      cardLast4: String,
      cardBrand: String,
      cardExpiryMonth: Number,
      cardExpiryYear: Number,
      cardFingerprint: String,

      // PayPal
      paypalEmail: String,
      paypalTransactionId: String,

      // Bank Transfer
      bankName: String,
      accountLast4: String,
      routingNumber: String,

      // Digital Wallet
      walletType: String,
      walletId: String,

      // Buy Now Pay Later
      bnplProvider: String,
      installmentPlan: String,

      // Gift Card
      giftCardNumber: String,
      giftCardPin: String
    }
  },

  // Payment Amount and Currency
  amount: {
    type: Number,
    required: [true, 'Amount is required'],
    min: [0, 'Amount cannot be negative']
  },
  currency: {
    type: String,
    default: 'USD',
    enum: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY', 'INR']
  },
  exchangeRate: {
    type: Number,
    default: 1
  },

  // Payment Status and Timeline
  status: {
    type: String,
    enum: [
      'pending',           // Payment initiated
      'processing',        // Being processed
      'authorized',        // Authorized but not captured
      'captured',          // Amount captured
      'completed',         // Payment completed successfully
      'failed',           // Payment failed
      'cancelled',        // Payment cancelled
      'expired',          // Payment expired
      'refunded',         // Fully refunded
      'partially_refunded', // Partially refunded
      'disputed',         // Under dispute
      'chargeback'        // Chargeback initiated
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
    gatewayResponse: mongoose.Schema.Types.Mixed
  }],

  // Gateway Information
  gateway: {
    name: String,
    transactionId: String,
    authorizationCode: String,
    responseCode: String,
    avsResult: String,
    cvvResult: String,
    riskScore: Number,
    riskFactors: [String],
    metadata: mongoose.Schema.Types.Mixed
  },

  // Fee Breakdown
  fees: {
    gatewayFee: {
      type: Number,
      default: 0
    },
    platformFee: {
      type: Number,
      default: 0
    },
    vendorFee: {
      type: Number,
      default: 0
    },
    processingFee: {
      type: Number,
      default: 0
    },
    totalFees: {
      type: Number,
      default: 0
    }
  },

  // Net Amount Distribution
  distribution: {
    platformAmount: {
      type: Number,
      default: 0
    },
    vendorAmount: {
      type: Number,
      default: 0
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
      amount: Number,
      commission: Number,
      netAmount: Number
    }]
  },

  // Refund Information
  refunds: [{
    refundId: {
      type: String,
      required: true,
      default: () => `REF-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    reason: {
      type: String,
      enum: [
        'duplicate', 'fraudulent', 'requested_by_customer',
        'product_not_received', 'product_unacceptable',
        'subscription_cancelled', 'other'
      ],
      required: true
    },
    description: String,
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
      default: 'pending'
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    gatewayRefundId: String,
    requestedAt: {
      type: Date,
      default: Date.now
    },
    processedAt: Date,
    completedAt: Date,
    metadata: mongoose.Schema.Types.Mixed
  }],

  // Dispute Information
  disputes: [{
    disputeId: String,
    reason: {
      type: String,
      enum: [
        'credit_not_processed', 'duplicate_processing',
        'fraudulent', 'general', 'incorrect_account_details',
        'insufficient_funds', 'product_not_received',
        'product_unacceptable', 'subscription_cancelled', 'unrecognized'
      ]
    },
    status: {
      type: String,
      enum: ['open', 'under_review', 'won', 'lost', 'accepted', 'cancelled'],
      default: 'open'
    },
    amount: Number,
    currency: String,
    evidence: [{
      type: String,
      url: String,
      description: String,
      uploadedAt: {
        type: Date,
        default: Date.now
      }
    }],
    response: String,
    dueDate: Date,
    createdAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: Date,
    resolvedAt: Date
  }],

  // Risk Assessment
  risk: {
    score: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    level: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'low'
    },
    factors: [String],
    recommendedAction: {
      type: String,
      enum: ['approve', 'review', 'decline'],
      default: 'approve'
    },
    reviewed: {
      type: Boolean,
      default: false
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewedAt: Date,
    notes: String
  },

  // 3D Secure Information
  threeDSecure: {
    enrolled: Boolean,
    authenticated: Boolean,
    liabilityShift: Boolean,
    version: String,
    eci: String,
    cavv: String,
    xid: String,
    directoryServerTransactionId: String
  },

  // Recurring Payment Information
  recurring: {
    isRecurring: {
      type: Boolean,
      default: false
    },
    subscriptionId: String,
    billingCycle: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']
    },
    nextBillingDate: Date,
    failedAttempts: {
      type: Number,
      default: 0
    },
    maxRetryAttempts: {
      type: Number,
      default: 3
    }
  },

  // Installment Information
  installments: {
    enabled: {
      type: Boolean,
      default: false
    },
    count: Number,
    currentInstallment: {
      type: Number,
      default: 1
    },
    amountPerInstallment: Number,
    nextInstallmentDate: Date,
    completedInstallments: {
      type: Number,
      default: 0
    }
  },

  // Metadata and Context
  metadata: {
    ipAddress: String,
    userAgent: String,
    deviceFingerprint: String,
    geoLocation: {
      country: String,
      state: String,
      city: String,
      coordinates: [Number]
    },
    browserInfo: {
      language: String,
      timezone: String,
      screenResolution: String,
      colorDepth: Number
    },
    source: {
      type: String,
      enum: ['web', 'mobile', 'api', 'pos'],
      default: 'web'
    },
    utm: {
      source: String,
      medium: String,
      campaign: String,
      term: String,
      content: String
    }
  },

  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  authorizedAt: Date,
  capturedAt: Date,
  completedAt: Date,
  failedAt: Date,
  cancelledAt: Date,
  expiredAt: Date,

  // Audit Information
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
paymentSchema.index({ paymentId: 1 });
paymentSchema.index({ transactionId: 1 });
paymentSchema.index({ user: 1 });
paymentSchema.index({ order: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ 'paymentMethod.type': 1 });
paymentSchema.index({ 'paymentMethod.provider': 1 });
paymentSchema.index({ createdAt: -1 });
paymentSchema.index({ amount: 1 });

// Compound indexes
paymentSchema.index({ user: 1, status: 1 });
paymentSchema.index({ order: 1, status: 1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ 'risk.score': -1 });
paymentSchema.index({ 'gateway.transactionId': 1 });

// Virtual for payment age
paymentSchema.virtual('paymentAge').get(function() {
  return Math.floor((Date.now() - this.createdAt) / (1000 * 60 * 60 * 24));
});

// Virtual for is completed
paymentSchema.virtual('isCompleted').get(function() {
  return ['completed', 'refunded', 'partially_refunded'].includes(this.status);
});

// Virtual for total refunded amount
paymentSchema.virtual('totalRefundedAmount').get(function() {
  return this.refunds
    .filter(refund => refund.status === 'completed')
    .reduce((total, refund) => total + refund.amount, 0);
});

// Virtual for remaining amount
paymentSchema.virtual('remainingAmount').get(function() {
  return this.amount - this.totalRefundedAmount;
});

// Pre-save middleware
paymentSchema.pre('save', function(next) {
  // Update timestamps based on status
  if (this.isModified('status')) {
    const now = new Date();

    switch (this.status) {
      case 'authorized':
        this.authorizedAt = now;
        break;
      case 'captured':
        this.capturedAt = now;
        break;
      case 'completed':
        this.completedAt = now;
        break;
      case 'failed':
        this.failedAt = now;
        break;
      case 'cancelled':
        this.cancelledAt = now;
        break;
      case 'expired':
        this.expiredAt = now;
        break;
    }
  }

  // Calculate total fees
  if (this.isModified('fees')) {
    this.fees.totalFees = (this.fees.gatewayFee || 0) +
                         (this.fees.platformFee || 0) +
                         (this.fees.vendorFee || 0) +
                         (this.fees.processingFee || 0);
  }

  next();
});

// Instance methods
paymentSchema.methods = {
  // Add status to history
  async addStatusHistory(status, changedBy, notes = '', gatewayResponse = null) {
    await this.updateOne({
      $push: {
        statusHistory: {
          status,
          changedBy,
          notes,
          timestamp: new Date(),
          gatewayResponse
        }
      }
    });
  },

  // Update payment status
  async updateStatus(newStatus, changedBy, notes = '', gatewayResponse = null) {
    const oldStatus = this.status;
    this.status = newStatus;

    // Add to status history
    await this.addStatusHistory(newStatus, changedBy, notes, gatewayResponse);

    // Update order status based on payment status
    if (newStatus === 'completed' && oldStatus !== 'completed') {
      await mongoose.model('Order').findByIdAndUpdate(this.order, {
        'payment.status': 'completed',
        'payment.paidAt': new Date()
      });
    }

    await this.save();

    // Trigger notifications and updates
    await this.triggerStatusUpdate(oldStatus, newStatus, changedBy);

    return this;
  },

  // Process refund
  async processRefund(refundData, processedBy) {
    const { amount, reason, description } = refundData;

    // Validate refund amount
    if (amount > this.remainingAmount) {
      throw new Error('Refund amount cannot exceed remaining payment amount');
    }

    // Create refund record
    const refund = {
      refundId: `REF-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      amount,
      reason,
      description,
      status: 'pending',
      requestedBy: processedBy,
      requestedAt: new Date()
    };

    await this.updateOne({
      $push: { refunds: refund }
    });

    // Process refund with gateway
    const refundResult = await this.processGatewayRefund(refund);

    // Update refund status
    refund.status = refundResult.success ? 'completed' : 'failed';
    refund.processedBy = processedBy;
    refund.processedAt = new Date();
    refund.gatewayRefundId = refundResult.gatewayRefundId;

    if (refundResult.success) {
      refund.completedAt = new Date();
    }

    await this.updateOne({
      $set: { [`refunds.${this.refunds.length - 1}`]: refund }
    });

    // Update payment status
    const totalRefunded = this.totalRefundedAmount + amount;
    if (totalRefunded >= this.amount) {
      await this.updateStatus('refunded', processedBy, `Full refund processed: $${amount}`);
    } else if (totalRefunded > 0) {
      await this.updateStatus('partially_refunded', processedBy, `Partial refund processed: $${amount}`);
    }

    return refund;
  },

  // Process refund with payment gateway
  async processGatewayRefund(refund) {
    // This would integrate with actual payment gateways
    // For now, simulate the process

    try {
      // Simulate gateway call
      await new Promise(resolve => setTimeout(resolve, 1000));

      return {
        success: true,
        gatewayRefundId: `gw_ref_${Date.now()}`,
        message: 'Refund processed successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  },

  // Capture authorized payment
  async capturePayment(capturedBy, amount = null) {
    if (this.status !== 'authorized') {
      throw new Error('Payment must be authorized before capture');
    }

    const captureAmount = amount || this.amount;

    // Process capture with gateway
    const captureResult = await this.processGatewayCapture(captureAmount);

    if (captureResult.success) {
      await this.updateStatus('captured', capturedBy, `Payment captured: $${captureAmount}`, captureResult);
    } else {
      await this.updateStatus('failed', capturedBy, `Capture failed: ${captureResult.error}`, captureResult);
    }

    return captureResult;
  },

  // Process capture with payment gateway
  async processGatewayCapture(amount) {
    // This would integrate with actual payment gateways
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));

      return {
        success: true,
        gatewayTransactionId: `gw_cap_${Date.now()}`,
        message: 'Payment captured successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  },

  // Void payment
  async voidPayment(voidedBy, reason = 'Payment voided') {
    if (!['authorized', 'pending'].includes(this.status)) {
      throw new Error('Only authorized or pending payments can be voided');
    }

    // Process void with gateway
    const voidResult = await this.processGatewayVoid();

    if (voidResult.success) {
      await this.updateStatus('cancelled', voidedBy, reason, voidResult);
    } else {
      throw new Error(`Void failed: ${voidResult.error}`);
    }

    return voidResult;
  },

  // Process void with payment gateway
  async processGatewayVoid() {
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));

      return {
        success: true,
        message: 'Payment voided successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  },

  // Create dispute
  async createDispute(disputeData, createdBy) {
    const dispute = {
      disputeId: `DIS-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      ...disputeData,
      createdAt: new Date()
    };

    await this.updateOne({
      $push: { disputes: dispute },
      status: 'disputed'
    });

    // Add status history
    await this.addStatusHistory('disputed', createdBy, `Dispute created: ${dispute.reason}`);

    return dispute;
  },

  // Update risk assessment
  async updateRiskAssessment(riskData, assessedBy) {
    this.risk = {
      ...this.risk,
      ...riskData,
      reviewed: true,
      reviewedBy: assessedBy,
      reviewedAt: new Date()
    };

    await this.save();

    // Take action based on risk recommendation
    if (riskData.recommendedAction === 'decline' && ['pending', 'authorized'].includes(this.status)) {
      await this.updateStatus('failed', assessedBy, 'Payment declined due to high risk');
    } else if (riskData.recommendedAction === 'review') {
      // Flag for manual review
      this.risk.reviewed = false;
    }

    return this;
  },

  // Get payment summary
  getPaymentSummary() {
    return {
      paymentId: this.paymentId,
      transactionId: this.transactionId,
      amount: this.amount,
      currency: this.currency,
      status: this.status,
      paymentMethod: this.paymentMethod.type,
      provider: this.paymentMethod.provider,
      createdAt: this.createdAt,
      completedAt: this.completedAt,
      totalRefundedAmount: this.totalRefundedAmount,
      remainingAmount: this.remainingAmount,
      riskScore: this.risk.score,
      riskLevel: this.risk.level
    };
  },

  // Trigger status update actions
  async triggerStatusUpdate(oldStatus, newStatus, changedBy) {
    // Update order status
    if (newStatus === 'completed') {
      await mongoose.model('Order').findByIdAndUpdate(this.order, {
        'payment.status': 'completed',
        'payment.paidAt': new Date()
      });
    }

    // Handle failed payments
    if (newStatus === 'failed' && oldStatus !== 'failed') {
      await mongoose.model('Order').findByIdAndUpdate(this.order, {
        'payment.status': 'failed',
        status: 'payment_failed'
      });
    }

    // Handle refunds
    if (newStatus === 'refunded' || newStatus === 'partially_refunded') {
      await mongoose.model('Order').findByIdAndUpdate(this.order, {
        'payment.status': newStatus,
        'payment.refundAmount': this.totalRefundedAmount
      });
    }

    // Send notifications
    await this.sendPaymentNotification(newStatus);
  },

  // Send payment notification
  async sendPaymentNotification(status) {
    // Implementation for sending payment notifications
    console.log(`Payment notification: ${this.paymentId} - ${status}`);
  }
};

// Static methods
paymentSchema.statics = {
  // Find payments by user
  async findByUser(userId, options = {}) {
    const { status, limit = 20, skip = 0, sortBy = 'createdAt' } = options;

    let query = { user: userId };

    if (status) query.status = status;

    let sort = {};
    switch (sortBy) {
      case 'amount':
        sort = { amount: -1 };
        break;
      case 'date':
      default:
        sort = { createdAt: -1 };
    }

    return this.find(query)
      .populate('order', 'orderNumber items')
      .sort(sort)
      .limit(limit)
      .skip(skip);
  },

  // Find payments by order
  async findByOrder(orderId) {
    return this.find({ order: orderId })
      .sort({ createdAt: -1 });
  },

  // Get payment statistics
  async getPaymentStats(dateRange = 30) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const stats = await this.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          avgAmount: { $avg: '$amount' }
        }
      }
    ]);

    return stats;
  },

  // Get payments by status
  async getByStatus(status) {
    return this.find({ status })
      .populate('user', 'firstName lastName email')
      .populate('order', 'orderNumber')
      .sort({ createdAt: -1 });
  },

  // Get high-risk payments
  async getHighRiskPayments() {
    return this.find({
      'risk.level': { $in: ['high', 'critical'] },
      status: { $in: ['pending', 'authorized'] }
    })
    .populate('user', 'firstName lastName email')
    .populate('order', 'orderNumber')
    .sort({ 'risk.score': -1 });
  },

  // Get pending refunds
  async getPendingRefunds() {
    return this.find({
      'refunds.status': 'pending'
    })
    .populate('user', 'firstName lastName email')
    .populate('order', 'orderNumber')
    .sort({ 'refunds.requestedAt': 1 });
  },

  // Get disputed payments
  async getDisputedPayments() {
    return this.find({
      'disputes.status': { $in: ['open', 'under_review'] }
    })
    .populate('user', 'firstName lastName email')
    .populate('order', 'orderNumber')
    .sort({ 'disputes.createdAt': -1 });
  },

  // Calculate total revenue
  async getTotalRevenue(dateRange = 30) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const result = await this.aggregate([
      {
        $match: {
          status: 'completed',
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$currency',
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 },
          totalFees: { $sum: '$fees.totalFees' },
          netRevenue: { $sum: { $subtract: ['$amount', '$fees.totalFees'] } }
        }
      }
    ]);

    return result;
  },

  // Get payment trends
  async getPaymentTrends(days = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const trends = await this.aggregate([
      {
        $match: {
          status: 'completed',
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            paymentMethod: '$paymentMethod.type'
          },
          count: { $sum: 1 },
          amount: { $sum: '$amount' }
        }
      },
      {
        $group: {
          _id: '$_id.date',
          totalAmount: { $sum: '$amount' },
          totalCount: { $sum: '$count' },
          methods: {
            $push: {
              method: '$_id.paymentMethod',
              count: '$count',
              amount: '$amount'
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    return trends;
  },

  // Process recurring payments
  async processRecurringPayments() {
    const duePayments = await this.find({
      'recurring.isRecurring': true,
      'recurring.nextBillingDate': { $lte: new Date() },
      status: 'completed'
    });

    const results = [];

    for (const payment of duePayments) {
      try {
        // Create new payment for recurring charge
        const newPayment = new this({
          user: payment.user,
          order: payment.order,
          paymentMethod: payment.paymentMethod,
          amount: payment.amount,
          currency: payment.currency,
          recurring: {
            ...payment.recurring,
            currentInstallment: payment.recurring.currentInstallment + 1
          }
        });

        await newPayment.save();

        // Update next billing date
        const nextBillingDate = new Date(payment.recurring.nextBillingDate);
        switch (payment.recurring.billingCycle) {
          case 'weekly':
            nextBillingDate.setDate(nextBillingDate.getDate() + 7);
            break;
          case 'monthly':
            nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
            break;
          case 'quarterly':
            nextBillingDate.setMonth(nextBillingDate.getMonth() + 3);
            break;
          case 'yearly':
            nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);
            break;
        }

        await payment.updateOne({
          'recurring.nextBillingDate': nextBillingDate
        });

        results.push({ success: true, paymentId: newPayment.paymentId });
      } catch (error) {
        results.push({ success: false, paymentId: payment.paymentId, error: error.message });
      }
    }

    return results;
  },

  // Bulk update payments
  async bulkUpdate(paymentIds, updates) {
    return this.updateMany(
      { _id: { $in: paymentIds } },
      { $set: updates }
    );
  }
};

module.exports = mongoose.model('Payment', paymentSchema);
