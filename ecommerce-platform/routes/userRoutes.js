const express = require('express');
const router = express.Router();

// Import controller
const {
  registerUser,
  loginUser,
  getUserProfile,
  updateUserProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  addAddress,
  updateAddress,
  deleteAddress,
  addToWishlist,
  removeFromWishlist,
  getWishlist,
  addRecentlyViewed,
  getRecentlyViewed,
  logoutUser,
  refreshToken,
  getUserStatistics
} = require('../controllers/userController');

// Import middleware
const { authenticate, optionalAuth, requireOwnership } = require('../middleware/authMiddleware');

// Public routes
router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/forgot-password', forgotPassword);
router.put('/reset-password/:token', resetPassword);
router.get('/verify-email/:token', verifyEmail);
router.post('/resend-verification', resendVerification);
router.post('/refresh-token', refreshToken);

// Protected routes (require authentication)
router.use(authenticate); // All routes below require authentication

// Profile management
router.get('/profile', getUserProfile);
router.put('/profile', updateUserProfile);
router.put('/change-password', changePassword);
router.post('/logout', logoutUser);

// Address management
router.post('/addresses', addAddress);
router.put('/addresses/:addressId', updateAddress);
router.delete('/addresses/:addressId', deleteAddress);

// Wishlist management
router.post('/wishlist', addToWishlist);
router.delete('/wishlist/:productId', removeFromWishlist);
router.get('/wishlist', getWishlist);

// Recently viewed products
router.post('/recently-viewed', addRecentlyViewed);
router.get('/recently-viewed', getRecentlyViewed);

// User statistics
router.get('/statistics', getUserStatistics);

module.exports = router;
