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

const pageNotExisted = (req, res) => {
  res.status(404).type('text/plain').send('Page not existed');
};

router.all('/api/docs', pageNotExisted);
router.all('/api/docs/*', pageNotExisted);
router.all('/swagger', pageNotExisted);
router.all('/docs', pageNotExisted);

router.get('/', pageNotExisted);

module.exports = router;
