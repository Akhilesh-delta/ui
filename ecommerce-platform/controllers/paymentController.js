const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Order = require('../models/Order');
const User = require('../models/User');
const { authenticate, sanitizeInput } = require('../middleware/authMiddleware');

// @desc    Create payment intent
// @route   POST /api/payments/create-payment-intent
// @access  Private
const createPaymentIntent = async (req, res) => {
  try {
    const { orderId, paymentMethodId, savePaymentMethod = false } = req.body;
    const userId = req.user._id;

    if (!orderId || !paymentMethodId) {
      return res.status(400).json({
        success: false,
        error: 'Order ID and payment method are required'
      });
    }

    const order = await Order.findOne({ _id: orderId, user: userId });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    if (order.payment.status === 'completed') {
      return res.status(400).json({
        success: false,
        error: 'Order has already been paid'
      });
    }

    // Create payment intent with Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(order.totalAmount * 100), // Convert to cents
      currency: order.currency.toLowerCase(),
      payment_method: paymentMethodId,
      confirm: true,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        orderId: order._id.toString(),
        userId: userId.toString(),
        orderNumber: order.orderNumber
      },
      description: `Payment for order ${order.orderNumber}`,
      receipt_email: req.user.email,
      shipping: {
        name: order.shippingAddress.name,
        address: {
          line1: order.shippingAddress.street,
          city: order.shippingAddress.city,
          state: order.shippingAddress.state,
          postal_code: order.shippingAddress.zipCode,
          country: order.shippingAddress.country
        }
      }
    });

    // Update order with payment intent
    order.payment = {
      method: 'credit_card',
      status: paymentIntent.status === 'succeeded' ? 'completed' : 'processing',
      transactionId: paymentIntent.id,
      paymentIntentId: paymentIntent.id,
      gateway: 'stripe',
      paidAt: paymentIntent.status === 'succeeded' ? new Date() : undefined,
      card: {
        last4: paymentIntent.payment_method ? '****' : undefined,
        brand: paymentIntent.payment_method ? 'card' : undefined
      }
    };

    if (paymentIntent.status === 'succeeded') {
      order.addStatusChange('confirmed', userId, 'Payment completed successfully');
      order.addTimelineEvent('payment_confirmed', 'Payment has been confirmed');
    }

    await order.save();

    // Save payment method if requested
    if (savePaymentMethod && paymentIntent.payment_method) {
      await savePaymentMethodForUser(userId, paymentIntent.payment_method);
    }

    res.json({
      success: true,
      data: {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        requiresAction: paymentIntent.status === 'requires_action',
        nextAction: paymentIntent.next_action
      }
    });

  } catch (error) {
    console.error('Create payment intent error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create payment intent'
    });
  }
};

// @desc    Confirm payment
// @route   POST /api/payments/confirm-payment
// @access  Private
const confirmPayment = async (req, res) => {
  try {
    const { paymentIntentId } = req.body;
    const userId = req.user._id;

    if (!paymentIntentId) {
      return res.status(400).json({
        success: false,
        error: 'Payment intent ID is required'
      });
    }

    // Retrieve payment intent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.metadata.userId !== userId.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    // Update order based on payment status
    const order = await Order.findById(paymentIntent.metadata.orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    let updateData = {};

    switch (paymentIntent.status) {
      case 'succeeded':
        updateData = {
          'payment.status': 'completed',
          'payment.paidAt': new Date(),
          'payment.transactionId': paymentIntent.id,
          'payment.card': {
            last4: paymentIntent.charges.data[0]?.payment_method_details?.card?.last4,
            brand: paymentIntent.charges.data[0]?.payment_method_details?.card?.brand
          }
        };

        // Update order status
        await order.addStatusChange('confirmed', userId, 'Payment completed successfully');
        await order.addTimelineEvent('payment_confirmed', 'Payment has been confirmed');

        // Send confirmation email
        await sendPaymentConfirmationEmail(order, req.user);

        break;

      case 'requires_action':
        return res.json({
          success: true,
          data: {
            requiresAction: true,
            clientSecret: paymentIntent.client_secret,
            nextAction: paymentIntent.next_action
          }
        });

      case 'canceled':
        updateData = {
          'payment.status': 'cancelled'
        };
        break;

      default:
        updateData = {
          'payment.status': 'failed'
        };
    }

    // Update order
    const updatedOrder = await Order.findByIdAndUpdate(
      order._id,
      { $set: updateData },
      { new: true }
    );

    res.json({
      success: true,
      data: {
        status: paymentIntent.status,
        order: {
          id: updatedOrder._id,
          orderNumber: updatedOrder.orderNumber,
          status: updatedOrder.status,
          payment: updatedOrder.payment
        }
      }
    });

  } catch (error) {
    console.error('Confirm payment error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to confirm payment'
    });
  }
};

