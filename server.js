const createApp = require('./app');
const config = require('./src/config');
const { KeyManager } = require('./src/services');
const db = require('./src/config/database');
const logger = require('./src/utils/logger');

/**
 * EINPAY Gateway Server
 * Production-ready Node.js microservice for EINPAY integration
 */

async function startServer() {
  try {
    // Initialize KeyManager - this will fail if keys are missing
    logger.info('Starting EINPAY Gateway Server...');
    logger.info(`Environment: ${config.server.env}`);
    logger.info(`Node Version: ${process.version}`);

    // Initialize keys (required for application startup)
    try {
      KeyManager.initialize();
      logger.info('KeyManager initialized successfully');
    } catch (keyError) {
      logger.logError(keyError, { context: 'Server startup - Key initialization failed' });
      console.error('\n❌ CRITICAL ERROR: Key initialization failed');
      console.error('Please ensure all required PEM files are placed in the /keys directory:');
      console.error('  - private.pem (Your RSA private key)');
      console.error('  - public.pem (Your RSA public key)');
      console.error('  - einpay-api-public.pem (EINPAY API public key)');
      console.error('  - einpay-callback-public.pem (EINPAY callback public key)\n');
      process.exit(1);
    }

    // Initialize Database Connection
    try {
      await db.initialize();
      logger.info('Database connection established successfully');
    } catch (dbError) {
      logger.logError(dbError, { context: 'Server startup - Database initialization failed' });
      console.error('\n❌ CRITICAL ERROR: Database connection failed');
      console.error('Please ensure MySQL is running and credentials are correct:');
      console.error(`  - Host: ${config.database.host}`);
      console.error(`  - Database: ${config.database.name}`);
      console.error(`  - User: ${config.database.user}\n`);
      process.exit(1);
    }

    // Create and configure Express app
    const app = createApp();

    // Start server
    const server = app.listen(config.server.port, () => {
      logger.info(`✅ EINPAY Gateway Server started successfully`);
      logger.info(`📡 Listening on port: ${config.server.port}`);
      logger.info(`🔗 Base URL: ${config.server.baseUrl}`);
      logger.info(`🏥 Health Check: ${config.server.baseUrl}/health`);
    });

    // Graceful shutdown handling
    const gracefulShutdown = (signal) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);
      
      server.close(() => {
        logger.info('HTTP server closed');
        
        // Close any other connections/resources here
        // For example: database connections, message queue connections, etc.
        
        logger.info('Graceful shutdown completed');
        process.exit(0);
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        logger.error('Forced shutdown due to timeout');
        process.exit(1);
      }, 30000);
    };

    // Handle shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.logError(error, { context: 'Uncaught Exception' });
      console.error('Uncaught Exception:', error);
      
      // Graceful shutdown
      gracefulShutdown('uncaughtException');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.logError(new Error(reason), { 
        context: 'Unhandled Rejection',
        promise: promise.toString()
      });
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    return server;

  } catch (error) {
    logger.logError(error, { context: 'Server startup failed' });
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server if this file is run directly
if (require.main === module) {
  startServer();
}

module.exports = startServer;
