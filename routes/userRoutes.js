const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticate, authorize } = require('../middleware/auth');
const { body, param } = require('express-validator');
const upload = require('../middleware/upload');

// ================================
// AUTHENTICATION & REGISTRATION
// ================================

// Register new user
router.post('/register', [
  body('firstName').trim().isLength({ min: 2, max: 50 }).withMessage('First name must be between 2 and 50 characters'),
  body('lastName').trim().isLength({ min: 2, max: 50 }).withMessage('Last name must be between 2 and 50 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long'),
  body('phone').optional().isMobilePhone().withMessage('Valid phone number is required'),
  body('role').optional().isIn(['customer', 'vendor']).withMessage('Role must be customer or vendor')
], userController.register);

// Login user
router.post('/login', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
], userController.login);

// Logout user
router.post('/logout', authenticate, userController.logout);

// Refresh access token
router.post('/refresh-token', userController.refreshToken);

// Forgot password
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required')
], userController.forgotPassword);

// Reset password
router.post('/reset-password', [
  body('token').notEmpty().withMessage('Reset token is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long')
], userController.resetPassword);

// Change password
router.post('/change-password', authenticate, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters long')
], userController.changePassword);

// ================================
// TWO-FACTOR AUTHENTICATION
// ================================

// Enable 2FA
router.post('/2fa/enable', authenticate, userController.enableTwoFactor);

// Verify and enable 2FA
router.post('/2fa/verify', authenticate, [
  body('token').notEmpty().withMessage('Verification token is required')
], userController.verifyTwoFactor);

// Disable 2FA
router.post('/2fa/disable', authenticate, [
  body('password').notEmpty().withMessage('Password is required'),
  body('token').optional().notEmpty().withMessage('2FA token is required if 2FA is enabled')
], userController.disableTwoFactor);

// ================================
// USER PROFILE MANAGEMENT
// ================================

// Get user profile
router.get('/profile', authenticate, userController.getProfile);

// Update user profile
router.put('/profile', authenticate, [
  body('firstName').optional().trim().isLength({ min: 2, max: 50 }).withMessage('First name must be between 2 and 50 characters'),
  body('lastName').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Last name must be between 2 and 50 characters'),
  body('phone').optional().isMobilePhone().withMessage('Valid phone number is required'),
  body('bio').optional().isLength({ max: 500 }).withMessage('Bio cannot exceed 500 characters')
], userController.updateProfile);

// Update user avatar
router.put('/profile/avatar', authenticate, upload.single('avatar'), userController.updateAvatar);

// Delete user account
router.delete('/profile', authenticate, [
  body('password').notEmpty().withMessage('Password is required'),
  body('reason').optional().isLength({ max: 500 }).withMessage('Reason cannot exceed 500 characters')
], userController.deleteAccount);

// ================================
// EMAIL & PHONE VERIFICATION
// ================================

// Send email verification
router.post('/verify-email/send', authenticate, userController.sendEmailVerification);

// Verify email
router.get('/verify-email/:token', [
  param('token').notEmpty().withMessage('Verification token is required')
], userController.verifyEmail);

// Send phone verification
router.post('/verify-phone/send', authenticate, userController.sendPhoneVerification);

// Verify phone
router.post('/verify-phone', authenticate, [
  body('token').notEmpty().withMessage('Verification token is required')
], userController.verifyPhone);

// ================================
// USER PREFERENCES
// ================================

// Get user preferences
router.get('/preferences', authenticate, userController.getPreferences);

// Update notification preferences
router.put('/preferences/notifications', authenticate, [
  body('notifications').isObject().withMessage('Notifications must be an object')
], userController.updateNotificationPreferences);

// Update privacy preferences
router.put('/preferences/privacy', authenticate, [
  body('privacy').isObject().withMessage('Privacy settings must be an object')
], userController.updatePrivacyPreferences);

// Update shopping preferences
router.put('/preferences/shopping', authenticate, [
  body('shopping').isObject().withMessage('Shopping settings must be an object')
], userController.updateShoppingPreferences);

// ================================
// VENDOR MANAGEMENT
// ================================

// Become a vendor
router.post('/become-vendor', authenticate, [
  body('storeName').trim().isLength({ min: 3, max: 100 }).withMessage('Store name must be between 3 and 100 characters'),
  body('storeDescription').trim().isLength({ min: 10, max: 1000 }).withMessage('Store description must be between 10 and 1000 characters'),
  body('businessType').isIn(['individual', 'business', 'nonprofit']).withMessage('Invalid business type'),
  body('businessRegistration').optional().isLength({ max: 100 }).withMessage('Business registration cannot exceed 100 characters'),
  body('taxId').optional().isLength({ max: 50 }).withMessage('Tax ID cannot exceed 50 characters'),
  body('bankAccount').isObject().withMessage('Bank account information is required')
], userController.becomeVendor);

// Get vendor dashboard
router.get('/vendor/dashboard', authenticate, authorize(['vendor']), userController.getVendorDashboard);

// Update vendor profile
router.put('/vendor/profile', authenticate, authorize(['vendor']), [
  body('storeName').optional().trim().isLength({ min: 3, max: 100 }).withMessage('Store name must be between 3 and 100 characters'),
  body('storeDescription').optional().trim().isLength({ min: 10, max: 1000 }).withMessage('Store description must be between 10 and 1000 characters'),
  body('businessType').optional().isIn(['individual', 'business', 'nonprofit']).withMessage('Invalid business type')
], userController.updateVendorProfile);

// ================================
// ADMIN FUNCTIONS
// ================================

// Get all users (admin only)
router.get('/admin/users', authenticate, authorize(['admin']), [
  // Query validation
], userController.getAllUsers);

// Get user by ID (admin only)
router.get('/admin/users/:id', authenticate, authorize(['admin']), [
  param('id').isMongoId().withMessage('Valid user ID is required')
], userController.getUserById);

// Update user (admin only)
router.put('/admin/users/:id', authenticate, authorize(['admin']), [
  param('id').isMongoId().withMessage('Valid user ID is required'),
  body('firstName').optional().trim().isLength({ min: 2, max: 50 }).withMessage('First name must be between 2 and 50 characters'),
  body('lastName').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Last name must be between 2 and 50 characters'),
  body('email').optional().isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('role').optional().isIn(['customer', 'vendor', 'admin']).withMessage('Invalid role'),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean')
], userController.updateUser);

// Delete user (admin only)
router.delete('/admin/users/:id', authenticate, authorize(['admin']), [
  param('id').isMongoId().withMessage('Valid user ID is required'),
  body('reason').optional().isLength({ max: 500 }).withMessage('Reason cannot exceed 500 characters')
], userController.deleteUser);

// Suspend user (admin only)
router.post('/admin/users/:id/suspend', authenticate, authorize(['admin']), [
  param('id').isMongoId().withMessage('Valid user ID is required'),
  body('reason').notEmpty().withMessage('Suspension reason is required'),
  body('duration').optional().isInt({ min: 1, max: 8760 }).withMessage('Duration must be between 1 and 8760 hours')
], userController.suspendUser);

// Activate user (admin only)
router.post('/admin/users/:id/activate', authenticate, authorize(['admin']), [
  param('id').isMongoId().withMessage('Valid user ID is required')
], userController.activateUser);

// Get user statistics (admin only)
router.get('/admin/users/stats', authenticate, authorize(['admin']), userController.getUserStats);

module.exports = router;
