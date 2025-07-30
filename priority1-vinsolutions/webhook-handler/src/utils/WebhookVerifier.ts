import crypto from 'crypto';
import { Logger } from './Logger';

export class WebhookVerifier {
  private logger: Logger;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.logger = new Logger('WebhookVerifier');
  }

  verifySignature(token: string, timestamp: string, signature: string): boolean {
    try {
      const value = timestamp + token;
      const hash = crypto
        .createHmac('sha256', this.apiKey)
        .update(value)
        .digest('hex');

      const isValid = hash === signature;
      
      if (!isValid) {
        this.logger.warn('Invalid webhook signature', {
          expectedHash: hash,
          receivedSignature: signature,
          timestamp,
          token: token.substring(0, 8) + '...'
        });
      }

      return isValid;
    } catch (error: any) {
      this.logger.error('Signature verification failed', { 
        error: error.message 
      });
      return false;
    }
  }

  isTimestampValid(timestamp: string, maxAgeSeconds: number = 300): boolean {
    try {
      const webhookTime = parseInt(timestamp) * 1000; // Convert to milliseconds
      const now = Date.now();
      const age = (now - webhookTime) / 1000; // Age in seconds

      const isValid = age <= maxAgeSeconds;
      
      if (!isValid) {
        this.logger.warn('Webhook timestamp too old', {
          age,
          maxAge: maxAgeSeconds,
          timestamp
        });
      }

      return isValid;
    } catch (error: any) {
      this.logger.error('Timestamp validation failed', { 
        error: error.message,
        timestamp 
      });
      return false;
    }
  }

  verifyWebhook(
    token: string, 
    timestamp: string, 
    signature: string,
    maxAgeSeconds: number = 300
  ): boolean {
    return this.verifySignature(token, timestamp, signature) && 
           this.isTimestampValid(timestamp, maxAgeSeconds);
  }
}

