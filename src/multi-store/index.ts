/**
 * Multi-Store Configuration and Orchestration System
 * 
 * This module provides comprehensive multi-store management for DNC compliance processing,
 * allowing parallel processing of multiple dealerships with shared resource management.
 */

export { MultiStoreOrchestrator, MultiStoreConfig, StoreProcessingResult, AggregatedReport } from './MultiStoreOrchestrator';
export { StoreRegistry, StoreConfig, StorePriority } from './StoreRegistry';
export { QueueManager, QueuedStore, QueueStatistics } from './QueueManager';
export { ResourcePoolManager, ResourcePoolConfig, ResourceAllocation, ResourceUsageStats } from './ResourcePoolManager';
export { DashboardDataProvider, DashboardData, HistoricalMetrics } from './monitoring/DashboardDataProvider';

// Re-export types
export type { MultiStoreConfig as MSConfig } from './MultiStoreOrchestrator';
export type { StoreConfig as MSStoreConfig } from './StoreRegistry';

/**
 * Quick Start Example:
 * 
 * ```typescript
 * import { MultiStoreOrchestrator, StoreRegistry, StorePriority } from './multi-store';
 * 
 * // Initialize components
 * const registry = new StoreRegistry();
 * const orchestrator = new MultiStoreOrchestrator({
 *   maxConcurrentStores: 3,
 *   maxBrowsersPerStore: 2,
 *   apiRateLimits: {
 *     possibleNOW: {
 *       requestsPerMinute: 60,
 *       burstLimit: 10,
 *     },
 *   },
 *   processingWindows: {},
 *   failureIsolation: {
 *     maxRetries: 3,
 *     backoffMultiplier: 2,
 *     quarantineThreshold: 5,
 *   },
 * });
 * 
 * // Load stores and initialize
 * await registry.loadStores();
 * await orchestrator.initialize();
 * 
 * // Start processing
 * const report = await orchestrator.startProcessing();
 * console.log(`Processed ${report.completedStores} stores successfully`);
 * ```
 */