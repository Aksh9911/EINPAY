const EinpayService = require('../services/EinpayService');
const PayoutRepository = require('../repositories/PayoutRepository');
const logger = require('../utils/logger');

/**
 * PayoutController - Handles EINPAY H2H Payout (Withdrawal) operations
 */
class PayoutController {
  /**
   * Step 1: Create payout request - obtain required_information fields
   * POST /api/einpay/payout/create
   *
   * Body: { amount, requested_method, client_user_id, client_transaction_id, client_user_ipaddr }
   */
  async createPayout(req, res) {
    const correlationId = req.correlationId;
    const payoutData = req.body;

    try {
      logger.logPayout({
        operation: 'create_payout_request',
        correlation_id: correlationId,
        client_transaction_id: payoutData.client_transaction_id,
        client_user_id: payoutData.client_user_id,
        amount: payoutData.amount,
        method: payoutData.requested_method
      });

      // Idempotency: prevent duplicate payout requests
      const existing = await PayoutRepository.findByClientTransactionId(
        payoutData.client_transaction_id
      );

      if (existing.success && existing.data) {
        logger.warn('Duplicate payout transaction detected', {
          operation: 'duplicate_payout_request',
          correlation_id: correlationId,
          client_transaction_id: payoutData.client_transaction_id
        });

        return res.status(409).json({
          success: false,
          message: 'Duplicate payout transaction ID',
          correlation_id: correlationId,
          existing_transaction: {
            status: existing.data.status,
            created_at: existing.data.created_at
          }
        });
      }

      // Call EINPAY getform API
      const payoutResult = await EinpayService.createPayoutRequest(payoutData);

      // Persist payout record (stub - ready for MySQL integration)
      await PayoutRepository.createPayout({
        client_transaction_id: payoutData.client_transaction_id,
        client_user_id: payoutData.client_user_id,
        amount: payoutData.amount,
        requested_method: payoutData.requested_method,
        request_id: payoutResult.request_id,
        valid_until: payoutResult.valid_until,
        required_information: payoutResult.required_information,
        status: 'PENDING'
      });

      logger.logPayout({
        operation: 'create_payout_success',
        correlation_id: correlationId,
        client_transaction_id: payoutData.client_transaction_id,
        request_id: payoutResult.request_id
      });

      return res.status(200).json({
        success: true,
        message: 'Payout request created successfully',
        correlation_id: correlationId,
        request_id: payoutResult.request_id,
        valid_until: payoutResult.valid_until,
        required_information: payoutResult.required_information
      });

    } catch (error) {
      logger.logError(error, {
        operation: 'create_payout_failed',
        correlation_id: correlationId,
        client_transaction_id: payoutData.client_transaction_id
      });

      let statusCode = 500;
      if (error.isGatewayError) statusCode = 502;
      else if (error.isTimeout || error.isNetworkError) statusCode = 504;
      else if (error.message && error.message.includes('validation')) statusCode = 400;

      return res.status(statusCode).json({
        success: false,
        message: error.message,
        correlation_id: correlationId,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      });
    }
  }

