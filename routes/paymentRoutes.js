const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticate, authorize } = require('../middleware/auth');
const { body, param, query } = require('express-validator');

// ================================
// PAYMENT PROCESSING
// ================================

// Create payment intent
router.post('/payment-intent', authenticate, [
  body('orderId').isMongoId().withMessage('Valid order ID is required'),
  body('paymentMethod').isObject().withMessage('Payment method is required'),
  body('paymentMethod.type').isIn(['credit_card', 'debit_card', 'bank_transfer', 'paypal']).withMessage('Invalid payment method type'),
  body('returnUrl').optional().isURL().withMessage('Invalid return URL')
], paymentController.createPaymentIntent);

// Confirm payment
router.post('/confirm', authenticate, [
  body('paymentIntentId').notEmpty().withMessage('Payment intent ID is required')
], paymentController.confirmPayment);

// ================================
// PAYMENT METHODS MANAGEMENT
// ================================

// Add payment method
router.post('/methods', authenticate, [
  body('type').isIn(['credit_card', 'debit_card', 'bank_transfer']).withMessage('Invalid payment method type'),
  body('token').notEmpty().withMessage('Payment token is required'),
  body('billingAddress').optional().isObject().withMessage('Billing address must be an object')
], paymentController.addPaymentMethod);

// Get payment methods
router.get('/methods', authenticate, paymentController.getPaymentMethods);

// Update default payment method
router.put('/methods/:paymentMethodId/default', authenticate, [
  param('paymentMethodId').isMongoId().withMessage('Valid payment method ID is required')
], paymentController.updateDefaultPaymentMethod);

// Delete payment method
router.delete('/methods/:paymentMethodId', authenticate, [
  param('paymentMethodId').isMongoId().withMessage('Valid payment method ID is required')
], paymentController.deletePaymentMethod);

// ================================
// REFUND PROCESSING
// ================================

// Process refund
router.post('/:paymentId/refund', authenticate, authorize(['admin', 'customer']), [
  param('paymentId').isMongoId().withMessage('Valid payment ID is required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Refund amount must be at least 0.01'),
  body('reason').isIn(['duplicate', 'fraudulent', 'requested_by_customer', 'product_not_received', 'product_unacceptable', 'subscription_canceled', 'other']).withMessage('Invalid refund reason'),
  body('description').optional().isLength({ max: 500 }).withMessage('Description cannot exceed 500 characters')
], paymentController.processRefund);

// Get refund details
router.get('/:paymentId/refunds', authenticate, authorize(['admin', 'customer']), [
  param('paymentId').isMongoId().withMessage('Valid payment ID is required')
], paymentController.getRefundDetails);

// ================================
// DISPUTE MANAGEMENT
// ================================

// Create dispute
router.post('/:paymentId/dispute', authenticate, authorize(['admin', 'customer']), [
  param('paymentId').isMongoId().withMessage('Valid payment ID is required'),
  body('reason').isIn(['credit_not_processed', 'duplicate', 'fraudulent', 'general', 'incorrect_account_details', 'insufficient_funds', 'product_not_received', 'product_unacceptable', 'subscription_canceled', 'unrecognized']).withMessage('Invalid dispute reason'),
  body('description').isLength({ min: 10, max: 1000 }).withMessage('Description must be between 10 and 1000 characters'),
  body('evidence').optional().isArray().withMessage('Evidence must be an array')
], paymentController.createDispute);

// Get dispute details
router.get('/:paymentId/disputes', authenticate, authorize(['admin', 'customer']), [
  param('paymentId').isMongoId().withMessage('Valid payment ID is required')
], paymentController.getDisputeDetails);

// ================================
// PAYOUT MANAGEMENT
// ================================

// Process payouts (admin/vendor)
router.post('/payouts/:vendorId', authenticate, authorize(['admin', 'vendor']), [
  param('vendorId').isMongoId().withMessage('Valid vendor ID is required'),
  body('amount').isFloat({ min: 1 }).withMessage('Payout amount must be at least 1'),
  body('method').optional().isIn(['bank_transfer', 'paypal', 'check']).withMessage('Invalid payout method')
], paymentController.processPayouts);

