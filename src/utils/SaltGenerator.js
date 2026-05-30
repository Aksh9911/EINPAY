const crypto = require('crypto');

/**
 * SaltGenerator - Utility for generating cryptographically secure salts
 */
class SaltGenerator {
  /**
   * Generate a random SHA256 salt
   * @param {number} length - Length of the random bytes (default: 32)
   * @returns {string} - SHA256 hash of random bytes in hex format
   */
  static generate(length = 32) {
    const randomBytes = crypto.randomBytes(length);
    return crypto.createHash('sha256').update(randomBytes).digest('hex');
  }

  /**
   * Generate a unique salt with timestamp component
   * @returns {string} - SHA256 hash combining random bytes and timestamp
   */
  static generateWithTimestamp() {
    const timestamp = Date.now().toString();
    const randomBytes = crypto.randomBytes(32);
    const combined = Buffer.concat([Buffer.from(timestamp), randomBytes]);
    return crypto.createHash('sha256').update(combined).digest('hex');
  }

  /**
   * Generate a cryptographically secure random string
   * @param {number} length - Length of the string (default: 32)
   * @returns {string} - Random string in hex format
   */
  static generateRandomString(length = 32) {
    return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
  }

  /**
   * Generate a UUID v4 compatible string
   * @returns {string} - UUID v4 string
   */
  static generateUUID() {
    return crypto.randomUUID();
  }
}

module.exports = SaltGenerator;
