const Cart = require('../models/Cart');
const Product = require('../models/Product');
const User = require('../models/User');
const Order = require('../models/Order');
const Category = require('../models/Category');
const Notification = require('../models/Notification');
const { validationResult } = require('express-validator');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const mongoose = require('mongoose');

class CartController {
  // ===============================
  // CART MANAGEMENT
  // ===============================

  // Get or create cart
  getCart = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    let cart;

    if (req.user) {
      // Authenticated user cart
      cart = await Cart.findOne({ user: req.user.id, status: 'active' });

      if (!cart) {
        cart = new Cart({
          user: req.user.id,
          isGuest: false
        });
        await cart.save();
      }
    } else {
      // Guest cart
      cart = await Cart.findOne({ cartId, sessionId, status: 'active' });

      if (!cart) {
        cart = new Cart({
          cartId,
          sessionId,
          isGuest: true
        });
        await cart.save();
      }
    }

    // Validate cart items availability
    const unavailableItems = await cart.validateItemsAvailability();

    res.status(200).json({
      success: true,
      data: {
        cart: cart.getCartSummary(),
        items: cart.items,
        pricing: cart.pricing,
        unavailableItems,
        isGuest: cart.isGuest,
        expiresAt: cart.expiresAt
      }
    });
  });

  // Add item to cart
  addToCart = catchAsync(async (req, res) => {
    const { productId, quantity = 1, variant = null, customizations = null } = req.body;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    if (!productId) {
      throw new AppError('Product ID is required', 400, true, 'PRODUCT_ID_REQUIRED');
    }

    const product = await Product.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    if (!product.isAvailable) {
      throw new AppError('Product is not available', 400, true, 'PRODUCT_NOT_AVAILABLE');
    }

    // Get or create cart
    let cart = await this.getOrCreateCart(req.user?.id, sessionId);

    // Add item to cart
    await cart.addItem(productId, quantity, variant, customizations);

    // Send notification if cart has multiple vendors
    if (cart.uniqueVendorsCount > 1) {
      await this.sendMultiVendorNotification(cart, req.user?.id);
    }

    logger.info('Item added to cart', {
      cartId: cart.cartId,
      productId,
      quantity,
      userId: req.user?.id,
      isGuest: !req.user
    });

    res.status(200).json({
      success: true,
      message: 'Item added to cart successfully',
      data: {
        cart: cart.getCartSummary(),
        item: cart.items[cart.items.length - 1]
      }
    });
  });

  // Update cart item
  updateCartItem = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const { productId, quantity, variant = null, customizations = null } = req.body;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    if (!productId) {
      throw new AppError('Product ID is required', 400, true, 'PRODUCT_ID_REQUIRED');
    }

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    await cart.updateItemQuantity(productId, quantity, variant, customizations);

    logger.info('Cart item updated', {
      cartId,
      productId,
      quantity,
      userId: req.user?.id
    });

    res.status(200).json({
      success: true,
      message: 'Cart item updated successfully',
      data: cart.getCartSummary()
    });
  });

  // Remove item from cart
  removeFromCart = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const { productId, variant = null, customizations = null } = req.body;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    await cart.removeItem(productId, variant, customizations);

    logger.info('Item removed from cart', {
      cartId,
      productId,
      userId: req.user?.id
    });

    res.status(200).json({
      success: true,
      message: 'Item removed from cart successfully',
      data: cart.getCartSummary()
    });
  });

  // Clear cart
  clearCart = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    cart.items = [];
    cart.coupon = null;
    cart.pricing = {
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

    await cart.save();

    logger.info('Cart cleared', {
      cartId,
      userId: req.user?.id
    });

    res.status(200).json({
      success: true,
      message: 'Cart cleared successfully',
      data: cart.getCartSummary()
    });
  });

  // ===============================
  // CART CALCULATIONS
  // ===============================

  // Get cart pricing
  getCartPricing = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const { shippingMethod, shippingAddress, couponCode } = req.body;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    // Update shipping method
    if (shippingMethod) {
      await cart.updateShippingMethod(shippingMethod, shippingAddress);
    }

    // Apply coupon
    if (couponCode) {
      try {
        await cart.applyCoupon(couponCode);
      } catch (error) {
        // Coupon invalid, but don't fail the request
        logger.warn('Invalid coupon applied', {
          cartId,
          couponCode,
          error: error.message
        });
      }
    }

    res.status(200).json({
      success: true,
      data: {
        pricing: cart.pricing,
        coupon: cart.coupon,
        shipping: cart.shipping,
        breakdown: await this.getDetailedPricingBreakdown(cart)
      }
    });
  });

  // Get detailed pricing breakdown
  async getDetailedPricingBreakdown(cart) {
    const breakdown = {
      items: cart.items.map(item => ({
        productId: item.product,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.price,
        totalPrice: item.price * item.quantity,
        vendor: item.vendor,
        store: item.store
      })),
      vendorBreakdown: cart.pricing.vendorBreakdown,
      fees: await this.calculateCartFees(cart),
      savings: await this.calculateCartSavings(cart)
    };

    return breakdown;
  }

  // Calculate cart fees
  async calculateCartFees(cart) {
    const fees = {
      platformFee: cart.pricing.subtotal * 0.05, // 5% platform fee
      paymentProcessingFee: 0.029 * cart.pricing.totalAmount + 0.30, // Stripe fees
      shippingFee: cart.pricing.shipping,
      tax: cart.pricing.tax,
      totalFees: 0
    };

    fees.totalFees = fees.platformFee + fees.paymentProcessingFee + fees.shippingFee + fees.tax;

    return fees;
  }

  // Calculate cart savings
  async calculateCartSavings(cart) {
    let savings = 0;
    let savingsBreakdown = [];

    // Coupon savings
    if (cart.coupon) {
      savings += cart.pricing.couponDiscount;
      savingsBreakdown.push({
        type: 'coupon',
        description: `Coupon: ${cart.coupon.code}`,
        amount: cart.pricing.couponDiscount
      });
    }

    // Product discounts
    for (const item of cart.items) {
      if (item.originalPrice && item.originalPrice > item.price) {
        const itemSavings = (item.originalPrice - item.price) * item.quantity;
        savings += itemSavings;
        savingsBreakdown.push({
          type: 'product_discount',
          description: `${item.name} discount`,
          amount: itemSavings
        });
      }
    }

    return {
      totalSavings: Math.round(savings * 100) / 100,
      breakdown: savingsBreakdown
    };
  }

  // ===============================
  // COUPON MANAGEMENT
  // ===============================

  // Apply coupon to cart
  applyCoupon = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const { couponCode } = req.body;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    if (!couponCode) {
      throw new AppError('Coupon code is required', 400, true, 'COUPON_CODE_REQUIRED');
    }

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    await cart.applyCoupon(couponCode);

    logger.info('Coupon applied to cart', {
      cartId,
      couponCode,
      userId: req.user?.id
    });

    res.status(200).json({
      success: true,
      message: 'Coupon applied successfully',
      data: {
        cart: cart.getCartSummary(),
        coupon: cart.coupon
      }
    });
  });

  // Remove coupon from cart
  removeCoupon = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    await cart.removeCoupon();

    logger.info('Coupon removed from cart', {
      cartId,
      userId: req.user?.id
    });

    res.status(200).json({
      success: true,
      message: 'Coupon removed successfully',
      data: cart.getCartSummary()
    });
  });

  // Get available coupons
  getAvailableCoupons = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    // Get available coupons based on cart contents
    const availableCoupons = await this.getCouponsForCart(cart);

    res.status(200).json({
      success: true,
      data: {
        availableCoupons,
        cartValue: cart.pricing.subtotal
      }
    });
  });

  // Get coupons for cart
  async getCouponsForCart(cart) {
    // Implementation for fetching available coupons
    // This would typically query a Coupon model
    return [];
  }

  // ===============================
  // CART PERSISTENCE
  // ===============================

  // Merge guest cart with user cart
  mergeGuestCart = catchAsync(async (req, res) => {
    const { guestCartId } = req.body;

    if (!req.user) {
      throw new AppError('Authentication required', 401, true, 'AUTHENTICATION_REQUIRED');
    }

    const mergeResult = await Cart.mergeCarts(guestCartId, req.user.id);

    logger.info('Guest cart merged with user cart', {
      guestCartId,
      userId: req.user.id,
      mergedItems: mergeResult.items.length
    });

    res.status(200).json({
      success: true,
      message: 'Cart merged successfully',
      data: mergeResult.getCartSummary()
    });
  });

  // Save cart for later
  saveCartForLater = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const { name } = req.body;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    // Move items to wishlist
    for (const item of cart.items) {
      await cart.addToWishlist(item.product, `Saved from cart: ${name || 'Untitled'}`);
    }

    // Clear cart
    await this.clearCart(cart);

    res.status(200).json({
      success: true,
      message: 'Cart saved for later successfully',
      data: {
        wishlistCount: cart.wishlist.length,
        savedItems: cart.wishlist.length
      }
    });
  });

  // ===============================
  // CART ANALYTICS
  // ===============================

  // Get cart analytics
  getCartAnalytics = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    const analytics = {
      cartValue: cart.pricing.totalAmount,
      itemCount: cart.itemCount,
      vendorCount: cart.uniqueVendorsCount,
      averageItemValue: cart.itemCount > 0 ? cart.pricing.totalAmount / cart.itemCount : 0,
      cartAge: cart.cartAge,
      viewCount: cart.analytics.viewCount,
      modificationCount: cart.analytics.itemAddCount + cart.analytics.itemRemoveCount,
      abandonmentRisk: await this.calculateAbandonmentRisk(cart),
      recommendations: await this.getCartRecommendations(cart)
    };

    res.status(200).json({
      success: true,
      data: analytics
    });
  });

  // Calculate abandonment risk
  async calculateAbandonmentRisk(cart) {
    let risk = 0;

    // High value cart
    if (cart.pricing.totalAmount > 100) risk += 20;

    // Many items
    if (cart.itemCount > 5) risk += 15;

    // Long time in cart
    if (cart.cartAge > 7) risk += 30;

    // Many modifications
    if (cart.analytics.viewCount > 10) risk += 25;

    // Few interactions
    if (cart.analytics.viewCount < 3 && cart.cartAge > 1) risk += 40;

    return Math.min(risk, 100);
  }

  // Get cart recommendations
  async getCartRecommendations(cart) {
    const recommendations = [];

    // Cross-sell recommendations
    for (const item of cart.items) {
      const product = await Product.findById(item.product);
      if (product) {
        const relatedProducts = await Product.find({
          category: product.category,
          _id: { $ne: product._id },
          status: 'published',
          isDeleted: false
        })
        .limit(3)
        .select('name price images');

        recommendations.push(...relatedProducts.map(p => ({
          type: 'cross_sell',
          product: p,
          reason: `Often bought with ${product.name}`
        })));
      }
    }

    return recommendations.slice(0, 10);
  }

  // ===============================
  // CART TO ORDER CONVERSION
  // ===============================

  // Convert cart to order
  convertToOrder = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const { shipping, billing, paymentMethod, notes } = req.body;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    if (cart.items.length === 0) {
      throw new AppError('Cart is empty', 400, true, 'CART_EMPTY');
    }

    // Validate shipping information
    if (!shipping || !shipping.address) {
      throw new AppError('Shipping address is required', 400, true, 'SHIPPING_ADDRESS_REQUIRED');
    }

    // Create order
    const orderData = {
      shipping,
      billing,
      paymentMethod,
      notes
    };

    const order = await cart.convertToOrder(orderData);

    // Send order confirmation notifications
    await this.sendOrderConfirmationNotifications(order, req.user?.id);

    logger.info('Cart converted to order', {
      cartId,
      orderId: order._id,
      userId: req.user?.id,
      itemCount: cart.items.length
    });

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: {
        order: order.getPublicData(),
        cart: cart.getCartSummary()
      }
    });
  });

  // Get checkout information
  getCheckoutInfo = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    // Get user's saved addresses
    const user = req.user ? await User.findById(req.user.id) : null;
    const savedAddresses = user?.customerProfile?.savedAddresses || [];

    // Get user's saved payment methods
    const savedPaymentMethods = user?.customerProfile?.paymentMethods || [];

    // Get shipping options
    const shippingOptions = await this.getShippingOptions(cart);

    res.status(200).json({
      success: true,
      data: {
        cart: cart.getCartSummary(),
        savedAddresses,
        savedPaymentMethods,
        shippingOptions,
        estimatedDelivery: this.calculateEstimatedDelivery(cart),
        taxInfo: await this.getTaxInfo(cart, savedAddresses[0])
      }
    });
  });

  // Get shipping options
  async getShippingOptions(cart) {
    const options = [
      {
        method: 'standard',
        name: 'Standard Shipping',
        cost: 5.99,
        estimatedDays: 5,
        description: '5-7 business days'
      },
      {
        method: 'express',
        name: 'Express Shipping',
        cost: 12.99,
        estimatedDays: 2,
        description: '2-3 business days'
      },
      {
        method: 'overnight',
        name: 'Overnight Shipping',
        cost: 24.99,
        estimatedDays: 1,
        description: 'Next business day'
      }
    ];

    return options;
  }

  // Calculate estimated delivery
  calculateEstimatedDelivery(cart) {
    const method = cart.shipping.method || 'standard';
    const processingDays = 1;
    const shippingDays = {
      'standard': 5,
      'express': 2,
      'overnight': 1
    };

    const totalDays = processingDays + (shippingDays[method] || 5);
    const deliveryDate = new Date();
    deliveryDate.setDate(deliveryDate.getDate() + totalDays);

    return deliveryDate;
  }

  // Get tax information
  async getTaxInfo(cart, address) {
    // Implementation for tax calculation
    const subtotal = cart.pricing.subtotal;
    const taxRate = 0.08; // 8%

    return {
      subtotal,
      taxRate,
      taxAmount: Math.round(subtotal * taxRate * 100) / 100,
      total: Math.round(subtotal * (1 + taxRate) * 100) / 100
    };
  }

  // ===============================
  // CART SHARING & COLLABORATION
  // ===============================

  // Share cart
  shareCart = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const { shareWith, message, expiresIn = 7 } = req.body; // days
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    // Generate share link
    const shareToken = require('crypto').randomBytes(32).toString('hex');
    const shareLink = `${process.env.CLIENT_URL}/cart/shared/${shareToken}`;

    // Store share information
    cart.sharedWith = {
      token: shareToken,
      sharedBy: req.user?.id,
      sharedWith: shareWith || 'public',
      message,
      expiresAt: new Date(Date.now() + expiresIn * 24 * 60 * 60 * 1000),
      createdAt: new Date()
    };

    await cart.save();

    // Send notification to shared users
    if (shareWith && shareWith !== 'public') {
      await Notification.createNotification(shareWith, {
        type: 'cart',
        category: 'informational',
        title: 'Cart Shared With You',
        message: `${req.user?.firstName || 'Someone'} shared a cart with you: ${message || ''}`,
        data: {
          cartId: cart._id,
          shareToken,
          sharedBy: req.user?.id
        },
        priority: 'normal',
        actions: [
          {
            type: 'link',
            label: 'View Shared Cart',
            url: shareLink,
            action: 'view_shared_cart'
          }
        ]
      });
    }

    logger.info('Cart shared', {
      cartId,
      sharedBy: req.user?.id,
      shareWith,
      expiresIn
    });

    res.status(200).json({
      success: true,
      message: 'Cart shared successfully',
      data: {
        shareLink,
        expiresAt: cart.sharedWith.expiresAt,
        shareToken
      }
    });
  });

  // Get shared cart
  getSharedCart = catchAsync(async (req, res) => {
    const { shareToken } = req.params;

    const cart = await Cart.findOne({
      'sharedWith.token': shareToken,
      'sharedWith.expiresAt': { $gt: new Date() }
    });

    if (!cart) {
      throw new AppError('Shared cart not found or expired', 404, true, 'SHARED_CART_NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      data: {
        cart: cart.getCartSummary(),
        items: cart.items,
        sharedBy: cart.sharedWith.sharedBy,
        message: cart.sharedWith.message,
        expiresAt: cart.sharedWith.expiresAt
      }
    });
  });

  // Add shared cart to user's cart
  addSharedCartToCart = catchAsync(async (req, res) => {
    const { shareToken } = req.params;

    const sharedCart = await Cart.findOne({
      'sharedWith.token': shareToken,
      'sharedWith.expiresAt': { $gt: new Date() }
    });

    if (!sharedCart) {
      throw new AppError('Shared cart not found or expired', 404, true, 'SHARED_CART_NOT_FOUND');
    }

    if (!req.user) {
      throw new AppError('Authentication required', 401, true, 'AUTHENTICATION_REQUIRED');
    }

    // Get user's cart
    let userCart = await Cart.findOne({ user: req.user.id, status: 'active' });

    if (!userCart) {
      userCart = new Cart({
        user: req.user.id,
        isGuest: false
      });
    }

    // Add shared cart items to user cart
    for (const item of sharedCart.items) {
      await userCart.addItem(item.product, item.quantity, item.variant, item.customizations);
    }

    await userCart.save();

    logger.info('Shared cart added to user cart', {
      sharedCartId: sharedCart._id,
      userCartId: userCart._id,
      userId: req.user.id,
      itemCount: sharedCart.items.length
    });

    res.status(200).json({
      success: true,
      message: 'Shared cart added to your cart successfully',
      data: userCart.getCartSummary()
    });
  });

  // ===============================
  // CART NOTIFICATIONS
  // ===============================

  // Send cart reminder
  sendCartReminder = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    // Check if cart should be reminded
    if (cart.analytics.viewCount < 3 || cart.cartAge < 1) {
      throw new AppError('Cart is not eligible for reminder', 400, true, 'CART_NOT_ELIGIBLE');
    }

    // Send reminder notification
    if (req.user) {
      await Notification.createNotification(req.user.id, {
        type: 'cart',
        category: 'promotional',
        title: 'Don\'t Forget Your Cart!',
        message: `You have ${cart.itemCount} items in your cart worth $${cart.pricing.totalAmount}. Complete your purchase!`,
        data: {
          cartId: cart._id,
          itemCount: cart.itemCount,
          totalAmount: cart.pricing.totalAmount
        },
        priority: 'normal',
        actions: [
          {
            type: 'link',
            label: 'View Cart',
            url: `/cart`,
            action: 'view_cart'
          },
          {
            type: 'link',
            label: 'Checkout',
            url: `/checkout`,
            action: 'checkout'
          }
        ]
      });
    }

    // Mark cart as reminded
    cart.analytics.lastReminderSent = new Date();
    await cart.save();

    logger.info('Cart reminder sent', {
      cartId,
      userId: req.user?.id,
      itemCount: cart.itemCount
    });

    res.status(200).json({
      success: true,
      message: 'Cart reminder sent successfully'
    });
  });

  // ===============================
  // CART RECOMMENDATIONS
  // ===============================

  // Get cart recommendations
  getCartRecommendations = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const { type = 'cross_sell', limit = 10 } = req.query;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    let recommendations = [];

    switch (type) {
      case 'cross_sell':
        recommendations = await this.getCrossSellRecommendations(cart, limit);
        break;
      case 'upsell':
        recommendations = await this.getUpsellRecommendations(cart, limit);
        break;
      case 'complementary':
        recommendations = await this.getComplementaryRecommendations(cart, limit);
        break;
      case 'personalized':
        recommendations = await this.getPersonalizedCartRecommendations(cart, req.user?.id, limit);
        break;
    }

    res.status(200).json({
      success: true,
      data: {
        recommendations,
        type,
        cartValue: cart.pricing.totalAmount
      }
    });
  });

  // Get cross-sell recommendations
  async getCrossSellRecommendations(cart, limit) {
    const recommendations = [];

    for (const item of cart.items) {
      const product = await Product.findById(item.product);
      if (product) {
        const relatedProducts = await Product.find({
          category: product.category,
          _id: { $ne: product._id },
          status: 'published',
          isDeleted: false
        })
        .limit(2)
        .select('name price images rating.average');

        recommendations.push(...relatedProducts.map(p => ({
          product: p,
          reason: `Often bought with ${product.name}`,
          confidence: 0.8
        })));
      }
    }

    return recommendations.slice(0, limit);
  }

  // Get upsell recommendations
  async getUpsellRecommendations(cart, limit) {
    const cartValue = cart.pricing.totalAmount;

    const upsellProducts = await Product.find({
      price: { $gt: cartValue * 0.5 },
      status: 'published',
      isDeleted: false
    })
    .sort({ 'rating.average': -1 })
    .limit(limit)
    .select('name price images rating.average');

    return upsellProducts.map(p => ({
      product: p,
      reason: 'Higher quality alternative',
      confidence: 0.7
    }));
  }

  // Get complementary recommendations
  async getComplementaryRecommendations(cart, limit) {
    // Get products that complement cart items
    const complementaryProducts = await Product.find({
      tags: { $in: cart.items.flatMap(item => item.tags || []) },
      status: 'published',
      isDeleted: false
    })
    .limit(limit)
    .select('name price images rating.average');

    return complementaryProducts.map(p => ({
      product: p,
      reason: 'Complementary product',
      confidence: 0.6
    }));
  }

  // Get personalized cart recommendations
  async getPersonalizedCartRecommendations(cart, userId, limit) {
    if (!userId) return [];

    // Analyze user's purchase history and preferences
    const userOrders = await Order.findByUser(userId, { limit: 50 });
    const preferences = await this.analyzeUserPreferences(userId, userOrders);

    const recommendedProducts = await Product.find({
      category: { $in: preferences.categories },
      price: {
        $gte: preferences.priceRange.min,
        $lte: preferences.priceRange.max
      },
      status: 'published',
      isDeleted: false
    })
    .sort({ 'rating.average': -1 })
    .limit(limit)
    .select('name price images rating.average');

    return recommendedProducts.map(p => ({
      product: p,
      reason: 'Based on your preferences',
      confidence: 0.9
    }));
  }

  // Analyze user preferences
  async analyzeUserPreferences(userId, orders) {
    const categories = [];
    const priceRange = { min: 0, max: 1000 };

    if (orders && orders.length > 0) {
      const allItems = orders.flatMap(order => order.items);

      // Get most purchased categories
      const categoryCount = {};
      allItems.forEach(item => {
        if (categoryCount[item.product.category]) {
          categoryCount[item.product.category]++;
        } else {
          categoryCount[item.product.category] = 1;
        }
      });

      categories.push(...Object.keys(categoryCount).slice(0, 3));

      // Get price range
      const prices = allItems.map(item => item.price);
      priceRange.min = Math.min(...prices) * 0.5;
      priceRange.max = Math.max(...prices) * 1.5;
    }

    return { categories, priceRange };
  }

  // ===============================
  // CART EXPORT/IMPORT
  // ===============================

  // Export cart
  exportCart = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const { format = 'json' } = req.query;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    const exportData = {
      cart: cart.getCartSummary(),
      items: cart.items,
      pricing: cart.pricing,
      exportedAt: new Date(),
      exportedBy: req.user?.id
    };

    if (format === 'csv') {
      const csvData = this.generateCartCSV(exportData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="cart.${format}"`);
      res.status(200).send(csvData);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="cart.json"`);
      res.status(200).json(exportData);
    }
  });

  // Generate cart CSV
  generateCartCSV(cartData) {
    const headers = ['Product Name', 'SKU', 'Quantity', 'Price', 'Total'];
    const rows = cartData.items.map(item => [
      item.name,
      item.sku || '',
      item.quantity,
      item.price,
      item.price * item.quantity
    ]);

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }

  // Import cart
  importCart = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    if (!req.file) {
      throw new AppError('No import file provided', 400, true, 'NO_IMPORT_FILE');
    }

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    // Parse import file
    const importData = await this.parseCartImportFile(req.file.path);

    // Import items
    let imported = 0;
    for (const itemData of importData.items) {
      try {
        await cart.addItem(itemData.productId, itemData.quantity);
        imported++;
      } catch (error) {
        logger.warn('Failed to import cart item', {
          cartId,
          itemData,
          error: error.message
        });
      }
    }

    logger.info('Cart imported', {
      cartId,
      imported,
      totalItems: importData.items.length,
      importedBy: req.user?.id
    });

    res.status(200).json({
      success: true,
      message: 'Cart imported successfully',
      data: {
        imported,
        totalItems: importData.items.length,
        cart: cart.getCartSummary()
      }
    });
  });

  // Parse cart import file
  async parseCartImportFile(filePath) {
    // Implementation for parsing cart import files
    return { items: [] };
  }

  // ===============================
  // CART BULK OPERATIONS
  // ===============================

  // Bulk add items to cart
  bulkAddToCart = catchAsync(async (req, res) => {
    const { items } = req.body;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new AppError('Items array is required', 400, true, 'INVALID_ITEMS');
    }

    const cart = await this.getOrCreateCart(req.user?.id, sessionId);

    let added = 0;
    let errors = [];

    for (const item of items) {
      try {
        await cart.addItem(item.productId, item.quantity, item.variant, item.customizations);
        added++;
      } catch (error) {
        errors.push({
          item,
          error: error.message
        });
      }
    }

    await cart.save();

    logger.info('Bulk items added to cart', {
      cartId: cart.cartId,
      added,
      errors: errors.length,
      userId: req.user?.id
    });

    res.status(200).json({
      success: true,
      message: 'Bulk operation completed',
      data: {
        added,
        errors,
        cart: cart.getCartSummary()
      }
    });
  });

  // Bulk update cart items
  bulkUpdateCart = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const { updates } = req.body;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    let updated = 0;
    let errors = [];

    for (const update of updates) {
      try {
        await cart.updateItemQuantity(update.productId, update.quantity, update.variant, update.customizations);
        updated++;
      } catch (error) {
        errors.push({
          update,
          error: error.message
        });
      }
    }

    await cart.save();

    logger.info('Bulk cart update completed', {
      cartId,
      updated,
      errors: errors.length,
      userId: req.user?.id
    });

    res.status(200).json({
      success: true,
      message: 'Bulk update completed',
      data: {
        updated,
        errors,
        cart: cart.getCartSummary()
      }
    });
  });

  // ===============================
  // CART VALIDATION
  // ===============================

  // Validate cart
  validateCart = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    const validation = {
      isValid: true,
      errors: [],
      warnings: [],
      recommendations: []
    };

    // Check item availability
    const unavailableItems = await cart.validateItemsAvailability();

    if (unavailableItems.length > 0) {
      validation.isValid = false;
      validation.errors.push(...unavailableItems.map(item => ({
        type: 'availability',
        message: `Product ${item.productId} is not available`,
        item
      })));
    }

    // Check price changes
    const priceChanges = await this.checkPriceChanges(cart);
    if (priceChanges.length > 0) {
      validation.warnings.push(...priceChanges.map(change => ({
        type: 'price_change',
        message: `Price for ${change.name} changed from $${change.oldPrice} to $${change.newPrice}`,
        change
      })));
    }

    // Check shipping availability
    const shippingIssues = await this.checkShippingAvailability(cart);
    if (shippingIssues.length > 0) {
      validation.warnings.push(...shippingIssues);
    }

    // Generate recommendations
    validation.recommendations = await this.getCartRecommendations(cart);

    res.status(200).json({
      success: true,
      data: validation
    });
  });

  // Check price changes
  async checkPriceChanges(cart) {
    const changes = [];

    for (const item of cart.items) {
      const product = await Product.findById(item.product);
      if (product && product.price !== item.price) {
        changes.push({
          productId: item.product,
          name: item.name,
          oldPrice: item.price,
          newPrice: product.price
        });
      }
    }

    return changes;
  }

  // Check shipping availability
  async checkShippingAvailability(cart) {
    const issues = [];

    // Check if all items can be shipped to the address
    if (cart.shipping.address) {
      for (const item of cart.items) {
        const product = await Product.findById(item.product);
        if (product && product.shipping.requiresShipping) {
          // Check shipping restrictions
          if (product.shipping.shipsFrom) {
            // Implementation for shipping availability check
          }
        }
      }
    }

    return issues;
  }

  // ===============================
  // CART HISTORY & TRACKING
  // ===============================

  // Get cart history
  getCartHistory = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    const history = cart.history.slice((page - 1) * limit, page * limit);

    res.status(200).json({
      success: true,
      data: {
        history,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(cart.history.length / limit),
          totalItems: cart.history.length,
          hasNext: page * limit < cart.history.length,
          hasPrev: page > 1
        }
      }
    });
  });

  // Track cart event
  trackCartEvent = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const { event, data = {} } = req.body;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    // Add event to cart history
    await cart.addHistoryEntry(event, {
      ...data,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    // Update analytics
    await this.updateCartAnalytics(cart, event);

    res.status(200).json({
      success: true,
      message: 'Event tracked successfully'
    });
  });

  // Update cart analytics
  async updateCartAnalytics(cart, event) {
    switch (event) {
      case 'cart_viewed':
        cart.analytics.viewCount++;
        break;
      case 'item_added':
        cart.analytics.itemAddCount++;
        break;
      case 'item_removed':
        cart.analytics.itemRemoveCount++;
        break;
      case 'item_updated':
        cart.analytics.itemUpdateCount++;
        break;
      case 'checkout_started':
        cart.analytics.checkoutAttempts++;
        break;
    }

    await cart.save();
  }

  // ===============================
  // CART SECURITY
  // ===============================

  // Validate cart ownership
  validateCartOwnership = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    res.status(200).json({
      success: true,
      data: {
        isOwner: req.user ? cart.user?.toString() === req.user.id : cart.sessionId === sessionId,
        isGuest: cart.isGuest,
        expiresAt: cart.expiresAt
      }
    });
  });

  // Secure cart operations
  secureCartOperation = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const { operation, data } = req.body;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    // Validate cart security
    const securityCheck = await this.performSecurityCheck(cartId, req.user?.id, sessionId);

    if (!securityCheck.isValid) {
      throw new AppError('Cart security validation failed', 403, true, 'SECURITY_VALIDATION_FAILED');
    }

    // Perform operation
    let result;
    switch (operation) {
      case 'add_item':
        result = await this.addToCart(cartId, data, req.user?.id, sessionId);
        break;
      case 'update_item':
        result = await this.updateCartItem(cartId, data, req.user?.id, sessionId);
        break;
      case 'remove_item':
        result = await this.removeFromCart(cartId, data, req.user?.id, sessionId);
        break;
      default:
        throw new AppError('Invalid operation', 400, true, 'INVALID_OPERATION');
    }

    res.status(200).json({
      success: true,
      message: 'Operation completed successfully',
      data: result
    });
  });

  // Perform security check
  async performSecurityCheck(cartId, userId, sessionId) {
    const cart = await Cart.findOne({
      $or: [
        { cartId, user: userId },
        { cartId, sessionId, user: null }
      ]
    });

    return {
      isValid: !!cart,
      cartExists: !!cart,
      ownershipCorrect: !cart || (userId ? cart.user?.toString() === userId : cart.sessionId === sessionId)
    };
  }

  // ===============================
  // CART UTILITIES
  // ===============================

  // Get or create cart
  async getOrCreateCart(userId, sessionId) {
    let cart;

    if (userId) {
      cart = await Cart.findOne({ user: userId, status: 'active' });
      if (!cart) {
        cart = new Cart({
          user: userId,
          isGuest: false
        });
        await cart.save();
      }
    } else {
      cart = await Cart.findOne({ sessionId, status: 'active' });
      if (!cart) {
        cart = new Cart({
          sessionId,
          isGuest: true
        });
        await cart.save();
      }
    }

    return cart;
  }

  // Get cart by ID
  async getCartById(cartId, userId, sessionId) {
    const cart = await Cart.findOne({
      $or: [
        { cartId, user: userId },
        { cartId, sessionId, user: null }
      ]
    });

    if (!cart) {
      throw new AppError('Cart not found', 404, true, 'CART_NOT_FOUND');
    }

    return cart;
  }

  // Send order confirmation notifications
  async sendOrderConfirmationNotifications(order, userId) {
    // Notify customer
    if (userId) {
      await Notification.createNotification(userId, {
        type: 'order',
        category: 'transactional',
        title: 'Order Confirmed',
        message: `Your order ${order.orderNumber} has been confirmed and is being processed.`,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber
        },
        priority: 'normal',
        actions: [
          {
            type: 'link',
            label: 'Track Order',
            url: `/orders/${order._id}`,
            action: 'track_order'
          }
        ]
      });
    }

    // Notify vendors
    const vendors = [...new Set(order.items.map(item => item.vendor.toString()))];
    for (const vendorId of vendors) {
      await Notification.createNotification(vendorId, {
        type: 'order',
        category: 'transactional',
        title: 'New Order Received',
        message: `You have received a new order ${order.orderNumber} for ${order.items.length} items.`,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber
        },
        priority: 'normal'
      });
    }
  }

  // Send multi-vendor notification
  async sendMultiVendorNotification(cart, userId) {
    if (userId) {
      await Notification.createNotification(userId, {
        type: 'cart',
        category: 'informational',
        title: 'Multi-Vendor Cart',
        message: `Your cart contains items from ${cart.uniqueVendorsCount} different vendors. Shipping may be calculated separately.`,
        data: {
          cartId: cart._id,
          vendorCount: cart.uniqueVendorsCount
        },
        priority: 'low'
      });
    }
  }

  // Clean up abandoned carts
  cleanupAbandonedCarts = catchAsync(async (req, res) => {
    const { daysOld = 7 } = req.query;

    const result = await Cart.cleanupExpiredCarts();

    // Mark old active carts as abandoned
    const cutoffDate = new Date(Date.now() - parseInt(daysOld) * 24 * 60 * 60 * 1000);
    const abandonedResult = await Cart.updateMany(
      {
        status: 'active',
        'analytics.lastModified': { $lt: cutoffDate },
        'analytics.viewCount': { $gt: 0 }
      },
      {
        status: 'abandoned',
        'analytics.abandonedAt': new Date()
      }
    );

    logger.info('Abandoned carts cleaned up', {
      expiredCount: result,
      abandonedCount: abandonedResult.modifiedCount,
      cleanedBy: req.user?.id
    });

    res.status(200).json({
      success: true,
      message: 'Abandoned carts cleaned up successfully',
      data: {
        expiredCarts: result,
        abandonedCarts: abandonedResult.modifiedCount
      }
    });
  });

  // Get cart statistics
  getCartStatistics = catchAsync(async (req, res) => {
    const { dateRange = 30 } = req.query;

    const stats = await Cart.getCartStats();

    const activeCarts = await Cart.countDocuments({ status: 'active' });
    const abandonedCarts = await Cart.countDocuments({ status: 'abandoned' });
    const convertedCarts = await Cart.countDocuments({ status: 'converted' });

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalCarts: await Cart.countDocuments(),
          activeCarts,
          abandonedCarts,
          convertedCarts,
          conversionRate: convertedCarts / (activeCarts + abandonedCarts + convertedCarts) * 100 || 0
        },
        statusDistribution: stats,
        trends: await this.getCartTrends(parseInt(dateRange))
      }
    });
  });

  // Get cart trends
  async getCartTrends(dateRange) {
    // Mock implementation for cart trends
    return Array.from({ length: dateRange }, (_, i) => ({
      date: new Date(Date.now() - (dateRange - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      activeCarts: Math.floor(Math.random() * 100) + 50,
      abandonedCarts: Math.floor(Math.random() * 20) + 10,
      convertedCarts: Math.floor(Math.random() * 15) + 5
    }));
  }

  // Get abandoned carts
  getAbandonedCarts = catchAsync(async (req, res) => {
    const { daysOld = 7, limit = 20 } = req.query;

    const abandonedCarts = await Cart.getAbandonedCarts(parseInt(daysOld));

    res.status(200).json({
      success: true,
      data: {
        abandonedCarts: abandonedCarts.slice(0, limit),
        count: abandonedCarts.length,
        daysOld: parseInt(daysOld)
      }
    });
  });

  // Recover abandoned cart
  recoverAbandonedCart = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const { userId } = req.body;

    const cart = await Cart.findById(cartId);

    if (!cart || cart.status !== 'abandoned') {
      throw new AppError('Abandoned cart not found', 404, true, 'ABANDONED_CART_NOT_FOUND');
    }

    if (userId) {
      // Assign to user
      cart.user = userId;
      cart.isGuest = false;
      cart.status = 'active';
      await cart.save();

      // Send recovery notification
      await Notification.createNotification(userId, {
        type: 'cart',
        category: 'promotional',
        title: 'Cart Recovered!',
        message: `We noticed you left some items in your cart. We've saved them for you!`,
        data: {
          cartId: cart._id,
          itemCount: cart.itemCount
        },
        priority: 'normal',
        actions: [
          {
            type: 'link',
            label: 'View Cart',
            url: `/cart`,
            action: 'view_cart'
          }
        ]
      });

      logger.info('Abandoned cart recovered', {
        cartId,
        recoveredBy: req.user?.id,
        assignedTo: userId
      });
    }

    res.status(200).json({
      success: true,
      message: 'Cart recovered successfully',
      data: cart.getCartSummary()
    });
  });

  // ===============================
  // CART WISHLIST MANAGEMENT
  // ===============================

  // Add item to wishlist
  addToWishlist = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const { productId, notes } = req.body;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    await cart.addToWishlist(productId, notes);

    logger.info('Item added to wishlist', {
      cartId,
      productId,
      userId: req.user?.id
    });

    res.status(200).json({
      success: true,
      message: 'Item added to wishlist successfully',
      data: {
        wishlistCount: cart.wishlist.length,
        item: cart.wishlist[cart.wishlist.length - 1]
      }
    });
  });

  // Remove from wishlist
  removeFromWishlist = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const { productId } = req.body;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    await cart.removeFromWishlist(productId);

    logger.info('Item removed from wishlist', {
      cartId,
      productId,
      userId: req.user?.id
    });

    res.status(200).json({
      success: true,
      message: 'Item removed from wishlist successfully',
      data: {
        wishlistCount: cart.wishlist.length
      }
    });
  });

  // Get wishlist items
  getWishlist = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    // Populate product details
    const wishlistItems = await Promise.all(cart.wishlist.map(async (item) => {
      const product = await Product.findById(item.product);
      return {
        ...item.toObject(),
        product: product ? {
          name: product.name,
          price: product.price,
          images: product.images,
          rating: product.rating
        } : null
      };
    }));

    res.status(200).json({
      success: true,
      data: {
        wishlist: wishlistItems,
        count: wishlistItems.length
      }
    });
  });

  // Move wishlist item to cart
  moveToCart = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const { productId, quantity = 1 } = req.body;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    // Add to cart
    await cart.addItem(productId, quantity);

    // Remove from wishlist
    await cart.removeFromWishlist(productId);

    logger.info('Wishlist item moved to cart', {
      cartId,
      productId,
      quantity,
      userId: req.user?.id
    });

    res.status(200).json({
      success: true,
      message: 'Item moved to cart successfully',
      data: {
        cart: cart.getCartSummary(),
        wishlistCount: cart.wishlist.length
      }
    });
  });

  // ===============================
  // CART COMPARISON
  // ===============================

  // Compare carts
  compareCarts = catchAsync(async (req, res) => {
    const { cartIds } = req.body;

    if (!cartIds || !Array.isArray(cartIds) || cartIds.length < 2) {
      throw new AppError('At least 2 cart IDs are required for comparison', 400, true, 'INVALID_CART_IDS');
    }

    const carts = await Cart.find({
      cartId: { $in: cartIds },
      status: 'active'
    });

    if (carts.length !== cartIds.length) {
      throw new AppError('Some carts not found or not active', 404, true, 'CARTS_NOT_FOUND');
    }

    const comparison = this.generateCartComparison(carts);

    res.status(200).json({
      success: true,
      data: {
        carts: carts.map(cart => cart.getCartSummary()),
        comparison
      }
    });
  });

  // Generate cart comparison
  generateCartComparison(carts) {
    return {
      summary: {
        cartCount: carts.length,
        totalValue: carts.reduce((sum, cart) => sum + cart.pricing.totalAmount, 0),
        averageValue: carts.reduce((sum, cart) => sum + cart.pricing.totalAmount, 0) / carts.length,
        totalItems: carts.reduce((sum, cart) => sum + cart.itemCount, 0),
        uniqueVendors: Math.max(...carts.map(cart => cart.uniqueVendorsCount))
      },
      differences: this.identifyCartDifferences(carts)
    };
  }

  // Identify cart differences
  identifyCartDifferences(carts) {
    // Implementation for identifying differences between carts
    return [];
  }

  // ===============================
  // CART PERFORMANCE
  // ===============================

  // Get cart performance metrics
  getCartPerformance = catchAsync(async (req, res) => {
    const performance = {
      averageCartValue: 0,
      averageItemsPerCart: 0,
      conversionRate: 0,
      abandonmentRate: 0,
      topPerformingProducts: [],
      cartValueDistribution: [],
      timeToConversion: []
    };

    // Calculate metrics
    const allCarts = await Cart.find({ status: { $in: ['active', 'abandoned', 'converted'] } });

    if (allCarts.length > 0) {
      performance.averageCartValue = allCarts.reduce((sum, cart) => sum + cart.pricing.totalAmount, 0) / allCarts.length;
      performance.averageItemsPerCart = allCarts.reduce((sum, cart) => sum + cart.itemCount, 0) / allCarts.length;

      const convertedCarts = allCarts.filter(cart => cart.status === 'converted').length;
      performance.conversionRate = (convertedCarts / allCarts.length) * 100;

      const abandonedCarts = allCarts.filter(cart => cart.status === 'abandoned').length;
      performance.abandonmentRate = (abandonedCarts / allCarts.length) * 100;
    }

    res.status(200).json({
      success: true,
      data: performance
    });
  });

  // Optimize cart performance
  optimizeCartPerformance = catchAsync(async (req, res) => {
    const { cartId } = req.params;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    const cart = await this.getCartById(cartId, req.user?.id, sessionId);

    const optimizations = {
      recommendations: await this.getCartRecommendations(cart),
      priceOptimizations: await this.getPriceOptimizations(cart),
      shippingOptimizations: await this.getShippingOptimizations(cart),
      bundleSuggestions: await this.getBundleSuggestions(cart)
    };

    res.status(200).json({
      success: true,
      data: {
        cart: cart.getCartSummary(),
        optimizations
      }
    });
  });

  // Get price optimizations
  async getPriceOptimizations(cart) {
    const optimizations = [];

    // Check for bulk discounts
    for (const item of cart.items) {
      const product = await Product.findById(item.product);
      if (product) {
        const bulkDiscount = product.getApplicableDiscount(item.quantity);
        if (bulkDiscount) {
          optimizations.push({
            type: 'bulk_discount',
            productId: item.product,
            productName: item.name,
            currentQuantity: item.quantity,
            recommendedQuantity: product.bulkDiscount.find(d => d.minQuantity > item.quantity)?.minQuantity,
            savings: bulkDiscount.amount
          });
        }
      }
    }

    return optimizations;
  }

  // Get shipping optimizations
  async getShippingOptimizations(cart) {
    const optimizations = [];

    // Check for free shipping threshold
    const freeShippingThreshold = 50; // This would come from store settings
    const remainingForFreeShipping = Math.max(0, freeShippingThreshold - cart.pricing.subtotal);

    if (remainingForFreeShipping > 0) {
      optimizations.push({
        type: 'free_shipping',
        threshold: freeShippingThreshold,
        remaining: remainingForFreeShipping,
        suggestion: `Add $${remainingForFreeShipping.toFixed(2)} more to get free shipping`
      });
    }

    return optimizations;
  }

  // Get bundle suggestions
  async getBundleSuggestions(cart) {
    const suggestions = [];

    // Suggest product bundles
    for (const item of cart.items) {
      const product = await Product.findById(item.product);
      if (product && product.bundles) {
        for (const bundle of product.bundles) {
          const bundleProduct = await Product.findById(bundle.product);
          if (bundleProduct) {
            suggestions.push({
              type: 'bundle',
              mainProduct: product.name,
              bundleProduct: bundleProduct.name,
              discountPercentage: bundle.discountPercentage,
              savings: (product.price * bundle.discountPercentage) / 100
            });
          }
        }
      }
    }

    return suggestions.slice(0, 5);
  }

  // ===============================
  // CART UTILITIES
  // ===============================

  // Get cart by ID with validation
  async getCartById(cartId, userId, sessionId) {
    let query;

    if (userId) {
      query = { cartId, user: userId, status: 'active' };
    } else {
      query = { cartId, sessionId, status: 'active', user: null };
    }

    const cart = await Cart.findOne(query);

    if (!cart) {
      throw new AppError('Cart not found', 404, true, 'CART_NOT_FOUND');
    }

    return cart;
  }

  // Helper methods for cart operations
  async addToCart(cartId, data, userId, sessionId) {
    const cart = await this.getCartById(cartId, userId, sessionId);
    return await cart.addItem(data.productId, data.quantity, data.variant, data.customizations);
  }

  async updateCartItem(cartId, data, userId, sessionId) {
    const cart = await this.getCartById(cartId, userId, sessionId);
    return await cart.updateItemQuantity(data.productId, data.quantity, data.variant, data.customizations);
  }

  async removeFromCart(cartId, data, userId, sessionId) {
    const cart = await this.getCartById(cartId, userId, sessionId);
    return await cart.removeItem(data.productId, data.variant, data.customizations);
  }

  async clearCart(cart) {
    cart.items = [];
    cart.coupon = null;
    cart.pricing = {
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
    return await cart.save();
  }

  // Send notifications
  async sendOrderConfirmationNotifications(order, userId) {
    // Notify customer
    if (userId) {
      await Notification.createNotification(userId, {
        type: 'order',
        category: 'transactional',
        title: 'Order Confirmed',
        message: `Your order ${order.orderNumber} has been confirmed and is being processed.`,
        data: { orderId: order._id, orderNumber: order.orderNumber },
        priority: 'normal'
      });
    }

    // Notify vendors
    const vendors = [...new Set(order.items.map(item => item.vendor.toString()))];
    for (const vendorId of vendors) {
      await Notification.createNotification(vendorId, {
        type: 'order',
        category: 'transactional',
        title: 'New Order Received',
        message: `You have received a new order ${order.orderNumber} for ${order.items.length} items.`,
        data: { orderId: order._id, orderNumber: order.orderNumber },
        priority: 'normal'
      });
    }
  }

  // Send multi-vendor notification
  async sendMultiVendorNotification(cart, userId) {
    if (userId) {
      await Notification.createNotification(userId, {
        type: 'cart',
        category: 'informational',
        title: 'Multi-Vendor Cart',
        message: `Your cart contains items from ${cart.uniqueVendorsCount} different vendors.`,
        data: { cartId: cart._id, vendorCount: cart.uniqueVendorsCount },
        priority: 'low'
      });
    }
  }
}

module.exports = new CartController();
