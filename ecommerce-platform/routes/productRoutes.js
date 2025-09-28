const express = require('express');
const router = express.Router();

// Import controller
const {
  createProduct,
  getProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  updateProductInventory,
  addProductImages,
  removeProductImage,
  setPrimaryImage,
  addProductVariant,
  updateProductVariant,
  removeProductVariant,
  getProductReviews,
  addProductReview,
  updateProductReview,
  deleteProductReview,
  markReviewHelpful,
  getFeaturedProducts,
  getTrendingProducts,
  getProductsByCategory,
  getProductsByVendor,
  searchProducts,
  getProductRecommendations,
  getProductStatistics,
  bulkUpdateProducts,
  getFilterOptions,
  getSearchSuggestions,
  compareProducts
} = require('../controllers/productController');

// Import middleware
const { authenticate, requireVendorOrAdmin, optionalAuth } = require('../middleware/authMiddleware');

// Public routes
router.get('/', getProducts);
router.get('/featured', getFeaturedProducts);
router.get('/trending', getTrendingProducts);
router.get('/search', searchProducts);
router.get('/filters', getFilterOptions);
router.get('/search/suggestions', getSearchSuggestions);
router.get('/category/:categoryId', getProductsByCategory);
router.get('/vendor/:vendorId', getProductsByVendor);
router.get('/:id', optionalAuth, getProduct);
router.get('/:id/reviews', getProductReviews);
router.get('/:id/recommendations', getProductRecommendations);
router.post('/compare', compareProducts);

// Protected routes (require authentication)
router.use(authenticate);

// Vendor/Admin only routes
router.post('/', requireVendorOrAdmin, createProduct);
router.put('/:id', requireVendorOrAdmin, updateProduct);
router.delete('/:id', requireVendorOrAdmin, deleteProduct);
router.put('/:id/inventory', requireVendorOrAdmin, updateProductInventory);
router.post('/:id/images', requireVendorOrAdmin, addProductImages);
router.delete('/:id/images/:imageId', requireVendorOrAdmin, removeProductImage);
router.put('/:id/images/:imageId/primary', requireVendorOrAdmin, setPrimaryImage);
router.post('/:id/variants', requireVendorOrAdmin, addProductVariant);
router.put('/:id/variants/:variantId', requireVendorOrAdmin, updateProductVariant);
router.delete('/:id/variants/:variantId', requireVendorOrAdmin, removeProductVariant);
router.get('/:id/statistics', requireVendorOrAdmin, getProductStatistics);
router.put('/bulk-update', requireVendorOrAdmin, bulkUpdateProducts);

// Review routes
router.post('/:id/reviews', addProductReview);
router.put('/:id/reviews/:reviewId', updateProductReview);
router.delete('/:id/reviews/:reviewId', deleteProductReview);
router.post('/:id/reviews/:reviewId/helpful', markReviewHelpful);

module.exports = router;