// @desc    Process refund
// @route   POST /api/payments/refund
// @access  Private (Vendor/Admin)
const processRefund = async (req, res) => {
  try {
    const { orderId, amount, reason = 'Customer requested refund' } = req.body;
    const userId = req.user._id;

    if (!orderId || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Order ID and amount are required'
      });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    // Check authorization
    if (order.vendor.toString() !== userId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only process refunds for your own orders.'
      });
    }

    if (order.payment.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: 'Cannot refund order that has not been paid'
      });
    }

    const refundAmount = parseFloat(amount);
    if (refundAmount <= 0 || refundAmount > order.totalAmount) {
      return res.status(400).json({
        success: false,
        error: 'Invalid refund amount'
      });
    }

    // Process refund with Stripe
    const refund = await stripe.refunds.create({
      payment_intent: order.payment.paymentIntentId,
      amount: Math.round(refundAmount * 100), // Convert to cents
      reason: 'requested_by_customer',
      metadata: {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        refundReason: reason
      }
    });

    // Update order
    order.payment.status = refundAmount === order.totalAmount ? 'refunded' : 'partially_refunded';
    order.payment.refundedAt = new Date();
    order.payment.refundAmount = (order.payment.refundAmount || 0) + refundAmount;

    // Add timeline event
    await order.addTimelineEvent('refunded', `Refund processed: $${refundAmount}`, '', {
      refundAmount,
      refundReason: reason,
      stripeRefundId: refund.id
    });

    await order.save();

    // Send refund notification
    const customer = await User.findById(order.user);
    await sendEmail({
      to: customer.email,
      subject: `Refund Processed - ${order.orderNumber}`,
      template: 'refundNotification',
      data: {
        customerName: customer.firstName,
        orderNumber: order.orderNumber,
        refundAmount,
        reason,
        orderUrl: `${process.env.FRONTEND_URL}/orders/${order._id}`
      }
    });

    res.json({
      success: true,
      message: 'Refund processed successfully',
      data: {
        refund: {
          id: refund.id,
          amount: refund.amount / 100,
          status: refund.status,
          reason: refund.reason
        },
        order: {
          id: order._id,
          orderNumber: order.orderNumber,
          payment: order.payment
        }
      }
    });

  } catch (error) {
    console.error('Process refund error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process refund'
    });
  }
};

// @desc    Get payment methods
// @route   GET /api/payments/payment-methods
// @access  Private
const getPaymentMethods = async (req, res) => {
  try {
    const userId = req.user._id;

    // Get user's saved payment methods from Stripe
    const paymentMethods = await stripe.paymentMethods.list({
      customer: req.user.stripeCustomerId,
      type: 'card'
    });

    const formattedMethods = paymentMethods.data.map(method => ({
      id: method.id,
      type: method.type,
      card: {
        brand: method.card.brand,
        last4: method.card.last4,
        expMonth: method.card.exp_month,
        expYear: method.card.exp_year
      },
      isDefault: method.metadata?.isDefault === 'true'
    }));

    res.json({
      success: true,
      data: {
        paymentMethods: formattedMethods
      }
    });

  } catch (error) {
    console.error('Get payment methods error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch payment methods'
    });
  }
};

