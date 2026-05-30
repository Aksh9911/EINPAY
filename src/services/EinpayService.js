const axios = require('axios');
const config = require('../config');
const JWTService = require('./JWTService');
const KeyManager = require('./KeyManager');
const SaltGenerator = require('../utils/SaltGenerator');
const TimestampHelper = require('../utils/TimestampHelper');
const logger = require('../utils/logger');

/**
 * EinpayService - Handles all EINPAY API interactions
 */
class EinpayService {
  constructor() {
    this.baseURL = config.einpay.baseUrl;
    this.clientId = config.einpay.clientId;
    this.countryId = config.einpay.countryId;
    this.currencyId = config.einpay.currencyId;
    this.trafficLevel = config.einpay.trafficLevel;
    
    // Create axios instance with default config
    this.httpClient = axios.create({
      baseURL: this.baseURL,
      timeout: config.request.timeout,
      headers: {
        'Content-Type': 'text/plain',
        'Accept': 'application/json'
      }
    });

    // Setup request/response interceptors for logging
    this.setupInterceptors();
  }

  /**
   * Setup Axios interceptors for logging and retry logic
   */
  setupInterceptors() {
    // Request interceptor
    this.httpClient.interceptors.request.use(
      (requestConfig) => {
        logger.logRequest({
          method: requestConfig.method,
          url: requestConfig.url,
          headers: requestConfig.headers,
          data: typeof requestConfig.data === 'string' 
            ? requestConfig.data.substring(0, 500) + '...' 
            : requestConfig.data
        });
        return requestConfig;
      },
      (error) => {
        logger.logError(error, { context: 'Request interceptor' });
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.httpClient.interceptors.response.use(
      (response) => {
        logger.logResponse({
          status: response.status,
          statusText: response.statusText,
          data: typeof response.data === 'object' 
            ? JSON.stringify(response.data).substring(0, 500)
            : response.data
        });
        return response;
      },
      (error) => {
        logger.logError(error, { context: 'Response interceptor' });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Execute request with retry logic
   * @param {Function} requestFn - Function that returns a promise
   * @param {number} retries - Number of retry attempts
   * @returns {Promise} - Response from the request
   */
  async executeWithRetry(requestFn, retries = config.request.maxRetries) {
    let lastError;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error;
        
        // Don't retry on 4xx client errors (except 429 Too Many Requests)
        if (error.response && error.response.status >= 400 && error.response.status < 500) {
          if (error.response.status !== 429) {
            throw error;
          }
        }

        if (attempt < retries) {
          const delay = config.request.retryDelay * Math.pow(2, attempt - 1);
          logger.info(`Request failed, retrying in ${delay}ms (attempt ${attempt}/${retries})`, {
            attempt,
            retries,
            delay,
            error: error.message
          });
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Sleep helper for retry delays
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} - Resolves after ms milliseconds
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create a deposit (payin) transaction
   * @param {Object} depositData - Deposit request data
   * @returns {Promise<Object>} - Deposit response with payment link
   */
  async createDeposit(depositData) {
    try {
      const publicKeyContent = KeyManager.getMerchantPublicKey();
      
      // Build EINPAY payload
      const payload = {
        salt: SaltGenerator.generate(),
        timestamp: TimestampHelper.getUnixTimestampSeconds().toString(),
        client_id: this.clientId,
        transaction_type: 1, // 1 = Deposit
        requested_method: depositData.requested_method,
        country_id: this.countryId,
        currency_id: this.currencyId,
        traffic_level: this.trafficLevel,
        amount: depositData.amount,
        client_user_id: depositData.client_user_id,
        client_user_ipaddr: depositData.client_user_ipaddr,
        client_transaction_id: depositData.client_transaction_id,
        device_type: depositData.device_type,
        client_pub_key: publicKeyContent
      };

      // Wrap payload as required by EINPAY
      const wrappedPayload = { payload };

      // Sign the payload
      const signedJWT = await JWTService.createSignedPayload(wrappedPayload);

      logger.logDeposit({
        operation: 'create_deposit',
        client_transaction_id: depositData.client_transaction_id,
        amount: depositData.amount,
        method: depositData.requested_method
      });

      // Make API request with retry
      const response = await this.executeWithRetry(() => 
        this.httpClient.post('/api/v5/methods/get', signedJWT)
      );

      // Verify and decode the response
      let gatewayResponse;
      if (typeof response.data === 'string') {
        // Response is a JWT token
        gatewayResponse = await JWTService.verifyGatewayJWT(response.data);
      } else {
        // Response is already JSON (fallback)
        gatewayResponse = response.data;
      }

      // Extract payment details
      const result = {
        success: true,
        payment_link: gatewayResponse.payment_link || gatewayResponse.redirect_url || null,
        transaction_id: gatewayResponse.transaction_id || gatewayResponse.txn_id || null,
        gateway_response: gatewayResponse
      };

      logger.logDeposit({
        operation: 'deposit_response',
        client_transaction_id: depositData.client_transaction_id,
        transaction_id: result.transaction_id,
        has_payment_link: !!result.payment_link
      });

      return result;
    } catch (error) {
      logger.logError(error, { 
        context: 'Create deposit',
        client_transaction_id: depositData.client_transaction_id 
      });
      
      throw this.normalizeError(error);
    }
  }

  /**
   * Check transaction status
   * @param {string[]} orders - Array of transaction IDs to check
   * @returns {Promise<Object>} - Transaction status response
   */
  async checkTransactionStatus(orders) {
    try {
      // Build status request payload
      const payload = {
        salt: SaltGenerator.generate(),
        timestamp: TimestampHelper.getUnixTimestampSeconds().toString(),
        client_id: this.clientId,
        country_id: this.countryId,
        currency_id: this.currencyId,
        orders: orders
      };

      // Sign the payload
      const signedJWT = await JWTService.createSignedPayload({ payload });

      logger.info('Checking transaction status', {
        operation: 'status_check',
        order_count: orders.length,
        orders: orders
      });

      // Make API request with retry
      const response = await this.executeWithRetry(() =>
        this.httpClient.post('/api/v5/txstatus', signedJWT)
      );

      // Verify and decode the response
      let statusResponse;
      if (typeof response.data === 'string') {
        statusResponse = await JWTService.verifyGatewayJWT(response.data);
      } else {
        statusResponse = response.data;
      }

      logger.info('Transaction status received', {
        operation: 'status_response',
        order_count: orders.length
      });

      return statusResponse;
    } catch (error) {
      logger.logError(error, { 
        context: 'Check transaction status',
        orders 
      });
      
      throw this.normalizeError(error);
    }
  }

  /**
   * Check merchant balance
   * @returns {Promise<Object>} - Balance information
   */
  async checkBalance() {
    try {
      // Build balance request payload
      const payload = {
        salt: SaltGenerator.generate(),
        timestamp: TimestampHelper.getUnixTimestampSeconds().toString(),
        client_id: this.clientId,
        country_id: this.countryId,
        currency_id: this.currencyId
      };

      // Sign the payload
      const signedJWT = await JWTService.createSignedPayload({ payload });

      logger.info('Checking merchant balance', {
        operation: 'balance_check',
        client_id: this.clientId
      });

      // Make API request with retry
      const response = await this.executeWithRetry(() =>
        this.httpClient.post('/api/v5/balance', signedJWT)
      );

      // Verify and decode the response
      let balanceResponse;
      if (typeof response.data === 'string') {
        balanceResponse = await JWTService.verifyGatewayJWT(response.data);
      } else {
        balanceResponse = response.data;
      }

      const result = {
        account_balance: balanceResponse.account_balance || balanceResponse.balance || 0,
        payouts_balance: balanceResponse.payouts_balance || 0,
        available_balance: balanceResponse.available_balance || balanceResponse.balance || 0,
        raw_response: balanceResponse
      };

      logger.info('Balance response received', {
        operation: 'balance_response',
        account_balance: result.account_balance,
        available_balance: result.available_balance
      });

      return result;
    } catch (error) {
      logger.logError(error, { context: 'Check balance' });
      throw this.normalizeError(error);
    }
  }

  /**
   * Verify callback JWT token
   * @param {string} token - Raw JWT token from callback
   * @returns {Promise<Object>} - Verified and decoded callback payload
   */
  async verifyCallback(token) {
    try {
      logger.logCallback({
        operation: 'verify_callback',
        token_preview: token.substring(0, 50) + '...'
      });

      const payload = await JWTService.verifyCallbackJWT(token);
      
      return payload;
    } catch (error) {
      logger.logError(error, { context: 'Verify callback' });
      throw new Error(`Callback verification failed: ${error.message}`);
    }
  }

  /**
   * Normalize error for consistent handling
   * @param {Error} error - Original error
   * @returns {Error} - Normalized error
   */
  normalizeError(error) {
    if (error.response) {
      // Axios error with response
      const status = error.response.status;
      const message = error.response.data?.message || error.response.statusText || error.message;
      
      const normalizedError = new Error(`EINPAY API Error (${status}): ${message}`);
      normalizedError.status = status;
      normalizedError.isGatewayError = true;
      normalizedError.originalError = error;
      return normalizedError;
    }
    
    if (error.request) {
      // Axios error with request but no response
      const normalizedError = new Error('EINPAY API request failed: No response received');
      normalizedError.isTimeout = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
      normalizedError.isNetworkError = true;
      normalizedError.originalError = error;
      return normalizedError;
    }

    // Other errors
    return error;
  }
}

// Export singleton instance
module.exports = new EinpayService();
