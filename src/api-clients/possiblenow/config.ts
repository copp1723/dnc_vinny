/**
 * PossibleNOW API Configuration
 * Manages environment-specific settings and credentials
 */

import { PossibleNOWConfig } from './types';

// Environment-specific URLs
const ENDPOINTS = {
  sandbox: {
    baseUrl: 'https://api-sandbox.possiblenow.com/v1',
    authUrl: 'https://auth-sandbox.possiblenow.com/oauth2/token'
  },
  production: {
    baseUrl: 'https://api.possiblenow.com/v1',
    authUrl: 'https://auth.possiblenow.com/oauth2/token'
  }
};

// Default configuration values
const DEFAULTS = {
  timeout: 30000, // 30 seconds
  maxRetries: 3,
  rateLimits: {
    requestsPerSecond: 10,
    requestsPerMinute: 100,
    requestsPerHour: 5000
  }
};

/**
 * Creates a PossibleNOW configuration object
 */
export function createConfig(options: {
  environment: 'sandbox' | 'production';
  clientId: string;
  clientSecret: string;
  scope?: string;
  timeout?: number;
  maxRetries?: number;
  rateLimits?: {
    requestsPerSecond?: number;
    requestsPerMinute?: number;
    requestsPerHour?: number;
  };
}): PossibleNOWConfig {
  const endpoints = ENDPOINTS[options.environment];
  
  return {
    environment: options.environment,
    baseUrl: endpoints.baseUrl,
    authUrl: endpoints.authUrl,
    credentials: {
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      scope: options.scope || 'dnc:read dnc:write'
    },
    timeout: options.timeout || DEFAULTS.timeout,
    maxRetries: options.maxRetries || DEFAULTS.maxRetries,
    rateLimits: {
      ...DEFAULTS.rateLimits,
      ...options.rateLimits
    }
  };
}

/**
 * Creates configuration from environment variables
 */
export function createConfigFromEnv(): PossibleNOWConfig {
  const environment = (process.env.POSSIBLENOW_ENV || 'sandbox') as 'sandbox' | 'production';
  
  if (!process.env.POSSIBLENOW_CLIENT_ID || !process.env.POSSIBLENOW_CLIENT_SECRET) {
    throw new Error('Missing required PossibleNOW credentials in environment variables');
  }
  
  return createConfig({
    environment,
    clientId: process.env.POSSIBLENOW_CLIENT_ID,
    clientSecret: process.env.POSSIBLENOW_CLIENT_SECRET,
    scope: process.env.POSSIBLENOW_SCOPE,
    timeout: process.env.POSSIBLENOW_TIMEOUT ? parseInt(process.env.POSSIBLENOW_TIMEOUT) : undefined,
    maxRetries: process.env.POSSIBLENOW_MAX_RETRIES ? parseInt(process.env.POSSIBLENOW_MAX_RETRIES) : undefined,
    rateLimits: {
      requestsPerSecond: process.env.POSSIBLENOW_RPS ? parseInt(process.env.POSSIBLENOW_RPS) : undefined,
      requestsPerMinute: process.env.POSSIBLENOW_RPM ? parseInt(process.env.POSSIBLENOW_RPM) : undefined,
      requestsPerHour: process.env.POSSIBLENOW_RPH ? parseInt(process.env.POSSIBLENOW_RPH) : undefined
    }
  });
}

/**
 * Validates configuration
 */
export function validateConfig(config: PossibleNOWConfig): void {
  if (!config.credentials.clientId || !config.credentials.clientSecret) {
    throw new Error('Invalid configuration: missing OAuth credentials');
  }
  
  if (!config.baseUrl || !config.authUrl) {
    throw new Error('Invalid configuration: missing API URLs');
  }
  
  if (config.timeout && config.timeout < 1000) {
    throw new Error('Invalid configuration: timeout must be at least 1000ms');
  }
  
  if (config.maxRetries && config.maxRetries < 0) {
    throw new Error('Invalid configuration: maxRetries must be non-negative');
  }
}