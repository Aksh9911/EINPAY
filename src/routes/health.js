const express = require('express');
const { HealthController } = require('../controllers');
const { asyncHandler } = require('../middlewares');

const router = express.Router();

/**
 * @route   GET /health
 * @desc    Basic health check
 * @access  Public
 */
router.get('/', asyncHandler(HealthController.checkHealth.bind(HealthController)));

/**
 * @route   GET /health/detailed
 * @desc    Detailed health check with system info
 * @access  Public
 */
router.get(
  '/detailed',
  asyncHandler(HealthController.checkDetailedHealth.bind(HealthController))
);

/**
 * @route   GET /health/ready
 * @desc    Readiness check - verifies all dependencies
 * @access  Public
 */
router.get(
  '/ready',
  asyncHandler(HealthController.checkReadiness.bind(HealthController))
);

/**
 * @route   GET /health/live
 * @desc    Liveness check - verifies service is alive
 * @access  Public
 */
router.get(
  '/live',
  asyncHandler(HealthController.checkLiveness.bind(HealthController))
);

/**
 * @route   GET /health/keys
 * @desc    Key status check
 * @access  Private (Internal)
 */
router.get(
  '/keys',
  asyncHandler(HealthController.checkKeyStatus.bind(HealthController))
);

module.exports = router;
