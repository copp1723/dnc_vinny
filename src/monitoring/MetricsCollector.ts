import { EventEmitter } from 'events';
import * as os from 'os';
import { performance } from 'perf_hooks';
import { logger } from '../../priority5-compliance/logger';

export interface SystemMetrics {
  timestamp: Date;
  cpu: {
    usage: number;
    loadAverage: number[];
    cores: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    percentage: number;
  };
  process: {
    uptime: number;
    pid: number;
    memoryUsage: NodeJS.MemoryUsage;
  };
}

export interface WorkflowMetrics {
  timestamp: Date;
  workflows: {
    active: number;
    completed: number;
    failed: number;
    queued: number;
    processing: number;
  };
  stores: {
    total: number;
    active: number;
    completed: number;
    failed: number;
  };
  tasks: {
    total: number;
    dnc_marked: number;
    dnc_checked: number;
    errors: number;
  };
  performance: {
    avgProcessingTime: number;
    successRate: number;
    throughput: number;
    apiLatency: number;
  };
}

export interface BrowserMetrics {
  timestamp: Date;
  browsers: {
    active: number;
    idle: number;
    total: number;
  };
  contexts: {
    active: number;
    total: number;
  };
  pages: {
    active: number;
    total: number;
  };
  memory: {
    estimated: number;
    perBrowser: number;
  };
}

export interface APIMetrics {
  timestamp: Date;
  requests: {
    total: number;
    success: number;
    failed: number;
    rateLimit: number;
  };
  quotas: {
    vauto: {
      used: number;
      limit: number;
      remaining: number;
      resetTime: Date;
    };
    cdk: {
      used: number;
      limit: number;
      remaining: number;
      resetTime: Date;
    };
  };
  latency: {
    min: number;
    max: number;
    avg: number;
    p95: number;
    p99: number;
  };
}

export interface MetricsSummary {
  system: SystemMetrics;
  workflow: WorkflowMetrics;
  browser: BrowserMetrics;
  api: APIMetrics;
}

export class MetricsCollector extends EventEmitter {
  private static instance: MetricsCollector;
  private collectionInterval: NodeJS.Timer | null = null;
  private metricsHistory: MetricsSummary[] = [];
  private maxHistorySize: number = 10080; // 7 days at 1-minute intervals
  
  // Counters
  private workflowCounters = {
    active: 0,
    completed: 0,
    failed: 0,
    queued: 0,
    processing: 0
  };
  
  private storeCounters = {
    total: 0,
    active: 0,
    completed: 0,
    failed: 0
  };
  
  private taskCounters = {
    total: 0,
    dnc_marked: 0,
    dnc_checked: 0,
    errors: 0
  };
  
  private apiCounters = {
    requests: { total: 0, success: 0, failed: 0, rateLimit: 0 },
    quotas: {
      vauto: { used: 0, limit: 1000, remaining: 1000, resetTime: new Date() },
      cdk: { used: 0, limit: 1000, remaining: 1000, resetTime: new Date() }
    }
  };
  
  private performanceMetrics = {
    processingTimes: [] as number[],
    apiLatencies: [] as number[],
    successCount: 0,
    totalCount: 0
  };
  
  private browserMetrics = {
    browsers: { active: 0, idle: 0, total: 0 },
    contexts: { active: 0, total: 0 },
    pages: { active: 0, total: 0 }
  };

  private constructor() {
    super();
  }

  public static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  public startCollection(intervalMs: number = 60000): void {
    if (this.collectionInterval) {
      this.stopCollection();
    }

    logger.info('Starting metrics collection', { intervalMs });
    
    // Collect immediately
    this.collectMetrics();
    
    // Set up interval collection
    this.collectionInterval = setInterval(() => {
      this.collectMetrics();
    }, intervalMs);
  }

