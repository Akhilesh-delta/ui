const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const Cart = require('../models/Cart');
const { 
  authenticate, 
  requireVendorOrAdmin,
  sanitizeInput
} = require('../middleware/authMiddleware');
const { sendEmail } = require('../services/emailService');
const { sendSMS } = require('../services/smsService');

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
const createOrder = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      items,
      shippingAddress,
      billingAddress,
      paymentMethod,
      paymentToken,
      couponCode,
      notes,
      giftMessage,
      isGift,
      saveShippingAddress = true
    } = req.body;

    // Validate required fields
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide order items'
      });
    }

    if (!shippingAddress) {
      return res.status(400).json({
        success: false,
        error: 'Shipping address is required'
      });
    }

    if (!paymentMethod) {
      return res.status(400).json({
        success: false,
        error: 'Payment method is required'
      });
    }

    // Validate items
    for (const item of items) {
      if (!item.productId || !item.quantity) {
        return res.status(400).json({
          success: false,
          error: 'Each item must have productId and quantity'
        });
      }

      if (item.quantity < 1) {
        return res.status(400).json({
          success: false,
          error: 'Quantity must be at least 1'
        });
      }
    }

    // Get user's cart to validate items
    const cart = await Cart.findByUser(userId).populate('items.product');
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Cart is empty'
      });
    }

    // Validate and process cart items
    const processedItems = [];
    let subtotal = 0;
    let totalWeight = 0;
    let requiresShipping = false;

    for (const cartItem of cart.items) {
      const orderItem = items.find(item => 
        item.productId === cartItem.product._id.toString()
      );

      if (!orderItem) continue;

      // Check stock availability
      if (cartItem.product.inventory.quantity < orderItem.quantity) {
        return res.status(400).json({
          success: false,
          error: `Insufficient stock for ${cartItem.product.name}. Available: ${cartItem.product.inventory.quantity}`
        });
      }

      // Calculate item total
      const itemPrice = cartItem.product.discountedPrice || cartItem.product.price;
      const itemTotal = itemPrice * orderItem.quantity;

      processedItems.push({
        product: cartItem.product._id,
        productName: cartItem.product.name,
        productImage: cartItem.product.images[0]?.url || '',
        sku: cartItem.product.sku,
        variant: cartItem.variant,
        quantity: orderItem.quantity,
        price: itemPrice,
        discount: cartItem.product.discount || { amount: 0, percentage: 0 },
        totalPrice: itemTotal
      });

      subtotal += itemTotal;
      totalWeight += (cartItem.product.weight?.value || 0) * orderItem.quantity;

      if (cartItem.product.shipping.requiresShipping) {
        requiresShipping = true;
      }
    }

    if (processedItems.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid items found in cart'
      });
    }

    // Calculate shipping
    let shippingCost = 0;
    let shippingMethod = 'standard';
    let estimatedDelivery = new Date();

    if (requiresShipping) {
      // Calculate shipping based on weight, location, etc.
      if (totalWeight > 10) {
        shippingCost = 15;
        shippingMethod = 'express';
      } else {
        shippingCost = 8;
        shippingMethod = 'standard';
      }

      // Add 2-5 days for delivery
      estimatedDelivery.setDate(estimatedDelivery.getDate() + (totalWeight > 10 ? 3 : 5));
    }

    // Calculate tax (simplified - would need proper tax calculation)
    const taxRate = 0.08; // 8% tax rate
    const tax = subtotal * taxRate;

    // Apply coupon if provided
    let discountAmount = 0;
    if (couponCode) {
      // This would validate the coupon code
      discountAmount = subtotal * 0.10; // 10% discount for demo
    }

    // Calculate total
    const totalAmount = subtotal + tax + shippingCost - discountAmount;

    // Create order
    const order = await Order.create({
      user: userId,
      items: processedItems,
      subtotal,
      tax,
      shipping: {
        cost: shippingCost,
        method: shippingMethod,
        estimatedDays: totalWeight > 10 ? 3 : 5
      },
      discount: discountAmount > 0 ? {
        amount: discountAmount,
        code: couponCode,
        type: 'percentage'
      } : undefined,
      totalAmount,
      currency: 'USD',
      shippingAddress: {
        name: sanitizeInput(shippingAddress.name),
        street: sanitizeInput(shippingAddress.street),
        city: sanitizeInput(shippingAddress.city),
        state: sanitizeInput(shippingAddress.state),
        country: sanitizeInput(shippingAddress.country) || 'US',
        zipCode: sanitizeInput(shippingAddress.zipCode),
        phone: shippingAddress.phone ? sanitizeInput(shippingAddress.phone) : undefined,
        email: shippingAddress.email || req.user.email,
        instructions: shippingAddress.instructions ? sanitizeInput(shippingAddress.instructions) : undefined
      },
      payment: {
        method: paymentMethod,
        status: 'pending'
      },
      notes: notes ? sanitizeInput(notes) : undefined,
      isGift,
      giftMessage: giftMessage ? sanitizeInput(giftMessage) : undefined
    });

    // Process payment
    const paymentResult = await processPayment(order, paymentMethod, paymentToken);

    if (!paymentResult.success) {
      // Cancel order if payment fails
      order.status = 'cancelled';
      order.payment.status = 'failed';
      await order.save();

      return res.status(400).json({
        success: false,
        error: 'Payment failed. Order has been cancelled.',
        paymentError: paymentResult.error
      });
    }

    // Update order with payment details
    order.payment = {
      ...order.payment.toObject(),
      ...paymentResult.paymentData
    };
    await order.save();

    // Update inventory
    for (const item of processedItems) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { 'inventory.quantity': -item.quantity }
      });
    }

    // Clear cart
    await Cart.findByUser(userId).then(cart => {
      if (cart) {
        cart.clearCart();
      }
    });

    // Save shipping address if requested
    if (saveShippingAddress) {
      await User.findByIdAndUpdate(userId, {
        $push: {
          addresses: {
            type: 'home',
            name: sanitizeInput(shippingAddress.name),
            street: sanitizeInput(shippingAddress.street),
            city: sanitizeInput(shippingAddress.city),
            state: sanitizeInput(shippingAddress.state),
            country: sanitizeInput(shippingAddress.country) || 'US',
            zipCode: sanitizeInput(shippingAddress.zipCode),
            phone: shippingAddress.phone ? sanitizeInput(shippingAddress.phone) : undefined,
            isDefault: true
          }
        }
      });
    }

    // Send order confirmation email
    try {
      await sendEmail({
        to: req.user.email,
        subject: `Order Confirmation - ${order.orderNumber}`,
        template: 'orderConfirmation',
        data: {
          customerName: req.user.firstName,
          orderNumber: order.orderNumber,
          items: processedItems,
          subtotal,
          tax,
          shipping: shippingCost,
          discount: discountAmount,
          total: totalAmount,
          shippingAddress,
          orderUrl: `${process.env.FRONTEND_URL}/orders/${order._id}`
        }
      });
    } catch (emailError) {
      console.error('Failed to send order confirmation email:', emailError);
    }

    // Send notification to vendor
    const vendorIds = [...new Set(processedItems.map(item => item.product.vendor))];
    for (const vendorId of vendorIds) {
      try {
        const vendor = await User.findById(vendorId);
        await sendEmail({
          to: vendor.email,
          subject: `New Order Received - ${order.orderNumber}`,
          template: 'vendorOrderNotification',
          data: {
            vendorName: vendor.firstName,
            orderNumber: order.orderNumber,
            customerName: req.user.firstName + ' ' + req.user.lastName,
            totalAmount,
            itemCount: processedItems.length,
            orderUrl: `${process.env.FRONTEND_URL}/vendor/orders/${order._id}`
          }
        });
      } catch (emailError) {
        console.error('Failed to send vendor notification:', emailError);
      }
    }

    // Populate order data
    await order.populate('user', 'firstName lastName email');
    await order.populate('items.product', 'name images');

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: {
        order: {
          id: order._id,
          orderNumber: order.orderNumber,
          status: order.status,
          totalAmount,
          itemCount: processedItems.length,
          createdAt: order.createdAt,
          shippingAddress: order.shippingAddress,
          payment: order.payment
        }
      }
    });

  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create order'
    });
  }
};

