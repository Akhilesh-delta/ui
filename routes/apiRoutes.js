const express = require('express');
const router = express.Router();

// Import controllers
const userController = require('../controllers/userController');
const productController = require('../controllers/productController');
const orderController = require('../controllers/orderController');
const paymentController = require('../controllers/paymentController');
const adminController = require('../controllers/adminController');

// Import middleware
const { authenticate, authorize } = require('../middleware/auth');
const { validateRequest } = require('../middleware/requestLogger');
const { upload } = require('../middleware/fileUpload');
const rateLimit = require('express-rate-limit');

// Import validators
const {
  registerValidator,
  loginValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  changePasswordValidator,
  updateProfileValidator,
  createProductValidator,
  updateProductValidator,
  createOrderValidator,
  processPaymentValidator
} = require('../validators');

// Rate limiting configurations
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: 'Too many authentication attempts, please try again later.'
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: 'Too many requests, please try again later.'
});

// ================================
// AUTHENTICATION ROUTES
// ================================

// Public authentication routes
router.post('/auth/register', authLimiter, registerValidator, userController.register);
router.post('/auth/login', authLimiter, loginValidator, userController.login);
router.post('/auth/logout', authenticate, userController.logout);
router.post('/auth/refresh', userController.refreshToken);
router.post('/auth/forgot-password', authLimiter, forgotPasswordValidator, userController.forgotPassword);
router.post('/auth/reset-password', resetPasswordValidator, userController.resetPassword);

// Two-factor authentication
router.post('/auth/2fa/enable', authenticate, userController.enableTwoFactor);
router.post('/auth/2fa/verify', authenticate, userController.verifyTwoFactor);
router.post('/auth/2fa/disable', authenticate, userController.disableTwoFactor);

// Email and phone verification
router.post('/auth/verify-email', authenticate, userController.sendEmailVerification);
router.get('/auth/verify-email/:token', userController.verifyEmail);
router.post('/auth/verify-phone', authenticate, userController.sendPhoneVerification);
router.post('/auth/verify-phone/confirm', authenticate, userController.verifyPhone);

// Social authentication (placeholder routes)
router.post('/auth/google', authLimiter, userController.googleAuth);
router.post('/auth/facebook', authLimiter, userController.facebookAuth);

// ================================
// USER MANAGEMENT ROUTES
// ================================

// Public user routes
router.get('/users/profile', authenticate, userController.getProfile);
router.put('/users/profile', authenticate, updateProfileValidator, userController.updateProfile);
router.put('/users/avatar', authenticate, upload.single('avatar'), userController.updateAvatar);
router.delete('/users/account', authenticate, userController.deleteAccount);

// Password management
router.post('/users/change-password', authenticate, changePasswordValidator, userController.changePassword);

// User preferences
router.get('/users/preferences', authenticate, userController.getPreferences);
router.put('/users/preferences/notifications', authenticate, userController.updateNotificationPreferences);
router.put('/users/preferences/privacy', authenticate, userController.updatePrivacyPreferences);
router.put('/users/preferences/shopping', authenticate, userController.updateShoppingPreferences);

// Vendor registration and management
router.post('/users/become-vendor', authenticate, userController.becomeVendor);
router.get('/users/vendor-dashboard', authenticate, authorize(['vendor', 'admin']), userController.getVendorDashboard);
router.put('/users/vendor-profile', authenticate, authorize(['vendor', 'admin']), userController.updateVendorProfile);

// Public user search
router.get('/users/search', generalLimiter, userController.searchUsers);

// ================================
// PRODUCT MANAGEMENT ROUTES
// ================================

// Public product routes
router.get('/products', generalLimiter, productController.getProducts);
router.get('/products/featured', generalLimiter, productController.getFeaturedProducts);
router.get('/products/search', generalLimiter, productController.searchProducts);
router.get('/products/category/:categoryId', generalLimiter, productController.getProductsByCategory);
router.get('/products/price-range/:minPrice/:maxPrice', generalLimiter, productController.getProductsByPriceRange);
router.get('/products/:id', generalLimiter, productController.getProduct);
router.get('/products/slug/:slug', generalLimiter, productController.getProduct);