// @desc    Add payment method
// @route   POST /api/payments/payment-methods
// @access  Private
const addPaymentMethod = async (req, res) => {
  try {
    const { paymentMethodId, isDefault = false } = req.body;
    const userId = req.user._id;

    if (!paymentMethodId) {
      return res.status(400).json({
        success: false,
        error: 'Payment method ID is required'
      });
    }

    // Get user
    const user = await User.findById(userId);

    // Create or get Stripe customer
    let stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
        metadata: {
          userId: user._id.toString()
        }
      });

      stripeCustomerId = customer.id;
      user.stripeCustomerId = stripeCustomerId;
      await user.save();
    }

    // Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: stripeCustomerId
    });

    // Set as default if requested
    if (isDefault) {
      await stripe.customers.update(stripeCustomerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId
        }
      });
    }

    res.status(201).json({
      success: true,
      message: 'Payment method added successfully',
      data: {
        paymentMethodId,
        isDefault
      }
    });

  } catch (error) {
    console.error('Add payment method error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add payment method'
    });
  }
};

// @desc    Remove payment method
// @route   DELETE /api/payments/payment-methods/:paymentMethodId
// @access  Private
const removePaymentMethod = async (req, res) => {
  try {
    const { paymentMethodId } = req.params;
    const userId = req.user._id;

    const user = await User.findById(userId);

    if (!user.stripeCustomerId) {
      return res.status(404).json({
        success: false,
        error: 'No payment methods found'
      });
    }

    // Detach payment method from customer
    await stripe.paymentMethods.detach(paymentMethodId);

    res.json({
      success: true,
      message: 'Payment method removed successfully'
    });

  } catch (error) {
    console.error('Remove payment method error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove payment method'
    });
  }
};

// @desc    Set default payment method
// @route   PUT /api/payments/payment-methods/:paymentMethodId/default
// @access  Private
const setDefaultPaymentMethod = async (req, res) => {
  try {
    const { paymentMethodId } = req.params;
    const userId = req.user._id;

    const user = await User.findById(userId);

    if (!user.stripeCustomerId) {
      return res.status(404).json({
        success: false,
        error: 'No payment methods found'
      });
    }

    // Set as default payment method
    await stripe.customers.update(user.stripeCustomerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId
      }
    });

    res.json({
      success: true,
      message: 'Default payment method updated successfully'
    });

  } catch (error) {
    console.error('Set default payment method error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to set default payment method'
    });
  }
};

// @desc    Create setup intent for saving payment methods
// @route   POST /api/payments/create-setup-intent
// @access  Private
const createSetupIntent = async (req, res) => {
  try {
    const userId = req.user._id;

    // Get or create Stripe customer
    let stripeCustomerId = req.user.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        name: `${req.user.firstName} ${req.user.lastName}`,
        metadata: {
          userId: userId.toString()
        }
      });

      stripeCustomerId = customer.id;

      // Save customer ID to user
      await User.findByIdAndUpdate(userId, { stripeCustomerId });
    }

    // Create setup intent
    const setupIntent = await stripe.setupIntents.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      metadata: {
        userId: userId.toString()
      }
    });

    res.json({
      success: true,
      data: {
        clientSecret: setupIntent.client_secret,
        setupIntentId: setupIntent.id
      }
    });

  } catch (error) {
    console.error('Create setup intent error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create setup intent'
    });
  }
};

