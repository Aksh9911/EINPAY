const express = require('express');
const { security, errorHandler } = require('./src/middlewares');
const routes = require('./src/routes');

/**
 * Create Express application
 * @returns {Express.Application} - Configured Express app
 */
function createApp() {
  const app = express();

  // Security middleware
  app.use(security.helmet);
  app.use(security.cors);
  app.use(security.correlationId);
  app.use(security.sanitizeRequest);

  // Body parsing middleware
  // Handle raw body for JWT callbacks
  app.use(express.text({ 
    type: 'text/plain',
    limit: '10mb'
  }));
  
  app.use(express.json({ 
    limit: '10mb',
    verify: (req, res, buf) => {
      // Store raw body for signature verification
      req.rawBody = buf.toString('utf8');
    }
  }));
  
  app.use(express.urlencoded({ 
    extended: true, 
    limit: '10mb' 
  }));

  // Rate limiting
  app.use(security.apiLimiter);

  // Request logging
  app.use((req, res, next) => {
    const { logger } = require('./src/utils');
    logger.logRequest({
      method: req.method,
      path: req.path,
      ip: req.ip,
      correlation_id: req.correlationId,
      user_agent: req.get('user-agent')
    });
    next();
  });

  // Routes
  app.use(routes);

  // 404 handler
  app.use(errorHandler.notFoundHandler);

  // Global error handler
  app.use(errorHandler.errorHandler);

  return app;
}

module.exports = createApp;
