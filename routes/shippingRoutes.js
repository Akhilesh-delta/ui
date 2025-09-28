const express = require('express');
const router = express.Router();
const shippingController = require('../controllers/shippingController');
const { authenticate, authorize } = require('../middleware/auth');
const { body, param, query } = require('express-validator');

// ================================
// SHIPPING METHODS MANAGEMENT
// ================================

// Create shipping method
router.post('/methods', authenticate, authorize(['admin']), [
  body('name').trim().isLength({ min: 3, max: 100 }).withMessage('Name must be between 3 and 100 characters'),
  body('description').trim().isLength({ min: 10, max: 500 }).withMessage('Description must be between 10 and 500 characters'),
  body('carrier').isIn(['ups', 'fedex', 'usps', 'dhl', 'custom']).withMessage('Invalid carrier'),
  body('serviceLevel').isIn(['ground', 'express', 'overnight', '2_day', '3_day']).withMessage('Invalid service level'),
  body('rates').isArray({ min: 1 }).withMessage('Rates must be an array with at least one rate')
], shippingController.createShippingMethod);

// Get shipping methods
router.get('/methods', [
  query('type').optional().isIn(['standard', 'express', 'overnight', 'international']).withMessage('Invalid shipping type'),
  query('carrier').optional().isIn(['ups', 'fedex', 'usps', 'dhl', 'custom']).withMessage('Invalid carrier'),
  query('isActive').optional().isIn(['true', 'false']).withMessage('isActive must be true or false'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], shippingController.getShippingMethods);

// Get shipping method by ID
router.get('/methods/:id', [
  param('id').isMongoId().withMessage('Valid shipping method ID is required')
], shippingController.getShippingMethod);

// Get shipping method by name
router.get('/methods/name/:name', [
  param('name').notEmpty().withMessage('Shipping method name is required')
], shippingController.getShippingMethodByName);

// Update shipping method
router.put('/methods/:id', authenticate, authorize(['admin']), [
  param('id').isMongoId().withMessage('Valid shipping method ID is required'),
  body('name').optional().trim().isLength({ min: 3, max: 100 }).withMessage('Name must be between 3 and 100 characters'),
  body('description').optional().trim().isLength({ min: 10, max: 500 }).withMessage('Description must be between 10 and 500 characters')
], shippingController.updateShippingMethod);

// Delete shipping method
router.delete('/methods/:id', authenticate, authorize(['admin']), [
  param('id').isMongoId().withMessage('Valid shipping method ID is required')
], shippingController.deleteShippingMethod);

// ================================
// SHIPPING RATE CALCULATIONS
// ================================

// Calculate shipping rates
router.post('/calculate', [
  body('cartId').optional().isMongoId().withMessage('Valid cart ID is required'),
  body('shippingAddress').isObject().withMessage('Shipping address is required'),
  body('items').optional().isArray().withMessage('Items must be an array')
], shippingController.calculateShippingRates);

// ================================
// SHIPPING ZONES & REGIONS
// ================================

// Create shipping zone
router.post('/zones', authenticate, authorize(['admin']), [
  body('name').trim().isLength({ min: 3, max: 100 }).withMessage('Name must be between 3 and 100 characters'),
  body('countries').isArray({ min: 1 }).withMessage('Countries must be an array with at least one country'),
  body('rates').isArray({ min: 1 }).withMessage('Rates must be an array with at least one rate')
], shippingController.createShippingZone);

// Get shipping zones
router.get('/zones', [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], shippingController.getShippingZones);

// Get shipping zones by country
router.get('/zones/country/:country', [
  param('country').isLength({ min: 2, max: 2 }).withMessage('Country code must be 2 characters')
], shippingController.getShippingZonesByCountry);

// Update shipping zone
router.put('/zones/:id', authenticate, authorize(['admin']), [
  param('id').isMongoId().withMessage('Valid shipping zone ID is required'),
  body('name').optional().trim().isLength({ min: 3, max: 100 }).withMessage('Name must be between 3 and 100 characters')
], shippingController.updateShippingZone);

// ================================
// SHIPPING TRACKING
// ================================

// Track shipment
router.get('/track/:trackingNumber', [
  param('trackingNumber').notEmpty().withMessage('Tracking number is required')
], shippingController.trackShipment);

// Update shipment tracking
router.put('/orders/:orderId/track', authenticate, authorize(['vendor', 'admin']), [
  param('orderId').isMongoId().withMessage('Valid order ID is required'),
  body('trackingNumber').notEmpty().withMessage('Tracking number is required'),
  body('carrier').isIn(['ups', 'fedex', 'usps', 'dhl']).withMessage('Invalid carrier'),
  body('status').isIn(['pending', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned']).withMessage('Invalid status'),
  body('location').optional().isLength({ max: 200 }).withMessage('Location cannot exceed 200 characters')
], shippingController.updateShipmentTracking);

// Send tracking notification
router.post('/orders/:orderId/track-notify', authenticate, authorize(['vendor', 'admin']), [
  param('orderId').isMongoId().withMessage('Valid order ID is required')
], shippingController.sendTrackingNotification);

// ================================
// SHIPPING LABELS
// ================================

// Generate shipping label
router.post('/orders/:orderId/label', authenticate, authorize(['vendor', 'admin']), [
  param('orderId').isMongoId().withMessage('Valid order ID is required'),
  body('carrier').isIn(['ups', 'fedex', 'usps', 'dhl']).withMessage('Invalid carrier'),
  body('serviceLevel').isIn(['ground', 'express', 'overnight', '2_day', '3_day']).withMessage('Invalid service level')
], shippingController.generateShippingLabel);

// Get shipping label
router.get('/labels/:trackingNumber', [
  param('trackingNumber').notEmpty().withMessage('Tracking number is required')
], shippingController.getShippingLabel);

// ================================
// SHIPPING ANALYTICS
// ================================

// Get shipping analytics
router.get('/analytics', authenticate, authorize(['admin']), [
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days'),
  query('vendorId').optional().isMongoId().withMessage('Valid vendor ID is required')
], shippingController.getShippingAnalytics);

// ================================
// SHIPPING NOTIFICATIONS
// ================================

// Send shipping notification
router.post('/orders/:orderId/notify', authenticate, authorize(['vendor', 'admin']), [
  param('orderId').isMongoId().withMessage('Valid order ID is required'),
  body('type').isIn(['shipped', 'in_transit', 'out_for_delivery', 'delivered', 'delivery_attempted', 'exception', 'returned']).withMessage('Invalid notification type'),
  body('message').optional().isLength({ max: 500 }).withMessage('Message cannot exceed 500 characters')
], shippingController.sendShippingNotification);

// ================================
// SHIPPING CARRIERS
// ================================

// Get shipping carriers
router.get('/carriers', shippingController.getShippingCarriers);

// Add shipping carrier
router.post('/carriers', authenticate, authorize(['admin']), [
  body('name').trim().isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters'),
  body('apiKey').notEmpty().withMessage('API key is required'),
  body('apiSecret').notEmpty().withMessage('API secret is required'),
  body('isActive').optional().isIn(['true', 'false']).withMessage('isActive must be true or false')
], shippingController.addShippingCarrier);

// Update shipping carrier
router.put('/carriers/:carrierId', authenticate, authorize(['admin']), [
  param('carrierId').isMongoId().withMessage('Valid carrier ID is required'),
  body('name').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters')
], shippingController.updateShippingCarrier);

// ================================
// SHIPPING RESTRICTIONS
// ================================

// Create shipping restriction
router.post('/restrictions', authenticate, authorize(['admin']), [
  body('name').trim().isLength({ min: 3, max: 100 }).withMessage('Name must be between 3 and 100 characters'),
  body('type').isIn(['country', 'product', 'weight', 'value']).withMessage('Invalid restriction type'),
  body('countries').optional().isArray().withMessage('Countries must be an array'),
  body('products').optional().isArray().withMessage('Products must be an array')
], shippingController.createShippingRestriction);

// Get shipping restrictions
router.get('/restrictions', [
  query('type').optional().isIn(['country', 'product', 'weight', 'value']).withMessage('Invalid restriction type'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], shippingController.getShippingRestrictions);

// ================================
// SHIPPING INSURANCE
// ================================

// Calculate shipping insurance
router.post('/insurance/calculate', [
  body('orderValue').isFloat({ min: 0.01 }).withMessage('Order value must be at least 0.01'),
  body('shippingMethod').isIn(['standard', 'express', 'overnight']).withMessage('Invalid shipping method')
], shippingController.calculateShippingInsurance);

// Add shipping insurance
router.post('/orders/:orderId/insurance', authenticate, [
  param('orderId').isMongoId().withMessage('Valid order ID is required'),
  body('provider').isIn(['ship_insure', 'upsure', 'secure_ship']).withMessage('Invalid insurance provider'),
  body('coverageType').isIn(['basic', 'premium', 'complete']).withMessage('Invalid coverage type'),
  body('cost').isFloat({ min: 0.01 }).withMessage('Cost must be at least 0.01')
], shippingController.addShippingInsurance);

// ================================
// SHIPPING RETURNS
// ================================

// Create return shipping label
router.post('/orders/:orderId/return-label', authenticate, [
  param('orderId').isMongoId().withMessage('Valid order ID is required'),
  body('reason').isIn(['defective', 'wrong_item', 'not_as_described', 'changed_mind', 'duplicate', 'other']).withMessage('Invalid return reason'),
  body('items').isArray({ min: 1 }).withMessage('Items must be an array with at least one item')
], shippingController.createReturnShippingLabel);

// ================================
// MULTI-VENDOR SHIPPING
// ================================

// Get multi-vendor shipping options
router.get('/cart/:cartId/multi-vendor', [
  param('cartId').notEmpty().withMessage('Cart ID is required')
], shippingController.getMultiVendorShippingOptions);

// Optimize shipping costs
router.post('/cart/:cartId/optimize', [
  param('cartId').notEmpty().withMessage('Cart ID is required'),
  body('preferences.freeShippingThreshold').optional().isFloat({ min: 0 }).withMessage('Free shipping threshold must be positive')
], shippingController.optimizeShippingCosts);

// Compare shipping options
router.post('/cart/:cartId/compare', [
  param('cartId').notEmpty().withMessage('Cart ID is required'),
  body('address').isObject().withMessage('Address is required')
], shippingController.compareShippingOptions);

// ================================
// SHIPPING API INTEGRATIONS
// ================================

// Get shipping API status
router.get('/api/status', shippingController.getShippingAPIStatus);

// Handle shipping webhook
router.post('/webhook', shippingController.handleShippingWebhook);

// ================================
// SHIPPING REPORTS
// ================================

// Get shipping performance report
router.get('/reports/performance', authenticate, authorize(['admin']), [
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days'),
  query('format').optional().isIn(['json', 'csv']).withMessage('Format must be json or csv')
], shippingController.getShippingPerformanceReport);

// ================================
// SHIPPING CONFIGURATION
// ================================

// Get shipping configuration
router.get('/config', shippingController.getShippingConfiguration);

// Update shipping configuration
router.put('/admin/config', authenticate, authorize(['admin']), [
  body('defaultShippingMethod').optional().isIn(['standard', 'express', 'overnight']).withMessage('Invalid default shipping method'),
  body('freeShippingThreshold').optional().isFloat({ min: 0 }).withMessage('Free shipping threshold must be positive'),
  body('maxWeightPerPackage').optional().isFloat({ min: 0.1 }).withMessage('Max weight per package must be at least 0.1')
], shippingController.updateShippingConfiguration);

// ================================
// SHIPPING DASHBOARD
// ================================

// Get shipping dashboard
router.get('/dashboard', authenticate, authorize(['admin']), [
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], shippingController.getShippingDashboard);

// ================================
// SHIPPING BULK OPERATIONS
// ================================

// Bulk update shipping status
router.put('/admin/bulk/status', authenticate, authorize(['admin']), [
  body('orderIds').isArray({ min: 1 }).withMessage('Order IDs must be an array with at least one ID'),
  body('status').isIn(['pending', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned']).withMessage('Invalid status'),
  body('trackingNumbers').optional().isArray().withMessage('Tracking numbers must be an array')
], shippingController.bulkUpdateShippingStatus);

// Bulk generate shipping labels
router.post('/admin/bulk/labels', authenticate, authorize(['admin']), [
  body('orderIds').isArray({ min: 1 }).withMessage('Order IDs must be an array with at least one ID'),
  body('carrier').isIn(['ups', 'fedex', 'usps', 'dhl']).withMessage('Invalid carrier'),
  body('serviceLevel').isIn(['ground', 'express', 'overnight', '2_day', '3_day']).withMessage('Invalid service level')
], shippingController.bulkGenerateShippingLabels);

// ================================
// SHIPPING MAINTENANCE
// ================================

// Clean up old shipping data
router.post('/admin/cleanup', authenticate, authorize(['admin']), [
  query('daysOld').optional().isInt({ min: 1, max: 3650 }).withMessage('Days old must be between 1 and 3650')
], shippingController.cleanupShippingData);

// Optimize shipping performance
router.post('/admin/optimize', authenticate, authorize(['admin']), shippingController.optimizeShippingPerformance);

// ================================
// SHIPPING UTILITIES
// ================================

// Validate shipping address
router.post('/validate-address', [
  body('address').isObject().withMessage('Address is required')
], shippingController.validateShippingAddress);

// Estimate delivery date
router.post('/estimate-delivery', [
  body('shippingMethod').isIn(['standard', 'express', 'overnight']).withMessage('Invalid shipping method'),
  body('origin').isObject().withMessage('Origin address is required'),
  body('destination').isObject().withMessage('Destination address is required')
], shippingController.estimateDeliveryDate);

// Get shipping rates for product
router.get('/products/:productId/rates', [
  param('productId').isMongoId().withMessage('Valid product ID is required'),
  query('destination').notEmpty().withMessage('Destination is required'),
  query('quantity').optional().isInt({ min: 1, max: 100 }).withMessage('Quantity must be between 1 and 100')
], shippingController.getProductShippingRates);

// Get shipping cost breakdown
router.get('/orders/:orderId/cost-breakdown', [
  param('orderId').isMongoId().withMessage('Valid order ID is required')
], shippingController.getShippingCostBreakdown);

// Validate shipping method
router.get('/methods/:methodId/validate', [
  param('methodId').isMongoId().withMessage('Valid shipping method ID is required'),
  body('items').isArray({ min: 1 }).withMessage('Items must be an array with at least one item'),
  body('address').isObject().withMessage('Address is required')
], shippingController.validateShippingMethod);

// Get shipping statistics
router.get('/statistics', authenticate, authorize(['admin']), [
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], shippingController.getShippingStatistics);

// ================================
// SHIPPING EXPORT
// ================================

// Export shipping data
router.get('/export', authenticate, authorize(['admin']), [
  query('format').optional().isIn(['json', 'csv']).withMessage('Format must be json or csv'),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format')
], shippingController.exportShippingData);

module.exports = router;
