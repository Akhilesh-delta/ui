const express = require('express');
const router = express.Router();
const storeController = require('../controllers/storeController');
const { authenticate, authorize } = require('../middleware/auth');
const { body, param, query } = require('express-validator');
const upload = require('../middleware/upload');

// ================================
// STORE MANAGEMENT
// ================================

// Create new store
router.post('/', authenticate, authorize(['vendor', 'admin']), upload.single('logo'), [
  body('name').trim().isLength({ min: 3, max: 100 }).withMessage('Store name must be between 3 and 100 characters'),
  body('description').trim().isLength({ min: 10, max: 1000 }).withMessage('Description must be between 10 and 1000 characters'),
  body('businessType').isIn(['individual', 'business', 'nonprofit']).withMessage('Invalid business type'),
  body('contact.email').isEmail().withMessage('Valid email is required'),
  body('address.country').notEmpty().withMessage('Country is required')
], storeController.createStore);

// Get store details
router.get('/:id', [
  param('id').isMongoId().withMessage('Valid store ID is required'),
  query('includeProducts').optional().isIn(['true', 'false']).withMessage('includeProducts must be true or false'),
  query('includeReviews').optional().isIn(['true', 'false']).withMessage('includeReviews must be true or false'),
  query('includeAnalytics').optional().isIn(['true', 'false']).withMessage('includeAnalytics must be true or false')
], storeController.getStore);

// Get store by slug
router.get('/slug/:slug', [
  param('slug').isSlug().withMessage('Valid slug is required')
], storeController.getStoreBySlug);

// Update store
router.put('/:id', authenticate, authorize(['vendor', 'admin']), upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'banner', maxCount: 1 }
]), [
  param('id').isMongoId().withMessage('Valid store ID is required'),
  body('name').optional().trim().isLength({ min: 3, max: 100 }).withMessage('Store name must be between 3 and 100 characters'),
  body('description').optional().trim().isLength({ min: 10, max: 1000 }).withMessage('Description must be between 10 and 1000 characters')
], storeController.updateStore);

// Delete store
router.delete('/:id', authenticate, authorize(['vendor', 'admin']), [
  param('id').isMongoId().withMessage('Valid store ID is required')
], storeController.deleteStore);

// ================================
// STORE SETTINGS MANAGEMENT
// ================================

// Get store settings
router.get('/:storeId/settings', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required')
], storeController.getStoreSettings);

// Update store settings
router.put('/:storeId/settings', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  body('settings.currency').optional().isIn(['USD', 'EUR', 'GBP', 'CAD', 'AUD']).withMessage('Invalid currency'),
  body('settings.language').optional().isIn(['en', 'es', 'fr', 'de', 'it']).withMessage('Invalid language')
], storeController.updateStoreSettings);

// Update store branding
router.put('/:storeId/branding', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  body('primaryColor').optional().matches(/^#[0-9A-F]{6}$/i).withMessage('Invalid color format'),
  body('theme').optional().isIn(['modern', 'classic', 'minimal', 'bold']).withMessage('Invalid theme')
], storeController.updateStoreBranding);

// ================================
// VENDOR DASHBOARD
// ================================

// Get vendor dashboard
router.get('/vendor/dashboard', authenticate, authorize(['vendor']), storeController.getVendorDashboard);

// Get vendor analytics
router.get('/:storeId/analytics', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days'),
  query('type').optional().isIn(['overview', 'sales', 'products', 'customers', 'traffic']).withMessage('Invalid analytics type')
], storeController.getVendorAnalytics);

// ================================
// STORE PRODUCT MANAGEMENT
// ================================

// Get store products
router.get('/:storeId/products', [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  query('status').optional().isIn(['all', 'draft', 'published', 'archived']).withMessage('Invalid status'),
  query('category').optional().isMongoId().withMessage('Valid category ID is required'),
  query('search').optional().isLength({ min: 2 }).withMessage('Search term must be at least 2 characters'),
  query('sortBy').optional().isIn(['createdAt', 'name', 'price', 'stock', 'sales', 'updated']).withMessage('Invalid sort field'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], storeController.getStoreProducts);

// Add product to store
router.post('/:storeId/products/:productId', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  param('productId').isMongoId().withMessage('Valid product ID is required')
], storeController.addProductToStore);

// Remove product from store
router.delete('/:storeId/products/:productId', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  param('productId').isMongoId().withMessage('Valid product ID is required')
], storeController.removeProductFromStore);

// ================================
// STORE ORDER MANAGEMENT
// ================================

// Get store orders
router.get('/:storeId/orders', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  query('status').optional().isIn(['pending', 'processing', 'ready', 'shipped', 'delivered', 'cancelled']).withMessage('Invalid status'),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format'),
  query('sortBy').optional().isIn(['orderedAt', 'totalAmount', 'status']).withMessage('Invalid sort field'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], storeController.getStoreOrders);