// @desc    Get user orders
// @route   GET /api/orders
// @access  Private
const getUserOrders = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      page = 1,
      limit = 10,
      status,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    let query = { user: userId };

    if (status) {
      query.status = status;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const orders = await Order.find(query)
      .populate('items.product', 'name slug images')
      .populate('vendor', 'firstName lastName businessName')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('orderNumber status totalAmount subtotal tax shipping discount createdAt items vendor');

    const total = await Order.countDocuments(query);

    res.json({
      success: true,
      data: {
        orders,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get user orders error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch orders'
    });
  }
};

// @desc    Get single order
// @route   GET /api/orders/:id
// @access  Private
const getOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const order = await Order.findOne({
      $or: [{ _id: id }, { orderNumber: id }],
      user: userId
    })
    .populate('items.product', 'name slug images sku')
    .populate('vendor', 'firstName lastName businessName rating')
    .populate('statusHistory.changedBy', 'firstName lastName');

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    // Get order tracking information
    const trackingInfo = await getOrderTracking(order._id);

    // Get return information if applicable
    const returnInfo = order.returns && order.returns.length > 0 ? order.returns[order.returns.length - 1] : null;

    res.json({
      success: true,
      data: {
        order: {
          id: order._id,
          orderNumber: order.orderNumber,
          status: order.status,
          items: order.items,
          subtotal: order.subtotal,
          tax: order.tax,
          shipping: order.shipping,
          discount: order.discount,
          totalAmount: order.totalAmount,
          currency: order.currency,
          shippingAddress: order.shippingAddress,
          payment: order.payment,
          notes: order.notes,
          isGift: order.isGift,
          giftMessage: order.giftMessage,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
          statusHistory: order.statusHistory,
          timeline: order.timeline,
          vendor: order.vendor
        },
        tracking: trackingInfo,
        return: returnInfo
      }
    });

  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch order'
    });
  }
};

