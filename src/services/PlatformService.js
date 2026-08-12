const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * PlatformService - Handles communication with main Rollix777 platform
 * Calls APIs to update deposit table and wallet balance on successful callback
 */
class PlatformService {
  constructor() {
    this.baseURL = config.platform?.baseUrl || 'https://api.rollix777.com';
    this.apiKey = config.platform?.apiKey;
    
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey && { 'X-API-Key': this.apiKey })
      }
    });

    // Add request/response interceptors for logging
    this.client.interceptors.request.use(
      (request) => {
        logger.debug('Platform API Request', {
          method: request.method?.toUpperCase(),
          url: request.url,
          data: request.data
        });
        return request;
      },
      (error) => {
        logger.logError(error, { context: 'Platform API Request Error' });
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.debug('Platform API Response', {
          status: response.status,
          url: response.config?.url,
          data: response.data
        });
        return response;
      },
      (error) => {
        logger.logError(error, { 
          context: 'Platform API Response Error',
          url: error.config?.url,
          response: error.response?.data
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Create deposit record in main platform (atomic with wallet update)
   * This calls both APIs in sequence - if one fails, neither completes
   * 
   * @param {Object} data - Deposit data
   * @param {string} data.userId - User ID
   * @param {number} data.amount - Deposit amount
   * @param {string} data.orderId - Order ID (recharge_id)
   * @param {string} correlationId - Request correlation ID for tracing
   * @returns {Promise<Object>} - Result of both API calls
   */
  async processSuccessfulDeposit(data, correlationId) {
    const { userId, amount, orderId } = data;

    logger.info('Processing successful deposit to platform', {
      operation: 'platform_deposit_processing',
      correlation_id: correlationId,
      userId,
      amount,
      orderId
    });

    try {
      // Step 1: Create deposit record
      const depositResult = await this.createDepositRecord({
        userId,
        amount,
        cryptoname: 'INR',
        orderid: orderId
      }, correlationId);

      // If deposit API fails, throw error - don't proceed to wallet
      if (!depositResult.success) {
        throw new Error(`Deposit API failed: ${depositResult.message || 'Unknown error'}`);
      }

      // Step 2: Update wallet balance (with 10% bonus)
      const bonusAmount = amount * 1.10;
      const walletResult = await this.updateWalletBalance({
        userId,
        cryptoname: 'INR',
        balance: bonusAmount
      }, correlationId);

      // If wallet API fails, we have a problem - deposit record created but wallet not updated
      // This requires manual intervention or compensation
      if (!walletResult.success) {
        logger.error('CRITICAL: Deposit created but wallet update failed', {
          operation: 'platform_deposit_wallet_mismatch',
          correlation_id: correlationId,
          userId,
          amount,
          orderId,
          depositResponse: depositResult,
          walletError: walletResult.message
        });
        throw new Error(`Wallet API failed after deposit created: ${walletResult.message || 'Unknown error'}. Manual intervention required.`);
      }

      logger.info('Successfully processed deposit and wallet update', {
        operation: 'platform_deposit_complete',
        correlation_id: correlationId,
        userId,
        originalAmount: amount,
        bonusAmount: bonusAmount,
        orderId
      });

      return {
        success: true,
        deposit: depositResult,
        wallet: walletResult
      };

    } catch (error) {
      logger.logError(error, {
        operation: 'platform_deposit_processing_failed',
        correlation_id: correlationId,
        userId,
        amount,
        orderId
      });
      throw error;
    }
  }

  /**
   * Create deposit record in platform
   * POST /api/user/deposit
   */
  async createDepositRecord(payload, correlationId) {
    try {
      const response = await this.client.post('/api/user/deposit', payload, {
        headers: {
          'X-Correlation-ID': correlationId
        }
      });

      logger.info('Deposit record created in platform', {
        operation: 'platform_deposit_created',
        correlation_id: correlationId,
        userId: payload.userId,
        orderId: payload.orderid,
        response: response.data
      });

      return {
        success: true,
        data: response.data
      };

    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message;
      
      logger.logError(error, {
        operation: 'platform_deposit_failed',
        correlation_id: correlationId,
        payload,
        statusCode: error.response?.status
      });

      return {
        success: false,
        message: errorMessage,
        statusCode: error.response?.status
      };
    }
  }

  /**
   * Update wallet balance in platform
   * PUT /api/user/wallet/balance
   */
  async updateWalletBalance(payload, correlationId) {
    try {
      const response = await this.client.put('/api/user/wallet/balance', payload, {
        headers: {
          'X-Correlation-ID': correlationId
        }
      });

      logger.info('Wallet balance updated in platform', {
        operation: 'platform_wallet_updated',
        correlation_id: correlationId,
        userId: payload.userId,
        balance: payload.balance,
        response: response.data
      });

      return {
        success: true,
        data: response.data
      };

    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message;
      
      logger.logError(error, {
        operation: 'platform_wallet_update_failed',
        correlation_id: correlationId,
        payload,
        statusCode: error.response?.status
      });

      return {
        success: false,
        message: errorMessage,
        statusCode: error.response?.status
      };
    }
  }

  /**
   * Refund withdrawn amount to user wallet on payout reject/fail.
   * Uses the same add-funds platform API as payin success: PUT /api/user/wallet/balance
   * (exact amount — no deposit bonus).
   */
  async refundFailedPayout({ userId, amount, cryptoname = 'INR', withdrawId, morderId }, correlationId) {
    const refundAmount = Number(amount);

    logger.info('Refunding failed payout to wallet', {
      operation: 'platform_payout_refund_start',
      correlation_id: correlationId,
      userId,
      amount: refundAmount,
      cryptoname,
      withdrawId,
      morderId
    });

    const walletResult = await this.updateWalletBalance({
      userId,
      cryptoname: cryptoname || 'INR',
      balance: refundAmount
    }, correlationId);

    if (!walletResult.success) {
      logger.error('CRITICAL: Payout rejected but wallet refund failed', {
        operation: 'platform_payout_refund_failed',
        correlation_id: correlationId,
        userId,
        amount: refundAmount,
        withdrawId,
        morderId,
        error: walletResult.message
      });
      throw new Error(`Wallet refund failed: ${walletResult.message || 'Unknown error'}`);
    }

    logger.info('Successfully refunded failed payout to wallet', {
      operation: 'platform_payout_refund_success',
      correlation_id: correlationId,
      userId,
      amount: refundAmount,
      withdrawId,
      morderId,
      response: walletResult.data
    });

    return walletResult;
  }

  /**
   * Health check for platform APIs
   */
  async healthCheck() {
    try {
      const response = await this.client.get('/health', { timeout: 5000 });
      return {
        healthy: response.status === 200,
        status: response.status
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message
      };
    }
  }
}

module.exports = new PlatformService();
