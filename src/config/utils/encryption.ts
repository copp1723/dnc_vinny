import * as crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt);

export interface EncryptionConfig {
  algorithm: 'aes-256-gcm' | 'aes-256-cbc';
  keyDerivation: 'pbkdf2' | 'scrypt' | 'argon2';
  saltLength: number;
  iterations: number;
}

export class EncryptionService {
  private readonly config: EncryptionConfig;
  private masterKey: Buffer | null = null;

  constructor(config: EncryptionConfig) {
    this.config = config;
  }

  /**
   * Initialize the encryption service with a master password
   */
  async initialize(masterPassword: string): Promise<void> {
    const salt = this.getOrCreateSalt();
    this.masterKey = await this.deriveKey(masterPassword, salt);
  }

  /**
   * Encrypt sensitive data
   */
  async encrypt(data: string): Promise<string> {
    if (!this.masterKey) {
      throw new Error('Encryption service not initialized');
    }

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.config.algorithm, this.masterKey, iv);

    let encrypted = cipher.update(data, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    let result: Buffer;
    if (this.config.algorithm === 'aes-256-gcm') {
      const authTag = (cipher as crypto.CipherGCM).getAuthTag();
      result = Buffer.concat([iv, authTag, encrypted]);
    } else {
      result = Buffer.concat([iv, encrypted]);
    }

    return result.toString('base64');
  }

  /**
   * Decrypt sensitive data
   */
  async decrypt(encryptedData: string): Promise<string> {
    if (!this.masterKey) {
      throw new Error('Encryption service not initialized');
    }

    const buffer = Buffer.from(encryptedData, 'base64');
    
    let iv: Buffer;
    let authTag: Buffer | undefined;
    let encrypted: Buffer;

    if (this.config.algorithm === 'aes-256-gcm') {
      iv = buffer.slice(0, 16);
      authTag = buffer.slice(16, 32);
      encrypted = buffer.slice(32);
    } else {
      iv = buffer.slice(0, 16);
      encrypted = buffer.slice(16);
    }

    const decipher = crypto.createDecipheriv(this.config.algorithm, this.masterKey, iv);
    
    if (this.config.algorithm === 'aes-256-gcm' && authTag) {
      (decipher as crypto.DecipherGCM).setAuthTag(authTag);
    }

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
  }

  /**
   * Encrypt an object containing sensitive fields
   */
  async encryptObject<T extends Record<string, any>>(
    obj: T,
    sensitiveFields: string[]
  ): Promise<T> {
    const encrypted = { ...obj };

    for (const field of sensitiveFields) {
      if (field in encrypted && typeof encrypted[field] === 'string') {
        encrypted[field] = await this.encrypt(encrypted[field]);
      }
    }

    return encrypted;
  }

  /**
   * Decrypt an object containing encrypted fields
   */
  async decryptObject<T extends Record<string, any>>(
    obj: T,
    encryptedFields: string[]
  ): Promise<T> {
    const decrypted = { ...obj };

    for (const field of encryptedFields) {
      if (field in decrypted && typeof decrypted[field] === 'string') {
        try {
          decrypted[field] = await this.decrypt(decrypted[field]);
        } catch (error) {
          // Field might not be encrypted, leave as is
          console.warn(`Failed to decrypt field ${field}:`, error);
        }
      }
    }

    return decrypted;
  }

  /**
   * Derive a key from a password
   */
  private async deriveKey(password: string, salt: Buffer): Promise<Buffer> {
    switch (this.config.keyDerivation) {
      case 'pbkdf2':
        return crypto.pbkdf2Sync(
          password,
          salt,
          this.config.iterations,
          32,
          'sha256'
        );
      
      case 'scrypt':
        return await scrypt(password, salt, 32) as Buffer;
      
      case 'argon2':
        // For argon2, you'd need to install and use the argon2 package
        throw new Error('Argon2 not implemented. Install argon2 package.');
      
      default:
        throw new Error(`Unsupported key derivation: ${this.config.keyDerivation}`);
    }
  }

  /**
   * Get or create a salt for key derivation
   */
  private getOrCreateSalt(): Buffer {
    // In production, this should be stored securely
    // For now, we'll use a deterministic salt based on machine ID
    const machineId = process.env.MACHINE_ID || 'default-machine-id';
    return crypto.createHash('sha256').update(machineId).digest();
  }

  /**
   * Generate a secure random key
   */
  static generateKey(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Hash a value (for non-reversible storage)
   */
  static hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }
}