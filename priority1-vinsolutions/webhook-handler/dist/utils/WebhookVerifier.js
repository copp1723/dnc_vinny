"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookVerifier = void 0;
const crypto_1 = __importDefault(require("crypto"));
const Logger_1 = require("./Logger");
class WebhookVerifier {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.logger = new Logger_1.Logger('WebhookVerifier');
    }
    verifySignature(token, timestamp, signature) {
        try {
            const value = timestamp + token;
            const hash = crypto_1.default
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
        }
        catch (error) {
            this.logger.error('Signature verification failed', {
                error: error.message
            });
            return false;
        }
    }
    isTimestampValid(timestamp, maxAgeSeconds = 300) {
        try {
            const webhookTime = parseInt(timestamp) * 1000;
            const now = Date.now();
            const age = (now - webhookTime) / 1000;
            const isValid = age <= maxAgeSeconds;
            if (!isValid) {
                this.logger.warn('Webhook timestamp too old', {
                    age,
                    maxAge: maxAgeSeconds,
                    timestamp
                });
            }
            return isValid;
        }
        catch (error) {
            this.logger.error('Timestamp validation failed', {
                error: error.message,
                timestamp
            });
            return false;
        }
    }
    verifyWebhook(token, timestamp, signature, maxAgeSeconds = 300) {
        return this.verifySignature(token, timestamp, signature) &&
            this.isTimestampValid(timestamp, maxAgeSeconds);
    }
}
exports.WebhookVerifier = WebhookVerifier;
//# sourceMappingURL=WebhookVerifier.js.map