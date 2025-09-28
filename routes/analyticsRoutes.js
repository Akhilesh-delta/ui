const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { authenticate, authorize } = require('../middleware/auth');
const { body, param, query } = require('express-validator');

// ================================
// DASHBOARD ANALYTICS
// ================================

// Get dashboard overview
router.get('/dashboard', authenticate, [
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days'),
  query('compareWithPrevious').optional().isIn(['true', 'false']).withMessage('compareWithPrevious must be true or false')
], analyticsController.getDashboardOverview);

// ================================
// USER ANALYTICS
// ================================

// Get user analytics
router.get('/users/:userId', authenticate, [
  param('userId').isMongoId().withMessage('Valid user ID is required'),
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], analyticsController.getUserAnalytics);

// Get user engagement analytics
router.get('/users/engagement', authenticate, authorize(['admin']), [
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], analyticsController.getUserEngagement);

// ================================
// PRODUCT ANALYTICS
// ================================

// Get product analytics
router.get('/products/:productId', authenticate, [
  param('productId').isMongoId().withMessage('Valid product ID is required'),
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], analyticsController.getProductAnalytics);

// Get top products
router.get('/products/top', authenticate, authorize(['admin']), [
  query('metric').optional().isIn(['views', 'purchases', 'ratings', 'revenue']).withMessage('Invalid metric'),
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], analyticsController.getTopProducts);

// ================================
// ORDER ANALYTICS
// ================================

// Get order analytics
router.get('/orders', authenticate, authorize(['admin']), [
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], analyticsController.getOrderAnalytics);

// ================================
// VENDOR ANALYTICS
// ================================

// Get vendor analytics
router.get('/vendors/:vendorId', authenticate, [
  param('vendorId').isMongoId().withMessage('Valid vendor ID is required'),
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], analyticsController.getVendorAnalytics);

// ================================
// SYSTEM ANALYTICS
// ================================

// Get system performance analytics
router.get('/system', authenticate, authorize(['admin']), [
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], analyticsController.getSystemAnalytics);

// ================================
// REAL-TIME ANALYTICS
// ================================

// Get real-time analytics
router.get('/realtime', authenticate, authorize(['admin']), analyticsController.getRealTimeAnalytics);

// ================================
// REPORTS & EXPORT
// ================================

// Generate custom report
router.post('/reports', authenticate, authorize(['admin']), [
  body('type').isIn(['user_engagement', 'product_performance', 'revenue_analysis', 'system_health']).withMessage('Invalid report type'),
  body('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days'),
  body('format').optional().isIn(['json', 'csv']).withMessage('Format must be json or csv'),
  body('includeCharts').optional().isBoolean().withMessage('includeCharts must be a boolean')
], analyticsController.generateReport);

// Export analytics data
router.get('/export', authenticate, authorize(['admin']), [
  query('type').notEmpty().withMessage('Analytics type is required'),
  query('format').optional().isIn(['json', 'csv']).withMessage('Format must be json or csv'),
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], analyticsController.exportAnalytics);

// ================================
// CATEGORY ANALYTICS
// ================================

// Get category analytics
router.get('/categories/:categoryId', authenticate, [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], analyticsController.getCategoryAnalytics);

// ================================
// ADMIN ANALYTICS
// ================================

// Get admin dashboard analytics
router.get('/admin/dashboard', authenticate, authorize(['admin']), [
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], analyticsController.getAdminDashboard);

// ================================
// ANALYTICS MAINTENANCE
// ================================

// Clean up old analytics data (admin)
router.post('/admin/cleanup', authenticate, authorize(['admin']), [
  query('daysOld').optional().isInt({ min: 1, max: 3650 }).withMessage('Days old must be between 1 and 3650')
], analyticsController.cleanupAnalytics);

// Get analytics health
router.get('/health', authenticate, authorize(['admin']), analyticsController.getAnalyticsHealth);

module.exports = router;
