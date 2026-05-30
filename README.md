# EINPAY Payment Gateway Microservice

Production-ready Node.js microservice for EINPAY (Deposits API v5) integration for ROLLIX777 platform.

## Features

- **Complete EINPAY Integration**: Deposits, callbacks, transaction status, and balance checks
- **JWT/JWS Signing**: RS256 cryptographic signing using `jose` library
- **Callback Verification**: Secure signature verification for EINPAY webhooks
- **Idempotency**: Duplicate transaction and callback prevention
- **Comprehensive Logging**: Winston-based logging with separate log files
- **Security**: Helmet, CORS, rate limiting, input sanitization
- **Production Ready**: PM2 configuration, Nginx setup, health checks
- **Scalable Architecture**: MVC pattern with service layer and repository abstraction

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Key Placement](#key-placement)
5. [Running the Application](#running-the-application)
6. [API Endpoints](#api-endpoints)
7. [PM2 Management](#pm2-management)
8. [Nginx Setup](#nginx-setup)
9. [SSL Configuration](#ssl-configuration)
10. [Log Monitoring](#log-monitoring)
11. [Troubleshooting](#troubleshooting)
12. [MySQL Integration (Future)](#mysql-integration-future)

## Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- Ubuntu 20.04+ (for production deployment)
- PM2 (for process management)
- Nginx (for reverse proxy)
- SSL Certificate (Let's Encrypt recommended)

## Installation

### 1. Clone and Navigate to Project

```bash
cd /var/www
git clone <repository-url> einpay-gateway
cd einpay-gateway
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Create Environment File

```bash
cp .env.example .env
nano .env
```

Edit the `.env` file with your configuration.

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Application port | `3000` |
| `NODE_ENV` | Environment (development/production) | `development` |
| `BASE_URL` | Your gateway domain | `https://einpay.rollix777.com` |
| `EINPAY_BASE_URL` | EINPAY API endpoint | `https://pay18.einpays.com` |
| `EINPAY_CLIENT_ID` | Your EINPAY client ID | `415` |
| `EINPAY_COUNTRY_ID` | Country ID | `1` |
| `EINPAY_CURRENCY_ID` | Currency ID | `3` |
| `TRAFFIC_LEVEL` | Traffic level (1-3) | `2` |
| `PRIVATE_KEY_PATH` | Path to your private key | `./keys/private.pem` |
| `PUBLIC_KEY_PATH` | Path to your public key | `./keys/public.pem` |
| `EINPAY_API_PUBLIC_KEY_PATH` | EINPAY API public key | `./keys/einpay-api-public.pem` |
| `EINPAY_CALLBACK_PUBLIC_KEY_PATH` | EINPAY callback public key | `./keys/einpay-callback-public.pem` |
| `CALLBACK_URL` | Callback endpoint URL | `https://einpay.rollix777.com/api/einpay/callback` |
| `REQUEST_TIMEOUT` | API request timeout (ms) | `30000` |
| `LOG_LEVEL` | Logging level | `info` |

## Key Placement

**IMPORTANT**: Place your RSA keys in the `/keys` directory before starting the application.

```
keys/
├── private.pem                 # Your merchant private key
├── public.pem                  # Your merchant public key
├── einpay-api-public.pem       # EINPAY API public key (for verifying responses)
└── einpay-callback-public.pem  # EINPAY callback public key (for verifying callbacks)
```

### Key File Permissions

Set secure permissions for key files:

```bash
chmod 600 keys/*.pem
chown www-data:www-data keys/*.pem  # If running as www-data
```

**Note**: The application will fail to start if any required key is missing.

## Running the Application

### Development Mode

```bash
npm run dev
```

### Production Mode (PM2)

```bash
# Start with PM2
npm run pm2:start

# Or directly
pm2 start ecosystem.config.js --env production
```

### Verification

Check if the service is running:

```bash
curl https://einpay.rollix777.com/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "einpay",
  "environment": "production"
}
```

## API Endpoints

### Health & Monitoring

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Basic health check |
| GET | `/health/detailed` | Detailed health with system info |
| GET | `/health/ready` | Readiness check |
| GET | `/health/live` | Liveness check |
| GET | `/health/keys` | RSA key status |

### Deposits

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/einpay/deposit` | Create a new deposit |
| GET | `/api/einpay/deposit/:id` | Get deposit status |
| GET | `/api/einpay/deposits/pending` | Get pending deposits |

**Create Deposit Request Body:**
```json
{
  "amount": 1000,
  "requested_method": "UPI",
  "client_user_id": "USER123",
  "client_transaction_id": "TXN123456",
  "client_user_ipaddr": "127.0.0.1",
  "device_type": 20
}
```

**Supported Payment Methods:**
- `UPI`
- `Paytm`
- `PhonePe`
- `GooglePay`
- `PaytmUPI`
- `WHATSAPPPAY`
- `BHIM`
- `BankTransfer`
- `IMPS`

### Transaction Status

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/einpay/status` | Check transaction status |
| GET | `/api/einpay/status/:id` | Get local status |
| POST | `/api/einpay/sync-pending` | Sync pending transactions |

**Status Request Body:**
```json
{
  "orders": ["TXN001", "TXN002"]
}
```

### Balance

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/einpay/balance` | Get merchant balance |
| GET | `/api/einpay/balance/detailed` | Detailed balance with analytics |
| GET | `/api/einpay/balance/history` | Balance history |

### Callbacks

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/einpay/callback` | EINPAY webhook endpoint |
| GET | `/api/einpay/callbacks/:id` | Get callback history |

**Note**: The callback endpoint receives raw JWT tokens from EINPAY.

## PM2 Management

### Start Application

```bash
pm2 start ecosystem.config.js --env production
```

### Stop Application

```bash
pm2 stop ecosystem.config.js
# or
npm run pm2:stop
```

### Restart Application

```bash
pm2 restart ecosystem.config.js
# or
npm run pm2:restart
```

### View Logs

```bash
pm2 logs einpay-gateway
# or
npm run pm2:logs
```

### Monitor

```bash
pm2 monit
# or
npm run pm2:monit
```

### PM2 Startup Script (Auto-start on boot)

```bash
pm2 startup systemd
pm2 save
```

## Nginx Setup

### 1. Copy Nginx Configuration

```bash
sudo cp nginx/einpay.rollix777.com.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/einpay.rollix777.com.conf /etc/nginx/sites-enabled/
```

### 2. Test Configuration

```bash
sudo nginx -t
```

### 3. Restart Nginx

```bash
sudo systemctl restart nginx
```

### 4. Configure Firewall

```bash
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
```

## SSL Configuration (Let's Encrypt)

### 1. Install Certbot

```bash
sudo apt update
sudo apt install certbot python3-certbot-nginx
```

### 2. Obtain Certificate

```bash
sudo certbot --nginx -d einpay.rollix777.com
```

### 3. Auto-renewal Test

```bash
sudo certbot renew --dry-run
```

## Log Monitoring

### Log Files Location

```
logs/
├── request.log       # Incoming requests
├── response.log      # Gateway responses
├── callback.log      # Callback data
├── error.log         # Error logs
└── combined.log      # PM2 combined logs
```

### View Logs

```bash
# Real-time log monitoring
tail -f logs/request.log
tail -f logs/callback.log
tail -f logs/error.log

# PM2 logs
pm2 logs einpay-gateway
```

### Log Rotation

PM2 automatically rotates logs. For manual rotation:

```bash
pm2 flush  # Clear all logs
pm2 reloadLogs  # Reload log files
```

## Troubleshooting

### Application Won't Start

**Problem**: "KeyManager initialization failed"

**Solution**: Ensure all 4 PEM files are in the `/keys` directory:
```bash
ls -la keys/
```

### Signature Verification Fails

**Problem**: Callback or response signature verification fails

**Solution**: 
1. Verify correct keys are in place
2. Check key file permissions (should be 600)
3. Ensure keys are not corrupted
4. Verify EINPAY public keys match what they provided

### Gateway Timeout Errors

**Problem**: 504 Gateway Timeout

**Solution**:
1. Check if application is running: `pm2 status`
2. Verify port 3000 is not blocked: `sudo ufw allow 3000`
3. Check Nginx error logs: `sudo tail -f /var/log/nginx/einpay-error.log`
4. Increase timeout values in Nginx config

### High Memory Usage

**Problem**: Application uses too much memory

**Solution**:
1. Check PM2 memory limits in `ecosystem.config.js`
2. Monitor with: `pm2 monit`
3. Adjust `max_memory_restart` value
4. Check for memory leaks in logs

### Duplicate Transactions

**Problem**: Same transaction being processed multiple times

**Solution**: 
- The service has built-in duplicate prevention
- Check `logs/callback.log` for duplicate detection entries
- Verify your client_transaction_id is unique per transaction

## MySQL Integration (Future)

The repository layer (`src/repositories/RechargeRepository.js`) is designed with TODO comments for easy MySQL integration:

```javascript
// TODO: Integrate with existing MySQL recharge table later.
```

### Steps for MySQL Integration

1. Install MySQL driver:
   ```bash
   npm install mysql2
   ```

2. Update repository methods to use actual MySQL queries

3. Add database connection configuration in `.env`:
   ```
   DB_HOST=localhost
   DB_USER=einpay_user
   DB_PASSWORD=your_password
   DB_NAME=rollix777_db
   ```

4. Implement connection pooling in `src/config/database.js`

The current placeholder implementation stores data in memory for testing purposes.

## Postman Collection

Import the collection from `postman/EINPAY-Gateway-API-Collection.json` for easy API testing.

## Security Considerations

1. **Never commit PEM files** to version control
2. **Use strong firewall rules** - only allow necessary ports
3. **Keep Node.js and dependencies updated**
4. **Monitor logs** for suspicious activity
5. **Use HTTPS only** in production
6. **Implement IP whitelisting** for callbacks if possible
7. **Regular security audits** of dependencies: `npm audit`

## Support

For issues or questions related to:
- **EINPAY API**: Contact EINPAY support
- **This microservice**: Check logs and verify configuration

## License

ISC License - ROLLIX777 Platform

---

**Built for ROLLIX777** | **EINPAY Deposits API v5**
