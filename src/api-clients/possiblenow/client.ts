/**
 * PossibleNOW API Client
 * Main client for DNC compliance checking with PossibleNOW API
 */

import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios';
import { CircuitBreaker } from '../../../priority4-data-pipeline/circuit-breaker';
import { logger } from '../../../priority5-compliance/logger';
import { OAuth2Client } from './auth';
import { RateLimiter } from './rate-limiter';
import {
  PossibleNOWConfig,
  CustomerRecord,
  DNCScrubRequest,
  BatchSubmissionResponse,
  BatchResultsResponse,
  PossibleNOWAPIError,
  DNCCheckResult
} from './types';
import { validateConfig } from './config';

export class PossibleNOWClient {
  private axios: AxiosInstance;
  private auth: OAuth2Client;
  private rateLimiter: RateLimiter;
  private circuitBreaker: CircuitBreaker;
  private isInitialized = false;

  constructor(private config: PossibleNOWConfig) {
    // Validate configuration
    validateConfig(config);

    // Initialize components
    this.auth = new OAuth2Client(config);
    this.rateLimiter = new RateLimiter(config);
    
    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker('possiblenow', {
      failureThreshold: 5,
      resetTimeout: 60000, // 1 minute
      monitoringPeriod: 60000,
      fallbackFunction: async () => {
        logger.error('PossibleNOW circuit breaker open - service unavailable');
        throw new PossibleNOWAPIError(
          'DNC service temporarily unavailable',
          'SERVICE_UNAVAILABLE',
          503
        );
      }
    });

    // Initialize axios instance
    this.axios = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PossibleNOW-DNC-Client/1.0'
      }
    });

    // Add request interceptor for authentication
    this.axios.interceptors.request.use(
      async (config) => {
        const token = await this.auth.getAccessToken();
        config.headers.Authorization = `Bearer ${token}`;
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Add response interceptor for rate limit updates
    this.axios.interceptors.response.use(
      (response) => {
        // Update rate limiter from response headers
        if (response.headers) {
          this.rateLimiter.updateFromHeaders(response.headers);
        }
        return response;
      },
      (error) => {
        if (error.response?.headers) {
          this.rateLimiter.updateFromHeaders(error.response.headers);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Initializes the client by authenticating
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    logger.info('Initializing PossibleNOW client', {
      environment: this.config.environment
    });

    await this.auth.authenticate();
    this.isInitialized = true;

    logger.info('PossibleNOW client initialized successfully');
  }

  /**
   * Submits a batch of customer records for DNC checking
   * @param customers Array of customer records (max 500)
   */
  async submitDNCCheck(customers: CustomerRecord[]): Promise<BatchSubmissionResponse> {
    await this.ensureInitialized();

    // Validate batch size
    if (customers.length === 0) {
      throw new PossibleNOWAPIError(
        'No customer records provided',
        'INVALID_REQUEST',
        400
      );
    }

    if (customers.length > 500) {
      throw new PossibleNOWAPIError(
        'Batch size exceeds maximum of 500 records',
        'BATCH_SIZE_EXCEEDED',
        400
      );
    }

    logger.info('Submitting DNC check batch', {
      recordCount: customers.length
    });

    const request: DNCScrubRequest = {
      records: customers,
      options: {
        includeFederalDNC: true,
        includeStateDNC: true,
        includeInternalDNC: true,
        includeWirelessCheck: true,
        includeTCPACompliance: true
      }
    };

    return await this.executeWithRetry(
      async () => {
        await this.rateLimiter.waitForCapacity();

        const response = await this.axios.post<BatchSubmissionResponse>(
          '/dnc/batch',
          request
        );

        logger.info('DNC batch submitted successfully', {
          batchId: response.data.batchId,
          status: response.data.status
        });

        return response.data;
      },
      'submitDNCCheck'
    );
  }

  /**
   * Retrieves results for a submitted batch
   */
  async getDNCResults(batchId: string): Promise<BatchResultsResponse> {
    await this.ensureInitialized();

    if (!batchId) {
      throw new PossibleNOWAPIError(
        'Batch ID is required',
        'INVALID_REQUEST',
        400
      );
    }

    logger.debug('Retrieving DNC results', { batchId });

    return await this.executeWithRetry(
      async () => {
        await this.rateLimiter.waitForCapacity();

        const response = await this.axios.get<BatchResultsResponse>(
          `/dnc/batch/${batchId}/results`
        );

        logger.info('DNC results retrieved', {
          batchId,
          status: response.data.status,
          totalRecords: response.data.summary.totalRecords
        });

        return response.data;
      },
      'getDNCResults'
    );
  }

  /**
   * Submits multiple batches of customer records
   * Automatically splits large lists into 500-record batches
   */
  async submitDNCCheckMultipleBatches(
    customers: CustomerRecord[]
  ): Promise<BatchSubmissionResponse[]> {
    const batches: CustomerRecord[][] = [];
    
    // Split into 500-record batches
    for (let i = 0; i < customers.length; i += 500) {
      batches.push(customers.slice(i, i + 500));
    }

    logger.info('Submitting multiple DNC check batches', {
      totalRecords: customers.length,
      batchCount: batches.length
    });

    const submissions: BatchSubmissionResponse[] = [];

    // Submit batches with controlled concurrency
    const concurrency = 3; // Process 3 batches at a time
    for (let i = 0; i < batches.length; i += concurrency) {
      const batchPromises = batches
        .slice(i, i + concurrency)
        .map(batch => this.submitDNCCheck(batch));

      const results = await Promise.all(batchPromises);
      submissions.push(...results);

      // Add small delay between batch groups
      if (i + concurrency < batches.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return submissions;
  }

  /**
   * Polls for batch results until completion
   */
  async waitForBatchCompletion(
    batchId: string,
    options: {
      pollingInterval?: number;
      maxWaitTime?: number;
    } = {}
  ): Promise<BatchResultsResponse> {
    const pollingInterval = options.pollingInterval || 5000; // 5 seconds
    const maxWaitTime = options.maxWaitTime || 300000; // 5 minutes
    const startTime = Date.now();

    logger.info('Waiting for batch completion', { batchId });

    while (Date.now() - startTime < maxWaitTime) {
      const results = await this.getDNCResults(batchId);

      if (results.status === 'completed') {
        return results;
      }

      if (results.status === 'failed') {
        throw new PossibleNOWAPIError(
          `Batch processing failed: ${batchId}`,
          'BATCH_PROCESSING_FAILED',
          500,
          results
        );
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollingInterval));
    }

    throw new PossibleNOWAPIError(
      `Batch processing timeout: ${batchId}`,
      'BATCH_PROCESSING_TIMEOUT',
      504
    );
  }

  /**
   * Gets current rate limit information
   */
  getRateLimitInfo() {
    return this.rateLimiter.getRateLimitInfo();
  }

  /**
   * Gets circuit breaker statistics
   */
  getCircuitBreakerStats() {
    return this.circuitBreaker.getStats();
  }

  /**
   * Executes an operation with retry logic and circuit breaker
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    return await this.circuitBreaker.execute(async () => {
      let lastError: Error | null = null;
      
      for (let attempt = 1; attempt <= this.config.maxRetries!; attempt++) {
        try {
          return await operation();
        } catch (error) {
          lastError = this.handleAPIError(error, operationName);
          
          // Don't retry on client errors (4xx)
          if (lastError instanceof PossibleNOWAPIError && 
              lastError.statusCode && 
              lastError.statusCode >= 400 && 
              lastError.statusCode < 500) {
            throw lastError;
          }

          // Log retry attempt
          logger.warn('Retrying operation', {
            operation: operationName,
            attempt,
            maxAttempts: this.config.maxRetries,
            error: lastError.message
          });

          // Exponential backoff
          if (attempt < this.config.maxRetries!) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      throw lastError || new Error('Unknown error');
    });
  }

  /**
   * Handles API errors and converts to PossibleNOWAPIError
   */
  private handleAPIError(error: any, operation: string): Error {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      
      logger.error('PossibleNOW API error', {
        operation,
        status: axiosError.response?.status,
        message: axiosError.message,
        data: axiosError.response?.data
      });

      // Handle specific error codes
      if (axiosError.response?.status === 429) {
        return new PossibleNOWAPIError(
          'Rate limit exceeded',
          'RATE_LIMIT_EXCEEDED',
          429,
          axiosError.response.data
        );
      }

      if (axiosError.response?.status === 401) {
        // Clear token and try to re-authenticate on next request
        this.auth.clearToken();
        this.isInitialized = false;
        
        return new PossibleNOWAPIError(
          'Authentication failed',
          'AUTH_FAILED',
          401,
          axiosError.response.data
        );
      }

      return new PossibleNOWAPIError(
        axiosError.response?.data?.message || axiosError.message,
        axiosError.response?.data?.code || 'API_ERROR',
        axiosError.response?.status,
        axiosError.response?.data
      );
    }

    logger.error('Unexpected error in PossibleNOW API', {
      operation,
      error
    });

    return error instanceof Error ? error : new Error(String(error));
  }

  /**
   * Ensures the client is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  /**
   * Processes results and filters out flagged records
   */
  static filterCleanRecords(results: DNCCheckResult[]): CustomerRecord[] {
    return results
      .filter(result => result.status === 'clean')
      .map(result => ({
        id: result.recordId,
        phoneNumber: result.phoneNumber
      }));
  }

  /**
   * Gets detailed compliance report from results
   */
  static generateComplianceReport(results: BatchResultsResponse): {
    summary: {
      totalProcessed: number;
      compliant: number;
      nonCompliant: number;
      errors: number;
      complianceRate: number;
    };
    violations: {
      federalDNC: number;
      stateDNC: number;
      wireless: number;
      tcpa: number;
    };
    recommendations: string[];
  } {
    const violations = {
      federalDNC: 0,
      stateDNC: 0,
      wireless: 0,
      tcpa: 0
    };

    results.results.forEach(result => {
      if (result.flags.federalDNC) violations.federalDNC++;
      if (result.flags.stateDNC) violations.stateDNC++;
      if (result.flags.wireless) violations.wireless++;
      if (result.flags.tcpaViolation) violations.tcpa++;
    });

    const recommendations: string[] = [];
    
    if (violations.federalDNC > 0) {
      recommendations.push('Remove federal DNC registered numbers from campaign');
    }
    if (violations.stateDNC > 0) {
      recommendations.push('Review state-specific DNC compliance requirements');
    }
    if (violations.wireless > 0) {
      recommendations.push('Ensure proper consent for wireless numbers (TCPA compliance)');
    }
    if (violations.tcpa > 0) {
      recommendations.push('Review TCPA compliance procedures and obtain necessary consents');
    }

    const complianceRate = results.summary.totalRecords > 0
      ? (results.summary.cleanRecords / results.summary.totalRecords) * 100
      : 0;

    return {
      summary: {
        totalProcessed: results.summary.totalRecords,
        compliant: results.summary.cleanRecords,
        nonCompliant: results.summary.flaggedRecords,
        errors: results.summary.errorRecords,
        complianceRate
      },
      violations,
      recommendations
    };
  }
}