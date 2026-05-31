const logger = require('../utils/logger');

/**
 * PayoutRepository - Repository layer for payout/withdrawal data
 *
 * TODO: Connect to MySQL withdraw table when ready.
 * All methods are prepared for future DB integration.
 * In-memory maps are used for duplicate detection in the interim.
 */
class PayoutRepository {
  constructor() {
    // In-memory store for duplicate detection (replace with DB queries when table is ready)
    this.pendingRequests = new Map();   // request_id -> payout record
    this.payoutsByClientTxnId = new Map(); // client_transaction_id -> payout record
    this.callbackHistory = new Map();   // `${transaction_id}_${status}` -> callback data
  }

  /**
   * Create a new payout record
   * @param {Object} data
   * @param {string} data.client_transaction_id
   * @param {string} data.client_user_id
   * @param {number} data.amount
   * @param {string} data.requested_method
   * @param {string} data.request_id            - Returned by EINPAY getform
   * @param {string} data.valid_until            - Returned by EINPAY getform
   * @param {Array}  data.required_information   - Dynamic fields from EINPAY
   * @param {string} data.status                 - 'PENDING'
   * @returns {Promise<Object>}
   */
  async createPayout(data) {
    try {
      logger.info('Creating payout record', {
        operation: 'create_payout',
        client_transaction_id: data.client_transaction_id,
        amount: data.amount
      });

      const record = {
        client_transaction_id: data.client_transaction_id,
        client_user_id: data.client_user_id,
        amount: data.amount,
        requested_method: data.requested_method,
        request_id: data.request_id,
        valid_until: data.valid_until,
        required_information: data.required_information || [],
        transaction_id: null,
        status: data.status || 'PENDING',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // TODO: INSERT INTO withdraw (or payout) table when ready
      // const sql = `INSERT INTO withdraws (client_transaction_id, client_user_id, amount,
      //   requested_method, request_id, valid_until, status, created_at, updated_at)
      //   VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`;
      // await db.query(sql, [...]);

      // In-memory store
      this.payoutsByClientTxnId.set(data.client_transaction_id, record);
      if (data.request_id) {
        this.pendingRequests.set(data.request_id, record);
      }

      return {
        success: true,
        data: record,
        message: 'Payout record created successfully'
      };
    } catch (error) {
      logger.error('Failed to create payout record', {
        operation: 'create_payout_failed',
        client_transaction_id: data.client_transaction_id,
        error: error.message
      });

      return {
        success: false,
        data: null,
        message: `Failed to create payout: ${error.message}`
      };
    }
  }

  /**
   * Update payout status after submit or callback
   * @param {string} clientTransactionId
   * @param {string} status - New status string
   * @param {Object} additionalData
   * @returns {Promise<Object>}
   */
  async updatePayoutStatus(clientTransactionId, status, additionalData = {}) {
    try {
      logger.info('Updating payout status', {
        operation: 'update_payout_status',
        client_transaction_id: clientTransactionId,
        status
      });

      const record = this.payoutsByClientTxnId.get(clientTransactionId);

      if (record) {
        record.status = status;
        record.updated_at = new Date().toISOString();

        if (additionalData.transaction_id) {
          record.transaction_id = additionalData.transaction_id;
        }

        Object.assign(record, additionalData);
        this.payoutsByClientTxnId.set(clientTransactionId, record);

        if (record.request_id) {
          this.pendingRequests.set(record.request_id, record);
        }
      }

      // TODO: UPDATE withdraws SET status = ?, updated_at = NOW()
      //   WHERE client_transaction_id = ?
      // await db.query(sql, [status, clientTransactionId]);

      return {
        success: true,
        data: record || { client_transaction_id: clientTransactionId, status },
        message: 'Payout status updated successfully'
      };
    } catch (error) {
      logger.error('Failed to update payout status', {
        operation: 'update_payout_status_failed',
        client_transaction_id: clientTransactionId,
        error: error.message
      });

      return {
        success: false,
        data: null,
        message: `Failed to update payout status: ${error.message}`
      };
    }
  }

  /**
   * Save payout callback data for audit
   * @param {string} transactionId
   * @param {Object} callbackData
   * @returns {Promise<Object>}
   */
  async saveCallback(transactionId, callbackData) {
    try {
      logger.info('Saving payout callback data', {
        operation: 'save_payout_callback',
        transaction_id: transactionId,
        status: callbackData.transaction_status
      });

      const callbackKey = `${transactionId}_${callbackData.transaction_status}`;

      if (this.callbackHistory.has(callbackKey)) {
        return {
          success: false,
          isDuplicate: true,
          message: 'Duplicate payout callback detected'
        };
      }

      this.callbackHistory.set(callbackKey, {
        transaction_id: transactionId,
        payload: callbackData,
        received_at: new Date().toISOString()
      });

      // TODO: INSERT INTO payout_callbacks (transaction_id, status, payload, received_at)
      // await db.query(sql, [...]);

      return {
        success: true,
        isDuplicate: false,
        message: 'Payout callback saved'
      };
    } catch (error) {
      logger.error('Failed to save payout callback', {
        operation: 'save_payout_callback_failed',
        transaction_id: transactionId,
        error: error.message
      });

      return {
        success: false,
        data: null,
        message: `Failed to save payout callback: ${error.message}`
      };
    }
  }

  /**
   * Check if payout callback is a duplicate
   * @param {string} transactionId
   * @param {string} status
   * @returns {Promise<boolean>}
   */
  async isDuplicateCallback(transactionId, status) {
    const callbackKey = `${transactionId}_${status}`;
    return this.callbackHistory.has(callbackKey);
  }

  /**
   * Find payout by EINPAY transaction_id
   * @param {string} transactionId
   * @returns {Promise<Object>}
   */
  async findByTransactionId(transactionId) {
    try {
      // TODO: SELECT * FROM withdraws WHERE transaction_id = ? LIMIT 1
      // const results = await db.query(sql, [transactionId]);

      for (const [, record] of this.payoutsByClientTxnId) {
        if (record.transaction_id === transactionId) {
          return {
            success: true,
            data: record,
            message: 'Payout found'
          };
        }
      }

      return {
        success: false,
        data: null,
        message: 'Payout not found by transaction_id'
      };
    } catch (error) {
      logger.error('Failed to find payout by transaction_id', {
        operation: 'find_payout_by_txn_id_failed',
        transaction_id: transactionId,
        error: error.message
      });

      return {
        success: false,
        data: null,
        message: `Failed to find payout: ${error.message}`
      };
    }
  }

  /**
   * Find payout by client_transaction_id
   * @param {string} clientTransactionId
   * @returns {Promise<Object>}
   */
  async findByClientTransactionId(clientTransactionId) {
    try {
      // TODO: SELECT * FROM withdraws WHERE client_transaction_id = ? LIMIT 1
      // const results = await db.query(sql, [clientTransactionId]);

      const record = this.payoutsByClientTxnId.get(clientTransactionId);

      if (record) {
        return {
          success: true,
          data: record,
          message: 'Payout found'
        };
      }

      return {
        success: false,
        data: null,
        message: 'Payout not found'
      };
    } catch (error) {
      logger.error('Failed to find payout by client_transaction_id', {
        operation: 'find_payout_by_client_txn_id_failed',
        client_transaction_id: clientTransactionId,
        error: error.message
      });

      return {
        success: false,
        data: null,
        message: `Failed to find payout: ${error.message}`
      };
    }
  }

  /**
   * Find payout by EINPAY request_id
   * @param {string} requestId
   * @returns {Promise<Object>}
   */
  async findByRequestId(requestId) {
    try {
      // TODO: SELECT * FROM withdraws WHERE request_id = ? LIMIT 1
      // const results = await db.query(sql, [requestId]);

      const record = this.pendingRequests.get(requestId);

      if (record) {
        return {
          success: true,
          data: record,
          message: 'Payout found by request_id'
        };
      }

      return {
        success: false,
        data: null,
        message: 'Payout not found by request_id'
      };
    } catch (error) {
      logger.error('Failed to find payout by request_id', {
        operation: 'find_payout_by_request_id_failed',
        request_id: requestId,
        error: error.message
      });

      return {
        success: false,
        data: null,
        message: `Failed to find payout: ${error.message}`
      };
    }
  }
}

// Export singleton instance
module.exports = new PayoutRepository();