// Update order status (vendor)
router.put('/orders/:orderId/status', authenticate, authorize(['vendor', 'admin']), [
  param('orderId').isMongoId().withMessage('Valid order ID is required'),
  body('status').isIn(['pending', 'processing', 'ready', 'shipped', 'delivered', 'cancelled']).withMessage('Invalid status'),
  body('notes').optional().isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters'),
  body('trackingNumber').optional().isLength({ max: 100 }).withMessage('Tracking number cannot exceed 100 characters'),
  body('trackingUrl').optional().isURL().withMessage('Invalid tracking URL'),
  body('carrier').optional().isLength({ max: 50 }).withMessage('Carrier name cannot exceed 50 characters')
], storeController.updateOrderStatus);

// ================================
// STORE FINANCIAL MANAGEMENT
// ================================

// Get store earnings
router.get('/:storeId/earnings', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], storeController.getStoreEarnings);

// Request payout
router.post('/:storeId/payout', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  body('amount').isFloat({ min: 1 }).withMessage('Payout amount must be at least 1')
], storeController.requestPayout);

// Get payout history
router.get('/:storeId/payout/history', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], storeController.getPayoutHistory);

// ================================
// STORE CATEGORIES MANAGEMENT
// ================================

// Get store categories
router.get('/:storeId/categories', [
  param('storeId').isMongoId().withMessage('Valid store ID is required')
], storeController.getStoreCategories);

// Add category to store
router.post('/:storeId/categories', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  body('categoryId').isMongoId().withMessage('Valid category ID is required'),
  body('isPrimary').optional().isIn(['true', 'false']).withMessage('isPrimary must be true or false'),
  body('commissionRate').optional().isFloat({ min: 0, max: 50 }).withMessage('Commission rate must be between 0 and 50')
], storeController.addStoreCategory);

// Update store category
router.put('/:storeId/categories/:categoryId', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  body('isPrimary').optional().isIn(['true', 'false']).withMessage('isPrimary must be true or false'),
  body('commissionRate').optional().isFloat({ min: 0, max: 50 }).withMessage('Commission rate must be between 0 and 50')
], storeController.updateStoreCategory);

// Remove category from store
router.delete('/:storeId/categories/:categoryId', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  param('categoryId').isMongoId().withMessage('Valid category ID is required')
], storeController.removeStoreCategory);

// ================================
// STORE PROMOTIONS
// ================================

// Get store promotions
router.get('/:storeId/promotions', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required')
], storeController.getStorePromotions);

// Create store promotion
router.post('/:storeId/promotions', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  body('title').trim().isLength({ min: 3, max: 100 }).withMessage('Title must be between 3 and 100 characters'),
  body('description').trim().isLength({ min: 10, max: 500 }).withMessage('Description must be between 10 and 500 characters'),
  body('type').isIn(['percentage', 'fixed', 'buy_x_get_y', 'free_shipping']).withMessage('Invalid promotion type'),
  body('discount.percentage').optional().isFloat({ min: 0, max: 100 }).withMessage('Discount percentage must be between 0 and 100'),
  body('discount.fixedAmount').optional().isFloat({ min: 0 }).withMessage('Fixed amount must be positive'),
  body('startDate').isISO8601().withMessage('Invalid start date format'),
  body('endDate').isISO8601().withMessage('Invalid end date format')
], storeController.createStorePromotion);

// Update store promotion
router.put('/:storeId/promotions/:promotionId', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  param('promotionId').isMongoId().withMessage('Valid promotion ID is required'),
  body('title').optional().trim().isLength({ min: 3, max: 100 }).withMessage('Title must be between 3 and 100 characters'),
  body('description').optional().trim().isLength({ min: 10, max: 500 }).withMessage('Description must be between 10 and 500 characters')
], storeController.updateStorePromotion);

// Delete store promotion
router.delete('/:storeId/promotions/:promotionId', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  param('promotionId').isMongoId().withMessage('Valid promotion ID is required')
], storeController.deleteStorePromotion);

// ================================
// STORE REVIEWS MANAGEMENT
// ================================

