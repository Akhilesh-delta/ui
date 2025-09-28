const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Category = require('../models/Category');
const Review = require('../models/Review');
const Cart = require('../models/Cart');
const { authenticate, requireAdmin, requireVendorOrAdmin, sanitizeInput } = require('../middleware/authMiddleware');

// @desc    Get comprehensive analytics dashboard
// @route   GET /api/analytics/dashboard
// @access  Private (Admin/Vendor)
const getAnalyticsDashboard = async (req, res) => {
  try {
    const userId = req.user.role === 'admin' ? null : req.user._id;
    const { period = '30d', startDate, endDate } = req.query;

    // Calculate date range
    const daysBack = parseInt(period.replace('d', ''));
    const start = startDate ? new Date(startDate) : new Date(Date.now() - (daysBack * 24 * 60 * 60 * 1000));
    const end = endDate ? new Date(endDate) : new Date();

    // Get comprehensive analytics
    const [
      overviewMetrics,
      revenueAnalytics,
      userAnalytics,
      productAnalytics,
      orderAnalytics,
      conversionAnalytics,
      geographicAnalytics,
      deviceAnalytics
    ] = await Promise.all([
      getOverviewMetrics(start, end, userId),
      getRevenueAnalytics(start, end, userId),
      getUserAnalytics(start, end, userId),
      getProductAnalytics(start, end, userId),
      getOrderAnalytics(start, end, userId),
      getConversionAnalytics(start, end, userId),
      getGeographicAnalytics(start, end, userId),
      getDeviceAnalytics(start, end, userId)
    ]);

    res.json({
      success: true,
      data: {
        period: { start, end },
        overview: overviewMetrics,
        revenue: revenueAnalytics,
        users: userAnalytics,
        products: productAnalytics,
        orders: orderAnalytics,
        conversion: conversionAnalytics,
        geography: geographicAnalytics,
        devices: deviceAnalytics
      }
    });

  } catch (error) {
    console.error('Get analytics dashboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics dashboard'
    });
  }
};

// @desc    Get revenue analytics
// @route   GET /api/analytics/revenue
// @access  Private (Admin/Vendor)
const getRevenueAnalytics = async (req, res) => {
  try {
    const userId = req.user.role === 'admin' ? null : req.user._id;
    const { period = '30d', groupBy = 'day', startDate, endDate } = req.query;

    const daysBack = parseInt(period.replace('d', ''));
    const start = startDate ? new Date(startDate) : new Date(Date.now() - (daysBack * 24 * 60 * 60 * 1000));
    const end = endDate ? new Date(endDate) : new Date();

    const analytics = await getRevenueAnalyticsData(start, end, groupBy, userId);

    res.json({
      success: true,
      data: {
        period: { start, end },
        groupBy,
        analytics
      }
    });

  } catch (error) {
    console.error('Get revenue analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch revenue analytics'
    });
  }
};

// @desc    Get user analytics
// @route   GET /api/analytics/users
// @access  Private (Admin/Vendor)
const getUserAnalytics = async (req, res) => {
  try {
    const userId = req.user.role === 'admin' ? null : req.user._id;
    const { period = '30d', startDate, endDate } = req.query;

    const daysBack = parseInt(period.replace('d', ''));
    const start = startDate ? new Date(startDate) : new Date(Date.now() - (daysBack * 24 * 60 * 60 * 1000));
    const end = endDate ? new Date(endDate) : new Date();

    const analytics = await getUserAnalyticsData(start, end, userId);

    res.json({
      success: true,
      data: {
        period: { start, end },
        analytics
      }
    });

  } catch (error) {
    console.error('Get user analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user analytics'
    });
  }
};

// @desc    Get product analytics
// @route   GET /api/analytics/products
// @access  Private (Admin/Vendor)
const getProductAnalytics = async (req, res) => {
  try {
    const userId = req.user.role === 'admin' ? null : req.user._id;
    const { period = '30d', startDate, endDate } = req.query;

    const daysBack = parseInt(period.replace('d', ''));
    const start = startDate ? new Date(startDate) : new Date(Date.now() - (daysBack * 24 * 60 * 60 * 1000));
    const end = endDate ? new Date(endDate) : new Date();

    const analytics = await getProductAnalyticsData(start, end, userId);

    res.json({
      success: true,
      data: {
        period: { start, end },
        analytics
      }
    });

  } catch (error) {
    console.error('Get product analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch product analytics'
    });
  }
};

