const logger = require('../utils/logger');
const config = require('../config');

/**
 * Global Error Handler Middleware
 */

// 404 Not Found handler
const notFoundHandler = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  error.status = 404;
  next(error);
};

// Global error handler
const errorHandler = (err, req, res, next) => {
  let statusCode = err.status || err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  
  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
  } else if (err.name === 'UnauthorizedError' || err.message?.includes('unauthorized')) {
    statusCode = 401;
  } else if (err.name === 'ForbiddenError' || err.message?.includes('forbidden')) {
    statusCode = 403;
  } else if (err.name === 'NotFoundError' || err.status === 404) {
    statusCode = 404;
  } else if (err.isGatewayError) {
    statusCode = 502; // Bad Gateway for upstream errors
  }

  // Log error
  const errorContext = {
    statusCode,
    path: req.path,
    method: req.method,
    ip: req.ip,
    correlationId: req.correlationId,
    stack: config.server.env === 'development' ? err.stack : undefined
  };

  if (statusCode >= 500) {
    logger.logError(err, errorContext);
  } else {
    logger.warn(message, { ...errorContext, type: 'client_error' });
  }

  // Prepare error response
  const errorResponse = {
    success: false,
    message: sanitizeErrorMessage(message, statusCode),
    ...(config.server.env === 'development' && {
      stack: err.stack,
      originalError: err.message
    })
  };

  // Add validation errors if present
  if (err.errors && Array.isArray(err.errors)) {
    errorResponse.errors = err.errors;
  }

  res.status(statusCode).json(errorResponse);
};

/**
 * Sanitize error message for client (hide sensitive info in production)
 * @param {string} message - Original error message
 * @param {number} statusCode - HTTP status code
 * @returns {string} - Sanitized message
 */
const sanitizeErrorMessage = (message, statusCode) => {
  // In production, hide internal error details for 500 errors
  if (config.server.env === 'production' && statusCode >= 500) {
    return 'An internal server error occurred';
  }
  
  // Don't expose sensitive information
  const sensitivePatterns = [
    /password/i,
    /secret/i,
    /token/i,
    /key/i,
    /private/i,
    /credential/i
  ];
  
  let sanitized = message;
  sensitivePatterns.forEach(pattern => {
    if (pattern.test(sanitized)) {
      sanitized = 'Invalid request parameters';
    }
  });
  
  return sanitized;
};

// Async handler wrapper for controllers
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Custom error classes
class ValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    this.errors = errors;
  }
}

class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
    this.status = 401;
  }
}

class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
    this.status = 403;
  }
}

class NotFoundError extends Error {
  constructor(message = 'Not Found') {
    super(message);
    this.name = 'NotFoundError';
    this.status = 404;
  }
}

class GatewayError extends Error {
  constructor(message = 'Gateway Error', originalError = null) {
    super(message);
    this.name = 'GatewayError';
    this.status = 502;
    this.isGatewayError = true;
    this.originalError = originalError;
  }
}

module.exports = {
  notFoundHandler,
  errorHandler,
  asyncHandler,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  GatewayError
};
