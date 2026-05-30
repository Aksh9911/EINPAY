/**
 * PM2 Ecosystem Configuration
 * Production-ready process manager configuration for EINPAY Gateway
 */

module.exports = {
  apps: [
    {
      name: 'einpay-gateway',
      script: './server.js',
      instances: 'max', // Use all CPU cores, or specify a number like 2, 4, etc.
      exec_mode: 'cluster', // Enable cluster mode for load balancing
      
      // Environment variables
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      
      // Logging
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      combine_logs: true,
      merge_logs: true,
      
      // Process management
      max_memory_restart: '1G', // Restart if memory exceeds 1GB
      restart_delay: 3000, // Wait 3 seconds before restarting
      max_restarts: 10, // Maximum restarts within min_uptime
      min_uptime: '10s', // Minimum uptime before considering start successful
      
      // Auto-restart settings
      autorestart: true,
      ignore_watch: [
        'node_modules',
        'logs',
        '.git',
        '.env',
        '*.log',
        'nginx',
        'postman',
        'docs'
      ],
      
      // Watch for file changes (development only)
      watch: false, // Set to true for development
      
      // Process killing settings
      kill_timeout: 5000, // Wait 5 seconds before force killing
      listen_timeout: 10000, // Wait 10 seconds for listen
      
      // Health monitoring
      // pmx: false, // Disable PMX monitoring if not needed
      
      // Instance variances (staggered restarts in cluster mode)
      instance_var: 'INSTANCE_ID',
      
      // Node arguments
      node_args: [
        '--max-old-space-size=1024' // Limit heap size to 1GB
      ],
      
      // Advanced settings
      vizion: false, // Disable version control tracking
      
      // Deployment settings (if using PM2 deploy)
      deploy: {
        production: {
          user: 'deploy',
          host: ['einpay.rollix777.com'],
          ref: 'origin/main',
          repo: 'git@github.com:rollix777/einpay-gateway.git',
          path: '/var/www/einpay-gateway',
          'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
          env: {
            NODE_ENV: 'production'
          }
        }
      }
    }
  ]
};
