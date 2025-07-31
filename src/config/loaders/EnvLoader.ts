import { Config, DealershipConfig } from '../schemas';
import * as dotenv from 'dotenv';
import { z } from 'zod';

export class EnvLoader {
  private envPrefix: string;

  constructor(envPrefix: string = 'DNC_VINNY') {
    this.envPrefix = envPrefix;
    dotenv.config();
  }

  /**
   * Load configuration from environment variables
   */
  load(): Partial<Config> {
    const config: Partial<Config> = {};

    // Load global settings
    config.version = this.getEnv('VERSION', '1.0.0');
    config.environment = this.getEnv('ENVIRONMENT', 'development') as any;

    // Load security settings
    config.security = {
      encryption: {
        algorithm: this.getEnv('ENCRYPTION_ALGORITHM', 'aes-256-gcm') as any,
        keyDerivation: this.getEnv('KEY_DERIVATION', 'pbkdf2') as any,
        saltLength: this.getEnvNumber('SALT_LENGTH', 32),
        iterations: this.getEnvNumber('KEY_ITERATIONS', 100000),
      },
      authentication: {
        required: this.getEnvBoolean('AUTH_REQUIRED', true),
        type: this.getEnv('AUTH_TYPE', 'api_key') as any,
        sessionTimeout: this.getEnvNumber('SESSION_TIMEOUT', 3600000),
      },
      audit: {
        enabled: this.getEnvBoolean('AUDIT_ENABLED', true),
        logLevel: this.getEnv('AUDIT_LOG_LEVEL', 'info') as any,
        retentionDays: this.getEnvNumber('AUDIT_RETENTION_DAYS', 90),
      },
    };

    // Load global configuration
    config.global = {
      logLevel: this.getEnv('LOG_LEVEL', 'info') as any,
      tempDirectory: this.getEnv('TEMP_DIRECTORY', './temp'),
      dataDirectory: this.getEnv('DATA_DIRECTORY', './data'),
      healthCheck: {
        enabled: this.getEnvBoolean('HEALTH_CHECK_ENABLED', true),
        interval: this.getEnvNumber('HEALTH_CHECK_INTERVAL', 60000),
        timeout: this.getEnvNumber('HEALTH_CHECK_TIMEOUT', 10000),
      },
    };

    // Load features
    config.features = {
      autoSync: this.getEnvBoolean('FEATURE_AUTO_SYNC', true),
      webhooks: this.getEnvBoolean('FEATURE_WEBHOOKS', true),
      reporting: this.getEnvBoolean('FEATURE_REPORTING', true),
      scheduling: this.getEnvBoolean('FEATURE_SCHEDULING', true),
    };

    // Load dealership configurations
    const dealershipIds = this.getEnv('DEALERSHIP_IDS', '').split(',').filter(Boolean);
    if (dealershipIds.length > 0) {
      config.dealerships = dealershipIds.map(id => this.loadDealershipConfig(id));
    }

    return config;
  }

  /**
   * Load a specific dealership configuration from environment
   */
  private loadDealershipConfig(dealershipId: string): DealershipConfig {
    const prefix = `${this.envPrefix}_${dealershipId.toUpperCase()}`;

    return {
      id: dealershipId,
      name: this.getEnv(`${prefix}_NAME`, dealershipId),
      active: this.getEnvBoolean(`${prefix}_ACTIVE`, true),
      vinSolutions: {
        baseUrl: this.getEnv(`${prefix}_VIN_BASE_URL`, 'https://api.vinsolutions.com'),
        apiKey: this.getEnv(`${prefix}_VIN_API_KEY`, ''),
        apiSecret: this.getEnv(`${prefix}_VIN_API_SECRET`, ''),
        dealershipId: this.getEnv(`${prefix}_VIN_DEALERSHIP_ID`, dealershipId),
        timeout: this.getEnvNumber(`${prefix}_VIN_TIMEOUT`, 30000),
        retryAttempts: this.getEnvNumber(`${prefix}_VIN_RETRY_ATTEMPTS`, 3),
        retryDelay: this.getEnvNumber(`${prefix}_VIN_RETRY_DELAY`, 1000),
      },
      possibleNOW: {
        baseUrl: this.getEnv(`${prefix}_PN_BASE_URL`, 'https://api.possiblenow.com'),
        username: this.getEnv(`${prefix}_PN_USERNAME`, ''),
        password: this.getEnv(`${prefix}_PN_PASSWORD`, ''),
        accountId: this.getEnv(`${prefix}_PN_ACCOUNT_ID`, ''),
        apiVersion: this.getEnv(`${prefix}_PN_API_VERSION`, 'v1'),
        timeout: this.getEnvNumber(`${prefix}_PN_TIMEOUT`, 30000),
        retryAttempts: this.getEnvNumber(`${prefix}_PN_RETRY_ATTEMPTS`, 3),
        webhookUrl: this.getEnv(`${prefix}_PN_WEBHOOK_URL`, undefined),
      },
      workflow: {
        batchSize: this.getEnvNumber(`${prefix}_BATCH_SIZE`, 100),
        maxConcurrent: this.getEnvNumber(`${prefix}_MAX_CONCURRENT`, 5),
        processingDelay: this.getEnvNumber(`${prefix}_PROCESSING_DELAY`, 1000),
        errorThreshold: this.getEnvNumber(`${prefix}_ERROR_THRESHOLD`, 10),
        retryPolicy: {
          maxRetries: this.getEnvNumber(`${prefix}_MAX_RETRIES`, 3),
          backoffMultiplier: this.getEnvNumber(`${prefix}_BACKOFF_MULTIPLIER`, 2),
          maxBackoffMs: this.getEnvNumber(`${prefix}_MAX_BACKOFF_MS`, 60000),
        },
        timeout: {
          job: this.getEnvNumber(`${prefix}_TIMEOUT_JOB`, 300000),
          batch: this.getEnvNumber(`${prefix}_TIMEOUT_BATCH`, 600000),
          total: this.getEnvNumber(`${prefix}_TIMEOUT_TOTAL`, 3600000),
        },
      },
    };
  }

