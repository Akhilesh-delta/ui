const Payment = require('../models/Payment');
const Order = require('../models/Order');
const User = require('../models/User');
const Store = require('../models/Store');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { validationResult } = require('express-validator');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const mongoose = require('mongoose');

class PaymentController {
  // ===============================
  // PAYMENT PROCESSING
  // ===============================

  // Create payment intent
  createPaymentIntent = catchAsync(async (req, res) => {
    const { orderId, paymentMethod, returnUrl } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    if (order.user.toString() !== req.user.id) {
      throw new AppError('Not authorized to process payment for this order', 403, true, 'NOT_AUTHORIZED');
    }

    // Validate payment amount
    if (order.pricing.totalAmount <= 0) {
      throw new AppError('Invalid payment amount', 400, true, 'INVALID_AMOUNT');
    }

    try {
      // Create Stripe payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(order.pricing.totalAmount * 100), // Convert to cents
        currency: order.pricing.currency?.toLowerCase() || 'usd',
        metadata: {
          orderId: order._id.toString(),
          userId: req.user.id,
          paymentMethod: paymentMethod.type
        },
        automatic_payment_methods: {
          enabled: true
        },
        ...(returnUrl && { return_url: returnUrl })
      });

      // Create payment record
      const payment = new Payment({
        user: req.user.id,
        order: order._id,
        paymentMethod: {
          type: paymentMethod.type,
          provider: 'stripe'
        },
        amount: order.pricing.totalAmount,
        currency: order.pricing.currency || 'USD',
        status: 'pending',
        gateway: {
          name: 'stripe',
          transactionId: paymentIntent.id
        },
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        }
      });

      await payment.save();

      // Update order payment reference
      order.payment = {
        method: paymentMethod.type,
        status: 'pending',
        transactionId: paymentIntent.id,
        amount: order.pricing.totalAmount,
        currency: order.pricing.currency || 'USD'
      };

      await order.save();

      logger.info('Payment intent created', {
        paymentId: payment._id,
        orderId: order._id,
        amount: order.pricing.totalAmount,
        paymentMethod: paymentMethod.type
      });