// Product interactions
router.post('/products/:productId/view', generalLimiter, productController.trackView);
router.post('/products/:productId/wishlist', authenticate, productController.addToWishlist);
router.delete('/products/:productId/wishlist', authenticate, productController.removeFromWishlist);
router.post('/products/:productId/reviews', authenticate, productController.createProductReview);
router.get('/products/:productId/reviews', generalLimiter, productController.getProductReviews);

// Product comparison
router.post('/products/compare', generalLimiter, productController.compareProducts);

// Advanced search
router.get('/products/search/advanced', generalLimiter, productController.advancedSearch);

// Product recommendations
router.get('/products/:productId/recommendations', generalLimiter, productController.getRecommendations);

// Vendor product management
router.get('/vendor/products', authenticate, authorize(['vendor', 'admin']), productController.getVendorProducts);
router.post('/vendor/products', authenticate, authorize(['vendor', 'admin']), upload.array('images', 10), createProductValidator, productController.createProduct);
router.put('/vendor/products/:id', authenticate, authorize(['vendor', 'admin']), upload.array('images', 10), updateProductValidator, productController.updateProduct);
router.delete('/vendor/products/:id', authenticate, authorize(['vendor', 'admin']), productController.deleteProduct);
router.post('/vendor/products/:productId/duplicate', authenticate, authorize(['vendor', 'admin']), productController.duplicateProduct);

// Product inventory management
router.put('/vendor/products/:productId/inventory', authenticate, authorize(['vendor', 'admin']), productController.updateInventory);
router.get('/vendor/products/:productId/inventory/history', authenticate, authorize(['vendor', 'admin']), productController.getInventoryHistory);

// Product pricing and promotions
router.put('/vendor/products/:productId/price', authenticate, authorize(['vendor', 'admin']), productController.updatePrice);
router.post('/vendor/products/:productId/discount', authenticate, authorize(['vendor', 'admin']), productController.setDiscount);
router.delete('/vendor/products/:productId/discount', authenticate, authorize(['vendor', 'admin']), productController.removeDiscount);

// Product analytics
router.get('/vendor/products/:productId/analytics', authenticate, authorize(['vendor', 'admin']), productController.getProductAnalytics);

// Bulk operations
router.post('/vendor/products/bulk-update', authenticate, authorize(['vendor', 'admin']), productController.bulkUpdateProducts);
router.post('/vendor/products/bulk-delete', authenticate, authorize(['vendor', 'admin']), productController.bulkDeleteProducts);
router.post('/vendor/products/import', authenticate, authorize(['vendor', 'admin']), upload.single('file'), productController.importProducts);
router.get('/vendor/products/export', authenticate, authorize(['vendor', 'admin']), productController.exportProducts);

// Product variants
router.post('/vendor/products/:productId/variants', authenticate, authorize(['vendor', 'admin']), productController.createVariant);
router.put('/vendor/products/:productId/variants/:variantId', authenticate, authorize(['vendor', 'admin']), productController.updateVariant);
router.delete('/vendor/products/:productId/variants/:variantId', authenticate, authorize(['vendor', 'admin']), productController.deleteVariant);

// ================================
// ORDER MANAGEMENT ROUTES
// ================================

// Public order routes
router.post('/orders', authenticate, createOrderValidator, orderController.createOrder);
router.get('/orders', authenticate, orderController.getUserOrders);
router.get('/orders/:id', authenticate, orderController.getOrder);
router.get('/orders/number/:orderNumber', authenticate, orderController.getOrderByNumber);
router.post('/orders/:id/cancel', authenticate, orderController.cancelOrder);

// Order tracking
router.get('/orders/:id/track', generalLimiter, orderController.trackOrder);
router.get('/orders/:id/timeline', authenticate, orderController.getOrderTimeline);
router.get('/orders/:id/invoice', authenticate, orderController.generateInvoice);

