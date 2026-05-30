# EINPAY Gateway - Quick Start Guide

## 1. Prerequisites

- Ubuntu 20.04+ VPS
- Domain: `einpay.rollix777.com` pointing to your VPS
- PEM files ready:
  - `private.pem` - Your RSA private key
  - `public.pem` - Your RSA public key  
  - `einpay-api-public.pem` - EINPAY API public key
  - `einpay-callback-public.pem` - EINPAY callback public key

## 2. Server Setup (One-time)

```bash
# Run setup script on your VPS
sudo bash scripts/setup.sh
```

## 3. Deploy Application

```bash
# On your local machine, copy files to VPS
scp -r . root@einpay.rollix777.com:/var/www/einpay-gateway/

# Or use git
git clone <your-repo> /var/www/einpay-gateway
```

## 4. Configure Keys

```bash
# On VPS, copy your PEM files
scp private.pem root@einpay.rollix777.com:/var/www/einpay-gateway/keys/
scp public.pem root@einpay.rollix777.com:/var/www/einpay-gateway/keys/
scp einpay-api-public.pem root@einpay.rollix777.com:/var/www/einpay-gateway/keys/
scp einpay-callback-public.pem root@einpay.rollix777.com:/var/www/einpay-gateway/keys/

# Set permissions
chmod 600 /var/www/einpay-gateway/keys/*.pem
chown www-data:www-data /var/www/einpay-gateway/keys/*.pem
```

## 5. Configure Environment

```bash
cd /var/www/einpay-gateway
cp .env.example .env
nano .env
# Edit the .env file with your configuration
```

## 6. Install & Start

```bash
cd /var/www/einpay-gateway
npm install
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

## 7. Setup SSL

```bash
certbot --nginx -d einpay.rollix777.com
```

## 8. Verify

```bash
# Test health endpoint
curl https://einpay.rollix777.com/health

# Test key status
curl https://einpay.rollix777.com/health/keys
```

## Common Commands

```bash
# View logs
pm2 logs einpay-gateway

# Restart
pm2 restart einpay-gateway

# Monitor
pm2 monit

# Update code
cd /var/www/einpay-gateway && git pull && pm2 reload ecosystem.config.js
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/einpay/deposit` | POST | Create deposit |
| `/api/einpay/status` | POST | Check transaction status |
| `/api/einpay/balance` | GET | Get balance |
| `/api/einpay/callback` | POST | EINPAY webhook |

## Need Help?

- Check logs: `pm2 logs`
- Verify keys: `curl /health/keys`
- Read full docs: [README.md](README.md)
