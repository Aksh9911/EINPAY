const db = require('../config/database');
const logger = require('../utils/logger');

/**
 * Middleware to validate user status before allowing recharge
 * Checks if user status is 1 (active) in the users table
 */
const validateUserStatus = async (req, res, next) => {
  const correlationId = req.correlationId;
  const clientUserId = req.body.client_user_id;

  if (!clientUserId) {
    return res.status(400).json({
      success: false,
      message: 'client_user_id is required',
      correlation_id: correlationId
    });
  }

  try {
    // Extract numeric user ID from client_user_id (same logic as RechargeRepository)
    const extractUserId = (clientUserId) => {
      if (!clientUserId) return 0;
      
      // Try to extract numeric part from strings like "USER123"
      const numericMatch = clientUserId.toString().match(/\d+/);
      if (numericMatch) {
        return parseInt(numericMatch[0], 10);
      }
      
      // If no numeric part, use hash of string
      let hash = 0;
      for (let i = 0; i < clientUserId.length; i++) {
        hash = ((hash << 5) - hash) + clientUserId.charCodeAt(i);
        hash = hash & hash; // Convert to 32bit integer
      }
      return Math.abs(hash) || 1;
    };

    const userId = extractUserId(clientUserId);

    // Query users table to check status
    const sql = 'SELECT status FROM users WHERE id = ? LIMIT 1';
    const results = await db.query(sql, [userId]);

    if (results && results.length > 0) {
      const userStatus = results[0].status;
      
      logger.info('User status check', {
        operation: 'user_status_validation',
        correlation_id: correlationId,
        client_user_id: clientUserId,
        user_id: userId,
        status: userStatus
      });

      if (userStatus !== 1) {
        logger.warn('User not allowed to recharge - invalid status', {
          operation: 'user_status_denied',
          correlation_id: correlationId,
          client_user_id: clientUserId,
          user_id: userId,
          status: userStatus
        });

        return res.status(403).json({
          success: false,
          message: 'Not allowed to recharge - user account is not active',
          correlation_id: correlationId
        });
      }

      // User status is 1, proceed with the request
      req.userStatus = userStatus;
      req.userId = userId;
      next();
    } else {
      // User not found in database
      logger.warn('User not found in database', {
        operation: 'user_not_found',
        correlation_id: correlationId,
        client_user_id: clientUserId,
        user_id: userId
      });

      return res.status(404).json({
        success: false,
        message: 'User not found',
        correlation_id: correlationId
      });
    }
  } catch (error) {
    logger.error('Error validating user status', {
      operation: 'user_status_validation_error',
      correlation_id: correlationId,
      client_user_id: clientUserId,
      error: error.message
    });

    return res.status(500).json({
      success: false,
      message: 'Error validating user status',
      correlation_id: correlationId
    });
  }
};

module.exports = {
  validateUserStatus
};
