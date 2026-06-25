const express = require('express');
const { 
  DepositController, 
  CallbackController, 
  StatusController, 
  BalanceController 
} = require('../controllers');
const { 
  validation, 
  asyncHandler 
} = require('../middlewares');
const { 
  createRechargeRateLimiter,
  createOrderRateLimiter
} = require('../middlewares/rateLimiter');
const { 
  validateUserStatus 
} = require('../middlewares/userStatusValidator');

const router = express.Router();

/**
 * @route   POST /api/einpay/deposit
 * @desc    Create a new deposit/payin transaction
 * @access  Private
 */
router.post(
  '/deposit',
  createRechargeRateLimiter(),
  validateUserStatus,
  validation.sanitizeBody,
  validation.validateDepositRequest,
  asyncHandler(DepositController.createDeposit.bind(DepositController))
);

/**
 * @route   GET /api/einpay/deposit/:clientTransactionId
 * @desc    Get deposit status by client transaction ID
 * @access  Private
 */
router.get(
  '/deposit/:clientTransactionId',
  asyncHandler(DepositController.getDepositStatus.bind(DepositController))
);

/**
 * @route   GET /api/einpay/deposits/pending
 * @desc    Get list of pending deposits
 * @access  Private
 */
router.get(
  '/deposits/pending',
  asyncHandler(DepositController.getPendingDeposits.bind(DepositController))
);

/**
 * @route   POST /api/einpay/callback
 * @desc    Handle EINPAY webhook callback
 * @access  Public (EINPAY Servers)
 */
router.post(
  '/callback',
  validation.validateCallbackBody,
  asyncHandler(CallbackController.handleCallback.bind(CallbackController))
);

/**
 * @route   GET /api/einpay/callbacks/:transactionId
 * @desc    Get callback history for a transaction
 * @access  Private
 */
router.get(
  '/callbacks/:transactionId',
  asyncHandler(CallbackController.getCallbackHistory.bind(CallbackController))
);

/**
 * @route   POST /api/einpay/status
 * @desc    Check transaction status from EINPAY
 * @access  Private
 */
router.post(
  '/status',
  validation.validateStatusRequest,
  asyncHandler(StatusController.checkStatus.bind(StatusController))
);

/**
 * @route   GET /api/einpay/status/:clientTransactionId
 * @desc    Get local transaction status
 * @access  Private
 */
router.get(
  '/status/:clientTransactionId',
  asyncHandler(StatusController.getLocalStatus.bind(StatusController))
);

/**
 * @route   POST /api/einpay/sync-pending
 * @desc    Sync all pending transactions with EINPAY
 * @access  Private
 */
router.post(
  '/sync-pending',
  asyncHandler(StatusController.syncPendingTransactions.bind(StatusController))
);

/**
 * @route   GET /api/einpay/balance
 * @desc    Get merchant balance
 * @access  Private
 */
router.get(
  '/balance',
  asyncHandler(BalanceController.getBalance.bind(BalanceController))
);

/**
 * @route   GET /api/einpay/balance/detailed
 * @desc    Get detailed balance with analytics
 * @access  Private
 */
router.get(
  '/balance/detailed',
  asyncHandler(BalanceController.getDetailedBalance.bind(BalanceController))
);

/**
 * @route   GET /api/einpay/balance/history
 * @desc    Get balance history
 * @access  Private
 */
router.get(
  '/balance/history',
  asyncHandler(BalanceController.getBalanceHistory.bind(BalanceController))
);

module.exports = router;
