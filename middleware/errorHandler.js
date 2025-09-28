const logger = require('../utils/logger');
const mongoose = require('mongoose');

// Custom Error class
class AppError extends Error {
  constructor(message, statusCode, isOperational = true, errorCode = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = isOperational;
    this.errorCode = errorCode;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Global error handler middleware
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error
  logger.error('Error occurred:', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user ? req.user.id : null,
    body: req.body,
    params: req.params,
    query: req.query
  });

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Invalid ID format';
    error = new AppError(message, 400, true, 'INVALID_ID');
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const value = err.keyValue[field];
    const message = `Duplicate field value: ${field} - ${value}. Please use another value!`;
    error = new AppError(message, 400, true, 'DUPLICATE_FIELD');
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(val => val.message);
    const message = `Invalid input data: ${errors.join('. ')}`;
    error = new AppError(message, 400, true, 'VALIDATION_ERROR');
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token. Please log in again!';
    error = new AppError(message, 401, true, 'INVALID_TOKEN');
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Your token has expired! Please log in again.';
    error = new AppError(message, 401, true, 'TOKEN_EXPIRED');
  }

  // Multer file upload error
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const message = 'File too large';
      error = new AppError(message, 400, true, 'FILE_TOO_LARGE');
    } else if (err.code === 'LIMIT_FILE_COUNT') {
      const message = 'Too many files';
      error = new AppError(message, 400, true, 'TOO_MANY_FILES');
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      const message = 'Unexpected file field';
      error = new AppError(message, 400, true, 'UNEXPECTED_FILE');
    }
  }

  // Stripe errors
  if (err.type && err.type.startsWith('Stripe')) {
    let message = 'Payment processing error';
    let statusCode = 400;
    let errorCode = 'PAYMENT_ERROR';

    switch (err.type) {
      case 'StripeCardError':
        message = err.message;
        statusCode = 402;
        errorCode = 'CARD_ERROR';
        break;
      case 'StripeRateLimitError':
        message = 'Too many requests to payment processor';
        statusCode = 429;
        errorCode = 'RATE_LIMIT_ERROR';
        break;
      case 'StripeInvalidRequestError':
        message = 'Invalid payment request';
        statusCode = 400;
        errorCode = 'INVALID_PAYMENT_REQUEST';
        break;
      case 'StripeAPIError':
        message = 'Payment service temporarily unavailable';
        statusCode = 503;
        errorCode = 'PAYMENT_SERVICE_UNAVAILABLE';
        break;
      case 'StripeConnectionError':
        message = 'Payment service connection error';
        statusCode = 503;
        errorCode = 'PAYMENT_CONNECTION_ERROR';
        break;
      case 'StripeAuthenticationError':
        message = 'Payment service authentication failed';
        statusCode = 500;
        errorCode = 'PAYMENT_AUTH_ERROR';
        break;
    }

    error = new AppError(message, statusCode, true, errorCode);
  }

  // Database connection errors
  if (err.name === 'MongoNetworkError' || err.name === 'MongoTimeoutError') {
    const message = 'Database connection error. Please try again later.';
    error = new AppError(message, 503, false, 'DATABASE_ERROR');
  }

  // Redis connection errors
  if (err.code === 'ECONNREFUSED' && err.port === 6379) {
    const message = 'Cache service unavailable. Please try again later.';
    error = new AppError(message, 503, false, 'CACHE_ERROR');
  }

  // Send error response
  const statusCode = error.statusCode || 500;
  const status = error.status || 'error';

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  const message = isDevelopment && statusCode >= 500 ? error.message : 'Something went wrong!';

  const errorResponse = {
    status,
    error: message,
    ...(error.errorCode && { code: error.errorCode }),
    ...(isDevelopment && { stack: error.stack }),
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    method: req.method
  };

  // Add request ID for tracking
  if (req.requestId) {
    errorResponse.requestId = req.requestId;
  }

  res.status(statusCode).json(errorResponse);
};

