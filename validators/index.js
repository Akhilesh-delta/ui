const { body } = require('express-validator');

// Authentication validators
const registerValidator = [
  body('firstName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('First name can only contain letters and spaces'),

  body('lastName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Last name can only contain letters and spaces'),

  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail()
    .isLength({ max: 100 })
    .withMessage('Email cannot exceed 100 characters'),

  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character'),

  body('phone')
    .optional()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),

  body('dateOfBirth')
    .optional()
    .isISO8601()
    .withMessage('Please provide a valid date of birth')
    .custom((value) => {
      const birthDate = new Date(value);
      const today = new Date();
      const age = today.getFullYear() - birthDate.getFullYear();
      if (age < 13) {
        throw new Error('You must be at least 13 years old');
      }
      return true;
    }),

  body('gender')
    .optional()
    .isIn(['male', 'female', 'other', 'prefer-not-to-say'])
    .withMessage('Please provide a valid gender'),

  body('role')
    .optional()
    .isIn(['customer', 'vendor'])
    .withMessage('Role must be either customer or vendor'),

  body('referralCode')
    .optional()
    .isLength({ min: 8, max: 8 })
    .withMessage('Referral code must be 8 characters')
    .matches(/^[A-Z0-9]+$/)
    .withMessage('Referral code can only contain uppercase letters and numbers')
];

const loginValidator = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),

  body('password')
    .notEmpty()
    .withMessage('Password is required')
];

const forgotPasswordValidator = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail()
];

const resetPasswordValidator = [
  body('token')
    .notEmpty()
    .withMessage('Reset token is required')
    .isLength({ min: 64, max: 64 })
    .withMessage('Invalid reset token format'),

  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character')
];

const changePasswordValidator = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),

  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character'),

  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Passwords do not match');
      }
      return true;
    })
];

// Profile validators
const updateProfileValidator = [
  body('firstName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),

  body('lastName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),

  body('phone')
    .optional()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),

  body('bio')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Bio cannot exceed 500 characters'),

  body('website')
    .optional()
    .isURL()
    .withMessage('Please provide a valid website URL'),

  body('timezone')
    .optional()
    .isIn(['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney'])
    .withMessage('Please provide a valid timezone'),

  body('language')
    .optional()
    .isIn(['en', 'es', 'fr', 'de', 'zh', 'ja', 'ar', 'pt', 'ru', 'hi'])
    .withMessage('Please provide a valid language code'),

  body('currency')
    .optional()
    .isIn(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY', 'INR'])
    .withMessage('Please provide a valid currency code')
];

// Product validators
const createProductValidator = [
  body('name')
    .trim()
    .isLength({ min: 3, max: 200 })
    .withMessage('Product name must be between 3 and 200 characters'),

  body('description')
    .isLength({ min: 10, max: 5000 })
    .withMessage('Product description must be between 10 and 5000 characters'),

  body('category')
    .isMongoId()
    .withMessage('Please provide a valid category ID'),

  body('price')
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),

  body('compareAtPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Compare at price must be a positive number')
    .custom((value, { req }) => {
      if (value && value <= req.body.price) {
        throw new Error('Compare at price must be higher than regular price');
      }
      return true;
    }),

  body('inventory.quantity')
    .isInt({ min: 0 })
    .withMessage('Quantity must be a non-negative integer'),

  body('inventory.lowStockThreshold')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Low stock threshold must be a non-negative integer'),

  body('shipping.weight')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Weight must be a positive number'),

  body('seo.metaTitle')
    .optional()
    .isLength({ max: 60 })
    .withMessage('Meta title cannot exceed 60 characters'),

  body('seo.metaDescription')
    .optional()
    .isLength({ max: 160 })
    .withMessage('Meta description cannot exceed 160 characters')
];

const updateProductValidator = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 3, max: 200 })
    .withMessage('Product name must be between 3 and 200 characters'),

  body('description')
    .optional()
    .isLength({ min: 10, max: 5000 })
    .withMessage('Product description must be between 10 and 5000 characters'),

  body('category')
    .optional()
    .isMongoId()
    .withMessage('Please provide a valid category ID'),

  body('price')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),

  body('compareAtPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Compare at price must be a positive number')
    .custom((value, { req }) => {
      if (value && req.body.price && value <= req.body.price) {
        throw new Error('Compare at price must be higher than regular price');
      }
      return true;
    })
];

// Order validators
const createOrderValidator = [
  body('items')
    .isArray({ min: 1 })
    .withMessage('Order must contain at least one item'),

  body('items.*.productId')
    .isMongoId()
    .withMessage('Please provide valid product IDs'),

  body('items.*.quantity')
    .isInt({ min: 1, max: 999 })
    .withMessage('Quantity must be between 1 and 999'),

  body('shipping.method')
    .isIn(['standard', 'express', 'overnight', 'pickup', 'local_delivery'])
    .withMessage('Please provide a valid shipping method'),

  body('shipping.address.street')
    .trim()
    .isLength({ min: 5, max: 200 })
    .withMessage('Street address must be between 5 and 200 characters'),

  body('shipping.address.city')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('City must be between 2 and 100 characters'),

  body('shipping.address.state')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('State must be between 2 and 100 characters'),

  body('shipping.address.country')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Country must be between 2 and 100 characters'),

  body('shipping.address.zipCode')
    .trim()
    .matches(/^[A-Za-z0-9\s-]+$/)
    .withMessage('Please provide a valid zip code'),

  body('paymentMethod.type')
    .isIn(['credit_card', 'debit_card', 'paypal', 'bank_transfer', 'cash_on_delivery'])
    .withMessage('Please provide a valid payment method')
];

