import { TwoFactorCode, CodeRequest, CodeResponse } from '../types';
import { Logger } from '../utils/Logger';
import { v4 as uuidv4 } from 'uuid';

export class CodeStore {
  private codes: Map<string, TwoFactorCode> = new Map();
  private logger: Logger;
  private expirationMinutes: number;

  constructor(expirationMinutes: number = 10) {
    this.logger = new Logger('CodeStore');
    this.expirationMinutes = expirationMinutes;
    
    // Clean up expired codes every minute
    setInterval(() => this.cleanupExpiredCodes(), 60000);
  }

  storeCode(
    code: string,
    platform: string,
    sender: string,
    subject: string,
    confidence: number,
    rawEmail: string
  ): string {
    const id = uuidv4();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.expirationMinutes * 60000);

    const twoFactorCode: TwoFactorCode = {
      id,
      code,
      platform,
      sender,
      subject,
      extractedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      used: false,
      confidence,
      rawEmail
    };

    this.codes.set(id, twoFactorCode);
    
    this.logger.info('Stored 2FA code', {
      id,
      platform,
      sender,
      confidence,
      expiresAt: expiresAt.toISOString()
    });

    return id;
  }

  getLatestCode(request: CodeRequest = {}): CodeResponse {
    const {
      platform,
      maxAge = 300, // 5 minutes default
      minConfidence = 0.5
    } = request;

    const now = new Date();
    const cutoffTime = new Date(now.getTime() - maxAge * 1000);

    // Find matching codes
    const matchingCodes = Array.from(this.codes.values())
      .filter(code => {
        // Check if expired
        if (new Date(code.expiresAt) < now) return false;
        
        // Check if too old
        if (new Date(code.extractedAt) < cutoffTime) return false;
        
        // Check if already used
        if (code.used) return false;
        
        // Check confidence
        if (code.confidence < minConfidence) return false;
        
        // Check platform if specified
        if (platform && code.platform !== platform) return false;
        
        return true;
      })
      .sort((a, b) => new Date(b.extractedAt).getTime() - new Date(a.extractedAt).getTime());

    if (matchingCodes.length === 0) {
      return {
        success: false,
        error: 'No matching codes found'
      };
    }

    const latestCode = matchingCodes[0];
    
    // Mark as used
    latestCode.used = true;
    
    this.logger.info('Retrieved 2FA code', {
      id: latestCode.id,
      platform: latestCode.platform,
      confidence: latestCode.confidence
    });

    return {
      success: true,
      code: latestCode.code,
      platform: latestCode.platform,
      extractedAt: latestCode.extractedAt,
      confidence: latestCode.confidence
    };
  }

  getAllCodes(): TwoFactorCode[] {
    return Array.from(this.codes.values())
      .sort((a, b) => new Date(b.extractedAt).getTime() - new Date(a.extractedAt).getTime());
  }

  getCodeById(id: string): TwoFactorCode | undefined {
    return this.codes.get(id);
  }

  markCodeAsUsed(id: string): boolean {
    const code = this.codes.get(id);
    if (code) {
      code.used = true;
      this.logger.info('Marked code as used', { id, platform: code.platform });
      return true;
    }
    return false;
  }

  private cleanupExpiredCodes(): void {
    const now = new Date();
    let cleanedCount = 0;

    for (const [id, code] of this.codes.entries()) {
      if (new Date(code.expiresAt) < now) {
        this.codes.delete(id);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.info('Cleaned up expired codes', { count: cleanedCount });
    }
  }

  getStats() {
    const now = new Date();
    const codes = Array.from(this.codes.values());
    
    return {
      total: codes.length,
      active: codes.filter(c => new Date(c.expiresAt) > now && !c.used).length,
      used: codes.filter(c => c.used).length,
      expired: codes.filter(c => new Date(c.expiresAt) <= now).length,
      platforms: [...new Set(codes.map(c => c.platform))],
      averageConfidence: codes.length > 0 
        ? codes.reduce((sum, c) => sum + c.confidence, 0) / codes.length 
        : 0
    };
  }
}