  /**
   * Step 2: Submit payout details - send bank/UPI details to EINPAY
   * POST /api/einpay/payout/submit
   *
   * Body: { request_id, submitted_information: { "2801": "...", "2802": "...", ... } }
   */
  async submitPayout(req, res) {
    const correlationId = req.correlationId;
    const { request_id, submitted_information } = req.body;

    try {
      logger.logPayout({
        operation: 'submit_payout_request',
        correlation_id: correlationId,
        request_id,
        field_count: Object.keys(submitted_information || {}).length
      });

      // Look up payout record by request_id for context
      const payoutRecord = await PayoutRepository.findByRequestId(request_id);

      if (!payoutRecord.success || !payoutRecord.data) {
        logger.warn('Payout request_id not found locally, proceeding anyway', {
          operation: 'submit_payout_no_local_record',
          correlation_id: correlationId,
          request_id
        });
      }

      // Call EINPAY submit API
      const submitResult = await EinpayService.submitPayout({
        request_id,
        submitted_information
      });

      // Update payout record status
      if (payoutRecord.success && payoutRecord.data) {
        await PayoutRepository.updatePayoutStatus(
          payoutRecord.data.client_transaction_id,
          submitResult.status === 'SUCCESS' ? 'SUBMITTED' : 'SUBMIT_FAILED',
          {
            transaction_id: submitResult.transaction_id,
            submit_status: submitResult.status,
            submit_info: submitResult.info
          }
        );
      }

      logger.logPayout({
        operation: 'submit_payout_success',
        correlation_id: correlationId,
        request_id,
        status: submitResult.status,
        transaction_id: submitResult.transaction_id
      });

      return res.status(200).json({
        success: true,
        message: 'Payout submitted successfully',
        correlation_id: correlationId,
        status: submitResult.status,
        info: submitResult.info,
        transaction_id: submitResult.transaction_id,
        client_transaction_id: submitResult.client_transaction_id
      });

    } catch (error) {
      logger.logError(error, {
        operation: 'submit_payout_failed',
        correlation_id: correlationId,
        request_id
      });

      let statusCode = 500;
      if (error.isGatewayError) statusCode = 502;
      else if (error.isTimeout || error.isNetworkError) statusCode = 504;
      else if (error.message && error.message.includes('validation')) statusCode = 400;

      return res.status(statusCode).json({
        success: false,
        message: error.message,
        correlation_id: correlationId,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      });
    }
  }

