import { TwoFactorCode, CodeRequest, CodeResponse } from '../types';
export declare class CodeStore {
    private codes;
    private logger;
    private expirationMinutes;
    constructor(expirationMinutes?: number);
    storeCode(code: string, platform: string, sender: string, subject: string, confidence: number, rawEmail: string): string;
    getLatestCode(request?: CodeRequest): CodeResponse;
    getAllCodes(): TwoFactorCode[];
    getCodeById(id: string): TwoFactorCode | undefined;
    markCodeAsUsed(id: string): boolean;
    private cleanupExpiredCodes;
    getStats(): {
        total: number;
        active: number;
        used: number;
        expired: number;
        platforms: string[];
        averageConfidence: number;
    };
}
//# sourceMappingURL=CodeStore.d.ts.map