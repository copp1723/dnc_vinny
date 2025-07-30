import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { CodeExtractor } from './services/CodeExtractor';
import { CodeStore } from './services/CodeStore';
import { WebhookVerifier } from './utils/WebhookVerifier';
import { Logger } from './utils/Logger';
import { MailgunWebhookPayload, CodeRequest } from './types';

// Load environment variables
dotenv.config();

const app = express();
const logger = new Logger('WebhookServer');

// Initialize services
const codeExtractor = new CodeExtractor(
  process.env.OPENROUTER_API_KEY!,
  process.env.OPENROUTER_BASE_URL
);
const codeStore = new CodeStore(
  parseInt(process.env.CODE_EXPIRATION_MINUTES || '10')
);
const webhookVerifier = new WebhookVerifier(process.env.MAILGUN_API_KEY!);

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    stats: codeStore.getStats()
  });
});

// Test endpoint for webhook (GET)
app.get('/webhook/2fa', (req, res) => {
  res.json({
    message: 'Webhook endpoint is active',
    method: 'This endpoint accepts POST requests from Mailgun',
    timestamp: new Date().toISOString(),
    server: 'running'
  });
});

// Mailgun webhook endpoint
app.post('/webhook/2fa', async (req, res) => {
  try {
    const payload: MailgunWebhookPayload = req.body;
    
    logger.info('Received webhook', {
      recipient: payload.recipient,
      sender: payload.sender,
      subject: payload.subject
    });

    // Verify webhook signature (optional in development)
    if (process.env.NODE_ENV === 'production') {
      const isValid = webhookVerifier.verifyWebhook(
        payload.token,
        payload.timestamp,
        payload.signature
      );
      
      if (!isValid) {
        logger.warn('Invalid webhook signature');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    // Extract 2FA code from email
    const extractionResult = await codeExtractor.extractCode(
      payload.subject,
      payload['body-plain'] || payload['stripped-text'] || '',
      payload.sender
    );

    if (extractionResult.success && extractionResult.code) {
      // Store the code
      const codeId = codeStore.storeCode(
        extractionResult.code,
        extractionResult.platform,
        payload.sender,
        payload.subject,
        extractionResult.confidence,
        JSON.stringify(payload)
      );

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
    } else {
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

  } catch (error: any) {
    logger.error('Webhook processing failed', { error: error.message });
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Get latest 2FA code endpoint (for AI agents)
app.get('/api/code/latest', (req, res) => {
  try {
    const request: CodeRequest = {
      platform: req.query.platform as string,
      maxAge: req.query.maxAge ? parseInt(req.query.maxAge as string) : undefined,
      minConfidence: req.query.minConfidence ? parseFloat(req.query.minConfidence as string) : undefined
    };

    const result = codeStore.getLatestCode(request);
    
    if (result.success) {
      logger.info('Code retrieved by agent', {
        platform: result.platform,
        confidence: result.confidence
      });
    }

    res.json(result);
  } catch (error: any) {
    logger.error('Code retrieval failed', { error: error.message });
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Get all codes endpoint (for debugging)
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
        // Note: Not returning the actual code for security
      })),
      stats: codeStore.getStats()
    });
  } catch (error: any) {
    logger.error('Codes listing failed', { error: error.message });
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Mark code as used endpoint
app.post('/api/code/:id/use', (req, res) => {
  try {
    const { id } = req.params;
    const success = codeStore.markCodeAsUsed(id);
    
    if (success) {
      logger.info('Code marked as used', { id });
      res.json({ success: true });
    } else {
      res.status(404).json({ 
        success: false, 
        error: 'Code not found' 
      });
    }
  } catch (error: any) {
    logger.error('Code usage marking failed', { error: error.message });
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Statistics endpoint
app.get('/api/stats', (req, res) => {
  try {
    const stats = codeStore.getStats();
    res.json({
      success: true,
      stats,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    logger.error('Stats retrieval failed', { error: error.message });
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Error handling middleware
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
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

// 404 handler
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

export default app;

