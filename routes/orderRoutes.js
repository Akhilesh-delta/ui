const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { authenticate, authorize } = require('../middleware/auth');
const { body, param, query } = require('express-validator');

// ================================
// ORDER CREATION & MANAGEMENT
// ================================

// Create new order
router.post('/', authenticate, [
  body('items').isArray({ min: 1 }).withMessage('Order items are required'),
  body('items.*.productId').isMongoId().withMessage('Valid product ID is required'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('shipping.address').isObject().withMessage('Shipping address is required'),
  body('billing').optional().isObject().withMessage('Billing information must be an object')
], orderController.createOrder);

// Get user orders
router.get('/user', authenticate, [
  query('status').optional().isIn(['pending', 'payment_confirmed', 'processing', 'ready', 'shipped', 'delivered', 'cancelled']).withMessage('Invalid status'),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format'),
  query('sortBy').optional().isIn(['date', 'amount', 'status']).withMessage('Invalid sort field'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], orderController.getUserOrders);

// Get order by ID
router.get('/:id', authenticate, [
  param('id').isMongoId().withMessage('Valid order ID is required')
], orderController.getOrder);

// Get order by order number
router.get('/number/:orderNumber', [
  param('orderNumber').notEmpty().withMessage('Order number is required')
], orderController.getOrderByNumber);

// Cancel order
router.post('/:id/cancel', authenticate, [
  param('id').isMongoId().withMessage('Valid order ID is required'),
  body('reason').optional().isLength({ max: 500 }).withMessage('Reason cannot exceed 500 characters')
], orderController.cancelOrder);

// Update order status (admin/vendor)
router.put('/:id/status', authenticate, authorize(['admin', 'vendor']), [
  param('id').isMongoId().withMessage('Valid order ID is required'),
  body('status').isIn(['pending', 'payment_confirmed', 'processing', 'ready', 'shipped', 'out_for_delivery', 'delivered', 'completed', 'cancelled']).withMessage('Invalid status'),
  body('notes').optional().isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters'),
  body('trackingNumber').optional().isLength({ max: 100 }).withMessage('Tracking number cannot exceed 100 characters'),
  body('trackingUrl').optional().isURL().withMessage('Invalid tracking URL'),
  body('carrier').optional().isLength({ max: 50 }).withMessage('Carrier name cannot exceed 50 characters')
], orderController.updateOrderStatus);

// Confirm payment
router.post('/:orderId/payment/confirm', authenticate, [
  param('orderId').isMongoId().withMessage('Valid order ID is required'),
  body('paymentMethod').isIn(['credit_card', 'debit_card', 'bank_transfer', 'paypal', 'cash_on_delivery']).withMessage('Invalid payment method'),
  body('paymentData').optional().isObject().withMessage('Payment data must be an object')
], orderController.confirmPayment);

// Mark order as shipped
router.post('/:orderId/ship', authenticate, authorize(['admin', 'vendor']), [
  param('orderId').isMongoId().withMessage('Valid order ID is required'),
  body('trackingNumber').optional().isLength({ max: 100 }).withMessage('Tracking number cannot exceed 100 characters'),
  body('trackingUrl').optional().isURL().withMessage('Invalid tracking URL'),
  body('carrier').optional().isLength({ max: 50 }).withMessage('Carrier name cannot exceed 50 characters'),
  body('notes').optional().isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters')
], orderController.markAsShipped);

// Mark order as delivered
router.post('/:orderId/deliver', authenticate, authorize(['admin', 'vendor']), [
  param('orderId').isMongoId().withMessage('Valid order ID is required'),
  body('notes').optional().isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters')
], orderController.markAsDelivered);

// Request return
router.post('/:orderId/return', authenticate, [
  param('orderId').isMongoId().withMessage('Valid order ID is required'),
  body('items').isArray({ min: 1 }).withMessage('Return items are required'),
  body('reason').isIn(['defective', 'wrong_item', 'not_as_described', 'changed_mind', 'duplicate', 'other']).withMessage('Invalid return reason'),
  body('description').optional().isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters')
], orderController.requestReturn);

// Process return (vendor/admin)
router.put('/:orderId/return/:returnId', authenticate, authorize(['admin', 'vendor']), [
  param('orderId').isMongoId().withMessage('Valid order ID is required'),
  param('returnId').isMongoId().withMessage('Valid return ID is required'),
  body('action').isIn(['approve', 'reject', 'mark_received', 'refund']).withMessage('Invalid action'),
  body('notes').optional().isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters')
], orderController.processReturn);

// ================================
// VENDOR ORDER MANAGEMENT
// ================================

// Get vendor orders
router.get('/vendor', authenticate, authorize(['vendor']), [
  query('status').optional().isIn(['pending', 'processing', 'ready', 'shipped', 'delivered', 'cancelled']).withMessage('Invalid status'),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format'),
  query('sortBy').optional().isIn(['orderedAt', 'totalAmount', 'status']).withMessage('Invalid sort field'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], orderController.getVendorOrders);

// Update vendor order status
router.put('/vendor/:orderId/status', authenticate, authorize(['vendor']), [
  param('orderId').isMongoId().withMessage('Valid order ID is required'),
  body('status').isIn(['processing', 'ready', 'shipped', 'delivered']).withMessage('Invalid status'),
  body('notes').optional().isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters')
], orderController.updateVendorOrderStatus);

// ================================
// ADMIN ORDER MANAGEMENT
// ================================

// Get all orders (admin)
router.get('/admin', authenticate, authorize(['admin']), [
  query('status').optional().isIn(['pending', 'payment_confirmed', 'processing', 'ready', 'shipped', 'delivered', 'cancelled']).withMessage('Invalid status'),
  query('user').optional().isMongoId().withMessage('Valid user ID is required'),
  query('vendor').optional().isMongoId().withMessage('Valid vendor ID is required'),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format'),
  query('sortBy').optional().isIn(['date', 'amount', 'customer']).withMessage('Invalid sort field'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], orderController.getAllOrders);

// Bulk update orders (admin)
router.put('/admin/bulk', authenticate, authorize(['admin']), [
  body('orderIds').isArray({ min: 1 }).withMessage('Order IDs must be an array with at least one ID'),
  body('updates').isObject().withMessage('Updates must be an object')
], orderController.bulkUpdateOrders);

// ================================
// ORDER COMMUNICATIONS
// ================================

// Send order message
router.post('/:orderId/message', authenticate, [
  param('orderId').isMongoId().withMessage('Valid order ID is required'),
  body('message').trim().isLength({ min: 1, max: 1000 }).withMessage('Message must be between 1 and 1000 characters'),
  body('type').optional().isIn(['customer', 'vendor', 'internal']).withMessage('Invalid message type')
], orderController.sendOrderMessage);

// ================================
// ORDER SEARCH & FILTERING
// ================================

// Search orders
router.get('/search', authenticate, [
  query('q').notEmpty().withMessage('Search term is required'),
  query('status').optional().isIn(['pending', 'payment_confirmed', 'processing', 'ready', 'shipped', 'delivered', 'cancelled']).withMessage('Invalid status'),
  query('user').optional().isMongoId().withMessage('Valid user ID is required'),
  query('vendor').optional().isMongoId().withMessage('Valid vendor ID is required'),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format'),
  query('minAmount').optional().isFloat({ min: 0 }).withMessage('Minimum amount must be a positive number'),
  query('maxAmount').optional().isFloat({ min: 0 }).withMessage('Maximum amount must be a positive number'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], orderController.searchOrders);

// Get pending orders
router.get('/pending', authenticate, authorize(['admin', 'vendor']), orderController.getPendingOrders);

// Get overdue orders
router.get('/overdue', authenticate, authorize(['admin', 'vendor']), orderController.getOverdueOrders);

// ================================
// ORDER ANALYTICS & REPORTING
// ================================

// Get order analytics (user)
router.get('/analytics', authenticate, [
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], orderController.getOrderAnalytics);

// Generate invoice
router.get('/:orderId/invoice', authenticate, [
  param('orderId').isMongoId().withMessage('Valid order ID is required')
], orderController.generateInvoice);

// Track order
router.get('/track/:orderNumber', [
  param('orderNumber').notEmpty().withMessage('Order number is required')
], orderController.trackOrder);

// Get order timeline
router.get('/:orderId/timeline', authenticate, [
  param('orderId').isMongoId().withMessage('Valid order ID is required')
], orderController.getOrderTimeline);

// Add order note
router.post('/:orderId/note', authenticate, authorize(['admin']), [
  param('orderId').isMongoId().withMessage('Valid order ID is required'),
  body('note').trim().isLength({ min: 1, max: 1000 }).withMessage('Note must be between 1 and 1000 characters'),
  body('type').optional().isIn(['internal', 'customer', 'vendor']).withMessage('Invalid note type')
], orderController.addOrderNote);

// Get order statistics
router.get('/statistics', authenticate, authorize(['admin']), [
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], orderController.getOrderStatistics);

// Export orders
router.get('/export', authenticate, authorize(['admin']), [
  query('format').optional().isIn(['csv', 'excel']).withMessage('Format must be csv or excel'),
  query('status').optional().isIn(['pending', 'payment_confirmed', 'processing', 'ready', 'shipped', 'delivered', 'cancelled']).withMessage('Invalid status'),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format'),
  query('vendor').optional().isMongoId().withMessage('Valid vendor ID is required')
], orderController.exportOrders);

module.exports = router;
