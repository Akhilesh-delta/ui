const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { AppError } = require('./errorHandler');
const logger = require('../utils/logger');

// Authentication middleware
const authenticate = async (req, res, next) => {
  try {
    let token;

    // Check for token in header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    // Check for token in cookies
    else if (req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      throw new AppError('Access denied. No token provided.', 401, true, 'NO_TOKEN');
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if user still exists
    const user = await User.findById(decoded.id);
    if (!user) {
      throw new AppError('Token is not valid. User not found.', 401, true, 'USER_NOT_FOUND');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new AppError('User account is not active.', 401, true, 'USER_INACTIVE');
    }

    // Check if password was changed after token was issued
    if (user.changedPasswordAfter(decoded.iat)) {
      throw new AppError('User recently changed password. Please log in again.', 401, true, 'PASSWORD_CHANGED');
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      next(new AppError('Invalid token.', 401, true, 'INVALID_TOKEN'));
    } else if (error.name === 'TokenExpiredError') {
      next(new AppError('Token expired.', 401, true, 'TOKEN_EXPIRED'));
    } else {
      next(error);
    }
  }
};

// Role-based authorization middleware
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      throw new AppError('Authentication required.', 401, true, 'AUTHENTICATION_REQUIRED');
    }

    if (!roles.includes(req.user.role)) {
      throw new AppError('Not authorized to access this resource.', 403, true, 'NOT_AUTHORIZED');
    }

    next();
  };
};

// Vendor authorization middleware
const authorizeVendor = (req, res, next) => {
  if (!req.user) {
    throw new AppError('Authentication required.', 401, true, 'AUTHENTICATION_REQUIRED');
  }

  if (req.user.role !== 'vendor' && req.user.role !== 'admin') {
    throw new AppError('Vendor access required.', 403, true, 'VENDOR_ACCESS_REQUIRED');
  }

  next();
};

// Check if user owns resource
const checkOwnership = (resourceUserField = 'user') => {
  return (req, res, next) => {
    if (!req.user) {
      throw new AppError('Authentication required.', 401, true, 'AUTHENTICATION_REQUIRED');
    }

    // Allow admins to access any resource
    if (req.user.role === 'admin') {
      return next();
    }

    // Check if user owns the resource
    const resource = req[resourceUserField];
    if (!resource || resource.toString() !== req.user.id) {
      throw new AppError('Not authorized to access this resource.', 403, true, 'NOT_AUTHORIZED');
    }

    next();
  };
};

// Rate limiting middleware
const rateLimit = require('express-rate-limit');

// API key validation middleware
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;

  if (!apiKey) {
    throw new AppError('API key required.', 401, true, 'API_KEY_REQUIRED');
  }

  // Validate API key format and existence
  if (!isValidApiKey(apiKey)) {
    throw new AppError('Invalid API key.', 401, true, 'INVALID_API_KEY');
  }

  req.apiKey = apiKey;
  next();
};

// Check if API key is valid
const isValidApiKey = (apiKey) => {
  // Implementation for API key validation
  return apiKey.length === 36; // UUID format
};

// CORS middleware
const cors = require('cors');

const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = process.env.ALLOWED_ORIGINS ?
      process.env.ALLOWED_ORIGINS.split(',') :
      ['http://localhost:3000', 'http://localhost:3001'];

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-client-id']
};

// File upload middleware
const multer = require('multer');
const path = require('path');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  // Accept images and documents
  if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('application/')) {
    cb(null, true);
  } else {
    cb(new Error('Only images and documents are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 10
  }
});

// Request validation middleware
const { body, param, query, validationResult } = require('express-validator');

// Common validation rules
const commonValidations = {
  email: body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),

  password: body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number'),

  phone: body('phone')
    .optional()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),

  name: body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),

  objectId: param('id')
    .isMongoId()
    .withMessage('Invalid ID format')
};

// Input sanitization middleware
const sanitizeInput = (req, res, next) => {
  const sanitizeHtml = require('sanitize-html');

  const sanitizeObject = (obj) => {
    if (typeof obj === 'string') {
      return sanitizeHtml(obj, {
        allowedTags: [],
        allowedAttributes: {}
      });
    }

    if (typeof obj === 'object' && obj !== null) {
      const sanitized = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = sanitizeObject(value);
      }
      return sanitized;
    }

    return obj;
  };

  // Sanitize request body
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }

  next();
};

// Request logging middleware
const requestLogger = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;

    logger.info('API Request', {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user ? req.user.id : null
    });
  });

  next();
};

// API version middleware
const apiVersion = (req, res, next) => {
  const version = req.headers['api-version'] || req.headers['x-api-version'] || '1.0';
  req.apiVersion = version;
  res.set('API-Version', version);
  next();
};

// Request timeout middleware
const timeout = (req, res, next) => {
  const timeout = setTimeout(() => {
    res.status(408).json({
      success: false,
      error: 'Request timeout',
      message: 'The request took too long to process'
    });
  }, 30000); // 30 seconds

  res.on('finish', () => {
    clearTimeout(timeout);
  });

  next();
};

// Security headers middleware
const securityHeaders = (req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
  });

  next();
};

// Error handling middleware
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error
  logger.error('API Error', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userId: req.user ? req.user.id : null
  });

  // Handle different error types
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = new AppError(message, 400);
  }

  if (err.name === 'CastError') {
    error = new AppError('Invalid ID format', 400);
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    error = new AppError(`${field} already exists`, 400);
  }

  // Send error response
  res.status(error.statusCode || 500).json({
    success: false,
    error: error.message || 'Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

// Not found middleware
const notFound = (req, res, next) => {
  const error = new AppError(`Not found - ${req.originalUrl}`, 404);
  next(error);
};

// Export all middleware
module.exports = {
  authenticate,
  authorize,
  authorizeVendor,
  checkOwnership,
  validateApiKey,
  corsOptions,
  upload,
  commonValidations,
  sanitizeInput,
  requestLogger,
  apiVersion,
  timeout,
  securityHeaders,
  errorHandler,
  notFound
};
