# PossibleNOW API Client

A comprehensive TypeScript client for DNC (Do Not Call) compliance checking via the PossibleNOW API.

## Features

- **OAuth 2.0 Authentication**: Automatic token management with refresh support
- **Rate Limiting**: Token bucket algorithm with multiple time windows
- **Circuit Breaker**: Fault tolerance with automatic recovery
- **Batch Processing**: Submit up to 500 records per batch
- **Automatic Retry**: Exponential backoff for transient failures
- **Type Safety**: Full TypeScript support with comprehensive type definitions
- **Production Ready**: Comprehensive error handling, logging, and monitoring

## Installation

```bash
npm install axios winston
```

## Configuration

### Environment Variables

```bash
# Required
POSSIBLENOW_CLIENT_ID=your-client-id
POSSIBLENOW_CLIENT_SECRET=your-client-secret

# Optional
POSSIBLENOW_ENV=production         # or 'sandbox' (default)
POSSIBLENOW_SCOPE=dnc:read dnc:write
POSSIBLENOW_TIMEOUT=30000          # milliseconds
POSSIBLENOW_MAX_RETRIES=3
POSSIBLENOW_RPS=10                 # requests per second
POSSIBLENOW_RPM=100                # requests per minute
POSSIBLENOW_RPH=5000               # requests per hour
```

### Programmatic Configuration

```typescript
import { PossibleNOWClient, createConfig } from './possiblenow';

const config = createConfig({
  environment: 'production',
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
  timeout: 30000,
  maxRetries: 3,
  rateLimits: {
    requestsPerSecond: 10,
    requestsPerMinute: 100,
    requestsPerHour: 5000
  }
});

const client = new PossibleNOWClient(config);
```

## Usage

### Basic DNC Check

```typescript
import { PossibleNOWClient, createConfigFromEnv } from './possiblenow';

async function checkDNC() {
  // Create client with environment configuration
  const client = new PossibleNOWClient(createConfigFromEnv());
  
  // Initialize (authenticates)
  await client.initialize();
  
  // Submit records for DNC check
  const submission = await client.submitDNCCheck([
    { id: '1', phoneNumber: '5551234567', firstName: 'John', lastName: 'Doe' },
    { id: '2', phoneNumber: '5559876543', firstName: 'Jane', lastName: 'Smith' }
  ]);
  
  console.log(`Batch submitted: ${submission.batchId}`);
  
  // Wait for results
  const results = await client.waitForBatchCompletion(submission.batchId);
  
  // Generate compliance report
  const report = PossibleNOWClient.generateComplianceReport(results);
  console.log(`Compliance rate: ${report.summary.complianceRate}%`);
  
  // Get only clean records
  const cleanRecords = PossibleNOWClient.filterCleanRecords(results.results);
  console.log(`Clean records: ${cleanRecords.length}`);
}
```

### Large Batch Processing

```typescript
async function processLargeBatch(customers: CustomerRecord[]) {
  const client = new PossibleNOWClient(createConfigFromEnv());
  await client.initialize();
  
  // Automatically splits into 500-record batches
  const submissions = await client.submitDNCCheckMultipleBatches(customers);
  
  console.log(`Submitted ${submissions.length} batches`);
  
  // Wait for all batches to complete
  const allResults = await Promise.all(
    submissions.map(sub => 
      client.waitForBatchCompletion(sub.batchId)
    )
  );
  
  // Combine results
  const combinedResults = allResults.flatMap(r => r.results);
  const cleanNumbers = PossibleNOWClient.filterCleanRecords(combinedResults);
  
  return cleanNumbers;
}
```

### Error Handling

```typescript
import { PossibleNOWAPIError } from './possiblenow';

try {
  const results = await client.submitDNCCheck(customers);
} catch (error) {
  if (error instanceof PossibleNOWAPIError) {
    switch (error.code) {
      case 'RATE_LIMIT_EXCEEDED':
        console.error('Rate limit hit, retry later');
        break;
      case 'AUTH_FAILED':
        console.error('Authentication failed, check credentials');
        break;
      case 'SERVICE_UNAVAILABLE':
        console.error('Service is down, circuit breaker activated');
        break;
      default:
        console.error(`API Error: ${error.message}`);
    }
  } else {
    console.error('Unexpected error:', error);
  }
}
```

### Monitoring

```typescript
// Get rate limit status
const rateLimitInfo = client.getRateLimitInfo();
console.log(`Remaining requests: ${rateLimitInfo.remaining}/${rateLimitInfo.limit}`);

// Get circuit breaker status
const circuitStats = client.getCircuitBreakerStats();
console.log(`Circuit state: ${circuitStats.state}`);
console.log(`Failure count: ${circuitStats.failureCount}`);
```

## API Reference

### PossibleNOWClient

#### Constructor
```typescript
constructor(config: PossibleNOWConfig)
```

#### Methods

##### initialize()
```typescript
async initialize(): Promise<void>
```
Authenticates with the API. Must be called before making any requests.

##### submitDNCCheck()
```typescript
async submitDNCCheck(customers: CustomerRecord[]): Promise<BatchSubmissionResponse>
```
Submits up to 500 customer records for DNC checking.

##### getDNCResults()
```typescript
async getDNCResults(batchId: string): Promise<BatchResultsResponse>
```
Retrieves results for a previously submitted batch.

##### submitDNCCheckMultipleBatches()
```typescript
async submitDNCCheckMultipleBatches(customers: CustomerRecord[]): Promise<BatchSubmissionResponse[]>
```
Automatically splits large lists into multiple batches and submits them.

##### waitForBatchCompletion()
```typescript
async waitForBatchCompletion(
  batchId: string,
  options?: {
    pollingInterval?: number;
    maxWaitTime?: number;
  }
): Promise<BatchResultsResponse>
```
Polls for batch completion with configurable intervals.

#### Static Methods

##### filterCleanRecords()
```typescript
static filterCleanRecords(results: DNCCheckResult[]): CustomerRecord[]
```
Filters and returns only clean (non-flagged) records.

##### generateComplianceReport()
```typescript
static generateComplianceReport(results: BatchResultsResponse): ComplianceReport
```
Generates a detailed compliance report with statistics and recommendations.

### Types

#### CustomerRecord
```typescript
interface CustomerRecord {
  id: string;
  phoneNumber: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  zipCode?: string;
  metadata?: Record<string, any>;
}
```

#### DNCCheckResult
```typescript
interface DNCCheckResult {
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
```

## Testing

Run the test suite:

```bash
npm test src/api-clients/possiblenow/__tests__
```

## Best Practices

1. **Batch Size**: Keep batches under 500 records for optimal performance
2. **Rate Limiting**: Monitor rate limit status and implement backoff strategies
3. **Error Handling**: Always wrap API calls in try-catch blocks
4. **Circuit Breaker**: Monitor circuit breaker state for service health
5. **Logging**: Enable debug logging in development for troubleshooting
6. **Token Management**: Let the client handle token refresh automatically
7. **Production vs Sandbox**: Always test in sandbox before production deployment

## Compliance Notes

- Always ensure you have proper consent before checking phone numbers
- Store DNC results for compliance documentation
- Implement appropriate data retention policies
- Review PossibleNOW's terms of service and compliance guidelines

## Support

For issues with the client, check:
1. Circuit breaker status
2. Rate limit information
3. Authentication token validity
4. Network connectivity
5. API service status

For PossibleNOW API support, contact their technical support team.