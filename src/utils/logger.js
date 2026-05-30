const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const config = require('../config');

const { combine, timestamp, json, errors } = winston.format;

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
  })
);

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');

// Transports array
const transports = [
  // Console transport
  new winston.transports.Console({
    format: config.server.env === 'development' ? consoleFormat : combine(timestamp(), json()),
    level: config.logging.level
  })
];

// File transports for production
if (config.server.env === 'production') {
  // Request logs
  transports.push(
    new DailyRotateFile({
      filename: path.join(logsDir, 'request-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles,
      level: 'info',
      format: combine(timestamp(), json()),
      auditFile: path.join(logsDir, '.request-audit.json')
    })
  );

  // Response logs
  transports.push(
    new DailyRotateFile({
      filename: path.join(logsDir, 'response-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles,
      level: 'info',
      format: combine(timestamp(), json()),
      auditFile: path.join(logsDir, '.response-audit.json')
    })
  );

  // Callback logs
  transports.push(
    new DailyRotateFile({
      filename: path.join(logsDir, 'callback-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles,
      level: 'info',
      format: combine(timestamp(), json()),
      auditFile: path.join(logsDir, '.callback-audit.json')
    })
  );

  // Error logs
  transports.push(
    new DailyRotateFile({
      filename: path.join(logsDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles,
      level: 'error',
      format: combine(timestamp(), errors({ stack: true }), json()),
      auditFile: path.join(logsDir, '.error-audit.json')
    })
  );
}

// Create logger instance
const logger = winston.createLogger({
  level: config.logging.level,
  defaultMeta: {
    service: 'einpay-gateway',
    environment: config.server.env
  },
  transports,
  exitOnError: false
});

// Stream for Morgan HTTP logging
logger.stream = {
  write: (message) => {
    logger.info(message.trim(), { type: 'http' });
  }
};

// Specialized log methods
logger.logRequest = (data) => {
  logger.info('Incoming Request', {
    type: 'request',
    ...data
  });
};

logger.logResponse = (data) => {
  logger.info('Gateway Response', {
    type: 'response',
    ...data
  });
};

logger.logCallback = (data) => {
  logger.info('Callback Received', {
    type: 'callback',
    ...data
  });
};

logger.logError = (error, context = {}) => {
  logger.error('Error occurred', {
    type: 'error',
    message: error.message,
    stack: error.stack,
    ...context
  });
};

logger.logSignatureVerification = (data) => {
  logger.info('Signature Verification', {
    type: 'signature',
    ...data
  });
};

logger.logDeposit = (data) => {
  logger.info('Deposit Operation', {
    type: 'deposit',
    ...data
  });
};

module.exports = logger;