// @desc    Get payment history
// @route   GET /api/payments/history
// @access  Private
const getPaymentHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      page = 1,
      limit = 20,
      status,
      startDate,
      endDate
    } = req.query;

    // Build query
    let query = { user: userId };

    if (status) {
      query['payment.status'] = status;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const orders = await Order.find(query)
      .populate('items.product', 'name images')
      .select('orderNumber totalAmount payment createdAt')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Order.countDocuments(query);

    res.json({
      success: true,
      data: {
        payments: orders.map(order => ({
          id: order._id,
          orderNumber: order.orderNumber,
          amount: order.totalAmount,
          currency: order.currency,
          status: order.payment.status,
          method: order.payment.method,
          date: order.createdAt,
          items: order.items.map(item => ({
            name: item.product.name,
            quantity: item.quantity,
            price: item.price,
            image: item.product.images[0]?.url
          }))
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch payment history'
    });
  }
};

// @desc    Get payment analytics
// @route   GET /api/payments/analytics
// @access  Private (Admin)
const getPaymentAnalytics = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin access required.'
      });
    }

    const { startDate, endDate, period = '30d' } = req.query;

    // Calculate date range
    const daysBack = parseInt(period.replace('d', ''));
    const start = startDate ? new Date(startDate) : new Date(Date.now() - (daysBack * 24 * 60 * 60 * 1000));
    const end = endDate ? new Date(endDate) : new Date();

    // Get payment analytics
    const analytics = await Order.aggregate([
      {
        $match: {
          'payment.status': 'completed',
          createdAt: { $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          totalAmount: { $sum: '$totalAmount' },
          orderCount: { $sum: 1 },
          averageOrderValue: { $avg: '$totalAmount' }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    // Get payment method breakdown
    const paymentMethodBreakdown = await Order.aggregate([
      {
        $match: {
          'payment.status': 'completed',
          createdAt: { $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id: '$payment.method',
          count: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' }
        }
      }
    ]);

    // Get total revenue and transaction count
    const totals = await Order.aggregate([
      {
        $match: {
          'payment.status': 'completed',
          createdAt: { $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalAmount' },
          totalOrders: { $sum: 1 },
          averageOrderValue: { $avg: '$totalAmount' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        period: { start, end },
        totals: totals[0] || { totalRevenue: 0, totalOrders: 0, averageOrderValue: 0 },
        dailyAnalytics: analytics,
        paymentMethodBreakdown
      }
    });

  } catch (error) {
    console.error('Get payment analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch payment analytics'
    });
  }
};

// @desc    Handle Stripe webhook
// @route   POST /api/payments/webhook
// @access  Public
const handleStripeWebhook = async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event.data.object);
        break;

      case 'charge.dispute.created':
        await handleChargeDispute(event.data.object);
        break;

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({
      success: false,
      error: 'Webhook processing failed'
    });
  }
};

// Webhook event handlers
const handlePaymentIntentSucceeded = async (paymentIntent) => {
  try {
    const order = await Order.findOne({
      'payment.paymentIntentId': paymentIntent.id
    });

    if (order) {
      order.payment.status = 'completed';
      order.payment.paidAt = new Date();
      order.payment.transactionId = paymentIntent.id;

      // Get card details
      if (paymentIntent.charges.data.length > 0) {
        const charge = paymentIntent.charges.data[0];
        order.payment.card = {
          last4: charge.payment_method_details?.card?.last4,
          brand: charge.payment_method_details?.card?.brand,
          expiryMonth: charge.payment_method_details?.card?.exp_month,
          expiryYear: charge.payment_method_details?.card?.exp_year
        };
      }

      await order.addStatusChange('confirmed', null, 'Payment completed via webhook');
      await order.addTimelineEvent('payment_confirmed', 'Payment confirmed via webhook');

      await order.save();

      // Send confirmation email
      const user = await User.findById(order.user);
      await sendPaymentConfirmationEmail(order, user);

      console.log(`Payment succeeded for order ${order.orderNumber}`);
    }
  } catch (error) {
    console.error('Handle payment intent succeeded error:', error);
  }
};

const handlePaymentIntentFailed = async (paymentIntent) => {
  try {
    const order = await Order.findOne({
      'payment.paymentIntentId': paymentIntent.id
    });

    if (order) {
      order.payment.status = 'failed';
      await order.addStatusChange('cancelled', null, 'Payment failed');

      await order.save();

      // Send failure notification
      const user = await User.findById(order.user);
      await sendEmail({
        to: user.email,
        subject: `Payment Failed - ${order.orderNumber}`,
        template: 'paymentFailed',
        data: {
          customerName: user.firstName,
          orderNumber: order.orderNumber,
          reason: paymentIntent.last_payment_error?.message || 'Payment failed',
          orderUrl: `${process.env.FRONTEND_URL}/orders/${order._id}`
        }
      });

      console.log(`Payment failed for order ${order.orderNumber}`);
    }
  } catch (error) {
    console.error('Handle payment intent failed error:', error);
  }
};

const handleChargeDispute = async (charge) => {
  try {
    // Find order by charge ID or payment intent
    const order = await Order.findOne({
      $or: [
        { 'payment.transactionId': charge.id },
        { 'payment.paymentIntentId': charge.payment_intent }
      ]
    });

    if (order) {
      // Create dispute record
      order.payment.dispute = {
        id: charge.dispute,
        status: 'open',
        reason: charge.dispute?.reason,
        createdAt: new Date()
      };

      await order.save();

      // Notify admin
      const admins = await User.find({ role: 'admin', status: 'active' });
      for (const admin of admins) {
        await sendEmail({
          to: admin.email,
          subject: 'Payment Dispute Created',
          template: 'adminNotification',
          data: {
            type: 'payment_dispute',
            orderNumber: order.orderNumber,
            customerName: order.customer.name,
            amount: order.totalAmount,
            disputeReason: charge.dispute?.reason,
            adminUrl: `${process.env.FRONTEND_URL}/admin/orders/${order._id}`
          }
        });
      }

      console.log(`Dispute created for order ${order.orderNumber}`);
    }
  } catch (error) {
    console.error('Handle charge dispute error:', error);
  }
};

// @desc    Get transaction details
// @route   GET /api/payments/transaction/:transactionId
// @access  Private
const getTransactionDetails = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user._id;

    const order = await Order.findOne({
      $or: [
        { 'payment.transactionId': transactionId },
        { 'payment.paymentIntentId': transactionId }
      ],
      user: userId
    }).populate('items.product', 'name images');

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Transaction not found'
      });
    }

    res.json({
      success: true,
      data: {
        transaction: {
          id: order.payment.transactionId,
          orderNumber: order.orderNumber,
          amount: order.totalAmount,
          currency: order.currency,
          status: order.payment.status,
          method: order.payment.method,
          date: order.payment.paidAt,
          card: order.payment.card,
          items: order.items,
          billingAddress: order.payment.billingAddress
        }
      }
    });

  } catch (error) {
    console.error('Get transaction details error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch transaction details'
    });
  }
};

