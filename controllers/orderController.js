const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const Store = require('../models/Store');
const Payment = require('../models/Payment');
const Cart = require('../models/Cart');
const Notification = require('../models/Notification');
const Review = require('../models/Review');
const { validationResult } = require('express-validator');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

class OrderController {
  // ===============================
  // ORDER CREATION & MANAGEMENT
  // ===============================

  // Create new order
  createOrder = catchAsync(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const {
      items,
      shipping,
      billing,
      paymentMethod,
      notes,
      couponCode
    } = req.body;

    // Validate items
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new AppError('Order items are required', 400, true, 'INVALID_ORDER_ITEMS');
    }

    // Validate and process items
    const processedItems = [];
    let subtotal = 0;
    let totalWeight = 0;
    const vendorItems = {};

    for (const item of items) {
      const product = await Product.findById(item.productId);

      if (!product) {
        throw new AppError(`Product ${item.productId} not found`, 404, true, 'PRODUCT_NOT_FOUND');
      }

      if (!product.isAvailable) {
        throw new AppError(`Product ${product.name} is not available`, 400, true, 'PRODUCT_NOT_AVAILABLE');
      }

      // Check quantity
      if (product.inventory.trackQuantity && product.inventory.quantity < item.quantity) {
        throw new AppError(
          `Insufficient quantity for ${product.name}. Available: ${product.inventory.quantity}, Requested: ${item.quantity}`,
          400,
          true,
          'INSUFFICIENT_QUANTITY'
        );
      }

      // Calculate price
      const itemPrice = product.calculatePrice(item.quantity, item.variant);
      subtotal += itemPrice;

      // Track weight
      totalWeight += (product.shipping?.weight || 1) * item.quantity;

      // Group items by vendor
      if (!vendorItems[product.vendor]) {
        vendorItems[product.vendor] = [];
      }

      vendorItems[product.vendor].push({
        product: product._id,
        vendor: product.vendor,
        store: product.store,
        name: product.name,
        sku: product.sku,
        image: product.images[0]?.url,
        price: product.price,
        originalPrice: product.compareAtPrice,
        quantity: item.quantity,
        weight: product.shipping?.weight,
        dimensions: product.shipping?.dimensions,
        variant: item.variant,
        customizations: item.customizations
      });
    }

    // Calculate shipping cost
    const shippingCost = this.calculateShippingCost(shipping.method, totalWeight, Object.keys(vendorItems).length);

    // Apply coupon if provided
    let couponDiscount = 0;
    let appliedCoupon = null;

    if (couponCode) {
      const coupon = await this.validateCoupon(couponCode, subtotal);
      if (coupon) {
        couponDiscount = coupon.discountValue;
        appliedCoupon = coupon;
      }
    }

    // Calculate tax (simplified)
    const tax = Math.round((subtotal - couponDiscount + shippingCost) * 0.08 * 100) / 100;

    // Calculate total
    const totalAmount = subtotal - couponDiscount + tax + shippingCost;

    // Create order
    const order = new Order({
      user: req.user.id,
      customerInfo: {
        firstName: req.user.firstName,
        lastName: req.user.lastName,
        email: req.user.email,
        phone: req.user.phone
      },
      items: Object.values(vendorItems).flat(),
      pricing: {
        subtotal,
        discount: 0,
        couponDiscount,
        tax,
        shipping: shippingCost,
        totalAmount
      },
      coupon: appliedCoupon,
      shipping: {
        method: shipping.method,
        address: shipping.address,
        cost: shippingCost,
        estimatedDelivery: this.calculateEstimatedDelivery(shipping.method)
      },
      billing: {
        address: billing?.sameAsShipping ? shipping.address : billing?.address,
        sameAsShipping: billing?.sameAsShipping || false
      },
      notes: {
        customer: notes?.customer
      },
      source: 'web',
      status: 'pending'
    });

    await order.save();

