const config = require('../config');

/**
 * TransactionValidator - Validates transaction requests
 */
class TransactionValidator {
  /**
   * Validate deposit request
   * @param {Object} data - Request data
   * @returns {Object} - { isValid: boolean, errors: string[] }
   */
  static validateDeposit(data) {
    const errors = [];

    // Validate amount
    const amountValidation = this.validateAmount(data.amount, data.requested_method);
    if (!amountValidation.isValid) {
      errors.push(...amountValidation.errors);
    }

    // Validate payment method
    const methodValidation = this.validateMethod(data.requested_method);
    if (!methodValidation.isValid) {
      errors.push(...methodValidation.errors);
    }

    // Validate client_transaction_id
    if (!data.client_transaction_id || typeof data.client_transaction_id !== 'string') {
      errors.push('client_transaction_id is required and must be a string');
    } else if (data.client_transaction_id.length < 3 || data.client_transaction_id.length > 100) {
      errors.push('client_transaction_id must be between 3 and 100 characters');
    }

    // Validate client_user_id
    if (!data.client_user_id || typeof data.client_user_id !== 'string') {
      errors.push('client_user_id is required and must be a string');
    } else if (data.client_user_id.length < 1 || data.client_user_id.length > 100) {
      errors.push('client_user_id must be between 1 and 100 characters');
    }

    // Validate client_user_ipaddr
    const ipValidation = this.validateIPAddress(data.client_user_ipaddr);
    if (!ipValidation.isValid) {
      errors.push(...ipValidation.errors);
    }

    // Validate device_type
    if (data.device_type === undefined || data.device_type === null) {
      errors.push('device_type is required');
    } else if (!Number.isInteger(Number(data.device_type))) {
      errors.push('device_type must be an integer');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate amount based on payment method
   * @param {number} amount - Amount to validate
   * @param {string} method - Payment method
   * @returns {Object} - { isValid: boolean, errors: string[] }
   */
  static validateAmount(amount, method) {
    const errors = [];

    if (amount === undefined || amount === null) {
      errors.push('amount is required');
      return { isValid: false, errors };
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || !Number.isFinite(numAmount)) {
      errors.push('amount must be a valid number');
      return { isValid: false, errors };
    }

    if (numAmount <= 0) {
      errors.push('amount must be greater than 0');
      return { isValid: false, errors };
    }

    // Check decimal places (max 2 for INR)
    const decimalPlaces = (numAmount.toString().split('.')[1] || '').length;
    if (decimalPlaces > 2) {
      errors.push('amount can have maximum 2 decimal places');
    }

    // Check method-specific limits
    const methodUpper = method ? method.toUpperCase() : '';
    const isUPI = config.upiMethods.includes(methodUpper);
    const isBank = config.bankMethods.includes(methodUpper);

    if (isUPI) {
      if (numAmount < config.limits.upi.min) {
        errors.push(`Minimum deposit amount for UPI is ${config.limits.upi.min}`);
      }
      if (numAmount > config.limits.upi.max) {
        errors.push(`Maximum deposit amount for UPI is ${config.limits.upi.max}`);
      }
    } else if (isBank) {
      if (numAmount < config.limits.bank.min) {
        errors.push(`Minimum deposit amount for Bank Transfer/IMPS is ${config.limits.bank.min}`);
      }
      if (numAmount > config.limits.bank.max) {
        errors.push(`Maximum deposit amount for Bank Transfer/IMPS is ${config.limits.bank.max}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate payment method
   * @param {string} method - Payment method to validate
   * @returns {Object} - { isValid: boolean, errors: string[] }
   */
  static validateMethod(method) {
    const errors = [];

    if (!method || typeof method !== 'string') {
      errors.push('requested_method is required and must be a string');
      return { isValid: false, errors };
    }

    const methodUpper = method.toUpperCase();
    const validMethods = config.paymentMethods.map(m => m.toUpperCase());

    if (!validMethods.includes(methodUpper)) {
      errors.push(`Invalid payment method. Supported methods: ${config.paymentMethods.join(', ')}`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate IP address
   * @param {string} ip - IP address to validate
   * @returns {Object} - { isValid: boolean, errors: string[] }
   */
  static validateIPAddress(ip) {
    const errors = [];

    if (!ip || typeof ip !== 'string') {
      errors.push('client_user_ipaddr is required and must be a string');
      return { isValid: false, errors };
    }

    // IPv4 regex
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    
    // IPv6 regex (simplified)
    const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::$/;

    if (!ipv4Regex.test(ip) && !ipv6Regex.test(ip)) {
      // Allow localhost for development
      if (ip !== '127.0.0.1' && ip !== 'localhost' && ip !== '::1') {
        errors.push('client_user_ipaddr must be a valid IP address');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate transaction status request
   * @param {Object} data - Request data containing orders array
   * @returns {Object} - { isValid: boolean, errors: string[] }
   */
  static validateStatusRequest(data) {
    const errors = [];

    if (!data.orders || !Array.isArray(data.orders)) {
      errors.push('orders must be an array of transaction IDs');
      return { isValid: false, errors };
    }

    if (data.orders.length === 0) {
      errors.push('orders array cannot be empty');
    }

    if (data.orders.length > 100) {
      errors.push('Maximum 100 transaction IDs allowed per request');
    }

    for (let i = 0; i < data.orders.length; i++) {
      const order = data.orders[i];
      if (!order || typeof order !== 'string') {
        errors.push(`Order at index ${i} must be a valid transaction ID string`);
      } else if (order.length < 1 || order.length > 100) {
        errors.push(`Order at index ${i} must be between 1 and 100 characters`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

module.exports = TransactionValidator;
