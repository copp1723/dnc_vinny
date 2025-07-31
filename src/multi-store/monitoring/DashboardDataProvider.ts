import { EventEmitter } from 'events';
import { MultiStoreOrchestrator } from '../MultiStoreOrchestrator';
import { StoreRegistry } from '../StoreRegistry';
import { QueueManager } from '../QueueManager';
import { ResourcePoolManager } from '../ResourcePoolManager';
import { logger } from '../../../priority5-compliance/logger';

export interface DashboardData {
  timestamp: Date;
  system: {
    status: 'idle' | 'running' | 'error';
    uptime: number;
    version: string;
  };
  stores: {
    total: number;
    active: number;
    processing: number;
    queued: number;
    completed: number;
    failed: number;
    quarantined: number;
  };
  resources: {
    browsers: {
      total: number;
      allocated: number;
      available: number;
      utilization: number;
    };
    api: {
      requestsPerMinute: number;
      remainingQuota: number;
      throttleEvents: number;
    };
  };
  performance: {
    averageProcessingTime: number;
    successRate: number;
    throughput: {
      storesPerHour: number;
      customersPerHour: number;
    };
  };
  compliance: {
    totalCustomersProcessed: number;
    dncMarkedCount: number;
    complianceRate: number;
    lastComplianceCheck: Date | null;
  };
  realtimeMetrics: {
    activeStores: Array<{
      id: string;
      name: string;
      status: string;
      progress: number;
      startTime: Date;
      estimatedCompletion: Date | null;
    }>;
    recentErrors: Array<{
      timestamp: Date;
      storeId: string;
      message: string;
      severity: 'warning' | 'error' | 'critical';
    }>;
    queueStatus: {
      high: number;
      medium: number;
      low: number;
      nextProcessing: Date | null;
    };
  };
  alerts: Array<{
    id: string;
    type: 'resource' | 'performance' | 'compliance' | 'system';
    severity: 'info' | 'warning' | 'error' | 'critical';
    message: string;
    timestamp: Date;
    acknowledged: boolean;
  }>;
}

export interface HistoricalMetrics {
  timestamp: Date;
  storesProcessed: number;
  customersProcessed: number;
  dncMarked: number;
  successRate: number;
  averageProcessingTime: number;
  apiUsage: number;
  errors: number;
}

export class DashboardDataProvider extends EventEmitter {
  private orchestrator: MultiStoreOrchestrator;
  private registry: StoreRegistry;
  private queueManager: QueueManager;
  private resourcePool: ResourcePoolManager;
  private startTime: Date;
  private historicalData: HistoricalMetrics[] = [];
  private alerts: Map<string, any> = new Map();
  private recentErrors: Array<any> = [];
  private updateInterval: NodeJS.Timeout | null = null;
  private metricsAccumulator = {
    totalCustomers: 0,
    dncMarked: 0,
    storesCompleted: 0,
    storesFailed: 0,
    processingTimes: [] as number[],
  };

  constructor(
    orchestrator: MultiStoreOrchestrator,
    registry: StoreRegistry,
    queueManager: QueueManager,
    resourcePool: ResourcePoolManager
  ) {
    super();
    this.orchestrator = orchestrator;
    this.registry = registry;
    this.queueManager = queueManager;
    this.resourcePool = resourcePool;
    this.startTime = new Date();
    
    this.setupEventListeners();
  }

  /**
   * Start providing dashboard data
   */
  start(updateIntervalMs: number = 1000): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    this.updateInterval = setInterval(() => {
      const data = this.collectDashboardData();
      this.emit('dataUpdate', data);
    }, updateIntervalMs);