    // Update product inventory
    for (const item of order.items) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { 'inventory.quantity': -item.quantity }
      });
    }

    // Update product stats
    for (const item of order.items) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { 'stats.cartCount': 1 }
      });
    }

    // Send order confirmation notifications
    await this.sendOrderNotifications(order, 'created');

    // Clear user's cart
    await Cart.updateOne(
      { user: req.user.id, status: 'active' },
      { status: 'converted', 'analytics.convertedAt': new Date() }
    );

    logger.info('Order created', {
      orderId: order._id,
      userId: req.user.id,
      totalAmount,
      itemCount: items.length,
      vendorCount: Object.keys(vendorItems).length
    });

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: {
        order: order.getPublicData(),
        paymentRequired: totalAmount > 0
      }
    });
  });

  // Get user orders
  getUserOrders = catchAsync(async (req, res) => {
    const {
      status,
      dateFrom,
      dateTo,
      sortBy = 'orderedAt',
      page = 1,
      limit = 20
    } = req.query;

    let query = { user: req.user.id, isDeleted: false };

    if (status) query.status = status;
    if (dateFrom || dateTo) {
      query.orderedAt = {};
      if (dateFrom) query.orderedAt.$gte = new Date(dateFrom);
      if (dateTo) query.orderedAt.$lte = new Date(dateTo);
    }

    let sort = {};
    switch (sortBy) {
      case 'date':
        sort = { orderedAt: -1 };
        break;
      case 'amount':
        sort = { 'pricing.totalAmount': -1 };
        break;
      case 'status':
        sort = { status: 1 };
        break;
      default:
        sort = { orderedAt: -1 };
    }

    const orders = await Order.findByUser(req.user.id, {
      status,
      limit: parseInt(limit),
      skip: (page - 1) * limit,
      sortBy
    });

    const total = await Order.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        orders,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalOrders: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Get order by ID
  getOrder = catchAsync(async (req, res) => {
    const { id } = req.params;

    const order = await Order.findById(id)
      .populate('items.product', 'name slug images')
      .populate('items.vendor', 'firstName lastName')
      .populate('items.store', 'name slug');

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    // Check permissions
    if (order.user.toString() !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'vendor') {
      throw new AppError('Not authorized to view this order', 403, true, 'NOT_AUTHORIZED');
    }

    // Get order updates for vendors
    let vendorOrder = null;
    if (req.user.role === 'vendor') {
      vendorOrder = order.getVendorOrder(req.user.id);
    }

    res.status(200).json({
      success: true,
      data: {
        order: req.user.role === 'vendor' ? vendorOrder : order,
        statusHistory: order.statusHistory,
        canCancel: order.canBeCancelled(),
        canReturn: order.canBeReturned(),
        estimatedDelivery: order.shipping.estimatedDelivery
      }
    });
  });

  // Cancel order
  cancelOrder = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;

    const order = await Order.findById(id);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    // Check permissions
    if (order.user.toString() !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to cancel this order', 403, true, 'NOT_AUTHORIZED');
    }

    if (!order.canBeCancelled()) {
      throw new AppError('Order cannot be cancelled at this stage', 400, true, 'ORDER_CANNOT_BE_CANCELLED');
    }

    // Update order status
    await order.updateStatus('cancelled', req.user.id, reason || 'Cancelled by user');

    // Restore product inventory
    for (const item of order.items) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { 'inventory.quantity': item.quantity }
      });
    }

    // Process refund if payment was made
    if (order.payment.status === 'completed') {
      await order.processRefund('Order cancelled', req.user.id);
    }

    // Send cancellation notifications
    await this.sendOrderNotifications(order, 'cancelled');

    logger.info('Order cancelled', {
      orderId: order._id,
      userId: req.user.id,
      reason
    });

    res.status(200).json({
      success: true,
      message: 'Order cancelled successfully',
      data: {
        order: order.getPublicData(),
        refundProcessed: order.payment.status === 'completed'
      }
    });
  });

  // ===============================
  // ORDER STATUS MANAGEMENT
  // ===============================

  // Update order status (admin/vendor)
  updateOrderStatus = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { status, notes, trackingNumber, trackingUrl, carrier } = req.body;

    const order = await Order.findById(id);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    // Check permissions
    const isAdmin = req.user.role === 'admin';
    const isVendor = req.user.role === 'vendor' &&
      order.items.some(item => item.vendor.toString() === req.user.id);

    if (!isAdmin && !isVendor) {
      throw new AppError('Not authorized to update order status', 403, true, 'NOT_AUTHORIZED');
    }

    // Validate status transition
    const validTransitions = {
      'pending': ['payment_confirmed', 'cancelled'],
      'payment_confirmed': ['processing', 'cancelled'],
      'processing': ['ready', 'shipped', 'cancelled'],
      'ready': ['shipped', 'cancelled'],
      'shipped': ['out_for_delivery', 'delivered', 'cancelled'],
      'out_for_delivery': ['delivered', 'cancelled'],
      'delivered': ['completed'],
      'completed': [], // Final state
      'cancelled': [], // Final state
      'refunded': [], // Final state
      'partially_refunded': ['refunded']
    };

    if (!validTransitions[order.status]?.includes(status)) {
      throw new AppError(`Cannot transition from ${order.status} to ${status}`, 400, true, 'INVALID_STATUS_TRANSITION');
    }

    // Update tracking information if provided
    if (trackingNumber || trackingUrl || carrier) {
      order.shipping.trackingNumber = trackingNumber || order.shipping.trackingNumber;
      order.shipping.trackingUrl = trackingUrl || order.shipping.trackingUrl;
      order.shipping.carrier = carrier || order.shipping.carrier;
    }

    // Update order status
    await order.updateStatus(status, req.user.id, notes);

    // Send status update notifications
    await this.sendOrderNotifications(order, 'status_updated');

    logger.info('Order status updated', {
      orderId: order._id,
      oldStatus: order.statusHistory[order.statusHistory.length - 2]?.status,
      newStatus: status,
      updatedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Order status updated successfully',
      data: {
        order: order.getPublicData(),
        status,
        tracking: order.shipping.trackingNumber ? {
          number: order.shipping.trackingNumber,
          url: order.shipping.trackingUrl,
          carrier: order.shipping.carrier
        } : null
      }
    });
  });

  // Confirm payment
  confirmPayment = catchAsync(async (req, res) => {
    const { orderId } = req.params;
    const { paymentMethod, paymentData } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    if (order.user.toString() !== req.user.id) {
      throw new AppError('Not authorized to confirm payment for this order', 403, true, 'NOT_AUTHORIZED');
    }

    // Process payment
    const paymentResult = await this.processPayment(order, paymentMethod, paymentData);

    if (paymentResult.success) {
      // Update order status
      await order.updateStatus('payment_confirmed', req.user.id, 'Payment confirmed');

      // Create payment record
      const payment = new Payment({
        user: req.user.id,
        order: order._id,
        paymentMethod: {
          type: paymentMethod,
          provider: 'stripe',
          details: paymentResult.details
        },
        amount: order.pricing.totalAmount,
        currency: order.pricing.currency || 'USD',
        status: 'completed',
        gateway: paymentResult.gateway
      });

      await payment.save();

      // Send payment confirmation notifications
      await this.sendOrderNotifications(order, 'payment_confirmed');

      logger.info('Payment confirmed', {
        orderId: order._id,
        paymentId: payment._id,
        amount: order.pricing.totalAmount,
        userId: req.user.id
      });
    } else {
      await order.updateStatus('payment_failed', req.user.id, paymentResult.error);
    }

    res.status(paymentResult.success ? 200 : 400).json({
      success: paymentResult.success,
      message: paymentResult.message,
      data: paymentResult.success ? {
        order: order.getPublicData(),
        payment: paymentResult.payment
      } : null
    });
  });

  // Process payment with gateway
  async processPayment(order, paymentMethod, paymentData) {
    try {
      // Create Stripe payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(order.pricing.totalAmount * 100), // Convert to cents
        currency: order.pricing.currency || 'usd',
        metadata: {
          orderId: order._id.toString(),
          userId: order.user.toString()
        }
      });

      return {
        success: true,
        message: 'Payment processed successfully',
        payment: {
          id: paymentIntent.id,
          client_secret: paymentIntent.client_secret,
          amount: order.pricing.totalAmount
        },
        gateway: {
          name: 'stripe',
          transactionId: paymentIntent.id
        }
      };
    } catch (error) {
      logger.error('Payment processing failed', { orderId: order._id, error: error.message });

      return {
        success: false,
        message: 'Payment processing failed',
        error: error.message
      };
    }
  }

  // Mark order as shipped
  markAsShipped = catchAsync(async (req, res) => {
    const { orderId } = req.params;
    const { trackingNumber, trackingUrl, carrier, notes } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    // Check permissions (vendor or admin)
    const isVendor = order.items.some(item => item.vendor.toString() === req.user.id);
    const isAdmin = req.user.role === 'admin';

    if (!isVendor && !isAdmin) {
      throw new AppError('Not authorized to mark order as shipped', 403, true, 'NOT_AUTHORIZED');
    }

    // Update shipping information
    order.shipping.trackingNumber = trackingNumber;
    order.shipping.trackingUrl = trackingUrl;
    order.shipping.carrier = carrier;
    order.shipping.shippedAt = new Date();

    // Update order status
    await order.updateStatus('shipped', req.user.id, notes || 'Order shipped');

    // Update vendor-specific order status
    const vendorOrder = order.vendorOrders.find(vo => vo.vendor.toString() === req.user.id);
    if (vendorOrder) {
      vendorOrder.status = 'shipped';
      vendorOrder.tracking = {
        number: trackingNumber,
        url: trackingUrl,
        carrier
      };
      vendorOrder.shippedAt = new Date();
      await order.save();
    }

    // Send shipping notifications
    await this.sendOrderNotifications(order, 'shipped');

    logger.info('Order marked as shipped', {
      orderId: order._id,
      trackingNumber,
      shippedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Order marked as shipped successfully',
      data: {
        order: order.getPublicData(),
        tracking: {
          number: trackingNumber,
          url: trackingUrl,
          carrier
        }
      }
    });
  });

  // Mark order as delivered
  markAsDelivered = catchAsync(async (req, res) => {
    const { orderId } = req.params;
    const { notes } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    // Check permissions
    const isVendor = order.items.some(item => item.vendor.toString() === req.user.id);
    const isAdmin = req.user.role === 'admin';

    if (!isVendor && !isAdmin) {
      throw new AppError('Not authorized to mark order as delivered', 403, true, 'NOT_AUTHORIZED');
    }

    // Update order status
    await order.updateStatus('delivered', req.user.id, notes || 'Order delivered');

    // Update vendor-specific order status
    const vendorOrder = order.vendorOrders.find(vo => vo.vendor.toString() === req.user.id);
    if (vendorOrder) {
      vendorOrder.status = 'delivered';
      vendorOrder.deliveredAt = new Date();
      await order.save();
    }

    // Send delivery notifications
    await this.sendOrderNotifications(order, 'delivered');

    logger.info('Order marked as delivered', {
      orderId: order._id,
      deliveredBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Order marked as delivered successfully',
      data: order.getPublicData()
    });
  });

  // ===============================
  // RETURN & REFUND MANAGEMENT
  // ===============================

  // Request return
  requestReturn = catchAsync(async (req, res) => {
    const { orderId } = req.params;
    const { items, reason, description } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    if (order.user.toString() !== req.user.id) {
      throw new AppError('Not authorized to request return for this order', 403, true, 'NOT_AUTHORIZED');
    }

    if (!order.canBeReturned()) {
      throw new AppError('Order cannot be returned at this stage', 400, true, 'ORDER_CANNOT_BE_RETURNED');
    }

    // Create return request
    await order.createReturnRequest({
      items,
      reason,
      description
    }, req.user.id);

    // Send return request notifications
    await this.sendOrderNotifications(order, 'return_requested');

    logger.info('Return requested', {
      orderId: order._id,
      userId: req.user.id,
      items: items.length,
      reason
    });

    res.status(200).json({
      success: true,
      message: 'Return request submitted successfully',
      data: {
        order: order.getPublicData(),
        returnRequest: order.returns[order.returns.length - 1]
      }
    });
  });

  // Process return (vendor/admin)
  processReturn = catchAsync(async (req, res) => {
    const { orderId, returnId } = req.params;
    const { action, notes } = req.body; // 'approve', 'reject', 'mark_received', 'refund'

    const order = await Order.findById(orderId);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    const returnRequest = order.returns.id(returnId);

    if (!returnRequest) {
      throw new AppError('Return request not found', 404, true, 'RETURN_REQUEST_NOT_FOUND');
    }

    // Check permissions
    const isVendor = order.items.some(item => item.vendor.toString() === req.user.id);
    const isAdmin = req.user.role === 'admin';

    if (!isVendor && !isAdmin) {
      throw new AppError('Not authorized to process return', 403, true, 'NOT_AUTHORIZED');
    }

    switch (action) {
      case 'approve':
        returnRequest.status = 'approved';
        returnRequest.approvedAt = new Date();
        break;

      case 'reject':
        returnRequest.status = 'rejected';
        break;

      case 'mark_received':
        returnRequest.status = 'received';
        returnRequest.receivedAt = new Date();
        break;

      case 'refund':
        returnRequest.status = 'refunded';
        returnRequest.refundedAt = new Date();

        // Process refund
        const refundAmount = returnRequest.items.reduce((total, item) => {
          const orderItem = order.items.find(oi => oi.product.toString() === item.product.toString());
          return total + (orderItem ? orderItem.price * item.quantity : 0);
        }, 0);

        await order.processRefund(`Return approved: ${returnRequest.reason}`, req.user.id, refundAmount);
        break;
    }

    await order.save();

    // Send notifications
    await this.sendOrderNotifications(order, 'return_processed');

    logger.info('Return processed', {
      orderId: order._id,
      returnId,
      action,
      processedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Return processed successfully',
      data: {
        order: order.getPublicData(),
        returnRequest
      }
    });
  });

  // ===============================
  // VENDOR ORDER MANAGEMENT
  // ===============================

  // Get vendor orders
  getVendorOrders = catchAsync(async (req, res) => {
    const {
      status,
      dateFrom,
      dateTo,
      sortBy = 'orderedAt',
      page = 1,
      limit = 20
    } = req.query;

    const orders = await Order.findByVendor(req.user.id, {
      status,
      limit: parseInt(limit),
      skip: (page - 1) * limit,
      sortBy
    });

    const total = await Order.countDocuments({
      'items.vendor': req.user.id,
      isDeleted: false,
      ...(status && { status })
    });

    // Get vendor-specific analytics
    const analytics = await this.getVendorOrderAnalytics(req.user.id);

    res.status(200).json({
      success: true,
      data: {
        orders,
        analytics,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalOrders: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Get vendor order analytics
  async getVendorOrderAnalytics(vendorId) {
    const analytics = await Order.aggregate([
      {
        $match: {
          'items.vendor': mongoose.Types.ObjectId(vendorId),
          status: { $in: ['completed', 'delivered'] },
          isDeleted: false
        }
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$pricing.totalAmount' },
          averageOrderValue: { $avg: '$pricing.totalAmount' },
          totalItems: { $sum: { $sum: '$items.quantity' } }
        }
      }
    ]);

    return analytics[0] || {
      totalOrders: 0,
      totalRevenue: 0,
      averageOrderValue: 0,
      totalItems: 0
    };
  }

  // Update vendor order status
  updateVendorOrderStatus = catchAsync(async (req, res) => {
    const { orderId } = req.params;
    const { status, notes } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    // Find vendor-specific order
    const vendorOrder = order.vendorOrders.find(vo => vo.vendor.toString() === req.user.id);

    if (!vendorOrder) {
      throw new AppError('Vendor order not found', 404, true, 'VENDOR_ORDER_NOT_FOUND');
    }

    // Update vendor order status
    vendorOrder.status = status;

    if (status === 'shipped') {
      vendorOrder.shippedAt = new Date();
    } else if (status === 'delivered') {
      vendorOrder.deliveredAt = new Date();
    }

    await order.save();

    // Update main order status if all vendor orders are completed
    await this.updateMainOrderStatus(order);

    // Send notifications
    await this.sendOrderNotifications(order, 'vendor_status_updated');

    logger.info('Vendor order status updated', {
      orderId: order._id,
      vendorId: req.user.id,
      status,
      notes
    });

    res.status(200).json({
      success: true,
      message: 'Vendor order status updated successfully',
      data: {
        order: order.getPublicData(),
        vendorOrder
      }
    });
  });

  // Update main order status based on vendor orders
  async updateMainOrderStatus(order) {
    const vendorStatuses = order.vendorOrders.map(vo => vo.status);
    const allShipped = vendorStatuses.every(status => status === 'shipped' || status === 'delivered');
    const allDelivered = vendorStatuses.every(status => status === 'delivered');

    if (allDelivered && order.status !== 'delivered') {
      await order.updateStatus('delivered', null, 'All vendor orders delivered');
    } else if (allShipped && order.status === 'ready') {
      await order.updateStatus('shipped', null, 'All vendor orders shipped');
    }
  }

  // ===============================
  // ADMIN ORDER MANAGEMENT
  // ===============================

  // Get all orders (admin)
  getAllOrders = catchAsync(async (req, res) => {
    const {
      status,
      user,
      vendor,
      dateFrom,
      dateTo,
      sortBy = 'orderedAt',
      page = 1,
      limit = 20
    } = req.query;

    let query = { isDeleted: false };

    if (status) query.status = status;
    if (user) query.user = user;
    if (dateFrom || dateTo) {
      query.orderedAt = {};
      if (dateFrom) query.orderedAt.$gte = new Date(dateFrom);
      if (dateTo) query.orderedAt.$lte = new Date(dateTo);
    }

    let sort = {};
    switch (sortBy) {
      case 'date':
        sort = { orderedAt: -1 };
        break;
      case 'amount':
        sort = { 'pricing.totalAmount': -1 };
        break;
      case 'customer':
        sort = { 'customerInfo.lastName': 1 };
        break;
      default:
        sort = { orderedAt: -1 };
    }

    const orders = await Order.find(query)
      .populate('user', 'firstName lastName email')
      .populate('items.vendor', 'firstName lastName')
      .populate('items.store', 'name')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Order.countDocuments(query);

    // Get order analytics
    const analytics = await this.getOrderAnalytics();

    res.status(200).json({
      success: true,
      data: {
        orders,
        analytics,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalOrders: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Get order analytics (admin)
  async getOrderAnalytics() {
    const stats = await Order.getOrderStats(30);

    return {
      overview: {
        totalOrders: await Order.countDocuments({ isDeleted: false }),
        pendingOrders: await Order.countDocuments({ status: 'pending', isDeleted: false }),
        completedOrders: await Order.countDocuments({ status: 'completed', isDeleted: false }),
        cancelledOrders: await Order.countDocuments({ status: 'cancelled', isDeleted: false })
      },
      statusDistribution: stats,
      recentTrends: await Order.getSalesAnalytics(null, 30)
    };
  }

  // Bulk update orders (admin)
  bulkUpdateOrders = catchAsync(async (req, res) => {
    const { orderIds, updates } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      throw new AppError('Order IDs array is required', 400, true, 'INVALID_ORDER_IDS');
    }

    const result = await Order.bulkUpdate(orderIds, updates);

    logger.info('Orders bulk updated', {
      adminId: req.user.id,
      orderCount: orderIds.length,
      updates: Object.keys(updates)
    });

    res.status(200).json({
      success: true,
      message: 'Orders updated successfully',
      data: {
        updatedCount: result.modifiedCount,
        orderIds
      }
    });
  });

  // ===============================
  // ORDER COMMUNICATIONS
  // ===============================

  // Send order message
  sendOrderMessage = catchAsync(async (req, res) => {
    const { orderId } = req.params;
    const { message, type = 'customer' } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    // Check permissions
    const isCustomer = order.user.toString() === req.user.id;
    const isVendor = order.items.some(item => item.vendor.toString() === req.user.id);
    const isAdmin = req.user.role === 'admin';

    if (!isCustomer && !isVendor && !isAdmin) {
      throw new AppError('Not authorized to send messages for this order', 403, true, 'NOT_AUTHORIZED');
    }

    // Add message to order notes
    if (type === 'customer' && (isVendor || isAdmin)) {
      order.notes.vendor = message;
    } else if (type === 'vendor' && (isCustomer || isAdmin)) {
      order.notes.customer = message;
    } else if (type === 'internal' && isAdmin) {
      order.notes.internal = message;
    }

    await order.save();

    // Send notification
    const recipientId = type === 'customer' ? order.user :
                       order.items[0]?.vendor; // Send to first vendor

    if (recipientId) {
      await Notification.createNotification(recipientId, {
        type: 'order',
        category: 'informational',
        title: 'New Order Message',
        message: `New message regarding order ${order.orderNumber}`,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          message
        },
        priority: 'normal',
        actions: [
          {
            type: 'link',
            label: 'View Order',
            url: `/orders/${order._id}`,
            action: 'view_order'
          }
        ]
      });
    }

    logger.info('Order message sent', {
      orderId: order._id,
      fromUserId: req.user.id,
      toUserId: recipientId,
      type
    });

    res.status(200).json({
      success: true,
      message: 'Message sent successfully',
      data: {
        order: order.getPublicData(),
        message: {
          content: message,
          type,
          sentAt: new Date()
        }
      }
    });
  });

  // ===============================
  // ORDER SEARCH & FILTERING
  // ===============================

  // Search orders
  searchOrders = catchAsync(async (req, res) => {
    const {
      q: searchTerm,
      status,
      user,
      vendor,
      dateFrom,
      dateTo,
      minAmount,
      maxAmount,
      page = 1,
      limit = 20
    } = req.query;

    let query = { isDeleted: false };

    // Text search
    if (searchTerm) {
      query.$or = [
        { orderNumber: { $regex: searchTerm, $options: 'i' } },
        { 'customerInfo.firstName': { $regex: searchTerm, $options: 'i' } },
        { 'customerInfo.lastName': { $regex: searchTerm, $options: 'i' } },
        { 'customerInfo.email': { $regex: searchTerm, $options: 'i' } },
        { 'items.name': { $regex: searchTerm, $options: 'i' } }
      ];
    }

    if (status) query.status = status;
    if (user) query.user = user;
    if (dateFrom || dateTo) {
      query.orderedAt = {};
      if (dateFrom) query.orderedAt.$gte = new Date(dateFrom);
      if (dateTo) query.orderedAt.$lte = new Date(dateTo);
    }
    if (minAmount || maxAmount) {
      query['pricing.totalAmount'] = {};
      if (minAmount) query['pricing.totalAmount'].$gte = parseFloat(minAmount);
      if (maxAmount) query['pricing.totalAmount'].$lte = parseFloat(maxAmount);
    }

    const orders = await Order.find(query)
      .populate('user', 'firstName lastName email')
      .populate('items.vendor', 'firstName lastName')
      .sort({ orderedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Order.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        orders,
        searchTerm,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalOrders: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Get pending orders
  getPendingOrders = catchAsync(async (req, res) => {
    const orders = await Order.getPendingOrders();

    res.status(200).json({
      success: true,
      data: orders
    });
  });

  // Get overdue orders
  getOverdueOrders = catchAsync(async (req, res) => {
    const orders = await Order.getOverdueOrders();

    res.status(200).json({
      success: true,
      data: orders
    });
  });

  // ===============================
  // ORDER ANALYTICS & REPORTING
  // ===============================

  // Get order analytics (user)
  getOrderAnalytics = catchAsync(async (req, res) => {
    const userId = req.user.id;
    const { dateRange = 30 } = req.query;

    // Get user's order statistics
    const stats = await Order.aggregate([
      {
        $match: {
          user: mongoose.Types.ObjectId(userId),
          status: { $in: ['completed', 'delivered'] },
          isDeleted: false
        }
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalSpent: { $sum: '$pricing.totalAmount' },
          averageOrderValue: { $avg: '$pricing.totalAmount' },
          totalItems: { $sum: { $sum: '$items.quantity' } }
        }
      }
    ]);

    const userStats = stats[0] || {
      totalOrders: 0,
      totalSpent: 0,
      averageOrderValue: 0,
      totalItems: 0
    };

    // Get recent orders
    const recentOrders = await Order.findByUser(userId, { limit: 5 });

    // Get spending trends
    const spendingTrends = await this.getSpendingTrends(userId, parseInt(dateRange));

    res.status(200).json({
      success: true,
      data: {
        stats: userStats,
        recentOrders,
        trends: spendingTrends,
        insights: await this.getOrderInsights(userId)
      }
    });
  });

  // Get spending trends
  async getSpendingTrends(userId, dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const trends = await Order.aggregate([
      {
        $match: {
          user: mongoose.Types.ObjectId(userId),
          status: { $in: ['completed', 'delivered'] },
          orderedAt: { $gte: startDate },
          isDeleted: false
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$orderedAt' } },
          amount: { $sum: '$pricing.totalAmount' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    return trends;
  }

  // Get order insights
  async getOrderInsights(userId) {
    // Get user's favorite categories
    const favoriteCategories = await Order.aggregate([
      {
        $match: {
          user: mongoose.Types.ObjectId(userId),
          status: { $in: ['completed', 'delivered'] },
          isDeleted: false
        }
      },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'productDetails'
        }
      },
      {
        $unwind: '$productDetails'
      },
      {
        $group: {
          _id: '$productDetails.category',
          count: { $sum: 1 },
          totalSpent: { $sum: { $multiply: ['$productDetails.price', '$items.quantity'] } }
        }
      },
      {
        $lookup: {
          from: 'categories',
          localField: '_id',
          foreignField: '_id',
          as: 'categoryInfo'
        }
      },
      {
        $unwind: '$categoryInfo'
      },
      {
        $project: {
          category: '$categoryInfo.name',
          count: 1,
          totalSpent: 1
        }
      },
      { $sort: { totalSpent: -1 } },
      { $limit: 5 }
    ]);

    return {
      favoriteCategories,
      recommendations: await this.getPersonalizedRecommendations(userId)
    };
  }

  // Get personalized recommendations
  async getPersonalizedRecommendations(userId) {
    // Implementation for personalized order recommendations
    return [];
  }

  // ===============================
  // UTILITY METHODS
  // ===============================

  // Calculate shipping cost
  calculateShippingCost(method, weight, vendorCount) {
    let baseCost = 0;

    switch (method) {
      case 'standard':
        baseCost = 5.99 + (vendorCount - 1) * 2.99;
        break;
      case 'express':
        baseCost = 12.99 + (vendorCount - 1) * 5.99;
        break;
      case 'overnight':
        baseCost = 24.99 + (vendorCount - 1) * 10.99;
        break;
      case 'pickup':
        baseCost = 0;
        break;
      default:
        baseCost = 5.99;
    }

    // Weight surcharge
    if (weight > 10) {
      baseCost += Math.ceil((weight - 10) / 5) * 2.99;
    }

    return Math.round(baseCost * 100) / 100;
  }

  // Calculate estimated delivery
  calculateEstimatedDelivery(method) {
    const processingDays = 1;
    const shippingDays = {
      'standard': 5,
      'express': 2,
      'overnight': 1,
      'pickup': 0
    };

    const totalDays = processingDays + (shippingDays[method] || 5);
    const deliveryDate = new Date();
    deliveryDate.setDate(deliveryDate.getDate() + totalDays);

    return deliveryDate;
  }

  // Validate coupon
  async validateCoupon(couponCode, orderAmount) {
    // Implementation for coupon validation
    // This would typically query a Coupon model
    return null;
  }

  // Send order notifications
  async sendOrderNotifications(order, event) {
    const notifications = [];

    // Notify customer
    notifications.push(Notification.createNotification(order.user, {
      type: 'order',
      category: 'transactional',
      title: this.getNotificationTitle(event, 'customer'),
      message: this.getNotificationMessage(event, 'customer', order),
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        amount: order.pricing.totalAmount
      },
      priority: this.getNotificationPriority(event),
      actions: [
        {
          type: 'link',
          label: 'View Order',
          url: `/orders/${order._id}`,
          action: 'view_order'
        }
      ]
    }));

    // Notify vendors
    const vendors = [...new Set(order.items.map(item => item.vendor.toString()))];
    for (const vendorId of vendors) {
      notifications.push(Notification.createNotification(vendorId, {
        type: 'order',
        category: 'transactional',
        title: this.getNotificationTitle(event, 'vendor'),
        message: this.getNotificationMessage(event, 'vendor', order),
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber
        },
        priority: 'normal',
        actions: [
          {
            type: 'link',
            label: 'Manage Order',
            url: `/vendor/orders/${order._id}`,
            action: 'manage_order'
          }
        ]
      }));
    }

    await Promise.all(notifications);
  }

  // Get notification title
  getNotificationTitle(event, recipient) {
    const titles = {
      'created': {
        'customer': 'Order Confirmed',
        'vendor': 'New Order Received'
      },
      'payment_confirmed': {
        'customer': 'Payment Confirmed',
        'vendor': 'Payment Received'
      },
      'shipped': {
        'customer': 'Order Shipped',
        'vendor': 'Order Fulfilled'
      },
      'delivered': {
        'customer': 'Order Delivered',
        'vendor': 'Order Completed'
      },
      'cancelled': {
        'customer': 'Order Cancelled',
        'vendor': 'Order Cancelled'
      }
    };

    return titles[event]?.[recipient] || 'Order Update';
  }

  // Get notification message
  getNotificationMessage(event, recipient, order) {
    const messages = {
      'created': {
        'customer': `Your order ${order.orderNumber} has been confirmed and is being processed.`,
        'vendor': `You have received a new order ${order.orderNumber} for ${order.items.length} items.`
      },
      'payment_confirmed': {
        'customer': 'Payment for your order has been confirmed.',
        'vendor': 'Payment for order has been received.'
      },
      'shipped': {
        'customer': `Your order ${order.orderNumber} has been shipped! Track your package.`,
        'vendor': 'Order has been fulfilled and shipped.'
      }
    };

    return messages[event]?.[recipient] || 'Your order has been updated.';
  }

  // Get notification priority
  getNotificationPriority(event) {
    const priorities = {
      'created': 'normal',
      'payment_confirmed': 'normal',
      'shipped': 'normal',
      'delivered': 'normal',
      'cancelled': 'high'
    };

    return priorities[event] || 'normal';
  }

  // Generate invoice
  generateInvoice = catchAsync(async (req, res) => {
    const { orderId } = req.params;

    const order = await Order.findById(orderId)
      .populate('user', 'firstName lastName email phone')
      .populate('items.product', 'name sku')
      .populate('items.vendor', 'firstName lastName');

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    // Check permissions
    const isCustomer = order.user._id.toString() === req.user.id;
    const isVendor = order.items.some(item => item.vendor._id.toString() === req.user.id);
    const isAdmin = req.user.role === 'admin';

    if (!isCustomer && !isVendor && !isAdmin) {
      throw new AppError('Not authorized to view invoice', 403, true, 'NOT_AUTHORIZED');
    }

    // Generate invoice data
    const invoiceData = {
      orderNumber: order.orderNumber,
      orderDate: order.orderedAt,
      customer: order.customerInfo,
      items: order.items,
      pricing: order.pricing,
      shipping: order.shipping,
      billing: order.billing,
      status: order.status,
      invoiceNumber: `INV-${order.orderNumber}`,
      invoiceDate: new Date()
    };

    // In a real implementation, you would generate a PDF
    // For now, return JSON data
    res.status(200).json({
      success: true,
      data: {
        invoice: invoiceData,
        downloadUrl: `/api/orders/${orderId}/invoice/download`
      }
    });
  });

  // Track order
  trackOrder = catchAsync(async (req, res) => {
    const { orderNumber } = req.params;

    const order = await Order.findOne({ orderNumber })
      .populate('items.vendor', 'firstName lastName')
      .populate('items.store', 'name');

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    // Track view
    await order.updateOne({
      $inc: { viewCount: 1 },
      $set: { lastViewed: new Date() }
    });

    res.status(200).json({
      success: true,
      data: {
        order: order.getPublicData(),
        tracking: order.shipping.trackingNumber ? {
          number: order.shipping.trackingNumber,
          url: order.shipping.trackingUrl,
          carrier: order.shipping.carrier,
          shippedAt: order.shipping.shippedAt,
          estimatedDelivery: order.shipping.estimatedDelivery
        } : null,
        timeline: order.statusHistory.map(history => ({
          status: history.status,
          date: history.timestamp,
          notes: history.notes,
          location: history.location
        }))
      }
    });
  });

  // Get order timeline
  getOrderTimeline = catchAsync(async (req, res) => {
    const { orderId } = req.params;

    const order = await Order.findById(orderId);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    const timeline = order.statusHistory.map(history => ({
      status: history.status,
      date: history.timestamp,
      notes: history.notes,
      changedBy: history.changedBy,
      location: history.location
    }));

    res.status(200).json({
      success: true,
      data: {
        orderNumber: order.orderNumber,
        currentStatus: order.status,
        timeline
      }
    });
  });

  // Add order note
  addOrderNote = catchAsync(async (req, res) => {
    const { orderId } = req.params;
    const { note, type = 'internal' } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    // Check permissions
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin) {
      throw new AppError('Not authorized to add notes', 403, true, 'NOT_AUTHORIZED');
    }

    order.notes[type] = note;
    await order.save();

    res.status(200).json({
      success: true,
      message: 'Note added successfully',
      data: {
        order: order.getPublicData(),
        note: {
          content: note,
          type,
          addedAt: new Date()
        }
      }
    });
  });

  // Get order statistics
  getOrderStatistics = catchAsync(async (req, res) => {
    const { dateRange = 30 } = req.query;

    const stats = await Order.getOrderStats(parseInt(dateRange));
    const salesAnalytics = await Order.getSalesAnalytics(null, parseInt(dateRange));

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalOrders: await Order.countDocuments({ isDeleted: false }),
          totalRevenue: salesAnalytics.reduce((sum, day) => sum + day.totalRevenue, 0),
          averageOrderValue: salesAnalytics.length > 0 ?
            salesAnalytics.reduce((sum, day) => sum + day.totalRevenue, 0) / salesAnalytics.length : 0
        },
        statusDistribution: stats,
        salesTrends: salesAnalytics,
        topProducts: await this.getTopProducts(parseInt(dateRange)),
        topVendors: await this.getTopVendors(parseInt(dateRange))
      }
    });
  });

  // Get top products
  async getTopProducts(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const topProducts = await Order.aggregate([
      {
        $match: {
          status: { $in: ['completed', 'delivered'] },
          orderedAt: { $gte: startDate },
          isDeleted: false
        }
      },
      {
        $unwind: '$items'
      },
      {
        $group: {
          _id: '$items.product',
          totalQuantity: { $sum: '$items.quantity' },
          totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          orderCount: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'productInfo'
        }
      },
      {
        $unwind: '$productInfo'
      },
      {
        $project: {
          product: '$productInfo.name',
          quantity: '$totalQuantity',
          revenue: '$totalRevenue',
          orders: '$orderCount'
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: 10 }
    ]);

    return topProducts;
  }

  // Get top vendors
  async getTopVendors(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const topVendors = await Order.aggregate([
      {
        $match: {
          status: { $in: ['completed', 'delivered'] },
          orderedAt: { $gte: startDate },
          isDeleted: false
        }
      },
      {
        $unwind: '$items'
      },
      {
        $group: {
          _id: '$items.vendor',
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          totalItems: { $sum: '$items.quantity' }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'vendorInfo'
        }
      },
      {
        $unwind: '$vendorInfo'
      },
      {
        $project: {
          vendor: {
            name: { $concat: ['$vendorInfo.firstName', ' ', '$vendorInfo.lastName'] },
            id: '$vendorInfo._id'
          },
          orders: '$totalOrders',
          revenue: '$totalRevenue',
          items: '$totalItems'
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: 10 }
    ]);

    return topVendors;
  }

  // Export orders
  exportOrders = catchAsync(async (req, res) => {
    const {
      format = 'csv',
      status,
      dateFrom,
      dateTo,
      vendor
    } = req.query;

    let query = { isDeleted: false };

    if (status) query.status = status;
    if (dateFrom || dateTo) {
      query.orderedAt = {};
      if (dateFrom) query.orderedAt.$gte = new Date(dateFrom);
      if (dateTo) query.orderedAt.$lte = new Date(dateTo);
    }

    const orders = await Order.find(query)
      .populate('user', 'firstName lastName email')
      .populate('items.vendor', 'firstName lastName')
      .populate('items.store', 'name')
      .sort({ orderedAt: -1 });

    // Generate export file
    const exportData = await this.generateOrderExport(orders, format);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="orders.${format}"`);

    res.status(200).send(exportData);
  });

  // Generate order export
  async generateOrderExport(orders, format) {
    // Implementation for generating CSV/Excel export
    const csvData = orders.map(order => ({
      orderNumber: order.orderNumber,
      customer: `${order.customerInfo.firstName} ${order.customerInfo.lastName}`,
      email: order.customerInfo.email,
      amount: order.pricing.totalAmount,
      status: order.status,
      date: order.orderedAt.toISOString().split('T')[0]
    }));

    // Convert to CSV format
    const headers = Object.keys(csvData[0] || {}).join(',');
    const rows = csvData.map(row => Object.values(row).join(','));
    return [headers, ...rows].join('\n');
  }

  // Get order by order number
  getOrderByNumber = catchAsync(async (req, res) => {
    const { orderNumber } = req.params;

    const order = await Order.findOne({ orderNumber })
      .populate('items.product', 'name slug images')
      .populate('items.vendor', 'firstName lastName')
      .populate('items.store', 'name slug');

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      data: order.getPublicData()
    });
  });
}

module.exports = new OrderController();