// Payment validators
const processPaymentValidator = [
  body('orderId')
    .isMongoId()
    .withMessage('Please provide a valid order ID'),

  body('paymentMethod.type')
    .isIn(['credit_card', 'debit_card', 'paypal', 'bank_transfer', 'cash_on_delivery'])
    .withMessage('Please provide a valid payment method'),

  body('paymentMethod.token')
    .optional()
    .isString()
    .withMessage('Payment token is required for card payments')
];

// Category validators
const createCategoryValidator = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Category name must be between 2 and 100 characters'),

  body('description')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Description cannot exceed 1000 characters'),

  body('parent')
    .optional()
    .isMongoId()
    .withMessage('Please provide a valid parent category ID'),

  body('type')
    .optional()
    .isIn(['product', 'service', 'digital', 'physical', 'marketplace'])
    .withMessage('Please provide a valid category type'),

  body('position')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Position must be a non-negative integer')
];

// Review validators
const createReviewValidator = [
  body('title')
    .trim()
    .isLength({ min: 5, max: 200 })
    .withMessage('Review title must be between 5 and 200 characters'),

  body('content')
    .isLength({ min: 10, max: 5000 })
    .withMessage('Review content must be between 10 and 5000 characters'),

  body('rating')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5'),

  body('detailedRatings.quality')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('Quality rating must be between 1 and 5'),

  body('detailedRatings.value')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('Value rating must be between 1 and 5'),

  body('detailedRatings.shipping')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('Shipping rating must be between 1 and 5'),

  body('recommendation')
    .isIn(['yes', 'no', 'maybe'])
    .withMessage('Please provide a valid recommendation')
];

// Vendor validators
const becomeVendorValidator = [
  body('storeName')
    .trim()
    .isLength({ min: 3, max: 100 })
    .withMessage('Store name must be between 3 and 100 characters'),

  body('storeDescription')
    .isLength({ min: 10, max: 2000 })
    .withMessage('Store description must be between 10 and 2000 characters'),

  body('businessType')
    .isIn(['individual', 'business', 'nonprofit'])
    .withMessage('Please provide a valid business type'),

  body('businessRegistration')
    .optional()
    .isLength({ max: 100 })
    .withMessage('Business registration cannot exceed 100 characters'),

  body('taxId')
    .optional()
    .matches(/^[0-9-]+$/)
    .withMessage('Please provide a valid tax ID'),

  body('bankAccount.accountNumber')
    .matches(/^[0-9]+$/)
    .withMessage('Account number must contain only numbers')
    .isLength({ min: 8, max: 17 })
    .withMessage('Account number must be between 8 and 17 digits'),

  body('bankAccount.routingNumber')
    .matches(/^[0-9]+$/)
    .withMessage('Routing number must contain only numbers')
    .isLength({ min: 9, max: 9 })
    .withMessage('Routing number must be 9 digits'),

  body('bankAccount.accountHolderName')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Account holder name must be between 2 and 100 characters')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Account holder name can only contain letters and spaces')
];

// Coupon validators
const createCouponValidator = [
  body('code')
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('Coupon code must be between 3 and 20 characters')
    .matches(/^[A-Z0-9]+$/)
    .withMessage('Coupon code can only contain uppercase letters and numbers'),

  body('discountType')
    .isIn(['percentage', 'fixed_amount'])
    .withMessage('Discount type must be either percentage or fixed_amount'),

  body('discountValue')
    .isFloat({ min: 0 })
    .withMessage('Discount value must be a positive number'),

  body('minimumAmount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Minimum amount must be a positive number'),

  body('maximumDiscount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Maximum discount must be a positive number'),

  body('usageLimit')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Usage limit must be at least 1'),

  body('startDate')
    .optional()
    .isISO8601()
    .withMessage('Please provide a valid start date'),

  body('endDate')
    .optional()
    .isISO8601()
    .withMessage('Please provide a valid end date')
    .custom((value, { req }) => {
      if (req.body.startDate && new Date(value) <= new Date(req.body.startDate)) {
        throw new Error('End date must be after start date');
      }
      return true;
    })
];

// Address validators
const addressValidator = [
  body('street')
    .trim()
    .isLength({ min: 5, max: 200 })
    .withMessage('Street address must be between 5 and 200 characters'),

  body('city')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('City must be between 2 and 100 characters'),

  body('state')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('State must be between 2 and 100 characters'),

  body('country')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Country must be between 2 and 100 characters'),

  body('zipCode')
    .trim()
    .matches(/^[A-Za-z0-9\s-]+$/)
    .withMessage('Please provide a valid zip code')
    .isLength({ min: 3, max: 20 })
    .withMessage('Zip code must be between 3 and 20 characters')
];

// Social media validators
const socialMediaValidator = [
  body('facebook')
    .optional()
    .isURL()
    .withMessage('Please provide a valid Facebook URL'),

  body('twitter')
    .optional()
    .isURL()
    .withMessage('Please provide a valid Twitter URL'),

  body('instagram')
    .optional()
    .isURL()
    .withMessage('Please provide a valid Instagram URL'),

  body('linkedin')
    .optional()
    .isURL()
    .withMessage('Please provide a valid LinkedIn URL'),

  body('youtube')
    .optional()
    .isURL()
    .withMessage('Please provide a valid YouTube URL')
];

// Export all validators
module.exports = {
  registerValidator,
  loginValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  changePasswordValidator,
  updateProfileValidator,
  createProductValidator,
  updateProductValidator,
  createOrderValidator,
  processPaymentValidator,
  createCategoryValidator,
  createReviewValidator,
  becomeVendorValidator,
  createCouponValidator,
  addressValidator,
  socialMediaValidator
};