// @desc    Cancel order
// @route   PUT /api/orders/:id/cancel
// @access  Private
const cancelOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason = 'Customer requested cancellation' } = req.body;
    const userId = req.user._id;

    const order = await Order.findOne({ _id: id, user: userId });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    if (!order.canBeCancelled()) {
      return res.status(400).json({
        success: false,
        error: 'Order cannot be cancelled at this stage'
      });
    }

    // Cancel the order
    await order.addStatusChange('cancelled', userId, reason);

    // Add timeline event
    await order.addTimelineEvent('cancelled', 'Order has been cancelled', '', {
      reason,
      cancelledBy: 'customer'
    });

    // Process refund if payment was completed
    if (order.payment.status === 'completed') {
      const refundResult = await processRefund(order, 'full', reason);

      if (refundResult.success) {
        order.payment.status = 'refunded';
        order.payment.refundedAt = new Date();
        order.payment.refundAmount = order.totalAmount;
        await order.save();
      }
    }

    // Restore inventory
    for (const item of order.items) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { 'inventory.quantity': item.quantity }
      });
    }

    // Send cancellation confirmation
    try {
      await sendEmail({
        to: req.user.email,
        subject: `Order Cancelled - ${order.orderNumber}`,
        template: 'orderCancelled',
        data: {
          customerName: req.user.firstName,
          orderNumber: order.orderNumber,
          reason,
          refundAmount: order.payment.refundAmount || 0,
          orderUrl: `${process.env.FRONTEND_URL}/orders/${order._id}`
        }
      });
    } catch (emailError) {
      console.error('Failed to send cancellation email:', emailError);
    }

    res.json({
      success: true,
      message: 'Order cancelled successfully',
      data: {
        order: {
          id: order._id,
          orderNumber: order.orderNumber,
          status: order.status,
          refundAmount: order.payment.refundAmount
        }
      }
    });

  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel order'
    });
  }
};

