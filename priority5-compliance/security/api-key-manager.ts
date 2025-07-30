// server/security/api-key-manager.ts
/**
 * SECURE API KEY MANAGEMENT
 * 
 * Centralized management of external API keys with encryption at rest,
 * secure retrieval, and audit logging for compliance.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { logger } from '../utils/logger';
import { securityConfig } from '../config/security-config';

export interface APIKeyConfig {
  name: string;
  service: string;
  encryptedKey: string;
  iv: string;
  createdAt: Date;
  lastUsed?: Date;
  usageCount: number;
  isActive: boolean;
}

export class APIKeyManager {
  private static instance: APIKeyManager;
  private keys: Map<string, APIKeyConfig> = new Map();
  private masterKey: Buffer | null = null;

  private constructor() {
    this.initialize();
  }

  public static getInstance(): APIKeyManager {
    if (!APIKeyManager.instance) {
      APIKeyManager.instance = new APIKeyManager();
    }
    return APIKeyManager.instance;
  }

  /**
   * Initialize the API key manager
   */
  private initialize(): void {
    try {
      const envKey = process.env.API_KEY_MASTER_KEY || process.env.ENCRYPTION_KEY;
      
      if (!envKey) {
        if (securityConfig.environment.isProduction) {
          throw new Error('API_KEY_MASTER_KEY or ENCRYPTION_KEY required in production');
        }
        
        // Generate temporary key for development
        this.masterKey = randomBytes(32);
        logger.warn('⚠️  Using temporary API key encryption - keys will not persist');
      } else {
        this.masterKey = Buffer.from(envKey, 'hex');
        if (this.masterKey.length !== 32) {
          throw new Error('Master key must be 32 bytes (64 hex characters)');
        }
      }

      // Load pre-configured API keys from environment
      this.loadEnvironmentKeys();
      
      logger.info('✅ API Key Manager initialized');
    } catch (error) {
      logger.error('❌ Failed to initialize API Key Manager:', error);
      throw error;
    }
  }

  /**
   * Load API keys from environment variables
   */
  private loadEnvironmentKeys(): void {
    const environmentKeys = [
      { name: 'openai', envVar: 'OPENAI_API_KEY', service: 'OpenAI' },
      { name: 'slack', envVar: 'SLACK_BOT_TOKEN', service: 'Slack' },
      { name: 'twilio', envVar: 'TWILIO_AUTH_TOKEN', service: 'Twilio' },
    ];

    for (const keyInfo of environmentKeys) {
      const keyValue = process.env[keyInfo.envVar];
      if (keyValue) {
        try {
          this.storeKey(keyInfo.name, keyValue, keyInfo.service);
          logger.info(`✅ Loaded ${keyInfo.service} API key from environment`);
        } catch (error) {
          logger.error(`❌ Failed to load ${keyInfo.service} API key:`, error);
        }
      }
    }
  }

  /**
   * Store an API key securely
   */
  public storeKey(name: string, key: string, service: string): void {
    if (!this.masterKey) {
      throw new Error('API Key Manager not initialized');
    }

    try {
      // Generate random IV for each key
      const iv = randomBytes(16);
      
      // Encrypt the API key
      const cipher = createCipheriv('aes-256-cbc', this.masterKey, iv);
      let encrypted = cipher.update(key, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // Store encrypted key configuration
      const keyConfig: APIKeyConfig = {
        name,
        service,
        encryptedKey: encrypted,
        iv: iv.toString('hex'),
        createdAt: new Date(),
        usageCount: 0,
        isActive: true,
      };

      this.keys.set(name, keyConfig);
      
      // Clear the plaintext key from memory
      key = '';
      
      logger.info(`🔐 Stored encrypted API key for ${service}`, { keyName: name });
    } catch (error) {
      logger.error(`❌ Failed to store API key for ${service}:`, error);
      throw new Error(`Failed to store API key: ${error.message}`);
    }
  }

  /**
   * Retrieve and decrypt an API key
   */
  public getKey(name: string): string | null {
    if (!this.masterKey) {
      throw new Error('API Key Manager not initialized');
    }

    const keyConfig = this.keys.get(name);
    if (!keyConfig || !keyConfig.isActive) {
      logger.warn(`🔍 API key not found or inactive: ${name}`);
      return null;
    }

    try {
      // Decrypt the API key
      const iv = Buffer.from(keyConfig.iv, 'hex');
      const decipher = createDecipheriv('aes-256-cbc', this.masterKey, iv);
      let decrypted = decipher.update(keyConfig.encryptedKey, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      // Update usage tracking
      keyConfig.lastUsed = new Date();
      keyConfig.usageCount++;

      // Audit log (without the key value)
      logger.debug(`🔓 Retrieved API key for ${keyConfig.service}`, {
        keyName: name,
        service: keyConfig.service,
        usageCount: keyConfig.usageCount,
      });

      return decrypted;
    } catch (error) {
      logger.error(`❌ Failed to decrypt API key for ${name}:`, error);
      return null;
    }
  }

  /**
   * Get OpenAI API key specifically
   */
  public getOpenAIKey(): string {
    const key = this.getKey('openai');
    if (!key) {
      throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY environment variable.');
    }
    return key;
  }

  /**
   * Get Slack API key specifically
   */
  public getSlackKey(): string | null {
    return this.getKey('slack');
  }

  /**
   * Get Twilio API key specifically
   */
  public getTwilioKey(): string | null {
    return this.getKey('twilio');
  }

  /**
   * Deactivate an API key
   */
  public deactivateKey(name: string): boolean {
    const keyConfig = this.keys.get(name);
    if (!keyConfig) {
      return false;
    }

    keyConfig.isActive = false;
    logger.info(`🚫 Deactivated API key: ${name}`);
    return true;
  }

  /**
   * List all configured API keys (without values)
   */
  public listKeys(): Array<{ name: string; service: string; active: boolean; usageCount: number; lastUsed?: Date }> {
    return Array.from(this.keys.values()).map(config => ({
      name: config.name,
      service: config.service,
      active: config.isActive,
      usageCount: config.usageCount,
      lastUsed: config.lastUsed,
    }));
  }

  /**
   * Rotate an API key
   */
  public rotateKey(name: string, newKey: string): boolean {
    const keyConfig = this.keys.get(name);
    if (!keyConfig) {
      logger.warn(`🔄 Cannot rotate non-existent key: ${name}`);
      return false;
    }

    try {
      const service = keyConfig.service;
      this.storeKey(name, newKey, service);
      logger.info(`🔄 Rotated API key for ${service}`, { keyName: name });
      return true;
    } catch (error) {
      logger.error(`❌ Failed to rotate API key for ${name}:`, error);
      return false;
    }
  }

  /**
   * Clear all keys from memory (for shutdown)
   */
  public clearKeys(): void {
    this.keys.clear();
    this.masterKey = null;
    logger.info('🧹 Cleared all API keys from memory');
  }
}

// Export singleton instance
export const apiKeyManager = APIKeyManager.getInstance();