// Development error handler (more detailed)
const developmentErrorHandler = (err, req, res, next) => {
  if (process.env.NODE_ENV === 'development') {
    console.error('Development Error:', err);
  }
  next(err);
};

// Async error wrapper
const catchAsync = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};

// Handle 404 errors
const notFound = (req, res, next) => {
  const error = new AppError(
    `Not found - ${req.originalUrl}`,
    404,
    true,
    'ROUTE_NOT_FOUND'
  );
  next(error);
};

// Handle method not allowed
const methodNotAllowed = (req, res, next) => {
  const error = new AppError(
    `Method ${req.method} not allowed on ${req.originalUrl}`,
    405,
    true,
    'METHOD_NOT_ALLOWED'
  );
  next(error);
};

// Rate limit error handler
const rateLimitHandler = (req, res) => {
  const error = new AppError(
    'Too many requests from this IP, please try again later.',
    429,
    true,
    'RATE_LIMIT_EXCEEDED'
  );

  logger.warn('Rate limit exceeded:', {
    ip: req.ip,
    url: req.originalUrl,
    method: req.method
  });

  res.status(429).json({
    status: 'error',
    error: error.message,
    code: error.errorCode,
    retryAfter: Math.ceil(15 * 60 / 1000), // 15 minutes in seconds
    timestamp: new Date().toISOString()
  });
};

// Database connection error handler
const handleDatabaseError = (error) => {
  logger.error('Database error:', error);

  if (error.name === 'MongoServerError' && error.code === 11000) {
    return new AppError('Duplicate entry', 400, true, 'DUPLICATE_ENTRY');
  }

  if (error.name === 'CastError') {
    return new AppError('Invalid ID format', 400, true, 'INVALID_ID');
  }

  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(val => val.message);
    return new AppError(`Validation failed: ${errors.join(', ')}`, 400, true, 'VALIDATION_ERROR');
  }

  return new AppError('Database operation failed', 500, false, 'DATABASE_ERROR');
};

// File upload error handler
const handleFileUploadError = (error) => {
  logger.error('File upload error:', error);

  if (error.code === 'LIMIT_FILE_SIZE') {
    return new AppError('File size too large', 400, true, 'FILE_TOO_LARGE');
  }

  if (error.code === 'LIMIT_FILE_COUNT') {
    return new AppError('Too many files uploaded', 400, true, 'TOO_MANY_FILES');
  }

  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return new AppError('Unexpected file field', 400, true, 'UNEXPECTED_FILE');
  }

  return new AppError('File upload failed', 500, false, 'FILE_UPLOAD_ERROR');
};

// Validation error formatter
const formatValidationErrors = (errors) => {
  const formattedErrors = {};

  Object.keys(errors).forEach(key => {
    formattedErrors[key] = {
      message: errors[key].message,
      value: errors[key].value,
      param: key,
      location: 'body'
    };
  });

  return formattedErrors;
};

// Send error to external monitoring service
const sendErrorToMonitoring = async (error, req) => {
  try {
    // Send to Sentry if configured
    if (process.env.SENTRY_DSN && process.env.NODE_ENV === 'production') {
      const Sentry = require('@sentry/node');
      Sentry.captureException(error, {
        tags: {
          url: req.originalUrl,
          method: req.method,
          userId: req.user ? req.user.id : null
        },
        user: req.user ? {
          id: req.user.id,
          email: req.user.email
        } : null
      });
    }

    // Send to Rollbar if configured
    if (process.env.ROLLBAR_ACCESS_TOKEN && process.env.NODE_ENV === 'production') {
      const rollbar = require('rollbar');
      rollbar.error(error, req);
    }

  } catch (monitoringError) {
    logger.error('Failed to send error to monitoring service:', monitoringError);
  }
};

module.exports = {
  AppError,
  errorHandler,
  catchAsync,
  notFound,
  methodNotAllowed,
  rateLimitHandler,
  handleDatabaseError,
  handleFileUploadError,
  formatValidationErrors,
  sendErrorToMonitoring,
  developmentErrorHandler
};
