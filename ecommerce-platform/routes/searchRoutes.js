const express = require('express');
const router = express.Router();

// Import controller
const {
  advancedProductSearch,
  getSearchSuggestions,
  getSearchHistory,
  clearSearchHistory,
  getPopularSearches,
  getRelatedSearches,
  getSearchAnalytics,
  getProductRecommendations,
  getCategorySuggestions,
  getBrandSuggestions,
  searchWithAIAssist,
  getSearchFilters
} = require('../controllers/searchController');

// Import middleware
const { authenticate, requireAdmin, optionalAuth } = require('../middleware/authMiddleware');

// Public routes
router.get('/products', advancedProductSearch);
router.get('/suggestions', getSearchSuggestions);
router.get('/popular', getPopularSearches);
router.get('/related', getRelatedSearches);
router.get('/categories', getCategorySuggestions);
router.get('/brands', getBrandSuggestions);
router.get('/filters', getSearchFilters);
router.get('/recommendations', getProductRecommendations);
router.post('/ai-assist', searchWithAIAssist);

// Protected routes
router.use(authenticate);

// Search history
router.get('/history', getSearchHistory);
router.delete('/history', clearSearchHistory);

// Admin analytics
router.get('/analytics', requireAdmin, getSearchAnalytics);

module.exports = router;
