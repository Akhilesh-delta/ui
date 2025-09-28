const express = require('express');
const router = express.Router();

// Import controller
const {
  registerVendor,
  getVendorProfile,
  updateVendorProfile,
  submitVerificationDocuments,
  getVendorDashboard,
  getVendorProducts,
  getVendorOrders,
  updateOrderStatus,
  getVendorEarnings,
  requestWithdrawal,
  getVendorAnalytics,
  updateVendorSettings,
  getVendorReviews,
  respondToReview,
  getVendorNotifications,
  markNotificationAsRead
} = require('../controllers/vendorController');

// Import middleware
const { authenticate, requireVendorOrAdmin } = require('../middleware/authMiddleware');

// All vendor routes require authentication
router.use(authenticate);

// Public routes (for vendor profiles)
router.get('/:vendorId/profile', getVendorProfile);

// Protected routes (require vendor or admin)
router.post('/register', registerVendor);
router.get('/profile', getVendorProfile);
router.put('/profile', updateVendorProfile);
router.post('/verification-documents', requireVendorOrAdmin, submitVerificationDocuments);
router.get('/dashboard', getVendorDashboard);
router.get('/products', getVendorProducts);
router.get('/orders', getVendorOrders);
router.put('/orders/:orderId/status', updateOrderStatus);
router.get('/earnings', getVendorEarnings);
router.post('/withdrawals', requestWithdrawal);
router.get('/analytics', getVendorAnalytics);
router.put('/settings', updateVendorSettings);
router.get('/reviews', getVendorReviews);
router.post('/reviews/:reviewId/respond', respondToReview);
router.get('/notifications', getVendorNotifications);
router.put('/notifications/:notificationId/read', markNotificationAsRead);

module.exports = router;