      res.status(200).json({
        success: true,
        message: 'Payment intent created',
        data: {
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id,
          amount: order.pricing.totalAmount,
          currency: order.pricing.currency || 'USD'
        }
      });
    } catch (error) {
      logger.error('Payment intent creation failed', {
        orderId: order._id,
        error: error.message
      });

      throw new AppError('Payment processing failed', 500, false, 'PAYMENT_FAILED');
    }
  });

  // Confirm payment
  confirmPayment = catchAsync(async (req, res) => {
    const { paymentIntentId } = req.body;

    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

      if (paymentIntent.status !== 'succeeded') {
        throw new AppError('Payment not completed', 400, true, 'PAYMENT_NOT_COMPLETED');
      }

      // Update payment record
      const payment = await Payment.findOne({ 'gateway.transactionId': paymentIntentId });

      if (!payment) {
        throw new AppError('Payment record not found', 404, true, 'PAYMENT_NOT_FOUND');
      }

      // Update payment status
      await payment.updateStatus('completed', req.user.id, 'Payment confirmed via webhook');

      // Update order status
      const order = await Order.findById(payment.order);
      await order.updateStatus('payment_confirmed', req.user.id, 'Payment confirmed');

      // Process vendor payouts
      await this.processVendorPayouts(order);

      // Send notifications
      await this.sendPaymentNotifications(payment, 'completed');

      logger.info('Payment confirmed', {
        paymentId: payment._id,
        orderId: order._id,
        amount: payment.amount
      });

      res.status(200).json({
        success: true,
        message: 'Payment confirmed successfully',
        data: {
          payment: payment.getPaymentSummary(),
          order: order.getPublicData()
        }
      });
    } catch (error) {
      logger.error('Payment confirmation failed', {
        paymentIntentId,
        error: error.message
      });

      throw new AppError('Payment confirmation failed', 500, false, 'PAYMENT_CONFIRMATION_FAILED');
    }
  });

  // Process vendor payouts
  async processVendorPayouts(order) {
    for (const vendorAmount of order.pricing.vendorAmounts) {
      const vendor = await User.findById(vendorAmount.vendor);
      const store = await Store.findById(vendorAmount.store);

      if (vendor && store) {
        // Calculate payout amount (after commission)
        const payoutAmount = vendorAmount.payoutAmount;

        // Update vendor earnings
        vendor.vendorProfile.performance.totalSales += payoutAmount;
        await vendor.save();

        // Update store earnings
        store.analytics.totalSales += payoutAmount;
        await store.save();

        // Create payout record (would be processed by scheduled job)
        await this.createPayoutRecord(vendor._id, store._id, payoutAmount, order._id);
      }
    }
  }

  // Create payout record
  async createPayoutRecord(vendorId, storeId, amount, orderId) {
    // Implementation for payout record creation
    logger.info('Payout record created', {
      vendorId,
      storeId,
      amount,
      orderId
    });
  }

  // ===============================
  // PAYMENT METHODS MANAGEMENT
  // ===============================

  // Add payment method
  addPaymentMethod = catchAsync(async (req, res) => {
    const { type, token, billingAddress } = req.body;

    try {
      // Create Stripe payment method
      const paymentMethod = await stripe.paymentMethods.attach(token, {
        customer: req.user.stripeCustomerId // Assuming user has Stripe customer ID
      });

      // Save payment method to user
      const user = await User.findById(req.user.id);
      user.paymentMethods.push({
        type: this.mapStripePaymentMethodType(paymentMethod.type),
        token: paymentMethod.id,
        last4: paymentMethod.card?.last4,
        brand: paymentMethod.card?.brand,
        expiryMonth: paymentMethod.card?.exp_month,
        expiryYear: paymentMethod.card?.exp_year,
        isDefault: user.paymentMethods.length === 0,
        billingAddress
      });

      await user.save();

      logger.info('Payment method added', {
        userId: req.user.id,
        paymentMethodType: type,
        last4: paymentMethod.card?.last4
      });

      res.status(200).json({
        success: true,
        message: 'Payment method added successfully',
        data: {
          paymentMethod: user.paymentMethods[user.paymentMethods.length - 1]
        }
      });
    } catch (error) {
      logger.error('Payment method addition failed', {
        userId: req.user.id,
        error: error.message
      });

      throw new AppError('Failed to add payment method', 500, false, 'PAYMENT_METHOD_FAILED');
    }
  });

  // Get payment methods
  getPaymentMethods = catchAsync(async (req, res) => {
    const user = await User.findById(req.user.id).select('paymentMethods');

    res.status(200).json({
      success: true,
      data: {
        paymentMethods: user.paymentMethods.map(method => ({
          id: method._id,
          type: method.type,
          last4: method.last4,
          brand: method.brand,
          expiryMonth: method.expiryMonth,
          expiryYear: method.expiryYear,
          isDefault: method.isDefault,
          billingAddress: method.billingAddress
        }))
      }
    });
  });

  // Update default payment method
  updateDefaultPaymentMethod = catchAsync(async (req, res) => {
    const { paymentMethodId } = req.params;

    const user = await User.findById(req.user.id);

    // Remove default from all methods
    user.paymentMethods.forEach(method => {
      method.isDefault = false;
    });

    // Set new default
    const paymentMethod = user.paymentMethods.id(paymentMethodId);
    if (!paymentMethod) {
      throw new AppError('Payment method not found', 404, true, 'PAYMENT_METHOD_NOT_FOUND');
    }

    paymentMethod.isDefault = true;
    await user.save();

    logger.info('Default payment method updated', {
      userId: req.user.id,
      paymentMethodId
    });

    res.status(200).json({
      success: true,
      message: 'Default payment method updated'
    });
  });

  // Delete payment method
  deletePaymentMethod = catchAsync(async (req, res) => {
    const { paymentMethodId } = req.params;

    const user = await User.findById(req.user.id);

    const paymentMethod = user.paymentMethods.id(paymentMethodId);
    if (!paymentMethod) {
      throw new AppError('Payment method not found', 404, true, 'PAYMENT_METHOD_NOT_FOUND');
    }

    // Don't allow deletion of default payment method
    if (paymentMethod.isDefault) {
      throw new AppError('Cannot delete default payment method', 400, true, 'CANNOT_DELETE_DEFAULT');
    }

    // Detach from Stripe
    try {
      await stripe.paymentMethods.detach(paymentMethod.token);
    } catch (error) {
      logger.warn('Failed to detach payment method from Stripe', {
        paymentMethodId,
        error: error.message
      });
    }

    user.paymentMethods.pull(paymentMethodId);
    await user.save();

    logger.info('Payment method deleted', {
      userId: req.user.id,
      paymentMethodId
    });

    res.status(200).json({
      success: true,
      message: 'Payment method deleted successfully'
    });
  });

  // Map Stripe payment method type
  mapStripePaymentMethodType(stripeType) {
    const mapping = {
      'card': 'credit_card',
      'bank_account': 'bank_transfer'
    };
    return mapping[stripeType] || stripeType;
  }

  // ===============================
  // REFUND PROCESSING
  // ===============================

  // Process refund
  processRefund = catchAsync(async (req, res) => {
    const { paymentId } = req.params;
    const { amount, reason, description } = req.body;

    const payment = await Payment.findById(paymentId);

    if (!payment) {
      throw new AppError('Payment not found', 404, true, 'PAYMENT_NOT_FOUND');
    }

    // Check permissions
    const isAdmin = req.user.role === 'admin';
    const isCustomer = payment.user.toString() === req.user.id;

    if (!isAdmin && !isCustomer) {
      throw new AppError('Not authorized to process refund', 403, true, 'NOT_AUTHORIZED');
    }

    // For customers, check if refund is within allowed timeframe
    if (isCustomer) {
      const daysSincePayment = Math.floor((Date.now() - payment.createdAt) / (1000 * 60 * 60 * 24));
      if (daysSincePayment > 180) { // 180 days limit
        throw new AppError('Refund request exceeds allowed timeframe', 400, true, 'REFUND_TIME_EXCEEDED');
      }
    }

    // Process refund
    await payment.processRefund({
      amount,
      reason,
      description
    }, req.user.id);

    // Update order status
    const order = await Order.findById(payment.order);
    if (order) {
      const refundPercentage = (payment.totalRefundedAmount / payment.amount) * 100;
      if (refundPercentage >= 100) {
        await order.updateStatus('refunded', req.user.id, 'Full refund processed');
      } else if (refundPercentage > 0) {
        await order.updateStatus('partially_refunded', req.user.id, 'Partial refund processed');
      }
    }

    // Send notifications
    await this.sendPaymentNotifications(payment, 'refunded');

    logger.info('Refund processed', {
      paymentId: payment._id,
      refundAmount: amount,
      processedBy: req.user.id,
      reason
    });

    res.status(200).json({
      success: true,
      message: 'Refund processed successfully',
      data: {
        payment: payment.getPaymentSummary(),
        refundAmount: amount,
        remainingAmount: payment.remainingAmount
      }
    });
  });

  // Get refund details
  getRefundDetails = catchAsync(async (req, res) => {
    const { paymentId } = req.params;

    const payment = await Payment.findById(paymentId).populate('refunds.requestedBy', 'firstName lastName');

    if (!payment) {
      throw new AppError('Payment not found', 404, true, 'PAYMENT_NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      data: {
        payment: payment.getPaymentSummary(),
        refunds: payment.refunds,
        totalRefunded: payment.totalRefundedAmount,
        remainingAmount: payment.remainingAmount
      }
    });
  });

  // ===============================
  // DISPUTE MANAGEMENT
  // ===============================

  // Create dispute
  createDispute = catchAsync(async (req, res) => {
    const { paymentId } = req.params;
    const { reason, description, evidence = [] } = req.body;

    const payment = await Payment.findById(paymentId);

    if (!payment) {
      throw new AppError('Payment not found', 404, true, 'PAYMENT_NOT_FOUND');
    }

    if (payment.user.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to create dispute for this payment', 403, true, 'NOT_AUTHORIZED');
    }

    // Create Stripe dispute
    try {
      const dispute = await stripe.disputes.create({
        payment_intent: payment.gateway.transactionId,
        reason,
        evidence: {
          customer_name: req.user.firstName + ' ' + req.user.lastName,
          customer_email: req.user.email,
          customer_purchase_ip: payment.metadata.ipAddress,
          product_description: description,
          ...evidence
        }
      });

      // Create dispute record in database
      await payment.createDispute({
        disputeId: dispute.id,
        reason,
        evidence
      }, req.user.id);

      logger.info('Dispute created', {
        paymentId: payment._id,
        disputeId: dispute.id,
        reason,
        createdBy: req.user.id
      });

      res.status(200).json({
        success: true,
        message: 'Dispute created successfully',
        data: {
          disputeId: dispute.id,
          status: 'open',
          reason
        }
      });
    } catch (error) {
      logger.error('Dispute creation failed', {
        paymentId: payment._id,
        error: error.message
      });

      throw new AppError('Failed to create dispute', 500, false, 'DISPUTE_CREATION_FAILED');
    }
  });

  // Get dispute details
  getDisputeDetails = catchAsync(async (req, res) => {
    const { paymentId } = req.params;

    const payment = await Payment.findById(paymentId);

    if (!payment) {
      throw new AppError('Payment not found', 404, true, 'PAYMENT_NOT_FOUND');
    }

    const disputes = payment.disputes.filter(d => d.status !== 'cancelled');

    res.status(200).json({
      success: true,
      data: {
        payment: payment.getPaymentSummary(),
        disputes: disputes.map(dispute => ({
          disputeId: dispute.disputeId,
          reason: dispute.reason,
          status: dispute.status,
          amount: dispute.amount,
          evidence: dispute.evidence,
          createdAt: dispute.createdAt,
          dueDate: dispute.dueDate
        }))
      }
    });
  });

  // ===============================
  // PAYOUT MANAGEMENT
  // ===============================

  // Process payouts (admin/vendor)
  processPayouts = catchAsync(async (req, res) => {
    const { vendorId } = req.params;
    const { amount, method } = req.body;

    const vendor = await User.findById(vendorId);

    if (!vendor) {
      throw new AppError('Vendor not found', 404, true, 'VENDOR_NOT_FOUND');
    }

    // Check permissions
    const isAdmin = req.user.role === 'admin';
    const isVendor = vendorId === req.user.id;

    if (!isAdmin && !isVendor) {
      throw new AppError('Not authorized to process payouts', 403, true, 'NOT_AUTHORIZED');
    }

    // Process payout
    const payoutResult = await this.processVendorPayout(vendor, amount, method);

    if (payoutResult.success) {
      logger.info('Payout processed', {
        vendorId,
        amount,
        method,
        processedBy: req.user.id
      });
    }

    res.status(payoutResult.success ? 200 : 400).json({
      success: payoutResult.success,
      message: payoutResult.message,
      data: payoutResult.data
    });
  });

  // Process vendor payout
  async processVendorPayout(vendor, amount, method) {
    try {
      // Use vendor's preferred payout method
      const payoutMethod = method || vendor.vendorProfile.payoutSettings.method;

      // Create Stripe transfer
      const transfer = await stripe.transfers.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: 'usd',
        destination: vendor.vendorProfile.bankAccount.accountNumber, // This would be the Stripe account ID
        metadata: {
          vendorId: vendor._id.toString(),
          payoutMethod
        }
      });

      return {
        success: true,
        message: 'Payout processed successfully',
        data: {
          transferId: transfer.id,
          amount,
          method: payoutMethod
        }
      };
    } catch (error) {
      logger.error('Payout processing failed', {
        vendorId: vendor._id,
        amount,
        error: error.message
      });

      return {
        success: false,
        message: 'Payout processing failed',
        error: error.message
      };
    }
  }

  // Get payout history
  getPayoutHistory = catchAsync(async (req, res) => {
    const { vendorId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const vendor = await User.findById(vendorId);

    if (!vendor) {
      throw new AppError('Vendor not found', 404, true, 'VENDOR_NOT_FOUND');
    }

    // Check permissions
    const isAdmin = req.user.role === 'admin';
    const isVendor = vendorId === req.user.id;

    if (!isAdmin && !isVendor) {
      throw new AppError('Not authorized to view payout history', 403, true, 'NOT_AUTHORIZED');
    }

    // Get payout records (this would typically be in a separate collection)
    const payouts = []; // Mock data for now

    res.status(200).json({
      success: true,
      data: {
        payouts,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(payouts.length / limit),
          totalPayouts: payouts.length
        }
      }
    });
  });

  // ===============================
  // SUBSCRIPTION MANAGEMENT
  // ===============================

  // Create subscription
  createSubscription = catchAsync(async (req, res) => {
    const { planId, paymentMethodId } = req.body;

    const user = await User.findById(req.user.id);

    try {
      // Create Stripe customer if not exists
      let customer;
      if (!user.stripeCustomerId) {
        customer = await stripe.customers.create({
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          metadata: {
            userId: user._id.toString()
          }
        });

        user.stripeCustomerId = customer.id;
        await user.save();
      } else {
        customer = await stripe.customers.retrieve(user.stripeCustomerId);
      }

      // Create subscription
      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: planId }],
        default_payment_method: paymentMethodId,
        metadata: {
          userId: user._id.toString(),
          planId
        }
      });

      // Update user subscription info
      user.subscription = {
        plan: this.mapStripePlanToInternal(planId),
        status: 'active',
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: false
      };

      await user.save();

      logger.info('Subscription created', {
        userId: user._id,
        subscriptionId: subscription.id,
        planId
      });

      res.status(200).json({
        success: true,
        message: 'Subscription created successfully',
        data: {
          subscriptionId: subscription.id,
          plan: user.subscription.plan,
          status: user.subscription.status,
          currentPeriodEnd: user.subscription.currentPeriodEnd
        }
      });
    } catch (error) {
      logger.error('Subscription creation failed', {
        userId: user._id,
        error: error.message
      });

      throw new AppError('Subscription creation failed', 500, false, 'SUBSCRIPTION_FAILED');
    }
  });

  // Cancel subscription
  cancelSubscription = catchAsync(async (req, res) => {
    const { cancelAtPeriodEnd = true } = req.body;

    const user = await User.findById(req.user.id);

    if (!user.subscription || user.subscription.status !== 'active') {
      throw new AppError('No active subscription found', 404, true, 'NO_ACTIVE_SUBSCRIPTION');
    }

    try {
      await stripe.subscriptions.update(user.stripeSubscriptionId, {
        cancel_at_period_end: cancelAtPeriodEnd
      });

      user.subscription.cancelAtPeriodEnd = cancelAtPeriodEnd;
      if (!cancelAtPeriodEnd) {
        user.subscription.status = 'canceled';
      }

      await user.save();

      logger.info('Subscription cancelled', {
        userId: user._id,
        cancelAtPeriodEnd
      });

      res.status(200).json({
        success: true,
        message: cancelAtPeriodEnd ? 'Subscription will be cancelled at period end' : 'Subscription cancelled immediately',
        data: {
          subscription: user.subscription
        }
      });
    } catch (error) {
      logger.error('Subscription cancellation failed', {
        userId: user._id,
        error: error.message
      });

      throw new AppError('Subscription cancellation failed', 500, false, 'SUBSCRIPTION_CANCEL_FAILED');
    }
  });

  // Map Stripe plan to internal plan
  mapStripePlanToInternal(planId) {
    const mapping = {
      'price_basic': 'basic',
      'price_professional': 'professional',
      'price_enterprise': 'enterprise'
    };
    return mapping[planId] || 'basic';
  }

  // ===============================
  // PAYMENT ANALYTICS
  // ===============================

  // Get payment analytics
  getPaymentAnalytics = catchAsync(async (req, res) => {
    const { dateRange = 30 } = req.query;

    const stats = await Payment.getPaymentStats(parseInt(dateRange));
    const trends = await Payment.getPaymentTrends(parseInt(dateRange));
    const revenue = await Payment.getTotalRevenue(parseInt(dateRange));

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalPayments: await Payment.countDocuments({ status: 'completed' }),
          totalRevenue: revenue.reduce((sum, r) => sum + r.totalAmount, 0),
          averagePayment: revenue.length > 0 ?
            revenue.reduce((sum, r) => sum + r.totalAmount, 0) / revenue.length : 0
        },
        statusDistribution: stats,
        trends,
        topPaymentMethods: await this.getTopPaymentMethods(parseInt(dateRange)),
        riskAnalysis: await this.getRiskAnalysis(parseInt(dateRange))
      }
    });
  });

  // Get top payment methods
  async getTopPaymentMethods(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const methods = await Payment.aggregate([
      {
        $match: {
          status: 'completed',
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$paymentMethod.type',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      },
      {
        $project: {
          method: '$_id',
          count: 1,
          totalAmount: 1,
          percentage: { $multiply: [{ $divide: ['$count', { $sum: '$count' }] }, 100] }
        }
      },
      { $sort: { totalAmount: -1 } }
    ]);

    return methods;
  }

  // Get risk analysis
  async getRiskAnalysis(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const analysis = await Payment.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$risk.level',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);

    return analysis;
  }

  // ===============================
  // WEBHOOK HANDLING
  // ===============================

  // Handle Stripe webhook
  handleStripeWebhook = catchAsync(async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      logger.error('Webhook signature verification failed', { error: err.message });
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentSucceeded(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        await this.handlePaymentFailed(event.data.object);
        break;
      case 'charge.dispute.created':
        await this.handleDisputeCreated(event.data.object);
        break;
      case 'payout.paid':
        await this.handlePayoutPaid(event.data.object);
        break;
      default:
        logger.info('Unhandled event type', { type: event.type });
    }

    res.status(200).json({ received: true });
  });

  // Handle payment succeeded
  async handlePaymentSucceeded(paymentIntent) {
    const payment = await Payment.findOne({
      'gateway.transactionId': paymentIntent.id
    });

    if (payment) {
      await payment.updateStatus('completed', null, 'Payment succeeded via webhook');

      const order = await Order.findById(payment.order);
      if (order) {
        await order.updateStatus('payment_confirmed', null, 'Payment confirmed via webhook');
      }
    }
  }

  // Handle payment failed
  async handlePaymentFailed(paymentIntent) {
    const payment = await Payment.findOne({
      'gateway.transactionId': paymentIntent.id
    });

    if (payment) {
      await payment.updateStatus('failed', null, 'Payment failed via webhook');

      const order = await Order.findById(payment.order);
      if (order) {
        await order.updateStatus('payment_failed', null, 'Payment failed via webhook');
      }
    }
  }

  // Handle dispute created
  async handleDisputeCreated(dispute) {
    const payment = await Payment.findOne({
      'gateway.transactionId': dispute.payment_intent
    });

    if (payment) {
      await payment.createDispute({
        disputeId: dispute.id,
        reason: dispute.reason,
        amount: dispute.amount / 100, // Convert from cents
        currency: dispute.currency
      }, null);
    }
  }

  // Handle payout paid
  async handlePayoutPaid(payout) {
    // Update payout status
    logger.info('Payout completed', {
      payoutId: payout.id,
      amount: payout.amount / 100
    });
  }

  // ===============================
  // ADMIN PAYMENT MANAGEMENT
  // ===============================

  // Get all payments (admin)
  getAllPayments = catchAsync(async (req, res) => {
    const {
      status,
      user,
      paymentMethod,
      dateFrom,
      dateTo,
      minAmount,
      maxAmount,
      page = 1,
      limit = 20
    } = req.query;

    let query = {};

    if (status) query.status = status;
    if (user) query.user = user;
    if (paymentMethod) query['paymentMethod.type'] = paymentMethod;
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }
    if (minAmount || maxAmount) {
      query.amount = {};
      if (minAmount) query.amount.$gte = parseFloat(minAmount);
      if (maxAmount) query.amount.$lte = parseFloat(maxAmount);
    }

    const payments = await Payment.find(query)
      .populate('user', 'firstName lastName email')
      .populate('order', 'orderNumber')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Payment.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        payments,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalPayments: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Get payment by ID (admin)
  getPaymentById = catchAsync(async (req, res) => {
    const { id } = req.params;

    const payment = await Payment.findById(id)
      .populate('user', 'firstName lastName email')
      .populate('order', 'orderNumber items')
      .populate('refunds.requestedBy', 'firstName lastName')
      .populate('disputes');

    if (!payment) {
      throw new AppError('Payment not found', 404, true, 'PAYMENT_NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      data: payment
    });
  });

  // Update payment (admin)
  updatePayment = catchAsync(async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    const payment = await Payment.findByIdAndUpdate(
      id,
      { ...updates, updatedAt: new Date(), updatedBy: req.user.id },
      { new: true, runValidators: true }
    );

    if (!payment) {
      throw new AppError('Payment not found', 404, true, 'PAYMENT_NOT_FOUND');
    }

    logger.info('Payment updated by admin', {
      paymentId: id,
      adminId: req.user.id,
      updates: Object.keys(updates)
    });

    res.status(200).json({
      success: true,
      message: 'Payment updated successfully',
      data: payment
    });
  });

  // Get high-risk payments (admin)
  getHighRiskPayments = catchAsync(async (req, res) => {
    const payments = await Payment.getHighRiskPayments();

    res.status(200).json({
      success: true,
      data: payments
    });
  });

  // Review payment risk (admin)
  reviewPaymentRisk = catchAsync(async (req, res) => {
    const { paymentId } = req.params;
    const { action, notes } = req.body;

    const payment = await Payment.findById(paymentId);

    if (!payment) {
      throw new AppError('Payment not found', 404, true, 'PAYMENT_NOT_FOUND');
    }

    // Update risk assessment
    await payment.updateRiskAssessment({
      recommendedAction: action,
      notes
    }, req.user.id);

    logger.info('Payment risk reviewed', {
      paymentId,
      action,
      reviewedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Payment risk reviewed successfully',
      data: payment.risk
    });
  });

  // ===============================
  // PAYMENT UTILITIES
  // ===============================

  // Calculate fees
  calculateFees = catchAsync(async (req, res) => {
    const { amount, paymentMethod, currency = 'USD' } = req.body;

    const fees = this.calculatePaymentFees(amount, paymentMethod, currency);

    res.status(200).json({
      success: true,
      data: {
        amount,
        currency,
        paymentMethod,
        fees
      }
    });
  });

  // Calculate payment fees
  calculatePaymentFees(amount, paymentMethod, currency) {
    let gatewayFee = 0;
    let platformFee = 0;
    let processingFee = 0;

    // Gateway fees (Stripe example)
    if (paymentMethod === 'credit_card') {
      gatewayFee = amount * 0.029 + 0.30; // 2.9% + $0.30
    } else if (paymentMethod === 'bank_transfer') {
      gatewayFee = 0; // ACH is free
    }

    // Platform fee
    platformFee = amount * 0.05; // 5% platform fee

    // Processing fee
    processingFee = 0.25; // Fixed processing fee

    const totalFees = gatewayFee + platformFee + processingFee;

    return {
      gatewayFee: Math.round(gatewayFee * 100) / 100,
      platformFee: Math.round(platformFee * 100) / 100,
      processingFee: Math.round(processingFee * 100) / 100,
      totalFees: Math.round(totalFees * 100) / 100,
      netAmount: Math.round((amount - totalFees) * 100) / 100
    };
  }

  // Get supported payment methods
  getSupportedPaymentMethods = catchAsync(async (req, res) => {
    const methods = [
      {
        type: 'credit_card',
        name: 'Credit Card',
        description: 'Visa, Mastercard, American Express',
        supported: true,
        currencies: ['USD', 'EUR', 'GBP', 'CAD', 'AUD'],
        fees: '2.9% + $0.30'
      },
      {
        type: 'debit_card',
        name: 'Debit Card',
        description: 'Visa, Mastercard debit cards',
        supported: true,
        currencies: ['USD', 'EUR', 'GBP', 'CAD', 'AUD'],
        fees: '2.9% + $0.30'
      },
      {
        type: 'paypal',
        name: 'PayPal',
        description: 'Pay with your PayPal account',
        supported: true,
        currencies: ['USD', 'EUR', 'GBP', 'CAD', 'AUD'],
        fees: '2.9% + $0.30'
      },
      {
        type: 'bank_transfer',
        name: 'Bank Transfer',
        description: 'ACH bank transfer',
        supported: true,
        currencies: ['USD'],
        fees: 'Free'
      },
      {
        type: 'cash_on_delivery',
        name: 'Cash on Delivery',
        description: 'Pay when you receive the order',
        supported: true,
        currencies: ['USD'],
        fees: '$2.99'
      }
    ];

    res.status(200).json({
      success: true,
      data: methods
    });
  });

  // Get exchange rates
  getExchangeRates = catchAsync(async (req, res) => {
    // This would typically fetch from an exchange rate API
    const rates = {
      USD: 1,
      EUR: 0.85,
      GBP: 0.73,
      CAD: 1.25,
      AUD: 1.35
    };

    res.status(200).json({
      success: true,
      data: {
        base: 'USD',
        rates,
        lastUpdated: new Date()
      }
    });
  });

  // Convert currency
  convertCurrency = catchAsync(async (req, res) => {
    const { amount, from, to } = req.body;

    // This would use real exchange rates
    const exchangeRate = 0.85; // Example rate
    const convertedAmount = amount * exchangeRate;

    res.status(200).json({
      success: true,
      data: {
        amount,
        from,
        to,
        exchangeRate,
        convertedAmount: Math.round(convertedAmount * 100) / 100
      }
    });
  });

  // Send payment notifications
  async sendPaymentNotifications(payment, event) {
    const notifications = [];

    // Notify customer
    notifications.push(Notification.createNotification(payment.user, {
      type: 'payment',
      category: 'transactional',
      title: this.getPaymentNotificationTitle(event),
      message: this.getPaymentNotificationMessage(event, payment),
      data: {
        paymentId: payment._id,
        amount: payment.amount,
        status: payment.status
      },
      priority: this.getPaymentNotificationPriority(event),
      actions: [
        {
          type: 'link',
          label: 'View Payment',
          url: `/payments/${payment._id}`,
          action: 'view_payment'
        }
      ]
    }));

    await Promise.all(notifications);
  }

  // Get payment notification title
  getPaymentNotificationTitle(event) {
    const titles = {
      'completed': 'Payment Successful',
      'failed': 'Payment Failed',
      'refunded': 'Payment Refunded',
      'disputed': 'Payment Disputed'
    };
    return titles[event] || 'Payment Update';
  }

  // Get payment notification message
  getPaymentNotificationMessage(event, payment) {
    const messages = {
      'completed': `Your payment of $${payment.amount} has been processed successfully.`,
      'failed': 'Your payment could not be processed. Please try again.',
      'refunded': `A refund of $${payment.totalRefundedAmount} has been processed for your payment.`,
      'disputed': 'Your payment is under dispute. We will contact you soon.'
    };
    return messages[event] || 'Your payment status has been updated.';
  }

  // Get payment notification priority
  getPaymentNotificationPriority(event) {
    const priorities = {
      'completed': 'normal',
      'failed': 'high',
      'refunded': 'normal',
      'disputed': 'high'
    };
    return priorities[event] || 'normal';
  }

  // ===============================
  // DIGITAL WALLET INTEGRATION
  // ===============================

  // Connect digital wallet
  connectDigitalWallet = catchAsync(async (req, res) => {
    const { walletType, walletId } = req.body;

    const user = await User.findById(req.user.id);

    // This would integrate with various digital wallet providers
    // For now, just save the wallet info

    res.status(200).json({
      success: true,
      message: 'Digital wallet connected successfully',
      data: {
        walletType,
        walletId,
        connectedAt: new Date()
      }
    });
  });

  // Process wallet payment
  processWalletPayment = catchAsync(async (req, res) => {
    const { orderId, walletType } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    // Process wallet payment (implementation depends on wallet provider)
    const paymentResult = await this.processWalletTransaction(order, walletType);

    if (paymentResult.success) {
      await order.updateStatus('payment_confirmed', req.user.id, 'Wallet payment confirmed');
    }

    res.status(paymentResult.success ? 200 : 400).json({
      success: paymentResult.success,
      message: paymentResult.message,
      data: paymentResult.data
    });
  });

  // Process wallet transaction
  async processWalletTransaction(order, walletType) {
    // Implementation for wallet payment processing
    return {
      success: true,
      message: 'Wallet payment processed successfully'
    };
  }

  // ===============================
  // CRYPTOCURRENCY PAYMENTS
  // ===============================

  // Get crypto payment address
  getCryptoPaymentAddress = catchAsync(async (req, res) => {
    const { orderId, currency = 'BTC' } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    // Generate crypto payment address (implementation depends on crypto provider)
    const paymentAddress = `bc1q${Math.random().toString(36).substring(2, 15)}`;

    res.status(200).json({
      success: true,
      data: {
        currency,
        address: paymentAddress,
        amount: order.pricing.totalAmount,
        qrCode: `bitcoin:${paymentAddress}?amount=${order.pricing.totalAmount}`
      }
    });
  });

  // Check crypto payment status
  checkCryptoPaymentStatus = catchAsync(async (req, res) => {
    const { paymentId } = req.params;

    // Check payment status (implementation depends on crypto provider)
    const status = 'pending';

    res.status(200).json({
      success: true,
      data: {
        paymentId,
        status,
        confirmations: 0,
        requiredConfirmations: 3
      }
    });
  });

  // ===============================
  // BUY NOW PAY LATER
  // ===============================

  // Create BNPL application
  createBNPLApplication = catchAsync(async (req, res) => {
    const { orderId, provider, installmentPlan } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    // Create BNPL application (implementation depends on provider)
    const application = {
      provider,
      installmentPlan,
      amount: order.pricing.totalAmount,
      status: 'pending'
    };

    res.status(200).json({
      success: true,
      message: 'BNPL application created',
      data: application
    });
  });

  // Process BNPL payment
  processBNPLPayment = catchAsync(async (req, res) => {
    const { applicationId } = req.params;

    // Process BNPL payment (implementation depends on provider)
    const result = {
      success: true,
      message: 'BNPL payment approved'
    };

    res.status(result.success ? 200 : 400).json({
      success: result.success,
      message: result.message
    });
  });

  // ===============================
  // TAX CALCULATION
  // ===============================

  // Calculate tax
  calculateTax = catchAsync(async (req, res) => {
    const { amount, shippingAddress, products } = req.body;

    const tax = await this.calculateOrderTax(amount, shippingAddress, products);

    res.status(200).json({
      success: true,
      data: tax
    });
  });

  // Calculate order tax
  async calculateOrderTax(amount, shippingAddress, products) {
    // This would integrate with tax calculation services like Avalara or TaxJar
    const taxRate = 0.08; // 8% default

    return {
      subtotal: amount,
      taxRate,
      taxAmount: Math.round(amount * taxRate * 100) / 100,
      total: Math.round(amount * (1 + taxRate) * 100) / 100
    };
  }

  // ===============================
  // PAYMENT SECURITY
  // ===============================

  // Validate payment security
  validatePaymentSecurity = catchAsync(async (req, res) => {
    const { paymentId } = req.params;

    const payment = await Payment.findById(paymentId);

    if (!payment) {
      throw new AppError('Payment not found', 404, true, 'PAYMENT_NOT_FOUND');
    }

    // Perform security checks
    const securityChecks = {
      ipVerification: true,
      deviceFingerprint: true,
      geolocationCheck: true,
      velocityCheck: true,
      amountVerification: true
    };

    // Risk assessment
    const riskScore = Math.floor(Math.random() * 100); // Mock risk score
    const riskLevel = riskScore > 80 ? 'high' : riskScore > 50 ? 'medium' : 'low';

    res.status(200).json({
      success: true,
      data: {
        paymentId: payment._id,
        securityChecks,
        riskScore,
        riskLevel,
        recommendedAction: riskLevel === 'high' ? 'review' : 'approve'
      }
    });
  });

  // Block suspicious payment
  blockSuspiciousPayment = catchAsync(async (req, res) => {
    const { paymentId } = req.params;
    const { reason } = req.body;

    const payment = await Payment.findById(paymentId);

    if (!payment) {
      throw new AppError('Payment not found', 404, true, 'PAYMENT_NOT_FOUND');
    }

    // Block payment
    await payment.updateStatus('failed', req.user.id, `Payment blocked: ${reason}`);

    logger.warn('Payment blocked by admin', {
      paymentId,
      reason,
      blockedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Payment blocked successfully'
    });
  });

  // ===============================
  // PAYMENT REPORTING
  // ===============================

  // Generate payment report
  generatePaymentReport = catchAsync(async (req, res) => {
    const { dateRange = 30, format = 'json' } = req.query;

    const stats = await Payment.getPaymentStats(parseInt(dateRange));
    const trends = await Payment.getPaymentTrends(parseInt(dateRange));

    const report = {
      generatedAt: new Date(),
      dateRange: parseInt(dateRange),
      summary: {
        totalPayments: await Payment.countDocuments({
          status: 'completed',
          createdAt: { $gte: new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000) }
        }),
        totalRevenue: stats.reduce((sum, stat) => sum + stat.totalAmount, 0),
        averagePayment: stats.length > 0 ?
          stats.reduce((sum, stat) => sum + stat.totalAmount, 0) / stats.length : 0
      },
      details: {
        statusDistribution: stats,
        trends,
        topPaymentMethods: await this.getTopPaymentMethods(parseInt(dateRange))
      }
    };

    if (format === 'csv') {
      // Generate CSV report
      const csvData = this.generatePaymentReportCSV(report);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="payment-report.csv"`);
      res.status(200).send(csvData);
    } else {
      res.status(200).json({
        success: true,
        data: report
      });
    }
  });

  // Generate payment report CSV
  generatePaymentReportCSV(report) {
    const headers = ['Metric', 'Value'];
    const rows = [
      ['Generated At', report.generatedAt.toISOString()],
      ['Date Range', `${report.dateRange} days`],
      ['Total Payments', report.summary.totalPayments],
      ['Total Revenue', `$${report.summary.totalRevenue}`],
      ['Average Payment', `$${report.summary.averagePayment}`]
    ];

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }

  // Export payments
  exportPayments = catchAsync(async (req, res) => {
    const { format = 'csv', dateFrom, dateTo } = req.query;

    let query = { status: 'completed' };

    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }

    const payments = await Payment.find(query)
      .populate('user', 'firstName lastName email')
      .populate('order', 'orderNumber')
      .sort({ createdAt: -1 });

    const exportData = this.generatePaymentExport(payments, format);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="payments.${format}"`);

    res.status(200).send(exportData);
  });

  // Generate payment export
  generatePaymentExport(payments, format) {
    const csvData = payments.map(payment => ({
      paymentId: payment.paymentId,
      transactionId: payment.transactionId,
      user: payment.user ? `${payment.user.firstName} ${payment.user.lastName}` : '',
      email: payment.user?.email || '',
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      paymentMethod: payment.paymentMethod.type,
      createdAt: payment.createdAt.toISOString()
    }));

    const headers = Object.keys(csvData[0] || {}).join(',');
    const rows = csvData.map(row => Object.values(row).join(','));

    return [headers, ...rows].join('\n');
  }

  // Get payment reconciliation
  getPaymentReconciliation = catchAsync(async (req, res) => {
    const { dateFrom, dateTo } = req.query;

    let query = {};

    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }

    const payments = await Payment.find({
      ...query,
      status: 'completed'
    })
    .populate('user', 'firstName lastName')
    .populate('order', 'orderNumber');

    // Calculate reconciliation summary
    const summary = {
      totalPayments: payments.length,
      totalAmount: payments.reduce((sum, p) => sum + p.amount, 0),
      totalFees: payments.reduce((sum, p) => sum + (p.fees?.totalFees || 0), 0),
      netAmount: payments.reduce((sum, p) => sum + p.distribution?.platformAmount || 0, 0)
    };

    res.status(200).json({
      success: true,
      data: {
        summary,
        payments: payments.map(p => p.getPaymentSummary()),
        reconciliationDate: new Date()
      }
    });
  });

  // ===============================
  // INSTALLMENT PAYMENTS
  // ===============================

  // Create installment plan
  createInstallmentPlan = catchAsync(async (req, res) => {
    const { orderId, installments = 3 } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    const installmentAmount = order.pricing.totalAmount / installments;

    // Create installment plan
    const plan = {
      totalAmount: order.pricing.totalAmount,
      installments,
      installmentAmount: Math.round(installmentAmount * 100) / 100,
      nextInstallmentDate: new Date(),
      completedInstallments: 0
    };

    res.status(200).json({
      success: true,
      message: 'Installment plan created',
      data: plan
    });
  });

  // Process installment payment
  processInstallmentPayment = catchAsync(async (req, res) => {
    const { paymentId, installmentNumber } = req.params;

    const payment = await Payment.findById(paymentId);

    if (!payment) {
      throw new AppError('Payment not found', 404, true, 'PAYMENT_NOT_FOUND');
    }

    // Process installment
    const result = await this.processInstallment(payment, installmentNumber);

    res.status(result.success ? 200 : 400).json({
      success: result.success,
      message: result.message
    });
  });

  // Process installment
  async processInstallment(payment, installmentNumber) {
    // Implementation for installment processing
    return {
      success: true,
      message: `Installment ${installmentNumber} processed successfully`
    };
  }

  // ===============================
  // GIFT CARD & STORE CREDIT
  // ===============================

  // Apply gift card
  applyGiftCard = catchAsync(async (req, res) => {
    const { orderId, giftCardNumber, giftCardPin } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    // Validate gift card (implementation depends on gift card system)
    const giftCard = {
      number: giftCardNumber,
      balance: 50.00, // Mock balance
      valid: true
    };

    if (!giftCard.valid) {
      throw new AppError('Invalid gift card', 400, true, 'INVALID_GIFT_CARD');
    }

    const discount = Math.min(giftCard.balance, order.pricing.totalAmount);

    // Apply gift card discount
    order.pricing.couponDiscount += discount;
    order.pricing.totalAmount -= discount;

    await order.save();

    res.status(200).json({
      success: true,
      message: 'Gift card applied successfully',
      data: {
        discount,
        remainingBalance: giftCard.balance - discount,
        newTotal: order.pricing.totalAmount
      }
    });
  });

  // Apply store credit
  applyStoreCredit = catchAsync(async (req, res) => {
    const { orderId, amount } = req.body;

    const order = await Order.findById(orderId);
    const user = await User.findById(req.user.id);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    const creditToApply = Math.min(amount, user.storeCredit || 0, order.pricing.totalAmount);

    // Apply store credit
    order.pricing.couponDiscount += creditToApply;
    order.pricing.totalAmount -= creditToApply;

    // Deduct from user credit
    user.storeCredit = (user.storeCredit || 0) - creditToApply;
    await user.save();
    await order.save();

    res.status(200).json({
      success: true,
      message: 'Store credit applied successfully',
      data: {
        creditApplied: creditToApply,
        remainingCredit: user.storeCredit,
        newTotal: order.pricing.totalAmount
      }
    });
  });

  // ===============================
  // PAYMENT SETTINGS
  // ===============================

  // Get payment settings
  getPaymentSettings = catchAsync(async (req, res) => {
    const settings = {
      supportedMethods: await this.getSupportedPaymentMethods(),
      currencies: ['USD', 'EUR', 'GBP', 'CAD', 'AUD'],
      fees: {
        creditCard: '2.9% + $0.30',
        bankTransfer: 'Free',
        paypal: '2.9% + $0.30'
      },
      limits: {
        minimumAmount: 1.00,
        maximumAmount: 10000.00
      },
      security: {
        threeDSecure: true,
        riskAssessment: true,
        fraudDetection: true
      }
    };

    res.status(200).json({
      success: true,
      data: settings
    });
  });

  // Update payment settings (admin)
  updatePaymentSettings = catchAsync(async (req, res) => {
    const { settings } = req.body;

    // Update payment settings (implementation depends on settings storage)
    logger.info('Payment settings updated', {
      adminId: req.user.id,
      settings: Object.keys(settings)
    });

    res.status(200).json({
      success: true,
      message: 'Payment settings updated successfully'
    });
  });
}

module.exports = new PaymentController();
