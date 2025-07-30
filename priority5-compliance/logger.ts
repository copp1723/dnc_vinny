// server/utils/logger.ts - Logging utility
import winston from 'winston';
import fs from 'fs';
import path from 'path';

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Create the logger
export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: logFormat,
  defaultMeta: { service: 'dealership-automation' },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaString = Object.keys(meta).length > 0 
            ? `\n${JSON.stringify(meta, null, 2)}`
            : '';
          return `${timestamp} ${level}: ${message}${metaString}`;
        })
      )
    }),
    
    // File transports
    new winston.transports.File({ 
      filename: path.join(logsDir, 'error.log'), 
      level: 'error'
    }),
    new winston.transports.File({ 
      filename: path.join(logsDir, 'combined.log')
    }),
    
    // Task-specific logs
    new winston.transports.File({
      filename: path.join(logsDir, 'tasks.log'),
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  ]
});

// Export default
export default logger;