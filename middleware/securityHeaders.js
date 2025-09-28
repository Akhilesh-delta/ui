const helmet = require('helmet');
const logger = require('../utils/logger');

// Security headers middleware
const securityHeaders = (req, res, next) => {
  // Basic security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Strict transport security (only for HTTPS)
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // Content security policy
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "img-src 'self' data: https: blob:",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https://api.stripe.com wss://*.stripe.com",
    "frame-src 'none'",
    "object-src 'none'",
    "media-src 'self' blob:",
    "worker-src 'self' blob:"
  ].join('; ');

  res.setHeader('Content-Security-Policy', csp);

  // Feature policy (deprecated, but still useful)
  res.setHeader('Feature-Policy', [
    "camera 'none'",
    "microphone 'none'",
    "geolocation 'none'",
    "payment 'self' https://js.stripe.com",
    "usb 'none'",
    "autoplay 'none'"
  ].join(', '));

  next();
};

// Rate limiting headers
const rateLimitHeaders = (req, res, next) => {
  const rateLimit = req.rateLimit;

  if (rateLimit) {
    res.set({
      'X-RateLimit-Limit': rateLimit.limit,
      'X-RateLimit-Remaining': rateLimit.remaining,
      'X-RateLimit-Reset': rateLimit.resetTime
    });
  }

  next();
};

// API key validation middleware
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;

  if (!apiKey) {
    return res.status(401).json({
      error: 'API key required',
      message: 'Please provide a valid API key'
    });
  }

  // Validate API key format (should be UUID v4)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(apiKey)) {
    logger.warn('Invalid API key format', { apiKey: apiKey.substring(0, 8) + '***' });
    return res.status(401).json({
      error: 'Invalid API key format',
      message: 'API key must be a valid UUID'
    });
  }

  // TODO: Validate API key against database
  // For now, we'll just pass through
  req.apiKey = apiKey;
  next();
};

// Client ID validation
const validateClientId = (req, res, next) => {
  const clientId = req.headers['x-client-id'] || req.query.client_id;

  if (!clientId) {
    return res.status(400).json({
      error: 'Client ID required',
      message: 'Please provide a valid client ID'
    });
  }

  // Validate client ID format
  if (typeof clientId !== 'string' || clientId.length < 3 || clientId.length > 100) {
    return res.status(400).json({
      error: 'Invalid client ID format',
      message: 'Client ID must be a string between 3 and 100 characters'
    });
  }

  req.clientId = clientId;
  next();
};

// Request signature validation (for webhook security)
const validateRequestSignature = (req, res, next) => {
  const signature = req.headers['x-signature'] || req.headers['x-hub-signature'];

  if (!signature) {
    return next(); // Skip validation if no signature provided
  }

  const payload = JSON.stringify(req.body);
  const secret = process.env.WEBHOOK_SECRET;

  if (!secret) {
    logger.warn('Webhook secret not configured');
    return next();
  }

  const crypto = require('crypto');
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  const providedSignature = signature.replace('sha256=', '');

  if (!crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'hex'),
    Buffer.from(providedSignature, 'hex')
  )) {
    logger.warn('Invalid request signature', {
      ip: req.ip,
      url: req.originalUrl,
      signature: signature.substring(0, 10) + '***'
    });

    return res.status(401).json({
      error: 'Invalid signature',
      message: 'Request signature validation failed'
    });
  }

  next();
};

// CORS preflight handler
const corsHandler = (req, res, next) => {
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, x-client-id, x-signature');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours

    return res.status(204).end();
  }

  next();
};

// CSRF protection middleware
const csrfProtection = (req, res, next) => {
  // Skip CSRF for API calls (handled by JWT tokens)
  if (req.originalUrl.startsWith('/api/')) {
    return next();
  }

  // For web requests, implement CSRF protection
  const token = req.headers['x-csrf-token'] || req.body._csrf;

  if (!token && req.method !== 'GET') {
    return res.status(403).json({
      error: 'CSRF token required',
      message: 'Cross-site request forgery protection'
    });
  }

  // TODO: Validate CSRF token against session
  next();
};

// Input sanitization middleware
const sanitizeInput = (req, res, next) => {
  const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;

    return str
      .replace(/[<>]/g, '') // Remove potential HTML tags
      .replace(/javascript:/gi, '') // Remove javascript: URLs
      .replace(/on\w+\s*=/gi, '') // Remove event handlers
      .trim();
  };

  const sanitizeObject = (obj) => {
    if (typeof obj === 'string') {
      return sanitizeString(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map(sanitizeObject);
    }

    if (obj && typeof obj === 'object') {
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

  // Sanitize query parameters
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }

  // Sanitize route parameters
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }

  next();
};

