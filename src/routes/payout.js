const express = require('express');
const { PayoutController } = require('../controllers');
const { validation, asyncHandler } = require('../middlewares');
const { requirePayoutSecret } = require('../middlewares/requirePayoutSecret');

const router = express.Router();

router.post(
  '/create',
  requirePayoutSecret,
  asyncHandler(PayoutController.createPayout.bind(PayoutController))
);

router.post(
  '/submit',
  validation.validatePayoutSubmitRequest,
  asyncHandler(PayoutController.submitPayout.bind(PayoutController))
);

router.post(
  '/callback',
  validation.validateCallbackBody,
  asyncHandler(PayoutController.handlePayoutCallback.bind(PayoutController))
);

router.post(
  '/status',
  asyncHandler(PayoutController.getPayoutStatus.bind(PayoutController))
);

module.exports = router;
