const db = require('../config/database');
const logger = require('../utils/logger');

/**
 * RechargeRepository - Repository layer for recharge/transaction data
 * Uses MySQL database for persistent storage
 */
class RechargeRepository {
  constructor() {
    this.callbackHistory = new Map(); // In-memory for duplicate detection
  }

  /**
   * Generate random 10-digit mobile number
   */
  generateRandomMobile() {
    const prefix = ['9', '8', '7'][Math.floor(Math.random() * 3)];
    const remaining = Math.floor(Math.random() * 1000000000).toString().padStart(9, '0');
    return prefix + remaining;
  }

  /**
   * Extract numeric user ID from client_user_id string
   * @param {string} clientUserId - Client user ID (e.g., "USER123" or "123")
   * @returns {number} - Numeric user ID
   */
  extractUserId(clientUserId) {
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
  }

  /**
   * Create a new recharge record in MySQL
   * @param {Object} data - Recharge data
   * @param {string} data.client_transaction_id - Client transaction ID
   * @param {string} data.client_user_id - Client user ID
   * @param {number} data.amount - Transaction amount
   * @param {string} data.method - Payment method
   * @param {string} data.gateway_transaction_id - EINPAY transaction ID
   * @param {string} data.status - Transaction status
   * @returns {Promise<Object>} - Created recharge record
   */
  async createRecharge(data) {
    const tableName = db.getTableName();
    
    try {
      // Extract user ID and generate mobile
      const userId = this.extractUserId(data.client_user_id);
      const userMobile = this.generateRandomMobile();
      
      // Get current date and time
      const now = new Date();
      const date = now.toISOString().split('T')[0];
      const time = now.toTimeString().split(' ')[0];
      
      // Insert into recharge table
      const sql = `
        INSERT INTO ${tableName} (
          recharge_id, order_id, userId, user_mobile, 
          recharge_amount, recharge_type, payment_mode, 
          date, time, recharge_status, isDepAdded, gateway_transaction_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      // Format payment_mode for database: EINPAY(P2P), EINPAY(NATIVE), or EINPAY
      let dbPaymentMode;
      if (data.payment_mode) {
        const modeUpper = data.payment_mode.toUpperCase();
        if (modeUpper === 'P2P' || modeUpper === 'NATIVE') {
          dbPaymentMode = `EINPAY(${modeUpper})`;
        } else {
          dbPaymentMode = 'EINPAY';
        }
      } else {
        dbPaymentMode = 'EINPAY';
      }

      const params = [
        data.client_transaction_id,  // recharge_id
        data.client_transaction_id,  // order_id (same as recharge_id)
        userId,                         // userId
        userMobile,                     // user_mobile (random 10 digit)
        data.amount,                    // recharge_amount
        'INR',                          // recharge_type (fixed)
        dbPaymentMode,                  // payment_mode: EINPAY(P2P), EINPAY(NATIVE), or EINPAY
        date,                           // date
        time,                           // time
        'PENDING',                      // recharge_status
        0,                              // isDepAdded
        data.gateway_transaction_id || null  // gateway_transaction_id (EINPAY's order ID)
      ];
      
      const result = await db.query(sql, params);
      
      logger.info('Recharge record created in database', {
        operation: 'create_recharge',
        client_transaction_id: data.client_transaction_id,
        user_id: userId,
        amount: data.amount,
        payment_mode: dbPaymentMode,
        insert_id: result.insertId
      });

      return {
        success: true,
        data: {
          recharge_id: data.client_transaction_id,
          order_id: data.client_transaction_id,
          userId: userId,
          user_mobile: userMobile,
          recharge_amount: data.amount,
          recharge_type: 'INR',
          payment_mode: dbPaymentMode,
          date: date,
          time: time,
          recharge_status: 'PENDING',
          isDepAdded: 0,
          gateway_transaction_id: data.gateway_transaction_id || null
        },
        message: 'Recharge record created successfully'
      };
    } catch (error) {
      logger.error('Failed to create recharge record', {
        operation: 'create_recharge_failed',
        client_transaction_id: data.client_transaction_id,
        error: error.message
      });
      
      return {
        success: false,
        data: null,
        message: `Failed to create recharge: ${error.message}`
      };
    }
  }

  /**
   * Update recharge status
   * @param {string} clientTransactionId - Client transaction ID
   * @param {string} status - New status (APPROVED, REJECTED, PENDING)
   * @param {Object} additionalData - Additional data to update
   * @returns {Promise<Object>} - Updated recharge record
   */
  async updateRechargeStatus(clientTransactionId, status, additionalData = {}) {
    const tableName = db.getTableName();
    
    try {
      // Map EINPAY status to recharge_status
      let rechargeStatus = 'PENDING';
      let isDepAdded = 0;
      
      switch (status.toUpperCase()) {
        case 'APPROVED':
        case 'SUCCESS':
        case 'COMPLETED':
          rechargeStatus = 'SUCCESS';
          isDepAdded = 1;
          break;
        case 'REJECTED':
        case 'FAILED':
          rechargeStatus = 'FAILED';
          break;
        case 'PENDING':
        default:
          rechargeStatus = 'PENDING';
      }
      
      // Build update SQL - include gateway_transaction_id if provided
      let sql = `UPDATE ${tableName} SET recharge_status = ?, isDepAdded = ?`;
      let params = [rechargeStatus, isDepAdded];
      
      // Update gateway_transaction_id if provided in additionalData
      if (additionalData.gateway_transaction_id) {
        sql += `, gateway_transaction_id = ?`;
        params.push(additionalData.gateway_transaction_id);
      }
      
      sql += ` WHERE order_id = ?`;
      params.push(clientTransactionId);
      
      const result = await db.query(sql, params);
      
      logger.info('Recharge status updated in database', {
        operation: 'update_status',
        client_transaction_id: clientTransactionId,
        status: rechargeStatus,
        isDepAdded: isDepAdded,
        affected_rows: result.affectedRows
      });

      return {
        success: true,
        data: {
          order_id: clientTransactionId,
          recharge_status: rechargeStatus,
          isDepAdded: isDepAdded,
          gateway_transaction_id: additionalData.gateway_transaction_id
        },
        message: 'Recharge status updated successfully'
      };
    } catch (error) {
      logger.error('Failed to update recharge status', {
        operation: 'update_status_failed',
        client_transaction_id: clientTransactionId,
        error: error.message
      });
      
      return {
        success: false,
        data: null,
        message: `Failed to update status: ${error.message}`
      };
    }
  }

  /**
   * Find recharge by EINPAY gateway transaction ID
   * @param {string} gatewayTransactionId - EINPAY transaction ID (gateway_transaction_id)
   * @returns {Promise<Object|null>} - Recharge record or null
   */
  async findRechargeByGatewayTransactionId(gatewayTransactionId) {
    const tableName = db.getTableName();
    
    try {
      const sql = `SELECT * FROM ${tableName} WHERE gateway_transaction_id = ? LIMIT 1`;
      const params = [gatewayTransactionId];
      
      const results = await db.query(sql, params);
      
      if (results && results.length > 0) {
        logger.info('Recharge found by gateway transaction ID', {
          operation: 'find_by_gateway_txn_id',
          gateway_transaction_id: gatewayTransactionId,
          client_transaction_id: results[0].order_id,
          status: results[0].recharge_status
        });
        
        return {
          success: true,
          data: results[0],
          message: 'Recharge found'
        };
      }
      
      return {
        success: false,
        data: null,
        message: 'Recharge not found by gateway transaction ID'
      };
    } catch (error) {
      logger.error('Failed to find recharge by gateway transaction ID', {
        operation: 'find_by_gateway_txn_id_failed',
        gateway_transaction_id: gatewayTransactionId,
        error: error.message
      });
      
      return {
        success: false,
        data: null,
        message: `Failed to find recharge: ${error.message}`
      };
    }
  }

  /**
   * Find recharge by client transaction ID (order_id)
   * @param {string} clientTransactionId - Client transaction ID
   * @returns {Promise<Object|null>} - Recharge record or null
   */
  async findRechargeByClientTransactionId(clientTransactionId) {
    const tableName = db.getTableName();
    
    try {
      const sql = `SELECT * FROM ${tableName} WHERE order_id = ? OR recharge_id = ? LIMIT 1`;
      const params = [clientTransactionId, clientTransactionId];
      
      const results = await db.query(sql, params);
      
      if (results && results.length > 0) {
        logger.info('Recharge found in database', {
          operation: 'find_by_client_txn_id',
          client_transaction_id: clientTransactionId,
          status: results[0].recharge_status
        });
        
        return {
          success: true,
          data: results[0],
          message: 'Recharge found'
        };
      }
      
      return {
        success: false,
        data: null,
        message: 'Recharge not found'
      };
    } catch (error) {
      logger.error('Failed to find recharge', {
        operation: 'find_recharge_failed',
        client_transaction_id: clientTransactionId,
        error: error.message
      });
      
      return {
        success: false,
        data: null,
        message: `Failed to find recharge: ${error.message}`
      };
    }
  }

  /**
   * Save callback data for audit trail
   * @param {string} transactionId - Transaction ID
   * @param {Object} callbackData - Callback payload data
   * @returns {Promise<Object>} - Saved callback record
   */
  async saveCallbackData(transactionId, callbackData) {
    logger.info('Saving callback data', {
      operation: 'save_callback',
      transaction_id: transactionId,
      status: callbackData.status
    });

    // Check for duplicate callback
    const callbackKey = `${transactionId}_${callbackData.status}`;
    if (this.callbackHistory.has(callbackKey)) {
      return {
        success: false,
        isDuplicate: true,
        message: 'Duplicate callback detected'
      };
    }

    // Store callback in memory
    this.callbackHistory.set(callbackKey, {
      transaction_id: transactionId,
      payload: callbackData,
      received_at: new Date().toISOString()
    });

    return {
      success: true,
      message: 'Callback data saved'
    };
  }

  /**
   * Check if callback is a duplicate
   * @param {string} transactionId - Transaction ID
   * @param {string} status - Callback status
   * @returns {Promise<boolean>} - True if duplicate
   */
  async isDuplicateCallback(transactionId, status) {
    const callbackKey = `${transactionId}_${status}`;
    return this.callbackHistory.has(callbackKey);
  }

  /**
   * Get all pending transactions
   * @param {number} limit - Maximum number of records
   * @returns {Promise<Array>} - Array of pending transactions
   */
  async getPendingTransactions(limit = 100) {
    const tableName = db.getTableName();
    
    try {
      const sql = `SELECT * FROM ${tableName} WHERE recharge_status = 'PENDING' ORDER BY created_at DESC LIMIT ?`;
      const params = [limit];
      
      const results = await db.query(sql, params);
      
      logger.info('Retrieved pending transactions', {
        operation: 'get_pending',
        count: results.length
      });

      return {
        success: true,
        data: results,
        count: results.length,
        message: 'Pending transactions retrieved'
      };
    } catch (error) {
      logger.error('Failed to get pending transactions', {
        operation: 'get_pending_failed',
        error: error.message
      });
      
      return {
        success: false,
        data: [],
        count: 0,
        message: `Failed to get pending: ${error.message}`
      };
    }
  }

  /**
   * Check if transaction exists (for duplicate prevention)
   * @param {string} clientTransactionId - Client transaction ID
   * @returns {Promise<boolean>} - True if exists
   */
  async transactionExists(clientTransactionId) {
    const result = await this.findRechargeByClientTransactionId(clientTransactionId);
    return result.success && result.data !== null;
  }
}

// Export singleton instance
module.exports = new RechargeRepository();
