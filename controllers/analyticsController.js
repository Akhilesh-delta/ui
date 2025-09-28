const Analytics = require('../models/Analytics');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Store = require('../models/Store');
const Category = require('../models/Category');
const { validationResult } = require('express-validator');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const mongoose = require('mongoose');

class AnalyticsController {
  // ===============================
  // DASHBOARD ANALYTICS
  // ===============================

  // Get dashboard overview
  getDashboardOverview = catchAsync(async (req, res) => {
    const { dateRange = 30, compareWithPrevious = false } = req.query;

    // Get current period data
    const currentPeriod = await this.getOverviewMetrics(parseInt(dateRange));

    // Get previous period data for comparison
    let previousPeriod = null;
    if (compareWithPrevious === 'true') {
      previousPeriod = await this.getOverviewMetrics(parseInt(dateRange), true);
    }

    // Get real-time metrics
    const realTimeMetrics = await Analytics.getRealTimeMetrics();

    // Get trending data
    const trends = await this.getTrendingData(parseInt(dateRange));

    res.status(200).json({
      success: true,
      data: {
        period: `${dateRange} days`,
        current: currentPeriod,
        previous: previousPeriod,
        comparison: this.calculateComparison(currentPeriod, previousPeriod),
        realTime: realTimeMetrics,
        trends,
        lastUpdated: new Date()
      }
    });
  });

  // Get overview metrics
  async getOverviewMetrics(dateRange, isPrevious = false) {
    const startDate = new Date(Date.now() - (isPrevious ? dateRange * 2 : dateRange) * 24 * 60 * 60 * 1000);
    const endDate = new Date(Date.now() - (isPrevious ? dateRange : 0) * 24 * 60 * 60 * 1000);

    const [
      userMetrics,
      orderMetrics,
      productMetrics,
      revenueMetrics,
      systemMetrics
    ] = await Promise.all([
      this.getUserMetrics(startDate, endDate),
      this.getOrderMetrics(startDate, endDate),
      this.getProductMetrics(startDate, endDate),
      this.getRevenueMetrics(startDate, endDate),
      this.getSystemMetrics(startDate, endDate)
    ]);

    return {
      users: userMetrics,
      orders: orderMetrics,
      products: productMetrics,
      revenue: revenueMetrics,
      system: systemMetrics,
      period: { startDate, endDate }
    };
  }

  // Get user metrics
  async getUserMetrics(startDate, endDate) {
    const userRegistrations = await Analytics.getAnalyticsSummary('user_registration', 30);
    const userLogins = await Analytics.getAnalyticsSummary('user_login', 30);
    const activeUsers = await this.getActiveUsers(startDate, endDate);

    return {
      totalRegistrations: userRegistrations.totalEvents,
      totalLogins: userLogins.totalEvents,
      activeUsers: activeUsers.length,
      registrationRate: userRegistrations.averageValue || 0,
      loginRate: userLogins.averageValue || 0
    };
  },

  // Get order metrics
  async getOrderMetrics(startDate, endDate) {
    const ordersPlaced = await Analytics.getAnalyticsSummary('order_placed', 30);
    const ordersCompleted = await Analytics.getAnalyticsSummary('order_completed', 30);
    const ordersCancelled = await Analytics.getAnalyticsSummary('order_cancelled', 30);

    const conversionRate = ordersPlaced.totalEvents > 0 ?
      (ordersCompleted.totalEvents / ordersPlaced.totalEvents) * 100 : 0;

    return {
      totalOrders: ordersPlaced.totalEvents,
      completedOrders: ordersCompleted.totalEvents,
      cancelledOrders: ordersCancelled.totalEvents,
      conversionRate: Math.round(conversionRate * 100) / 100,
      averageOrderValue: ordersCompleted.averageValue || 0
    };
  },

  // Get product metrics
  async getProductMetrics(startDate, endDate) {
    const productViews = await Analytics.getAnalyticsSummary('product_view', 30);
    const productPurchases = await Analytics.getAnalyticsSummary('product_purchase', 30);
    const productRatings = await Analytics.getAnalyticsSummary('product_rating', 30);

    const conversionRate = productViews.totalEvents > 0 ?
      (productPurchases.totalEvents / productViews.totalEvents) * 100 : 0;

    return {
      totalViews: productViews.totalEvents,
      totalPurchases: productPurchases.totalEvents,
      totalRatings: productRatings.totalEvents,
      conversionRate: Math.round(conversionRate * 100) / 100,
      averageRating: productRatings.averageValue || 0
    };
  },

