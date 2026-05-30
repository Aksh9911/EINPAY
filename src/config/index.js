const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const config = {
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    env: process.env.NODE_ENV || 'development',
    baseUrl: process.env.BASE_URL || 'http://localhost:3000'
  },

  einpay: {
    baseUrl: process.env.EINPAY_BASE_URL || 'https://pay18.einpays.com',
    clientId: parseInt(process.env.EINPAY_CLIENT_ID, 10) || 415,
    countryId: parseInt(process.env.EINPAY_COUNTRY_ID, 10) || 1,
    currencyId: parseInt(process.env.EINPAY_CURRENCY_ID, 10) || 3,
    trafficLevel: parseInt(process.env.TRAFFIC_LEVEL, 10) || 2,
    callbackUrl: process.env.CALLBACK_URL || 'http://localhost:3000/api/einpay/callback'
  },

  keys: {
    privateKeyPath: process.env.PRIVATE_KEY_PATH || './keys/private.pem',
    publicKeyPath: process.env.PUBLIC_KEY_PATH || './keys/public.pem',
    einpayApiPublicKeyPath: process.env.EINPAY_API_PUBLIC_KEY_PATH || './keys/einpay-api-public.pem',
    einpayCallbackPublicKeyPath: process.env.EINPAY_CALLBACK_PUBLIC_KEY_PATH || './keys/einpay-callback-public.pem'
  },

  request: {
    timeout: parseInt(process.env.REQUEST_TIMEOUT, 10) || 30000,
    maxRetries: parseInt(process.env.MAX_RETRIES, 10) || 3,
    retryDelay: parseInt(process.env.RETRY_DELAY, 10) || 1000
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    maxFiles: process.env.LOG_MAX_FILES || '30d',
    maxSize: process.env.LOG_MAX_SIZE || '10m'
  },

  cors: {
    allowedOrigins: process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',') 
      : ['https://www.rollix777.com', 'https://rollix777.com']
  },

  security: {
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS, 10) || 12,
    jwtExpiry: parseInt(process.env.JWT_EXPIRY, 10) || 300
  },

  limits: {
    upi: {
      min: parseInt(process.env.UPI_MIN_AMOUNT, 10) || 300,
      max: parseInt(process.env.UPI_MAX_AMOUNT, 10) || 100000
    },
    bank: {
      min: parseInt(process.env.BANK_MIN_AMOUNT, 10) || 500,
      max: parseInt(process.env.BANK_MAX_AMOUNT, 10) || 100000
    }
  },

  database: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    name: process.env.DB_NAME || 'rollix777',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    tableName: process.env.DB_TABLE_NAME || 'recharge',
    connectionLimit: 10
  },

  platform: {
    baseUrl: process.env.PLATFORM_BASE_URL || 'https://api.rollix777.com',
    apiKey: process.env.PLATFORM_API_KEY
  },

  paymentMethods: [
    'UPI',
    'Paytm',
    'PhonePe',
    'GooglePay',
    'PaytmUPI',
    'WHATSAPPPAY',
    'BHIM',
    'BankTransfer',
    'IMPS'
  ],

  upiMethods: ['UPI', 'Paytm', 'PhonePe', 'GooglePay', 'PaytmUPI', 'WHATSAPPPAY', 'BHIM'],
  bankMethods: ['BankTransfer', 'IMPS']
};

module.exports = config;
