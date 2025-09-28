const winston = require('winston');
const path = require('path');
const fs = require('fs').promises;

// Ensure logs directory exists
const ensureLogDirectory = async () => {
  const logDir = path.join(__dirname, '../logs');
  try {
    await fs.access(logDir);
  } catch (error) {
    await fs.mkdir(logDir, { recursive: true });
  }
  return logDir;
};

// Custom log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;

    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }

    if (stack) {
      log += `\n${stack}`;
    }

    return log;
  })
);

// Create transports based on environment
const createTransports = async () => {
  const transports = [];
  const logDir = await ensureLogDirectory();

  // Console transport for development
  if (process.env.NODE_ENV !== 'production') {
    transports.push(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            let log = `${timestamp} [${level}]: ${message}`;
            if (Object.keys(meta).length > 0) {
              log += ` ${JSON.stringify(meta)}`;
            }
            return log;
          })
        )
      })
    );
  }

  // File transports
  transports.push(
    // All logs
    new winston.transports.File({
      filename: path.join(logDir, 'app.log'),
      format: logFormat,
      maxsize: parseInt(process.env.LOG_MAX_SIZE) || 10485760, // 10MB
      maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5
    }),

    // Error logs only
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      format: logFormat,
      maxsize: parseInt(process.env.LOG_MAX_SIZE) || 10485760,
      maxFiles: parseInt(process.env.LOG_MAX_FILES) || 10
    }),

    // Combined logs for analysis
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      format: logFormat,
      maxsize: parseInt(process.env.LOG_MAX_SIZE) || 10485760,
      maxFiles: parseInt(process.env.LOG_MAX_FILES) || 30
    })
  );

  // Add external logging services in production
  if (process.env.NODE_ENV === 'production') {
    // Add Winston CloudWatch transport if configured
    if (process.env.CLOUDWATCH_LOG_GROUP) {
      try {
        const WinstonCloudWatch = require('winston-cloudwatch');
        transports.push(
          new WinstonCloudWatch({
            logGroupName: process.env.CLOUDWATCH_LOG_GROUP,
            logStreamName: process.env.CLOUDWATCH_LOG_STREAM || 'api-server',
            awsRegion: process.env.AWS_REGION || 'us-east-1',
            jsonMessage: true
          })
        );
      } catch (error) {
        console.warn('Winston CloudWatch transport not available');
      }
    }

    // Add Papertrail transport if configured
    if (process.env.PAPERTRAIL_HOST && process.env.PAPERTRAIL_PORT) {
      try {
        const Papertrail = require('winston-papertrail').Papertrail;
        transports.push(
          new Papertrail({
            host: process.env.PAPERTRAIL_HOST,
            port: parseInt(process.env.PAPERTRAIL_PORT),
            program: 'multi-vendor-ecommerce-api',
            level: 'info',
            logFormat: (level, message) => `${level}: ${message}`
          })
        );
      } catch (error) {
        console.warn('Winston Papertrail transport not available');
      }
    }
  }

  return transports;
};

// Create logger instance
const createLogger = async () => {
  const transports = await createTransports();

  const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports,
    exitOnError: false
  });

  // Handle uncaught exceptions and unhandled rejections
  logger.exceptions.handle(
    new winston.transports.File({
      filename: path.join(await ensureLogDirectory(), 'exceptions.log')
    })
  );

  logger.rejections.handle(
    new winston.transports.File({
      filename: path.join(await ensureLogDirectory(), 'rejections.log')
    })
  );

  return logger;
};

// Create and export logger
const logger = createLogger().catch(error => {
  console.error('Failed to create logger:', error);
  // Fallback to console logging
  return console;
});

module.exports = logger;
