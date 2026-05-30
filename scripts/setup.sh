#!/bin/bash
#
# EINPAY Gateway - Ubuntu VPS Setup Script
# Run this script on your Ubuntu VPS to set up the EINPAY Gateway
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_DIR="/var/www/einpay-gateway"
NODE_VERSION="18"
SERVICE_USER="www-data"
DOMAIN="einpay.rollix777.com"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  EINPAY Gateway Setup Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}This script must be run as root${NC}" 
   exit 1
fi

# Update system
echo -e "${YELLOW}[1/10] Updating system packages...${NC}"
apt update && apt upgrade -y

# Install essential packages
echo -e "${YELLOW}[2/10] Installing essential packages...${NC}"
apt install -y curl wget git build-essential nginx software-properties-common apt-transport-https ca-certificates gnupg2

# Install Node.js
echo -e "${YELLOW}[3/10] Installing Node.js ${NODE_VERSION}...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt install -y nodejs
fi

echo -e "${GREEN}Node.js version: $(node --version)${NC}"
echo -e "${GREEN}npm version: $(npm --version)${NC}"

# Install PM2
echo -e "${YELLOW}[4/10] Installing PM2...${NC}"
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
fi
echo -e "${GREEN}PM2 version: $(pm2 --version)${NC}"

# Create application directory
echo -e "${YELLOW}[5/10] Creating application directory...${NC}"
mkdir -p ${APP_DIR}
chown -R ${SERVICE_USER}:${SERVICE_USER} ${APP_DIR}

# Create log directory
echo -e "${YELLOW}[6/10] Creating log directory...${NC}"
mkdir -p ${APP_DIR}/logs
chown -R ${SERVICE_USER}:${SERVICE_USER} ${APP_DIR}/logs

# Create keys directory with secure permissions
echo -e "${YELLOW}[7/10] Setting up keys directory...${NC}"
mkdir -p ${APP_DIR}/keys
chmod 700 ${APP_DIR}/keys
chown -R ${SERVICE_USER}:${SERVICE_USER} ${APP_DIR}/keys

echo -e "${YELLOW}NOTE: Please manually copy your PEM files to:${NC}"
echo -e "${YELLOW}  - ${APP_DIR}/keys/private.pem${NC}"
echo -e "${YELLOW}  - ${APP_DIR}/keys/public.pem${NC}"
echo -e "${YELLOW}  - ${APP_DIR}/keys/einpay-api-public.pem${NC}"
echo -e "${YELLOW}  - ${APP_DIR}/keys/einpay-callback-public.pem${NC}"
echo ""

# Setup Nginx
echo -e "${YELLOW}[8/10] Configuring Nginx...${NC}"

# Create Nginx config
cat > /etc/nginx/sites-available/${DOMAIN} << 'EOF'
upstream einpay_backend {
    server 127.0.0.1:3000;
    keepalive 32;
}

limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;

server {
    listen 80;
    server_name DOMAIN_PLACEHOLDER;
    
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    location / {
        return 301 https://$server_name$request_uri;
    }
}
EOF

sed -i "s/DOMAIN_PLACEHOLDER/${DOMAIN}/g" /etc/nginx/sites-available/${DOMAIN}

# Enable site
ln -sf /etc/nginx/sites-available/${DOMAIN} /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration
nginx -t

# Restart Nginx
systemctl restart nginx

# Install Certbot
echo -e "${YELLOW}[9/10] Installing Certbot for SSL...${NC}"
apt install -y certbot python3-certbot-nginx

echo -e "${YELLOW}NOTE: To obtain SSL certificate, run:${NC}"
echo -e "${YELLOW}  certbot --nginx -d ${DOMAIN}${NC}"
echo ""

# Setup firewall
echo -e "${YELLOW}[10/10] Configuring firewall...${NC}"
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 'Nginx Full'
ufw --force enable

echo -e "${GREEN}Firewall status:${NC}"
ufw status

# Create systemd service for PM2
echo -e "${YELLOW}Creating PM2 startup script...${NC}"
env PATH=$PATH:/usr/bin pm2 startup systemd -u ${SERVICE_USER} --hp /var/www

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo -e "${BLUE}1. Copy your application files to: ${APP_DIR}${NC}"
echo -e "${BLUE}2. Copy PEM files to: ${APP_DIR}/keys/${NC}"
echo -e "${BLUE}3. Set correct permissions: chmod 600 ${APP_DIR}/keys/*.pem${NC}"
echo -e "${BLUE}4. Copy and edit .env file: cp .env.example .env${NC}"
echo -e "${BLUE}5. Install dependencies: cd ${APP_DIR} && npm install${NC}"
echo -e "${BLUE}6. Start with PM2: cd ${APP_DIR} && pm2 start ecosystem.config.js --env production${NC}"
echo -e "${BLUE}7. Setup SSL: certbot --nginx -d ${DOMAIN}${NC}"
echo ""
echo -e "${BLUE}Useful Commands:${NC}"
echo -e "  ${BLUE}pm2 logs einpay-gateway${NC} - View logs"
echo -e "  ${BLUE}pm2 monit${NC} - Monitor processes"
echo -e "  ${BLUE}pm2 reload ecosystem.config.js${NC} - Reload application"
echo ""