  /**
   * Step 3: Handle EINPAY payout callback (APPROVED / REJECTED)
   * POST /api/einpay/payout/callback
   *
   * EINPAY sends a signed JWT. Verify with einpay-callback-public.pem.
   */
  async handlePayoutCallback(req, res) {
    const correlationId = req.correlationId;
    const rawBody = req.rawBody || req.body;

    try {
      logger.logPayout({
        operation: 'payout_callback_received',
        correlation_id: correlationId,
        body_preview: typeof rawBody === 'string'
          ? rawBody.substring(0, 100) + '...'
          : JSON.stringify(rawBody).substring(0, 100) + '...'
      });

      // Verify the callback JWT signature using einpay-callback-public.pem
      let callbackPayload;
      try {
        callbackPayload = await EinpayService.verifyCallback(
          typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody)
        );
      } catch (verifyError) {
        logger.logError(verifyError, {
          operation: 'payout_callback_verification_failed',
          correlation_id: correlationId
        });

        // Return 200 to prevent EINPAY retries; error is logged for investigation
        return res.status(200).json({
          success: false,
          message: 'Payout callback signature verification failed',
          correlation_id: correlationId
        });
      }

      // Extract fields - EINPAY payout callback uses transaction_status
      const decoded = callbackPayload.payload || callbackPayload;
      const {
        transaction_status,
        amount,
        transaction_id,
        client_transaction_id,
        transfer_id,
        ...additionalData
      } = decoded;

      logger.logPayout({
        operation: 'payout_callback_decoded',
        correlation_id: correlationId,
        transaction_id,
        client_transaction_id,
        transaction_status,
        amount
      });

      // Idempotency: prevent duplicate callback processing
      const isDuplicate = await PayoutRepository.isDuplicateCallback(
        transaction_id || client_transaction_id,
        transaction_status
      );

      if (isDuplicate) {
        logger.warn('Duplicate payout callback detected', {
          operation: 'duplicate_payout_callback',
          correlation_id: correlationId,
          transaction_id,
          client_transaction_id,
          transaction_status
        });

        return res.status(200).json({
          success: true,
          message: 'Duplicate payout callback acknowledged',
          correlation_id: correlationId
        });
      }

      // Save callback for audit trail
      await PayoutRepository.saveCallback(
        transaction_id || client_transaction_id,
        {
          transaction_status,
          amount,
          transaction_id,
          client_transaction_id,
          transfer_id,
          received_at: new Date().toISOString(),
          correlation_id: correlationId,
          ...additionalData
        }
      );

      // Process based on transaction_status
      const normalizedStatus = (transaction_status || '').toUpperCase();

      switch (normalizedStatus) {
        case 'APPROVED':
          await this._handleApprovedCallback(
            client_transaction_id,
            transaction_id,
            amount,
            correlationId
          );
          break;

        case 'REJECTED':
          await this._handleRejectedCallback(
            client_transaction_id,
            transaction_id,
            correlationId
          );
          break;

        default:
          logger.logPayout({
            operation: 'payout_callback_unknown_status',
            correlation_id: correlationId,
            transaction_status,
            transaction_id,
            client_transaction_id
          });
          break;
      }

      // Always return 200 to acknowledge receipt
      return res.status(200).json({
        success: true,
        message: 'Payout callback processed',
        correlation_id: correlationId,
        processed_status: normalizedStatus
      });

    } catch (error) {
      logger.logError(error, {
        operation: 'payout_callback_processing_failed',
        correlation_id: correlationId
      });

      // Return 200 to prevent EINPAY from retrying; error is logged
      return res.status(200).json({
        success: false,
        message: 'Payout callback processing error logged',
        correlation_id: correlationId
      });
    }
  }

  /**
   * Get payout status by client_transaction_id
   * POST /api/einpay/payout/status
   *
   * Reuses EinpayService.checkTransactionStatus (same txstatus API as Payin).
   * Body: { orders: ["WD123456"] }
   */
  async getPayoutStatus(req, res) {
    const correlationId = req.correlationId;
    const { orders } = req.body;

    try {
      if (!orders || !Array.isArray(orders) || orders.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'orders array is required and cannot be empty',
          correlation_id: correlationId
        });
      }

      logger.logPayout({
        operation: 'get_payout_status',
        correlation_id: correlationId,
        order_count: orders.length,
        orders
      });

      // Reuse existing transaction status service - no code duplication
      const statusResponse = await EinpayService.checkTransactionStatus(orders);

      // Update local payout records based on gateway response
      if (statusResponse.orders && Array.isArray(statusResponse.orders)) {
        for (const order of statusResponse.orders) {
          if (order.client_transaction_id) {
            await PayoutRepository.updatePayoutStatus(
              order.client_transaction_id,
              (order.status || 'PENDING').toUpperCase(),
              {
                transaction_id: order.transaction_id,
                last_status_check: new Date().toISOString()
              }
            );
          }
        }
      }

      logger.logPayout({
        operation: 'get_payout_status_completed',
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
        operation: 'get_payout_status_failed',
        correlation_id: correlationId,
        orders
      });

      let statusCode = 500;
      if (error.isGatewayError) statusCode = 502;
      else if (error.isTimeout || error.isNetworkError) statusCode = 504;

      return res.status(statusCode).json({
        success: false,
        message: error.message,
        correlation_id: correlationId,
        orders
      });
    }
  }

  /**
   * Handle APPROVED payout callback
   * @private
   */
  async _handleApprovedCallback(clientTransactionId, gatewayTransactionId, amount, correlationId) {
    logger.logPayout({
      operation: 'payout_callback_approved',
      correlation_id: correlationId,
      client_transaction_id: clientTransactionId,
      gateway_transaction_id: gatewayTransactionId,
      amount
    });

    await PayoutRepository.updatePayoutStatus(clientTransactionId, 'APPROVED', {
      transaction_id: gatewayTransactionId,
      processed_at: new Date().toISOString(),
      correlation_id: correlationId
    });

    // TODO: Notify main platform of successful withdrawal
    // e.g. deduct from user wallet, update withdraw table, send notification
  }

  /**
   * Handle REJECTED payout callback
   * @private
   */
  async _handleRejectedCallback(clientTransactionId, gatewayTransactionId, correlationId) {
    logger.logPayout({
      operation: 'payout_callback_rejected',
      correlation_id: correlationId,
      client_transaction_id: clientTransactionId,
      gateway_transaction_id: gatewayTransactionId
    });

    await PayoutRepository.updatePayoutStatus(clientTransactionId, 'REJECTED', {
      transaction_id: gatewayTransactionId,
      processed_at: new Date().toISOString(),
      correlation_id: correlationId
    });

    // TODO: Notify main platform of failed withdrawal (refund user wallet if already debited)
  }
}

module.exports = new PayoutController();