// @desc    Get order analytics
// @route   GET /api/analytics/orders
// @access  Private (Admin/Vendor)
const getOrderAnalytics = async (req, res) => {
  try {
    const userId = req.user.role === 'admin' ? null : req.user._id;
    const { period = '30d', startDate, endDate } = req.query;

    const daysBack = parseInt(period.replace('d', ''));
    const start = startDate ? new Date(startDate) : new Date(Date.now() - (daysBack * 24 * 60 * 60 * 1000));
    const end = endDate ? new Date(endDate) : new Date();

    const analytics = await getOrderAnalyticsData(start, end, userId);

    res.json({
      success: true,
      data: {
        period: { start, end },
        analytics
      }
    });

  } catch (error) {
    console.error('Get order analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch order analytics'
    });
  }
};

// @desc    Get conversion analytics
// @route   GET /api/analytics/conversion
// @access  Private (Admin/Vendor)
const getConversionAnalytics = async (req, res) => {
  try {
    const userId = req.user.role === 'admin' ? null : req.user._id;
    const { period = '30d', startDate, endDate } = req.query;

    const daysBack = parseInt(period.replace('d', ''));
    const start = startDate ? new Date(startDate) : new Date(Date.now() - (daysBack * 24 * 60 * 60 * 1000));
    const end = endDate ? new Date(endDate) : new Date();

    const analytics = await getConversionAnalyticsData(start, end, userId);

    res.json({
      success: true,
      data: {
        period: { start, end },
        analytics
      }
    });

  } catch (error) {
    console.error('Get conversion analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch conversion analytics'
    });
  }
};

// @desc    Get real-time analytics
// @route   GET /api/analytics/realtime
// @access  Private (Admin)
const getRealtimeAnalytics = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin access required.'
      });
    }

    const realtimeData = await getRealtimeData();

    res.json({
      success: true,
      data: {
        timestamp: new Date(),
        realtime: realtimeData
      }
    });

  } catch (error) {
    console.error('Get realtime analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch realtime analytics'
    });
  }
};

// @desc    Get predictive analytics
// @route   GET /api/analytics/predictive
// @access  Private (Admin)
const getPredictiveAnalytics = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin access required.'
      });
    }

    const { period = '30d' } = req.query;

    const predictions = await getPredictiveData(period);

    res.json({
      success: true,
      data: {
        period,
        predictions
      }
    });

  } catch (error) {
    console.error('Get predictive analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch predictive analytics'
    });
  }
};

// @desc    Get cohort analysis
// @route   GET /api/analytics/cohorts
// @access  Private (Admin)
const getCohortAnalysis = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin access required.'
      });
    }

    const { cohortType = 'user_registration', period = 'monthly' } = req.query;

    const cohorts = await getCohortData(cohortType, period);

    res.json({
      success: true,
      data: {
        cohortType,
        period,
        cohorts
      }
    });

  } catch (error) {
    console.error('Get cohort analysis error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cohort analysis'
    });
  }
};

// @desc    Get A/B test analytics
// @route   GET /api/analytics/ab-tests
// @access  Private (Admin)
const getABTestAnalytics = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin access required.'
      });
    }

    const { testId } = req.query;

    const abTests = await getABTestData(testId);

    res.json({
      success: true,
      data: {
        abTests
      }
    });

  } catch (error) {
    console.error('Get A/B test analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch A/B test analytics'
    });
  }
};

// @desc    Get custom report
// @route   POST /api/analytics/reports
// @access  Private (Admin)
const getCustomReport = async (req, res) => {
  try {
    const { reportType, metrics, filters, groupBy, period } = req.body;

    if (req.user.role !== 'admin' && req.user.role !== 'vendor') {
      return res.status(403).json({
        success: false,
        error: 'Access denied.'
      });
    }

    const report = await generateCustomReport(reportType, metrics, filters, groupBy, period);

    res.json({
      success: true,
      data: {
        report
      }
    });

  } catch (error) {
    console.error('Get custom report error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate custom report'
    });
  }
};

