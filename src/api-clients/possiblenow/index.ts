/**
 * PossibleNOW API Client
 * 
 * A comprehensive client for DNC compliance checking via PossibleNOW API
 * 
 * Features:
 * - OAuth 2.0 authentication with automatic token refresh
 * - Rate limiting with token bucket algorithm
 * - Circuit breaker pattern for fault tolerance
 * - Batch processing (up to 500 records per batch)
 * - Automatic retry with exponential backoff
 * - Comprehensive error handling
 * - TypeScript support with full type definitions
 * 
 * Usage:
 * ```typescript
 * import { PossibleNOWClient, createConfig } from './possiblenow';
 * 
 * const config = createConfig({
 *   environment: 'production',
 *   clientId: 'your-client-id',
 *   clientSecret: 'your-client-secret'
 * });
 * 
 * const client = new PossibleNOWClient(config);
 * await client.initialize();
 * 
 * const response = await client.submitDNCCheck([
 *   { id: '1', phoneNumber: '5551234567' },
 *   { id: '2', phoneNumber: '5559876543' }
 * ]);
 * 
 * const results = await client.waitForBatchCompletion(response.batchId);
 * const report = PossibleNOWClient.generateComplianceReport(results);
 * ```
 */

// Main exports
export { PossibleNOWClient } from './client';
export { createConfig, createConfigFromEnv, validateConfig } from './config';

// Type exports
export type {
  // OAuth Types
  OAuth2Credentials,
  OAuth2Token,
  
  // Customer Data Types
  CustomerRecord,
  DNCScrubRequest,
  
  // Response Types
  BatchSubmissionResponse,
  DNCCheckResult,
  BatchResultsResponse,
  
  // Configuration Types
  PossibleNOWConfig,
  
  // Rate Limiting Types
  RateLimitInfo,
  
  // Webhook Types
  WebhookConfig,
  WebhookPayload,
  
  // Error Types
  APIError
} from './types';

export { PossibleNOWAPIError } from './types';

// Re-export useful utilities
export { CircuitState } from '../../../priority4-data-pipeline/circuit-breaker';