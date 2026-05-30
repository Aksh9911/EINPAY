const EinpayService = require('../services/EinpayService');
const logger = require('../utils/logger');

/**
 * BalanceController - Handles merchant balance checks
 */
class BalanceController {
  /**
   * Get merchant balance
   * GET /api/einpay/balance
   */
  async getBalance(req, res) {
    const correlationId = req.correlationId;

    try {
      logger.info('Balance check requested', {
        operation: 'get_balance',
        correlation_id: correlationId
      });

      const balanceResult = await EinpayService.checkBalance();

      logger.info('Balance retrieved successfully', {
        operation: 'get_balance_success',
        correlation_id: correlationId,
        account_balance: balanceResult.account_balance,
        available_balance: balanceResult.available_balance
      });

      return res.status(200).json({
        success: true,
        correlation_id: correlationId,
        data: {
          account_balance: balanceResult.account_balance,
          payouts_balance: balanceResult.payouts_balance,
          available_balance: balanceResult.available_balance,
          currency: 'INR'
        },
        raw_response: balanceResult.raw_response
      });

    } catch (error) {
      logger.logError(error, {
        operation: 'get_balance_failed',
        correlation_id: correlationId
      });

      let statusCode = 500;
      let message = error.message;

      if (error.isGatewayError) {
        statusCode = 502;
        message = 'Gateway error while fetching balance';
      } else if (error.isTimeout || error.isNetworkError) {
        statusCode = 504;
        message = 'Timeout while fetching balance from gateway';
      }

      return res.status(statusCode).json({
        success: false,
        message: message,
        correlation_id: correlationId,
        ...(process.env.NODE_ENV === 'development' && {
          original_error: error.message,
          stack: error.stack
        })
      });
    }
  }

  /**
   * Get detailed balance with analytics
   * GET /api/einpay/balance/detailed
   */
  async getDetailedBalance(req, res) {
    const correlationId = req.correlationId;

    try {
      logger.info('Detailed balance check requested', {
        operation: 'get_detailed_balance',
        correlation_id: correlationId
      });

      const balanceResult = await EinpayService.checkBalance();

      // Calculate derived values
      const accountBalance = parseFloat(balanceResult.account_balance) || 0;
      const payoutsBalance = parseFloat(balanceResult.payouts_balance) || 0;
      const availableBalance = parseFloat(balanceResult.available_balance) || 0;
      
      const heldAmount = accountBalance - availableBalance;
      const utilizationPercent = accountBalance > 0 
        ? ((accountBalance - availableBalance) / accountBalance * 100).toFixed(2)
        : 0;

      return res.status(200).json({
        success: true,
        correlation_id: correlationId,
        data: {
          summary: {
            account_balance: accountBalance,
            payouts_balance: payoutsBalance,
            available_balance: availableBalance,
            held_amount: heldAmount,
            currency: 'INR'
          },
          analytics: {
            utilization_percent: parseFloat(utilizationPercent),
            available_percent: accountBalance > 0 
              ? ((availableBalance / accountBalance) * 100).toFixed(2)
              : 0,
            health_status: this.getBalanceHealthStatus(availableBalance, accountBalance)
          },
          raw_response: balanceResult.raw_response
        }
      });

    } catch (error) {
      logger.logError(error, {
        operation: 'get_detailed_balance_failed',
        correlation_id: correlationId
      });

      return res.status(500).json({
        success: false,
        message: error.message,
        correlation_id: correlationId
      });
    }
  }

  /**
   * Determine balance health status
   * @param {number} available - Available balance
   * @param {number} total - Total account balance
   * @returns {string} - Health status
   */
  getBalanceHealthStatus(available, total) {
    if (total === 0) return 'NO_BALANCE';
    
    const ratio = available / total;
    
    if (ratio >= 0.5) return 'HEALTHY';
    if (ratio >= 0.2) return 'MODERATE';
    if (ratio >= 0.1) return 'LOW';
    return 'CRITICAL';
  }

  /**
   * Get balance history (placeholder for future implementation)
   * GET /api/einpay/balance/history
   */
  async getBalanceHistory(req, res) {
    const correlationId = req.correlationId;
    const days = parseInt(req.query.days, 10) || 30;

    try {
      logger.info('Balance history requested', {
        operation: 'get_balance_history',
        correlation_id: correlationId,
        days: days
      });

      // TODO: Implement balance history tracking when database is integrated
      return res.status(200).json({
        success: true,
        correlation_id: correlationId,
        message: 'Balance history (placeholder - requires database integration)',
        days_requested: days,
        data: []
      });

    } catch (error) {
      logger.logError(error, {
        operation: 'get_balance_history_failed',
        correlation_id: correlationId
      });

      return res.status(500).json({
        success: false,
        message: error.message,
        correlation_id: correlationId
      });
    }
  }
}

module.exports = new BalanceController();
