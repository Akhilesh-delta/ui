const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cartController');
const { authenticate, authorize } = require('../middleware/auth');
const { body, param, query } = require('express-validator');
const upload = require('../middleware/upload');

// ================================
// CART MANAGEMENT
// ================================

// Get or create cart
router.get('/:cartId', [
  param('cartId').notEmpty().withMessage('Cart ID is required')
], cartController.getCart);

// Add item to cart
router.post('/:cartId/items', [
  param('cartId').notEmpty().withMessage('Cart ID is required'),
  body('productId').isMongoId().withMessage('Valid product ID is required'),
  body('quantity').optional().isInt({ min: 1, max: 100 }).withMessage('Quantity must be between 1 and 100'),
  body('variant').optional().isObject().withMessage('Variant must be an object'),
  body('customizations').optional().isObject().withMessage('Customizations must be an object')
], cartController.addToCart);

// Update cart item
router.put('/:cartId/items', [
  param('cartId').notEmpty().withMessage('Cart ID is required'),
  body('productId').isMongoId().withMessage('Valid product ID is required'),
  body('quantity').isInt({ min: 1, max: 100 }).withMessage('Quantity must be between 1 and 100'),
  body('variant').optional().isObject().withMessage('Variant must be an object'),
  body('customizations').optional().isObject().withMessage('Customizations must be an object')
], cartController.updateCartItem);

// Remove item from cart
router.delete('/:cartId/items', [
  param('cartId').notEmpty().withMessage('Cart ID is required'),
  body('productId').isMongoId().withMessage('Valid product ID is required'),
  body('variant').optional().isObject().withMessage('Variant must be an object'),
  body('customizations').optional().isObject().withMessage('Customizations must be an object')
], cartController.removeFromCart);

// Clear cart
router.delete('/:cartId', [
  param('cartId').notEmpty().withMessage('Cart ID is required')
], cartController.clearCart);

// ================================
// CART CALCULATIONS
// ================================

// Get cart pricing
router.get('/:cartId/pricing', [
  param('cartId').notEmpty().withMessage('Cart ID is required'),
  body('shippingMethod').optional().isIn(['standard', 'express', 'overnight', 'pickup']).withMessage('Invalid shipping method'),
  body('shippingAddress').optional().isObject().withMessage('Shipping address must be an object'),
  body('couponCode').optional().isLength({ min: 3, max: 20 }).withMessage('Coupon code must be between 3 and 20 characters')
], cartController.getCartPricing);

// ================================
// COUPON MANAGEMENT
// ================================

// Apply coupon to cart
router.post('/:cartId/coupon', [
  param('cartId').notEmpty().withMessage('Cart ID is required'),
  body('couponCode').isLength({ min: 3, max: 20 }).withMessage('Coupon code must be between 3 and 20 characters')
], cartController.applyCoupon);

// Remove coupon from cart
router.delete('/:cartId/coupon', [
  param('cartId').notEmpty().withMessage('Cart ID is required')
], cartController.removeCoupon);

// Get available coupons
router.get('/:cartId/coupons', [
  param('cartId').notEmpty().withMessage('Cart ID is required')
], cartController.getAvailableCoupons);

// ================================
// CART PERSISTENCE
// ================================

// Merge guest cart with user cart
router.post('/merge', authenticate, [
  body('guestCartId').notEmpty().withMessage('Guest cart ID is required')
], cartController.mergeGuestCart);

// Save cart for later
router.post('/:cartId/save', authenticate, [
  param('cartId').notEmpty().withMessage('Cart ID is required'),
  body('name').optional().isLength({ max: 100 }).withMessage('Name cannot exceed 100 characters')
], cartController.saveCartForLater);

// ================================
// CART ANALYTICS
// ================================

// Get cart analytics
router.get('/:cartId/analytics', [
  param('cartId').notEmpty().withMessage('Cart ID is required')
], cartController.getCartAnalytics);

// ================================
// CART TO ORDER CONVERSION
// ================================

