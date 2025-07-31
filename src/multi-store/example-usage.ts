/**
 * Example usage of the Multi-Store Orchestration System
 */

import { 
  MultiStoreOrchestrator,
  StoreRegistry,
  StorePriority,
  QueueManager,
  ResourcePoolManager,
  DashboardDataProvider,
} from './index';
import { logger } from '../../priority5-compliance/logger';

async function runMultiStoreExample() {
  logger.info('🚀 Starting Multi-Store Example');

  // 1. Initialize components
  const registry = new StoreRegistry();
  const queueManager = new QueueManager();
  const resourcePool = new ResourcePoolManager({
    maxBrowsers: 6, // 3 stores * 2 browsers each
    maxApiRequests: 60,
    burstLimit: 10,
    browserTimeout: 300000, // 5 minutes
    contextOptions: {
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/Los_Angeles',
    },
  });

  const orchestrator = new MultiStoreOrchestrator({
    maxConcurrentStores: 3,
    maxBrowsersPerStore: 2,
    apiRateLimits: {
      possibleNOW: {
        requestsPerMinute: 60,
        burstLimit: 10,
      },
    },
    processingWindows: {
      'store-001': {
        start: '22:00',
        end: '06:00',
        timezone: 'America/Los_Angeles',
      },
      'store-002': {
        start: '23:00',
        end: '07:00',
        timezone: 'America/New_York',
      },
    },
    failureIsolation: {
      maxRetries: 3,
      backoffMultiplier: 2,
      quarantineThreshold: 5,
    },
  });

  // 2. Set up monitoring
  const dashboard = new DashboardDataProvider(
    orchestrator,
    registry,
    queueManager,
    resourcePool
  );

  dashboard.on('dataUpdate', (data) => {
    logger.info('📊 Dashboard Update:', {
      activeStores: data.stores.processing,
      queuedStores: data.stores.queued,
      browserUtilization: `${data.resources.browsers.utilization.toFixed(1)}%`,
      apiUsage: `${data.resources.api.requestsPerMinute} req/min`,
    });
  });

  dashboard.on('alert', (alert) => {
    logger.warn(`⚠️ Alert: ${alert.message}`);
  });

  // 3. Load stores (would normally load from config)
  await registry.loadStores();

  // Example: Add demo stores if none exist
  if (registry.getAllStores().length === 0) {
    await addDemoStores(registry);
  }

  // 4. Initialize orchestrator and resource pool
  await orchestrator.initialize();
  dashboard.start(5000); // Update every 5 seconds

  // 5. Set up event handlers
  orchestrator.on('storeProcessingStarted', ({ storeId, storeName }) => {
    logger.info(`🏪 Started: ${storeName}`);
  });

  orchestrator.on('storeProcessingCompleted', (result) => {
    logger.info(`✅ Completed: ${result.storeName}`, {
      duration: `${(result.duration / 1000).toFixed(1)}s`,
      customers: result.metrics.processedCustomers,
      dncMarked: result.metrics.dncMarkedCustomers,
    });
  });

  orchestrator.on('storeProcessingFailed', ({ storeId, error }) => {
    logger.error(`❌ Failed: Store ${storeId} - ${error}`);
  });

  orchestrator.on('processingCompleted', (report) => {
    logger.info('📋 Final Report:', {
      totalStores: report.totalStores,
      completed: report.completedStores,
      failed: report.failedStores,
      duration: `${(report.totalDuration / 60000).toFixed(1)} minutes`,
      complianceRate: `${report.complianceStatistics.complianceRate.toFixed(1)}%`,
    });
  });

  // 6. Start processing
  try {
    logger.info('▶️ Starting multi-store processing...');
    const report = await orchestrator.startProcessing();

    // 7. Display summary
    console.log('\n════════════════════════════════════════════════════');
    console.log('                  PROCESSING COMPLETE                ');
    console.log('════════════════════════════════════════════════════');
    console.log(`Total Stores:        ${report.totalStores}`);
    console.log(`Completed:           ${report.completedStores}`);
    console.log(`Failed:              ${report.failedStores}`);
    console.log(`Duration:            ${(report.totalDuration / 60000).toFixed(1)} minutes`);
    console.log('────────────────────────────────────────────────────');
    console.log(`Customers Processed: ${report.aggregatedMetrics.totalCustomers}`);
    console.log(`DNC Marked:          ${report.aggregatedMetrics.dncMarkedCustomers}`);
    console.log(`Compliance Rate:     ${report.complianceStatistics.complianceRate.toFixed(1)}%`);
    console.log(`API Usage:           ${report.complianceStatistics.apiUsageRate.toFixed(1)}%`);
    console.log('════════════════════════════════════════════════════\n');

    // 8. Show store details
    console.log('Store Results:');
    console.log('─────────────────────────────────────────────────────');
    for (const storeResult of report.storeResults) {
      const status = storeResult.status === 'completed' ? '✅' : '❌';
      console.log(`${status} ${storeResult.storeName}`);
      console.log(`   Duration: ${(storeResult.duration / 1000).toFixed(1)}s`);
      console.log(`   Customers: ${storeResult.metrics.processedCustomers}`);
      console.log(`   DNC Marked: ${storeResult.metrics.dncMarkedCustomers}`);
      if (storeResult.errors?.length) {
        console.log(`   Errors: ${storeResult.errors.join(', ')}`);
      }
      console.log('');
    }

  } catch (error) {
    logger.error('Processing failed:', error);
  } finally {
    // 9. Cleanup
    dashboard.stop();
    await orchestrator.cleanup();
    logger.info('🧹 Cleanup complete');
  }
}

