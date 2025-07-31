import { EventEmitter } from 'events';
import { Browser, chromium, Page, BrowserContext } from 'playwright';
import { logger } from '../../priority5-compliance/logger';

export interface ResourcePoolConfig {
  maxBrowsers: number;
  maxApiRequests: number;
  burstLimit: number;
  browserTimeout?: number;
  contextOptions?: {
    viewport?: { width: number; height: number };
    userAgent?: string;
    locale?: string;
    timezoneId?: string;
  };
}

export interface ResourceAllocation {
  storeId: string;
  browsers: Browser[];
  contexts: BrowserContext[];
  pages: Page[];
  apiQuota: number;
  allocatedAt: Date;
}

export interface ApiRateLimiter {
  requests: number;
  windowStart: Date;
  burst: number;
}

export interface ResourceUsageStats {
  browsers: {
    total: number;
    allocated: number;
    available: number;
    utilization: number;
  };
  api: {
    requestsThisMinute: number;
    remainingQuota: number;
    utilizationRate: number;
  };
  allocations: {
    active: number;
    byStore: Record<string, {
      browsers: number;
      apiQuota: number;
      duration: number;
    }>;
  };
  performance: {
    averageAllocationTime: number;
    averageReleaseTime: number;
    browserCrashes: number;
    apiThrottles: number;
  };
}

export class ResourcePoolManager extends EventEmitter {
  private config: ResourcePoolConfig;
  private browserPool: Browser[] = [];
  private availableBrowsers: Set<Browser> = new Set();
  private allocations: Map<string, ResourceAllocation> = new Map();
  private apiRateLimiter: ApiRateLimiter;
  private performanceMetrics = {
    allocationTimes: [] as number[],
    releaseTimes: [] as number[],
    browserCrashes: 0,
    apiThrottles: 0,
  };
  private isInitialized: boolean = false;

  constructor(config: ResourcePoolConfig) {
    super();
    this.config = config;
    this.apiRateLimiter = {
      requests: 0,
      windowStart: new Date(),
      burst: 0,
    };
  }

  /**
   * Initialize the resource pool
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Resource pool is already initialized');
      return;
    }

    logger.info('🚀 Initializing resource pool...');

    try {
      // Create browser instances
      const browserPromises: Promise<Browser>[] = [];
      for (let i = 0; i < this.config.maxBrowsers; i++) {
        browserPromises.push(this.createBrowser(i));
      }

      this.browserPool = await Promise.all(browserPromises);
      this.availableBrowsers = new Set(this.browserPool);

      // Set up monitoring
      this.startMonitoring();

      this.isInitialized = true;
      logger.info(`✅ Resource pool initialized with ${this.browserPool.length} browsers`);
      this.emit('initialized', { browsers: this.browserPool.length });

    } catch (error) {
      logger.error('Failed to initialize resource pool:', error);
      throw error;
    }
  }

  /**
   * Acquire resources for a store
   */
  async acquireResources(storeId: string, requirements: {
    browsers: number;
    apiQuota: number;
  }): Promise<ResourceAllocation> {
    const startTime = Date.now();

    if (!this.isInitialized) {
      throw new Error('Resource pool not initialized');
    }

    // Check if store already has allocation
    if (this.allocations.has(storeId)) {
      throw new Error(`Store ${storeId} already has resource allocation`);
    }

    logger.info(`🔒 Acquiring resources for store ${storeId}: ${requirements.browsers} browsers, ${requirements.apiQuota} API quota`);

    // Wait for available browsers
    const browsers = await this.acquireBrowsers(requirements.browsers);
    
    // Check API quota
    const apiQuota = await this.acquireApiQuota(requirements.apiQuota);

    // Create contexts and pages
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];

