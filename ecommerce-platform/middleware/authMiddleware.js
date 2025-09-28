const jwt = require('jsonwebtoken');
const { config } = require('../config/environment');

// Generate JWT token
const generateToken = (userId, email, role = 'user') => {
  return jwt.sign(
    {
      id: userId,
      email: email,
      role: role
    },
    config.JWT_SECRET,
    {
      expiresIn: config.JWT_EXPIRE,
      issuer: 'ecommerce-platform',
      audience: 'ecommerce-users'
    }
  );
};

// Generate refresh token
const generateRefreshToken = (userId) => {
  return jwt.sign(
    {
      id: userId,
      type: 'refresh'
    },
    config.JWT_REFRESH_SECRET,
    {
      expiresIn: config.JWT_REFRESH_EXPIRE,
      issuer: 'ecommerce-platform',
      audience: 'ecommerce-users'
    }
  );
};

// Verify JWT token
const verifyToken = (token) => {
  try {
    return jwt.verify(token, config.JWT_SECRET, {
      issuer: 'ecommerce-platform',
      audience: 'ecommerce-users'
    });
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
};

// Verify refresh token
const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, config.JWT_REFRESH_SECRET, {
      issuer: 'ecommerce-platform',
      audience: 'ecommerce-users'
    });
  } catch (error) {
    throw new Error('Invalid refresh token');
  }
};

// Extract token from header
const extractTokenFromHeader = (authHeader) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
};

// Authentication middleware
const authenticate = async (req, res, next) => {
  try {
    const token = extractTokenFromHeader(req.headers.authorization);
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Access denied. No token provided.'
      });
    }
    
    const decoded = verifyToken(token);
    
    // Check if user still exists and is active
    const User = require('../models/User');
    const user = await User.findById(decoded.id);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Token is valid but user no longer exists.'
      });
    }
    
    if (user.status !== 'active') {
      return res.status(401).json({
        success: false,
        error: 'Account is not active. Please contact support.'
      });
    }
    
    // Check if password was changed after token was issued
    if (user.security.passwordChangedAt && decoded.iat < user.security.passwordChangedAt.getTime() / 1000) {
      return res.status(401).json({
        success: false,
        error: 'Password was changed recently. Please login again.'
      });
    }
    
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: 'Invalid token.'
    });
  }
};

// Role-based authorization middleware
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.'
      });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `Access denied. Required role: ${roles.join(' or ')}. Your role: ${req.user.role}`
      });
    }
    
    next();
  };
};

// Admin only middleware
const requireAdmin = authorize('admin');

// Vendor or Admin middleware
const requireVendorOrAdmin = authorize('vendor', 'admin');

// Optional authentication (for endpoints that work with or without auth)
const optionalAuth = async (req, res, next) => {
  try {
    const token = extractTokenFromHeader(req.headers.authorization);
    
    if (token) {
      const decoded = verifyToken(token);
      const User = require('../models/User');
      const user = await User.findById(decoded.id);
      
      if (user && user.status === 'active') {
        req.user = user;
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};

// Check if user owns resource
const requireOwnership = (resourceUserField = 'user') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.'
      });
    }
    
    const resourceUserId = req.body[resourceUserField] || req.params[resourceUserField] || req.query[resourceUserField];
    
    if (!resourceUserId) {
      return res.status(400).json({
        success: false,
        error: 'Resource user ID not provided.'
      });
    }
    
    // Allow admins to access any resource
    if (req.user.role === 'admin') {
      return next();
    }
    
    // Check if user owns the resource
    if (req.user._id.toString() !== resourceUserId.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only access your own resources.'
      });
    }
    
    next();
  };
};

// Check if user is vendor of resource
const requireVendorOwnership = (resourceVendorField = 'vendor') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.'
      });
    }
    
    const resourceVendorId = req.body[resourceVendorField] || req.params[resourceVendorField] || req.query[resourceVendorField];
    
    if (!resourceVendorId) {
      return res.status(400).json({
        success: false,
        error: 'Resource vendor ID not provided.'
      });
    }
    
    // Allow admins to access any resource
    if (req.user.role === 'admin') {
      return next();
    }
    
    // Check if user is the vendor of the resource
    if (req.user._id.toString() !== resourceVendorId.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only access resources from your store.'
      });
    }
    
    next();
  };
};