// @desc    Export analytics data
// @route   GET /api/analytics/export
// @access  Private (Admin/Vendor)
const exportAnalyticsData = async (req, res) => {
  try {
    const { dataType, format = 'csv', startDate, endDate, period = '30d' } = req.query;

    const daysBack = parseInt(period.replace('d', ''));
    const start = startDate ? new Date(startDate) : new Date(Date.now() - (daysBack * 24 * 60 * 60 * 1000));
    const end = endDate ? new Date(endDate) : new Date();

    let exportData;

    switch (dataType) {
      case 'revenue':
        exportData = await getRevenueAnalyticsData(start, end, 'day');
        break;
      case 'users':
        exportData = await getUserAnalyticsData(start, end);
        break;
      case 'products':
        exportData = await getProductAnalyticsData(start, end);
        break;
      case 'orders':
        exportData = await getOrderAnalyticsData(start, end);
        break;
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid data type for export'
        });
    }

    if (format === 'csv') {
      const csvData = convertToCSV(exportData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${dataType}-analytics-${new Date().toISOString().split('T')[0]}.csv"`);
      return res.send(csvData);
    }

    res.json({
      success: true,
      data: {
        exportData,
        format,
        recordCount: exportData.length
      }
    });

  } catch (error) {
    console.error('Export analytics data error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export analytics data'
    });
  }
};

// Helper functions
const getOverviewMetrics = async (start, end, userId = null) => {
  try {
    const matchStage = {
      createdAt: { $gte: start, $lte: end }
    };

    if (userId) {
      // Vendor-specific metrics
      const [
        revenue,
        orders,
        products,
        customers
      ] = await Promise.all([
        Order.aggregate([
          { $match: { vendor: userId, 'payment.status': 'completed', ...matchStage } },
          { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } }
        ]),
        Order.countDocuments({ vendor: userId, ...matchStage }),
        Product.countDocuments({ vendor: userId, status: 'active' }),
        Order.distinct('user', { vendor: userId, ...matchStage })
      ]);

      return {
        revenue: revenue[0]?.total || 0,
        orders: orders,
        products: products,
        customers: customers.length,
        averageOrderValue: revenue[0]?.count > 0 ? revenue[0].total / revenue[0].count : 0
      };
    } else {
      // Admin metrics
      const [
        totalRevenue,
        totalOrders,
        totalUsers,
        totalProducts,
        activeUsers
      ] = await Promise.all([
        Order.aggregate([
          { $match: { 'payment.status': 'completed', ...matchStage } },
          { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]),
        Order.countDocuments(matchStage),
        User.countDocuments({ role: 'user' }),
        Product.countDocuments({ status: 'active' }),
        User.countDocuments({ status: 'active', lastLogin: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } })
      ]);

      return {
        revenue: totalRevenue[0]?.total || 0,
        orders: totalOrders,
        users: totalUsers,
        products: totalProducts,
        activeUsers: activeUsers,
        conversionRate: totalOrders > 0 ? ((totalOrders / totalUsers) * 100) : 0
      };
    }
  } catch (error) {
    console.error('Get overview metrics error:', error);
    return {};
  }
};