// Get payout history
router.get('/payouts/:vendorId/history', authenticate, authorize(['admin', 'vendor']), [
  param('vendorId').isMongoId().withMessage('Valid vendor ID is required'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], paymentController.getPayoutHistory);

// ================================
// SUBSCRIPTION MANAGEMENT
// ================================

// Create subscription
router.post('/subscription', authenticate, [
  body('planId').notEmpty().withMessage('Plan ID is required'),
  body('paymentMethodId').isMongoId().withMessage('Valid payment method ID is required')
], paymentController.createSubscription);

// Cancel subscription
router.post('/subscription/cancel', authenticate, [
  body('cancelAtPeriodEnd').optional().isIn(['true', 'false']).withMessage('cancelAtPeriodEnd must be true or false')
], paymentController.cancelSubscription);

// ================================
// PAYMENT ANALYTICS
// ================================

// Get payment analytics
router.get('/analytics', authenticate, authorize(['admin']), [
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days')
], paymentController.getPaymentAnalytics);

// ================================
// WEBHOOK HANDLING
// ================================

// Handle Stripe webhook
router.post('/webhook', paymentController.handleStripeWebhook);

// ================================
// ADMIN PAYMENT MANAGEMENT
// ================================

// Get all payments (admin)
router.get('/admin/payments', authenticate, authorize(['admin']), [
  query('status').optional().isIn(['pending', 'completed', 'failed', 'refunded', 'disputed']).withMessage('Invalid payment status'),
  query('user').optional().isMongoId().withMessage('Valid user ID is required'),
  query('paymentMethod').optional().isIn(['credit_card', 'debit_card', 'bank_transfer', 'paypal', 'cash_on_delivery']).withMessage('Invalid payment method'),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format'),
  query('minAmount').optional().isFloat({ min: 0 }).withMessage('Minimum amount must be a positive number'),
  query('maxAmount').optional().isFloat({ min: 0 }).withMessage('Maximum amount must be a positive number'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], paymentController.getAllPayments);

// Get payment by ID (admin)
router.get('/admin/payments/:id', authenticate, authorize(['admin']), [
  param('id').isMongoId().withMessage('Valid payment ID is required')
], paymentController.getPaymentById);

// Update payment (admin)
router.put('/admin/payments/:id', authenticate, authorize(['admin']), [
  param('id').isMongoId().withMessage('Valid payment ID is required'),
  body('status').optional().isIn(['pending', 'completed', 'failed', 'refunded', 'disputed']).withMessage('Invalid payment status'),
  body('notes').optional().isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters')
], paymentController.updatePayment);

// Get high-risk payments (admin)
router.get('/admin/payments/high-risk', authenticate, authorize(['admin']), paymentController.getHighRiskPayments);

// Review payment risk (admin)
router.post('/admin/payments/:paymentId/review', authenticate, authorize(['admin']), [
  param('paymentId').isMongoId().withMessage('Valid payment ID is required'),
  body('action').isIn(['approve', 'reject', 'flag', 'escalate']).withMessage('Invalid action'),
  body('notes').optional().isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters')
], paymentController.reviewPaymentRisk);

// ================================
// PAYMENT UTILITIES
// ================================

// Calculate fees
router.post('/calculate-fees', [
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be at least 0.01'),
  body('paymentMethod').isIn(['credit_card', 'debit_card', 'bank_transfer', 'paypal']).withMessage('Invalid payment method'),
  body('currency').optional().isIn(['USD', 'EUR', 'GBP', 'CAD', 'AUD']).withMessage('Invalid currency')
], paymentController.calculateFees);

// Get supported payment methods
router.get('/methods/supported', paymentController.getSupportedPaymentMethods);

// Get exchange rates
router.get('/exchange-rates', paymentController.getExchangeRates);

// Convert currency
router.post('/convert-currency', [
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be at least 0.01'),
  body('from').isIn(['USD', 'EUR', 'GBP', 'CAD', 'AUD']).withMessage('Invalid source currency'),
  body('to').isIn(['USD', 'EUR', 'GBP', 'CAD', 'AUD']).withMessage('Invalid target currency')
], paymentController.convertCurrency);

// ================================
// DIGITAL WALLET INTEGRATION
// ================================

// Connect digital wallet
router.post('/wallet/connect', authenticate, [
  body('walletType').isIn(['google_pay', 'apple_pay', 'samsung_pay', 'paypal']).withMessage('Invalid wallet type'),
  body('walletId').notEmpty().withMessage('Wallet ID is required')
], paymentController.connectDigitalWallet);

// Process wallet payment
router.post('/wallet/pay', authenticate, [
  body('orderId').isMongoId().withMessage('Valid order ID is required'),
  body('walletType').isIn(['google_pay', 'apple_pay', 'samsung_pay', 'paypal']).withMessage('Invalid wallet type')
], paymentController.processWalletPayment);

// ================================
// CRYPTOCURRENCY PAYMENTS
// ================================

// Get crypto payment address
router.post('/crypto/address', authenticate, [
  body('orderId').isMongoId().withMessage('Valid order ID is required'),
  body('currency').optional().isIn(['BTC', 'ETH', 'LTC', 'BCH']).withMessage('Invalid cryptocurrency')
], paymentController.getCryptoPaymentAddress);

// Check crypto payment status
router.get('/crypto/:paymentId/status', [
  param('paymentId').notEmpty().withMessage('Payment ID is required')
], paymentController.checkCryptoPaymentStatus);

// ================================
// BUY NOW PAY LATER
// ================================

// Create BNPL application
router.post('/bnpl/application', authenticate, [
  body('orderId').isMongoId().withMessage('Valid order ID is required'),
  body('provider').isIn(['affirm', 'afterpay', 'klarna', 'sezzle']).withMessage('Invalid BNPL provider'),
  body('installmentPlan').isIn(['4_payments', 'monthly', 'biweekly']).withMessage('Invalid installment plan')
], paymentController.createBNPLApplication);

// Process BNPL payment
router.post('/bnpl/:applicationId/process', authenticate, [
  param('applicationId').isMongoId().withMessage('Valid application ID is required')
], paymentController.processBNPLPayment);

// ================================
// TAX CALCULATION
// ================================

// Calculate tax
router.post('/tax/calculate', [
  body('amount').isFloat({ min: 0 }).withMessage('Amount must be a positive number'),
  body('shippingAddress').isObject().withMessage('Shipping address is required'),
  body('shippingAddress.country').notEmpty().withMessage('Country is required'),
  body('products').isArray({ min: 1 }).withMessage('Products array is required')
], paymentController.calculateTax);

// ================================
// PAYMENT SECURITY
// ================================

// Validate payment security
router.get('/:paymentId/security', authenticate, authorize(['admin']), [
  param('paymentId').isMongoId().withMessage('Valid payment ID is required')
], paymentController.validatePaymentSecurity);

// Block suspicious payment
router.post('/:paymentId/block', authenticate, authorize(['admin']), [
  param('paymentId').isMongoId().withMessage('Valid payment ID is required'),
  body('reason').notEmpty().withMessage('Block reason is required')
], paymentController.blockSuspiciousPayment);

// ================================
// PAYMENT REPORTING
// ================================

// Generate payment report
router.get('/report', authenticate, authorize(['admin']), [
  query('dateRange').optional().isInt({ min: 1, max: 365 }).withMessage('Date range must be between 1 and 365 days'),
  query('format').optional().isIn(['json', 'csv']).withMessage('Format must be json or csv')
], paymentController.generatePaymentReport);

// Export payments
router.get('/export', authenticate, authorize(['admin']), [
  query('format').optional().isIn(['csv', 'excel']).withMessage('Format must be csv or excel'),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format')
], paymentController.exportPayments);

// Get payment reconciliation
router.get('/reconciliation', authenticate, authorize(['admin']), [
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format')
], paymentController.getPaymentReconciliation);

// ================================
// INSTALLMENT PAYMENTS
// ================================

// Create installment plan
router.post('/installment', authenticate, [
  body('orderId').isMongoId().withMessage('Valid order ID is required'),
  body('installments').isInt({ min: 2, max: 12 }).withMessage('Installments must be between 2 and 12')
], paymentController.createInstallmentPlan);

// Process installment payment
router.post('/installment/:paymentId/:installmentNumber', authenticate, [
  param('paymentId').isMongoId().withMessage('Valid payment ID is required'),
  param('installmentNumber').isInt({ min: 1, max: 12 }).withMessage('Installment number must be between 1 and 12')
], paymentController.processInstallmentPayment);

// ================================
// GIFT CARD & STORE CREDIT
// ================================

// Apply gift card
router.post('/gift-card/apply', authenticate, [
  body('orderId').isMongoId().withMessage('Valid order ID is required'),
  body('giftCardNumber').notEmpty().withMessage('Gift card number is required'),
  body('giftCardPin').optional().isLength({ min: 4, max: 8 }).withMessage('Gift card PIN must be between 4 and 8 characters')
], paymentController.applyGiftCard);

// Apply store credit
router.post('/store-credit/apply', authenticate, [
  body('orderId').isMongoId().withMessage('Valid order ID is required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be at least 0.01')
], paymentController.applyStoreCredit);

// ================================
// PAYMENT SETTINGS
// ================================

// Get payment settings
router.get('/settings', paymentController.getPaymentSettings);

// Update payment settings (admin)
router.put('/admin/settings', authenticate, authorize(['admin']), [
  body('settings').isObject().withMessage('Settings must be an object')
], paymentController.updatePaymentSettings);

module.exports = router;
