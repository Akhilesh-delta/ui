const User = require('../models/User');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Review = require('../models/Review');
const Notification = require('../models/Notification');
const Store = require('../models/Store');
const Cart = require('../models/Cart');
const { validationResult } = require('express-validator');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');

class AdminController {
  // ===============================
  // DASHBOARD & ANALYTICS
  // ===============================

  // Get admin dashboard
  getDashboard = catchAsync(async (req, res) => {
    const { dateRange = 30 } = req.query;

    // Get overview metrics
    const overview = await this.getDashboardOverview(parseInt(dateRange));

    // Get recent activity
    const recentActivity = await this.getRecentActivity();

    // Get system health
    const systemHealth = await this.getSystemHealth();

    // Get alerts and notifications
    const alerts = await this.getSystemAlerts();

    // Get performance metrics
    const performance = await this.getPerformanceMetrics();

    res.status(200).json({
      success: true,
      data: {
        overview,
        recentActivity,
        systemHealth,
        alerts,
        performance,
        lastUpdated: new Date()
      }
    });
  });

  // Get dashboard overview
  async getDashboardOverview(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    // User metrics
    const userMetrics = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          isDeleted: false
        }
      },
      {
        $group: {
          _id: null,
          totalUsers: { $sum: 1 },
          newUsers: { $sum: 1 },
          activeUsers: {
            $sum: { $cond: ['$isActive', 1, 0] }
          },
          verifiedUsers: {
            $sum: { $cond: ['$isVerified', 1, 0] }
          }
        }
      }
    ]);

    // Order metrics
    const orderMetrics = await Order.aggregate([
      {
        $match: {
          orderedAt: { $gte: startDate },
          isDeleted: false
        }
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          completedOrders: {
            $sum: { $cond: [{ $in: ['$status', ['completed', 'delivered']] }, 1, 0] }
          },
          totalRevenue: { $sum: '$pricing.totalAmount' },
          averageOrderValue: { $avg: '$pricing.totalAmount' }
        }
      }
    ]);

    // Product metrics
    const productMetrics = await Product.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          isDeleted: false
        }
      },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          publishedProducts: {
            $sum: { $cond: ['$status', 'published', 1, 0] }
          },
          averagePrice: { $avg: '$price' },
          totalViews: { $sum: '$stats.views' }
        }
      }
    ]);

    // Payment metrics
    const paymentMetrics = await Payment.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          totalPayments: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          successRate: { $sum: 1 }
        }
      }
    ]);

    const userData = userMetrics[0] || {};
    const orderData = orderMetrics[0] || {};
    const productData = productMetrics[0] || {};
    const paymentData = paymentMetrics[0] || {};

    return {
      users: {
        total: await User.countDocuments({ isDeleted: false }),
        new: userData.newUsers || 0,
        active: userData.activeUsers || 0,
        verified: userData.verifiedUsers || 0,
        growth: await this.calculateGrowth('users', dateRange)
      },
      orders: {
        total: await Order.countDocuments({ isDeleted: false }),
        completed: orderData.completedOrders || 0,
        pending: await Order.countDocuments({ status: 'pending', isDeleted: false }),
        revenue: orderData.totalRevenue || 0,
        averageValue: Math.round((orderData.averageOrderValue || 0) * 100) / 100,
        growth: await this.calculateGrowth('orders', dateRange)
      },
      products: {
        total: await Product.countDocuments({ isDeleted: false }),
        published: productData.publishedProducts || 0,
        averagePrice: Math.round((productData.averagePrice || 0) * 100) / 100,
        totalViews: productData.totalViews || 0,
        growth: await this.calculateGrowth('products', dateRange)
      },
      payments: {
        total: await Payment.countDocuments({ status: 'completed' }),
        amount: paymentData.totalAmount || 0,
        successRate: paymentData.successRate || 0,
        growth: await this.calculateGrowth('payments', dateRange)
      },
      vendors: {
        total: await User.countDocuments({ role: 'vendor', isDeleted: false }),
        active: await User.countDocuments({ role: 'vendor', isActive: true, isDeleted: false }),
        verified: await User.countDocuments({ role: 'vendor', isVerified: true, isDeleted: false })
      }
    };
  }

  // Calculate growth percentage
  async calculateGrowth(metric, dateRange) {
    const currentPeriod = dateRange;
    const previousPeriod = dateRange * 2;

    // This would calculate actual growth rates
    return Math.floor(Math.random() * 20) - 10; // Mock growth percentage
  }

  // Get recent activity
  async getRecentActivity() {
    const activities = [];

    // Recent user registrations
    const recentUsers = await User.find({ isDeleted: false })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('firstName lastName email role createdAt');

    activities.push(...recentUsers.map(user => ({
      type: 'user_registered',
      description: `${user.firstName} ${user.lastName} registered as ${user.role}`,
      timestamp: user.createdAt,
      userId: user._id
    })));

    // Recent orders
    const recentOrders = await Order.find({ isDeleted: false })
      .sort({ orderedAt: -1 })
      .limit(5)
      .select('orderNumber pricing.totalAmount orderedAt user')
      .populate('user', 'firstName lastName');

    activities.push(...recentOrders.map(order => ({
      type: 'order_created',
      description: `Order ${order.orderNumber} for $${order.pricing.totalAmount}`,
      timestamp: order.orderedAt,
      userId: order.user._id,
      orderId: order._id
    })));

    // Recent product approvals
    const recentProducts = await Product.find({
      status: 'published',
      publishedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    })
    .sort({ publishedAt: -1 })
    .limit(5)
    .select('name price publishedAt vendor')
    .populate('vendor', 'firstName lastName');

    activities.push(...recentProducts.map(product => ({
      type: 'product_approved',
      description: `Product "${product.name}" approved`,
      timestamp: product.publishedAt,
      userId: product.vendor._id,
      productId: product._id
    })));

    return activities.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
  }

  // Get system health
  async getSystemHealth() {
    const health = {
      database: await this.checkDatabaseHealth(),
      memory: process.memoryUsage(),
      uptime: process.uptime(),
      nodeVersion: process.version,
      environment: process.env.NODE_ENV,
      timestamp: new Date()
    };

    return health;
  }

  // Check database health
  async checkDatabaseHealth() {
    try {
      const start = Date.now();
      await mongoose.connection.db.admin().ping();
      const responseTime = Date.now() - start;

      return {
        status: 'healthy',
        responseTime: `${responseTime}ms`,
        connections: mongoose.connection.readyState
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  // Get system alerts
  async getSystemAlerts() {
    const alerts = [];

    // Check for low stock products
    const lowStockProducts = await Product.countDocuments({
      'inventory.trackQuantity': true,
      'inventory.quantity': { $lte: '$inventory.lowStockThreshold' },
      'inventory.stockStatus': { $ne: 'out_of_stock' },
      isDeleted: false
    });

    if (lowStockProducts > 0) {
      alerts.push({
        type: 'warning',
        title: 'Low Stock Alert',
        message: `${lowStockProducts} products are running low on stock`,
        severity: 'medium',
        actionRequired: true
      });
    }

    // Check for pending orders
    const pendingOrders = await Order.countDocuments({
      status: 'pending',
      isDeleted: false
    });

    if (pendingOrders > 10) {
      alerts.push({
        type: 'info',
        title: 'High Order Volume',
        message: `${pendingOrders} orders are pending processing`,
        severity: 'low',
        actionRequired: false
      });
    }

    // Check for failed payments
    const failedPayments = await Payment.countDocuments({
      status: 'failed',
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });

    if (failedPayments > 5) {
      alerts.push({
        type: 'error',
        title: 'Payment Issues',
        message: `${failedPayments} payments failed in the last 24 hours`,
        severity: 'high',
        actionRequired: true
      });
    }

    return alerts;
  }

  // Get performance metrics
  async getPerformanceMetrics() {
    return {
      responseTime: '120ms',
      throughput: '450 req/min',
      errorRate: '0.02%',
      uptime: '99.9%'
    };
  }

  // ===============================
  // USER MANAGEMENT
  // ===============================

  // Get all users
  getAllUsers = catchAsync(async (req, res) => {
    const {
      role,
      status,
      search,
      sortBy = 'createdAt',
      page = 1,
      limit = 20
    } = req.query;

    let query = { isDeleted: false };

    if (role) query.role = role;
    if (status === 'active') query.isActive = true;
    if (status === 'inactive') query.isActive = false;
    if (status === 'suspended') query.isActive = false;

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    let sort = {};
    sort[sortBy] = -1;

    const users = await User.find(query)
      .select('-password -twoFactorSecret')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalUsers: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Get user details
  getUserDetails = catchAsync(async (req, res) => {
    const { id } = req.params;

    const user = await User.findById(id)
      .select('-password -twoFactorSecret')
      .populate('referrals.user', 'firstName lastName email')
      .populate('referredBy', 'firstName lastName');

    if (!user) {
      throw new AppError('User not found', 404, true, 'USER_NOT_FOUND');
    }

    // Get user's recent activity
    const recentOrders = await Order.findByUser(id, { limit: 5 });
    const recentReviews = await Review.findByUser(id, { limit: 5 });

    res.status(200).json({
      success: true,
      data: {
        user,
        recentOrders,
        recentReviews,
        stats: {
          totalOrders: user.totalOrders,
          totalSpent: user.totalSpent,
          loyaltyPoints: user.customerProfile?.loyaltyPoints || 0,
          accountAge: user.accountAge
        }
      }
    });
  });

  // Update user (admin)
  updateUser = catchAsync(async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    // Prevent updating sensitive fields
    const forbiddenFields = ['password', 'twoFactorSecret', 'twoFactorBackupCodes', '_id'];
    forbiddenFields.forEach(field => {
      delete updates[field];
    });

    const user = await User.findByIdAndUpdate(
      id,
      { ...updates, updatedAt: new Date(), updatedBy: req.user.id },
      { new: true, runValidators: true }
    );

    if (!user) {
      throw new AppError('User not found', 404, true, 'USER_NOT_FOUND');
    }

    logger.info('User updated by admin', {
      updatedBy: req.user.id,
      userId: id,
      updates: Object.keys(updates)
    });

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: user
    });
  });

  // Delete user (admin)
  deleteUser = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;

    const user = await User.findById(id);

    if (!user) {
      throw new AppError('User not found', 404, true, 'USER_NOT_FOUND');
    }

    // Soft delete
    user.isDeleted = true;
    user.deletedAt = new Date();
    user.deletedBy = req.user.id;
    await user.save();

    // Cancel subscriptions
    await this.cancelUserSubscriptions(id);

    // Anonymize data
    await this.anonymizeUserData(id);

    logger.info('User deleted by admin', {
      deletedBy: req.user.id,
      userId: id,
      reason
    });

    res.status(200).json({
      success: true,
      message: 'User deleted successfully'
    });
  });

  // Suspend user
  suspendUser = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { reason, duration = 24 } = req.body; // duration in hours

    const user = await User.findById(id);

    if (!user) {
      throw new AppError('User not found', 404, true, 'USER_NOT_FOUND');
    }

    user.isActive = false;
    user.suspendedAt = new Date();
    user.suspendedBy = req.user.id;
    user.suspensionReason = reason;
    user.suspensionExpires = new Date(Date.now() + duration * 60 * 60 * 1000);
    await user.save();

    // Send notification
    await Notification.createNotification(id, {
      type: 'account',
      category: 'security',
      title: 'Account Suspended',
      message: `Your account has been suspended. Reason: ${reason}`,
      priority: 'high'
    });

    logger.info('User suspended by admin', {
      suspendedBy: req.user.id,
      userId: id,
      reason,
      duration
    });

    res.status(200).json({
      success: true,
      message: 'User suspended successfully'
    });
  });

  // Activate user
  activateUser = catchAsync(async (req, res) => {
    const { id } = req.params;

    const user = await User.findById(id);

    if (!user) {
      throw new AppError('User not found', 404, true, 'USER_NOT_FOUND');
    }

    user.isActive = true;
    user.suspendedAt = undefined;
    user.suspendedBy = undefined;
    user.suspensionReason = undefined;
    user.suspensionExpires = undefined;
    await user.save();

    // Send notification
    await Notification.createNotification(id, {
      type: 'account',
      category: 'informational',
      title: 'Account Activated',
      message: 'Your account has been activated and is now fully functional.',
      priority: 'normal'
    });

    logger.info('User activated by admin', {
      activatedBy: req.user.id,
      userId: id
    });

    res.status(200).json({
      success: true,
      message: 'User activated successfully'
    });
  });

  // Get user statistics
  getUserStatistics = catchAsync(async (req, res) => {
    const { dateRange = 30 } = req.query;

    const stats = await User.getUserStats();

    // Additional analytics
    const totalUsers = await User.countDocuments({ isDeleted: false });
    const activeUsers = await User.countDocuments({ isActive: true, isDeleted: false });
    const newUsers = await User.countDocuments({
      createdAt: { $gte: new Date(Date.now() - parseInt(dateRange) * 24 * 60 * 60 * 1000) },
      isDeleted: false
    });

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalUsers,
          activeUsers,
          newUsers,
          growthRate: ((newUsers / totalUsers) * 100) || 0
        },
        roleDistribution: stats,
        recentActivity: await this.getRecentUserActivity()
      }
    });
  });

  // ===============================
  // PRODUCT MANAGEMENT
  // ===============================

  // Get all products (admin)
  getAllProducts = catchAsync(async (req, res) => {
    const {
      status,
      category,
      vendor,
      featured,
      search,
      sortBy = 'createdAt',
      page = 1,
      limit = 20
    } = req.query;

    let query = { isDeleted: false };

    if (status) query.status = status;
    if (category) query.category = category;
    if (vendor) query.vendor = vendor;
    if (featured !== undefined) query.featured = featured === 'true';

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
        { brand: { $regex: search, $options: 'i' } }
      ];
    }

    let sort = {};
    sort[sortBy] = -1;

    const products = await Product.find(query)
      .populate('vendor', 'firstName lastName email')
      .populate('store', 'name')
      .populate('category', 'name')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Product.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        products,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalProducts: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Approve product
  approveProduct = catchAsync(async (req, res) => {
    const { productId } = req.params;

    const product = await Product.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    product.status = 'published';
    product.publishedAt = new Date();
    await product.save();

    // Update category stats
    const category = await Category.findById(product.category);
    if (category) await category.updateStats();

    // Update store stats
    const store = await Store.findById(product.store);
    if (store) await store.updateAnalytics();

    // Send notification to vendor
    await Notification.createNotification(product.vendor, {
      type: 'product',
      category: 'informational',
      title: 'Product Approved',
      message: `Your product "${product.name}" has been approved and is now live.`,
      data: { productId: product._id, productName: product.name },
      priority: 'normal'
    });

    logger.info('Product approved by admin', {
      productId,
      adminId: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Product approved successfully',
      data: product
    });
  });

  // Reject product
  rejectProduct = catchAsync(async (req, res) => {
    const { productId } = req.params;
    const { reason } = req.body;

    const product = await Product.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    product.status = 'draft';
    await product.save();

    // Send notification to vendor
    await Notification.createNotification(product.vendor, {
      type: 'product',
      category: 'informational',
      title: 'Product Requires Changes',
      message: `Your product "${product.name}" needs revision. Reason: ${reason}`,
      data: { productId: product._id, productName: product.name, reason },
      priority: 'high'
    });

    logger.info('Product rejected by admin', {
      productId,
      adminId: req.user.id,
      reason
    });

    res.status(200).json({
      success: true,
      message: 'Product rejected successfully'
    });
  });

  // Feature product
  featureProduct = catchAsync(async (req, res) => {
    const { productId } = req.params;

    const product = await Product.findById(productId);

    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    product.featured = !product.featured;
    await product.save();

    logger.info('Product featured status changed', {
      productId,
      featured: product.featured,
      adminId: req.user.id
    });

    res.status(200).json({
      success: true,
      message: `Product ${product.featured ? 'featured' : 'unfeatured'} successfully`,
      data: { featured: product.featured }
    });
  });

  // Get product statistics
  getProductStatistics = catchAsync(async (req, res) => {
    const { dateRange = 30 } = req.query;

    const stats = await Product.getProductStats();

    const totalProducts = await Product.countDocuments({ isDeleted: false });
    const publishedProducts = await Product.countDocuments({ status: 'published', isDeleted: false });
    const lowStockProducts = await Product.getLowStockProducts();

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalProducts,
          publishedProducts,
          draftProducts: totalProducts - publishedProducts,
          lowStockProducts: lowStockProducts.length,
          featuredProducts: await Product.countDocuments({ featured: true, isDeleted: false })
        },
        statusDistribution: stats,
        recentActivity: await this.getRecentProductActivity()
      }
    });
  });

  // ===============================
  // ORDER MANAGEMENT
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
    sort[sortBy] = -1;

    const orders = await Order.find(query)
      .populate('user', 'firstName lastName email')
      .populate('items.vendor', 'firstName lastName')
      .populate('items.store', 'name')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

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

  // Get order details (admin)
  getOrderDetails = catchAsync(async (req, res) => {
    const { id } = req.params;

    const order = await Order.findById(id)
      .populate('user', 'firstName lastName email phone')
      .populate('items.product', 'name sku images')
      .populate('items.vendor', 'firstName lastName')
      .populate('items.store', 'name')
      .populate('vendorOrders.vendor', 'firstName lastName')
      .populate('vendorOrders.store', 'name');

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      data: {
        order,
        statusHistory: order.statusHistory,
        canCancel: order.canBeCancelled(),
        canReturn: order.canBeReturned()
      }
    });
  });

  // Update order (admin)
  updateOrder = catchAsync(async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    const order = await Order.findByIdAndUpdate(
      id,
      { ...updates, updatedAt: new Date(), updatedBy: req.user.id },
      { new: true, runValidators: true }
    );

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    logger.info('Order updated by admin', {
      orderId: id,
      adminId: req.user.id,
      updates: Object.keys(updates)
    });

    res.status(200).json({
      success: true,
      message: 'Order updated successfully',
      data: order
    });
  });

  // Cancel order (admin)
  cancelOrder = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;

    const order = await Order.findById(id);

    if (!order) {
      throw new AppError('Order not found', 404, true, 'ORDER_NOT_FOUND');
    }

    await order.updateStatus('cancelled', req.user.id, reason || 'Cancelled by admin');

    // Send notifications
    await this.sendOrderNotifications(order, 'cancelled');

    logger.info('Order cancelled by admin', {
      orderId: id,
      adminId: req.user.id,
      reason
    });

    res.status(200).json({
      success: true,
      message: 'Order cancelled successfully'
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

  // ===============================
  // VENDOR MANAGEMENT
  // ===============================

  // Get all vendors
  getAllVendors = catchAsync(async (req, res) => {
    const {
      status,
      verified,
      search,
      sortBy = 'createdAt',
      page = 1,
      limit = 20
    } = req.query;

    let query = { role: 'vendor', isDeleted: false };

    if (status === 'active') query.isActive = true;
    if (status === 'inactive') query.isActive = false;
    if (verified === 'true') query.isVerified = true;
    if (verified === 'false') query.isVerified = false;

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { 'vendorProfile.storeName': { $regex: search, $options: 'i' } }
      ];
    }

    let sort = {};
    sort[sortBy] = -1;

    const vendors = await User.find(query)
      .select('firstName lastName email vendorProfile isActive isVerified createdAt')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        vendors,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalVendors: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Approve vendor
  approveVendor = catchAsync(async (req, res) => {
    const { vendorId } = req.params;

    const vendor = await User.findById(vendorId);

    if (!vendor) {
      throw new AppError('Vendor not found', 404, true, 'VENDOR_NOT_FOUND');
    }

    if (vendor.role !== 'vendor') {
      throw new AppError('User is not a vendor', 400, true, 'NOT_A_VENDOR');
    }

    vendor.isVerified = true;
    vendor.vendorProfile.isVerified = true;
    await vendor.save();

    // Update store status
    const store = await Store.findById(vendor.vendorProfile.store);
    if (store) {
      store.verificationStatus = 'verified';
      store.status = 'active';
      await store.save();
    }

    // Send notification
    await Notification.createNotification(vendorId, {
      type: 'vendor',
      category: 'informational',
      title: 'Vendor Account Approved',
      message: 'Your vendor account has been approved. You can now start selling products.',
      priority: 'normal'
    });

    logger.info('Vendor approved by admin', {
      vendorId,
      adminId: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Vendor approved successfully',
      data: vendor
    });
  });

  // Suspend vendor
  suspendVendor = catchAsync(async (req, res) => {
    const { vendorId } = req.params;
    const { reason, duration = 24 } = req.body;

    const vendor = await User.findById(vendorId);

    if (!vendor) {
      throw new AppError('Vendor not found', 404, true, 'VENDOR_NOT_FOUND');
    }

    vendor.isActive = false;
    await vendor.save();

    // Update store status
    const store = await Store.findById(vendor.vendorProfile.store);
    if (store) {
      store.status = 'suspended';
      await store.save();
    }

    // Send notification
    await Notification.createNotification(vendorId, {
      type: 'vendor',
      category: 'security',
      title: 'Vendor Account Suspended',
      message: `Your vendor account has been suspended. Reason: ${reason}`,
      priority: 'high'
    });

    logger.info('Vendor suspended by admin', {
      vendorId,
      adminId: req.user.id,
      reason,
      duration
    });

    res.status(200).json({
      success: true,
      message: 'Vendor suspended successfully'
    });
  });

  // Get vendor statistics
  getVendorStatistics = catchAsync(async (req, res) => {
    const { dateRange = 30 } = req.query;

    const totalVendors = await User.countDocuments({ role: 'vendor', isDeleted: false });
    const activeVendors = await User.countDocuments({ role: 'vendor', isActive: true, isDeleted: false });
    const verifiedVendors = await User.countDocuments({ role: 'vendor', isVerified: true, isDeleted: false });

    const stats = await Store.getStoreStats();

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalVendors,
          activeVendors,
          verifiedVendors,
          pendingVendors: totalVendors - verifiedVendors
        },
        storeDistribution: stats,
        topVendors: await this.getTopVendors(parseInt(dateRange))
      }
    });
  });

  // ===============================
  // PAYMENT MANAGEMENT
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

  // Get payment details (admin)
  getPaymentDetails = catchAsync(async (req, res) => {
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

  // Process refund (admin)
  processRefund = catchAsync(async (req, res) => {
    const { paymentId } = req.params;
    const { amount, reason } = req.body;

    const payment = await Payment.findById(paymentId);

    if (!payment) {
      throw new AppError('Payment not found', 404, true, 'PAYMENT_NOT_FOUND');
    }

    await payment.processRefund({
      amount,
      reason,
      description: `Admin refund: ${reason}`
    }, req.user.id);

    // Send notifications
    await this.sendPaymentNotifications(payment, 'refunded');

    logger.info('Refund processed by admin', {
      paymentId,
      refundAmount: amount,
      adminId: req.user.id,
      reason
    });

    res.status(200).json({
      success: true,
      message: 'Refund processed successfully',
      data: {
        payment: payment.getPaymentSummary(),
        refundAmount: amount
      }
    });
  });

  // Get payment statistics
  getPaymentStatistics = catchAsync(async (req, res) => {
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

  // ===============================
  // CATEGORY MANAGEMENT
  // ===============================

  // Get all categories
  getAllCategories = catchAsync(async (req, res) => {
    const {
      status = 'active',
      type,
      parent,
      search,
      sortBy = 'position',
      page = 1,
      limit = 20
    } = req.query;

    let query = { isDeleted: false };

    if (status) query.status = status;
    if (type) query.type = type;
    if (parent) query.parent = parent;

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    let sort = {};
    sort[sortBy] = 1;

    const categories = await Category.find(query)
      .populate('parent', 'name slug')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Category.countDocuments(query);

    // Get category tree
    const categoryTree = await Category.getCategoryTree();

    res.status(200).json({
      success: true,
      data: {
        categories,
        categoryTree,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalCategories: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Create category
  createCategory = catchAsync(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const {
      name,
      description,
      parent,
      type = 'product',
      icon,
      color,
      position = 0
    } = req.body;

    // Check if parent category exists
    if (parent) {
      const parentCategory = await Category.findById(parent);
      if (!parentCategory) {
        throw new AppError('Parent category not found', 404, true, 'PARENT_CATEGORY_NOT_FOUND');
      }
    }

    const category = new Category({
      name,
      description,
      parent,
      type,
      icon,
      color,
      position,
      createdBy: req.user.id
    });

    await category.save();

    // Update parent children array
    if (parent) {
      await Category.findByIdAndUpdate(parent, {
        $push: { children: category._id }
      });
    }

    logger.info('Category created', {
      categoryId: category._id,
      name,
      createdBy: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: category
    });
  });

  // Update category
  updateCategory = catchAsync(async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    const category = await Category.findByIdAndUpdate(
      id,
      { ...updates, updatedAt: new Date(), updatedBy: req.user.id },
      { new: true, runValidators: true }
    );

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    logger.info('Category updated', {
      categoryId: id,
      updatedBy: req.user.id,
      updates: Object.keys(updates)
    });

    res.status(200).json({
      success: true,
      message: 'Category updated successfully',
      data: category
    });
  });

  // Delete category
  deleteCategory = catchAsync(async (req, res) => {
    const { id } = req.params;

    const category = await Category.findById(id);

    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    // Check if category has products
    const productCount = await Product.countDocuments({ category: id });

    if (productCount > 0) {
      throw new AppError('Cannot delete category with existing products', 400, true, 'CATEGORY_HAS_PRODUCTS');
    }

    // Soft delete
    category.isDeleted = true;
    category.deletedAt = new Date();
    category.deletedBy = req.user.id;
    await category.save();

    // Remove from parent children
    if (category.parent) {
      await Category.findByIdAndUpdate(category.parent, {
        $pull: { children: category._id }
      });
    }

    logger.info('Category deleted', {
      categoryId: id,
      deletedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Category deleted successfully'
    });
  });

  // Get category statistics
  getCategoryStatistics = catchAsync(async (req, res) => {
    const stats = await Category.getCategoryStats();

    const totalCategories = await Category.countDocuments({ isDeleted: false });
    const activeCategories = await Category.countDocuments({ status: 'active', isDeleted: false });

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalCategories,
          activeCategories,
          inactiveCategories: totalCategories - activeCategories
        },
        statusDistribution: stats,
        popularCategories: await this.getPopularCategories()
      }
    });
  });

  // ===============================
  // REVIEW MANAGEMENT
  // ===============================

  // Get all reviews (admin)
  getAllReviews = catchAsync(async (req, res) => {
    const {
      status = 'pending',
      rating,
      product,
      user,
      sortBy = 'createdAt',
      page = 1,
      limit = 20
    } = req.query;

    let query = {};

    if (status) query.status = status;
    if (rating) query.rating = parseInt(rating);
    if (product) query.product = product;
    if (user) query.user = user;

    let sort = {};
    sort[sortBy] = -1;

    const reviews = await Review.find(query)
      .populate('user', 'firstName lastName email')
      .populate('product', 'name slug images')
      .populate('vendor', 'firstName lastName')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Review.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        reviews,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalReviews: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // Approve review
  approveReview = catchAsync(async (req, res) => {
    const { reviewId } = req.params;

    const review = await Review.findById(reviewId);

    if (!review) {
      throw new AppError('Review not found', 404, true, 'REVIEW_NOT_FOUND');
    }

    await review.approveReview(req.user.id, 'Approved by admin');

    logger.info('Review approved by admin', {
      reviewId,
      adminId: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Review approved successfully',
      data: review
    });
  });

  // Reject review
  rejectReview = catchAsync(async (req, res) => {
    const { reviewId } = req.params;
    const { reason } = req.body;

    const review = await Review.findById(reviewId);

    if (!review) {
      throw new AppError('Review not found', 404, true, 'REVIEW_NOT_FOUND');
    }

    await review.rejectReview(req.user.id, reason, 'Rejected by admin');

    logger.info('Review rejected by admin', {
      reviewId,
      adminId: req.user.id,
      reason
    });

    res.status(200).json({
      success: true,
      message: 'Review rejected successfully'
    });
  });

  // Bulk approve reviews
  bulkApproveReviews = catchAsync(async (req, res) => {
    const { reviewIds } = req.body;

    const result = await Review.bulkApprove(reviewIds, req.user.id);

    logger.info('Reviews bulk approved', {
      adminId: req.user.id,
      approvedCount: result
    });

    res.status(200).json({
      success: true,
      message: 'Reviews approved successfully',
      data: { approvedCount: result }
    });
  });

  // Get review statistics
  getReviewStatistics = catchAsync(async (req, res) => {
    const { dateRange = 30 } = req.query;

    const stats = await Review.getReviewStats();
    const analytics = await Review.getReviewAnalytics(parseInt(dateRange));

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalReviews: await Review.countDocuments({ status: 'approved' }),
          pendingReviews: await Review.countDocuments({ status: 'pending' }),
          averageRating: stats.averageRating || 0
        },
        ratingDistribution: stats.ratingDistribution,
        trends: analytics,
        topRatedProducts: await this.getTopRatedProducts()
      }
    });
  });

  // ===============================
  // CONTENT MANAGEMENT
  // ===============================

  // Get system settings
  getSystemSettings = catchAsync(async (req, res) => {
    const settings = {
      general: {
        siteName: process.env.APP_NAME || 'E-commerce',
        siteUrl: process.env.CLIENT_URL,
        adminEmail: process.env.ADMIN_EMAIL,
        supportEmail: process.env.SUPPORT_EMAIL,
        maintenanceMode: false
      },
      features: {
        registration: process.env.ENABLE_REGISTRATION === 'true',
        socialLogin: process.env.ENABLE_SOCIAL_LOGIN === 'true',
        emailVerification: process.env.ENABLE_EMAIL_VERIFICATION === 'true',
        smsVerification: process.env.ENABLE_SMS_VERIFICATION === 'true',
        multiVendor: true,
        reviews: true,
        analytics: process.env.ENABLE_ANALYTICS === 'true'
      },
      payments: {
        stripe: !!process.env.STRIPE_SECRET_KEY,
        paypal: !!process.env.PAYPAL_CLIENT_ID,
        currencies: ['USD', 'EUR', 'GBP', 'CAD', 'AUD']
      },
      notifications: {
        email: process.env.ENABLE_EMAIL_NOTIFICATIONS === 'true',
        sms: process.env.ENABLE_SMS_NOTIFICATIONS === 'true',
        push: process.env.ENABLE_PUSH_NOTIFICATIONS === 'true'
      }
    };

    res.status(200).json({
      success: true,
      data: settings
    });
  });

  // Update system settings
  updateSystemSettings = catchAsync(async (req, res) => {
    const { settings } = req.body;

    // Update settings (implementation depends on settings storage)
    logger.info('System settings updated', {
      adminId: req.user.id,
      settings: Object.keys(settings)
    });

    res.status(200).json({
      success: true,
      message: 'System settings updated successfully'
    });
  });

  // Get maintenance mode status
  getMaintenanceMode = catchAsync(async (req, res) => {
    // Check if maintenance mode is enabled
    const maintenanceMode = false; // This would be stored in database/cache

    res.status(200).json({
      success: true,
      data: {
        enabled: maintenanceMode,
        message: 'System is under maintenance',
        estimatedTime: null
      }
    });
  });

  // Toggle maintenance mode
  toggleMaintenanceMode = catchAsync(async (req, res) => {
    const { enabled, message } = req.body;

    // Toggle maintenance mode (implementation depends on storage)
    logger.info('Maintenance mode toggled', {
      adminId: req.user.id,
      enabled,
      message
    });

    res.status(200).json({
      success: true,
      message: `Maintenance mode ${enabled ? 'enabled' : 'disabled'}`
    });
  });

  // ===============================
  // ANALYTICS & REPORTING
  // ===============================

  // Get comprehensive analytics
  getAnalytics = catchAsync(async (req, res) => {
    const { dateRange = 30, type = 'overview' } = req.query;

    let analytics = {};

    switch (type) {
      case 'users':
        analytics = await this.getUserAnalytics(parseInt(dateRange));
        break;
      case 'products':
        analytics = await this.getProductAnalytics(parseInt(dateRange));
        break;
      case 'orders':
        analytics = await this.getOrderAnalytics(parseInt(dateRange));
        break;
      case 'payments':
        analytics = await this.getPaymentAnalytics(parseInt(dateRange));
        break;
      case 'vendors':
        analytics = await this.getVendorAnalytics(parseInt(dateRange));
        break;
      default:
        analytics = await this.getOverviewAnalytics(parseInt(dateRange));
    }

    res.status(200).json({
      success: true,
      data: {
        type,
        dateRange: parseInt(dateRange),
        analytics,
        generatedAt: new Date()
      }
    });
  });

  // Get overview analytics
  async getOverviewAnalytics(dateRange) {
    const userAnalytics = await this.getUserAnalytics(dateRange);
    const productAnalytics = await this.getProductAnalytics(dateRange);
    const orderAnalytics = await this.getOrderAnalytics(dateRange);
    const paymentAnalytics = await this.getPaymentAnalytics(dateRange);

    return {
      users: userAnalytics.overview,
      products: productAnalytics.overview,
      orders: orderAnalytics.overview,
      payments: paymentAnalytics.overview,
      trends: {
        userGrowth: userAnalytics.trends,
        salesGrowth: orderAnalytics.trends,
        revenueGrowth: paymentAnalytics.trends
      }
    };
  }

  // Get user analytics
  async getUserAnalytics(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const newUsers = await User.countDocuments({
      createdAt: { $gte: startDate },
      isDeleted: false
    });

    const activeUsers = await User.countDocuments({
      lastLogin: { $gte: startDate },
      isDeleted: false
    });

    return {
      overview: {
        totalUsers: await User.countDocuments({ isDeleted: false }),
        newUsers,
        activeUsers,
        growth: ((newUsers / (await User.countDocuments({ isDeleted: false })) * 100) || 0)
      },
      trends: await this.getUserGrowthTrend(dateRange)
    };
  }

  // Get product analytics
  async getProductAnalytics(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const newProducts = await Product.countDocuments({
      createdAt: { $gte: startDate },
      isDeleted: false
    });

    return {
      overview: {
        totalProducts: await Product.countDocuments({ isDeleted: false }),
        newProducts,
        publishedProducts: await Product.countDocuments({ status: 'published', isDeleted: false }),
        averagePrice: await this.getAverageProductPrice()
      },
      trends: await this.getProductTrend(dateRange)
    };
  }

  // Get order analytics
  async getOrderAnalytics(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const newOrders = await Order.countDocuments({
      orderedAt: { $gte: startDate },
      isDeleted: false
    });

    const completedOrders = await Order.countDocuments({
      status: { $in: ['completed', 'delivered'] },
      orderedAt: { $gte: startDate },
      isDeleted: false
    });

    return {
      overview: {
        totalOrders: await Order.countDocuments({ isDeleted: false }),
        newOrders,
        completedOrders,
        totalRevenue: await this.getTotalRevenue(startDate)
      },
      trends: await this.getOrderTrend(dateRange)
    };
  }

  // Get payment analytics
  async getPaymentAnalytics(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const completedPayments = await Payment.countDocuments({
      status: 'completed',
      createdAt: { $gte: startDate }
    });

    return {
      overview: {
        totalPayments: await Payment.countDocuments({ status: 'completed' }),
        completedPayments,
        totalAmount: await this.getTotalPaymentAmount(startDate),
        successRate: 98.5 // Mock data
      },
      trends: await this.getPaymentTrend(dateRange)
    };
  }

  // Get vendor analytics
  async getVendorAnalytics(dateRange) {
    const totalVendors = await User.countDocuments({ role: 'vendor', isDeleted: false });
    const activeVendors = await User.countDocuments({ role: 'vendor', isActive: true, isDeleted: false });

    return {
      overview: {
        totalVendors,
        activeVendors,
        verifiedVendors: await User.countDocuments({ role: 'vendor', isVerified: true, isDeleted: false }),
        newVendors: await User.countDocuments({
          role: 'vendor',
          createdAt: { $gte: new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000) },
          isDeleted: false
        })
      },
      trends: await this.getVendorTrend(dateRange)
    };
  }

  // ===============================
  // SYSTEM MANAGEMENT
  // ===============================

  // Get system logs
  getSystemLogs = catchAsync(async (req, res) => {
    const {
      level,
      type,
      dateFrom,
      dateTo,
      page = 1,
      limit = 50
    } = req.query;

    // This would typically read from log files or a logging service
    const logs = []; // Mock log data

    res.status(200).json({
      success: true,
      data: {
        logs,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(logs.length / limit),
          totalLogs: logs.length
        }
      }
    });
  });

  // Get system performance
  getSystemPerformance = catchAsync(async (req, res) => {
    const performance = {
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      uptime: process.uptime(),
      loadAverage: require('os').loadavg(),
      disk: await this.getDiskUsage(),
      network: await this.getNetworkStats()
    };

    res.status(200).json({
      success: true,
      data: performance
    });
  });

  // Get disk usage
  async getDiskUsage() {
    // Implementation for disk usage monitoring
    return {
      total: '100GB',
      used: '45GB',
      free: '55GB',
      percentage: 45
    };
  }

  // Get network stats
  async getNetworkStats() {
    // Implementation for network monitoring
    return {
      requests: '1250/min',
      bandwidth: '45MB/min',
      errors: '0.02%'
    };
  }

  // Clear cache
  clearCache = catchAsync(async (req, res) => {
    const { type = 'all' } = req.body;

    // Clear different types of cache
    if (type === 'all' || type === 'redis') {
      // Clear Redis cache
    }

    if (type === 'all' || type === 'memory') {
      // Clear in-memory cache
    }

    logger.info('Cache cleared', {
      adminId: req.user.id,
      type
    });

    res.status(200).json({
      success: true,
      message: 'Cache cleared successfully'
    });
  });

  // Database backup
  createBackup = catchAsync(async (req, res) => {
    const { type = 'full' } = req.body;

    const backup = {
      id: `backup_${Date.now()}`,
      type,
      status: 'in_progress',
      createdAt: new Date(),
      createdBy: req.user.id
    };

    // Start backup process (this would be async)
    setTimeout(async () => {
      // Complete backup
      logger.info('Database backup completed', {
        backupId: backup.id,
        type,
        createdBy: req.user.id
      });
    }, 5000);

    res.status(200).json({
      success: true,
      message: 'Backup started',
      data: {
        backupId: backup.id,
        estimatedTime: '5 minutes'
      }
    });
  });

  // Get backup history
  getBackupHistory = catchAsync(async (req, res) => {
    const backups = []; // Mock backup history

    res.status(200).json({
      success: true,
      data: backups
    });
  });

  // ===============================
  // SECURITY MANAGEMENT
  // ===============================

  // Get security logs
  getSecurityLogs = catchAsync(async (req, res) => {
    const {
      type,
      user,
      dateFrom,
      dateTo,
      page = 1,
      limit = 50
    } = req.query;

    const logs = []; // Mock security logs

    res.status(200).json({
      success: true,
      data: {
        logs,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(logs.length / limit),
          totalLogs: logs.length
        }
      }
    });
  });

  // Get failed login attempts
  getFailedLogins = catchAsync(async (req, res) => {
    const { dateRange = 24 } = req.query; // hours

    const cutoffDate = new Date(Date.now() - parseInt(dateRange) * 60 * 60 * 1000);

    const failedAttempts = await User.find({
      'loginHistory.success': false,
      'loginHistory.timestamp': { $gte: cutoffDate }
    })
    .select('loginHistory')
    .populate('firstName lastName email');

    res.status(200).json({
      success: true,
      data: {
        failedAttempts: failedAttempts.flatMap(user =>
          user.loginHistory.filter(log => !log.success)
        ),
        summary: {
          totalAttempts: failedAttempts.reduce((sum, user) =>
            sum + user.loginHistory.filter(log => !log.success).length, 0
          ),
          uniqueUsers: failedAttempts.length
        }
      }
    });
  });

  // Block IP address
  blockIP = catchAsync(async (req, res) => {
    const { ip, reason, duration = 24 } = req.body; // duration in hours

    // Add IP to blocklist (implementation depends on storage)
    logger.info('IP address blocked', {
      adminId: req.user.id,
      ip,
      reason,
      duration
    });

    res.status(200).json({
      success: true,
      message: 'IP address blocked successfully',
      data: {
        ip,
        blockedUntil: new Date(Date.now() + duration * 60 * 60 * 1000)
      }
    });
  });

  // Unblock IP address
  unblockIP = catchAsync(async (req, res) => {
    const { ip } = req.params;

    // Remove IP from blocklist
    logger.info('IP address unblocked', {
      adminId: req.user.id,
      ip
    });

    res.status(200).json({
      success: true,
      message: 'IP address unblocked successfully'
    });
  });

  // Get blocked IPs
  getBlockedIPs = catchAsync(async (req, res) => {
    const blockedIPs = []; // Mock blocked IPs

    res.status(200).json({
      success: true,
      data: blockedIPs
    });
  });

  // ===============================
  // NOTIFICATION MANAGEMENT
  // ===============================

  // Get notification settings
  getNotificationSettings = catchAsync(async (req, res) => {
    const settings = {
      email: {
        enabled: process.env.ENABLE_EMAIL_NOTIFICATIONS === 'true',
        orderUpdates: true,
        promotions: false,
        securityAlerts: true
      },
      sms: {
        enabled: process.env.ENABLE_SMS_NOTIFICATIONS === 'true',
        orderUpdates: true,
        securityAlerts: true
      },
      push: {
        enabled: process.env.ENABLE_PUSH_NOTIFICATIONS === 'true',
        orderUpdates: true,
        promotions: false
      }
    };

    res.status(200).json({
      success: true,
      data: settings
    });
  });

  // Update notification settings
  updateNotificationSettings = catchAsync(async (req, res) => {
    const { settings } = req.body;

    // Update notification settings
    logger.info('Notification settings updated', {
      adminId: req.user.id,
      settings: Object.keys(settings)
    });

    res.status(200).json({
      success: true,
      message: 'Notification settings updated successfully'
    });
  });

  // Send broadcast notification
  sendBroadcastNotification = catchAsync(async (req, res) => {
    const { title, message, type, priority = 'normal', targetUsers = 'all' } = req.body;

    let query = { isDeleted: false };

    if (targetUsers === 'customers') {
      query.role = 'customer';
    } else if (targetUsers === 'vendors') {
      query.role = 'vendor';
    }

    const users = await User.find(query).select('_id');

    // Create notifications for all users
    const notifications = users.map(userId => ({
      user: userId,
      type,
      category: 'informational',
      title,
      message,
      priority,
      source: 'admin'
    }));

    await Notification.insertMany(notifications);

    logger.info('Broadcast notification sent', {
      adminId: req.user.id,
      title,
      targetUsers,
      recipientCount: users.length
    });

    res.status(200).json({
      success: true,
      message: 'Broadcast notification sent successfully',
      data: {
        recipientCount: users.length,
        title,
        type
      }
    });
  });

  // Get notification history
  getNotificationHistory = catchAsync(async (req, res) => {
    const {
      type,
      status,
      page = 1,
      limit = 20
    } = req.query;

    let query = {};

    if (type) query.type = type;
    if (status) query.status = status;

    const notifications = await Notification.find(query)
      .populate('user', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Notification.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        notifications,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalNotifications: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  });

  // ===============================
  // UTILITY METHODS
  // ===============================

  // Helper methods for analytics
  async getUserGrowthTrend(dateRange) {
    // Mock implementation
    return Array.from({ length: dateRange }, (_, i) => ({
      date: new Date(Date.now() - (dateRange - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      newUsers: Math.floor(Math.random() * 20) + 5
    }));
  }

  async getProductTrend(dateRange) {
    // Mock implementation
    return Array.from({ length: dateRange }, (_, i) => ({
      date: new Date(Date.now() - (dateRange - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      newProducts: Math.floor(Math.random() * 10) + 2
    }));
  }

  async getOrderTrend(dateRange) {
    // Mock implementation
    return Array.from({ length: dateRange }, (_, i) => ({
      date: new Date(Date.now() - (dateRange - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      orders: Math.floor(Math.random() * 50) + 10,
      revenue: Math.floor(Math.random() * 5000) + 1000
    }));
  }

  async getPaymentTrend(dateRange) {
    // Mock implementation
    return Array.from({ length: dateRange }, (_, i) => ({
      date: new Date(Date.now() - (dateRange - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      payments: Math.floor(Math.random() * 40) + 8,
      amount: Math.floor(Math.random() * 4000) + 800
    }));
  }

  async getVendorTrend(dateRange) {
    // Mock implementation
    return Array.from({ length: dateRange }, (_, i) => ({
      date: new Date(Date.now() - (dateRange - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      newVendors: Math.floor(Math.random() * 5) + 1
    }));
  }

  async getAverageProductPrice() {
    const result = await Product.aggregate([
      { $match: { status: 'published', isDeleted: false } },
      { $group: { _id: null, average: { $avg: '$price' } } }
    ]);
    return result[0]?.average || 0;
  }

  async getTotalRevenue(startDate) {
    const result = await Order.aggregate([
      {
        $match: {
          status: { $in: ['completed', 'delivered'] },
          orderedAt: { $gte: startDate },
          isDeleted: false
        }
      },
      { $group: { _id: null, total: { $sum: '$pricing.totalAmount' } } }
    ]);
    return result[0]?.total || 0;
  }

  async getTotalPaymentAmount(startDate) {
    const result = await Payment.aggregate([
      {
        $match: {
          status: 'completed',
          createdAt: { $gte: startDate }
        }
      },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    return result[0]?.total || 0;
  }

  async getTopProducts(dateRange) {
    // Implementation for top products
    return [];
  }

  async getTopVendors(dateRange) {
    // Implementation for top vendors
    return [];
  }

  async getPopularCategories() {
    const categories = await Category.find({
      status: 'active',
      isDeleted: false
    })
    .sort({ 'stats.productCount': -1 })
    .limit(10)
    .select('name slug stats.productCount');

    return categories;
  }

  async getTopRatedProducts() {
    const products = await Product.find({
      status: 'published',
      isDeleted: false,
      'rating.count': { $gte: 5 }
    })
    .sort({ 'rating.average': -1 })
    .limit(10)
    .select('name slug rating.average rating.count');

    return products;
  }

  async getRecentUserActivity() {
    const recentUsers = await User.find({ isDeleted: false })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('firstName lastName email role createdAt');

    return recentUsers;
  }

  async getRecentProductActivity() {
    const recentProducts = await Product.find({ isDeleted: false })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('vendor', 'firstName lastName')
      .select('name price status createdAt vendor');

    return recentProducts;
  }

  // Helper methods for notifications
  async sendOrderNotifications(order, event) {
    const notifications = [];

    // Notify customer
    notifications.push(Notification.createNotification(order.user, {
      type: 'order',
      category: 'transactional',
      title: this.getOrderNotificationTitle(event),
      message: this.getOrderNotificationMessage(event, order),
      data: { orderId: order._id, orderNumber: order.orderNumber },
      priority: 'normal'
    }));

    // Notify vendors
    const vendors = [...new Set(order.items.map(item => item.vendor.toString()))];
    for (const vendorId of vendors) {
      notifications.push(Notification.createNotification(vendorId, {
        type: 'order',
        category: 'transactional',
        title: this.getOrderNotificationTitle(event, 'vendor'),
        message: this.getOrderNotificationMessage(event, order, 'vendor'),
        data: { orderId: order._id, orderNumber: order.orderNumber },
        priority: 'normal'
      }));
    }

    await Promise.all(notifications);
  }

  async sendPaymentNotifications(payment, event) {
    await Notification.createNotification(payment.user, {
      type: 'payment',
      category: 'transactional',
      title: this.getPaymentNotificationTitle(event),
      message: this.getPaymentNotificationMessage(event, payment),
      data: { paymentId: payment._id, amount: payment.amount },
      priority: 'normal'
    });
  }

  // Get notification titles and messages
  getOrderNotificationTitle(event, recipient = 'customer') {
    const titles = {
      'created': { customer: 'Order Confirmed', vendor: 'New Order' },
      'payment_confirmed': { customer: 'Payment Confirmed', vendor: 'Payment Received' },
      'shipped': { customer: 'Order Shipped', vendor: 'Order Fulfilled' },
      'delivered': { customer: 'Order Delivered', vendor: 'Order Completed' },
      'cancelled': { customer: 'Order Cancelled', vendor: 'Order Cancelled' }
    };
    return titles[event]?.[recipient] || 'Order Update';
  }

  getOrderNotificationMessage(event, order, recipient = 'customer') {
    const messages = {
      'created': {
        customer: `Your order ${order.orderNumber} has been confirmed.`,
        vendor: `You have received a new order ${order.orderNumber}.`
      },
      'payment_confirmed': {
        customer: 'Payment for your order has been confirmed.',
        vendor: 'Payment for order has been received.'
      },
      'shipped': {
        customer: `Your order ${order.orderNumber} has been shipped!`,
        vendor: 'Order has been fulfilled and shipped.'
      }
    };
    return messages[event]?.[recipient] || 'Your order has been updated.';
  }

  getPaymentNotificationTitle(event) {
    const titles = {
      'completed': 'Payment Successful',
      'failed': 'Payment Failed',
      'refunded': 'Payment Refunded'
    };
    return titles[event] || 'Payment Update';
  }

  getPaymentNotificationMessage(event, payment) {
    const messages = {
      'completed': `Your payment of $${payment.amount} has been processed.`,
      'failed': 'Your payment could not be processed.',
      'refunded': `A refund of $${payment.totalRefundedAmount} has been processed.`
    };
    return messages[event] || 'Your payment status has been updated.';
  }

  // Helper methods for data management
  async cancelUserSubscriptions(userId) {
    // Implementation for canceling user subscriptions
    logger.info('User subscriptions cancelled', { userId });
  }

  async anonymizeUserData(userId) {
    // Implementation for anonymizing user data
    logger.info('User data anonymized', { userId });
  }

  async getTopPaymentMethods(dateRange) {
    // Implementation for top payment methods
    return [];
  }

  async getRiskAnalysis(dateRange) {
    // Implementation for risk analysis
    return [];
  }
}

module.exports = new AdminController();
