/**
 * TimestampHelper - Utility for timestamp operations
 */
class TimestampHelper {
  /**
   * Get current UNIX timestamp in seconds
   * @returns {number} - Current UNIX timestamp in seconds
   */
  static getUnixTimestampSeconds() {
    return Math.floor(Date.now() / 1000);
  }

  /**
   * Get current UNIX timestamp in milliseconds
   * @returns {number} - Current UNIX timestamp in milliseconds
   */
  static getUnixTimestampMs() {
    return Date.now();
  }

  /**
   * Convert date to UNIX timestamp in seconds
   * @param {Date|string|number} date - Date object, string, or timestamp
   * @returns {number} - UNIX timestamp in seconds
   */
  static toUnixSeconds(date) {
    const d = new Date(date);
    return Math.floor(d.getTime() / 1000);
  }

  /**
   * Format timestamp to ISO string
   * @param {number} timestamp - UNIX timestamp in seconds
   * @returns {string} - ISO formatted date string
   */
  static toISOString(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.toISOString();
  }

  /**
   * Format timestamp to local date string
   * @param {number} timestamp - UNIX timestamp in seconds
   * @returns {string} - Local formatted date string
   */
  static toLocalString(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  /**
   * Add seconds to current timestamp
   * @param {number} seconds - Seconds to add
   * @returns {number} - Future UNIX timestamp in seconds
   */
  static addSeconds(seconds) {
    return this.getUnixTimestampSeconds() + seconds;
  }

  /**
   * Check if timestamp is expired
   * @param {number} timestamp - UNIX timestamp in seconds to check
   * @param {number} ttlSeconds - Time to live in seconds
   * @returns {boolean} - True if expired, false otherwise
   */
  static isExpired(timestamp, ttlSeconds) {
    const current = this.getUnixTimestampSeconds();
    return (current - timestamp) > ttlSeconds;
  }

  /**
   * Calculate time difference in seconds
   * @param {number} startTimestamp - Start UNIX timestamp in seconds
   * @param {number} endTimestamp - End UNIX timestamp in seconds (optional, defaults to now)
   * @returns {number} - Difference in seconds
   */
  static getDiffSeconds(startTimestamp, endTimestamp = null) {
    const end = endTimestamp || this.getUnixTimestampSeconds();
    return end - startTimestamp;
  }

  /**
   * Get timestamp for specific time ago
   * @param {number} secondsAgo - Seconds in the past
   * @returns {number} - UNIX timestamp in seconds
   */
  static getTimeAgo(secondsAgo) {
    return this.getUnixTimestampSeconds() - secondsAgo;
  }
}

module.exports = TimestampHelper;
