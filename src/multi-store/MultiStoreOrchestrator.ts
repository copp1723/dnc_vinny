import { EventEmitter } from 'events';
import { TaskOrchestrator, TaskContext } from '../../priority3-orchestration/TaskOrchestrator';
import { ParallelCoordinator } from '../../priority3-orchestration/ParallelCoordinator';
import { StoreRegistry, StoreConfig, StorePriority } from './StoreRegistry';
import { QueueManager, QueuedStore } from './QueueManager';
import { ResourcePoolManager } from './ResourcePoolManager';
import { DealershipConfig } from '../config/schemas';
import { logger } from '../../priority5-compliance/logger';
import { Page, Browser } from 'playwright';

export interface MultiStoreConfig {
  maxConcurrentStores: number;
  maxBrowsersPerStore: number;
  apiRateLimits: {
    possibleNOW: {
      requestsPerMinute: number;
      burstLimit: number;
    };
  };
  processingWindows: {
    [key: string]: {
      start: string; // HH:MM format
      end: string;   // HH:MM format
      timezone: string;
    };
  };
  failureIsolation: {
    maxRetries: number;
    backoffMultiplier: number;
    quarantineThreshold: number;
  };
}

export interface StoreProcessingResult {
  storeId: string;
  storeName: string;
  status: 'completed' | 'failed' | 'partial';
  startTime: Date;
  endTime: Date;
  duration: number;
  metrics: {
    totalCustomers: number;
    processedCustomers: number;
    dncMarkedCustomers: number;
    errors: number;
    apiCalls: number;
  };
  errors?: string[];
}

export interface AggregatedReport {
  totalStores: number;
  completedStores: number;
  failedStores: number;
  partialStores: number;
  totalDuration: number;
  aggregatedMetrics: {
    totalCustomers: number;
    processedCustomers: number;
    dncMarkedCustomers: number;
    totalErrors: number;
    totalApiCalls: number;
  };
  storeResults: StoreProcessingResult[];
  complianceStatistics: {
    complianceRate: number;
    averageProcessingTime: number;
    apiUsageRate: number;
  };
}

export class MultiStoreOrchestrator extends EventEmitter {
  private storeRegistry: StoreRegistry;
  private queueManager: QueueManager;
  private resourcePool: ResourcePoolManager;
  private activeProcessing: Map<string, TaskOrchestrator> = new Map();
  private processingResults: Map<string, StoreProcessingResult> = new Map();
  private config: MultiStoreConfig;
  private isRunning: boolean = false;

  constructor(config: MultiStoreConfig) {
    super();
    this.config = config;
    this.storeRegistry = new StoreRegistry();
    this.queueManager = new QueueManager();
    this.resourcePool = new ResourcePoolManager({
      maxBrowsers: config.maxConcurrentStores * config.maxBrowsersPerStore,
      maxApiRequests: config.apiRateLimits.possibleNOW.requestsPerMinute,
      burstLimit: config.apiRateLimits.possibleNOW.burstLimit,
    });
  }

  /**
   * Initialize the multi-store orchestrator
   */
  async initialize(): Promise<void> {
    logger.info('🚀 Initializing Multi-Store Orchestrator');
    
    await this.storeRegistry.loadStores();
    await this.resourcePool.initialize();
    
    // Set up event listeners
    this.setupEventListeners();
    
    logger.info(`✅ Multi-Store Orchestrator initialized with ${this.storeRegistry.getActiveStores().length} active stores`);
  }