// Order communications
router.post('/orders/:id/message', authenticate, orderController.sendOrderMessage);
router.post('/orders/:id/note', authenticate, authorize(['admin']), orderController.addOrderNote);

// Return and refund management
router.post('/orders/:id/return', authenticate, orderController.requestReturn);
router.put('/orders/:orderId/returns/:returnId', authenticate, authorize(['vendor', 'admin']), orderController.processReturn);

// Vendor order management
router.get('/vendor/orders', authenticate, authorize(['vendor', 'admin']), orderController.getVendorOrders);
router.put('/vendor/orders/:id/status', authenticate, authorize(['vendor', 'admin']), orderController.updateVendorOrderStatus);
router.post('/vendor/orders/:id/ship', authenticate, authorize(['vendor', 'admin']), orderController.markAsShipped);
router.post('/vendor/orders/:id/deliver', authenticate, authorize(['vendor', 'admin']), orderController.markAsDelivered);

// Order analytics
router.get('/orders/analytics', authenticate, orderController.getOrderAnalytics);

// Admin order management
router.get('/admin/orders', authenticate, authorize(['admin']), orderController.getAllOrders);
router.get('/admin/orders/:id', authenticate, authorize(['admin']), orderController.getOrderDetails);
router.put('/admin/orders/:id', authenticate, authorize(['admin']), orderController.updateOrder);
router.post('/admin/orders/:id/cancel', authenticate, authorize(['admin']), orderController.cancelOrder);
router.get('/admin/orders/pending', authenticate, authorize(['admin']), orderController.getPendingOrders);
router.get('/admin/orders/overdue', authenticate, authorize(['admin']), orderController.getOverdueOrders);

// Order search
router.get('/orders/search', generalLimiter, orderController.searchOrders);

// Order statistics
router.get('/admin/orders/statistics', authenticate, authorize(['admin']), orderController.getOrderStatistics);

// Order export
router.get('/admin/orders/export', authenticate, authorize(['admin']), orderController.exportOrders);

// ================================
// PAYMENT PROCESSING ROUTES
// ================================

// Payment processing
router.post('/payments/intent', authenticate, processPaymentValidator, paymentController.createPaymentIntent);
router.post('/payments/confirm', authenticate, paymentController.confirmPayment);

// Payment methods
router.post('/payments/methods', authenticate, paymentController.addPaymentMethod);
router.get('/payments/methods', authenticate, paymentController.getPaymentMethods);
router.put('/payments/methods/:paymentMethodId/default', authenticate, paymentController.updateDefaultPaymentMethod);
router.delete('/payments/methods/:paymentMethodId', authenticate, paymentController.deletePaymentMethod);

// Refunds
router.post('/payments/:paymentId/refund', authenticate, authorize(['admin', 'customer']), paymentController.processRefund);
router.get('/payments/:paymentId/refunds', authenticate, paymentController.getRefundDetails);

// Disputes
router.post('/payments/:paymentId/dispute', authenticate, paymentController.createDispute);
router.get('/payments/:paymentId/disputes', authenticate, paymentController.getDisputeDetails);

// Subscriptions
router.post('/payments/subscriptions', authenticate, paymentController.createSubscription);
router.post('/payments/subscriptions/cancel', authenticate, paymentController.cancelSubscription);

// Payouts (vendor/admin)
router.post('/payments/payouts/:vendorId', authenticate, authorize(['vendor', 'admin']), paymentController.processPayouts);
router.get('/payments/payouts/:vendorId/history', authenticate, authorize(['vendor', 'admin']), paymentController.getPayoutHistory);

// Payment analytics
router.get('/payments/analytics', authenticate, paymentController.getPaymentAnalytics);

// Admin payment management
router.get('/admin/payments', authenticate, authorize(['admin']), paymentController.getAllPayments);
router.get('/admin/payments/:id', authenticate, authorize(['admin']), paymentController.getPaymentById);
router.put('/admin/payments/:id', authenticate, authorize(['admin']), paymentController.updatePayment);
router.get('/admin/payments/high-risk', authenticate, authorize(['admin']), paymentController.getHighRiskPayments);
router.post('/admin/payments/:paymentId/review', authenticate, authorize(['admin']), paymentController.reviewPaymentRisk);