// @desc    Request order return
// @route   POST /api/orders/:id/return
// @access  Private
const requestOrderReturn = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, description, items } = req.body;
    const userId = req.user._id;

    if (!reason || !description) {
      return res.status(400).json({
        success: false,
        error: 'Please provide reason and description for return'
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please specify which items to return'
      });
    }

    const order = await Order.findOne({ _id: id, user: userId });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    // Process return request
    await order.processReturnRequest(reason, description, items, userId);

    // Send return request confirmation
    try {
      await sendEmail({
        to: req.user.email,
        subject: `Return Request Submitted - ${order.orderNumber}`,
        template: 'returnRequest',
        data: {
          customerName: req.user.firstName,
          orderNumber: order.orderNumber,
          reason,
          description,
          returnItems: items,
          orderUrl: `${process.env.FRONTEND_URL}/orders/${order._id}`
        }
      });
    } catch (emailError) {
      console.error('Failed to send return request email:', emailError);
    }

    // Notify vendor
    try {
      const vendor = await User.findById(order.vendor);
      await sendEmail({
        to: vendor.email,
        subject: `Return Request - ${order.orderNumber}`,
        template: 'vendorReturnNotification',
        data: {
          vendorName: vendor.firstName,
          orderNumber: order.orderNumber,
          customerName: req.user.firstName + ' ' + req.user.lastName,
          reason,
          description,
          returnItems: items,
          orderUrl: `${process.env.FRONTEND_URL}/vendor/orders/${order._id}`
        }
      });
    } catch (emailError) {
      console.error('Failed to send vendor return notification:', emailError);
    }

    res.json({
      success: true,
      message: 'Return request submitted successfully',
      data: {
        return: order.returns[order.returns.length - 1]
      }
    });

  } catch (error) {
    console.error('Request order return error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit return request'
    });
  }
};

// @desc    Track order
// @route   GET /api/orders/:id/track
// @access  Private
const trackOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const order = await Order.findOne({
      $or: [{ _id: id }, { orderNumber: id }],
      user: userId
    }).select('orderNumber status shippingAddress timeline createdAt shippedAt deliveredAt');

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    const trackingInfo = await getOrderTracking(order._id);

    res.json({
      success: true,
      data: {
        order: {
          orderNumber: order.orderNumber,
          status: order.status,
          shippingAddress: order.shippingAddress
        },
        tracking: trackingInfo,
        timeline: order.timeline,
        estimatedDelivery: order.shipping?.estimatedDays ?
          new Date(order.createdAt.getTime() + (order.shipping.estimatedDays * 24 * 60 * 60 * 1000)) : null
      }
    });

  } catch (error) {
    console.error('Track order error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch order tracking'
    });
  }
};

// @desc    Get order invoice
// @route   GET /api/orders/:id/invoice
// @access  Private
const getOrderInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const order = await Order.findOne({
      $or: [{ _id: id }, { orderNumber: id }],
      user: userId
    })
    .populate('items.product', 'name sku images')
    .populate('vendor', 'firstName lastName businessName businessAddress');

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    // Generate invoice data
    const invoiceData = {
      orderNumber: order.orderNumber,
      orderDate: order.createdAt,
      customer: {
        name: req.user.firstName + ' ' + req.user.lastName,
        email: req.user.email,
        address: order.shippingAddress
      },
      vendor: order.vendor,
      items: order.items,
      subtotal: order.subtotal,
      tax: order.tax,
      shipping: order.shipping,
      discount: order.discount,
      total: order.totalAmount,
      payment: order.payment,
      status: order.status
    };

    res.json({
      success: true,
      data: {
        invoice: invoiceData
      }
    });

  } catch (error) {
    console.error('Get order invoice error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch order invoice'
    });
  }
};

