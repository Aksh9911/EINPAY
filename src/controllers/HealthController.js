const os = require('os');
const config = require('../config');
const KeyManager = require('../services/KeyManager');
const logger = require('../utils/logger');

/**
 * HealthController - Handles health check endpoints
 */
class HealthController {
  /**
   * Basic health check
   * GET /health
   */
  async checkHealth(req, res) {
    const healthStatus = {
      status: 'ok',
      service: 'einpay',
      environment: config.server.env,
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    };

    return res.status(200).json(healthStatus);
  }

  /**
   * Detailed health check with system info
   * GET /health/detailed
   */
  async checkDetailedHealth(req, res) {
    const correlationId = req.correlationId;

    try {
      const memoryUsage = process.memoryUsage();
      const systemInfo = {
        status: 'ok',
        service: 'einpay',
        environment: config.server.env,
        timestamp: new Date().toISOString(),
        uptime: {
          seconds: process.uptime(),
          formatted: this.formatUptime(process.uptime())
        },
        version: {
          node: process.version,
          service: require('../../package.json').version
        },
        memory: {
          used: this.formatBytes(memoryUsage.heapUsed),
          total: this.formatBytes(memoryUsage.heapTotal),
          rss: this.formatBytes(memoryUsage.rss),
          external: this.formatBytes(memoryUsage.external || 0)
        },
        system: {
          platform: process.platform,
          arch: process.arch,
          cpus: os.cpus().length,
          total_memory: this.formatBytes(os.totalmem()),
          free_memory: this.formatBytes(os.freemem()),
          load_average: os.loadavg()
        },
        configuration: {
          client_id: config.einpay.clientId,
          base_url: config.server.baseUrl,
          einpay_base_url: config.einpay.baseUrl,
          log_level: config.logging.level
        }
      };

      return res.status(200).json(systemInfo);

    } catch (error) {
      logger.logError(error, {
        operation: 'detailed_health_check_failed',
        correlation_id: correlationId
      });

      return res.status(500).json({
        status: 'error',
        message: error.message,
        correlation_id: correlationId
      });
    }
  }

  /**
   * Readiness check - verifies all dependencies are ready
   * GET /health/ready
   */
  async checkReadiness(req, res) {
    const checks = {
      keys: false,
      configuration: false
    };

    try {
      // Check keys
      const keyStatus = KeyManager.getKeyStatus();
      checks.keys = keyStatus.initialized && 
                     keyStatus.hasPrivateKey && 
                     keyStatus.hasPublicKey && 
                     keyStatus.hasEinpayApiKey && 
                     keyStatus.hasEinpayCallbackKey;

      // Check configuration
      checks.configuration = config.einpay.clientId > 0 && 
                            !!config.einpay.baseUrl &&
                            !!config.server.baseUrl;

      const allReady = Object.values(checks).every(check => check === true);

      const response = {
        ready: allReady,
        checks: checks,
        timestamp: new Date().toISOString()
      };

      const statusCode = allReady ? 200 : 503;
      return res.status(statusCode).json(response);

    } catch (error) {
      logger.logError(error, {
        operation: 'readiness_check_failed'
      });

      return res.status(503).json({
        ready: false,
        checks: checks,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Liveness check - verifies the service is alive
   * GET /health/live
   */
  async checkLiveness(req, res) {
    return res.status(200).json({
      alive: true,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Key status check
   * GET /health/keys
   */
  async checkKeyStatus(req, res) {
    try {
      const keyStatus = KeyManager.getKeyStatus();

      return res.status(200).json({
        success: true,
        keys: {
          initialized: keyStatus.initialized,
          merchant_private: {
            loaded: keyStatus.hasPrivateKey,
            length: keyStatus.privateKeyLength
          },
          merchant_public: {
            loaded: keyStatus.hasPublicKey,
            length: keyStatus.publicKeyLength
          },
          einpay_api_public: {
            loaded: keyStatus.hasEinpayApiKey,
            length: keyStatus.einpayApiKeyLength
          },
          einpay_callback_public: {
            loaded: keyStatus.hasEinpayCallbackKey,
            length: keyStatus.einpayCallbackKeyLength
          }
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.logError(error, {
        operation: 'key_status_check_failed'
      });

      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * Format uptime to human-readable string
   * @param {number} seconds - Uptime in seconds
   * @returns {string} - Formatted uptime
   */
  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    parts.push(`${secs}s`);

    return parts.join(' ');
  }

  /**
   * Format bytes to human-readable string
   * @param {number} bytes - Bytes to format
   * @returns {string} - Formatted string
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

module.exports = new HealthController();
