const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * KeyManager - Manages RSA keys for EINPAY integration
 * Handles loading and caching of merchant and EINPAY public keys
 */
class KeyManager {
  constructor() {
    this.privateKey = null;
    this.publicKey = null;
    this.einpayApiPublicKey = null;
    this.einpayCallbackPublicKey = null;
    this.initialized = false;
  }

  /**
   * Initialize the KeyManager by loading all required keys
   * Application will fail to start if any required key is missing
   */
  initialize() {
    try {
      logger.info('Initializing KeyManager...');

      // Resolve absolute paths
      const privateKeyPath = path.resolve(config.keys.privateKeyPath);
      const publicKeyPath = path.resolve(config.keys.publicKeyPath);
      const einpayApiPublicKeyPath = path.resolve(config.keys.einpayApiPublicKeyPath);
      const einpayCallbackPublicKeyPath = path.resolve(config.keys.einpayCallbackPublicKeyPath);

      // Load merchant private key
      this.privateKey = this.loadKey(privateKeyPath, 'Merchant Private Key');
      
      // Load merchant public key
      this.publicKey = this.loadKey(publicKeyPath, 'Merchant Public Key');
      
      // Load EINPAY API public key (for verifying responses)
      this.einpayApiPublicKey = this.loadKey(einpayApiPublicKeyPath, 'EINPAY API Public Key');
      
      // Load EINPAY callback public key (for verifying callbacks)
      this.einpayCallbackPublicKey = this.loadKey(einpayCallbackPublicKeyPath, 'EINPAY Callback Public Key');

      this.initialized = true;
      logger.info('KeyManager initialized successfully');
    } catch (error) {
      logger.logError(error, { context: 'KeyManager initialization' });
      throw new Error(`KeyManager initialization failed: ${error.message}`);
    }
  }

  /**
   * Load a key file from disk
   * @param {string} keyPath - Absolute path to the key file
   * @param {string} keyName - Human-readable name for logging
   * @returns {string} - Key content
   * @throws {Error} - If key file cannot be loaded
   */
  loadKey(keyPath, keyName) {
    try {
      if (!fs.existsSync(keyPath)) {
        throw new Error(`${keyName} not found at: ${keyPath}`);
      }

      const keyContent = fs.readFileSync(keyPath, 'utf8');
      
      if (!keyContent || keyContent.trim().length === 0) {
        throw new Error(`${keyName} file is empty: ${keyPath}`);
      }

      // Basic PEM format validation
      if (!keyContent.includes('-----BEGIN') || !keyContent.includes('-----END')) {
        throw new Error(`${keyName} does not appear to be in valid PEM format`);
      }

      logger.info(`${keyName} loaded successfully from: ${keyPath}`);
      return keyContent.trim();
    } catch (error) {
      if (error.code === 'EACCES') {
        throw new Error(`Permission denied reading ${keyName} at: ${keyPath}`);
      }
      if (error.code === 'ENOENT') {
        throw new Error(`${keyName} file not found at: ${keyPath}`);
      }
      throw error;
    }
  }

  /**
   * Get merchant private key for signing requests
   * @returns {string} - Private key in PEM format
   * @throws {Error} - If KeyManager is not initialized
   */
  getMerchantPrivateKey() {
    this.ensureInitialized();
    return this.privateKey;
  }

  /**
   * Get merchant public key
   * @returns {string} - Public key in PEM format
   * @throws {Error} - If KeyManager is not initialized
   */
  getMerchantPublicKey() {
    this.ensureInitialized();
    return this.publicKey;
  }

  /**
   * Get EINPAY API public key for verifying API responses
   * @returns {string} - Public key in PEM format
   * @throws {Error} - If KeyManager is not initialized
   */
  getEinpayApiPublicKey() {
    this.ensureInitialized();
    return this.einpayApiPublicKey;
  }

  /**
   * Get EINPAY callback public key for verifying callback signatures
   * @returns {string} - Public key in PEM format
   * @throws {Error} - If KeyManager is not initialized
   */
  getEinpayCallbackPublicKey() {
    this.ensureInitialized();
    return this.einpayCallbackPublicKey;
  }

  /**
   * Ensure KeyManager has been initialized
   * @throws {Error} - If not initialized
   */
  ensureInitialized() {
    if (!this.initialized) {
      throw new Error('KeyManager not initialized. Call initialize() first.');
    }
  }

  /**
   * Reload all keys from disk (useful for key rotation)
   */
  reloadKeys() {
    logger.info('Reloading all keys...');
    this.initialized = false;
    this.initialize();
  }

  /**
   * Get key information for health check (without exposing key content)
   * @returns {Object} - Key status information
   */
  getKeyStatus() {
    return {
      initialized: this.initialized,
      hasPrivateKey: !!this.privateKey,
      hasPublicKey: !!this.publicKey,
      hasEinpayApiKey: !!this.einpayApiPublicKey,
      hasEinpayCallbackKey: !!this.einpayCallbackPublicKey,
      privateKeyLength: this.privateKey ? this.privateKey.length : 0,
      publicKeyLength: this.publicKey ? this.publicKey.length : 0,
      einpayApiKeyLength: this.einpayApiPublicKey ? this.einpayApiPublicKey.length : 0,
      einpayCallbackKeyLength: this.einpayCallbackPublicKey ? this.einpayCallbackPublicKey.length : 0
    };
  }
}

// Export singleton instance
module.exports = new KeyManager();