const getRevenueAnalyticsData = async (start, end, groupBy, userId = null) => {
  try {
    const groupStage = {};

    switch (groupBy) {
      case 'hour':
        groupStage._id = {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' },
          hour: { $hour: '$createdAt' }
        };
        break;
      case 'day':
        groupStage._id = {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' }
        };
        break;
      case 'week':
        groupStage._id = {
          year: { $year: '$createdAt' },
          week: { $week: '$createdAt' }
        };
        break;
      case 'month':
        groupStage._id = {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        };
        break;
    }

    const matchStage = {
      'payment.status': 'completed',
      createdAt: { $gte: start, $lte: end }
    };

    if (userId) {
      matchStage.vendor = userId;
    }

    const revenueData = await Order.aggregate([
      { $match: matchStage },
      {
        $group: {
          ...groupStage,
          revenue: { $sum: '$totalAmount' },
          orders: { $sum: 1 },
          averageOrderValue: { $avg: '$totalAmount' }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    // Calculate trends
    const totalRevenue = revenueData.reduce((sum, item) => sum + item.revenue, 0);
    const totalOrders = revenueData.reduce((sum, item) => sum + item.orders, 0);

    let trend = 0;
    if (revenueData.length >= 2) {
      const firstHalf = revenueData.slice(0, Math.floor(revenueData.length / 2));
      const secondHalf = revenueData.slice(Math.floor(revenueData.length / 2));

      const firstHalfAvg = firstHalf.reduce((sum, item) => sum + item.revenue, 0) / firstHalf.length;
      const secondHalfAvg = secondHalf.reduce((sum, item) => sum + item.revenue, 0) / secondHalf.length;

      trend = ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100;
    }

    return {
      data: revenueData,
      summary: {
        totalRevenue,
        totalOrders,
        averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
        trend: Math.round(trend * 100) / 100
      }
    };
  } catch (error) {
    console.error('Get revenue analytics data error:', error);
    return { data: [], summary: {} };
  }
};

const getUserAnalyticsData = async (start, end, userId = null) => {
  try {
    const matchStage = {
      createdAt: { $gte: start, $lte: end }
    };

    if (userId) {
      matchStage._id = userId;
    }

    const userData = await User.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: {
            role: '$role',
            status: '$status'
          },
          count: { $sum: 1 },
          verified: { $sum: { $cond: ['$emailVerified', 1, 0] } }
        }
      }
    ]);

    // Get user behavior data
    const behaviorData = await getUserBehaviorData(start, end, userId);

    return {
      registration: userData,
      behavior: behaviorData,
      summary: {
        totalUsers: userData.reduce((sum, item) => sum + item.count, 0),
        verifiedUsers: userData.reduce((sum, item) => sum + item.verified, 0),
        activeUsers: await User.countDocuments({
          status: 'active',
          lastLogin: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        })
      }
    };
  } catch (error) {
    console.error('Get user analytics data error:', error);
    return { registration: [], behavior: {}, summary: {} };
  }
};

const getProductAnalyticsData = async (start, end, userId = null) => {
  try {
    const matchStage = {
      createdAt: { $gte: start, $lte: end }
    };

    if (userId) {
      matchStage.vendor = userId;
    }

    const productData = await Product.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalViews: { $sum: '$statistics.views' },
          totalRevenue: { $sum: '$analytics.revenue' }
        }
      }
    ]);

    // Get top performing products
    const topProducts = await Product.find(userId ? { vendor: userId } : {})
      .sort({ 'statistics.views': -1 })
      .limit(10)
      .select('name price rating statistics.views analytics.revenue');

    return {
      status: productData,
      topProducts,
      summary: {
        totalProducts: await Product.countDocuments(userId ? { vendor: userId } : {}),
        totalViews: productData.reduce((sum, item) => sum + item.totalViews, 0),
        totalRevenue: productData.reduce((sum, item) => sum + item.totalRevenue, 0)
      }
    };
  } catch (error) {
    console.error('Get product analytics data error:', error);
    return { status: [], topProducts: [], summary: {} };
  }
};

const getOrderAnalyticsData = async (start, end, userId = null) => {
  try {
    const matchStage = {
      createdAt: { $gte: start, $lte: end }
    };

    if (userId) {
      matchStage.vendor = userId;
    }

    const orderData = await Order.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' }
        }
      }
    ]);

    // Get order trends
    const dailyOrders = await Order.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          count: { $sum: 1 },
          revenue: { $sum: '$totalAmount' }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    return {
      status: orderData,
      daily: dailyOrders,
      summary: {
        totalOrders: orderData.reduce((sum, item) => sum + item.count, 0),
        totalRevenue: orderData.reduce((sum, item) => sum + item.totalAmount, 0)
      }
    };
  } catch (error) {
    console.error('Get order analytics data error:', error);
    return { status: [], daily: [], summary: {} };
  }
};

