const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

/**
 * Create a rate limiter for recharge endpoints
 * Limits requests to prevent spamming of recharge functionality
 */
const createRechargeRateLimiter = () => {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 recharge requests per windowMs
    message: {
      success: false,
      message: 'Too many recharge attempts. Please try again later.',
      retryAfter: '15 minutes'
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    handler: (req, res) => {
      logger.warn('Rate limit exceeded for recharge endpoint', {
        ip: req.ip,
        user_agent: req.get('user-agent'),
        path: req.path,
        correlation_id: req.correlationId
      });
      
      res.status(429).json({
        success: false,
        message: 'Too many recharge attempts. Please try again later.',
        retryAfter: '15 minutes',
        correlation_id: req.correlationId
      });
    }
  });
};

/**
 * Create a stricter rate limiter for order creation
 * Limits requests to prevent spamming of order creation API
 */
const createOrderRateLimiter = () => {
  return rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 3, // Limit each IP to 3 order creation requests per windowMs
    message: {
      success: false,
      message: 'Too many order creation attempts. Please try again later.',
      retryAfter: '5 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn('Rate limit exceeded for order creation', {
        ip: req.ip,
        user_agent: req.get('user-agent'),
        path: req.path,
        correlation_id: req.correlationId
      });
      
      res.status(429).json({
        success: false,
        message: 'Too many order creation attempts. Please try again later.',
        retryAfter: '5 minutes',
        correlation_id: req.correlationId
      });
    }
  });
};

module.exports = {
  createRechargeRateLimiter,
  createOrderRateLimiter
};
