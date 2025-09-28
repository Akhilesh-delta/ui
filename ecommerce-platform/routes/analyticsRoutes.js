const express = require('express');
const router = express.Router();

// Import controller
const {
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
} = require('../controllers/analyticsController');

// Import middleware
const { authenticate, requireAdmin, requireVendorOrAdmin } = require('../middleware/authMiddleware');

// Dashboard route
router.get('/dashboard', authenticate, getAnalyticsDashboard);

// Specific analytics routes
router.get('/revenue', authenticate, getRevenueAnalytics);
router.get('/users', authenticate, getUserAnalytics);
router.get('/products', authenticate, getProductAnalytics);
router.get('/orders', authenticate, getOrderAnalytics);
router.get('/conversion', authenticate, getConversionAnalytics);

// Advanced analytics (Admin only)
router.get('/realtime', requireAdmin, getRealtimeAnalytics);
router.get('/predictive', requireAdmin, getPredictiveAnalytics);
router.get('/cohorts', requireAdmin, getCohortAnalysis);
router.get('/ab-tests', requireAdmin, getABTestAnalytics);

// Custom reports
router.post('/reports', authenticate, getCustomReport);

// Export functionality
router.get('/export', authenticate, exportAnalyticsData);

module.exports = router;
