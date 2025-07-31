/**
 * PossibleNOW API Types and Interfaces
 * Comprehensive type definitions for DNC compliance checking
 */

// OAuth 2.0 Types
export interface OAuth2Credentials {
  clientId: string;
  clientSecret: string;
  scope?: string;
}

export interface OAuth2Token {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  created_at: number;
}

// Customer Data Types
export interface CustomerRecord {
  id: string; // Unique identifier for tracking
  phoneNumber: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  zipCode?: string;
  metadata?: Record<string, any>; // For additional custom fields
}

export interface DNCScrubRequest {
  records: CustomerRecord[];
  options?: {
    includeFederalDNC?: boolean;
    includeStateDNC?: boolean;
    includeInternalDNC?: boolean;
    includeWirelessCheck?: boolean;
    includeTCPACompliance?: boolean;
  };
}

// API Response Types
export interface BatchSubmissionResponse {
  batchId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  recordCount: number;
  estimatedCompletionTime?: string;
  submittedAt: string;
}

export interface DNCCheckResult {
  recordId: string;
  phoneNumber: string;
  status: 'clean' | 'flagged' | 'error';
  flags: {
    federalDNC: boolean;
    stateDNC: boolean;
    internalDNC: boolean;
    wireless: boolean;
    tcpaViolation: boolean;
  };
  details?: {
    state?: string;
    listedDate?: string;
    wirelessCarrier?: string;
    tcpaDetails?: string;
  };
  errors?: string[];
}

export interface BatchResultsResponse {
  batchId: string;
  status: 'completed' | 'processing' | 'failed';
  results: DNCCheckResult[];
  summary: {
    totalRecords: number;
    cleanRecords: number;
    flaggedRecords: number;
    errorRecords: number;
  };
  completedAt?: string;
}

// Error Types
export interface APIError {
  code: string;
  message: string;
  details?: any;
  timestamp: string;
}

export class PossibleNOWAPIError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
    public details?: any
  ) {
    super(message);
    this.name = 'PossibleNOWAPIError';
  }
}

// Configuration Types
export interface PossibleNOWConfig {
  environment: 'sandbox' | 'production';
  baseUrl: string;
  authUrl: string;
  credentials: OAuth2Credentials;
  timeout?: number;
  maxRetries?: number;
  rateLimits?: {
    requestsPerSecond?: number;
    requestsPerMinute?: number;
    requestsPerHour?: number;
  };
}

// Rate Limiting Types
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
  retryAfter?: number;
}

// Webhook Types (for async results if supported)
export interface WebhookConfig {
  url: string;
  secret?: string;
  events?: string[];
}

export interface WebhookPayload {
  event: 'batch.completed' | 'batch.failed' | 'batch.partial';
  batchId: string;
  timestamp: string;
  data: BatchResultsResponse;
}