// Get store reviews
router.get('/:storeId/reviews', [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  query('rating').optional().isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  query('sortBy').optional().isIn(['createdAt', 'rating', 'helpful']).withMessage('Invalid sort field'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], storeController.getStoreReviews);

// Respond to review
router.post('/reviews/:reviewId/respond', authenticate, authorize(['vendor', 'admin']), [
  param('reviewId').isMongoId().withMessage('Valid review ID is required'),
  body('content').trim().isLength({ min: 10, max: 1000 }).withMessage('Response must be between 10 and 1000 characters')
], storeController.respondToReview);

// ================================
// STORE SEARCH & DISCOVERY
// ================================

// Search stores
router.get('/search', [
  query('q').notEmpty().withMessage('Search term is required'),
  query('category').optional().isMongoId().withMessage('Valid category ID is required'),
  query('location').optional().notEmpty().withMessage('Location is required'),
  query('rating').optional().isFloat({ min: 0, max: 5 }).withMessage('Rating must be between 0 and 5'),
  query('verified').optional().isIn(['true', 'false']).withMessage('Verified must be true or false'),
  query('sortBy').optional().isIn(['rating', 'name', 'newest', 'popular']).withMessage('Invalid sort field'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], storeController.searchStores);

// Get featured stores
router.get('/featured', [
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], storeController.getFeaturedStores);

// Get stores by category
router.get('/category/:categoryId', [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  query('sortBy').optional().isIn(['rating', 'name', 'newest', 'popular']).withMessage('Invalid sort field'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], storeController.getStoresByCategory);

// Get top stores
router.get('/top', [
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
], storeController.getTopStores);

// ================================
// STORE BULK OPERATIONS
// ================================

// Bulk update store settings
router.put('/bulk', authenticate, authorize(['admin']), [
  body('storeIds').isArray({ min: 1 }).withMessage('Store IDs must be an array with at least one ID'),
  body('updates').isObject().withMessage('Updates must be an object')
], storeController.bulkUpdateStoreSettings);

// Bulk approve stores
router.post('/admin/bulk/approve', authenticate, authorize(['admin']), [
  body('storeIds').isArray({ min: 1 }).withMessage('Store IDs must be an array with at least one ID')
], storeController.bulkApproveStores);

// ================================
// STORE IMPORT/EXPORT
// ================================

// Export store data
router.get('/:storeId/export', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  query('format').optional().isIn(['json', 'csv']).withMessage('Format must be json or csv'),
  query('includeProducts').optional().isIn(['true', 'false']).withMessage('includeProducts must be true or false'),
  query('includeOrders').optional().isIn(['true', 'false']).withMessage('includeOrders must be true or false')
], storeController.exportStoreData);

// Import store data
router.post('/:storeId/import', authenticate, authorize(['vendor', 'admin']), upload.single('file'), [
  param('storeId').isMongoId().withMessage('Valid store ID is required')
], storeController.importStoreData);

// ================================
// STORE MANAGER MANAGEMENT
// ================================

// Add store manager
router.post('/:storeId/managers', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  body('userId').isMongoId().withMessage('Valid user ID is required'),
  body('role').optional().isIn(['manager', 'editor', 'viewer']).withMessage('Invalid role'),
  body('permissions').optional().isArray().withMessage('Permissions must be an array')
], storeController.addStoreManager);

// Remove store manager
router.delete('/:storeId/managers/:managerId', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  param('managerId').isMongoId().withMessage('Valid manager ID is required')
], storeController.removeStoreManager);

// Update manager permissions
router.put('/:storeId/managers/:managerId/permissions', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  param('managerId').isMongoId().withMessage('Valid manager ID is required'),
  body('permissions').isArray().withMessage('Permissions must be an array')
], storeController.updateManagerPermissions);

// ================================
// STORE VERIFICATION
// ================================

// Submit store for verification
router.post('/:storeId/verification', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required')
], storeController.submitForVerification);

// Verify store (admin)
router.post('/admin/:storeId/verify', authenticate, authorize(['admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  body('documents').optional().isArray().withMessage('Documents must be an array')
], storeController.verifyStore);

// ================================
// STORE COMMUNICATIONS
// ================================

// Send message to store
router.post('/:storeId/message', authenticate, [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  body('message').trim().isLength({ min: 10, max: 1000 }).withMessage('Message must be between 10 and 1000 characters'),
  body('type').optional().isIn(['inquiry', 'complaint', 'suggestion', 'support']).withMessage('Invalid message type')
], storeController.sendMessageToStore);

// ================================
// STORE STATISTICS
// ================================

// Get store statistics
router.get('/:storeId/statistics', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], storeController.getStoreStatistics);

// ================================
// STORE UTILITIES
// ================================

// Get user stores
router.get('/user/stores', authenticate, authorize(['vendor', 'admin']), storeController.getUserStores);

// Duplicate store
router.post('/:storeId/duplicate', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  body('name').optional().trim().isLength({ min: 3, max: 100 }).withMessage('Store name must be between 3 and 100 characters')
], storeController.duplicateStore);

// Archive store
router.post('/:storeId/archive', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required')
], storeController.archiveStore);

// Get store performance report
router.get('/:storeId/performance', authenticate, authorize(['vendor', 'admin']), [
  param('storeId').isMongoId().withMessage('Valid store ID is required'),
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days'),
  query('format').optional().isIn(['json', 'csv']).withMessage('Format must be json or csv')
], storeController.getStorePerformanceReport);

module.exports = router;
