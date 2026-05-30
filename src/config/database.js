const mysql = require('mysql2/promise');
const config = require('./index');
const logger = require('../utils/logger');

/**
 * MySQL Database Connection Pool
 */
class Database {
  constructor() {
    this.pool = null;
  }

  /**
   * Initialize the connection pool
   */
  async initialize() {
    try {
      this.pool = mysql.createPool({
        host: config.database.host,
        user: config.database.user,
        password: config.database.password,
        database: config.database.name,
        port: config.database.port,
        connectionLimit: config.database.connectionLimit,
        waitForConnections: true,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000
      });

      // Test the connection
      const connection = await this.pool.getConnection();
      await connection.ping();
      connection.release();

      logger.info('MySQL database connected successfully', {
        host: config.database.host,
        database: config.database.name,
        table: config.database.tableName
      });

      return true;
    } catch (error) {
      logger.error('Failed to connect to MySQL database', {
        error: error.message,
        host: config.database.host,
        database: config.database.name
      });
      throw error;
    }
  }

  /**
   * Get a connection from the pool
   */
  async getConnection() {
    if (!this.pool) {
      await this.initialize();
    }
    return this.pool.getConnection();
  }

  /**
   * Execute a query
   */
  async query(sql, params) {
    if (!this.pool) {
      await this.initialize();
    }
    
    try {
      const [results] = await this.pool.execute(sql, params);
      return results;
    } catch (error) {
      logger.error('Database query error', {
        error: error.message,
        sql: sql.substring(0, 200),
        params: JSON.stringify(params).substring(0, 200)
      });
      throw error;
    }
  }

  /**
   * Get the recharge table name
   */
  getTableName() {
    return config.database.tableName;
  }
}

// Export singleton instance
module.exports = new Database();
