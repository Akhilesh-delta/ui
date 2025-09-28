const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

// Request logger middleware
const requestLogger = (req, res, next) => {
  // Generate unique request ID
  req.requestId = uuidv4();

  // Log incoming request
  const startTime = Date.now();
  const requestInfo = {
    requestId: req.requestId,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    contentType: req.get('Content-Type'),
    contentLength: req.get('Content-Length'),
    referer: req.get('Referer'),
    userId: req.user ? req.user.id : null,
    body: req.method !== 'GET' ? req.body : undefined,
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    params: Object.keys(req.params).length > 0 ? req.params : undefined
  };

  // Log request start
  logger.info('Request started', requestInfo);

  // Log request completion
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const responseInfo = {
      requestId: req.requestId,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      statusMessage: res.statusMessage,
      responseTime: `${duration}ms`,
      responseSize: res.get('Content-Length'),
      userId: req.user ? req.user.id : null
    };

    // Log based on status code
    if (res.statusCode >= 400) {
      logger.warn('Request completed with error', responseInfo);
    } else if (res.statusCode >= 300) {
      logger.info('Request completed with redirect', responseInfo);
    } else {
      logger.info('Request completed successfully', responseInfo);
    }

    // Log slow requests
    if (duration > 5000) { // 5 seconds
      logger.warn('Slow request detected', {
        ...responseInfo,
        threshold: '5s'
      });
    }

    // Log large responses
    if (parseInt(res.get('Content-Length') || '0') > 1000000) { // 1MB
      logger.warn('Large response detected', {
        ...responseInfo,
        size: res.get('Content-Length'),
        threshold: '1MB'
      });
    }
  });

  next();
};

// Request timing middleware
const requestTimer = (req, res, next) => {
  req.startTime = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    res.set('X-Response-Time', `${duration}ms`);
  });
  next();
};

// Request size limiter
const requestSizeLimiter = (req, res, next) => {
  const maxSize = parseInt(process.env.MAX_REQUEST_SIZE) || 50 * 1024 * 1024; // 50MB default

  if (req.headers['content-length'] && parseInt(req.headers['content-length']) > maxSize) {
    return res.status(413).json({
      error: 'Request entity too large',
      message: `Request size exceeds maximum allowed size of ${maxSize} bytes`,
      maxSize,
      receivedSize: req.headers['content-length']
    });
  }

  next();
};

// Request validation middleware
const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context.value
      }));

      return res.status(400).json({
        error: 'Validation failed',
        details: errors,
        message: 'Please check your input data'
      });
    }

    req.body = value;
    next();
  };
};

// Sanitize input middleware
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
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }

  // Sanitize query parameters
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeObject(req.query);
  }

  next();
};

// API versioning middleware
const apiVersion = (req, res, next) => {
  const apiVersion = req.headers['api-version'] || req.headers['x-api-version'] || '1.0';
  req.apiVersion = apiVersion;
  res.set('API-Version', apiVersion);
  next();
};

// Request correlation ID
const correlationId = (req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] ||
                      req.headers['x-request-id'] ||
                      req.requestId;

  req.correlationId = correlationId;
  res.set('x-correlation-id', correlationId);
  next();
};

// Request context middleware
const requestContext = (req, res, next) => {
  req.context = {
    requestId: req.requestId,
    correlationId: req.correlationId,
    startTime: req.startTime || Date.now(),
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    method: req.method,
    url: req.originalUrl,
    userId: req.user ? req.user.id : null,
    sessionId: req.sessionID,
    locale: req.headers['accept-language']?.split(',')[0] || 'en',
    timezone: req.headers['timezone'] || 'UTC'
  };

  next();
};

// Performance monitoring middleware
const performanceMonitor = (req, res, next) => {
  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds

    // Log performance metrics
    if (duration > 1000) { // Log requests taking more than 1 second
      logger.warn('Slow API request', {
        method: req.method,
        url: req.originalUrl,
        duration: `${duration.toFixed(2)}ms`,
        statusCode: res.statusCode,
        userId: req.user ? req.user.id : null
      });
    }

    // Add performance headers
    res.set('X-Response-Time', `${duration.toFixed(2)}ms`);
    res.set('X-Server-Timing', `api;dur=${duration.toFixed(2)}`);
  });

  next();
};

// API health check middleware
const healthCheck = (req, res, next) => {
  if (req.path === '/health' || req.path === '/api/health') {
    // Skip logging for health checks
    return next();
  }
  next();
};

// Request compression check
const compressionCheck = (req, res, next) => {
  const acceptEncoding = req.get('Accept-Encoding') || '';

  if (acceptEncoding.includes('gzip')) {
    res.set('X-Compression', 'gzip');
  } else if (acceptEncoding.includes('deflate')) {
    res.set('X-Compression', 'deflate');
  } else if (acceptEncoding.includes('br')) {
    res.set('X-Compression', 'brotli');
  }

  next();
};

// Request analytics middleware
const analyticsTracker = (req, res, next) => {
  // Track API usage for analytics
  const analyticsData = {
    endpoint: req.originalUrl,
    method: req.method,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    userId: req.user ? req.user.id : null,
    timestamp: new Date().toISOString(),
    statusCode: res.statusCode,
    responseTime: Date.now() - req.startTime
  };

  // Store analytics data (you can implement actual storage logic here)
  // For now, just log it
  logger.debug('Analytics data', analyticsData);

  next();
};

module.exports = {
  requestLogger,
  requestTimer,
  requestSizeLimiter,
  validateRequest,
  sanitizeInput,
  apiVersion,
  correlationId,
  requestContext,
  performanceMonitor,
  healthCheck,
  compressionCheck,
  analyticsTracker
};