  public stopCollection(): void {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
      logger.info('Stopped metrics collection');
    }
  }

  private async collectMetrics(): Promise<void> {
    const metrics: MetricsSummary = {
      system: this.collectSystemMetrics(),
      workflow: this.collectWorkflowMetrics(),
      browser: this.collectBrowserMetrics(),
      api: this.collectAPIMetrics()
    };

    // Add to history
    this.metricsHistory.push(metrics);
    
    // Trim history if needed
    if (this.metricsHistory.length > this.maxHistorySize) {
      this.metricsHistory = this.metricsHistory.slice(-this.maxHistorySize);
    }

    // Emit metrics
    this.emit('metrics', metrics);
    this.emit('metrics:system', metrics.system);
    this.emit('metrics:workflow', metrics.workflow);
    this.emit('metrics:browser', metrics.browser);
    this.emit('metrics:api', metrics.api);
  }

  private collectSystemMetrics(): SystemMetrics {
    const cpus = os.cpus();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    
    // Calculate CPU usage
    let totalIdle = 0;
    let totalTick = 0;
    
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    });
    
    const cpuUsage = 100 - ~~(100 * totalIdle / totalTick);

    return {
      timestamp: new Date(),
      cpu: {
        usage: cpuUsage,
        loadAverage: os.loadavg(),
        cores: cpus.length
      },
      memory: {
        total: totalMemory,
        used: usedMemory,
        free: freeMemory,
        percentage: (usedMemory / totalMemory) * 100
      },
      process: {
        uptime: process.uptime(),
        pid: process.pid,
        memoryUsage: process.memoryUsage()
      }
    };
  }

  private collectWorkflowMetrics(): WorkflowMetrics {
    const processingTimes = this.performanceMetrics.processingTimes;
    const avgProcessingTime = processingTimes.length > 0
      ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length
      : 0;
    
    const successRate = this.performanceMetrics.totalCount > 0
      ? (this.performanceMetrics.successCount / this.performanceMetrics.totalCount) * 100
      : 0;
    
    const throughput = this.calculateThroughput();
    
    const apiLatencies = this.performanceMetrics.apiLatencies;
    const avgApiLatency = apiLatencies.length > 0
      ? apiLatencies.reduce((a, b) => a + b, 0) / apiLatencies.length
      : 0;

    return {
      timestamp: new Date(),
      workflows: { ...this.workflowCounters },
      stores: { ...this.storeCounters },
      tasks: { ...this.taskCounters },
      performance: {
        avgProcessingTime,
        successRate,
        throughput,
        apiLatency: avgApiLatency
      }
    };
  }

  private collectBrowserMetrics(): BrowserMetrics {
    const estimatedMemoryPerBrowser = 100 * 1024 * 1024; // 100MB estimate
    const estimatedTotalMemory = this.browserMetrics.browsers.total * estimatedMemoryPerBrowser;

    return {
      timestamp: new Date(),
      browsers: { ...this.browserMetrics.browsers },
      contexts: { ...this.browserMetrics.contexts },
      pages: { ...this.browserMetrics.pages },
      memory: {
        estimated: estimatedTotalMemory,
        perBrowser: estimatedMemoryPerBrowser
      }
    };
  }

  private collectAPIMetrics(): APIMetrics {
    const latencies = this.performanceMetrics.apiLatencies.sort((a, b) => a - b);
    const p95Index = Math.floor(latencies.length * 0.95);
    const p99Index = Math.floor(latencies.length * 0.99);

    return {
      timestamp: new Date(),
      requests: { ...this.apiCounters.requests },
      quotas: { ...this.apiCounters.quotas },
      latency: {
        min: latencies.length > 0 ? latencies[0] : 0,
        max: latencies.length > 0 ? latencies[latencies.length - 1] : 0,
        avg: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
        p95: latencies.length > 0 ? latencies[p95Index] : 0,
        p99: latencies.length > 0 ? latencies[p99Index] : 0
      }
    };
  }

  private calculateThroughput(): number {
    const recentMetrics = this.metricsHistory.slice(-10); // Last 10 minutes
    if (recentMetrics.length < 2) return 0;
    
    const firstMetric = recentMetrics[0];
    const lastMetric = recentMetrics[recentMetrics.length - 1];
    const timeDiffMinutes = (lastMetric.workflow.timestamp.getTime() - firstMetric.workflow.timestamp.getTime()) / 60000;
    const tasksProcessed = lastMetric.workflow.tasks.total - firstMetric.workflow.tasks.total;
    
    return timeDiffMinutes > 0 ? tasksProcessed / timeDiffMinutes : 0;
  }

  // Update methods for external components to report metrics
  public recordWorkflowStart(): void {
    this.workflowCounters.active++;
    this.workflowCounters.queued--;
  }

  public recordWorkflowComplete(success: boolean): void {
    this.workflowCounters.active--;
    if (success) {
      this.workflowCounters.completed++;
      this.performanceMetrics.successCount++;
    } else {
      this.workflowCounters.failed++;
    }
    this.performanceMetrics.totalCount++;
  }

  public recordStoreProcessing(storeId: string, status: 'start' | 'complete' | 'fail'): void {
    switch (status) {
      case 'start':
        this.storeCounters.active++;
        break;
      case 'complete':
        this.storeCounters.active--;
        this.storeCounters.completed++;
        break;
      case 'fail':
        this.storeCounters.active--;
        this.storeCounters.failed++;
        break;
    }
  }

  public recordTask(type: 'dnc_marked' | 'dnc_checked' | 'error'): void {
    this.taskCounters.total++;
    switch (type) {
      case 'dnc_marked':
        this.taskCounters.dnc_marked++;
        break;
      case 'dnc_checked':
        this.taskCounters.dnc_checked++;
        break;
      case 'error':
        this.taskCounters.errors++;
        break;
    }
  }

  public recordAPIRequest(success: boolean, latency: number, rateLimited: boolean = false): void {
    this.apiCounters.requests.total++;
    if (success) {
      this.apiCounters.requests.success++;
    } else {
      this.apiCounters.requests.failed++;
    }
    if (rateLimited) {
      this.apiCounters.requests.rateLimit++;
    }
    
    this.performanceMetrics.apiLatencies.push(latency);
    // Keep only last 1000 latencies
    if (this.performanceMetrics.apiLatencies.length > 1000) {
      this.performanceMetrics.apiLatencies = this.performanceMetrics.apiLatencies.slice(-1000);
    }
  }

  public updateAPIQuota(service: 'vauto' | 'cdk', used: number, limit: number, resetTime: Date): void {
    this.apiCounters.quotas[service] = {
      used,
      limit,
      remaining: limit - used,
      resetTime
    };
  }

  public updateBrowserMetrics(metrics: Partial<typeof this.browserMetrics>): void {
    Object.assign(this.browserMetrics, metrics);
  }

  public recordProcessingTime(timeMs: number): void {
    this.performanceMetrics.processingTimes.push(timeMs);
    // Keep only last 1000 processing times
    if (this.performanceMetrics.processingTimes.length > 1000) {
      this.performanceMetrics.processingTimes = this.performanceMetrics.processingTimes.slice(-1000);
    }
  }

  public getLatestMetrics(): MetricsSummary | null {
    return this.metricsHistory.length > 0 
      ? this.metricsHistory[this.metricsHistory.length - 1]
      : null;
  }

  public getMetricsHistory(minutes: number = 60): MetricsSummary[] {
    const cutoffTime = Date.now() - (minutes * 60 * 1000);
    return this.metricsHistory.filter(m => 
      m.system.timestamp.getTime() >= cutoffTime
    );
  }

  public reset(): void {
    this.workflowCounters = {
      active: 0,
      completed: 0,
      failed: 0,
      queued: 0,
      processing: 0
    };
    
    this.storeCounters = {
      total: 0,
      active: 0,
      completed: 0,
      failed: 0
    };
    
    this.taskCounters = {
      total: 0,
      dnc_marked: 0,
      dnc_checked: 0,
      errors: 0
    };
    
    this.performanceMetrics = {
      processingTimes: [],
      apiLatencies: [],
      successCount: 0,
      totalCount: 0
    };
    
    this.metricsHistory = [];
  }
}

export default MetricsCollector.getInstance();