const getConversionAnalyticsData = async (start, end, userId = null) => {
  try {
    // Get cart to order conversion
    const cartData = await Cart.find({
      'metadata.lastActivity': { $gte: start, $lte: end }
    });

    const orderData = await Order.find({
      createdAt: { $gte: start, $lte: end }
    });

    // Calculate conversion rates
    const conversionRates = {
      cartToOrder: cartData.length > 0 ? (orderData.length / cartData.length) * 100 : 0,
      visitorToCart: 0, // Would need visitor tracking
      cartToCheckout: 0, // Would need checkout tracking
      overall: 0
    };

    // Get abandonment analysis
    const abandonedCarts = await Cart.getAbandonedCarts(7);
    const abandonmentRate = cartData.length > 0 ? (abandonedCarts.length / cartData.length) * 100 : 0;

    return {
      conversionRates,
      abandonment: {
        rate: abandonmentRate,
        count: abandonedCarts.length
      },
      funnels: [
        { stage: 'Visitors', count: 0 }, // Would need visitor tracking
        { stage: 'Cart Views', count: cartData.length },
        { stage: 'Checkout', count: 0 }, // Would need checkout tracking
        { stage: 'Orders', count: orderData.length }
      ]
    };
  } catch (error) {
    console.error('Get conversion analytics data error:', error);
    return { conversionRates: {}, abandonment: {}, funnels: [] };
  }
};

const getGeographicAnalytics = async (start, end, userId = null) => {
  try {
    const matchStage = {
      createdAt: { $gte: start, $lte: end }
    };

    if (userId) {
      matchStage.vendor = userId;
    }

    const geoData = await Order.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$shippingAddress.country',
          orders: { $sum: 1 },
          revenue: { $sum: '$totalAmount' },
          customers: { $addToSet: '$user' }
        }
      },
      {
        $project: {
          country: '$_id',
          orders: 1,
          revenue: 1,
          customers: { $size: '$customers' }
        }
      },
      { $sort: { revenue: -1 } }
    ]);

    return {
      byCountry: geoData,
      summary: {
        totalCountries: geoData.length,
        topCountry: geoData[0] || {}
      }
    };
  } catch (error) {
    console.error('Get geographic analytics error:', error);
    return { byCountry: [], summary: {} };
  }
};

const getDeviceAnalytics = async (start, end, userId = null) => {
  try {
    // This would typically come from user agent analysis
    // For now, return mock data
    const deviceData = [
      { device: 'Desktop', users: 450, percentage: 45 },
      { device: 'Mobile', users: 380, percentage: 38 },
      { device: 'Tablet', users: 170, percentage: 17 }
    ];

    const browserData = [
      { browser: 'Chrome', users: 520, percentage: 52 },
      { browser: 'Firefox', users: 180, percentage: 18 },
      { browser: 'Safari', users: 150, percentage: 15 },
      { browser: 'Edge', users: 120, percentage: 12 },
      { browser: 'Other', users: 30, percentage: 3 }
    ];

    return {
      devices: deviceData,
      browsers: browserData
    };
  } catch (error) {
    console.error('Get device analytics error:', error);
    return { devices: [], browsers: [] };
  }
};

const getRealtimeData = async () => {
  try {
    const now = new Date();
    const lastHour = new Date(now.getTime() - 60 * 60 * 1000);

    const [
      activeUsers,
      recentOrders,
      revenueLastHour
    ] = await Promise.all([
      User.countDocuments({
        lastActive: { $gte: lastHour }
      }),
      Order.countDocuments({
        createdAt: { $gte: lastHour }
      }),
      Order.aggregate([
        {
          $match: {
            'payment.status': 'completed',
            createdAt: { $gte: lastHour }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$totalAmount' }
          }
        }
      ])
    ]);

    return {
      activeUsers,
      recentOrders,
      revenueLastHour: revenueLastHour[0]?.total || 0,
      timestamp: now
    };
  } catch (error) {
    console.error('Get realtime data error:', error);
    return {};
  }
};

