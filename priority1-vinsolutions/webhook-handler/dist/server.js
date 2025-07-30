"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const dotenv_1 = __importDefault(require("dotenv"));
const CodeExtractor_1 = require("./services/CodeExtractor");
const CodeStore_1 = require("./services/CodeStore");
const WebhookVerifier_1 = require("./utils/WebhookVerifier");
const Logger_1 = require("./utils/Logger");
dotenv_1.default.config();
const app = (0, express_1.default)();
const logger = new Logger_1.Logger('WebhookServer');
const codeExtractor = new CodeExtractor_1.CodeExtractor(process.env.OPENROUTER_API_KEY, process.env.OPENROUTER_BASE_URL);
const codeStore = new CodeStore_1.CodeStore(parseInt(process.env.CODE_EXPIRATION_MINUTES || '10'));
const webhookVerifier = new WebhookVerifier_1.WebhookVerifier(process.env.MAILGUN_API_KEY);
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true
}));
app.use((0, morgan_1.default)('combined'));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        stats: codeStore.getStats()
    });
});
app.post('/webhook/2fa', async (req, res) => {
    try {
        const payload = req.body;
        logger.info('Received webhook', {
            recipient: payload.recipient,
            sender: payload.sender,
            subject: payload.subject
        });
        if (process.env.NODE_ENV === 'production') {
            const isValid = webhookVerifier.verifyWebhook(payload.token, payload.timestamp, payload.signature);
            if (!isValid) {
                logger.warn('Invalid webhook signature');
                return res.status(401).json({ error: 'Invalid signature' });
            }
        }
        const extractionResult = await codeExtractor.extractCode(payload.subject, payload['body-plain'] || payload['stripped-text'] || '', payload.sender);
        if (extractionResult.success && extractionResult.code) {
            const codeId = codeStore.storeCode(extractionResult.code, extractionResult.platform, payload.sender, payload.subject, extractionResult.confidence, JSON.stringify(payload));
            logger.info('Successfully extracted and stored 2FA code', {
                codeId,
                platform: extractionResult.platform,
                confidence: extractionResult.confidence,
                reasoning: extractionResult.reasoning
            });
            return res.json({
                success: true,
                codeId,
                platform: extractionResult.platform,
                confidence: extractionResult.confidence
            });
        }
        else {
            logger.warn('Failed to extract 2FA code', {
                reasoning: extractionResult.reasoning,
                error: extractionResult.error
            });
            return res.json({
                success: false,
                reasoning: extractionResult.reasoning,
                error: extractionResult.error
            });
        }
    }
    catch (error) {
        logger.error('Webhook processing failed', { error: error.message });
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});
app.get('/api/code/latest', (req, res) => {
    try {
        const request = {
            platform: req.query.platform,
            maxAge: req.query.maxAge ? parseInt(req.query.maxAge) : undefined,
            minConfidence: req.query.minConfidence ? parseFloat(req.query.minConfidence) : undefined
        };
        const result = codeStore.getLatestCode(request);
        if (result.success) {
            logger.info('Code retrieved by agent', {
                platform: result.platform,
                confidence: result.confidence
            });
        }
        res.json(result);
    }
    catch (error) {
        logger.error('Code retrieval failed', { error: error.message });
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});
app.get('/api/codes', (req, res) => {
    try {
        const codes = codeStore.getAllCodes();
        res.json({
            success: true,
            codes: codes.map(code => ({
                id: code.id,
                platform: code.platform,
                sender: code.sender,
                subject: code.subject,
                extractedAt: code.extractedAt,
                expiresAt: code.expiresAt,
                used: code.used,
                confidence: code.confidence
            })),
            stats: codeStore.getStats()
        });
    }
    catch (error) {
        logger.error('Codes listing failed', { error: error.message });
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});
app.post('/api/code/:id/use', (req, res) => {
    try {
        const { id } = req.params;
        const success = codeStore.markCodeAsUsed(id);
        if (success) {
            logger.info('Code marked as used', { id });
            res.json({ success: true });
        }
        else {
            res.status(404).json({
                success: false,
                error: 'Code not found'
            });
        }
    }
    catch (error) {
        logger.error('Code usage marking failed', { error: error.message });
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});
app.get('/api/stats', (req, res) => {
    try {
        const stats = codeStore.getStats();
        res.json({
            success: true,
            stats,
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        logger.error('Stats retrieval failed', { error: error.message });
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});
app.use((error, req, res, next) => {
    logger.error('Unhandled error', {
        error: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method
    });
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
});
app.use((req, res) => {
    res.status(404).json({
        error: 'Not found',
        message: `Route ${req.method} ${req.url} not found`
    });
});
const PORT = process.env.WEBHOOK_PORT || 3000;
app.listen(PORT, () => {
    logger.info(`Webhook server started on port ${PORT}`, {
        environment: process.env.NODE_ENV || 'development',
        endpoints: [
            'POST /webhook/2fa - Receive Mailgun webhooks',
            'GET /api/code/latest - Get latest 2FA code',
            'GET /api/codes - List all codes',
            'POST /api/code/:id/use - Mark code as used',
            'GET /api/stats - Get statistics',
            'GET /health - Health check'
        ]
    });
});
exports.default = app;
//# sourceMappingURL=server.js.map