  /**
   * Get environment variable with optional default
   */
  private getEnv(key: string, defaultValue?: string): string {
    const fullKey = `${this.envPrefix}_${key}`;
    return process.env[fullKey] || defaultValue || '';
  }

  /**
   * Get environment variable as number
   */
  private getEnvNumber(key: string, defaultValue: number): number {
    const value = this.getEnv(key);
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Get environment variable as boolean
   */
  private getEnvBoolean(key: string, defaultValue: boolean): boolean {
    const value = this.getEnv(key).toLowerCase();
    if (value === 'true' || value === '1' || value === 'yes') return true;
    if (value === 'false' || value === '0' || value === 'no') return false;
    return defaultValue;
  }

  /**
   * Export current configuration to environment variable format
   */
  static exportToEnv(config: Config, prefix: string = 'DNC_VINNY'): string {
    const lines: string[] = [];

    // Global settings
    lines.push(`${prefix}_VERSION=${config.version}`);
    lines.push(`${prefix}_ENVIRONMENT=${config.environment}`);

    // Security settings
    lines.push(`${prefix}_ENCRYPTION_ALGORITHM=${config.security.encryption.algorithm}`);
    lines.push(`${prefix}_KEY_DERIVATION=${config.security.encryption.keyDerivation}`);
    lines.push(`${prefix}_SALT_LENGTH=${config.security.encryption.saltLength}`);
    lines.push(`${prefix}_KEY_ITERATIONS=${config.security.encryption.iterations}`);

    // Dealership IDs
    lines.push(`${prefix}_DEALERSHIP_IDS=${config.dealerships.map(d => d.id).join(',')}`);

    // Per-dealership settings
    for (const dealership of config.dealerships) {
      const dPrefix = `${prefix}_${dealership.id.toUpperCase()}`;
      
      lines.push(`${dPrefix}_NAME=${dealership.name}`);
      lines.push(`${dPrefix}_ACTIVE=${dealership.active}`);
      
      // VinSolutions
      lines.push(`${dPrefix}_VIN_BASE_URL=${dealership.vinSolutions.baseUrl}`);
      lines.push(`${dPrefix}_VIN_API_KEY=${dealership.vinSolutions.apiKey}`);
      lines.push(`${dPrefix}_VIN_API_SECRET=<ENCRYPTED>`);
      lines.push(`${dPrefix}_VIN_DEALERSHIP_ID=${dealership.vinSolutions.dealershipId}`);
      
      // PossibleNOW
      lines.push(`${dPrefix}_PN_BASE_URL=${dealership.possibleNOW.baseUrl}`);
      lines.push(`${dPrefix}_PN_USERNAME=${dealership.possibleNOW.username}`);
      lines.push(`${dPrefix}_PN_PASSWORD=<ENCRYPTED>`);
      lines.push(`${dPrefix}_PN_ACCOUNT_ID=${dealership.possibleNOW.accountId}`);
    }

    return lines.join('\n');
  }
}