// Payment utilities
router.get('/payments/methods/supported', generalLimiter, paymentController.getSupportedPaymentMethods);
router.get('/payments/exchange-rates', generalLimiter, paymentController.getExchangeRates);
router.post('/payments/convert', generalLimiter, paymentController.convertCurrency);
router.post('/payments/calculate-fees', generalLimiter, paymentController.calculateFees);

// Digital wallets
router.post('/payments/wallets/connect', authenticate, paymentController.connectDigitalWallet);
router.post('/payments/wallets/pay', authenticate, paymentController.processWalletPayment);

// Cryptocurrency
router.post('/payments/crypto/address', authenticate, paymentController.getCryptoPaymentAddress);
router.get('/payments/crypto/:paymentId/status', authenticate, paymentController.checkCryptoPaymentStatus);

// Buy now pay later
router.post('/payments/bnpl/application', authenticate, paymentController.createBNPLApplication);
router.post('/payments/bnpl/:applicationId/process', authenticate, paymentController.processBNPLPayment);

// Gift cards and store credit
router.post('/payments/gift-card/apply', authenticate, paymentController.applyGiftCard);
router.post('/payments/store-credit/apply', authenticate, paymentController.applyStoreCredit);

// Installment payments
router.post('/payments/installments', authenticate, paymentController.createInstallmentPlan);
router.post('/payments/installments/:paymentId/process', authenticate, paymentController.processInstallmentPayment);

// Tax calculation
router.post('/payments/tax/calculate', generalLimiter, paymentController.calculateTax);

// Payment settings
router.get('/payments/settings', generalLimiter, paymentController.getPaymentSettings);
router.put('/admin/payments/settings', authenticate, authorize(['admin']), paymentController.updatePaymentSettings);

// ================================
// ADMIN DASHBOARD ROUTES
// ================================

// Dashboard
router.get('/admin/dashboard', authenticate, authorize(['admin']), adminController.getDashboard);

// User management (admin)
router.get('/admin/users', authenticate, authorize(['admin']), adminController.getAllUsers);
router.get('/admin/users/:id', authenticate, authorize(['admin']), adminController.getUserDetails);
router.put('/admin/users/:id', authenticate, authorize(['admin']), adminController.updateUser);
router.delete('/admin/users/:id', authenticate, authorize(['admin']), adminController.deleteUser);
router.post('/admin/users/:id/suspend', authenticate, authorize(['admin']), adminController.suspendUser);
router.post('/admin/users/:id/activate', authenticate, authorize(['admin']), adminController.activateUser);
router.get('/admin/users/statistics', authenticate, authorize(['admin']), adminController.getUserStatistics);

// Product management (admin)
router.get('/admin/products', authenticate, authorize(['admin']), adminController.getAllProducts);
router.post('/admin/products/:productId/approve', authenticate, authorize(['admin']), adminController.approveProduct);
router.post('/admin/products/:productId/reject', authenticate, authorize(['admin']), adminController.rejectProduct);
router.post('/admin/products/:productId/feature', authenticate, authorize(['admin']), adminController.featureProduct);
router.get('/admin/products/statistics', authenticate, authorize(['admin']), adminController.getProductStatistics);

// Order management (admin)
router.get('/admin/orders', authenticate, authorize(['admin']), adminController.getAllOrders);
router.get('/admin/orders/:id', authenticate, authorize(['admin']), adminController.getOrderDetails);
router.put('/admin/orders/:id', authenticate, authorize(['admin']), adminController.updateOrder);
router.post('/admin/orders/:id/cancel', authenticate, authorize(['admin']), adminController.cancelOrder);
router.get('/admin/orders/statistics', authenticate, authorize(['admin']), adminController.getOrderStatistics);