// Convert cart to order
router.post('/:cartId/checkout', [
  param('cartId').notEmpty().withMessage('Cart ID is required'),
  body('shipping.address').isObject().withMessage('Shipping address is required'),
  body('billing').optional().isObject().withMessage('Billing information must be an object'),
  body('paymentMethod').isIn(['credit_card', 'debit_card', 'bank_transfer', 'paypal', 'cash_on_delivery']).withMessage('Invalid payment method'),
  body('notes.customer').optional().isLength({ max: 1000 }).withMessage('Notes cannot exceed 1000 characters')
], cartController.convertToOrder);

// Get checkout information
router.get('/:cartId/checkout', [
  param('cartId').notEmpty().withMessage('Cart ID is required')
], cartController.getCheckoutInfo);

// ================================
// CART SHARING & COLLABORATION
// ================================

// Share cart
router.post('/:cartId/share', [
  param('cartId').notEmpty().withMessage('Cart ID is required'),
  body('shareWith').optional().isIn(['public', 'specific']).withMessage('Invalid share type'),
  body('message').optional().isLength({ max: 500 }).withMessage('Message cannot exceed 500 characters'),
  body('expiresIn').optional().isInt({ min: 1, max: 30 }).withMessage('Expiration must be between 1 and 30 days')
], cartController.shareCart);

// Get shared cart
router.get('/shared/:shareToken', [
  param('shareToken').notEmpty().withMessage('Share token is required')
], cartController.getSharedCart);

// Add shared cart to user's cart
router.post('/shared/:shareToken/add', authenticate, [
  param('shareToken').notEmpty().withMessage('Share token is required')
], cartController.addSharedCartToCart);

// ================================
// CART NOTIFICATIONS
// ================================

// Send cart reminder
router.post('/:cartId/remind', [
  param('cartId').notEmpty().withMessage('Cart ID is required')
], cartController.sendCartReminder);

// ================================
// CART RECOMMENDATIONS
// ================================

// Get cart recommendations
router.get('/:cartId/recommendations', [
  param('cartId').notEmpty().withMessage('Cart ID is required'),
  query('type').optional().isIn(['cross_sell', 'upsell', 'complementary', 'personalized']).withMessage('Invalid recommendation type'),
  query('limit').optional().isInt({ min: 1, max: 20 }).withMessage('Limit must be between 1 and 20')
], cartController.getCartRecommendations);

// ================================
// CART EXPORT/IMPORT
// ================================

// Export cart
router.get('/:cartId/export', [
  param('cartId').notEmpty().withMessage('Cart ID is required'),
  query('format').optional().isIn(['json', 'csv']).withMessage('Format must be json or csv')
], cartController.exportCart);

// Import cart
router.post('/:cartId/import', upload.single('file'), [
  param('cartId').notEmpty().withMessage('Cart ID is required')
], cartController.importCart);

// ================================
// CART BULK OPERATIONS
// ================================

// Bulk add items to cart
router.post('/bulk', [
  body('items').isArray({ min: 1 }).withMessage('Items must be an array with at least one item'),
  body('items.*.productId').isMongoId().withMessage('Valid product ID is required'),
  body('items.*.quantity').optional().isInt({ min: 1, max: 100 }).withMessage('Quantity must be between 1 and 100')
], cartController.bulkAddToCart);

// Bulk update cart items
router.put('/bulk', [
  param('cartId').notEmpty().withMessage('Cart ID is required'),
  body('updates').isArray({ min: 1 }).withMessage('Updates must be an array with at least one update'),
  body('updates.*.productId').isMongoId().withMessage('Valid product ID is required'),
  body('updates.*.quantity').isInt({ min: 1, max: 100 }).withMessage('Quantity must be between 1 and 100')
], cartController.bulkUpdateCart);

// ================================
// CART VALIDATION
// ================================

// Validate cart
router.get('/:cartId/validate', [
  param('cartId').notEmpty().withMessage('Cart ID is required')
], cartController.validateCart);