// Helper functions
const savePaymentMethodForUser = async (userId, paymentMethodId) => {
  try {
    const user = await User.findById(userId);

    if (!user.stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
        metadata: { userId: userId.toString() }
      });

      user.stripeCustomerId = customer.id;
      await user.save();
    }

    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: user.stripeCustomerId
    });

  } catch (error) {
    console.error('Save payment method error:', error);
  }
};

const sendPaymentConfirmationEmail = async (order, user) => {
  try {
    await sendEmail({
      to: user.email,
      subject: `Payment Confirmed - ${order.orderNumber}`,
      template: 'paymentConfirmation',
      data: {
        customerName: user.firstName,
        orderNumber: order.orderNumber,
        amount: order.totalAmount,
        paymentMethod: order.payment.method,
        orderUrl: `${process.env.FRONTEND_URL}/orders/${order._id}`
      }
    });
  } catch (emailError) {
    console.error('Failed to send payment confirmation email:', emailError);
  }
};

module.exports = {
  createPaymentIntent,
  confirmPayment,
  processRefund,
  getPaymentMethods,
  addPaymentMethod,
  removePaymentMethod,
  setDefaultPaymentMethod,
  createSetupIntent,
  getPaymentHistory,
  getPaymentAnalytics,
  handleStripeWebhook,
  getTransactionDetails
};
