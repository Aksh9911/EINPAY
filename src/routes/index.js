const express = require('express');
const einpayRoutes = require('./einpay');
const healthRoutes = require('./health');
const payoutRoutes = require('./payout');

const router = express.Router();

// API Routes
router.use('/api/einpay', einpayRoutes);

// Payout Routes
router.use('/api/einpay/payout', payoutRoutes);

// Health Check Routes
router.use('/health', healthRoutes);

// Root endpoint
router.get('/', (req, res) => {
  res.json({
    success: true,
    service: 'EINPAY Gateway',
    version: '1.0.0',
    documentation: '/health',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