// Vendor management (admin)
router.get('/admin/vendors', authenticate, authorize(['admin']), adminController.getAllVendors);
router.post('/admin/vendors/:vendorId/approve', authenticate, authorize(['admin']), adminController.approveVendor);
router.post('/admin/vendors/:vendorId/suspend', authenticate, authorize(['admin']), adminController.suspendVendor);
router.get('/admin/vendors/statistics', authenticate, authorize(['admin']), adminController.getVendorStatistics);

// Payment management (admin)
router.get('/admin/payments', authenticate, authorize(['admin']), adminController.getAllPayments);
router.get('/admin/payments/:id', authenticate, authorize(['admin']), adminController.getPaymentDetails);
router.post('/admin/payments/:paymentId/refund', authenticate, authorize(['admin']), adminController.processRefund);
router.get('/admin/payments/statistics', authenticate, authorize(['admin']), adminController.getPaymentStatistics);

// Category management (admin)
router.get('/admin/categories', authenticate, authorize(['admin']), adminController.getAllCategories);
router.post('/admin/categories', authenticate, authorize(['admin']), adminController.createCategory);
router.put('/admin/categories/:id', authenticate, authorize(['admin']), adminController.updateCategory);
router.delete('/admin/categories/:id', authenticate, authorize(['admin']), adminController.deleteCategory);
router.get('/admin/categories/statistics', authenticate, authorize(['admin']), adminController.getCategoryStatistics);

// Review management (admin)
router.get('/admin/reviews', authenticate, authorize(['admin']), adminController.getAllReviews);
router.post('/admin/reviews/:reviewId/approve', authenticate, authorize(['admin']), adminController.approveReview);
router.post('/admin/reviews/:reviewId/reject', authenticate, authorize(['admin']), adminController.rejectReview);
router.post('/admin/reviews/bulk-approve', authenticate, authorize(['admin']), adminController.bulkApproveReviews);
router.get('/admin/reviews/statistics', authenticate, authorize(['admin']), adminController.getReviewStatistics);

// System management (admin)
router.get('/admin/system/settings', authenticate, authorize(['admin']), adminController.getSystemSettings);
router.put('/admin/system/settings', authenticate, authorize(['admin']), adminController.updateSystemSettings);
router.get('/admin/system/maintenance', authenticate, authorize(['admin']), adminController.getMaintenanceMode);
router.post('/admin/system/maintenance', authenticate, authorize(['admin']), adminController.toggleMaintenanceMode);
router.get('/admin/system/performance', authenticate, authorize(['admin']), adminController.getSystemPerformance);
router.post('/admin/system/cache/clear', authenticate, authorize(['admin']), adminController.clearCache);
router.post('/admin/system/backup', authenticate, authorize(['admin']), adminController.createBackup);
router.get('/admin/system/backups', authenticate, authorize(['admin']), adminController.getBackupHistory);

// Security management (admin)
router.get('/admin/security/logs', authenticate, authorize(['admin']), adminController.getSecurityLogs);
router.get('/admin/security/failed-logins', authenticate, authorize(['admin']), adminController.getFailedLogins);
router.post('/admin/security/block-ip', authenticate, authorize(['admin']), adminController.blockIP);
router.delete('/admin/security/block-ip/:ip', authenticate, authorize(['admin']), adminController.unblockIP);
router.get('/admin/security/blocked-ips', authenticate, authorize(['admin']), adminController.getBlockedIPs);

// Notification management (admin)
router.get('/admin/notifications/settings', authenticate, authorize(['admin']), adminController.getNotificationSettings);
router.put('/admin/notifications/settings', authenticate, authorize(['admin']), adminController.updateNotificationSettings);
router.post('/admin/notifications/broadcast', authenticate, authorize(['admin']), adminController.sendBroadcastNotification);
router.get('/admin/notifications/history', authenticate, authorize(['admin']), adminController.getNotificationHistory);

