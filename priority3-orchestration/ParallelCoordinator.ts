import { Page } from 'playwright';

export interface WorkerState {
  id: string;
  status: 'idle' | 'working' | 'error' | 'completed';
  currentVehicle?: string;
  startTime?: Date;
  lastActivity?: Date;
  errorCount: number;
}

export interface CoordinatorState {
  totalWorkers: number;
  activeWorkers: number;
  completedVehicles: number;
  failedVehicles: number;
  startTime: Date;
  errors: string[];
}

export class ParallelCoordinator {
  private workers: Map<string, WorkerState> = new Map();
  private state: CoordinatorState;
  private config: any;
  private logger: any;
  private sessionCookies: any[] = [];

  constructor(config: any, logger: any) {
    this.config = config;
    this.logger = logger;
    this.state = {
      totalWorkers: 0,
      activeWorkers: 0,
      completedVehicles: 0,
      failedVehicles: 0,
      startTime: new Date(),
      errors: []
    };
  }

  /**
   * Inherit session from main page to worker
   */
  async inheritSession(workerPage: Page, workerId: string): Promise<void> {
    try {
      this.logger.info(`🔗 ${workerId}: Inheriting session...`);

      // If we have stored session cookies, apply them
      if (this.sessionCookies.length > 0) {
        await workerPage.context().addCookies(this.sessionCookies);
        this.logger.info(`✅ ${workerId}: Applied ${this.sessionCookies.length} session cookies`);
      }

      // Navigate to inventory page to verify session
      const inventoryUrl = await this.getInventoryUrl(workerPage);
      await workerPage.goto(inventoryUrl);
      await workerPage.waitForLoadState('networkidle');

      // Verify we're logged in
      const isLoggedIn = await this.verifyLogin(workerPage);
      if (!isLoggedIn) {
        throw new Error('Session inheritance failed - not logged in');
      }

      this.logger.info(`✅ ${workerId}: Session inherited successfully`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`❌ ${workerId}: Session inheritance failed: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Store session cookies from main page
   */
  async storeSession(mainPage: Page): Promise<void> {
    try {
      this.sessionCookies = await mainPage.context().cookies();
      this.logger.info(`📦 Stored ${this.sessionCookies.length} session cookies for workers`);
    } catch (error) {
      this.logger.warn('Failed to store session cookies:', error);
    }
  }

  /**
   * Register worker with coordinator
   */
  registerWorker(workerId: string): void {
    this.workers.set(workerId, {
      id: workerId,
      status: 'idle',
      errorCount: 0
    });
    this.state.totalWorkers++;
    this.logger.info(`📋 Registered worker: ${workerId}`);
  }

  /**
   * Update worker status
   */
  updateWorkerStatus(workerId: string, status: WorkerState['status'], currentVehicle?: string): void {
    const worker = this.workers.get(workerId);
    if (worker) {
      const previousStatus = worker.status;
      worker.status = status;
      worker.currentVehicle = currentVehicle;
      worker.lastActivity = new Date();

      if (status === 'working' && previousStatus !== 'working') {
        worker.startTime = new Date();
        this.state.activeWorkers++;
      } else if (status !== 'working' && previousStatus === 'working') {
        this.state.activeWorkers--;
      }

      if (status === 'completed') {
        this.state.completedVehicles++;
      } else if (status === 'error') {
        worker.errorCount++;
        this.state.failedVehicles++;
      }
    }
  }

  /**
   * Handle worker error with recovery strategy
   */
  async handleWorkerError(workerId: string, error: string, page?: Page): Promise<boolean> {
    const worker = this.workers.get(workerId);
    if (!worker) return false;

    worker.errorCount++;
    this.state.errors.push(`${workerId}: ${error}`);
    
    this.logger.warn(`⚠️ ${workerId}: Error occurred (count: ${worker.errorCount}): ${error}`);

    // Check if worker should be retired due to too many errors
    if (worker.errorCount >= 3) {
      this.logger.error(`❌ ${workerId}: Too many errors, retiring worker`);
      worker.status = 'error';
      return false;
    }

    // Attempt recovery
    if (page) {
      try {
        this.logger.info(`🔄 ${workerId}: Attempting recovery...`);
        
        // Try to navigate back to inventory
        const inventoryUrl = await this.getInventoryUrl(page);
        await page.goto(inventoryUrl);
        await page.waitForLoadState('networkidle');
        
        // Verify recovery
        const isRecovered = await this.verifyLogin(page);
        if (isRecovered) {
          this.logger.info(`✅ ${workerId}: Recovery successful`);
          worker.status = 'idle';
          return true;
        }
      } catch (recoveryError) {
        this.logger.error(`❌ ${workerId}: Recovery failed:`, recoveryError);
      }
    }

    return false;
  }

  /**
   * Get current coordinator state
   */
  getState(): CoordinatorState {
    return { ...this.state };
  }

  /**
   * Get worker states
   */
  getWorkerStates(): WorkerState[] {
    return Array.from(this.workers.values());
  }

  /**
   * Check if processing should continue based on error threshold
   */
  shouldContinueProcessing(): boolean {
    const totalProcessed = this.state.completedVehicles + this.state.failedVehicles;
    if (totalProcessed === 0) return true;

    const errorRate = this.state.failedVehicles / totalProcessed;
    return errorRate < this.config.errorThreshold;
  }

  /**
   * Get inventory URL from current page
   */
  private async getInventoryUrl(page: Page): Promise<string> {
    try {
      const currentUrl = page.url();
      const url = new URL(currentUrl);
      return `${url.protocol}//${url.hostname}/Va/Inventory/`;
    } catch (error) {
      // Fallback URL
      return 'https://app.vauto.com/Va/Inventory/';
    }
  }

  /**
   * Verify user is logged in
   */
  private async verifyLogin(page: Page): Promise<boolean> {
    try {
      // Check for common logged-in indicators
      const indicators = [
        '//a[contains(text(), "Logout")]',
        '//div[contains(@class, "user-menu")]',
        '//span[contains(@class, "username")]',
        '//*[@id="GaugePageIFrame"]'
      ];

      for (const indicator of indicators) {
        try {
          const element = await page.locator(indicator).first();
          if (await element.isVisible({ timeout: 5000 })) {
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      // Check URL patterns
      const url = page.url();
      if (url.includes('/Va/') || url.includes('/inventory') || url.includes('/dashboard')) {
        return true;
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Generate processing report
   */
  generateReport(): string {
    const duration = Date.now() - this.state.startTime.getTime();
    const workers = Array.from(this.workers.values());
    
    return [
      '=== PARALLEL PROCESSING REPORT ===',
      `Duration: ${(duration / 1000).toFixed(2)} seconds`,
      `Workers: ${this.state.totalWorkers} total, ${this.state.activeWorkers} active`,
      `Vehicles: ${this.state.completedVehicles} completed, ${this.state.failedVehicles} failed`,
      `Success Rate: ${((this.state.completedVehicles / (this.state.completedVehicles + this.state.failedVehicles)) * 100).toFixed(1)}%`,
      '',
      '=== WORKER STATUS ===',
      ...workers.map(w => `${w.id}: ${w.status} (errors: ${w.errorCount})`),
      '',
      '=== ERRORS ===',
      ...this.state.errors.slice(-5) // Last 5 errors
    ].join('\n');
  }

  /**
   * Cleanup coordinator resources
   */
  async cleanup(): Promise<void> {
    this.workers.clear();
    this.sessionCookies = [];
    this.logger.info('🧹 Coordinator cleanup completed');
  }
}