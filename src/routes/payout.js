const express = require('express');
const { PayoutController } = require('../controllers');
const { validation, asyncHandler } = require('../middlewares');

const router = express.Router();

/**
 * @route   POST /api/einpay/payout/create
 * @desc    Step 1 - Create payout request; receive required_information fields from EINPAY
 * @access  Private
 */
router.post(
  '/create',
  asyncHandler(PayoutController.createPayout.bind(PayoutController))
);

/**
 * @route   POST /api/einpay/payout/submit
 * @desc    Step 2 - Submit payout bank/UPI details to EINPAY
 * @access  Private
 */
router.post(
  '/submit',
  validation.validatePayoutSubmitRequest,
  asyncHandler(PayoutController.submitPayout.bind(PayoutController))
);

/**
 * @route   POST /api/einpay/payout/callback
 * @desc    Step 3 - Receive EINPAY payout callback (APPROVED / REJECTED)
 * @access  Public (EINPAY Servers)
 */
router.post(
  '/callback',
  validation.validateCallbackBody,
  asyncHandler(PayoutController.handlePayoutCallback.bind(PayoutController))
);

/**
 * @route   POST /api/einpay/payout/status
 * @desc    Step 4 - Query payout transaction status; reuses existing txstatus service
 * @access  Private
 */
router.post(
  '/status',
  asyncHandler(PayoutController.getPayoutStatus.bind(PayoutController))
);

module.exports = router;
