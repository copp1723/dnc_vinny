// server/monitoring/performance.ts - System performance monitoring
import { browserPool } from '../automation/browser-pool';
import { logger } from '../utils/logger';
import { getDb } from '../database';
import os from 'os';
import { webSocketManager } from '../websocket';
import { ClientType } from '../websocket-interfaces';

// Performance metric types
interface SystemMetrics {
  cpuUsage: number;
  memoryUsage: number;
  totalMemory: number;
  freeMemory: number;
  uptime: number;
  loadAverage: number[];
}

interface ApplicationMetrics {
  activeTasks: number;
  pendingTasks: number;
  failedTasks: number;
  successfulTasks: number;
  apiRequests: number;
  apiResponseTime: number;
  websocketConnections: number;
  databaseQueries: number;
  databaseResponseTime: number;
  errorCount: number;
  errorsByType: Record<string, number>;
}

interface BrowserMetrics {
  browsers: number;
  contexts: number;
  pages: number;
  memoryUsage: number;
}

interface PerformanceMetrics {
  timestamp: string;
  system: SystemMetrics;
  application: ApplicationMetrics;
  browser: BrowserMetrics;
}

// Performance monitor class
class PerformanceMonitor {
  private isInitialized: boolean = false;
  private metricsInterval: NodeJS.Timeout | null = null;
  private metrics: PerformanceMetrics = this.createEmptyMetrics();
  private apiRequests: number = 0;
  private apiResponseTimes: number[] = [];
  private databaseQueries: number = 0;
  private databaseResponseTimes: number[] = [];
  private errorCounts: Record<string, number> = {};
  
  /**
   * Initialize performance monitoring
   */
  initialize(): void {
    if (this.isInitialized) {
      return;
    }
    
    // Start collecting metrics every 5 seconds
    this.metricsInterval = setInterval(() => {
      this.collectMetrics()
        .catch(error => {
          logger.error(`Error collecting performance metrics: ${error.message}`, { error });
        });
    }, 5000);
    
    this.isInitialized = true;
    logger.info('Performance monitoring initialized');
  }
  
  /**
   * Create empty metrics object
   */
  private createEmptyMetrics(): PerformanceMetrics {
    return {
      timestamp: new Date().toISOString(),
      system: {
        cpuUsage: 0,
        memoryUsage: 0,
        totalMemory: 0,
        freeMemory: 0,
        uptime: 0,
        loadAverage: []
      },
      application: {
        activeTasks: 0,
        pendingTasks: 0,
        failedTasks: 0,
        successfulTasks: 0,
        apiRequests: 0,
        apiResponseTime: 0,
        websocketConnections: 0,
        databaseQueries: 0,
        databaseResponseTime: 0,
        errorCount: 0,
        errorsByType: {}
      },
      browser: {
        browsers: 0,
        contexts: 0,
        pages: 0,
        memoryUsage: 0
      }
    };
  }
  
  /**
   * Collect performance metrics
   */
  private async collectMetrics(): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      
      // Collect system metrics
      const systemMetrics = this.collectSystemMetrics();
      
      // Collect application metrics
      const applicationMetrics = await this.collectApplicationMetrics();
      
      // Collect browser metrics
      const browserMetrics = await this.collectBrowserMetrics();
      
      // Update metrics
      this.metrics = {
        timestamp,
        system: systemMetrics,
        application: applicationMetrics,
        browser: browserMetrics
      };
      
      // Broadcast metrics to connected clients
      this.broadcastMetrics();
      