    logger.info('📊 Dashboard data provider started');
  }

  /**
   * Stop providing dashboard data
   */
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    logger.info('📊 Dashboard data provider stopped');
  }

  /**
   * Get current dashboard data
   */
  getDashboardData(): DashboardData {
    return this.collectDashboardData();
  }

  /**
   * Get historical metrics
   */
  getHistoricalMetrics(hours: number = 24): HistoricalMetrics[] {
    const cutoff = new Date(Date.now() - hours * 3600000);
    return this.historicalData.filter(m => m.timestamp >= cutoff);
  }

  /**
   * Add alert
   */
  addAlert(type: string, severity: string, message: string): void {
    const alert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      severity,
      message,
      timestamp: new Date(),
      acknowledged: false,
    };

    this.alerts.set(alert.id, alert);
    this.emit('alert', alert);
    
    // Auto-remove info alerts after 5 minutes
    if (severity === 'info') {
      setTimeout(() => this.removeAlert(alert.id), 300000);
    }
  }

  /**
   * Acknowledge alert
   */
  acknowledgeAlert(alertId: string): void {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.acknowledged = true;
      this.emit('alertAcknowledged', alertId);
    }
  }

  /**
   * Remove alert
   */
  removeAlert(alertId: string): void {
    this.alerts.delete(alertId);
    this.emit('alertRemoved', alertId);
  }

  /**
   * Collect dashboard data
   */
  private collectDashboardData(): DashboardData {
    const orchestratorStatus = this.orchestrator.getStatus();
    const registryStats = this.registry.getStatistics();
    const queueStats = this.queueManager.getStatistics();
    const resourceStats = this.resourcePool.getUsageStats();

    // Calculate performance metrics
    const successRate = this.metricsAccumulator.storesCompleted > 0
      ? (this.metricsAccumulator.storesCompleted / 
         (this.metricsAccumulator.storesCompleted + this.metricsAccumulator.storesFailed)) * 100
      : 0;

    const avgProcessingTime = this.metricsAccumulator.processingTimes.length > 0
      ? this.metricsAccumulator.processingTimes.reduce((a, b) => a + b, 0) / 
        this.metricsAccumulator.processingTimes.length
      : 0;

    // Calculate throughput
    const uptime = Date.now() - this.startTime.getTime();
    const hoursRunning = uptime / 3600000;
    const storesPerHour = hoursRunning > 0 
      ? this.metricsAccumulator.storesCompleted / hoursRunning
      : 0;
    const customersPerHour = hoursRunning > 0
      ? this.metricsAccumulator.totalCustomers / hoursRunning
      : 0;

    // Build active stores info
    const activeStores = orchestratorStatus.activeStores.map(storeId => {
      const store = this.registry.getStore(storeId);
      return {
        id: storeId,
        name: store?.name || 'Unknown',
        status: 'processing',
        progress: 50, // Would need to track actual progress
        startTime: new Date(),
        estimatedCompletion: new Date(Date.now() + avgProcessingTime),
      };
    });

    // Calculate compliance rate
    const complianceRate = this.metricsAccumulator.totalCustomers > 0
      ? (this.metricsAccumulator.dncMarked / this.metricsAccumulator.totalCustomers) * 100
      : 0;

    return {
      timestamp: new Date(),
      system: {
        status: orchestratorStatus.isRunning ? 'running' : 'idle',
        uptime,
        version: '1.0.0',
      },
      stores: {
        total: registryStats.total,
        active: registryStats.active,
        processing: orchestratorStatus.activeStores.length,
        queued: orchestratorStatus.queuedStores,
        completed: orchestratorStatus.completedStores,
        failed: this.metricsAccumulator.storesFailed,
        quarantined: registryStats.quarantined,
      },
      resources: {
        browsers: resourceStats.browsers,
        api: {
          requestsPerMinute: resourceStats.api.requestsThisMinute,
          remainingQuota: resourceStats.api.remainingQuota,
          throttleEvents: resourceStats.performance.apiThrottles,
        },
      },
      performance: {
        averageProcessingTime: avgProcessingTime,
        successRate,
        throughput: {
          storesPerHour,
          customersPerHour,
        },
      },
      compliance: {
        totalCustomersProcessed: this.metricsAccumulator.totalCustomers,
        dncMarkedCount: this.metricsAccumulator.dncMarked,
        complianceRate,
        lastComplianceCheck: new Date(),
      },
      realtimeMetrics: {
        activeStores,
        recentErrors: this.recentErrors.slice(-10),
        queueStatus: {
          high: queueStats.byPriority.high,
          medium: queueStats.byPriority.medium,
          low: queueStats.byPriority.low,
          nextProcessing: queueStats.estimatedCompletionTime,
        },
      },
      alerts: Array.from(this.alerts.values()).filter(a => !a.acknowledged),
    };
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Orchestrator events
    this.orchestrator.on('storeProcessingCompleted', (result) => {
      this.metricsAccumulator.storesCompleted++;
      this.metricsAccumulator.totalCustomers += result.metrics.totalCustomers;
      this.metricsAccumulator.dncMarked += result.metrics.dncMarkedCustomers;
      this.metricsAccumulator.processingTimes.push(result.duration);
      
      // Keep only last 100 processing times
      if (this.metricsAccumulator.processingTimes.length > 100) {
        this.metricsAccumulator.processingTimes.shift();
      }

      // Record historical data point
      this.recordHistoricalMetrics();
    });

    this.orchestrator.on('storeProcessingFailed', (data) => {
      this.metricsAccumulator.storesFailed++;
      this.addError(data.storeId, data.error, 'error');
    });

    this.orchestrator.on('storeQuarantined', (data) => {
      this.addAlert(
        'compliance',
        'warning',
        `Store ${data.storeId} quarantined after ${data.failures} failures`
      );
    });

    // Resource pool events
    this.resourcePool.on('apiThrottled', (data) => {
      this.addAlert(
        'resource',
        'warning',
        `API rate limit reached: ${data.requests} requests, ${data.burst} burst`
      );
    });

    this.resourcePool.on('pageCrashed', (data) => {
      this.addError(data.storeId, 'Browser page crashed', 'warning');
    });

    this.resourcePool.on('healthCheck', (data) => {
      if (data.unhealthy > 0) {
        this.addAlert(
          'resource',
          'error',
          `${data.unhealthy} unhealthy browsers detected`
        );
      }
    });

    // Queue events
    this.queueManager.on('storeMaxRetriesExceeded', (data) => {
      this.addAlert(
        'performance',
        'error',
        `Store ${data.store.name} exceeded maximum retry attempts`
      );
    });

    // Check for critical conditions
    setInterval(() => {
      this.checkCriticalConditions();
    }, 30000); // Every 30 seconds
  }

  /**
   * Add error to recent errors
   */
  private addError(storeId: string, message: string, severity: string): void {
    const error = {
      timestamp: new Date(),
      storeId,
      message,
      severity,
    };

    this.recentErrors.push(error);
    
    // Keep only last 50 errors
    if (this.recentErrors.length > 50) {
      this.recentErrors.shift();
    }

    this.emit('error', error);
  }

  /**
   * Record historical metrics
   */
  private recordHistoricalMetrics(): void {
    const metrics: HistoricalMetrics = {
      timestamp: new Date(),
      storesProcessed: this.metricsAccumulator.storesCompleted,
      customersProcessed: this.metricsAccumulator.totalCustomers,
      dncMarked: this.metricsAccumulator.dncMarked,
      successRate: this.metricsAccumulator.storesCompleted > 0
        ? (this.metricsAccumulator.storesCompleted / 
           (this.metricsAccumulator.storesCompleted + this.metricsAccumulator.storesFailed)) * 100
        : 0,
      averageProcessingTime: this.metricsAccumulator.processingTimes.length > 0
        ? this.metricsAccumulator.processingTimes.reduce((a, b) => a + b, 0) / 
          this.metricsAccumulator.processingTimes.length
        : 0,
      apiUsage: this.resourcePool.getUsageStats().api.requestsThisMinute,
      errors: this.metricsAccumulator.storesFailed,
    };

    this.historicalData.push(metrics);

    // Keep only last 7 days of data
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600000);
    this.historicalData = this.historicalData.filter(m => m.timestamp >= sevenDaysAgo);
  }

  /**
   * Check for critical conditions
   */
  private checkCriticalConditions(): void {
    const data = this.collectDashboardData();

    // Check resource utilization
    if (data.resources.browsers.utilization > 90) {
      this.addAlert(
        'resource',
        'warning',
        `Browser pool utilization high: ${data.resources.browsers.utilization.toFixed(1)}%`
      );
    }

    // Check failure rate
    if (data.performance.successRate < 80 && data.stores.completed > 5) {
      this.addAlert(
        'performance',
        'critical',
        `Low success rate: ${data.performance.successRate.toFixed(1)}%`
      );
    }

    // Check compliance rate
    if (data.compliance.complianceRate < 10 && data.compliance.totalCustomersProcessed > 100) {
      this.addAlert(
        'compliance',
        'warning',
        `Low DNC compliance rate: ${data.compliance.complianceRate.toFixed(1)}%`
      );
    }

    // Check for stalled processing
    if (data.system.status === 'running' && 
        data.stores.processing === 0 && 
        data.stores.queued > 0) {
      this.addAlert(
        'system',
        'error',
        'Processing appears to be stalled with stores in queue'
      );
    }
  }

  /**
   * Export dashboard data as JSON
   */
  exportData(): string {
    const data = this.collectDashboardData();
    const historical = this.getHistoricalMetrics(24);
    
    return JSON.stringify({
      current: data,
      historical,
      exported: new Date(),
    }, null, 2);
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.stop();
    this.removeAllListeners();
    this.alerts.clear();
    this.recentErrors = [];
    this.historicalData = [];
  }
}