    try {
      for (const browser of browsers) {
        const context = await browser.newContext(this.config.contextOptions || {});
        contexts.push(context);

        const page = await context.newPage();
        pages.push(page);

        // Set up error handling
        page.on('crash', () => this.handlePageCrash(storeId, page));
        page.on('pageerror', error => this.handlePageError(storeId, error));
      }

      const allocation: ResourceAllocation = {
        storeId,
        browsers,
        contexts,
        pages,
        apiQuota,
        allocatedAt: new Date(),
      };

      this.allocations.set(storeId, allocation);

      const allocationTime = Date.now() - startTime;
      this.performanceMetrics.allocationTimes.push(allocationTime);

      logger.info(`✅ Resources acquired for store ${storeId} in ${allocationTime}ms`);
      this.emit('resourcesAcquired', { storeId, browsers: browsers.length, apiQuota });

      return allocation;

    } catch (error) {
      // Clean up on failure
      for (const browser of browsers) {
        this.availableBrowsers.add(browser);
      }
      throw error;
    }
  }

  /**
   * Release resources for a store
   */
  async releaseResources(storeId: string): Promise<void> {
    const startTime = Date.now();
    const allocation = this.allocations.get(storeId);

    if (!allocation) {
      logger.warn(`No allocation found for store ${storeId}`);
      return;
    }

    logger.info(`🔓 Releasing resources for store ${storeId}`);

    try {
      // Close pages and contexts
      for (const page of allocation.pages) {
        try {
          await page.close();
        } catch (error) {
          logger.warn(`Failed to close page for store ${storeId}:`, error);
        }
      }

      for (const context of allocation.contexts) {
        try {
          await context.close();
        } catch (error) {
          logger.warn(`Failed to close context for store ${storeId}:`, error);
        }
      }

      // Return browsers to pool
      for (const browser of allocation.browsers) {
        if (browser.isConnected()) {
          this.availableBrowsers.add(browser);
        } else {
          // Replace crashed browser
          logger.warn(`Browser disconnected for store ${storeId}, creating replacement`);
          await this.replaceBrowser(browser);
        }
      }

      // Release API quota is automatic (time-based)

      this.allocations.delete(storeId);

      const releaseTime = Date.now() - startTime;
      this.performanceMetrics.releaseTimes.push(releaseTime);

      logger.info(`✅ Resources released for store ${storeId} in ${releaseTime}ms`);
      this.emit('resourcesReleased', { storeId, releaseTime });

    } catch (error) {
      logger.error(`Failed to release resources for store ${storeId}:`, error);
      // Still remove allocation to prevent resource leak
      this.allocations.delete(storeId);
    }
  }

  /**
   * Get current usage statistics
   */
  getUsageStats(): ResourceUsageStats {
    const allocatedBrowsers = this.browserPool.length - this.availableBrowsers.size;
    
    // Calculate API usage
    this.updateApiWindow();
    const apiUtilization = this.config.maxApiRequests > 0
      ? (this.apiRateLimiter.requests / this.config.maxApiRequests) * 100
      : 0;

    // Calculate allocation details
    const byStore: Record<string, any> = {};
    for (const [storeId, allocation] of this.allocations) {
      byStore[storeId] = {
        browsers: allocation.browsers.length,
        apiQuota: allocation.apiQuota,
        duration: Date.now() - allocation.allocatedAt.getTime(),
      };
    }

    // Calculate averages
    const avgAllocationTime = this.performanceMetrics.allocationTimes.length > 0
      ? this.performanceMetrics.allocationTimes.reduce((a, b) => a + b, 0) / this.performanceMetrics.allocationTimes.length
      : 0;

    const avgReleaseTime = this.performanceMetrics.releaseTimes.length > 0
      ? this.performanceMetrics.releaseTimes.reduce((a, b) => a + b, 0) / this.performanceMetrics.releaseTimes.length
      : 0;

    return {
      browsers: {
        total: this.browserPool.length,
        allocated: allocatedBrowsers,
        available: this.availableBrowsers.size,
        utilization: (allocatedBrowsers / this.browserPool.length) * 100,
      },
      api: {
        requestsThisMinute: this.apiRateLimiter.requests,
        remainingQuota: Math.max(0, this.config.maxApiRequests - this.apiRateLimiter.requests),
        utilizationRate: apiUtilization,
      },
      allocations: {
        active: this.allocations.size,
        byStore,
      },
      performance: {
        averageAllocationTime: avgAllocationTime,
        averageReleaseTime: avgReleaseTime,
        browserCrashes: this.performanceMetrics.browserCrashes,
        apiThrottles: this.performanceMetrics.apiThrottles,
      },
    };
  }

  /**
   * Check if API request can be made
   */
  async checkApiAvailability(count: number = 1): Promise<boolean> {
    this.updateApiWindow();
    
    if (this.apiRateLimiter.requests + count > this.config.maxApiRequests) {
      // Check burst allowance
      if (this.apiRateLimiter.burst + count <= this.config.burstLimit) {
        return true;
      }
      return false;
    }
    
    return true;
  }

  /**
   * Record API request
   */
  recordApiRequest(count: number = 1): void {
    this.updateApiWindow();
    
    this.apiRateLimiter.requests += count;
    
    if (this.apiRateLimiter.requests > this.config.maxApiRequests) {
      const overflow = this.apiRateLimiter.requests - this.config.maxApiRequests;
      this.apiRateLimiter.burst += overflow;
      
      if (this.apiRateLimiter.burst > this.config.burstLimit) {
        this.performanceMetrics.apiThrottles++;
        this.emit('apiThrottled', { 
          requests: this.apiRateLimiter.requests,
          burst: this.apiRateLimiter.burst,
        });
      }
    }
  }

  /**
   * Acquire browsers from pool
   */
  private async acquireBrowsers(count: number): Promise<Browser[]> {
    const acquired: Browser[] = [];
    const maxWaitTime = 60000; // 1 minute
    const startTime = Date.now();

    while (acquired.length < count) {
      // Check timeout
      if (Date.now() - startTime > maxWaitTime) {
        // Return what we acquired so far
        for (const browser of acquired) {
          this.availableBrowsers.add(browser);
        }
        throw new Error(`Timeout waiting for ${count} browsers (acquired ${acquired.length})`);
      }

      // Try to acquire available browsers
      for (const browser of this.availableBrowsers) {
        if (acquired.length >= count) break;
        
        if (browser.isConnected()) {
          this.availableBrowsers.delete(browser);
          acquired.push(browser);
        } else {
          // Remove disconnected browser
          this.availableBrowsers.delete(browser);
          this.browserPool = this.browserPool.filter(b => b !== browser);
          
          // Create replacement
          try {
            const newBrowser = await this.createBrowser(this.browserPool.length);
            this.browserPool.push(newBrowser);
            this.availableBrowsers.add(newBrowser);
          } catch (error) {
            logger.error('Failed to create replacement browser:', error);
          }
        }
      }

      // Wait if not enough browsers available
      if (acquired.length < count) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return acquired;
  }

  /**
   * Acquire API quota
   */
  private async acquireApiQuota(requested: number): Promise<number> {
    this.updateApiWindow();
    
    const available = Math.max(0, this.config.maxApiRequests - this.apiRateLimiter.requests);
    const granted = Math.min(requested, available);
    
    if (granted < requested && this.config.burstLimit > 0) {
      const burstAvailable = Math.max(0, this.config.burstLimit - this.apiRateLimiter.burst);
      const additionalFromBurst = Math.min(requested - granted, burstAvailable);
      return granted + additionalFromBurst;
    }
    
    return granted;
  }

  /**
   * Create a new browser instance
   */
  private async createBrowser(index: number): Promise<Browser> {
    try {
      const browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
        ],
      });

      browser.on('disconnected', () => {
        logger.warn(`Browser ${index} disconnected`);
        this.performanceMetrics.browserCrashes++;
      });

      return browser;
    } catch (error) {
      logger.error(`Failed to create browser ${index}:`, error);
      throw error;
    }
  }

  /**
   * Replace a crashed browser
   */
  private async replaceBrowser(crashedBrowser: Browser): Promise<void> {
    try {
      // Remove from pools
      this.browserPool = this.browserPool.filter(b => b !== crashedBrowser);
      this.availableBrowsers.delete(crashedBrowser);

      // Try to close if still connected
      if (crashedBrowser.isConnected()) {
        try {
          await crashedBrowser.close();
        } catch (error) {
          // Ignore close errors
        }
      }

      // Create replacement
      const newBrowser = await this.createBrowser(this.browserPool.length);
      this.browserPool.push(newBrowser);
      this.availableBrowsers.add(newBrowser);

      logger.info('✅ Replaced crashed browser');
    } catch (error) {
      logger.error('Failed to replace crashed browser:', error);
    }
  }

  /**
   * Update API rate limiter window
   */
  private updateApiWindow(): void {
    const now = new Date();
    const windowAge = now.getTime() - this.apiRateLimiter.windowStart.getTime();
    
    // Reset window every minute
    if (windowAge >= 60000) {
      this.apiRateLimiter.requests = 0;
      this.apiRateLimiter.burst = 0;
      this.apiRateLimiter.windowStart = now;
    }
  }

  /**
   * Handle page crash
   */
  private handlePageCrash(storeId: string, page: Page): void {
    logger.error(`Page crashed for store ${storeId}`);
    this.performanceMetrics.browserCrashes++;
    this.emit('pageCrashed', { storeId });
  }

  /**
   * Handle page error
   */
  private handlePageError(storeId: string, error: Error): void {
    logger.error(`Page error for store ${storeId}:`, error.message);
    this.emit('pageError', { storeId, error: error.message });
  }

  /**
   * Start resource monitoring
   */
  private startMonitoring(): void {
    // Monitor browser health every 30 seconds
    setInterval(() => {
      let healthyCount = 0;
      let unhealthyCount = 0;

      for (const browser of this.browserPool) {
        if (browser.isConnected()) {
          healthyCount++;
        } else {
          unhealthyCount++;
        }
      }

      if (unhealthyCount > 0) {
        logger.warn(`Browser health check: ${healthyCount} healthy, ${unhealthyCount} unhealthy`);
        this.emit('healthCheck', { healthy: healthyCount, unhealthy: unhealthyCount });
      }

      // Clean up old performance metrics
      const fiveMinutesAgo = Date.now() - 300000;
      this.performanceMetrics.allocationTimes = this.performanceMetrics.allocationTimes.slice(-100);
      this.performanceMetrics.releaseTimes = this.performanceMetrics.releaseTimes.slice(-100);

    }, 30000);
  }

  /**
   * Clean up all resources
   */
  async cleanup(): Promise<void> {
    logger.info('🧹 Cleaning up resource pool...');

    // Release all allocations
    const storeIds = Array.from(this.allocations.keys());
    for (const storeId of storeIds) {
      await this.releaseResources(storeId);
    }

    // Close all browsers
    const closePromises: Promise<void>[] = [];
    for (const browser of this.browserPool) {
      if (browser.isConnected()) {
        closePromises.push(browser.close().catch(error => {
          logger.warn('Failed to close browser during cleanup:', error);
        }));
      }
    }

    await Promise.all(closePromises);

    this.browserPool = [];
    this.availableBrowsers.clear();
    this.allocations.clear();
    this.isInitialized = false;

    logger.info('✅ Resource pool cleaned up');
    this.removeAllListeners();
  }
}