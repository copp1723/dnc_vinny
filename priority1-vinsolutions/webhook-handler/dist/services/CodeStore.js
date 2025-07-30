"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodeStore = void 0;
const Logger_1 = require("../utils/Logger");
const uuid_1 = require("uuid");
class CodeStore {
    constructor(expirationMinutes = 10) {
        this.codes = new Map();
        this.logger = new Logger_1.Logger('CodeStore');
        this.expirationMinutes = expirationMinutes;
        setInterval(() => this.cleanupExpiredCodes(), 60000);
    }
    storeCode(code, platform, sender, subject, confidence, rawEmail) {
        const id = (0, uuid_1.v4)();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + this.expirationMinutes * 60000);
        const twoFactorCode = {
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
    getLatestCode(request = {}) {
        const { platform, maxAge = 300, minConfidence = 0.5 } = request;
        const now = new Date();
        const cutoffTime = new Date(now.getTime() - maxAge * 1000);
        const matchingCodes = Array.from(this.codes.values())
            .filter(code => {
            if (new Date(code.expiresAt) < now)
                return false;
            if (new Date(code.extractedAt) < cutoffTime)
                return false;
            if (code.used)
                return false;
            if (code.confidence < minConfidence)
                return false;
            if (platform && code.platform !== platform)
                return false;
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
    getAllCodes() {
        return Array.from(this.codes.values())
            .sort((a, b) => new Date(b.extractedAt).getTime() - new Date(a.extractedAt).getTime());
    }
    getCodeById(id) {
        return this.codes.get(id);
    }
    markCodeAsUsed(id) {
        const code = this.codes.get(id);
        if (code) {
            code.used = true;
            this.logger.info('Marked code as used', { id, platform: code.platform });
            return true;
        }
        return false;
    }
    cleanupExpiredCodes() {
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
exports.CodeStore = CodeStore;
//# sourceMappingURL=CodeStore.js.map