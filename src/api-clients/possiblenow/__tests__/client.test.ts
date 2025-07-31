/**
 * Unit tests for PossibleNOW API Client
 */

import { PossibleNOWClient } from '../client';
import { createConfig } from '../config';
import { OAuth2Client } from '../auth';
import { RateLimiter } from '../rate-limiter';
import { CircuitBreaker } from '../../../../priority4-data-pipeline/circuit-breaker';
import axios from 'axios';
import {
  CustomerRecord,
  BatchSubmissionResponse,
  BatchResultsResponse,
  PossibleNOWAPIError
} from '../types';

// Mock dependencies
jest.mock('axios');
jest.mock('../auth');
jest.mock('../rate-limiter');
jest.mock('../../../../priority4-data-pipeline/circuit-breaker');
jest.mock('../../../../priority5-compliance/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('PossibleNOWClient', () => {
  let client: PossibleNOWClient;
  let mockAxios: jest.Mocked<typeof axios>;
  let mockAuth: jest.Mocked<OAuth2Client>;
  let mockRateLimiter: jest.Mocked<RateLimiter>;
  let mockCircuitBreaker: jest.Mocked<CircuitBreaker>;

  const testConfig = createConfig({
    environment: 'sandbox',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret'
  });

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup axios mock
    mockAxios = axios as jest.Mocked<typeof axios>;
    mockAxios.create.mockReturnValue({
      post: jest.fn(),
      get: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() }
      }
    } as any);

    // Setup auth mock
    mockAuth = new OAuth2Client(testConfig) as jest.Mocked<OAuth2Client>;
    mockAuth.authenticate = jest.fn().mockResolvedValue(undefined);
    mockAuth.getAccessToken = jest.fn().mockResolvedValue('test-token');

    // Setup rate limiter mock
    mockRateLimiter = new RateLimiter(testConfig) as jest.Mocked<RateLimiter>;
    mockRateLimiter.waitForCapacity = jest.fn().mockResolvedValue(undefined);
    mockRateLimiter.updateFromHeaders = jest.fn();

    // Setup circuit breaker mock
    mockCircuitBreaker = new CircuitBreaker('test', {}) as jest.Mocked<CircuitBreaker>;
    mockCircuitBreaker.execute = jest.fn().mockImplementation(async (operation) => {
      return await operation();
    });

    // Create client
    client = new PossibleNOWClient(testConfig);
  });

  describe('initialize', () => {
    it('should authenticate on initialization', async () => {
      await client.initialize();
      expect(mockAuth.authenticate).toHaveBeenCalledTimes(1);
    });

    it('should only initialize once', async () => {
      await client.initialize();
      await client.initialize();
      expect(mockAuth.authenticate).toHaveBeenCalledTimes(1);
    });
  });

  describe('submitDNCCheck', () => {
    const mockCustomers: CustomerRecord[] = [
      { id: '1', phoneNumber: '5551234567' },
      { id: '2', phoneNumber: '5559876543' }
    ];

    const mockResponse: BatchSubmissionResponse = {
      batchId: 'batch-123',
      status: 'queued',
      recordCount: 2,
      submittedAt: new Date().toISOString()
    };

    beforeEach(() => {
      const axiosInstance = mockAxios.create();
      (axiosInstance.post as jest.Mock).mockResolvedValue({ data: mockResponse });
    });

    it('should submit DNC check successfully', async () => {
      const result = await client.submitDNCCheck(mockCustomers);
      
      expect(result).toEqual(mockResponse);
      expect(mockRateLimiter.waitForCapacity).toHaveBeenCalled();
    });

    it('should throw error for empty customer list', async () => {
      await expect(client.submitDNCCheck([])).rejects.toThrow(
        'No customer records provided'
      );
    });

    it('should throw error for batch size exceeding 500', async () => {
      const largeCustomerList = Array(501).fill({ id: '1', phoneNumber: '5551234567' });
      
      await expect(client.submitDNCCheck(largeCustomerList)).rejects.toThrow(
        'Batch size exceeds maximum of 500 records'
      );
    });

    it('should handle API errors properly', async () => {
      const axiosInstance = mockAxios.create();
      (axiosInstance.post as jest.Mock).mockRejectedValue({
        response: {
          status: 400,
          data: { message: 'Invalid request' }
        }
      });

      await expect(client.submitDNCCheck(mockCustomers)).rejects.toThrow();
    });
  });

  describe('getDNCResults', () => {
    const mockResults: BatchResultsResponse = {
      batchId: 'batch-123',
      status: 'completed',
      results: [
        {
          recordId: '1',
          phoneNumber: '5551234567',
          status: 'clean',
          flags: {
            federalDNC: false,
            stateDNC: false,
            internalDNC: false,
            wireless: false,
            tcpaViolation: false
          }
        }
      ],
      summary: {
        totalRecords: 1,
        cleanRecords: 1,
        flaggedRecords: 0,
        errorRecords: 0
      },
      completedAt: new Date().toISOString()
    };

    beforeEach(() => {
      const axiosInstance = mockAxios.create();
      (axiosInstance.get as jest.Mock).mockResolvedValue({ data: mockResults });
    });

    it('should retrieve results successfully', async () => {
      const result = await client.getDNCResults('batch-123');
      
      expect(result).toEqual(mockResults);
      expect(mockRateLimiter.waitForCapacity).toHaveBeenCalled();
    });

    it('should throw error for missing batch ID', async () => {
      await expect(client.getDNCResults('')).rejects.toThrow(
        'Batch ID is required'
      );
    });
  });

  describe('submitDNCCheckMultipleBatches', () => {
    it('should split large lists into multiple batches', async () => {
      const largeCustomerList = Array(1200).fill(null).map((_, i) => ({
        id: `${i}`,
        phoneNumber: `555${i.toString().padStart(7, '0')}`
      }));

      const mockResponses = [
        { batchId: 'batch-1', status: 'queued', recordCount: 500, submittedAt: new Date().toISOString() },
        { batchId: 'batch-2', status: 'queued', recordCount: 500, submittedAt: new Date().toISOString() },
        { batchId: 'batch-3', status: 'queued', recordCount: 200, submittedAt: new Date().toISOString() }
      ];

      const axiosInstance = mockAxios.create();
      (axiosInstance.post as jest.Mock)
        .mockResolvedValueOnce({ data: mockResponses[0] })
        .mockResolvedValueOnce({ data: mockResponses[1] })
        .mockResolvedValueOnce({ data: mockResponses[2] });

      const results = await client.submitDNCCheckMultipleBatches(largeCustomerList);
      
      expect(results).toHaveLength(3);
      expect(results[0].recordCount).toBe(500);
      expect(results[1].recordCount).toBe(500);
      expect(results[2].recordCount).toBe(200);
    });
  });

  describe('waitForBatchCompletion', () => {
    it('should poll until batch is completed', async () => {
      const axiosInstance = mockAxios.create();
      
      const processingResponse: BatchResultsResponse = {
        batchId: 'batch-123',
        status: 'processing',
        results: [],
        summary: {
          totalRecords: 0,
          cleanRecords: 0,
          flaggedRecords: 0,
          errorRecords: 0
        }
      };

      const completedResponse: BatchResultsResponse = {
        batchId: 'batch-123',
        status: 'completed',
        results: [],
        summary: {
          totalRecords: 2,
          cleanRecords: 2,
          flaggedRecords: 0,
          errorRecords: 0
        },
        completedAt: new Date().toISOString()
      };

      (axiosInstance.get as jest.Mock)
        .mockResolvedValueOnce({ data: processingResponse })
        .mockResolvedValueOnce({ data: completedResponse });

      const result = await client.waitForBatchCompletion('batch-123', {
        pollingInterval: 100
      });

      expect(result.status).toBe('completed');
      expect(axiosInstance.get).toHaveBeenCalledTimes(2);
    });

    it('should throw error on batch failure', async () => {
      const axiosInstance = mockAxios.create();
      
      const failedResponse: BatchResultsResponse = {
        batchId: 'batch-123',
        status: 'failed',
        results: [],
        summary: {
          totalRecords: 0,
          cleanRecords: 0,
          flaggedRecords: 0,
          errorRecords: 0
        }
      };

      (axiosInstance.get as jest.Mock).mockResolvedValue({ data: failedResponse });

      await expect(
        client.waitForBatchCompletion('batch-123')
      ).rejects.toThrow('Batch processing failed');
    });

    it('should timeout after max wait time', async () => {
      const axiosInstance = mockAxios.create();
      
      const processingResponse: BatchResultsResponse = {
        batchId: 'batch-123',
        status: 'processing',
        results: [],
        summary: {
          totalRecords: 0,
          cleanRecords: 0,
          flaggedRecords: 0,
          errorRecords: 0
        }
      };

      (axiosInstance.get as jest.Mock).mockResolvedValue({ data: processingResponse });

      await expect(
        client.waitForBatchCompletion('batch-123', {
          pollingInterval: 100,
          maxWaitTime: 500
        })
      ).rejects.toThrow('Batch processing timeout');
    });
  });

  describe('static utility methods', () => {
    describe('filterCleanRecords', () => {
      it('should filter out flagged records', () => {
        const results = [
          {
            recordId: '1',
            phoneNumber: '5551234567',
            status: 'clean' as const,
            flags: {
              federalDNC: false,
              stateDNC: false,
              internalDNC: false,
              wireless: false,
              tcpaViolation: false
            }
          },
          {
            recordId: '2',
            phoneNumber: '5559876543',
            status: 'flagged' as const,
            flags: {
              federalDNC: true,
              stateDNC: false,
              internalDNC: false,
              wireless: false,
              tcpaViolation: false
            }
          }
        ];

        const clean = PossibleNOWClient.filterCleanRecords(results);
        
        expect(clean).toHaveLength(1);
        expect(clean[0].id).toBe('1');
      });
    });

    describe('generateComplianceReport', () => {
      it('should generate comprehensive compliance report', () => {
        const batchResults: BatchResultsResponse = {
          batchId: 'batch-123',
          status: 'completed',
          results: [
            {
              recordId: '1',
              phoneNumber: '5551234567',
              status: 'clean',
              flags: {
                federalDNC: false,
                stateDNC: false,
                internalDNC: false,
                wireless: false,
                tcpaViolation: false
              }
            },
            {
              recordId: '2',
              phoneNumber: '5559876543',
              status: 'flagged',
              flags: {
                federalDNC: true,
                stateDNC: false,
                internalDNC: false,
                wireless: true,
                tcpaViolation: true
              }
            }
          ],
          summary: {
            totalRecords: 2,
            cleanRecords: 1,
            flaggedRecords: 1,
            errorRecords: 0
          },
          completedAt: new Date().toISOString()
        };

        const report = PossibleNOWClient.generateComplianceReport(batchResults);
        
        expect(report.summary.totalProcessed).toBe(2);
        expect(report.summary.compliant).toBe(1);
        expect(report.summary.nonCompliant).toBe(1);
        expect(report.summary.complianceRate).toBe(50);
        
        expect(report.violations.federalDNC).toBe(1);
        expect(report.violations.wireless).toBe(1);
        expect(report.violations.tcpa).toBe(1);
        
        expect(report.recommendations).toContain('Remove federal DNC registered numbers from campaign');
        expect(report.recommendations).toContain('Ensure proper consent for wireless numbers (TCPA compliance)');
      });
    });
  });
});