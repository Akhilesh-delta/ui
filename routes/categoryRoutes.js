const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const { authenticate, authorize } = require('../middleware/auth');
const { body, param, query } = require('express-validator');
const upload = require('../middleware/upload');

// ================================
// CATEGORY MANAGEMENT
// ================================

// Create new category
router.post('/', authenticate, authorize(['admin']), [
  body('name').trim().isLength({ min: 3, max: 100 }).withMessage('Category name must be between 3 and 100 characters'),
  body('description').trim().isLength({ min: 10, max: 2000 }).withMessage('Description must be between 10 and 2000 characters'),
  body('parent').optional().isMongoId().withMessage('Valid parent category ID is required'),
  body('type').optional().isIn(['product', 'service', 'digital']).withMessage('Invalid category type'),
  body('color').optional().matches(/^#[0-9A-F]{6}$/i).withMessage('Invalid color format')
], categoryController.createCategory);

// Get all categories
router.get('/', [
  query('status').optional().isIn(['active', 'inactive', 'archived']).withMessage('Invalid status'),
  query('type').optional().isIn(['product', 'service', 'digital']).withMessage('Invalid category type'),
  query('parent').optional().isMongoId().withMessage('Valid parent category ID is required'),
  query('includeInactive').optional().isIn(['true', 'false']).withMessage('includeInactive must be true or false'),
  query('includeTree').optional().isIn(['true', 'false']).withMessage('includeTree must be true or false'),
  query('search').optional().isLength({ min: 2 }).withMessage('Search term must be at least 2 characters'),
  query('sortBy').optional().isIn(['name', 'position', 'createdAt', 'productCount']).withMessage('Invalid sort field'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], categoryController.getCategories);

// Get category by ID or slug
router.get('/:id', [
  param('id').notEmpty().withMessage('Category ID or slug is required'),
  query('includeProducts').optional().isIn(['true', 'false']).withMessage('includeProducts must be true or false'),
  query('includeSubcategories').optional().isIn(['true', 'false']).withMessage('includeSubcategories must be true or false'),
  query('includeAnalytics').optional().isIn(['true', 'false']).withMessage('includeAnalytics must be true or false')
], categoryController.getCategory);

// Get category by slug
router.get('/slug/:slug', [
  param('slug').isSlug().withMessage('Valid slug is required')
], categoryController.getCategoryBySlug);

// Update category
router.put('/:id', authenticate, authorize(['admin']), [
  param('id').isMongoId().withMessage('Valid category ID is required'),
  body('name').optional().trim().isLength({ min: 3, max: 100 }).withMessage('Category name must be between 3 and 100 characters'),
  body('description').optional().trim().isLength({ min: 10, max: 2000 }).withMessage('Description must be between 10 and 2000 characters'),
  body('parent').optional().isMongoId().withMessage('Valid parent category ID is required')
], categoryController.updateCategory);

// Delete category
router.delete('/:id', authenticate, authorize(['admin']), [
  param('id').isMongoId().withMessage('Valid category ID is required'),
  body('moveProductsTo').optional().isMongoId().withMessage('Valid category ID to move products to')
], categoryController.deleteCategory);

// ================================
// CATEGORY HIERARCHY MANAGEMENT
// ================================

// Move category
router.put('/:categoryId/move', authenticate, authorize(['admin']), [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  body('newParentId').optional().isMongoId().withMessage('Valid new parent category ID is required'),
  body('position').optional().isInt({ min: 0 }).withMessage('Position must be a non-negative integer')
], categoryController.moveCategory);

// Rebuild category hierarchy
router.post('/admin/rebuild-hierarchy', authenticate, authorize(['admin']), categoryController.rebuildHierarchy);

// Get category tree
router.get('/tree', [
  query('includeInactive').optional().isIn(['true', 'false']).withMessage('includeInactive must be true or false'),
  query('maxDepth').optional().isInt({ min: 1, max: 10 }).withMessage('Max depth must be between 1 and 10')
], categoryController.getCategoryTree);

// ================================
// CATEGORY ANALYTICS
// ================================

// Get category analytics
router.get('/:categoryId/analytics', authenticate, authorize(['admin']), [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], categoryController.getCategoryAnalytics);

// ================================
// CATEGORY CONTENT MANAGEMENT
// ================================

// Update category content
router.put('/:categoryId/content', authenticate, authorize(['admin']), [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  body('overview').optional().isLength({ max: 5000 }).withMessage('Overview cannot exceed 5000 characters'),
  body('features').optional().isArray().withMessage('Features must be an array'),
  body('benefits').optional().isArray().withMessage('Benefits must be an array')
], categoryController.updateCategoryContent);

// Add FAQ to category
router.post('/:categoryId/faqs', authenticate, authorize(['admin']), [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  body('question').trim().isLength({ min: 10, max: 500 }).withMessage('Question must be between 10 and 500 characters'),
  body('answer').trim().isLength({ min: 10, max: 2000 }).withMessage('Answer must be between 10 and 2000 characters')
], categoryController.addCategoryFAQ);

// Add guide to category
router.post('/:categoryId/guides', authenticate, authorize(['admin']), [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  body('title').trim().isLength({ min: 5, max: 100 }).withMessage('Title must be between 5 and 100 characters'),
  body('content').trim().isLength({ min: 50, max: 10000 }).withMessage('Content must be between 50 and 10000 characters'),
  body('type').optional().isIn(['text', 'video', 'image']).withMessage('Invalid guide type')
], categoryController.addCategoryGuide);

// ================================
// CATEGORY SEO MANAGEMENT
// ================================

// Update category SEO
router.put('/:categoryId/seo', authenticate, authorize(['admin']), [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  body('metaTitle').optional().isLength({ max: 60 }).withMessage('Meta title cannot exceed 60 characters'),
  body('metaDescription').optional().isLength({ max: 160 }).withMessage('Meta description cannot exceed 160 characters'),
  body('keywords').optional().isArray().withMessage('Keywords must be an array'),
  body('canonicalUrl').optional().isURL().withMessage('Invalid canonical URL')
], categoryController.updateCategorySEO);

// Get category search keywords
router.get('/:categoryId/search-keywords', authenticate, authorize(['admin']), [
  param('categoryId').isMongoId().withMessage('Valid category ID is required')
], categoryController.getCategorySearchKeywords);

// ================================
// CATEGORY RELATIONSHIPS
// ================================

// Add related category
router.post('/:categoryId/related', authenticate, authorize(['admin']), [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  body('relatedCategoryId').isMongoId().withMessage('Valid related category ID is required'),
  body('type').optional().isIn(['related', 'complementary', 'alternative']).withMessage('Invalid relationship type'),
  body('strength').optional().isFloat({ min: 0, max: 1 }).withMessage('Strength must be between 0 and 1')
], categoryController.addRelatedCategory);

// Remove related category
router.delete('/:categoryId/related/:relatedCategoryId', authenticate, authorize(['admin']), [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  param('relatedCategoryId').isMongoId().withMessage('Valid related category ID is required')
], categoryController.removeRelatedCategory);

// Get related categories
router.get('/:categoryId/related', [
  param('categoryId').isMongoId().withMessage('Valid category ID is required')
], categoryController.getRelatedCategories);

// ================================
// CATEGORY SEARCH & DISCOVERY
// ================================

// Search categories
router.get('/search', [
  query('q').notEmpty().withMessage('Search term is required'),
  query('type').optional().isIn(['product', 'service', 'digital']).withMessage('Invalid category type'),
  query('status').optional().isIn(['active', 'inactive', 'archived']).withMessage('Invalid status'),
  query('includeInactive').optional().isIn(['true', 'false']).withMessage('includeInactive must be true or false'),
  query('sortBy').optional().isIn(['name', 'products', 'created']).withMessage('Invalid sort field'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], categoryController.searchCategories);

// Get featured categories
router.get('/featured', [
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
], categoryController.getFeaturedCategories);

// Get popular categories
router.get('/popular', [
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
], categoryController.getPopularCategories);

// Get category recommendations
router.get('/:categoryId/recommendations', [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  query('limit').optional().isInt({ min: 1, max: 20 }).withMessage('Limit must be between 1 and 20')
], categoryController.getCategoryRecommendations);

// ================================
// CATEGORY BULK OPERATIONS
// ================================

// Bulk update categories
router.put('/admin/bulk', authenticate, authorize(['admin']), [
  body('categoryIds').isArray({ min: 1 }).withMessage('Category IDs must be an array with at least one ID'),
  body('updates').isObject().withMessage('Updates must be an object')
], categoryController.bulkUpdateCategories);

// Bulk delete categories
router.delete('/admin/bulk', authenticate, authorize(['admin']), [
  body('categoryIds').isArray({ min: 1 }).withMessage('Category IDs must be an array with at least one ID'),
  body('moveProductsTo').optional().isMongoId().withMessage('Valid category ID to move products to')
], categoryController.bulkDeleteCategories);

// ================================
// CATEGORY IMPORT/EXPORT
// ================================

// Export categories
router.get('/export', authenticate, authorize(['admin']), [
  query('format').optional().isIn(['json', 'csv']).withMessage('Format must be json or csv'),
  query('includeProducts').optional().isIn(['true', 'false']).withMessage('includeProducts must be true or false'),
  query('includeSubcategories').optional().isIn(['true', 'false']).withMessage('includeSubcategories must be true or false')
], categoryController.exportCategories);

// Import categories
router.post('/import', authenticate, authorize(['admin']), upload.single('file'), categoryController.importCategories);

// ================================
// CATEGORY PRODUCTS MANAGEMENT
// ================================

// Get category products
router.get('/:categoryId/products', [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  query('sortBy').optional().isIn(['createdAt', 'name', 'price', 'rating', 'popular']).withMessage('Invalid sort field'),
  query('includeSubcategories').optional().isIn(['true', 'false']).withMessage('includeSubcategories must be true or false'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], categoryController.getCategoryProducts);

// ================================
// CATEGORY STATISTICS
// ================================

// Get category statistics
router.get('/statistics', authenticate, authorize(['admin']), [
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], categoryController.getCategoryStatistics);

// ================================
// CATEGORY MODERATION
// ================================

// Approve category
router.post('/admin/:categoryId/approve', authenticate, authorize(['admin']), [
  param('categoryId').isMongoId().withMessage('Valid category ID is required')
], categoryController.approveCategory);

// Reject category
router.post('/admin/:categoryId/reject', authenticate, authorize(['admin']), [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  body('reason').optional().isLength({ max: 500 }).withMessage('Reason cannot exceed 500 characters')
], categoryController.rejectCategory);

// ================================
// CATEGORY UTILITIES
// ================================

// Get category breadcrumbs
router.get('/:categoryId/breadcrumbs', [
  param('categoryId').isMongoId().withMessage('Valid category ID is required')
], categoryController.getCategoryBreadcrumbs);

// Get category children
router.get('/:categoryId/children', [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  query('recursive').optional().isIn(['true', 'false']).withMessage('recursive must be true or false'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], categoryController.getCategoryChildren);

// Get category path
router.get('/:categoryId/path', [
  param('categoryId').isMongoId().withMessage('Valid category ID is required')
], categoryController.getCategoryPath);

// Get category feed
router.get('/:categoryId/feed', [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  query('format').optional().isIn(['json', 'xml']).withMessage('Format must be json or xml'),
  query('limit').optional().isInt({ min: 1, max: 200 }).withMessage('Limit must be between 1 and 200')
], categoryController.getCategoryFeed);

// Get category performance report
router.get('/:categoryId/performance', authenticate, authorize(['admin']), [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days'),
  query('format').optional().isIn(['json', 'csv']).withMessage('Format must be json or csv')
], categoryController.getCategoryPerformanceReport);

// Cleanup orphaned categories
router.post('/admin/cleanup', authenticate, authorize(['admin']), categoryController.cleanupOrphanedCategories);

// Archive old categories
router.post('/admin/archive', authenticate, authorize(['admin']), [
  query('daysOld').optional().isInt({ min: 1, max: 3650 }).withMessage('Days old must be between 1 and 3650')
], categoryController.archiveOldCategories);

// Add tags to category
router.post('/:categoryId/tags', authenticate, authorize(['admin']), [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  body('tags').isArray({ min: 1 }).withMessage('Tags must be an array with at least one tag')
], categoryController.addCategoryTags);

// Remove tags from category
router.delete('/:categoryId/tags', authenticate, authorize(['admin']), [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  body('tags').isArray({ min: 1 }).withMessage('Tags must be an array with at least one tag')
], categoryController.removeCategoryTags);

// Add category localization
router.post('/:categoryId/localization', authenticate, authorize(['admin']), [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  body('language').isLength({ min: 2, max: 5 }).withMessage('Language must be between 2 and 5 characters'),
  body('name').trim().isLength({ min: 3, max: 100 }).withMessage('Name must be between 3 and 100 characters'),
  body('description').optional().trim().isLength({ min: 10, max: 2000 }).withMessage('Description must be between 10 and 2000 characters')
], categoryController.addCategoryLocalization);

// Get category localizations
router.get('/:categoryId/localizations', [
  param('categoryId').isMongoId().withMessage('Valid category ID is required')
], categoryController.getCategoryLocalizations);

// Update category business rules
router.put('/:categoryId/business-rules', authenticate, authorize(['admin']), [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  body('commissionRate').optional().isFloat({ min: 0, max: 50 }).withMessage('Commission rate must be between 0 and 50'),
  body('shippingRules').optional().isObject().withMessage('Shipping rules must be an object'),
  body('returnPolicy').optional().isObject().withMessage('Return policy must be an object')
], categoryController.updateCategoryBusinessRules);

// Get category business rules
router.get('/:categoryId/business-rules', [
  param('categoryId').isMongoId().withMessage('Valid category ID is required')
], categoryController.getCategoryBusinessRules);

// Add category promotion
router.post('/:categoryId/promotions', authenticate, authorize(['admin']), [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  body('title').trim().isLength({ min: 3, max: 100 }).withMessage('Title must be between 3 and 100 characters'),
  body('description').trim().isLength({ min: 10, max: 500 }).withMessage('Description must be between 10 and 500 characters'),
  body('type').isIn(['percentage', 'fixed', 'buy_x_get_y', 'free_shipping']).withMessage('Invalid promotion type'),
  body('discount.percentage').optional().isFloat({ min: 0, max: 100 }).withMessage('Discount percentage must be between 0 and 100'),
  body('discount.fixedAmount').optional().isFloat({ min: 0 }).withMessage('Fixed amount must be positive'),
  body('startDate').isISO8601().withMessage('Invalid start date format'),
  body('endDate').isISO8601().withMessage('Invalid end date format')
], categoryController.addCategoryPromotion);

// Get category promotions
router.get('/:categoryId/promotions', [
  param('categoryId').isMongoId().withMessage('Valid category ID is required')
], categoryController.getCategoryPromotions);

// Get category history
router.get('/:categoryId/history', authenticate, authorize(['admin']), [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], categoryController.getCategoryHistory);

// Get category by name
router.get('/name/:name', [
  param('name').notEmpty().withMessage('Category name is required')
], categoryController.getCategoryByName);

// Get categories by type
router.get('/type/:type', [
  param('type').isIn(['product', 'service', 'digital']).withMessage('Invalid category type'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], categoryController.getCategoriesByType);

// Get category autocomplete
router.get('/autocomplete', [
  query('q').notEmpty().withMessage('Search term is required'),
  query('limit').optional().isInt({ min: 1, max: 20 }).withMessage('Limit must be between 1 and 20')
], categoryController.getCategoryAutocomplete);

// Get category navigation
router.get('/:categoryId/navigation', [
  param('categoryId').isMongoId().withMessage('Valid category ID is required')
], categoryController.getCategoryNavigation);

// Update category statistics
router.put('/:categoryId/statistics', authenticate, authorize(['admin']), [
  param('categoryId').isMongoId().withMessage('Valid category ID is required')
], categoryController.updateCategoryStatistics);

// Optimize category performance
router.post('/:categoryId/optimize', authenticate, authorize(['admin']), [
  param('categoryId').isMongoId().withMessage('Valid category ID is required')
], categoryController.optimizeCategoryPerformance);

// Generate category report
router.get('/:categoryId/report', authenticate, authorize(['admin']), [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days'),
  query('format').optional().isIn(['json', 'csv']).withMessage('Format must be json or csv')
], categoryController.generateCategoryReport);

// Get category API data
router.get('/:categoryId/api', [
  param('categoryId').isMongoId().withMessage('Valid category ID is required'),
  query('format').optional().isIn(['json', 'xml']).withMessage('Format must be json or xml')
], categoryController.getCategoryAPI);

// Get category search suggestions
router.get('/search/suggestions', [
  query('q').notEmpty().withMessage('Search term is required'),
  query('limit').optional().isInt({ min: 1, max: 20 }).withMessage('Limit must be between 1 and 20')
], categoryController.getCategorySearchSuggestions);

// Get category related searches
router.get('/:categoryId/related-searches', [
  param('categoryId').isMongoId().withMessage('Valid category ID is required')
], categoryController.getCategoryRelatedSearches);

module.exports = router;
