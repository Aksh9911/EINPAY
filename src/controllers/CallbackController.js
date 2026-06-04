const EinpayService = require('../services/EinpayService');
const RechargeRepository = require('../repositories/RechargeRepository');
const PlatformService = require('../services/PlatformService');
const logger = require('../utils/logger');

// Maximum retries for order status check
const MAX_STATUS_RETRIES = 5;
const STATUS_RETRY_DELAY_MS = 30000; // 30 seconds between retries

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
      
      // Log callback received to file for audit trail
      logger.info('EINPAY Callback Received', {
        type: 'callback_request',
        correlation_id: correlationId,
        client_transaction_id: client_transaction_id,
        gateway_transaction_id: transaction_id,
        status: normalizedStatus,
        amount: amount,
        requested_method: requested_method,
        callback_payload: callbackPayload
      });
      
      // Note: Order status check automation is triggered ONLY after deposit creation
      // NOT here in callback - to avoid duplicate processing
      
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
          // For pending, just update status - platform APIs will be called after order status check
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
   * Static method to start order status check from DepositController
   * This allows triggering from outside the callback flow
   */
  static async startOrderStatusCheck(clientTransactionId, gatewayTransactionId, depositData, correlationId) {
    const controller = new CallbackController();
    await controller.processOrderStatusWithRetry(
      clientTransactionId,
      gatewayTransactionId,
      null, // no callback payload - we're starting from deposit creation
      correlationId,
      depositData // pass deposit data for platform API calls
    );
  }

  /**
   * Process order status check with retry logic
   * Automatically checks order status up to 5 times until APPROVED (30 sec delay between retries)
   */
  async processOrderStatusWithRetry(clientTransactionId, gatewayTransactionId, callbackPayload, correlationId, depositData = null) {
    const statusCheckCorrelationId = `${correlationId}-status-check`;
    
    console.log(`\n========== Starting Order Status Check for ${clientTransactionId} ==========`);
    console.log(`Gateway Transaction ID: ${gatewayTransactionId}`);
    console.log(`Max Retries: ${MAX_STATUS_RETRIES}`);
    console.log(`Delay Between Retries: ${STATUS_RETRY_DELAY_MS / 1000} seconds`);
    console.log(`Triggered By: ${depositData ? 'Deposit Creation' : 'Callback'}`);
    console.log(`============================================================\n`);
    
    logger.info('Starting automatic order status check', {
      type: 'order_status_check_start',
      correlation_id: statusCheckCorrelationId,
      client_transaction_id: clientTransactionId,
      gateway_transaction_id: gatewayTransactionId,
      max_retries: MAX_STATUS_RETRIES,
      retry_delay_seconds: STATUS_RETRY_DELAY_MS / 1000,
      triggered_by: depositData ? 'deposit_creation' : 'callback'
    });

    for (let attempt = 1; attempt <= MAX_STATUS_RETRIES; attempt++) {
      try {
        console.log(`\n----- Order Status Check Attempt ${attempt}/${MAX_STATUS_RETRIES} -----`);
        
        // Get payment_mode from database using client_transaction_id
        const rechargeRecord = await RechargeRepository.findRechargeByClientTransactionId(clientTransactionId);
        
        if (!rechargeRecord.success || !rechargeRecord.data) {
          console.error(`Recharge record not found for ${clientTransactionId}`);
          logger.error('Order status check failed - record not found', {
            type: 'order_status_check_error',
            correlation_id: statusCheckCorrelationId,
            client_transaction_id: clientTransactionId,
            attempt
          });
          break;
        }
        
        // Extract payment_mode from DB (EINPAY(P2P) or EINPAY(NATIVE) -> P2P or NATIVE)
        const dbPaymentMode = rechargeRecord.data.payment_mode;
        let paymentMode = null;
        if (dbPaymentMode && dbPaymentMode.includes('P2P')) {
          paymentMode = 'P2P';
        } else if (dbPaymentMode && dbPaymentMode.includes('NATIVE')) {
          paymentMode = 'NATIVE';
        }
        
        console.log(`Payment Mode from DB: ${dbPaymentMode} -> Using: ${paymentMode || 'default'}`);
        
        // Call order status API
        const orders = [gatewayTransactionId];
        
        console.log(`\n----- Calling Order Status API -----`);
        console.log(`Orders: ${JSON.stringify(orders)}`);
        console.log(`Payment Mode: ${paymentMode || 'default'}`);
        
        const statusResponse = await EinpayService.checkTransactionStatus(orders, paymentMode);
        
        // Log order status API response to file
        logger.info('Order Status API Response Received', {
          type: 'order_status_api_response',
          correlation_id: statusCheckCorrelationId,
          client_transaction_id: clientTransactionId,
          gateway_transaction_id: gatewayTransactionId,
          attempt,
          status_response: statusResponse
        });
        
        console.log(`\n----- Order Status API Response -----`);
        console.log(`Response: ${JSON.stringify(statusResponse, null, 2)}`);
        console.log(`-------------------------------------\n`);
        
        // Check if status is APPROVED
        const orderStatus = this.extractOrderStatus(statusResponse);
        
        console.log(`Extracted Order Status: ${orderStatus}`);
        
        if (orderStatus === 'APPROVED') {
          console.log(`\n✓ Order APPROVED on attempt ${attempt}! Processing platform APIs...\n`);
          
          logger.info('Order status APPROVED - processing platform APIs', {
            type: 'order_status_approved',
            correlation_id: statusCheckCorrelationId,
            client_transaction_id: clientTransactionId,
            gateway_transaction_id: gatewayTransactionId,
            attempt
          });
          
          // Update DB status to SUCCESS
          await RechargeRepository.updateRechargeStatus(
            clientTransactionId,
            'APPROVED',
            {
              gateway_transaction_id: gatewayTransactionId,
              processed_at: new Date().toISOString(),
              correlation_id: statusCheckCorrelationId,
              callback_payload: callbackPayload
            }
          );
          
          // Call platform APIs - use depositData if available (from deposit creation), otherwise use callbackPayload
          await this.processPlatformApis(clientTransactionId, callbackPayload, depositData, statusCheckCorrelationId);
          
          console.log(`\n========== Order Status Check Completed Successfully ==========\n`);
          
          logger.info('Order status check completed - platform APIs processed', {
            type: 'order_status_check_complete',
            correlation_id: statusCheckCorrelationId,
            client_transaction_id: clientTransactionId,
            gateway_transaction_id: gatewayTransactionId,
            final_status: 'APPROVED',
            attempts: attempt
          });
          
          return; // Success - exit retry loop
        } else {
          console.log(`✗ Order status is ${orderStatus}, not APPROVED`);
          
          logger.info('Order status not approved, will retry', {
            type: 'order_status_retry',
            correlation_id: statusCheckCorrelationId,
            client_transaction_id: clientTransactionId,
            gateway_transaction_id: gatewayTransactionId,
            current_status: orderStatus,
            attempt,
            next_attempt: attempt < MAX_STATUS_RETRIES ? attempt + 1 : null
          });
          
          // If not last attempt, wait before retrying
          if (attempt < MAX_STATUS_RETRIES) {
            console.log(`Waiting ${STATUS_RETRY_DELAY_MS}ms before retry...`);
            await this.sleep(STATUS_RETRY_DELAY_MS);
          }
        }
        
      } catch (error) {
        console.error(`Error on attempt ${attempt}:`, error.message);
        
        logger.logError(error, {
          type: 'order_status_check_error',
          correlation_id: statusCheckCorrelationId,
          client_transaction_id: clientTransactionId,
          gateway_transaction_id: gatewayTransactionId,
          attempt
        });
        
        // If not last attempt, wait before retrying
        if (attempt < MAX_STATUS_RETRIES) {
          console.log(`Waiting ${STATUS_RETRY_DELAY_MS}ms before retry...`);
          await this.sleep(STATUS_RETRY_DELAY_MS);
        }
      }
    }
    
    // All retries exhausted
    console.log(`\n✗ Order Status Check Failed after ${MAX_STATUS_RETRIES} attempts`);
    console.log(`Transaction remains in PENDING status`);
    console.log(`========== Order Status Check Ended ==========\n`);
    
    logger.warn('Order status check max retries reached', {
      type: 'order_status_max_retries',
      correlation_id: statusCheckCorrelationId,
      client_transaction_id: clientTransactionId,
      gateway_transaction_id: gatewayTransactionId,
      max_retries: MAX_STATUS_RETRIES
    });
  }

  /**
   * Extract order status from EINPAY status response
   */
  extractOrderStatus(statusResponse) {
    try {
      // Handle the structure: data.payload.transaction_status.0.status
      if (statusResponse && statusResponse.payload && statusResponse.payload.transaction_status) {
        const transactionStatus = statusResponse.payload.transaction_status;
        const firstOrder = transactionStatus['0'] || Object.values(transactionStatus)[0];
        if (firstOrder && firstOrder.status) {
          return firstOrder.status.toUpperCase();
        }
      }
      
      // Alternative: direct data.orders array
      if (statusResponse && statusResponse.orders && statusResponse.orders.length > 0) {
        const firstOrder = statusResponse.orders[0];
        if (firstOrder.status) {
          return firstOrder.status.toUpperCase();
        }
      }
      
      return 'UNKNOWN';
    } catch (error) {
      return 'UNKNOWN';
    }
  }

  /**
   * Sleep/delay helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Process platform APIs after order is approved
   * Can use either callbackPayload (from callback) or depositData (from deposit creation)
   */
  async processPlatformApis(clientTransactionId, callbackPayload, depositData, correlationId) {
    try {
      // Extract userId and amount from callback payload or deposit data
      let clientUserId, amount, requestedMethod;
      
      if (depositData) {
        // Using deposit data from initial creation
        clientUserId = depositData.client_user_id;
        amount = parseFloat(depositData.amount);
        requestedMethod = depositData.requested_method;
      } else if (callbackPayload) {
        // Using callback payload
        const callbackData = callbackPayload.payload || callbackPayload;
        clientUserId = callbackData.client_user_id;
        amount = parseFloat(callbackData.amount);
        requestedMethod = callbackData.requested_method;
      } else {
        console.error('No data source available for platform API calls');
        logger.error('No data source available for platform API calls', {
          type: 'platform_api_no_data',
          correlation_id: correlationId,
          client_transaction_id: clientTransactionId
        });
        return;
      }
      
      // Extract numeric userId
      let userId;
      if (clientUserId) {
        const match = clientUserId.toString().match(/(\d+)/);
        userId = match ? parseInt(match[1], 10) : null;
      }
      
      if (!userId || isNaN(amount)) {
        console.error('Cannot process platform APIs - missing userId or amount');
        logger.error('Cannot process platform APIs - missing data', {
          type: 'platform_api_missing_data',
          correlation_id: correlationId,
          client_transaction_id: clientTransactionId,
          client_user_id: clientUserId,
          amount: callbackData.amount
        });
        return;
      }
      
      console.log(`\n----- Calling Platform APIs -----`);
      console.log(`User ID: ${userId}`);
      console.log(`Amount: ${amount}`);
      console.log(`Order ID: ${clientTransactionId}`);
      
      // Call both platform APIs atomically
      const platformResult = await PlatformService.processSuccessfulDeposit({
        userId,
        amount,
        orderId: clientTransactionId
      }, correlationId);
      
      if (platformResult.success) {
        console.log(`\n✓ Platform APIs processed successfully`);
        console.log(`Deposit API: Success`);
        console.log(`Wallet API: Success`);
      } else {
        console.error(`\n✗ Platform APIs failed`);
      }
      
      logger.info('Platform deposit processed', {
        type: 'platform_deposit_complete',
        correlation_id: correlationId,
        client_transaction_id: clientTransactionId,
        userId,
        amount,
        success: platformResult.success,
        result: platformResult
      });
      
    } catch (error) {
      console.error('Platform API processing error:', error.message);
      logger.logError(error, {
        type: 'platform_deposit_failed',
        correlation_id: correlationId,
        client_transaction_id: clientTransactionId,
        message: 'Platform APIs failed after order approval'
      });
    }
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
