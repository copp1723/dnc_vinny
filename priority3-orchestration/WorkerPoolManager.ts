import { Browser, BrowserContext } from 'playwright';

export interface WorkerContext {
  id: string;
  context: BrowserContext;
  inUse: boolean;
  createdAt: Date;
  lastUsed: Date;
}

export class WorkerPoolManager {
  private browser: Browser | null = null;
  private workers: Map<string, WorkerContext> = new Map();
  private config: any;
  private logger: any;

  constructor(config: any, logger: any) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Initialize worker pool with browser contexts
   */
  async initialize(browser: Browser): Promise<void> {
    this.browser = browser;
    this.logger.info(`🏭 Initializing worker pool with ${this.config.maxConcurrency} workers`);

    // Pre-create worker contexts
    for (let i = 0; i < this.config.maxConcurrency; i++) {
      const workerId = `worker-${i + 1}`;
      await this.createWorkerContext(workerId);
    }

    this.logger.info(`✅ Worker pool initialized with ${this.workers.size} contexts`);
  }

  /**
   * Get an available worker context
   */
  async getWorkerContext(workerId: string): Promise<BrowserContext> {
    let worker = this.workers.get(workerId);
    
    if (!worker) {
      // Create new worker if doesn't exist
      worker = await this.createWorkerContext(workerId);
    }

    if (worker.inUse) {
      throw new Error(`Worker ${workerId} is already in use`);
    }

    // Mark as in use
    worker.inUse = true;
    worker.lastUsed = new Date();
    
    this.logger.info(`📋 Assigned worker context: ${workerId}`);
    return worker.context;
  }

  /**
   * Release worker context back to pool
   */
  async releaseWorkerContext(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    
    if (worker) {
      worker.inUse = false;
      worker.lastUsed = new Date();
      this.logger.info(`🔄 Released worker context: ${workerId}`);
    }
  }

  /**
   * Create isolated browser context for worker
   */
  private async createWorkerContext(workerId: string): Promise<WorkerContext> {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    try {
      // Create isolated context with session inheritance
      const context = await this.browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });

      // Set timeouts
      context.setDefaultTimeout(this.config.workerTimeout);

      const worker: WorkerContext = {
        id: workerId,
        context,
        inUse: false,
        createdAt: new Date(),
        lastUsed: new Date()
      };

      this.workers.set(workerId, worker);
      this.logger.info(`🔧 Created worker context: ${workerId}`);
      
      return worker;

    } catch (error) {
      this.logger.error(`❌ Failed to create worker context ${workerId}:`, error);
      throw error;
    }
  }

  /**
   * Get worker pool status
   */
  getPoolStatus(): { total: number; inUse: number; available: number } {
    const total = this.workers.size;
    const inUse = Array.from(this.workers.values()).filter(w => w.inUse).length;
    const available = total - inUse;

    return { total, inUse, available };
  }

  /**
   * Cleanup all worker contexts
   */
  async cleanup(): Promise<void> {
    this.logger.info('🧹 Cleaning up worker pool...');

    const cleanupPromises: Promise<void>[] = [];

    for (const [workerId, worker] of this.workers) {
      cleanupPromises.push(
        worker.context.close().catch(error => {
          this.logger.warn(`Failed to close worker ${workerId}:`, error);
        })
      );
    }

    await Promise.allSettled(cleanupPromises);
    this.workers.clear();
    
    this.logger.info('✅ Worker pool cleanup completed');
  }

  /**
   * Health check for worker contexts
   */
  async healthCheck(): Promise<{ healthy: string[]; unhealthy: string[] }> {
    const healthy: string[] = [];
    const unhealthy: string[] = [];

    for (const [workerId, worker] of this.workers) {
      try {
        // Test if context is still responsive
        const page = await worker.context.newPage();
        await page.goto('about:blank');
        await page.close();
        healthy.push(workerId);
      } catch (error) {
        unhealthy.push(workerId);
        this.logger.warn(`Worker ${workerId} failed health check:`, error);
      }
    }

    return { healthy, unhealthy };
  }
}