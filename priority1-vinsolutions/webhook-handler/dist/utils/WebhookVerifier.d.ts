export declare class WebhookVerifier {
    private logger;
    private apiKey;
    constructor(apiKey: string);
    verifySignature(token: string, timestamp: string, signature: string): boolean;
    isTimestampValid(timestamp: string, maxAgeSeconds?: number): boolean;
    verifyWebhook(token: string, timestamp: string, signature: string, maxAgeSeconds?: number): boolean;
}
//# sourceMappingURL=WebhookVerifier.d.ts.map