      // Reset counters
      this.resetCounters();
      
    } catch (error: any) {
      logger.error(`Error collecting metrics: ${error.message}`, { error });
    }
  }
  
  /**
   * Collect system metrics
   */
  private collectSystemMetrics(): SystemMetrics {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const memoryUsage = ((totalMemory - freeMemory) / totalMemory) * 100;
    
    // Get CPU usage (average across all cores)
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    });
    
    const cpuUsage = 100 - (totalIdle / totalTick) * 100;
    
    return {
      cpuUsage,
      memoryUsage,
      totalMemory,
      freeMemory,
      uptime: os.uptime(),
      loadAverage: os.loadavg()
    };
  }
  
  /**
   * Collect application metrics
   */
  private async collectApplicationMetrics(): Promise<ApplicationMetrics> {
    // Get task counts (placeholder - would be replaced with actual DB queries)
    const taskCounts = {
      active: 0,
      pending: 0,
      failed: 0,
      successful: 0
    };
    
    // Calculate average API response time
    const avgApiResponseTime = this.apiResponseTimes.length
      ? this.apiResponseTimes.reduce((sum, time) => sum + time, 0) / this.apiResponseTimes.length
      : 0;
    
    // Calculate average database response time
    const avgDbResponseTime = this.databaseResponseTimes.length
      ? this.databaseResponseTimes.reduce((sum, time) => sum + time, 0) / this.databaseResponseTimes.length
      : 0;
    
    // Count total errors
    const totalErrors = Object.values(this.errorCounts).reduce((sum, count) => sum + count, 0);
    
    return {
      activeTasks: taskCounts.active,
      pendingTasks: taskCounts.pending,
      failedTasks: taskCounts.failed,
      successfulTasks: taskCounts.successful,
      apiRequests: this.apiRequests,
      apiResponseTime: avgApiResponseTime,
      websocketConnections: webSocketManager.getConnectionCount(),
      databaseQueries: this.databaseQueries,
      databaseResponseTime: avgDbResponseTime,
      errorCount: totalErrors,
      errorsByType: { ...this.errorCounts }
    };
  }
  
  /**
   * Collect browser metrics
   */
  private async collectBrowserMetrics(): Promise<BrowserMetrics> {
    try {
      const stats = await browserPool.getStats();
      
      return {
        browsers: stats.browserCount,
        contexts: stats.contextCount,
        pages: stats.pageCount,
        memoryUsage: stats.estimatedMemoryUsage
      };
    } catch (error) {
      // If browser pool is not available, return zeros
      return {
        browsers: 0,
        contexts: 0,
        pages: 0,
        memoryUsage: 0
      };
    }
  }
  
  /**
   * Reset counters after collecting metrics
   */
  private resetCounters(): void {
    this.apiRequests = 0;
    this.apiResponseTimes = [];
    this.databaseQueries = 0;
    this.databaseResponseTimes = [];
    this.errorCounts = {};
  }
  
  /**
   * Broadcast metrics to connected clients
   */
  private broadcastMetrics(): void {
    webSocketManager.broadcast({
      type: 'performance_metrics',
      data: this.metrics,
      timestamp: this.metrics.timestamp
    }, ClientType.DASHBOARD);
  }
  
  /**
   * Track API request
   * @param responseTime Response time in milliseconds
   */
  trackApiRequest(responseTime: number): void {
    this.apiRequests++;
    if (responseTime > 0) {
      this.apiResponseTimes.push(responseTime);
    }
  }
  
  /**
   * Track database query
   * @param responseTime Response time in milliseconds
   */
  trackDatabaseQuery(responseTime: number): void {
    this.databaseQueries++;
    this.databaseResponseTimes.push(responseTime);
  }
  
  /**
   * Track error
   * @param errorType Type of error
   */
  trackError(errorType: string): void {
    if (!this.errorCounts[errorType]) {
      this.errorCounts[errorType] = 0;
    }
    this.errorCounts[errorType]++;
  }
  
  /**
   * Get current metrics
   */
  async getMetrics(): Promise<PerformanceMetrics> {
    return { ...this.metrics };
  }
  
  /**
   * Get metrics history
   * @param duration Duration in minutes
   */
  async getMetricsHistory(duration: number = 60): Promise<PerformanceMetrics[]> {
    try {
      // This would typically query the database for historical metrics
      // Will be implemented when database connection is available
      return [];
    } catch (error: any) {
      logger.error(`Error getting metrics history: ${error.message}`, { error });
      return [];
    }
  }
  
  /**
   * Aggregate metrics and store in database
   */
  async aggregateMetrics(): Promise<void> {
    try {
      // Get current metrics
      const metrics = await this.getMetrics();
      
      // Store metrics in database
      // Will be implemented when database connection is available
      
      logger.debug('Metrics aggregated and stored');
    } catch (error: any) {
      logger.error(`Error aggregating metrics: ${error.message}`, { error });
    }
  }
  
  /**
   * Get alerts based on thresholds
   */
  async getAlerts(): Promise<any[]> {
    const metrics = await this.getMetrics();
    const alerts = [];
    
    // CPU usage alert
    if (metrics.system.cpuUsage > 80) {
      alerts.push({
        type: 'cpu_usage',
        level: 'warning',
        message: `High CPU usage: ${metrics.system.cpuUsage.toFixed(1)}%`,
        value: metrics.system.cpuUsage,
        threshold: 80,
        timestamp: metrics.timestamp
      });
    }
    
    // Memory usage alert
    if (metrics.system.memoryUsage > 85) {
      alerts.push({
        type: 'memory_usage',
        level: 'warning',
        message: `High memory usage: ${metrics.system.memoryUsage.toFixed(1)}%`,
        value: metrics.system.memoryUsage,
        threshold: 85,
        timestamp: metrics.timestamp
      });
    }
    
    // Error count alert
    if (metrics.application.errorCount > 50) {
      alerts.push({
        type: 'error_count',
        level: 'error',
        message: `High error count: ${metrics.application.errorCount}`,
        value: metrics.application.errorCount,
        threshold: 50,
        timestamp: metrics.timestamp
      });
    }
    
    // Failed tasks alert
    if (metrics.application.failedTasks > 20) {
      alerts.push({
        type: 'failed_tasks',
        level: 'error',
        message: `High failed task count: ${metrics.application.failedTasks}`,
        value: metrics.application.failedTasks,
        threshold: 20,
        timestamp: metrics.timestamp
      });
    }
    
    return alerts;
  }
  
  /**
   * Shutdown performance monitoring
   */
  shutdown(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
    
    this.isInitialized = false;
    logger.info('Performance monitoring shut down');
  }
}

// Export singleton instance
export const performanceMonitor = new PerformanceMonitor();