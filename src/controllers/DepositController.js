const EinpayService = require('../services/EinpayService');
const RechargeRepository = require('../repositories/RechargeRepository');
const logger = require('../utils/logger');

/**
 * DepositController - Handles deposit/payin operations
 */
class DepositController {
  /**
   * Create a new deposit transaction
   * POST /api/einpay/deposit
   */
  async createDeposit(req, res) {
    const correlationId = req.correlationId;
    const depositData = req.body;

    try {
      logger.logDeposit({
        operation: 'create_deposit_request',
        correlation_id: correlationId,
        client_transaction_id: depositData.client_transaction_id,
        client_user_id: depositData.client_user_id,
        amount: depositData.amount,
        method: depositData.requested_method,
        payment_mode: depositData.payment_mode
      });

      // Check for duplicate transaction
      const existingTransaction = await RechargeRepository.findRechargeByClientTransactionId(
        depositData.client_transaction_id
      );

      if (existingTransaction.success && existingTransaction.data) {
        logger.warn('Duplicate transaction detected', {
          correlation_id: correlationId,
          client_transaction_id: depositData.client_transaction_id
        });

        return res.status(409).json({
          success: false,
          message: 'Duplicate transaction ID',
          correlation_id: correlationId,
          existing_transaction: {
            status: existingTransaction.data.status,
            created_at: existingTransaction.data.created_at
          }
        });
      }

      // Create deposit with EINPAY
      const depositResult = await EinpayService.createDeposit(depositData);

      // Save transaction to repository (placeholder)
      await RechargeRepository.createRecharge({
        client_transaction_id: depositData.client_transaction_id,
        client_user_id: depositData.client_user_id,
        amount: depositData.amount,
        method: depositData.requested_method,
        gateway_transaction_id: depositResult.transaction_id,
        status: 'pending',
        payment_mode: depositData.payment_mode
      });

      // Trigger automatic order status check with retry (5 times, 30 sec delay)
      // This runs asynchronously - don't block the response
      if (depositResult.transaction_id) {
        const CallbackController = require('./CallbackController');
        CallbackController.startOrderStatusCheck(
          depositData.client_transaction_id,
          depositResult.transaction_id,
          depositData,
          correlationId
        );
      }

      logger.logDeposit({
        operation: 'create_deposit_success',
        correlation_id: correlationId,
        client_transaction_id: depositData.client_transaction_id,
        gateway_transaction_id: depositResult.transaction_id
      });

      return res.status(200).json({
        success: true,
        message: 'Deposit created successfully',
        correlation_id: correlationId,
        payment_link: depositResult.payment_link,
        transaction_id: depositResult.transaction_id,
        gateway_response: depositResult.gateway_response
      });

    } catch (error) {
      logger.logError(error, {
        operation: 'create_deposit_failed',
        correlation_id: correlationId,
        client_transaction_id: depositData.client_transaction_id
      });

      // Determine appropriate status code
      let statusCode = 500;
      if (error.isGatewayError) {
        statusCode = 502;
      } else if (error.isTimeout || error.isNetworkError) {
        statusCode = 504;
      } else if (error.message.includes('validation')) {
        statusCode = 400;
      }

      return res.status(statusCode).json({
        success: false,
        message: error.message,
        correlation_id: correlationId,
        ...(process.env.NODE_ENV === 'development' && {
          stack: error.stack
        })
      });
    }
  }

  /**
   * Get deposit status by client transaction ID
   * GET /api/einpay/deposit/:clientTransactionId
   */
  async getDepositStatus(req, res) {
    const { clientTransactionId } = req.params;
    const correlationId = req.correlationId;

    try {
      logger.logDeposit({
        operation: 'get_deposit_status',
        correlation_id: correlationId,
        client_transaction_id: clientTransactionId
      });

      const result = await RechargeRepository.findRechargeByClientTransactionId(clientTransactionId);

      if (!result.success || !result.data) {
        return res.status(404).json({
          success: false,
          message: 'Transaction not found',
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
        operation: 'get_deposit_status_failed',
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
   * Get pending deposits
   * GET /api/einpay/deposits/pending
   */
  async getPendingDeposits(req, res) {
    const correlationId = req.correlationId;
    const limit = parseInt(req.query.limit, 10) || 100;

    try {
      logger.logDeposit({
        operation: 'get_pending_deposits',
        correlation_id: correlationId,
        limit: limit
      });

      const result = await RechargeRepository.getPendingTransactions(limit);

      return res.status(200).json({
        success: true,
        correlation_id: correlationId,
        count: result.count,
        data: result.data
      });

    } catch (error) {
      logger.logError(error, {
        operation: 'get_pending_deposits_failed',
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

module.exports = new DepositController();