  // Get revenue metrics
  async getRevenueMetrics(startDate, endDate) {
    const paymentsSuccess = await Analytics.getAnalyticsSummary('payment_success', 30);
    const paymentsFailed = await Analytics.getAnalyticsSummary('payment_failed', 30);
    const refunds = await Analytics.getAnalyticsSummary('refund_processed', 30);

    const successRate = paymentsSuccess.totalEvents + paymentsFailed.totalEvents > 0 ?
      (paymentsSuccess.totalEvents / (paymentsSuccess.totalEvents + paymentsFailed.totalEvents)) * 100 : 0;

    return {
      totalRevenue: paymentsSuccess.totalValue,
      failedPayments: paymentsFailed.totalEvents,
      totalRefunds: Math.abs(refunds.totalValue),
      successRate: Math.round(successRate * 100) / 100,
      netRevenue: paymentsSuccess.totalValue - Math.abs(refunds.totalValue)
    };
  },

  // Get system metrics
  async getSystemMetrics(startDate, endDate) {
    const apiCalls = await Analytics.getAnalyticsSummary('api_call', 30);
    const systemErrors = await Analytics.getAnalyticsSummary('system_error', 30);
    const pageViews = await Analytics.getAnalyticsSummary('page_view', 30);

    const errorRate = apiCalls.totalEvents > 0 ?
      (systemErrors.totalEvents / apiCalls.totalEvents) * 100 : 0;

    return {
      totalApiCalls: apiCalls.totalEvents,
      totalErrors: systemErrors.totalEvents,
      totalPageViews: pageViews.totalEvents,
      errorRate: Math.round(errorRate * 100) / 100,
      averageResponseTime: systemErrors.averageValue || 0
    };
  },

  // Get active users
  async getActiveUsers(startDate, endDate) {
    const activeUsers = await Analytics.distinct('user', {
      timestamp: { $gte: startDate, $lte: endDate },
      user: { $exists: true }
    });

    return activeUsers;
  },

  // Calculate comparison between periods
  calculateComparison(current, previous) {
    if (!previous) return null;

    const comparison = {};

    ['users', 'orders', 'products', 'revenue', 'system'].forEach(category => {
      comparison[category] = {};

      Object.keys(current[category]).forEach(metric => {
        const currentValue = current[category][metric];
        const previousValue = previous[category][metric];

        if (typeof currentValue === 'number' && typeof previousValue === 'number') {
          const change = previousValue !== 0 ?
            ((currentValue - previousValue) / previousValue) * 100 : 0;

          comparison[category][metric] = {
            current: currentValue,
            previous: previousValue,
            change: Math.round(change * 100) / 100,
            trend: change > 0 ? 'up' : change < 0 ? 'down' : 'stable'
          };
        }
      });
    });

    return comparison;
  },

  // Get trending data
  async getTrendingData(dateRange) {
    const trends = await Analytics.aggregate([
      {
        $match: {
          timestamp: { $gte: new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000) }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            type: '$type'
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.date',
          metrics: {
            $push: {
              type: '$_id.type',
              count: '$count'
            }
          }
        }
      },
      { $sort: { _id: 1 } },
      { $limit: 30 }
    ]);

