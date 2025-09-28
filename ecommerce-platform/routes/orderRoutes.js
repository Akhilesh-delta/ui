const express = require('express');
const router = express.Router();

// Import controller
const {
  createOrder,
  getUserOrders,
  getOrder,
  cancelOrder,
  requestOrderReturn,
  trackOrder,
  getOrderInvoice,
  reorderItems
} = require('../controllers/orderController');

// Import middleware
const { authenticate } = require('../middleware/authMiddleware');

// All order routes require authentication
router.use(authenticate);

// Order routes
router.post('/', createOrder);
router.get('/', getUserOrders);
router.get('/:id', getOrder);
router.put('/:id/cancel', cancelOrder);
router.post('/:id/return', requestOrderReturn);
router.get('/:id/track', trackOrder);
router.get('/:id/invoice', getOrderInvoice);
router.post('/:id/reorder', reorderItems);

module.exports = router;
