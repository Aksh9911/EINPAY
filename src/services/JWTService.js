const { SignJWT, jwtVerify, importSPKI, importPKCS8, decodeJwt } = require('jose');
const crypto = require('crypto');
const KeyManager = require('./KeyManager');
const logger = require('../utils/logger');

/**
 * JWTService - Handles JWT/JWS signing and verification using RS256
 * Uses the 'jose' package for modern JWT operations
 * Supports both PKCS#1 and PKCS#8 private key formats
 */
class JWTService {
  constructor() {
    this.algorithm = 'RS256';
  }

  /**
   * Convert PKCS#1 private key to PKCS#8 format
   * @param {string} pkcs1Key - Private key in PKCS#1 format (BEGIN RSA PRIVATE KEY)
   * @returns {string} - Private key in PKCS#8 format (BEGIN PRIVATE KEY)
   */
  convertPKCS1ToPKCS8(pkcs1Key) {
    try {
      // Check if already PKCS#8 format
      if (pkcs1Key.includes('-----BEGIN PRIVATE KEY-----')) {
        return pkcs1Key;
      }

      // Check if it's PKCS#1 format
      if (!pkcs1Key.includes('-----BEGIN RSA PRIVATE KEY-----')) {
        throw new Error('Private key is not in RSA PKCS#1 or PKCS#8 format');
      }

      // Extract key content
      const keyContent = pkcs1Key
        .replace('-----BEGIN RSA PRIVATE KEY-----', '')
        .replace('-----END RSA PRIVATE KEY-----', '')
        .replace(/\s/g, '');

      // Convert to PKCS#8 using Node's crypto
      const keyBuffer = Buffer.from(keyContent, 'base64');
      const privateKeyObject = crypto.createPrivateKey({
        key: keyBuffer,
        format: 'der',
        type: 'pkcs1'
      });

      const pkcs8Key = privateKeyObject.export({
        format: 'pem',
        type: 'pkcs8'
      });

      return pkcs8Key;
    } catch (error) {
      logger.logError(error, { context: 'PKCS#1 to PKCS#8 conversion' });
      throw new Error(`Failed to convert private key format: ${error.message}`);
    }
  }

  /**
   * Create a signed JWT payload for EINPAY API requests
   * @param {Object} payload - The payload data to sign
   * @returns {Promise<string>} - Signed JWT token
   */
  async createSignedPayload(payload) {
    try {
      let privateKeyPEM = KeyManager.getMerchantPrivateKey();
      
      // Convert PKCS#1 to PKCS#8 if necessary
      privateKeyPEM = this.convertPKCS1ToPKCS8(privateKeyPEM);
      
      // Import the private key for jose
      const privateKey = await importPKCS8(privateKeyPEM, this.algorithm);

      // Create and sign the JWT
      const jwt = await new SignJWT(payload)
        .setProtectedHeader({ alg: this.algorithm })
        .setIssuedAt()
        .sign(privateKey);

      logger.logSignatureVerification({
        operation: 'sign',
        algorithm: this.algorithm,
        success: true
      });

      return jwt;
    } catch (error) {
      logger.logError(error, { context: 'JWT signing' });
      throw new Error(`Failed to sign JWT: ${error.message}`);
    }
  }

  /**
   * Verify a JWT token from EINPAY API response
   * @param {string} token - JWT token to verify
   * @returns {Promise<Object>} - Decoded and verified payload
   */
  async verifyGatewayJWT(token) {
    try {
      const publicKeyPEM = KeyManager.getEinpayApiPublicKey();
      
      // Import the public key for jose
      const publicKey = await importSPKI(publicKeyPEM, this.algorithm);

      // Verify the JWT
      const { payload } = await jwtVerify(token, publicKey, {
        algorithms: [this.algorithm]
      });

      logger.logSignatureVerification({
        operation: 'verify_gateway',
        algorithm: this.algorithm,
        success: true
      });

      return payload;
    } catch (error) {
      logger.logSignatureVerification({
        operation: 'verify_gateway',
        algorithm: this.algorithm,
        success: false,
        error: error.message
      });
      
      if (error.code === 'ERR_JWT_EXPIRED') {
        throw new Error('Gateway JWT token has expired');
      }
      if (error.code === 'ERR_JWT_INVALID') {
        throw new Error('Invalid gateway JWT token');
      }
      throw new Error(`Failed to verify gateway JWT: ${error.message}`);
    }
  }

  /**
   * Verify a JWT token from EINPAY callback
   * @param {string} token - JWT token from callback
   * @returns {Promise<Object>} - Decoded and verified payload
   */
  async verifyCallbackJWT(token) {
    try {
      const publicKeyPEM = KeyManager.getEinpayCallbackPublicKey();
      
      // Import the public key for jose
      const publicKey = await importSPKI(publicKeyPEM, this.algorithm);

      // Verify the JWT
      const { payload } = await jwtVerify(token, publicKey, {
        algorithms: [this.algorithm]
      });

      logger.logSignatureVerification({
        operation: 'verify_callback',
        algorithm: this.algorithm,
        success: true
      });

      return payload;
    } catch (error) {
      logger.logSignatureVerification({
        operation: 'verify_callback',
        algorithm: this.algorithm,
        success: false,
        error: error.message
      });
      
      if (error.code === 'ERR_JWT_EXPIRED') {
        throw new Error('Callback JWT token has expired');
      }
      if (error.code === 'ERR_JWT_INVALID') {
        throw new Error('Invalid callback JWT token');
      }
      throw new Error(`Failed to verify callback JWT: ${error.message}`);
    }
  }

  /**
   * Decode a JWT token without verification (for inspection)
   * @param {string} token - JWT token to decode
   * @returns {Object} - Decoded payload (not verified)
   */
  decodeJWT(token) {
    try {
      const payload = decodeJwt(token);
      
      logger.logSignatureVerification({
        operation: 'decode',
        success: true,
        hasPayload: !!payload
      });

      return payload;
    } catch (error) {
      logger.logError(error, { context: 'JWT decode' });
      throw new Error(`Failed to decode JWT: ${error.message}`);
    }
  }

  /**
   * Extract header from JWT token without verification
   * @param {string} token - JWT token
   * @returns {Object} - JWT header
   */
  extractHeader(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
      }
      
      const headerJson = Buffer.from(parts[0], 'base64url').toString('utf8');
      return JSON.parse(headerJson);
    } catch (error) {
      logger.logError(error, { context: 'JWT header extraction' });
      throw new Error(`Failed to extract JWT header: ${error.message}`);
    }
  }

  /**
   * Get JWT expiration time
   * @param {string} token - JWT token
   * @returns {number|null} - Expiration timestamp or null
   */
  getExpirationTime(token) {
    try {
      const payload = this.decodeJWT(token);
      return payload.exp || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if JWT is expired
   * @param {string} token - JWT token
   * @returns {boolean} - True if expired or invalid
   */
  isExpired(token) {
    const exp = this.getExpirationTime(token);
    if (!exp) return false;
    
    return Date.now() >= exp * 1000;
  }
}

// Export singleton instance
module.exports = new JWTService();