const getPredictiveData = async (period) => {
  try {
    const daysBack = parseInt(period.replace('d', ''));
    const historicalData = await Order.find({
      createdAt: { $gte: new Date(Date.now() - (daysBack * 2 * 24 * 60 * 60 * 1000)) }
    });

    // Simple trend analysis
    const firstHalf = historicalData.slice(0, Math.floor(historicalData.length / 2));
    const secondHalf = historicalData.slice(Math.floor(historicalData.length / 2));

    const firstHalfAvg = firstHalf.reduce((sum, order) => sum + order.totalAmount, 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((sum, order) => sum + order.totalAmount, 0) / secondHalf.length;

    const trend = ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100;

    return {
      revenueForecast: {
        trend: Math.round(trend * 100) / 100,
        confidence: 75, // Mock confidence score
        nextPeriodPrediction: secondHalfAvg * 1.1 // 10% growth prediction
      },
      demandForecast: {
        topProducts: [], // Would be based on historical demand patterns
        seasonalTrends: []
      }
    };
  } catch (error) {
    console.error('Get predictive data error:', error);
    return {};
  }
};

const getCohortData = async (cohortType, period) => {
  try {
    // This would implement cohort analysis
    // For now, return mock data
    const cohorts = [
      {
        cohort: '2024-01',
        size: 1000,
        retention: {
          month1: 85,
          month2: 72,
          month3: 65,
          month6: 45,
          month12: 28
        }
      },
      {
        cohort: '2024-02',
        size: 1200,
        retention: {
          month1: 88,
          month2: 75,
          month3: 68
        }
      }
    ];

    return cohorts;
  } catch (error) {
    console.error('Get cohort data error:', error);
    return [];
  }
};

const getABTestData = async (testId) => {
  try {
    // This would get A/B test results
    // For now, return mock data
    const abTests = [
      {
        id: 'test1',
        name: 'Homepage CTA Button Color',
        status: 'running',
        variants: [
          { name: 'Red Button', visitors: 15420, conversions: 890, conversionRate: 5.77 },
          { name: 'Blue Button', visitors: 15230, conversions: 950, conversionRate: 6.24 }
        ],
        winner: 'Blue Button',
        confidence: 95,
        improvement: 8.2
      }
    ];

    return testId ? abTests.find(test => test.id === testId) : abTests;
  } catch (error) {
    console.error('Get A/B test data error:', error);
    return testId ? null : [];
  }
};

const getUserBehaviorData = async (start, end, userId = null) => {
  try {
    // This would analyze user behavior patterns
    // For now, return mock data
    return {
      sessionDuration: {
        average: 245, // seconds
        median: 180
      },
      pageViews: {
        average: 8.5,
        topPages: [
          { page: '/products', views: 15420 },
          { page: '/categories', views: 12300 },
          { page: '/search', views: 8900 }
        ]
      },
      bounceRate: 35.5,
      returnVisitors: 68.2
    };
  } catch (error) {
    console.error('Get user behavior data error:', error);
    return {};
  }
};

const generateCustomReport = async (reportType, metrics, filters, groupBy, period) => {
  try {
    // This would generate custom reports based on parameters
    // For now, return mock data
    return {
      type: reportType,
      period,
      metrics,
      filters,
      groupBy,
      generatedAt: new Date(),
      data: []
    };
  } catch (error) {
    console.error('Generate custom report error:', error);
    return {};
  }
};

const convertToCSV = (data) => {
  try {
    if (!data || data.length === 0) return '';

    const headers = Object.keys(data[0]);
    const csvRows = [
      headers.join(','),
      ...data.map(row =>
        headers.map(header => {
          const value = row[header];
          return typeof value === 'string' && value.includes(',') ? `"${value}"` : value;
        }).join(',')
      )
    ];

    return csvRows.join('\n');
  } catch (error) {
    console.error('Convert to CSV error:', error);
    return '';
  }
};

module.exports = {
  getAnalyticsDashboard,
  getRevenueAnalytics,
  getUserAnalytics,
  getProductAnalytics,
  getOrderAnalytics,
  getConversionAnalytics,
  getRealtimeAnalytics,
  getPredictiveAnalytics,
  getCohortAnalysis,
  getABTestAnalytics,
  getCustomReport,
  exportAnalyticsData
};
