const EinpayService = require('../services/EinpayService');
const RechargeRepository = require('../repositories/RechargeRepository');
const logger = require('../utils/logger');

/**
 * StatusController - Handles transaction status checks
 */
class StatusController {
  /**
   * Check transaction status
   * POST /api/einpay/status
   */
  async checkStatus(req, res) {
    const correlationId = req.correlationId;
    const { orders } = req.body;

    try {
      logger.info('Transaction status check requested', {
        operation: 'check_status',
        correlation_id: correlationId,
        order_count: orders.length,
        orders: orders
      });

      // Check status with EINPAY
      const statusResponse = await EinpayService.checkTransactionStatus(orders);

      // Update local records based on status response
      if (statusResponse.orders && Array.isArray(statusResponse.orders)) {
        for (const order of statusResponse.orders) {
          await this.updateLocalTransactionStatus(order, correlationId);
        }
      }

      logger.info('Transaction status check completed', {
        operation: 'check_status_completed',
        correlation_id: correlationId,
        order_count: orders.length
      });

      return res.status(200).json({
        success: true,
        correlation_id: correlationId,
        data: statusResponse
      });

    } catch (error) {
      logger.logError(error, {
        operation: 'check_status_failed',
        correlation_id: correlationId,
        orders: orders
      });

      let statusCode = 500;
      if (error.isGatewayError) {
        statusCode = 502;
      } else if (error.isTimeout || error.isNetworkError) {
        statusCode = 504;
      }

      return res.status(statusCode).json({
        success: false,
        message: error.message,
        correlation_id: correlationId,
        orders: orders
      });
    }
  }

  /**
   * Update local transaction status based on gateway response
   */
  async updateLocalTransactionStatus(order, correlationId) {
    try {
      const {
        client_transaction_id,
        transaction_id,
        status,
        ...additionalData
      } = order;

      if (!client_transaction_id) {
        return;
      }

      // Normalize status
      const normalizedStatus = status?.toUpperCase() || 'PENDING';

      logger.info('Updating local transaction status', {
        operation: 'update_local_status',
        correlation_id: correlationId,
        client_transaction_id,
        gateway_status: normalizedStatus
      });

      await RechargeRepository.updateRechargeStatus(
        client_transaction_id,
        normalizedStatus,
        {
          gateway_transaction_id: transaction_id,
          last_status_check: new Date().toISOString(),
          gateway_response: additionalData
        }
      );

    } catch (error) {
      logger.logError(error, {
        operation: 'update_local_status_failed',
        correlation_id: correlationId,
        order: order
      });
    }
  }

  /**
   * Get single transaction status from local database
   * GET /api/einpay/status/:clientTransactionId
   */
  async getLocalStatus(req, res) {
    const { clientTransactionId } = req.params;
    const correlationId = req.correlationId;

    try {
      logger.info('Local transaction status requested', {
        operation: 'get_local_status',
        correlation_id: correlationId,
        client_transaction_id: clientTransactionId
      });

      const result = await RechargeRepository.findRechargeByClientTransactionId(clientTransactionId);

      if (!result.success || !result.data) {
        return res.status(404).json({
          success: false,
          message: 'Transaction not found in local database',
          correlation_id: correlationId
        });
      }

      return res.status(200).json({
        success: true,
        correlation_id: correlationId,
        data: result.data
      });

    } catch (error) {
      logger.logError(error, {
        operation: 'get_local_status_failed',
        correlation_id: correlationId,
        client_transaction_id: clientTransactionId
      });

      return res.status(500).json({
        success: false,
        message: error.message,
        correlation_id: correlationId
      });
    }
  }

  /**
   * Sync all pending transactions with EINPAY
   * POST /api/einpay/sync-pending
   */
  async syncPendingTransactions(req, res) {
    const correlationId = req.correlationId;
    const limit = parseInt(req.query.limit, 10) || 50;

    try {
      logger.info('Syncing pending transactions', {
        operation: 'sync_pending',
        correlation_id: correlationId,
        limit: limit
      });

      // Get pending transactions
      const pendingResult = await RechargeRepository.getPendingTransactions(limit);
      
      if (!pendingResult.success || pendingResult.data.length === 0) {
        return res.status(200).json({
          success: true,
          correlation_id: correlationId,
          message: 'No pending transactions to sync',
          synced_count: 0
        });
      }

      // Extract transaction IDs for status check
      const transactionIds = pendingResult.data
        .map(t => t.gateway_transaction_id)
        .filter(id => id); // Filter out null/undefined

      if (transactionIds.length === 0) {
        return res.status(200).json({
          success: true,
          correlation_id: correlationId,
          message: 'No gateway transaction IDs available for sync',
          synced_count: 0
        });
      }

      // Check status with EINPAY
      const statusResponse = await EinpayService.checkTransactionStatus(transactionIds);

      // Update local records
      let updatedCount = 0;
      if (statusResponse.orders && Array.isArray(statusResponse.orders)) {
        for (const order of statusResponse.orders) {
          await this.updateLocalTransactionStatus(order, correlationId);
          updatedCount++;
        }
      }

      return res.status(200).json({
        success: true,
        correlation_id: correlationId,
        message: `Synced ${updatedCount} transactions`,
        synced_count: updatedCount,
        pending_count: pendingResult.data.length,
        data: statusResponse
      });

    } catch (error) {
      logger.logError(error, {
        operation: 'sync_pending_failed',
        correlation_id: correlationId
      });

      return res.status(500).json({
        success: false,
        message: error.message,
        correlation_id: correlationId
      });
    }
  }
}

module.exports = new StatusController();
