const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { authenticate, authorize } = require('../middleware/auth');
const { body, param, query } = require('express-validator');
const upload = require('../middleware/upload');

// ================================
// BASIC CRUD OPERATIONS
// ================================

// Create new product
router.post('/', authenticate, authorize(['vendor', 'admin']), upload.fields([
  { name: 'images', maxCount: 10 }
]), [
  body('name').trim().isLength({ min: 3, max: 200 }).withMessage('Product name must be between 3 and 200 characters'),
  body('description').trim().isLength({ min: 10, max: 10000 }).withMessage('Description must be between 10 and 10000 characters'),
  body('category').isMongoId().withMessage('Valid category ID is required'),
  body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('currency').optional().isIn(['USD', 'EUR', 'GBP', 'CAD', 'AUD']).withMessage('Invalid currency')
], productController.createProduct);

// Get all products with advanced filtering
router.get('/', [
  query('category').optional().isMongoId().withMessage('Valid category ID is required'),
  query('vendor').optional().isMongoId().withMessage('Valid vendor ID is required'),
  query('minPrice').optional().isFloat({ min: 0 }).withMessage('Minimum price must be a positive number'),
  query('maxPrice').optional().isFloat({ min: 0 }).withMessage('Maximum price must be a positive number'),
  query('rating').optional().isFloat({ min: 0, max: 5 }).withMessage('Rating must be between 0 and 5'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], productController.getProducts);

// Get product by ID or slug
router.get('/:id', [
  param('id').notEmpty().withMessage('Product ID or slug is required')
], productController.getProduct);

// Update product
router.put('/:id', authenticate, authorize(['vendor', 'admin']), upload.fields([
  { name: 'images', maxCount: 10 }
]), [
  param('id').isMongoId().withMessage('Valid product ID is required'),
  body('name').optional().trim().isLength({ min: 3, max: 200 }).withMessage('Product name must be between 3 and 200 characters'),
  body('description').optional().trim().isLength({ min: 10, max: 10000 }).withMessage('Description must be between 10 and 10000 characters'),
  body('price').optional().isFloat({ min: 0 }).withMessage('Price must be a positive number')
], productController.updateProduct);

// Delete product
router.delete('/:id', authenticate, authorize(['vendor', 'admin']), [
  param('id').isMongoId().withMessage('Valid product ID is required'),
  query('permanent').optional().isIn(['true', 'false']).withMessage('Permanent must be true or false')
], productController.deleteProduct);

// ================================
// ADVANCED SEARCH & FILTERING
// ================================

// Advanced search
router.get('/search/advanced', productController.advancedSearch);

// ================================
// PRODUCT VARIANTS MANAGEMENT
// ================================

// Create product variant
router.post('/:productId/variants', authenticate, authorize(['vendor', 'admin']), [
  param('productId').isMongoId().withMessage('Valid product ID is required'),
  body('name').trim().isLength({ min: 2, max: 50 }).withMessage('Variant name must be between 2 and 50 characters'),
  body('type').isIn(['color', 'size', 'style', 'material']).withMessage('Invalid variant type'),
  body('values').isArray({ min: 1 }).withMessage('Variant values must be an array with at least one value')
], productController.createVariant);

// Update product variant
router.put('/:productId/variants/:variantId', authenticate, authorize(['vendor', 'admin']), [
  param('productId').isMongoId().withMessage('Valid product ID is required'),
  param('variantId').isMongoId().withMessage('Valid variant ID is required'),
  body('name').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Variant name must be between 2 and 50 characters'),
  body('values').optional().isArray({ min: 1 }).withMessage('Variant values must be an array with at least one value')
], productController.updateVariant);

// Delete product variant
router.delete('/:productId/variants/:variantId', authenticate, authorize(['vendor', 'admin']), [
  param('productId').isMongoId().withMessage('Valid product ID is required'),
  param('variantId').isMongoId().withMessage('Valid variant ID is required')
], productController.deleteVariant);

// ================================
// INVENTORY MANAGEMENT
// ================================

// Update inventory
router.put('/:productId/inventory', authenticate, authorize(['vendor', 'admin']), [
  param('productId').isMongoId().withMessage('Valid product ID is required'),
  body('quantity').isInt({ min: 0 }).withMessage('Quantity must be a non-negative integer'),
  body('reason').optional().isIn(['sale', 'return', 'adjustment', 'damage', 'theft']).withMessage('Invalid reason')
], productController.updateInventory);

// Get inventory history
router.get('/:productId/inventory/history', authenticate, authorize(['vendor', 'admin']), [
  param('productId').isMongoId().withMessage('Valid product ID is required'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], productController.getInventoryHistory);

// ================================
// PRODUCT ANALYTICS
// ================================

// Get product analytics
router.get('/:productId/analytics', authenticate, authorize(['vendor', 'admin']), [
  param('productId').isMongoId().withMessage('Valid product ID is required'),
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], productController.getProductAnalytics);

// ================================
// PRODUCT RECOMMENDATIONS
// ================================

// Get product recommendations
router.get('/:productId/recommendations', [
  param('productId').isMongoId().withMessage('Valid product ID is required'),
  query('type').optional().isIn(['related', 'upsell', 'cross_sell', 'personalized', 'trending', 'bestsellers']).withMessage('Invalid recommendation type'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
], productController.getRecommendations);

// ================================
// BULK OPERATIONS
// ================================

// Bulk update products
router.put('/bulk', authenticate, authorize(['vendor', 'admin']), [
  body('productIds').isArray({ min: 1 }).withMessage('Product IDs must be an array with at least one ID'),
  body('updates').isObject().withMessage('Updates must be an object')
], productController.bulkUpdateProducts);

// Bulk delete products
router.delete('/bulk', authenticate, authorize(['vendor', 'admin']), [
  body('productIds').isArray({ min: 1 }).withMessage('Product IDs must be an array with at least one ID'),
  body('permanent').optional().isIn(['true', 'false']).withMessage('Permanent must be true or false')
], productController.bulkDeleteProducts);

// Import products
router.post('/import', authenticate, authorize(['vendor', 'admin']), upload.single('file'), productController.importProducts);

// Export products
router.get('/export', authenticate, authorize(['vendor', 'admin']), [
  query('format').optional().isIn(['csv', 'excel']).withMessage('Format must be csv or excel'),
  query('category').optional().isMongoId().withMessage('Valid category ID is required'),
  query('vendor').optional().isMongoId().withMessage('Valid vendor ID is required'),
  query('status').optional().isIn(['draft', 'published', 'archived']).withMessage('Invalid status'),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format')
], productController.exportProducts);

// ================================
// VENDOR PRODUCT MANAGEMENT
// ================================

// Get vendor products
router.get('/vendor/products', authenticate, authorize(['vendor']), [
  query('status').optional().isIn(['all', 'draft', 'published', 'archived']).withMessage('Invalid status'),
  query('category').optional().isMongoId().withMessage('Valid category ID is required'),
  query('search').optional().isLength({ min: 2 }).withMessage('Search term must be at least 2 characters'),
  query('sortBy').optional().isIn(['createdAt', 'name', 'price', 'stock', 'sales', 'updated']).withMessage('Invalid sort field'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], productController.getVendorProducts);

// Duplicate product
router.post('/:productId/duplicate', authenticate, authorize(['vendor', 'admin']), [
  param('productId').isMongoId().withMessage('Valid product ID is required'),
  body('name').optional().trim().isLength({ min: 3, max: 200 }).withMessage('Product name must be between 3 and 200 characters')
], productController.duplicateProduct);

// ================================
// PRICE & PROMOTION MANAGEMENT
// ================================

// Update product price
router.put('/:productId/price', authenticate, authorize(['vendor', 'admin']), [
  param('productId').isMongoId().withMessage('Valid product ID is required'),
  body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('compareAtPrice').optional().isFloat({ min: 0 }).withMessage('Compare at price must be a positive number')
], productController.updatePrice);

// Set product discount
router.post('/:productId/discount', authenticate, authorize(['vendor', 'admin']), [
  param('productId').isMongoId().withMessage('Valid product ID is required'),
  body('type').isIn(['percentage', 'fixed']).withMessage('Discount type must be percentage or fixed'),
  body('value').isFloat({ min: 0 }).withMessage('Discount value must be a positive number'),
  body('startDate').optional().isISO8601().withMessage('Invalid start date format'),
  body('endDate').optional().isISO8601().withMessage('Invalid end date format')
], productController.setDiscount);

// Remove product discount
router.delete('/:productId/discount', authenticate, authorize(['vendor', 'admin']), [
  param('productId').isMongoId().withMessage('Valid product ID is required')
], productController.removeDiscount);

// ================================
// ADMIN PRODUCT MANAGEMENT
// ================================

// Get all products (admin)
router.get('/admin/products', authenticate, authorize(['admin']), [
  query('status').optional().isIn(['draft', 'published', 'archived']).withMessage('Invalid status'),
  query('category').optional().isMongoId().withMessage('Valid category ID is required'),
  query('vendor').optional().isMongoId().withMessage('Valid vendor ID is required'),
  query('featured').optional().isIn(['true', 'false']).withMessage('Featured must be true or false'),
  query('search').optional().isLength({ min: 2 }).withMessage('Search term must be at least 2 characters'),
  query('sortBy').optional().isIn(['createdAt', 'name', 'price', 'sales', 'rating']).withMessage('Invalid sort field'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], productController.getAllProductsAdmin);

// Approve product (admin)
router.post('/admin/products/:productId/approve', authenticate, authorize(['admin']), [
  param('productId').isMongoId().withMessage('Valid product ID is required')
], productController.approveProduct);

// Reject product (admin)
router.post('/admin/products/:productId/reject', authenticate, authorize(['admin']), [
  param('productId').isMongoId().withMessage('Valid product ID is required'),
  body('reason').notEmpty().withMessage('Rejection reason is required')
], productController.rejectProduct);

// Feature product (admin)
router.put('/admin/products/:productId/featured', authenticate, authorize(['admin']), [
  param('productId').isMongoId().withMessage('Valid product ID is required')
], productController.featureProduct);

// Get product statistics (admin)
router.get('/admin/products/statistics', authenticate, authorize(['admin']), [
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], productController.getProductStatistics);

// ================================
// UTILITY ROUTES
// ================================

// Get low stock products
router.get('/low-stock', authenticate, authorize(['vendor', 'admin']), productController.getLowStockProducts);

// Get featured products
router.get('/featured', [
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], productController.getFeaturedProducts);

// Get products by category
router.get('/category/:categoryId', [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  query('sortBy').optional().isIn(['createdAt', 'name', 'price', 'rating', 'popular']).withMessage('Invalid sort field'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], productController.getProductsByCategory);

// Get products by price range
router.get('/price-range/:minPrice/:maxPrice', [
  param('minPrice').isFloat({ min: 0 }).withMessage('Minimum price must be a positive number'),
  param('maxPrice').isFloat({ min: 0 }).withMessage('Maximum price must be a positive number'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], productController.getProductsByPriceRange);

// Search products
router.get('/search', [
  query('q').notEmpty().withMessage('Search term is required'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer')
], productController.searchProducts);

// Track product view
router.post('/:productId/view', [
  param('productId').isMongoId().withMessage('Valid product ID is required')
], productController.trackView);

// Add to wishlist
router.post('/:productId/wishlist', authenticate, [
  param('productId').isMongoId().withMessage('Valid product ID is required')
], productController.addToWishlist);

// Remove from wishlist
router.delete('/:productId/wishlist', authenticate, [
  param('productId').isMongoId().withMessage('Valid product ID is required')
], productController.removeFromWishlist);

// Get product reviews
router.get('/:productId/reviews', [
  param('productId').isMongoId().withMessage('Valid product ID is required'),
  query('sortBy').optional().isIn(['createdAt', 'rating', 'helpful']).withMessage('Invalid sort field'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], productController.getProductReviews);

// Create product review
router.post('/:productId/reviews', authenticate, [
  param('productId').isMongoId().withMessage('Valid product ID is required'),
  body('title').trim().isLength({ min: 5, max: 100 }).withMessage('Review title must be between 5 and 100 characters'),
  body('content').trim().isLength({ min: 10, max: 2000 }).withMessage('Review content must be between 10 and 2000 characters'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5')
], productController.createProductReview);

module.exports = router;
