import { createConfigManager, ConfigManager } from './config';
import { DealershipConfig } from './config/schemas';

/**
 * DNC VINNY - Main Application Entry Point
 */
class DNCVinnyApp {
  private configManager: ConfigManager;
  private isRunning: boolean = false;

  constructor(private options: {
    configPath?: string;
    masterPassword?: string;
  }) {}

  /**
   * Initialize the application
   */
  async initialize(): Promise<void> {
    console.log('🚀 Starting DNC VINNY...\n');

    // Initialize configuration
    this.configManager = await createConfigManager({
      configPath: this.options.configPath,
      masterPassword: this.options.masterPassword
    });

    // Set up event handlers
    this.setupEventHandlers();

    // Validate configuration
    const validation = this.configManager.validate();
    if (!validation.valid) {
      throw new Error(`Configuration validation failed: ${JSON.stringify(validation.errors)}`);
    }

    console.log('✅ Configuration loaded and validated\n');
  }

  /**
   * Set up configuration event handlers
   */
  private setupEventHandlers(): void {
    this.configManager.on('updated', (event) => {
      console.log(`📝 Configuration updated: ${JSON.stringify(event)}`);
    });

    this.configManager.on('error', (error) => {
      console.error(`❌ Configuration error: ${error.message}`);
    });

    this.configManager.on('healthCheck', (results) => {
      console.log('🏥 Health check completed');
    });
  }

  /**
   * Run the application
   */
  async run(): Promise<void> {
    this.isRunning = true;
    const config = this.configManager.getConfig();

    console.log(`🏢 Processing ${config.dealerships.length} dealership(s)...\n`);

    // Process each active dealership
    for (const dealership of config.dealerships) {
      if (!dealership.active) {
        console.log(`⏭️  Skipping inactive dealership: ${dealership.name}`);
        continue;
      }

      await this.processDealership(dealership);
    }

    // Start scheduled jobs if enabled
    if (config.features.scheduling) {
      await this.startScheduledJobs();
    }

    // Keep the application running
    if (this.isRunning) {
      console.log('\n✅ DNC VINNY is running. Press Ctrl+C to stop.');
      await this.waitForShutdown();
    }
  }

  /**
   * Process a single dealership
   */
  private async processDealership(dealership: DealershipConfig): Promise<void> {
    console.log(`\n🏪 Processing: ${dealership.name}`);
    console.log(`   - VinSolutions: ${dealership.vinSolutions.baseUrl}`);
    console.log(`   - PossibleNOW: ${dealership.possibleNOW.baseUrl}`);

    try {
      // Here you would integrate with your existing services
      // For example:
      // - Initialize VinSolutions client
      // - Initialize PossibleNOW client
      // - Set up data synchronization
      // - Configure webhooks

      console.log(`   ✅ ${dealership.name} configured successfully`);
    } catch (error) {
      console.error(`   ❌ Failed to process ${dealership.name}:`, error);
    }
  }

  /**
   * Start scheduled jobs
   */
  private async startScheduledJobs(): Promise<void> {
    const config = this.configManager.getConfig();

    for (const dealership of config.dealerships) {
      if (!dealership.active || !dealership.schedule?.enabled) {
        continue;
      }

      console.log(`\n⏰ Starting scheduled jobs for ${dealership.name}:`);

      for (const job of dealership.schedule.jobs) {
        if (!job.enabled) {
          continue;
        }

        console.log(`   - ${job.name}: ${job.cron} (${job.type})`);
        // Here you would set up actual cron jobs
        // For example, using node-cron or similar library
      }
    }
  }

  /**
   * Perform health checks
   */
  async healthCheck(): Promise<void> {
    console.log('\n🏥 Running health checks...');
    const results = await this.configManager.healthCheck();

    for (const [dealershipId, result] of results) {
      console.log(`\n${result.name}:`);
      
      for (const [service, status] of Object.entries(result.services)) {
        const icon = status.status === 'ok' ? '✅' : '❌';
        console.log(`  ${icon} ${service}: ${status.status}`);
        if (status.error) {
          console.log(`     ${status.error}`);
        }
      }
    }
  }

  /**
   * Wait for shutdown signal
   */
  private async waitForShutdown(): Promise<void> {
    return new Promise((resolve) => {
      process.on('SIGINT', () => {
        console.log('\n\n🛑 Shutting down DNC VINNY...');
        this.shutdown().then(resolve);
      });

      process.on('SIGTERM', () => {
        console.log('\n\n🛑 Shutting down DNC VINNY...');
        this.shutdown().then(resolve);
      });
    });
  }

  /**
   * Shutdown the application
   */
  async shutdown(): Promise<void> {
    this.isRunning = false;

    // Clean up resources
    await this.configManager.destroy();

    console.log('👋 DNC VINNY stopped.');
    process.exit(0);
  }
}

/**
 * Main entry point
 */
async function main() {
  try {
    const app = new DNCVinnyApp({
      configPath: process.env.DNC_VINNY_CONFIG_PATH || './config',
      masterPassword: process.env.DNC_VINNY_MASTER_PASSWORD
    });

    await app.initialize();

    // Run health check on startup
    await app.healthCheck();

    // Start the application
    await app.run();

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the application if this is the main module
if (require.main === module) {
  main();
}

export { DNCVinnyApp, createConfigManager, ConfigManager };