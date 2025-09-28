const express = require('express');
const router = express.Router();

// Import controller
const {
  createPaymentIntent,
  confirmPayment,
  processRefund,
  getPaymentMethods,
  addPaymentMethod,
  removePaymentMethod,
  setDefaultPaymentMethod,
  createSetupIntent,
  getPaymentHistory,
  getPaymentAnalytics,
  handleStripeWebhook,
  getTransactionDetails
} = require('../controllers/paymentController');

// Import middleware
const { authenticate, requireVendorOrAdmin, requireAdmin } = require('../middleware/authMiddleware');

// Webhook route (public)
router.post('/webhook', handleStripeWebhook);

// Protected routes
router.use(authenticate);

// Payment method management
router.get('/payment-methods', getPaymentMethods);
router.post('/payment-methods', addPaymentMethod);
router.delete('/payment-methods/:paymentMethodId', removePaymentMethod);
router.put('/payment-methods/:paymentMethodId/default', setDefaultPaymentMethod);
router.post('/create-setup-intent', createSetupIntent);

// Payment processing
router.post('/create-payment-intent', createPaymentIntent);
router.post('/confirm-payment', confirmPayment);
router.post('/refund', requireVendorOrAdmin, processRefund);

// Payment history and analytics
router.get('/history', getPaymentHistory);
router.get('/transaction/:transactionId', getTransactionDetails);
router.get('/analytics', requireAdmin, getPaymentAnalytics);

module.exports = router;
