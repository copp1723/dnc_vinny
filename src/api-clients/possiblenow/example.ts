/**
 * PossibleNOW API Client Usage Example
 * Demonstrates real-world usage patterns for DNC compliance checking
 */

import { PossibleNOWClient, createConfigFromEnv, CustomerRecord, PossibleNOWAPIError } from './index';
import { logger } from '../../../priority5-compliance/logger';
import fs from 'fs/promises';
import path from 'path';

/**
 * Example 1: Basic DNC check for a small list
 */
async function basicDNCCheck() {
  logger.info('Starting basic DNC check example');

  try {
    // Create and initialize client
    const client = new PossibleNOWClient(createConfigFromEnv());
    await client.initialize();

    // Sample customer records
    const customers: CustomerRecord[] = [
      {
        id: 'cust-001',
        phoneNumber: '5551234567',
        firstName: 'John',
        lastName: 'Doe',
        zipCode: '90210'
      },
      {
        id: 'cust-002',
        phoneNumber: '5559876543',
        firstName: 'Jane',
        lastName: 'Smith',
        zipCode: '10001'
      }
    ];

    // Submit for DNC check
    const submission = await client.submitDNCCheck(customers);
    logger.info('Batch submitted', { batchId: submission.batchId });

    // Wait for results
    const results = await client.waitForBatchCompletion(submission.batchId, {
      pollingInterval: 2000, // Check every 2 seconds
      maxWaitTime: 60000    // Max 1 minute
    });

    // Process results
    logger.info('Results received', {
      total: results.summary.totalRecords,
      clean: results.summary.cleanRecords,
      flagged: results.summary.flaggedRecords
    });

    // Get clean records only
    const cleanRecords = PossibleNOWClient.filterCleanRecords(results.results);
    logger.info(`${cleanRecords.length} records are clean and can be contacted`);

    // Generate compliance report
    const report = PossibleNOWClient.generateComplianceReport(results);
    logger.info('Compliance Report', report);

    return cleanRecords;
  } catch (error) {
    handleError(error);
    throw error;
  }
}

/**
 * Example 2: Processing a large CSV file with batching
 */
async function processCSVFile(csvFilePath: string) {
  logger.info('Processing CSV file for DNC compliance', { file: csvFilePath });

  try {
    const client = new PossibleNOWClient(createConfigFromEnv());
    await client.initialize();

    // Read and parse CSV (simplified - use a proper CSV parser in production)
    const csvContent = await fs.readFile(csvFilePath, 'utf-8');
    const lines = csvContent.split('\n').slice(1); // Skip header
    
    const customers: CustomerRecord[] = lines
      .filter(line => line.trim())
      .map((line, index) => {
        const [phone, firstName, lastName, email, zipCode] = line.split(',');
        return {
          id: `csv-${index}`,
          phoneNumber: phone.trim(),
          firstName: firstName?.trim(),
          lastName: lastName?.trim(),
          email: email?.trim(),
          zipCode: zipCode?.trim()
        };
      });

    logger.info(`Loaded ${customers.length} records from CSV`);

    // Submit in batches (automatically handles splitting)
    const submissions = await client.submitDNCCheckMultipleBatches(customers);
    logger.info(`Submitted ${submissions.length} batches`);

    // Wait for all batches
    const allResults = await Promise.all(
      submissions.map(async (sub, index) => {
        logger.info(`Waiting for batch ${index + 1}/${submissions.length}`, {
          batchId: sub.batchId
        });
        return await client.waitForBatchCompletion(sub.batchId);
      })
    );

    // Combine and analyze results
    const allRecords = allResults.flatMap(r => r.results);
    const cleanRecords = PossibleNOWClient.filterCleanRecords(allRecords);
    
    // Save clean records to new CSV
    const outputPath = csvFilePath.replace('.csv', '_dnc_clean.csv');
    await saveCleanRecordsToCSV(cleanRecords, outputPath);

    // Generate summary report
    const totalProcessed = allRecords.length;
    const totalClean = cleanRecords.length;
    const complianceRate = (totalClean / totalProcessed) * 100;

    logger.info('Processing complete', {
      totalProcessed,
      totalClean,
      totalFlagged: totalProcessed - totalClean,
      complianceRate: `${complianceRate.toFixed(2)}%`,
      outputFile: outputPath
    });

    return {
      cleanRecords,
      outputPath,
      summary: {
        totalProcessed,
        totalClean,
        complianceRate
      }
    };
  } catch (error) {
    handleError(error);
    throw error;
  }
}

/**
 * Example 3: Real-time DNC check with monitoring
 */
async function realtimeDNCCheck(phoneNumber: string): Promise<boolean> {
  const client = new PossibleNOWClient(createConfigFromEnv());
  await client.initialize();

  try {
    // Check rate limits before proceeding
    const rateLimits = client.getRateLimitInfo();
    if (rateLimits.remaining < 10) {
      logger.warn('Low on rate limit quota', rateLimits);
    }

    // Check circuit breaker status
    const circuitStatus = client.getCircuitBreakerStats();
    if (circuitStatus.state !== 'closed') {
      logger.error('Circuit breaker is not closed', circuitStatus);
      return false; // Assume not clean when service is degraded
    }

    // Submit single record
    const submission = await client.submitDNCCheck([{
      id: `realtime-${Date.now()}`,
      phoneNumber
    }]);

    // Wait for result with short timeout
    const results = await client.waitForBatchCompletion(submission.batchId, {
      pollingInterval: 1000,
      maxWaitTime: 10000 // 10 seconds max for real-time
    });

    // Check if clean
    const record = results.results[0];
    const isClean = record.status === 'clean';

    logger.info('Real-time DNC check complete', {
      phoneNumber,
      isClean,
      flags: record.flags
    });

    return isClean;
  } catch (error) {
    if (error instanceof PossibleNOWAPIError && error.code === 'BATCH_PROCESSING_TIMEOUT') {
      logger.error('Real-time check timeout', { phoneNumber });
      return false; // Assume not clean on timeout
    }
    throw error;
  }
}