/**
 * Add demo stores for testing
 */
async function addDemoStores(registry: StoreRegistry) {
  const demoStores = [
    {
      id: 'demo-001',
      name: 'Demo Motors West',
      priority: StorePriority.HIGH,
      active: true,
      dealershipConfig: {
        id: 'demo-001',
        name: 'Demo Motors West',
        active: true,
        vinSolutions: {
          baseUrl: 'https://api.vinsolutions.com',
          apiKey: 'demo-key-001',
          apiSecret: 'demo-secret-001',
          dealershipId: 'dealer-001',
          timeout: 30000,
          retryAttempts: 3,
          retryDelay: 1000,
        },
        possibleNOW: {
          baseUrl: 'https://api.possiblenow.com',
          username: 'demo-user-001',
          password: 'demo-pass-001',
          accountId: 'account-001',
          apiVersion: 'v1',
          timeout: 30000,
          retryAttempts: 3,
        },
      },
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        failureCount: 0,
        quarantined: false,
      },
    },
    {
      id: 'demo-002',
      name: 'Demo Motors East',
      priority: StorePriority.MEDIUM,
      active: true,
      dealershipConfig: {
        id: 'demo-002',
        name: 'Demo Motors East',
        active: true,
        vinSolutions: {
          baseUrl: 'https://api.vinsolutions.com',
          apiKey: 'demo-key-002',
          apiSecret: 'demo-secret-002',
          dealershipId: 'dealer-002',
          timeout: 30000,
          retryAttempts: 3,
          retryDelay: 1000,
        },
        possibleNOW: {
          baseUrl: 'https://api.possiblenow.com',
          username: 'demo-user-002',
          password: 'demo-pass-002',
          accountId: 'account-002',
          apiVersion: 'v1',
          timeout: 30000,
          retryAttempts: 3,
        },
      },
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        failureCount: 0,
        quarantined: false,
      },
    },
    {
      id: 'demo-003',
      name: 'Demo Motors Central',
      priority: StorePriority.LOW,
      active: true,
      dealershipConfig: {
        id: 'demo-003',
        name: 'Demo Motors Central',
        active: true,
        vinSolutions: {
          baseUrl: 'https://api.vinsolutions.com',
          apiKey: 'demo-key-003',
          apiSecret: 'demo-secret-003',
          dealershipId: 'dealer-003',
          timeout: 30000,
          retryAttempts: 3,
          retryDelay: 1000,
        },
        possibleNOW: {
          baseUrl: 'https://api.possiblenow.com',
          username: 'demo-user-003',
          password: 'demo-pass-003',
          accountId: 'account-003',
          apiVersion: 'v1',
          timeout: 30000,
          retryAttempts: 3,
        },
      },
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        failureCount: 0,
        quarantined: false,
      },
    },
  ];

  for (const store of demoStores) {
    await registry.addStore(store);
  }

  logger.info(`Added ${demoStores.length} demo stores`);
}

// Run the example if this file is executed directly
if (require.main === module) {
  runMultiStoreExample().catch(error => {
    logger.error('Example failed:', error);
    process.exit(1);
  });
}

export { runMultiStoreExample };