// SQL injection prevention
const preventSqlInjection = (req, res, next) => {
  const sqlPatterns = [
    /(\b(union|select|insert|update|delete|drop|create|alter|exec|execute)\b)/gi,
    /(--|#|\/\*|\*\/)/g,
    /(\bor\b\s+\d+\s*=\s*\d+)/gi,
    /(\band\b\s+\d+\s*=\s*\d+)/gi,
    /('|(\\')|(;)|(\|\|)/g
  ];

  const checkValue = (value) => {
    if (typeof value === 'string') {
      return sqlPatterns.some(pattern => pattern.test(value));
    }

    if (typeof value === 'object' && value !== null) {
      return Object.values(value).some(checkValue);
    }

    return false;
  };

  const hasSqlInjection = checkValue(req.body) || checkValue(req.query) || checkValue(req.params);

  if (hasSqlInjection) {
    logger.warn('Potential SQL injection attempt detected', {
      ip: req.ip,
      url: req.originalUrl,
      body: JSON.stringify(req.body).substring(0, 200),
      query: JSON.stringify(req.query).substring(0, 200)
    });

    return res.status(400).json({
      error: 'Invalid input',
      message: 'Potentially malicious content detected'
    });
  }

  next();
};

// Request source validation
const validateRequestSource = (req, res, next) => {
  const userAgent = req.get('User-Agent') || '';
  const suspiciousPatterns = [
    /sqlmap/i,
    /nikto/i,
    /nessus/i,
    /openvas/i,
    /w3af/i,
    /skipfish/i,
    /dirbuster/i,
    /gobuster/i,
    /masscan/i,
    /nmap/i,
    /metasploit/i
  ];

  const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(userAgent));

  if (isSuspicious) {
    logger.warn('Suspicious user agent detected', {
      ip: req.ip,
      url: req.originalUrl,
      userAgent: userAgent.substring(0, 100)
    });

    // Add extra monitoring for suspicious requests
    req.isSuspicious = true;
  }

  next();
};

// DDoS protection middleware
const ddosProtection = (req, res, next) => {
  const ip = req.ip;
  const currentTime = Date.now();
  const windowMs = 60 * 1000; // 1 minute window
  const maxRequests = 100; // Max requests per window

  // Simple in-memory tracking (in production, use Redis)
  if (!global.requestCounts) {
    global.requestCounts = new Map();
  }

  const requestData = global.requestCounts.get(ip) || { count: 0, windowStart: currentTime };

  // Reset window if expired
  if (currentTime - requestData.windowStart > windowMs) {
    requestData.count = 0;
    requestData.windowStart = currentTime;
  }

  requestData.count++;
  global.requestCounts.set(ip, requestData);

  // Check if rate limit exceeded
  if (requestData.count > maxRequests) {
    logger.warn('DDoS protection triggered', {
      ip,
      count: requestData.count,
      limit: maxRequests
    });

    return res.status(429).json({
      error: 'Rate limit exceeded',
      message: 'Too many requests. Please slow down.',
      retryAfter: Math.ceil((requestData.windowStart + windowMs - currentTime) / 1000)
    });
  }

  next();
};

// Security audit middleware
const securityAudit = (req, res, next) => {
  const auditData = {
    timestamp: new Date().toISOString(),
    ip: req.ip,
    method: req.method,
    url: req.originalUrl,
    userAgent: req.get('User-Agent'),
    userId: req.user ? req.user.id : null,
    isSecure: req.secure,
    protocol: req.protocol,
    hostname: req.hostname,
    referer: req.get('Referer'),
    contentType: req.get('Content-Type'),
    contentLength: req.get('Content-Length'),
    hasApiKey: !!req.headers['x-api-key'],
    hasClientId: !!req.headers['x-client-id'],
    hasSignature: !!req.headers['x-signature']
  };

  // Log security-relevant requests
  if (auditData.hasApiKey || auditData.hasClientId || auditData.hasSignature) {
    logger.info('Security audit', auditData);
  }

  next();
};

module.exports = {
  securityHeaders,
  rateLimitHeaders,
  validateApiKey,
  validateClientId,
  validateRequestSignature,
  corsHandler,
  csrfProtection,
  sanitizeInput,
  preventSqlInjection,
  validateRequestSource,
  ddosProtection,
  securityAudit
};
