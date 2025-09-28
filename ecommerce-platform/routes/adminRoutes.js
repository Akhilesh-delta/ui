const express = require('express');
const router = express.Router();

// Import controller
const {
  getAdminDashboard,
  getUserManagement,
  getUserDetails,
  updateUserStatus,
  deleteUser,
  getOrderManagement,
  getOrderDetails,
  updateOrderStatus,
  getProductManagement,
  approveVendor,
  rejectVendor,
  getSystemAnalytics,
  getSystemSettings,
  updateSystemSettings,
  getReports,
  sendBulkNotification
} = require('../controllers/adminController');

// Import middleware
const { authenticate, requireAdmin } = require('../middleware/authMiddleware');

// All admin routes require admin authentication
router.use(authenticate);
router.use(requireAdmin);

// Dashboard
router.get('/dashboard', getAdminDashboard);

// User management
router.get('/users', getUserManagement);
router.get('/users/:userId', getUserDetails);
router.put('/users/:userId/status', updateUserStatus);
router.delete('/users/:userId', deleteUser);

// Order management
router.get('/orders', getOrderManagement);
router.get('/orders/:orderId', getOrderDetails);
router.put('/orders/:orderId/status', updateOrderStatus);

// Product management
router.get('/products', getProductManagement);

// Vendor management
router.put('/vendors/:vendorId/approve', approveVendor);
router.put('/vendors/:vendorId/reject', rejectVendor);

// Analytics
router.get('/analytics', getSystemAnalytics);

// System settings
router.get('/settings', getSystemSettings);
router.put('/settings', updateSystemSettings);

// Reports
router.get('/reports', getReports);

// Bulk operations
router.post('/notifications/bulk', sendBulkNotification);

module.exports = router;