  /**
   * Start processing all active stores
   */
  async startProcessing(): Promise<AggregatedReport> {
    if (this.isRunning) {
      throw new Error('Multi-store processing is already running');
    }

    this.isRunning = true;
    this.processingResults.clear();
    const startTime = new Date();

    try {
      logger.info('🏪 Starting multi-store processing');
      
      // Get all active stores
      const activeStores = this.storeRegistry.getActiveStores();
      
      // Queue stores based on priority and processing windows
      for (const store of activeStores) {
        if (this.isWithinProcessingWindow(store)) {
          await this.queueManager.enqueueStore(store);
        } else {
          logger.info(`⏰ Store ${store.name} is outside its processing window`);
        }
      }

      // Process stores concurrently up to the limit
      const processingPromises: Promise<void>[] = [];
      
      while (this.queueManager.hasStores() || processingPromises.length > 0) {
        // Start new store processing if under limit
        while (processingPromises.length < this.config.maxConcurrentStores && this.queueManager.hasStores()) {
          const queuedStore = await this.queueManager.dequeueStore();
          if (queuedStore) {
            const promise = this.processStore(queuedStore)
              .then(() => {
                const index = processingPromises.indexOf(promise);
                if (index > -1) {
                  processingPromises.splice(index, 1);
                }
              })
              .catch(error => {
                logger.error(`Failed to process store: ${error.message}`);
                const index = processingPromises.indexOf(promise);
                if (index > -1) {
                  processingPromises.splice(index, 1);
                }
              });
            
            processingPromises.push(promise);
          }
        }

        // Wait for at least one to complete before checking again
        if (processingPromises.length > 0) {
          await Promise.race(processingPromises);
        }

        // Small delay to prevent tight loop
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Wait for all remaining processing to complete
      await Promise.all(processingPromises);

      const endTime = new Date();
      const totalDuration = endTime.getTime() - startTime.getTime();

      // Generate aggregated report
      const report = this.generateAggregatedReport(totalDuration);
      
      logger.info('✅ Multi-store processing completed');
      this.emit('processingCompleted', report);
      
      return report;

    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Process a single store
   */
  private async processStore(queuedStore: QueuedStore): Promise<void> {
    const store = queuedStore.store;
    const startTime = new Date();
    
    logger.info(`🏪 Starting processing for store: ${store.name} (Priority: ${store.priority})`);
    this.emit('storeProcessingStarted', { storeId: store.id, storeName: store.name });

    try {
      // Acquire resources for this store
      const resources = await this.resourcePool.acquireResources(store.id, {
        browsers: this.config.maxBrowsersPerStore,
        apiQuota: Math.floor(this.config.apiRateLimits.possibleNOW.requestsPerMinute / this.config.maxConcurrentStores),
      });

      // Create task orchestrator for this store
      const orchestrator = new TaskOrchestrator(`Store-${store.id}`);
      this.activeProcessing.set(store.id, orchestrator);

      // Register store-specific tasks
      this.registerStoreTasks(orchestrator, store);

      // Create a mock page for now (in real implementation, this would come from browser pool)
      const mockPage = {} as Page;

      // Execute all tasks for this store
      const results = await orchestrator.executeAll(mockPage, store.dealershipConfig);

      // Calculate metrics from results
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      const storeResult: StoreProcessingResult = {
        storeId: store.id,
        storeName: store.name,
        status: 'completed',
        startTime,
        endTime,
        duration,
        metrics: {
          totalCustomers: results.get('extract-customers')?.data?.totalCustomers || 0,
          processedCustomers: results.get('mark-dnc')?.data?.processedCount || 0,
          dncMarkedCustomers: results.get('mark-dnc')?.data?.markedCount || 0,
          errors: Array.from(results.values()).filter(r => !r.success).length,
          apiCalls: resources.apiQuota,
        },
      };

      this.processingResults.set(store.id, storeResult);
      logger.info(`✅ Completed processing for store: ${store.name}`);
      this.emit('storeProcessingCompleted', storeResult);

    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const errorMessage = error instanceof Error ? error.message : String(error);

      const storeResult: StoreProcessingResult = {
        storeId: store.id,
        storeName: store.name,
        status: 'failed',
        startTime,
        endTime,
        duration,
        metrics: {
          totalCustomers: 0,
          processedCustomers: 0,
          dncMarkedCustomers: 0,
          errors: 1,
          apiCalls: 0,
        },
        errors: [errorMessage],
      };

      this.processingResults.set(store.id, storeResult);
      logger.error(`❌ Failed processing for store: ${store.name} - ${errorMessage}`);
      this.emit('storeProcessingFailed', { storeId: store.id, error: errorMessage });

      // Handle failure isolation
      await this.handleStoreFailure(store, errorMessage);

    } finally {
      // Release resources
      await this.resourcePool.releaseResources(store.id);
      this.activeProcessing.delete(store.id);
    }
  }

  /**
   * Register store-specific tasks
   */
  private registerStoreTasks(orchestrator: TaskOrchestrator, store: StoreConfig): void {
    // Task 1: Initialize store session
    orchestrator.registerTask({
      id: 'init-session',
      name: 'Initialize Store Session',
      description: `Initialize session for ${store.name}`,
      dependencies: [],
      timeout: 60000,
      retryCount: 2,
      critical: true,
      execute: async (context: TaskContext) => {
        logger.info(`Initializing session for store: ${store.name}`);
        // Implementation would initialize VinSolutions session
        return { sessionId: `session-${store.id}` };
      },
    });

    // Task 2: Extract customers
    orchestrator.registerTask({
      id: 'extract-customers',
      name: 'Extract Customer Data',
      description: `Extract customer data from VinSolutions for ${store.name}`,
      dependencies: ['init-session'],
      timeout: 300000,
      retryCount: 1,
      critical: true,
      execute: async (context: TaskContext) => {
        logger.info(`Extracting customers for store: ${store.name}`);
        // Implementation would use VinSolutionsExtractor
        return { 
          totalCustomers: 1000, // Mock data
          extractedFile: `/tmp/customers-${store.id}.csv`,
        };
      },
    });

    // Task 3: Check DNC status
    orchestrator.registerTask({
      id: 'check-dnc',
      name: 'Check DNC Status',
      description: `Check DNC status via PossibleNOW for ${store.name}`,
      dependencies: ['extract-customers'],
      timeout: 600000,
      retryCount: 2,
      execute: async (context: TaskContext) => {
        logger.info(`Checking DNC status for store: ${store.name}`);
        // Implementation would use PossibleNOW API
        return {
          checkedCount: 1000,
          dncCount: 150,
        };
      },
    });

    // Task 4: Mark DNC in VinSolutions
    orchestrator.registerTask({
      id: 'mark-dnc',
      name: 'Mark DNC Status',
      description: `Mark DNC status in VinSolutions for ${store.name}`,
      dependencies: ['check-dnc'],
      timeout: 300000,
      retryCount: 1,
      execute: async (context: TaskContext) => {
        logger.info(`Marking DNC status for store: ${store.name}`);
        // Implementation would update VinSolutions
        return {
          processedCount: 1000,
          markedCount: 150,
        };
      },
    });

    // Task 5: Generate store report
    orchestrator.registerTask({
      id: 'generate-report',
      name: 'Generate Store Report',
      description: `Generate compliance report for ${store.name}`,
      dependencies: ['mark-dnc'],
      timeout: 60000,
      execute: async (context: TaskContext) => {
        logger.info(`Generating report for store: ${store.name}`);
        // Implementation would generate store-specific report
        return {
          reportPath: `/tmp/report-${store.id}.pdf`,
        };
      },
    });
  }

  /**
   * Check if store is within its processing window
   */
  private isWithinProcessingWindow(store: StoreConfig): boolean {
    const window = this.config.processingWindows[store.id];
    if (!window) return true; // No window restriction

    const now = new Date();
    const timezone = window.timezone || 'America/Los_Angeles';
    
    // Convert to store's timezone and check window
    // For simplicity, returning true for now
    return true;
  }

  /**
   * Handle store failure with isolation
   */
  private async handleStoreFailure(store: StoreConfig, error: string): Promise<void> {
    const failures = await this.storeRegistry.incrementFailureCount(store.id);
    
    if (failures >= this.config.failureIsolation.quarantineThreshold) {
      logger.warn(`🔒 Quarantining store ${store.name} due to repeated failures`);
      await this.storeRegistry.quarantineStore(store.id);
      this.emit('storeQuarantined', { storeId: store.id, failures });
    }
  }

  /**
   * Generate aggregated report
   */
  private generateAggregatedReport(totalDuration: number): AggregatedReport {
    const results = Array.from(this.processingResults.values());
    
    const completed = results.filter(r => r.status === 'completed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const partial = results.filter(r => r.status === 'partial').length;

    const aggregatedMetrics = results.reduce((acc, result) => ({
      totalCustomers: acc.totalCustomers + result.metrics.totalCustomers,
      processedCustomers: acc.processedCustomers + result.metrics.processedCustomers,
      dncMarkedCustomers: acc.dncMarkedCustomers + result.metrics.dncMarkedCustomers,
      totalErrors: acc.totalErrors + result.metrics.errors,
      totalApiCalls: acc.totalApiCalls + result.metrics.apiCalls,
    }), {
      totalCustomers: 0,
      processedCustomers: 0,
      dncMarkedCustomers: 0,
      totalErrors: 0,
      totalApiCalls: 0,
    });

    const complianceRate = aggregatedMetrics.processedCustomers > 0
      ? (aggregatedMetrics.dncMarkedCustomers / aggregatedMetrics.processedCustomers) * 100
      : 0;

    const averageProcessingTime = results.length > 0
      ? results.reduce((sum, r) => sum + r.duration, 0) / results.length
      : 0;

    const apiUsageRate = this.config.apiRateLimits.possibleNOW.requestsPerMinute > 0
      ? (aggregatedMetrics.totalApiCalls / (totalDuration / 60000)) / this.config.apiRateLimits.possibleNOW.requestsPerMinute * 100
      : 0;

    return {
      totalStores: this.storeRegistry.getActiveStores().length,
      completedStores: completed,
      failedStores: failed,
      partialStores: partial,
      totalDuration,
      aggregatedMetrics,
      storeResults: results,
      complianceStatistics: {
        complianceRate,
        averageProcessingTime,
        apiUsageRate,
      },
    };
  }

  /**
   * Set up event listeners
   */
  private setupEventListeners(): void {
    this.on('storeProcessingStarted', (data) => {
      logger.info(`📊 Store ${data.storeName} started processing`);
    });

    this.on('storeProcessingCompleted', (result: StoreProcessingResult) => {
      logger.info(`📊 Store ${result.storeName} completed: ${result.metrics.processedCustomers} customers processed`);
    });

    this.on('storeProcessingFailed', (data) => {
      logger.error(`📊 Store processing failed: ${data.storeId} - ${data.error}`);
    });

    this.on('storeQuarantined', (data) => {
      logger.warn(`📊 Store quarantined: ${data.storeId} after ${data.failures} failures`);
    });
  }

  /**
   * Get real-time status
   */
  getStatus(): {
    isRunning: boolean;
    activeStores: string[];
    queuedStores: number;
    completedStores: number;
    resourceUsage: any;
  } {
    return {
      isRunning: this.isRunning,
      activeStores: Array.from(this.activeProcessing.keys()),
      queuedStores: this.queueManager.getQueueLength(),
      completedStores: this.processingResults.size,
      resourceUsage: this.resourcePool.getUsageStats(),
    };
  }

  /**
   * Stop processing gracefully
   */
  async stopProcessing(): Promise<void> {
    logger.info('🛑 Stopping multi-store processing...');
    this.isRunning = false;
    
    // Wait for active processing to complete
    const activePromises = Array.from(this.activeProcessing.values()).map(orchestrator => {
      return new Promise(resolve => {
        orchestrator.once('completed', resolve);
      });
    });

    await Promise.all(activePromises);
    logger.info('✅ Multi-store processing stopped');
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    await this.stopProcessing();
    await this.resourcePool.cleanup();
    this.removeAllListeners();
  }
}