    return trends;
  },

  // ===============================
  // USER ANALYTICS
  // ===============================

  // Get user analytics
  getUserAnalytics = catchAsync(async (req, res) => {
    const { userId } = req.params;
    const { dateRange = 30 } = req.query;

    // Check permissions
    if (req.user.role !== 'admin' && req.user.id !== userId) {
      throw new AppError('Not authorized to view this user analytics', 403, true, 'NOT_AUTHORIZED');
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404, true, 'USER_NOT_FOUND');
    }

    const behavior = await Analytics.getUserBehaviorAnalytics(userId, parseInt(dateRange));
    const timeSeries = await Analytics.getTimeSeries(null, 'day', parseInt(dateRange));
    const deviceAnalytics = await Analytics.getDeviceAnalytics(null, parseInt(dateRange));
    const geoAnalytics = await Analytics.getGeographicAnalytics(null, parseInt(dateRange));

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: `${user.firstName} ${user.lastName}`,
          email: user.email,
          role: user.role
        },
        behavior,
        timeSeries,
        devices: deviceAnalytics,
        locations: geoAnalytics,
        period: `${dateRange} days`
      }
    });
  });

  // Get user engagement analytics
  getUserEngagement = catchAsync(async (req, res) => {
    const { dateRange = 30 } = req.query;

    const engagement = await Analytics.aggregate([
      {
        $match: {
          timestamp: { $gte: new Date(Date.now() - parseInt(dateRange) * 24 * 60 * 60 * 1000) },
          user: { $exists: true }
        }
      },
      {
        $group: {
          _id: '$user',
          sessions: { $addToSet: '$sessionId' },
          events: { $sum: 1 },
          value: { $sum: '$value' },
          lastActivity: { $max: '$timestamp' }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userInfo'
        }
      },
      { $unwind: '$userInfo' },
      {
        $project: {
          user: {
            id: '$userInfo._id',
            name: { $concat: ['$userInfo.firstName', ' ', '$userInfo.lastName'] },
            avatar: '$userInfo.avatar'
          },
          sessions: { $size: '$sessions' },
          events: 1,
          value: 1,
          lastActivity: 1,
          engagementScore: {
            $add: [
              { $multiply: ['$events', 1] },
              { $multiply: [{ $size: '$sessions' }, 2] },
              { $multiply: ['$value', 0.1] }
            ]
          }
        }
      },
      { $sort: { engagementScore: -1 } },
      { $limit: 50 }
    ]);

    res.status(200).json({
      success: true,
      data: {
        engagement,
        period: `${dateRange} days`,
        summary: {
          totalUsers: engagement.length,
          averageEventsPerUser: engagement.reduce((sum, user) => sum + user.events, 0) / engagement.length || 0,
          averageValuePerUser: engagement.reduce((sum, user) => sum + user.value, 0) / engagement.length || 0
        }
      }
    });
  });

  // ===============================
  // PRODUCT ANALYTICS
  // ===============================

  // Get product analytics
  getProductAnalytics = catchAsync(async (req, res) => {
    const { productId } = req.params;
    const { dateRange = 30 } = req.query;

    const product = await Product.findById(productId);
    if (!product) {
      throw new AppError('Product not found', 404, true, 'PRODUCT_NOT_FOUND');
    }

    const views = await Analytics.getAnalyticsSummary('product_view', parseInt(dateRange));
    const purchases = await Analytics.getAnalyticsSummary('product_purchase', parseInt(dateRange));
    const ratings = await Analytics.getAnalyticsSummary('product_rating', parseInt(dateRange));

    const timeSeries = await Analytics.getTimeSeries('product_view', 'day', parseInt(dateRange));
    const topReferrers = await this.getTopReferrers(productId, parseInt(dateRange));
    const conversion = await this.getConversionAnalytics(productId, parseInt(dateRange));

    res.status(200).json({
      success: true,
      data: {
        product: {
          id: product._id,
          name: product.name,
          category: product.category,
          price: product.price
        },
        metrics: {
          views: views.totalEvents,
          purchases: purchases.totalEvents,
          ratings: ratings.totalEvents,
          conversionRate: views.totalEvents > 0 ? (purchases.totalEvents / views.totalEvents) * 100 : 0,
          averageRating: ratings.averageValue || 0
        },
        timeSeries,
        referrers: topReferrers,
        conversion,
        period: `${dateRange} days`
      }
    });
  });

  // Get top referrers for product
  async getTopReferrers(productId, dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const referrers = await Analytics.aggregate([
      {
        $match: {
          product: productId,
          timestamp: { $gte: startDate },
          referrer: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: '$referrer',
          count: { $sum: 1 },
          uniqueUsers: { $addToSet: '$user' }
        }
      },
      {
        $project: {
          referrer: '$_id',
          count: 1,
          uniqueUsers: { $size: '$uniqueUsers' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    return referrers;
  },

  // Get conversion analytics
  async getConversionAnalytics(productId, dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const conversion = await Analytics.aggregate([
      {
        $match: {
          product: productId,
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          value: { $sum: '$value' }
        }
      }
    ]);

    return conversion;
  },

  // Get top products
  getTopProducts = catchAsync(async (req, res) => {
    const { metric = 'views', dateRange = 30, limit = 20 } = req.query;

    const typeMap = {
      views: 'product_view',
      purchases: 'product_purchase',
      ratings: 'product_rating',
      revenue: 'product_purchase'
    };

    const analyticsType = typeMap[metric] || 'product_view';

    const topProducts = await Analytics.getTopPerformers(analyticsType, 'product', parseInt(limit));

    // Get additional product details
    const productsWithDetails = await Promise.all(
      topProducts.map(async (item) => {
        const product = await Product.findById(item._id)
          .select('name images price category rating.average');

        return {
          product: {
            id: product._id,
            name: product.name,
            images: product.images,
            price: product.price,
            category: product.category,
            rating: product.rating.average
          },
          analytics: {
            count: item.count,
            totalValue: item.totalValue,
            rank: topProducts.indexOf(item) + 1
          }
        };
      })
    );

    res.status(200).json({
      success: true,
      data: {
        metric,
        products: productsWithDetails,
        period: `${dateRange} days`,
        totalProducts: productsWithDetails.length
      }
    });
  });

  // ===============================
  // ORDER ANALYTICS
  // ===============================

  // Get order analytics
  getOrderAnalytics = catchAsync(async (req, res) => {
    const { dateRange = 30 } = req.query;

    const orders = await Analytics.getAnalyticsSummary('order_placed', parseInt(dateRange));
    const completed = await Analytics.getAnalyticsSummary('order_completed', parseInt(dateRange));
    const cancelled = await Analytics.getAnalyticsSummary('order_cancelled', parseInt(dateRange));

    const timeSeries = await Analytics.getTimeSeries('order_placed', 'day', parseInt(dateRange));
    const statusDistribution = await this.getOrderStatusDistribution(parseInt(dateRange));
    const valueDistribution = await this.getOrderValueDistribution(parseInt(dateRange));

    res.status(200).json({
      success: true,
      data: {
        metrics: {
          totalOrders: orders.totalEvents,
          completedOrders: completed.totalEvents,
          cancelledOrders: cancelled.totalEvents,
          conversionRate: orders.totalEvents > 0 ? (completed.totalEvents / orders.totalEvents) * 100 : 0,
          averageOrderValue: completed.averageValue || 0
        },
        timeSeries,
        statusDistribution,
        valueDistribution,
        period: `${dateRange} days`
      }
    });
  });

  // Get order status distribution
  async getOrderStatusDistribution(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const distribution = await Analytics.aggregate([
      {
        $match: {
          type: { $in: ['order_placed', 'order_completed', 'order_cancelled'] },
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      }
    ]);

    return distribution;
  },

  // Get order value distribution
  async getOrderValueDistribution(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const distribution = await Analytics.aggregate([
      {
        $match: {
          type: 'order_completed',
          timestamp: { $gte: startDate },
          value: { $gt: 0 }
        }
      },
      {
        $bucket: {
          groupBy: '$value',
          boundaries: [0, 25, 50, 100, 200, 500, 1000, 5000],
          default: '5000+',
          output: {
            count: { $sum: 1 },
            average: { $avg: '$value' }
          }
        }
      }
    ]);

    return distribution;
  },

  // ===============================
  // VENDOR ANALYTICS
  // ===============================

  // Get vendor analytics
  getVendorAnalytics = catchAsync(async (req, res) => {
    const { vendorId } = req.params;
    const { dateRange = 30 } = req.query;

    const store = await Store.findById(vendorId);
    if (!store) {
      throw new AppError('Store not found', 404, true, 'STORE_NOT_FOUND');
    }

    // Check permissions
    if (req.user.role !== 'admin' && store.owner.toString() !== req.user.id) {
      throw new AppError('Not authorized to view this vendor analytics', 403, true, 'NOT_AUTHORIZED');
    }

    const sales = await Analytics.getAnalyticsSummary('vendor_sale', parseInt(dateRange));
    const orders = await this.getVendorOrders(vendorId, parseInt(dateRange));
    const products = await this.getVendorProducts(vendorId, parseInt(dateRange));
    const payouts = await Analytics.getAnalyticsSummary('vendor_payout', parseInt(dateRange));

    const timeSeries = await Analytics.getTimeSeries('vendor_sale', 'day', parseInt(dateRange));
    const topProducts = await this.getVendorTopProducts(vendorId, parseInt(dateRange));

    res.status(200).json({
      success: true,
      data: {
        store: {
          id: store._id,
          name: store.name,
          owner: store.owner
        },
        metrics: {
          totalSales: sales.totalEvents,
          totalRevenue: sales.totalValue,
          totalOrders: orders.length,
          totalProducts: products.length,
          totalPayouts: payouts.totalEvents,
          payoutAmount: payouts.totalValue
        },
        timeSeries,
        topProducts,
        period: `${dateRange} days`
      }
    });
  });

  // Get vendor orders
  async getVendorOrders(vendorId, dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const orders = await Analytics.find({
      vendor: vendorId,
      type: { $in: ['order_placed', 'order_completed'] },
      timestamp: { $gte: startDate }
    }).populate('order', 'orderNumber status');

    return orders;
  },

  // Get vendor products
  async getVendorProducts(vendorId, dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const products = await Analytics.distinct('product', {
      vendor: vendorId,
      type: { $in: ['product_view', 'product_purchase'] },
      timestamp: { $gte: startDate }
    });

    return products;
  },

  // Get vendor top products
  async getVendorTopProducts(vendorId, dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const topProducts = await Analytics.aggregate([
      {
        $match: {
          vendor: vendorId,
          type: 'product_purchase',
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$product',
          sales: { $sum: 1 },
          revenue: { $sum: '$value' }
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
      { $unwind: '$productInfo' },
      {
        $project: {
          product: {
            id: '$productInfo._id',
            name: '$productInfo.name',
            price: '$productInfo.price'
          },
          sales: 1,
          revenue: 1
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: 10 }
    ]);

    return topProducts;
  },

  // ===============================
  // SYSTEM ANALYTICS
  // ===============================

  // Get system performance analytics
  getSystemAnalytics = catchAsync(async (req, res) => {
    const { dateRange = 30 } = req.query;

    const apiCalls = await Analytics.getAnalyticsSummary('api_call', parseInt(dateRange));
    const errors = await Analytics.getAnalyticsSummary('system_error', parseInt(dateRange));
    const pageViews = await Analytics.getAnalyticsSummary('page_view', parseInt(dateRange));

    const performanceMetrics = await this.getPerformanceMetrics(parseInt(dateRange));
    const errorBreakdown = await this.getErrorBreakdown(parseInt(dateRange));
    const endpointAnalytics = await this.getEndpointAnalytics(parseInt(dateRange));

    res.status(200).json({
      success: true,
      data: {
        metrics: {
          totalApiCalls: apiCalls.totalEvents,
          totalErrors: errors.totalEvents,
          totalPageViews: pageViews.totalEvents,
          errorRate: apiCalls.totalEvents > 0 ? (errors.totalEvents / apiCalls.totalEvents) * 100 : 0,
          averageResponseTime: errors.averageValue || 0
        },
        performance: performanceMetrics,
        errors: errorBreakdown,
        endpoints: endpointAnalytics,
        period: `${dateRange} days`
      }
    });
  });

  // Get performance metrics
  async getPerformanceMetrics(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const performance = await Analytics.aggregate([
      {
        $match: {
          'data.performance': { $exists: true },
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: null,
          averagePageLoadTime: { $avg: '$data.performance.pageLoadTime' },
          averageFirstPaint: { $avg: '$data.performance.firstPaint' },
          averageLargestContentfulPaint: { $avg: '$data.performance.largestContentfulPaint' },
          averageCumulativeLayoutShift: { $avg: '$data.performance.cumulativeLayoutShift' }
        }
      }
    ]);

    return performance[0] || {};
  },

  // Get error breakdown
  async getErrorBreakdown(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const errors = await Analytics.aggregate([
      {
        $match: {
          type: 'system_error',
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$data.errorCode',
          count: { $sum: 1 },
          message: { $first: '$data.errorMessage' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]);

    return errors;
  },

  // Get endpoint analytics
  async getEndpointAnalytics(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const endpoints = await Analytics.aggregate([
      {
        $match: {
          type: 'api_call',
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$data.endpoint',
          calls: { $sum: 1 },
          averageResponseTime: { $avg: '$data.responseTime' },
          errors: {
            $sum: { $cond: [{ $gt: ['$data.errorCode', null] }, 1, 0] }
          }
        }
      },
      {
        $project: {
          endpoint: '$_id',
          calls: 1,
          averageResponseTime: 1,
          errors: 1,
          successRate: {
            $multiply: [
              { $divide: [{ $subtract: ['$calls', '$errors'] }, '$calls'] },
              100
            ]
          }
        }
      },
      { $sort: { calls: -1 } },
      { $limit: 20 }
    ]);

    return endpoints;
  },

  // ===============================
  // REAL-TIME ANALYTICS
  // ===============================

  // Get real-time analytics
  getRealTimeAnalytics = catchAsync(async (req, res) => {
    const realTimeMetrics = await Analytics.getRealTimeMetrics();
    const activeUsers = await this.getActiveUsersNow();
    const recentActivity = await this.getRecentActivity();

    res.status(200).json({
      success: true,
      data: {
        metrics: realTimeMetrics,
        activeUsers,
        recentActivity,
        timestamp: new Date()
      }
    });
  });

  // Get currently active users
  async getActiveUsersNow() {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const activeUsers = await Analytics.distinct('user', {
      timestamp: { $gte: fiveMinutesAgo },
      user: { $exists: true }
    });

    return activeUsers.length;
  },

  // Get recent activity
  async getRecentActivity() {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const recentActivity = await Analytics.find({
      timestamp: { $gte: fiveMinutesAgo }
    })
    .populate('user', 'firstName lastName avatar')
    .sort({ timestamp: -1 })
    .limit(50);

    return recentActivity;
  },

  // ===============================
  // REPORTS & EXPORT
  // ===============================

  // Generate custom report
  generateReport = catchAsync(async (req, res) => {
    const {
      type,
      dateRange = 30,
      format = 'json',
      includeCharts = false
    } = req.body;

    const reportData = await this.generateReportData(type, parseInt(dateRange));

    if (format === 'csv') {
      const csvData = this.generateReportCSV(reportData, type);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${type}-report.csv"`);
      res.status(200).send(csvData);
    } else {
      res.status(200).json({
        success: true,
        data: {
          report: reportData,
          type,
          period: `${dateRange} days`,
          generatedAt: new Date()
        }
      });
    }
  });

  // Generate report data
  async generateReportData(type, dateRange) {
    switch (type) {
      case 'user_engagement':
        return await this.generateUserEngagementReport(dateRange);
      case 'product_performance':
        return await this.generateProductPerformanceReport(dateRange);
      case 'revenue_analysis':
        return await this.generateRevenueAnalysisReport(dateRange);
      case 'system_health':
        return await this.generateSystemHealthReport(dateRange);
      default:
        throw new AppError('Invalid report type', 400, true, 'INVALID_REPORT_TYPE');
    }
  },

  // Generate user engagement report
  async generateUserEngagementReport(dateRange) {
    const engagement = await Analytics.getUserEngagement();
    const behavior = await Analytics.getConversionFunnel(dateRange);
    const geoAnalytics = await Analytics.getGeographicAnalytics(null, dateRange);
    const deviceAnalytics = await Analytics.getDeviceAnalytics(null, dateRange);

    return {
      engagement,
      behavior,
      locations: geoAnalytics,
      devices: deviceAnalytics
    };
  },

  // Generate product performance report
  async generateProductPerformanceReport(dateRange) {
    const topProducts = await this.getTopProducts({ metric: 'purchases', dateRange, limit: 50 });
    const categoryAnalytics = await this.getCategoryAnalytics(dateRange);
    const conversionRates = await this.getConversionRates(dateRange);

    return {
      topProducts: topProducts.data.products,
      categoryAnalytics,
      conversionRates
    };
  },

  // Generate revenue analysis report
  async generateRevenueAnalysisReport(dateRange) {
    const revenueMetrics = await this.getRevenueMetrics(
      new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000),
      new Date()
    );

    const dailyRevenue = await Analytics.getTimeSeries('payment_success', 'day', dateRange);
    const paymentMethods = await this.getPaymentMethodAnalytics(dateRange);

    return {
      revenueMetrics,
      dailyRevenue,
      paymentMethods
    };
  },

  // Generate system health report
  async generateSystemHealthReport(dateRange) {
    const systemMetrics = await this.getSystemMetrics(
      new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000),
      new Date()
    );

    const errorTrends = await Analytics.getTimeSeries('system_error', 'day', dateRange);
    const performanceTrends = await this.getPerformanceMetrics(dateRange);

    return {
      systemMetrics,
      errorTrends,
      performanceTrends
    };
  },

  // Generate report CSV
  generateReportCSV(reportData, type) {
    switch (type) {
      case 'user_engagement':
        return this.generateUserEngagementCSV(reportData);
      case 'product_performance':
        return this.generateProductPerformanceCSV(reportData);
      case 'revenue_analysis':
        return this.generateRevenueAnalysisCSV(reportData);
      case 'system_health':
        return this.generateSystemHealthCSV(reportData);
      default:
        return 'Type,Value\nUnknown,0';
    }
  },

  // Generate user engagement CSV
  generateUserEngagementCSV(data) {
    const headers = ['User', 'Sessions', 'Events', 'Value', 'Last Activity'];
    const rows = data.engagement.map(user => [
      user.user.name,
      user.sessions,
      user.events,
      user.value,
      user.lastActivity
    ]);

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  },

  // Generate product performance CSV
  generateProductPerformanceCSV(data) {
    const headers = ['Product', 'Sales', 'Revenue', 'Rank'];
    const rows = data.topProducts.map(product => [
      product.product.name,
      product.analytics.sales,
      product.analytics.revenue,
      product.analytics.rank
    ]);

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  },

  // Generate revenue analysis CSV
  generateRevenueAnalysisCSV(data) {
    const headers = ['Date', 'Revenue', 'Transactions'];
    const rows = data.dailyRevenue.map(day => [
      day._id,
      day.value,
      day.count
    ]);

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  },

  // Generate system health CSV
  generateSystemHealthCSV(data) {
    const headers = ['Metric', 'Value', 'Unit'];
    const rows = [
      ['Total API Calls', data.systemMetrics.totalApiCalls, 'calls'],
      ['Total Errors', data.systemMetrics.totalErrors, 'errors'],
      ['Error Rate', data.systemMetrics.errorRate, '%'],
      ['Average Response Time', data.systemMetrics.averageResponseTime, 'ms']
    ];

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  },

  // ===============================
  // CATEGORY ANALYTICS
  // ===============================

  // Get category analytics
  getCategoryAnalytics = catchAsync(async (req, res) => {
    const { categoryId } = req.params;
    const { dateRange = 30 } = req.query;

    const category = await Category.findById(categoryId);
    if (!category) {
      throw new AppError('Category not found', 404, true, 'CATEGORY_NOT_FOUND');
    }

    const views = await Analytics.getAnalyticsSummary('category_viewed', parseInt(dateRange));
    const products = await this.getCategoryProducts(categoryId, parseInt(dateRange));
    const performance = await this.getCategoryPerformance(categoryId, parseInt(dateRange));

    res.status(200).json({
      success: true,
      data: {
        category: {
          id: category._id,
          name: category.name,
          parent: category.parent
        },
        metrics: {
          totalViews: views.totalEvents,
          totalProducts: products.length,
          averagePerformance: performance.average || 0
        },
        products,
        period: `${dateRange} days`
      }
    });
  });

  // Get category products
  async getCategoryProducts(categoryId, dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const products = await Analytics.aggregate([
      {
        $match: {
          category: categoryId,
          type: 'product_view',
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$product',
          views: { $sum: 1 },
          uniqueUsers: { $addToSet: '$user' }
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
      { $unwind: '$productInfo' },
      {
        $project: {
          product: {
            id: '$productInfo._id',
            name: '$productInfo.name',
            price: '$productInfo.price'
          },
          views: 1,
          uniqueUsers: { $size: '$uniqueUsers' }
        }
      },
      { $sort: { views: -1 } }
    ]);

    return products;
  },

  // Get category performance
  async getCategoryPerformance(categoryId, dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const performance = await Analytics.aggregate([
      {
        $match: {
          category: categoryId,
          type: 'product_purchase',
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: null,
          totalSales: { $sum: 1 },
          totalRevenue: { $sum: '$value' },
          averageOrderValue: { $avg: '$value' }
        }
      }
    ]);

    return performance[0] || {};
  },

  // ===============================
  // PAYMENT ANALYTICS
  // ===============================

  // Get payment method analytics
  async getPaymentMethodAnalytics(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const paymentMethods = await Analytics.aggregate([
      {
        $match: {
          type: 'payment_success',
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$data.paymentMethod',
          transactions: { $sum: 1 },
          totalAmount: { $sum: '$value' },
          averageAmount: { $avg: '$value' }
        }
      },
      { $sort: { totalAmount: -1 } }
    ]);

    return paymentMethods;
  },

  // ===============================
  // CONVERSION ANALYTICS
  // ===============================

  // Get conversion rates
  async getConversionRates(dateRange) {
    const startDate = new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);

    const conversions = await Analytics.aggregate([
      {
        $match: {
          timestamp: { $gte: startDate },
          type: { $in: ['product_view', 'cart_abandoned', 'cart_converted', 'order_completed'] }
        }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          value: { $sum: '$value' }
        }
      }
    ]);

    const conversionMap = {};
    conversions.forEach(conv => {
      conversionMap[conv._id] = conv;
    });

    return {
      productToCart: conversionMap.product_view && conversionMap.cart_abandoned ?
        (conversionMap.cart_abandoned.count / conversionMap.product_view.count) * 100 : 0,
      cartToOrder: conversionMap.cart_converted && conversionMap.order_completed ?
        (conversionMap.order_completed.count / conversionMap.cart_converted.count) * 100 : 0,
      overall: conversionMap.product_view && conversionMap.order_completed ?
        (conversionMap.order_completed.count / conversionMap.product_view.count) * 100 : 0
    };
  },

  // ===============================
  // ADMIN ANALYTICS
  // ===============================

  // Get admin dashboard analytics
  getAdminDashboard = catchAsync(async (req, res) => {
    const { dateRange = 7 } = req.query;

    // Check admin permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to view admin analytics', 403, true, 'NOT_AUTHORIZED');
    }

    const overview = await this.getOverviewMetrics(parseInt(dateRange));
    const realTime = await this.getRealTimeAnalytics();
    const alerts = await this.getSystemAlerts();
    const topMetrics = await this.getTopMetrics(parseInt(dateRange));

    res.status(200).json({
      success: true,
      data: {
        overview,
        realTime: realTime.data,
        alerts,
        topMetrics,
        period: `${dateRange} days`,
        generatedAt: new Date()
      }
    });
  });

  // Get system alerts
  async getSystemAlerts() {
    const alerts = [];

    // Check for high error rates
    const recentErrors = await Analytics.getAnalyticsSummary('system_error', 1);
    const recentApiCalls = await Analytics.getAnalyticsSummary('api_call', 1);

    if (recentApiCalls.totalEvents > 0) {
      const errorRate = (recentErrors.totalEvents / recentApiCalls.totalEvents) * 100;
      if (errorRate > 5) {
        alerts.push({
          type: 'error',
          severity: 'high',
          message: `High error rate detected: ${errorRate.toFixed(2)}%`,
          timestamp: new Date()
        });
      }
    }

    // Check for anomalies
    const anomalies = await Analytics.find({
      isAnomaly: true,
      timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    }).limit(5);

    anomalies.forEach(anomaly => {
      alerts.push({
        type: 'anomaly',
        severity: 'medium',
        message: `Unusual activity detected: ${anomaly.type}`,
        data: anomaly,
        timestamp: anomaly.timestamp
      });
    });

    return alerts;
  },

  // Get top metrics
  async getTopMetrics(dateRange) {
    const topUsers = await Analytics.getTopPerformers('user_login', 'user', 5);
    const topProducts = await Analytics.getTopPerformers('product_purchase', 'product', 5);
    const topVendors = await Analytics.getTopPerformers('vendor_sale', 'vendor', 5);

    return {
      users: topUsers,
      products: topProducts,
      vendors: topVendors
    };
  },

  // ===============================
  // DATA EXPORT
  // ===============================

  // Export analytics data
  exportAnalytics = catchAsync(async (req, res) => {
    const { type, format = 'json', dateRange = 30 } = req.query;

    const data = await Analytics.exportAnalytics(type, format, parseInt(dateRange));

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${type}-analytics.csv"`);
      res.status(200).send(data);
    } else {
      res.status(200).json({
        success: true,
        data: {
          type,
          format,
          period: `${dateRange} days`,
          records: data.length,
          data
        }
      });
    }
  });

  // ===============================
  // ANALYTICS MAINTENANCE
  // ===============================

  // Clean up old analytics data (admin)
  cleanupAnalytics = catchAsync(async (req, res) => {
    const { daysOld = 365 } = req.query;

    // Check admin permissions
    if (req.user.role !== 'admin') {
      throw new AppError('Not authorized to cleanup analytics', 403, true, 'NOT_AUTHORIZED');
    }

    const deletedCount = await Analytics.cleanupOldData(parseInt(daysOld));

    logger.info('Analytics data cleaned up', {
      adminId: req.user.id,
      deletedCount,
      daysOld
    });

    res.status(200).json({
      success: true,
      message: 'Analytics data cleaned up successfully',
      data: {
        deletedCount
      }
    });
  });

  // Get analytics health
  getAnalyticsHealth = catchAsync(async (req, res) => {
    const totalRecords = await Analytics.countDocuments();
    const processedRecords = await Analytics.countDocuments({ isProcessed: true });
    const unprocessedRecords = await Analytics.countDocuments({ isProcessed: false });
    const anomalyCount = await Analytics.countDocuments({ isAnomaly: true });

    const recentActivity = await Analytics.find({})
      .sort({ timestamp: -1 })
      .limit(5)
      .select('type timestamp isProcessed');

    res.status(200).json({
      success: true,
      data: {
        totalRecords,
        processedRecords,
        unprocessedRecords,
        anomalyCount,
        processingRate: totalRecords > 0 ? (processedRecords / totalRecords) * 100 : 0,
        recentActivity,
        lastUpdated: new Date()
      }
    });
  });
}

module.exports = new AnalyticsController();