// ================================
// CART HISTORY & TRACKING
// ================================

// Get cart history
router.get('/:cartId/history', [
  param('cartId').notEmpty().withMessage('Cart ID is required'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], cartController.getCartHistory);

// Track cart event
router.post('/:cartId/track', [
  param('cartId').notEmpty().withMessage('Cart ID is required'),
  body('event').isIn(['cart_viewed', 'item_added', 'item_removed', 'item_updated', 'checkout_started', 'checkout_completed', 'cart_abandoned']).withMessage('Invalid event type'),
  body('data').optional().isObject().withMessage('Data must be an object')
], cartController.trackCartEvent);

// ================================
// CART SECURITY
// ================================

// Validate cart ownership
router.get('/:cartId/ownership', [
  param('cartId').notEmpty().withMessage('Cart ID is required')
], cartController.validateCartOwnership);

// Secure cart operations
router.post('/:cartId/secure', [
  param('cartId').notEmpty().withMessage('Cart ID is required'),
  body('operation').isIn(['add_item', 'update_item', 'remove_item']).withMessage('Invalid operation'),
  body('data').isObject().withMessage('Data must be an object')
], cartController.secureCartOperation);

// ================================
// ADMIN CART MANAGEMENT
// ================================

// Cleanup abandoned carts
router.post('/admin/cleanup', authenticate, authorize(['admin']), [
  query('daysOld').optional().isInt({ min: 1, max: 365 }).withMessage('Days old must be between 1 and 365')
], cartController.cleanupAbandonedCarts);

// Get cart statistics
router.get('/admin/statistics', authenticate, authorize(['admin']), [
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], cartController.getCartStatistics);

// Get abandoned carts
router.get('/admin/abandoned', authenticate, authorize(['admin']), [
  query('daysOld').optional().isInt({ min: 1, max: 365 }).withMessage('Days old must be between 1 and 365'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], cartController.getAbandonedCarts);

// Recover abandoned cart
router.post('/admin/:cartId/recover', authenticate, authorize(['admin']), [
  param('cartId').isMongoId().withMessage('Valid cart ID is required'),
  body('userId').isMongoId().withMessage('Valid user ID is required')
], cartController.recoverAbandonedCart);

// ================================
// CART WISHLIST MANAGEMENT
// ================================

// Add item to wishlist
router.post('/:cartId/wishlist', [
  param('cartId').notEmpty().withMessage('Cart ID is required'),
  body('productId').isMongoId().withMessage('Valid product ID is required'),
  body('notes').optional().isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters')
], cartController.addToWishlist);

// Remove from wishlist
router.delete('/:cartId/wishlist', [
  param('cartId').notEmpty().withMessage('Cart ID is required'),
  body('productId').isMongoId().withMessage('Valid product ID is required')
], cartController.removeFromWishlist);

// Get wishlist items
router.get('/:cartId/wishlist', [
  param('cartId').notEmpty().withMessage('Cart ID is required')
], cartController.getWishlist);

// Move wishlist item to cart
router.post('/:cartId/wishlist/move', [
  param('cartId').notEmpty().withMessage('Cart ID is required'),
  body('productId').isMongoId().withMessage('Valid product ID is required'),
  body('quantity').optional().isInt({ min: 1, max: 100 }).withMessage('Quantity must be between 1 and 100')
], cartController.moveToCart);

// ================================
// CART COMPARISON
// ================================

// Compare carts
router.post('/compare', [
  body('cartIds').isArray({ min: 2, max: 5 }).withMessage('Cart IDs must be an array with 2-5 cart IDs')
], cartController.compareCarts);

// ================================
// CART PERFORMANCE
// ================================

// Get cart performance metrics
router.get('/admin/performance', authenticate, authorize(['admin']), cartController.getCartPerformance);

// Optimize cart performance
router.post('/:cartId/optimize', [
  param('cartId').notEmpty().withMessage('Cart ID is required')
], cartController.optimizeCartPerformance);

module.exports = router;
