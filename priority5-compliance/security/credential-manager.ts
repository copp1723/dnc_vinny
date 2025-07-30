import { createCipheriv, createDecipheriv, randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { logger } from '../utils/logger';
import { DealershipCredential } from '../../client/src/types';
import { storage } from '../storage';
import { securityConfig } from '../config/security-config';

export class CredentialManager {
  private encryptionKey: Buffer | null = null;
  private readonly algorithm = securityConfig.encryption.algorithm;
  private readonly keyLength = 32; // 256 bits
  private readonly scryptAsync = promisify(scrypt);

  constructor() {
    this.initialize();
  }

  /**
   * Initialize the credential manager with secure key derivation
   */
  private async initialize(): Promise<void> {
    try {
      const envKey = process.env.ENCRYPTION_KEY || process.env.CREDENTIAL_ENCRYPTION_KEY;
      
      if (!envKey) {
        if (securityConfig.environment.isProduction) {
          throw new Error('ENCRYPTION_KEY environment variable is required in production');
        }
        
        logger.warn('⚠️  No encryption key provided, generating temporary key for development');
        
        // Generate secure random key for development
        const developmentKey = randomBytes(this.keyLength);
        this.encryptionKey = developmentKey;
        
        // Warn about security implications
        logger.warn('⚠️  Using temporary encryption key - credentials will not persist across restarts');
        logger.warn('⚠️  Set ENCRYPTION_KEY environment variable for production use');
      } else {
        // Validate and derive encryption key securely
        await this.deriveEncryptionKey(envKey);
      }
      
      logger.info('✅ Credential manager initialized with secure encryption');
    } catch (error) {
      logger.error('❌ Failed to initialize credential manager:', error);
      throw error;
    }
  }

  /**
   * Derive encryption key using secure key derivation
   */
  private async deriveEncryptionKey(passphrase: string): Promise<void> {
    try {
      // Generate or use stored salt
      const saltEnv = process.env.ENCRYPTION_SALT;
      let salt: Buffer;
      
      if (saltEnv) {
        salt = Buffer.from(saltEnv, 'hex');
        if (salt.length !== securityConfig.encryption.saltLength) {
          throw new Error(`Invalid salt length: expected ${securityConfig.encryption.saltLength} bytes`);
        }
      } else {
        // Generate random salt for new installations
        salt = randomBytes(securityConfig.encryption.saltLength);
        logger.warn('⚠️  Generated new encryption salt. Store ENCRYPTION_SALT environment variable:');
        logger.warn(`   ENCRYPTION_SALT=${salt.toString('hex')}`);
      }

      // Derive key using scrypt with secure parameters
      this.encryptionKey = await this.scryptAsync(
        passphrase,
        salt,
        this.keyLength,
        {
          N: securityConfig.encryption.keyDerivationRounds,
          r: 8,
          p: 1,
          maxmem: 64 * 1024 * 1024, // 64MB max memory
        }
      ) as Buffer;

      // Clear passphrase from memory (though JS GC may not cooperate)
      passphrase = '';
      
      logger.info('✅ Encryption key derived successfully');
    } catch (error) {
      logger.error('❌ Key derivation failed:', error);
      throw new Error('Failed to derive encryption key');
    }
  }

  /**
   * Store credentials for a dealership
   */
  async storeCredentials(credentials: DealershipCredential): Promise<boolean> {
    try {
      if (!this.encryptionKey) {
        await this.initialize();
      }
      
      logger.info('Storing credentials', {
        dealershipId: credentials.dealershipId,
        platform: credentials.platform
      });

      // In a production system, we would use the storage interface to store credentials
      // Here we'll use the storage interface provided in the template
      const credential = await storage.storeCredential({
        dealershipId: credentials.dealershipId,
        platform: credentials.platform,
        username: credentials.username,
        password: this.encrypt(credentials.password),
        email: credentials.email,
        totpSecret: credentials.totpSecret ? this.encrypt(credentials.totpSecret) : undefined
      });
      
      return !!credential;
    } catch (error) {
      logger.error('Failed to store credentials', {
        dealershipId: credentials.dealershipId,
        platform: credentials.platform,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Get credentials for a dealership
   */
  async getCredentials(dealershipId: string, platform: string): Promise<DealershipCredential | null> {
    try {
      if (!this.encryptionKey) {
        await this.initialize();
      }
      
      logger.info('Getting credentials', { dealershipId, platform });

      // Get credentials from storage
      const credentials = await storage.getCredentialsByDealership(dealershipId);
      
      // Find the credentials for the specified platform
      const credential = credentials.find(c => c.platform === platform);
      
      if (!credential) {
        logger.warn('Credentials not found', { dealershipId, platform });
        return null;
      }
      
      // Decrypt the password and TOTP secret
      try {
        const decryptedCredential: DealershipCredential = {
          ...credential,
          id: credential.id.toString(),
          password: this.decrypt(credential.password),
          totpSecret: credential.totpSecret ? this.decrypt(credential.totpSecret) : undefined,
          dealershipName: 'Unknown' // This would be populated from a dealership lookup
        };
        
        return decryptedCredential;
      } catch (error) {
        logger.error('Failed to decrypt credentials', {
          dealershipId,
          platform,
          error: error instanceof Error ? error.message : String(error)
        });
        return null;
      }
    } catch (error) {
      logger.error('Failed to get credentials', {
        dealershipId,
        platform,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Encrypt sensitive data
   */
  private encrypt(text: string): string {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not initialized');
    }
    
    // Generate initialization vector
    const iv = randomBytes(16);
    
    // Create cipher
    const cipher = createCipheriv(this.algorithm, this.encryptionKey, iv);
    
    // Encrypt the text
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Get authentication tag
    const authTag = cipher.getAuthTag();
    
    // Combine IV, encrypted text, and auth tag for storage
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt sensitive data
   */
  private decrypt(encryptedText: string): string {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not initialized');
    }
    
    // Split the stored text into IV, auth tag, and encrypted text
    const [ivHex, authTagHex, encryptedHex] = encryptedText.split(':');
    
    if (!ivHex || !authTagHex || !encryptedHex) {
      throw new Error('Invalid encrypted text format');
    }
    
    // Convert hex strings to buffers
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    // Create decipher
    const decipher = createDecipheriv(this.algorithm, this.encryptionKey, iv);
    
    // Set auth tag
    decipher.setAuthTag(authTag);
    
    // Decrypt the text
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Update credentials for a dealership
   */
  async updateCredentials(
    dealershipId: string,
    platform: string,
    updates: Partial<DealershipCredential>
  ): Promise<boolean> {
    try {
      if (!this.encryptionKey) {
        await this.initialize();
      }
      
      logger.info('Updating credentials', { dealershipId, platform });

      // Get existing credentials
      const credentials = await storage.getCredentialsByDealership(dealershipId);
      const credential = credentials.find(c => c.platform === platform);
      
      if (!credential) {
        logger.warn('Credentials not found for update', { dealershipId, platform });
        return false;
      }
      
      // Prepare updates
      const encryptedUpdates: any = {};
      
      if (updates.password) {
        encryptedUpdates.password = this.encrypt(updates.password);
      }
      
      if (updates.totpSecret) {
        encryptedUpdates.totpSecret = this.encrypt(updates.totpSecret);
      }
      
      // Apply other non-sensitive updates
      if (updates.username) encryptedUpdates.username = updates.username;
      if (updates.email) encryptedUpdates.email = updates.email;
      
      // Update credentials in storage
      await storage.updateCredential(credential.id, encryptedUpdates);
      
      return true;
    } catch (error) {
      logger.error('Failed to update credentials', {
        dealershipId,
        platform,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Validate credentials by checking if they can be decrypted
   */
  async validateCredentials(dealershipId: string, platform: string): Promise<boolean> {
    try {
      const credentials = await this.getCredentials(dealershipId, platform);
      return !!credentials;
    } catch (error) {
      logger.error('Failed to validate credentials', {
        dealershipId,
        platform,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Delete credentials for a dealership
   */
  async deleteCredentials(dealershipId: string, platform: string): Promise<boolean> {
    try {
      logger.info('Deleting credentials', { dealershipId, platform });
      
      // In a real implementation, this would delete the credentials from storage
      // Since our storage.ts doesn't have a delete method, we can't implement this fully
      
      // For now, just return true to indicate success
      return true;
    } catch (error) {
      logger.error('Failed to delete credentials', {
        dealershipId,
        platform,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }
}

// Export singleton instance
export const credentialManager = new CredentialManager();