// @desc    Reorder items
// @route   POST /api/orders/:id/reorder
// @access  Private
const reorderItems = async (req, res) => {
  try {
    const { id } = req.params;
    const { itemIds } = req.body;
    const userId = req.user._id;

    const order = await Order.findOne({ _id: id, user: userId });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    // Get items to reorder
    let itemsToReorder = order.items;
    if (itemIds && Array.isArray(itemIds) && itemIds.length > 0) {
      itemsToReorder = order.items.filter(item => itemIds.includes(item._id.toString()));
    }

    if (itemsToReorder.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No items selected for reorder'
      });
    }

    // Get user's cart
    let cart = await Cart.findByUser(userId);
    if (!cart) {
      cart = await Cart.create({
        user: userId,
        metadata: { createdFrom: 'reorder' }
      });
    }

    // Add items to cart
    for (const item of itemsToReorder) {
      await cart.addItem(item.product, item.quantity, item.variant);
    }

    res.json({
      success: true,
      message: 'Items added to cart successfully',
      data: {
        cartItemCount: cart.summary.itemCount,
        cartUrl: `${process.env.FRONTEND_URL}/cart`
      }
    });

  } catch (error) {
    console.error('Reorder items error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reorder items'
    });
  }
};

// Helper functions
const processPayment = async (order, paymentMethod, paymentToken) => {
  try {
    // This would integrate with Stripe, PayPal, etc.
    // For now, simulate payment processing

    const paymentData = {
      status: 'completed',
      transactionId: `txn_${Date.now()}`,
      paymentIntentId: `pi_${Date.now()}`,
      gateway: 'stripe',
      paidAt: new Date()
    };

    return {
      success: true,
      paymentData
    };

  } catch (error) {
    return {
      success: false,
      error: 'Payment processing failed'
    };
  }
};

const processRefund = async (order, type = 'full', reason = '') => {
  try {
    // This would integrate with payment gateway for refunds
    // For now, simulate refund processing

    const refundAmount = type === 'full' ? order.totalAmount : order.totalAmount * 0.5;

    return {
      success: true,
      refundAmount,
      transactionId: `ref_${Date.now()}`
    };

  } catch (error) {
    return {
      success: false,
      error: 'Refund processing failed'
    };
  }
};

const getOrderTracking = async (orderId) => {
  try {
    const order = await Order.findById(orderId);

    if (!order) {
      return null;
    }

    // Simulate tracking information
    const trackingSteps = [
      {
        status: 'order_placed',
        description: 'Order placed successfully',
        timestamp: order.createdAt,
        location: order.shippingAddress.city
      }
    ];

    if (order.payment.status === 'completed') {
      trackingSteps.push({
        status: 'payment_confirmed',
        description: 'Payment confirmed',
        timestamp: order.payment.paidAt,
        location: 'Payment Gateway'
      });
    }

    if (order.status === 'processing' || order.status === 'shipped' || order.status === 'delivered') {
      trackingSteps.push({
        status: 'processing_started',
        description: 'Order is being processed',
        timestamp: order.processingAt || new Date(),
        location: 'Warehouse'
      });
    }

    if (order.status === 'shipped' || order.status === 'delivered') {
      trackingSteps.push({
        status: 'shipped',
        description: 'Order has been shipped',
        timestamp: order.shippedAt || new Date(),
        location: 'Shipping Facility'
      });
    }

    if (order.status === 'delivered') {
      trackingSteps.push({
        status: 'delivered',
        description: 'Order delivered successfully',
        timestamp: order.deliveredAt || new Date(),
        location: order.shippingAddress.city
      });
    }

    return trackingSteps;

  } catch (error) {
    console.error('Get order tracking error:', error);
    return [];
  }
};

module.exports = {
  createOrder,
  getUserOrders,
  getOrder,
  cancelOrder,
  requestOrderReturn,
  trackOrder,
  getOrderInvoice,
  reorderItems
};
