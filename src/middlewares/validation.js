const { TransactionValidator } = require('../validators');
const { ValidationError } = require('./errorHandler');

/**
 * Validation Middleware
 */

// Validate deposit request
const validateDepositRequest = (req, res, next) => {
  const validation = TransactionValidator.validateDeposit(req.body);
  
  if (!validation.isValid) {
    throw new ValidationError('Validation failed', validation.errors);
  }
  
  next();
};

// Validate status request
const validateStatusRequest = (req, res, next) => {
  const validation = TransactionValidator.validateStatusRequest(req.body);
  
  if (!validation.isValid) {
    throw new ValidationError('Validation failed', validation.errors);
  }
  
  next();
};

// Validate amount specifically
const validateAmount = (req, res, next) => {
  const { amount, requested_method } = req.body;
  const validation = TransactionValidator.validateAmount(amount, requested_method);
  
  if (!validation.isValid) {
    throw new ValidationError('Amount validation failed', validation.errors);
  }
  
  next();
};

// Validate payment method
const validateMethod = (req, res, next) => {
  const { requested_method } = req.body;
  const validation = TransactionValidator.validateMethod(requested_method);
  
  if (!validation.isValid) {
    throw new ValidationError('Payment method validation failed', validation.errors);
  }
  
  next();
};

// Validate callback body (ensure it's not empty)
const validateCallbackBody = (req, res, next) => {
  if (!req.body || (typeof req.body === 'object' && Object.keys(req.body).length === 0)) {
    if (!req.rawBody) {
      throw new ValidationError('Callback body is required');
    }
  }
  
  next();
};

// Validate payout create request (Step 1 - getform)
const validatePayoutCreateRequest = (req, res, next) => {
  const validation = TransactionValidator.validatePayoutCreate(req.body);

  if (!validation.isValid) {
    throw new ValidationError('Payout validation failed', validation.errors);
  }

  next();
};

// Validate payout submit request (Step 2 - submit)
const validatePayoutSubmitRequest = (req, res, next) => {
  const validation = TransactionValidator.validatePayoutSubmit(req.body);

  if (!validation.isValid) {
    throw new ValidationError('Payout submit validation failed', validation.errors);
  }

  next();
};

// Sanitize request body
const sanitizeBody = (req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    // Convert string numbers to actual numbers where appropriate
    if (req.body.amount !== undefined) {
      req.body.amount = Number(req.body.amount);
    }
    if (req.body.device_type !== undefined) {
      req.body.device_type = Number(req.body.device_type);
    }
    
    // Trim string values
    const stringFields = ['client_transaction_id', 'client_user_id', 'client_user_ipaddr', 'requested_method'];
    stringFields.forEach(field => {
      if (req.body[field] && typeof req.body[field] === 'string') {
        req.body[field] = req.body[field].trim();
      }
    });
  }
  
  next();
};

module.exports = {
  validateDepositRequest,
  validateStatusRequest,
  validateAmount,
  validateMethod,
  validateCallbackBody,
  validatePayoutCreateRequest,
  validatePayoutSubmitRequest,
  sanitizeBody
};
