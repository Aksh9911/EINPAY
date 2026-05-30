const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Security Middleware Configuration
 */

// Helmet configuration for security headers
const helmetConfig = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", config.einpay.baseUrl],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  dnsPrefetchControl: { allow: false },
  frameguard: { action: 'deny' },
  hidePoweredBy: true,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  ieNoOpen: true,
  noSniff: true,
  originAgentCluster: true,
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true,
};

// CORS configuration - Allow all origins
const corsOptions = {
  origin: true, // Allow all origins
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'X-Correlation-ID'
  ],
  credentials: true,
  maxAge: 86400, // 24 hours
  preflightContinue: false,
  optionsSuccessStatus: 204
};

// Rate limiting for API endpoints
const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`, {
      ip: req.ip,
      path: req.path,
      method: req.method
    });
    res.status(429).json(options.message);
  },
  skip: (req) => {
    // Skip rate limiting for health check
    return req.path === '/health';
  }
});

// Stricter rate limit for sensitive endpoints
const strictLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // 10 requests per 5 minutes
  message: {
    success: false,
    message: 'Too many requests to this endpoint, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    logger.warn(`Strict rate limit exceeded for IP: ${req.ip}`, {
      ip: req.ip,
      path: req.path,
      method: req.method
    });
    res.status(429).json(options.message);
  }
});

// Request sanitization middleware
const sanitizeRequest = (req, res, next) => {
  // Remove potential harmful characters from request body
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  
  // Sanitize query parameters
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeObject(req.query);
  }
  
  next();
};

/**
 * Sanitize object values recursively
 * @param {Object} obj - Object to sanitize
 * @returns {Object} - Sanitized object
 */
const sanitizeObject = (obj) => {
  const sanitized = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      // Remove null bytes and trim
      sanitized[key] = value.replace(/\x00/g, '').trim();
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeObject(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item => 
        typeof item === 'object' && item !== null 
          ? sanitizeObject(item) 
          : typeof item === 'string' 
            ? item.replace(/\x00/g, '').trim() 
            : item
      );
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
};

// Request size limit middleware
const requestSizeLimit = (maxSize = '10mb') => {
  return (req, res, next) => {
    const contentLength = parseInt(req.headers['content-length'], 10);
    const maxBytes = parseInt(maxSize) * 1024 * 1024;
    
    if (contentLength && contentLength > maxBytes) {
      return res.status(413).json({
        success: false,
        message: 'Request entity too large'
      });
    }
    
    next();
  };
};

// Correlation ID middleware for request tracing
const correlationId = (req, res, next) => {
  const id = req.headers['x-correlation-id'] || 
             req.headers['x-request-id'] || 
             generateCorrelationId();
  
  req.correlationId = id;
  res.setHeader('X-Correlation-ID', id);
  res.setHeader('X-Request-ID', id);
  
  next();
};

/**
 * Generate correlation ID
 * @returns {string} - Unique correlation ID
 */
const generateCorrelationId = () => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

// IP whitelist middleware (for callback verification)
const ipWhitelist = (allowedIPs) => {
  return (req, res, next) => {
    const clientIP = req.ip || 
                      req.connection.remoteAddress || 
                      req.socket.remoteAddress || 
                      (req.connection.socket ? req.connection.socket.remoteAddress : null);
    
    if (!allowedIPs || allowedIPs.length === 0) {
      return next();
    }
    
    if (allowedIPs.includes(clientIP)) {
      return next();
    }
    
    logger.warn(`Blocked request from unauthorized IP: ${clientIP}`, {
      ip: clientIP,
      path: req.path
    });
    
    return res.status(403).json({
      success: false,
      message: 'Access denied'
    });
  };
};

module.exports = {
  helmet: helmet(helmetConfig),
  cors: cors(corsOptions),
  apiLimiter,
  strictLimiter,
  sanitizeRequest,
  requestSizeLimit,
  correlationId,
  ipWhitelist
};