// Analytics (admin)
router.get('/admin/analytics', authenticate, authorize(['admin']), adminController.getAnalytics);
router.get('/admin/analytics/users', authenticate, authorize(['admin']), adminController.getUserAnalytics);
router.get('/admin/analytics/products', authenticate, authorize(['admin']), adminController.getProductAnalytics);
router.get('/admin/analytics/orders', authenticate, authorize(['admin']), adminController.getOrderAnalytics);
router.get('/admin/analytics/payments', authenticate, authorize(['admin']), adminController.getPaymentAnalytics);
router.get('/admin/analytics/vendors', authenticate, authorize(['admin']), adminController.getVendorAnalytics);

// ================================
// CATEGORY ROUTES
// ================================

router.get('/categories', generalLimiter, adminController.getAllCategories);
router.get('/categories/tree', generalLimiter, adminController.getCategoryTree);

// ================================
// REVIEW ROUTES
// ================================

router.get('/reviews', generalLimiter, productController.getAllReviews);
router.get('/reviews/product/:productId', generalLimiter, productController.getProductReviews);

// ================================
// NOTIFICATION ROUTES
// ================================

router.get('/notifications', authenticate, notificationController.getNotifications);
router.post('/notifications/:id/read', authenticate, notificationController.markAsRead);
router.post('/notifications/mark-all-read', authenticate, notificationController.markAllAsRead);
router.delete('/notifications/:id', authenticate, notificationController.deleteNotification);

// ================================
// SEARCH ROUTES
// ================================

router.get('/search', generalLimiter, productController.searchProducts);
router.get('/search/suggestions', generalLimiter, productController.getSearchSuggestions);
router.get('/search/analytics', generalLimiter, productController.getSearchAnalytics);

// ================================
// UPLOAD ROUTES
// ================================

router.post('/upload/images', authenticate, upload.array('images', 10), fileController.uploadImages);
router.post('/upload/documents', authenticate, upload.single('document'), fileController.uploadDocument);
router.delete('/upload/:publicId', authenticate, fileController.deleteFile);

// ================================
// WEBHOOK ROUTES
// ================================

// Stripe webhooks (no authentication required)
router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), paymentController.handleStripeWebhook);

// Other webhook endpoints
router.post('/webhooks/paypal', webhookController.handlePayPalWebhook);
router.post('/webhooks/square', webhookController.handleSquareWebhook);

// ================================
// PUBLIC API ROUTES
// ================================

// API information
router.get('/', (req, res) => {
  res.status(200).json({
    name: 'Multi-Vendor E-commerce API',
    version: '1.0.0',
    description: 'Comprehensive e-commerce platform with multi-vendor support',
    documentation: '/api-docs',
    endpoints: {
      auth: '/api/auth/*',
      users: '/api/users/*',
      products: '/api/products/*',
      orders: '/api/orders/*',
      payments: '/api/payments/*',
      admin: '/api/admin/*',
      categories: '/api/categories/*',
      reviews: '/api/reviews/*',
      notifications: '/api/notifications/*',
      search: '/api/search/*',
      upload: '/api/upload/*',
      webhooks: '/api/webhooks/*'
    },
    features: [
      'Multi-Vendor Marketplace',
      'Real-time Notifications',
      'Advanced Analytics',
      'Payment Processing',
      'Order Management',
      'Product Catalog',
      'Review System',
      'Live Chat',
      'File Upload',
      'Admin Dashboard'
    ]
  });
});

// Health check
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// API documentation
router.get('/api-docs', (req, res) => {
  res.status(200).json({
    message: 'API Documentation',
    swagger: '/api-docs/swagger',
    postman: '/api-docs/postman',
    description: 'Complete API documentation with examples'
  });
});

// ================================
// ERROR HANDLING
// ================================

// Handle 404 routes
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    message: `Cannot ${req.method} ${req.originalUrl}`,
    availableRoutes: {
      auth: '/api/auth/*',
      users: '/api/users/*',
      products: '/api/products/*',
      orders: '/api/orders/*',
      payments: '/api/payments/*',
      admin: '/api/admin/*',
      categories: '/api/categories/*',
      reviews: '/api/reviews/*',
      notifications: '/api/notifications/*',
      search: '/api/search/*',
      upload: '/api/upload/*',
      webhooks: '/api/webhooks/*'
    }
  });
});

module.exports = router;