// Rate limiting for authentication endpoints
const authRateLimit = (maxAttempts = 5, windowMs = 15 * 60 * 1000) => {
  const attempts = new Map();
  
  return (req, res, next) => {
    const key = req.ip + (req.body.email || req.body.phone || 'unknown');
    const now = Date.now();
    
    if (!attempts.has(key)) {
      attempts.set(key, []);
    }
    
    const userAttempts = attempts.get(key);
    
    // Remove old attempts outside the window
    const validAttempts = userAttempts.filter(time => now - time < windowMs);
    attempts.set(key, validAttempts);
    
    if (validAttempts.length >= maxAttempts) {
      return res.status(429).json({
        success: false,
        error: 'Too many authentication attempts. Please try again later.',
        retryAfter: Math.ceil((validAttempts[0] + windowMs - now) / 1000)
      });
    }
    
    validAttempts.push(now);
    
    // Add custom header with remaining attempts
    const remaining = maxAttempts - validAttempts.length;
    res.set('X-RateLimit-Remaining', remaining);
    res.set('X-RateLimit-Reset', new Date(validAttempts[0] + windowMs).toISOString());
    
    next();
  };
};

// Session management
const createSession = (userId, deviceInfo = {}) => {
  const sessionId = require('crypto').randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  
  return {
    sessionId,
    userId,
    deviceInfo,
    createdAt: new Date(),
    expiresAt,
    isActive: true
  };
};

// Validate session
const validateSession = async (sessionId, userId) => {
  const User = require('../models/User');
  const user = await User.findById(userId);
  
  if (!user) {
    return false;
  }
  
  // Check if session exists in user's device info
  const session = user.deviceInfo.find(device => 
    device.deviceId === sessionId && device.lastSeen > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  );
  
  return !!session;
};

// Invalidate session
const invalidateSession = async (sessionId, userId) => {
  const User = require('../models/User');
  await User.updateOne(
    { _id: userId },
    { $pull: { deviceInfo: { deviceId: sessionId } } }
  );
};

// Password utilities
const hashPassword = async (password) => {
  const bcrypt = require('bcryptjs');
  const salt = await bcrypt.genSalt(config.BCRYPT_ROUNDS);
  return await bcrypt.hash(password, salt);
};

const comparePassword = async (candidatePassword, hashedPassword) => {
  const bcrypt = require('bcryptjs');
  return await bcrypt.compare(candidatePassword, hashedPassword);
};

// Email verification token
const generateEmailVerificationToken = () => {
  return require('crypto').randomBytes(32).toString('hex');
};

// Password reset token
const generatePasswordResetToken = () => {
  return require('crypto').randomBytes(32).toString('hex');
};

// Hash token
const hashToken = (token) => {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(token).digest('hex');
};

// Check if email is valid
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Check if phone is valid
const isValidPhone = (phone) => {
  const phoneRegex = /^\+?[\d\s\-\(\)]{10,}$/;
  return phoneRegex.test(phone);
};

// Sanitize user input
const sanitizeInput = (input) => {
  if (typeof input === 'string') {
    return input.trim().replace(/[<>]/g, '');
  }
  return input;
};

// Generate secure random string
const generateSecureToken = (length = 32) => {
  return require('crypto').randomBytes(length).toString('hex');
};

// Check if user is verified
const isUserVerified = (user) => {
  return user.emailVerified && user.status === 'active';
};

// Check if user needs verification
const needsVerification = (user) => {
  return !user.emailVerified || user.status !== 'active';
};

module.exports = {
  generateToken,
  generateRefreshToken,
  verifyToken,
  verifyRefreshToken,
  extractTokenFromHeader,
  authenticate,
  authorize,
  requireAdmin,
  requireVendorOrAdmin,
  optionalAuth,
  requireOwnership,
  requireVendorOwnership,
  authRateLimit,
  createSession,
  validateSession,
  invalidateSession,
  hashPassword,
  comparePassword,
  generateEmailVerificationToken,
  generatePasswordResetToken,
  hashToken,
  isValidEmail,
  isValidPhone,
  sanitizeInput,
  generateSecureToken,
  isUserVerified,
  needsVerification
};