/**
 * Example 4: Scheduled compliance audit
 */
async function runComplianceAudit(customerDatabase: CustomerRecord[]) {
  logger.info('Starting scheduled compliance audit', {
    recordCount: customerDatabase.length
  });

  const client = new PossibleNOWClient(createConfigFromEnv());
  await client.initialize();

  const auditResults = {
    timestamp: new Date().toISOString(),
    totalRecords: customerDatabase.length,
    violations: {
      federalDNC: [] as string[],
      stateDNC: [] as string[],
      wireless: [] as string[],
      tcpa: [] as string[]
    },
    recommendations: [] as string[]
  };

  try {
    // Process in batches
    const submissions = await client.submitDNCCheckMultipleBatches(customerDatabase);
    
    // Collect all results
    for (const submission of submissions) {
      const results = await client.waitForBatchCompletion(submission.batchId);
      
      // Analyze violations
      for (const result of results.results) {
        if (result.status === 'flagged') {
          if (result.flags.federalDNC) {
            auditResults.violations.federalDNC.push(result.phoneNumber);
          }
          if (result.flags.stateDNC) {
            auditResults.violations.stateDNC.push(result.phoneNumber);
          }
          if (result.flags.wireless) {
            auditResults.violations.wireless.push(result.phoneNumber);
          }
          if (result.flags.tcpaViolation) {
            auditResults.violations.tcpa.push(result.phoneNumber);
          }
        }
      }

      // Add recommendations from report
      const report = PossibleNOWClient.generateComplianceReport(results);
      auditResults.recommendations.push(...report.recommendations);
    }

    // Remove duplicates from recommendations
    auditResults.recommendations = [...new Set(auditResults.recommendations)];

    // Save audit report
    const auditPath = path.join('audits', `dnc-audit-${Date.now()}.json`);
    await fs.mkdir('audits', { recursive: true });
    await fs.writeFile(auditPath, JSON.stringify(auditResults, null, 2));

    logger.info('Compliance audit complete', {
      violations: {
        federal: auditResults.violations.federalDNC.length,
        state: auditResults.violations.stateDNC.length,
        wireless: auditResults.violations.wireless.length,
        tcpa: auditResults.violations.tcpa.length
      },
      reportPath: auditPath
    });

    return auditResults;
  } catch (error) {
    handleError(error);
    throw error;
  }
}

/**
 * Helper function to save clean records to CSV
 */
async function saveCleanRecordsToCSV(records: CustomerRecord[], outputPath: string) {
  const headers = ['id', 'phoneNumber', 'firstName', 'lastName', 'email', 'zipCode'];
  const rows = records.map(r => 
    [r.id, r.phoneNumber, r.firstName || '', r.lastName || '', r.email || '', r.zipCode || '']
      .map(field => `"${field}"`)
      .join(',')
  );
  
  const csv = [headers.join(','), ...rows].join('\n');
  await fs.writeFile(outputPath, csv, 'utf-8');
}

/**
 * Centralized error handling
 */
function handleError(error: any) {
  if (error instanceof PossibleNOWAPIError) {
    logger.error('PossibleNOW API Error', {
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      details: error.details
    });

    // Handle specific error types
    switch (error.code) {
      case 'RATE_LIMIT_EXCEEDED':
        logger.warn('Consider implementing backoff strategy or upgrading rate limits');
        break;
      case 'AUTH_FAILED':
        logger.error('Authentication failed - check credentials');
        break;
      case 'SERVICE_UNAVAILABLE':
        logger.error('Service unavailable - circuit breaker may be open');
        break;
      case 'BATCH_PROCESSING_FAILED':
        logger.error('Batch processing failed - check API status');
        break;
    }
  } else {
    logger.error('Unexpected error', { error });
  }
}

/**
 * Main function demonstrating various usage patterns
 */
async function main() {
  try {
    // Example 1: Basic check
    console.log('\n=== Basic DNC Check ===');
    await basicDNCCheck();

    // Example 2: CSV processing (uncomment to test with real file)
    // console.log('\n=== CSV File Processing ===');
    // await processCSVFile('./customers.csv');

    // Example 3: Real-time check
    console.log('\n=== Real-time Check ===');
    const isClean = await realtimeDNCCheck('5551234567');
    console.log(`Phone is ${isClean ? 'clean' : 'flagged'}`);

    // Example 4: Compliance audit (uncomment to test)
    // console.log('\n=== Compliance Audit ===');
    // const sampleDatabase: CustomerRecord[] = [
    //   { id: '1', phoneNumber: '5551234567' },
    //   { id: '2', phoneNumber: '5559876543' }
    // ];
    // await runComplianceAudit(sampleDatabase);

  } catch (error) {
    console.error('Example failed:', error);
    process.exit(1);
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  main();
}

// Export functions for use in other modules
export {
  basicDNCCheck,
  processCSVFile,
  realtimeDNCCheck,
  runComplianceAudit
};