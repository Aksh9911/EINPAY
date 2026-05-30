const EinpayService = require('../services/EinpayService');
const RechargeRepository = require('../repositories/RechargeRepository');
const PlatformService = require('../services/PlatformService');
const logger = require('../utils/logger');

/**
 * CallbackController - Handles EINPAY webhook callbacks
 */
class CallbackController {
  /**
   * Handle EINPAY callback
   * POST /api/einpay/callback
   */
  async handleCallback(req, res) {
    const correlationId = req.correlationId;
    
    // Get raw body - could be string JWT or parsed object
    const rawBody = req.rawBody || req.body;
    
    try {
      logger.logCallback({
        operation: 'callback_received',
        correlation_id: correlationId,
        headers: req.headers,
        body_preview: typeof rawBody === 'string' 
          ? rawBody.substring(0, 100) + '...' 
          : JSON.stringify(rawBody).substring(0, 100) + '...'
      });

      // Verify the callback JWT signature
      let callbackPayload;
      try {
        callbackPayload = await EinpayService.verifyCallback(
          typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody)
        );
      } catch (verifyError) {
        logger.logError(verifyError, {
          operation: 'callback_verification_failed',
          correlation_id: correlationId
        });
        
        // Still return 200 to EINPAY to prevent retries, but log the error
        return res.status(200).json({
          success: false,
          message: 'Signature verification failed',
          correlation_id: correlationId
        });
      }

      // Extract key fields from payload
      const {
        transaction_id,
        client_transaction_id,
        status,
        amount,
        requested_method,
        client_user_id,
        ...additionalData
      } = callbackPayload.payload || callbackPayload;

      logger.logCallback({
        operation: 'callback_decoded',
        correlation_id: correlationId,
        transaction_id,
        client_transaction_id,
        status,
        amount
      });

      // Check for duplicate callback
      const isDuplicate = await RechargeRepository.isDuplicateCallback(
        transaction_id || client_transaction_id,
        status
      );

      if (isDuplicate) {
        logger.warn('Duplicate callback detected', {
          operation: 'duplicate_callback',
          correlation_id: correlationId,
          transaction_id,
          client_transaction_id,
          status
        });

        // Return 200 to acknowledge but don't process
        return res.status(200).json({
          success: true,
          message: 'Duplicate callback acknowledged',
          correlation_id: correlationId
        });
      }

      // Save callback data for audit
      await RechargeRepository.saveCallbackData(
        transaction_id || client_transaction_id,
        {
          transaction_id,
          client_transaction_id,
          status,
          amount,
          requested_method,
          client_user_id,
          received_at: new Date().toISOString(),
          correlation_id: correlationId,
          ...additionalData
        }
      );

      // Process based on status
      const normalizedStatus = status?.toUpperCase();
      
      switch (normalizedStatus) {
        case 'APPROVED':
        case 'SUCCESS':
        case 'COMPLETED':
          await this.handleApprovedCallback(
            client_transaction_id,
            transaction_id,
            callbackPayload,
            correlationId
          );
          break;

        case 'REJECTED':
        case 'FAILED':
        case 'DECLINED':
          await this.handleRejectedCallback(
            client_transaction_id,
            transaction_id,
            callbackPayload,
            correlationId
          );
          break;

        case 'PENDING':
        default:
          await this.handlePendingCallback(
            client_transaction_id,
            transaction_id,
            callbackPayload,
            correlationId
          );
          break;
      }

      // Always return 200 to EINPAY to acknowledge receipt
      return res.status(200).json({
        success: true,
        message: 'Callback processed',
        correlation_id: correlationId,
        processed_status: normalizedStatus
      });

    } catch (error) {
      logger.logError(error, {
        operation: 'callback_processing_failed',
        correlation_id: correlationId,
        body_preview: typeof rawBody === 'string' 
          ? rawBody.substring(0, 100) 
          : 'object'
      });

      // Return 200 to prevent EINPAY from retrying
      // The error has been logged and can be investigated
      return res.status(200).json({
        success: false,
        message: 'Callback processing error logged',
        correlation_id: correlationId
      });
    }
  }

  /**
   * Handle approved callback
   */
  async handleApprovedCallback(clientTransactionId, gatewayTransactionId, payload, correlationId) {
    logger.logCallback({
      operation: 'callback_approved',
      correlation_id: correlationId,
      client_transaction_id: clientTransactionId,
      gateway_transaction_id: gatewayTransactionId
    });

    // Update transaction status in repository
    await RechargeRepository.updateRechargeStatus(
      clientTransactionId,
      'APPROVED',
      {
        gateway_transaction_id: gatewayTransactionId,
        processed_at: new Date().toISOString(),
        correlation_id: correlationId,
        callback_payload: payload
      }
    );

    // Call platform APIs to create deposit and update wallet (atomic operation)
    try {
      // Extract userId from client_user_id (format: "user_123" or just "123")
      const callbackData = payload.payload || payload;
      const clientUserId = callbackData.client_user_id;
      const amount = parseFloat(callbackData.amount);
      
      // Extract numeric userId from client_user_id
      let userId;
      if (clientUserId) {
        const match = clientUserId.toString().match(/(\d+)/);
        userId = match ? parseInt(match[1], 10) : null;
      }

      if (!userId || isNaN(amount)) {
        logger.error('Cannot process platform APIs - missing userId or amount', {
          operation: 'platform_api_missing_data',
          correlation_id: correlationId,
          client_user_id: clientUserId,
          amount: callbackData.amount
        });
        return;
      }

      // Call both platform APIs atomically
      const platformResult = await PlatformService.processSuccessfulDeposit({
        userId,
        amount,
        orderId: clientTransactionId
      }, correlationId);

      logger.info('Platform deposit processed successfully', {
        operation: 'platform_deposit_success',
        correlation_id: correlationId,
        userId,
        amount,
        orderId: clientTransactionId,
        platformResult
      });

    } catch (error) {
      // Log error but don't throw - callback was already acknowledged to EINPAY
      // This requires manual intervention
      logger.logError(error, {
        operation: 'platform_deposit_failed',
        correlation_id: correlationId,
        client_transaction_id: clientTransactionId,
        message: 'Deposit table and wallet update failed - requires manual review'
      });
    }
  }

  /**
   * Handle rejected callback
   */
  async handleRejectedCallback(clientTransactionId, gatewayTransactionId, payload, correlationId) {
    logger.logCallback({
      operation: 'callback_rejected',
      correlation_id: correlationId,
      client_transaction_id: clientTransactionId,
      gateway_transaction_id: gatewayTransactionId,
      rejection_reason: payload.rejection_reason || payload.reason || 'Unknown'
    });

    // Update transaction status in repository
    await RechargeRepository.updateRechargeStatus(
      clientTransactionId,
      'REJECTED',
      {
        gateway_transaction_id: gatewayTransactionId,
        processed_at: new Date().toISOString(),
        correlation_id: correlationId,
        rejection_reason: payload.rejection_reason || payload.reason || 'Unknown',
        callback_payload: payload
      }
    );

    // TODO: Notify main platform of failed transaction
  }

  /**
   * Handle pending callback
   */
  async handlePendingCallback(clientTransactionId, gatewayTransactionId, payload, correlationId) {
    logger.logCallback({
      operation: 'callback_pending',
      correlation_id: correlationId,
      client_transaction_id: clientTransactionId,
      gateway_transaction_id: gatewayTransactionId
    });

    // Update transaction status but keep as pending
    await RechargeRepository.updateRechargeStatus(
      clientTransactionId,
      'PENDING',
      {
        gateway_transaction_id: gatewayTransactionId,
        last_callback_at: new Date().toISOString(),
        correlation_id: correlationId,
        callback_payload: payload
      }
    );
  }

  /**
   * Get callback history for a transaction
   * GET /api/einpay/callbacks/:transactionId
   */
  async getCallbackHistory(req, res) {
    const { transactionId } = req.params;
    const correlationId = req.correlationId;

    try {
      // TODO: Query callback history from database
      logger.info('Callback history requested', {
        operation: 'get_callback_history',
        correlation_id: correlationId,
        transaction_id: transactionId
      });

      return res.status(200).json({
        success: true,
        correlation_id: correlationId,
        message: 'Callback history (placeholder implementation)',
        data: []
      });

    } catch (error) {
      logger.logError(error, {
        operation: 'get_callback_history_failed',
        correlation_id: correlationId,
        transaction_id: transactionId
      });

      return res.status(500).json({
        success: false,
        message: error.message,
        correlation_id: correlationId
      });
    }
  }
}

module.exports = new CallbackController();
