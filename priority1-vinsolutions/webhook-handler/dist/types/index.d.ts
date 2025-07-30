export interface MailgunWebhookPayload {
    timestamp: string;
    token: string;
    signature: string;
    recipient: string;
    sender: string;
    subject: string;
    'body-plain': string;
    'body-html': string;
    'stripped-text': string;
    'message-headers': string;
    'message-url'?: string;
    'attachment-count'?: string;
}
export interface TwoFactorCode {
    id: string;
    code: string;
    platform: string;
    sender: string;
    subject: string;
    extractedAt: string;
    expiresAt: string;
    used: boolean;
    confidence: number;
    rawEmail: string;
}
export interface CodeExtractionResult {
    success: boolean;
    code?: string;
    confidence: number;
    platform: string;
    reasoning: string;
    error?: string;
}
export interface WebhookConfig {
    port: number;
    mailgunApiKey: string;
    openrouterApiKey: string;
    allowedOrigins: string[];
    codeExpirationMinutes: number;
}
export interface CodeRequest {
    platform?: string;
    maxAge?: number;
    minConfidence?: number;
}
export interface CodeResponse {
    success: boolean;
    code?: string;
    platform?: string;
    extractedAt?: string;
    confidence?: number;
    error?: string;
}
//# sourceMappingURL=index.d.ts.map