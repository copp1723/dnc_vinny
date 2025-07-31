#!/usr/bin/env node

import { Command } from 'commander';
import { StoreRegistry, StorePriority } from '../StoreRegistry';
import { MultiStoreOrchestrator } from '../MultiStoreOrchestrator';
import { QueueManager } from '../QueueManager';
import { logger } from '../../../priority5-compliance/logger';
import * as readline from 'readline';
import * as chalk from 'chalk';
import * as Table from 'cli-table3';
import * as path from 'path';
import * as fs from 'fs/promises';

const program = new Command();
const registry = new StoreRegistry();

// Helper function to format dates
function formatDate(date?: Date): string {
  if (!date) return 'Never';
  return date.toLocaleString();
}

// Helper function to format duration
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

// Helper function to create table
function createTable(head: string[]): any {
  return new Table({
    head: head.map(h => chalk.cyan(h)),
    style: {
      head: [],
      border: ['grey'],
    },
  });
}

program
  .name('multi-store')
  .description('Multi-Store DNC Compliance Management CLI')
  .version('1.0.0');

// List stores command
program
  .command('list')
  .description('List all stores')
  .option('-a, --active', 'Show only active stores')
  .option('-q, --quarantined', 'Show only quarantined stores')
  .option('-p, --priority <priority>', 'Filter by priority (high/medium/low)')
  .action(async (options) => {
    try {
      await registry.loadStores();
      let stores = registry.getAllStores();

      // Apply filters
      if (options.active) {
        stores = stores.filter(s => s.active && !s.metadata.quarantined);
      }
      if (options.quarantined) {
        stores = stores.filter(s => s.metadata.quarantined);
      }
      if (options.priority) {
        stores = stores.filter(s => s.priority === options.priority);
      }

      if (stores.length === 0) {
        console.log(chalk.yellow('No stores found matching criteria'));
        return;
      }

      const table = createTable(['ID', 'Name', 'Priority', 'Status', 'Last Processed', 'Failures']);

      for (const store of stores) {
        const status = store.metadata.quarantined 
          ? chalk.red('Quarantined')
          : store.active 
            ? chalk.green('Active')
            : chalk.yellow('Inactive');

        table.push([
          store.id,
          store.name,
          store.priority,
          status,
          formatDate(store.metadata.lastProcessed),
          store.metadata.failureCount,
        ]);
      }

      console.log(table.toString());
      console.log(`\nTotal: ${stores.length} stores`);

    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      process.exit(1);
    }
  });

// Add store command
program
  .command('add')
  .description('Add a new store')
  .requiredOption('-i, --id <id>', 'Store ID')
  .requiredOption('-n, --name <name>', 'Store name')
  .option('-p, --priority <priority>', 'Priority (high/medium/low)', 'medium')
  .option('--inactive', 'Add as inactive')
  .action(async (options) => {
    try {
      await registry.loadStores();

      // Check if store already exists
      if (registry.hasStore(options.id)) {
        console.error(chalk.red(`Store with ID ${options.id} already exists`));
        process.exit(1);
      }

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      console.log(chalk.cyan('\nStore Configuration'));
      console.log(chalk.gray('Enter dealership configuration details:\n'));

      // Interactive configuration
      const config = await new Promise<any>((resolve) => {
        const dealershipConfig: any = {
          id: options.id,
          name: options.name,
          active: !options.inactive,
          vinSolutions: {},
          possibleNOW: {},
        };

        rl.question('VinSolutions Base URL: ', (baseUrl) => {
          dealershipConfig.vinSolutions.baseUrl = baseUrl;
          rl.question('VinSolutions API Key: ', (apiKey) => {
            dealershipConfig.vinSolutions.apiKey = apiKey;
            rl.question('VinSolutions API Secret: ', (apiSecret) => {
              dealershipConfig.vinSolutions.apiSecret = apiSecret;
              rl.question('VinSolutions Dealership ID: ', (dealershipId) => {
                dealershipConfig.vinSolutions.dealershipId = dealershipId;
                
                rl.question('PossibleNOW Base URL: ', (pnBaseUrl) => {
                  dealershipConfig.possibleNOW.baseUrl = pnBaseUrl;
                  rl.question('PossibleNOW Username: ', (username) => {
                    dealershipConfig.possibleNOW.username = username;
                    rl.question('PossibleNOW Password: ', (password) => {
                      dealershipConfig.possibleNOW.password = password;
                      rl.question('PossibleNOW Account ID: ', (accountId) => {
                        dealershipConfig.possibleNOW.accountId = accountId;
                        rl.close();
                        resolve(dealershipConfig);
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });

      // Add store to registry
      await registry.addStore({
        id: options.id,
        name: options.name,
        priority: options.priority as StorePriority,
        active: !options.inactive,
        dealershipConfig: config,
        metadata: {
          createdAt: new Date(),
          updatedAt: new Date(),
          failureCount: 0,
          quarantined: false,
        },
      });

      console.log(chalk.green(`\n✅ Store ${options.name} added successfully`));

    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      process.exit(1);
    }
  });

// Remove store command
program
  .command('remove <storeId>')
  .description('Remove a store')
  .option('-f, --force', 'Skip confirmation')
  .action(async (storeId, options) => {
    try {
      await registry.loadStores();

      const store = registry.getStore(storeId);
      if (!store) {
        console.error(chalk.red(`Store ${storeId} not found`));
        process.exit(1);
      }

      if (!options.force) {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const confirm = await new Promise<string>((resolve) => {
          rl.question(chalk.yellow(`Are you sure you want to remove store ${store.name}? (yes/no): `), resolve);
          rl.close();
        });

        if (confirm.toLowerCase() !== 'yes') {
          console.log('Operation cancelled');
          return;
        }
      }

      await registry.removeStore(storeId);
      console.log(chalk.green(`✅ Store ${store.name} removed`));

    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      process.exit(1);
    }
  });

// Enable/disable store commands
program
  .command('enable <storeId>')
  .description('Enable a store')
  .action(async (storeId) => {
    try {
      await registry.loadStores();
      await registry.enableStore(storeId);
      console.log(chalk.green(`✅ Store ${storeId} enabled`));
    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      process.exit(1);
    }
  });

program
  .command('disable <storeId>')
  .description('Disable a store')
  .action(async (storeId) => {
    try {
      await registry.loadStores();
      await registry.disableStore(storeId);
      console.log(chalk.green(`✅ Store ${storeId} disabled`));
    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      process.exit(1);
    }
  });

// Set priority command
program
  .command('set-priority <storeId> <priority>')
  .description('Set store priority (high/medium/low)')
  .action(async (storeId, priority) => {
    try {
      await registry.loadStores();
      
      if (!['high', 'medium', 'low'].includes(priority)) {
        console.error(chalk.red('Priority must be high, medium, or low'));
        process.exit(1);
      }

      await registry.setStorePriority(storeId, priority as StorePriority);
      console.log(chalk.green(`✅ Store ${storeId} priority set to ${priority}`));
    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      process.exit(1);
    }
  });

// Set schedule command
program
  .command('set-schedule <storeId>')
  .description('Set processing schedule for a store')
  .action(async (storeId) => {
    try {
      await registry.loadStores();

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      console.log(chalk.cyan('\nProcessing Window Configuration'));
      
      const schedule = await new Promise<any>((resolve) => {
        const window: any = {};
        
        rl.question('Start time (HH:MM): ', (start) => {
          window.start = start;
          rl.question('End time (HH:MM): ', (end) => {
            window.end = end;
            rl.question('Timezone (e.g., America/Los_Angeles): ', (timezone) => {
              window.timezone = timezone;
              rl.question('Days of week (0-6, comma separated, leave empty for all): ', (days) => {
                if (days) {
                  window.daysOfWeek = days.split(',').map(d => parseInt(d.trim()));
                }
                rl.close();
                resolve(window);
              });
            });
          });
        });
      });

      await registry.setProcessingWindow(storeId, schedule);
      console.log(chalk.green(`✅ Processing schedule set for store ${storeId}`));

    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('Show multi-store system status')
  .action(async () => {
    try {
      await registry.loadStores();
      const stats = registry.getStatistics();

      console.log(chalk.cyan('\n=== Multi-Store System Status ===\n'));

      const statusTable = createTable(['Metric', 'Value']);
      statusTable.push(
        ['Total Stores', stats.total],
        ['Active Stores', chalk.green(stats.active)],
        ['Inactive Stores', chalk.yellow(stats.inactive)],
        ['Quarantined Stores', chalk.red(stats.quarantined)],
        ['High Priority', stats.byPriority.high],
        ['Medium Priority', stats.byPriority.medium],
        ['Low Priority', stats.byPriority.low],
        ['With Schedules', stats.withProcessingWindows],
      );

      console.log(statusTable.toString());

      // Show quarantined stores if any
      if (stats.quarantined > 0) {
        console.log(chalk.red('\n⚠️ Quarantined Stores:'));
        const quarantined = registry.getQuarantinedStores();
        const qTable = createTable(['ID', 'Name', 'Reason', 'Since']);
        
        for (const store of quarantined) {
          qTable.push([
            store.id,
            store.name,
            store.metadata.quarantineReason || 'Unknown',
            formatDate(store.metadata.quarantinedAt),
          ]);
        }
        
        console.log(qTable.toString());
      }

    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      process.exit(1);
    }
  });

// Release quarantine command
program
  .command('release-quarantine <storeId>')
  .description('Release a store from quarantine')
  .action(async (storeId) => {
    try {
      await registry.loadStores();
      await registry.releaseFromQuarantine(storeId);
      console.log(chalk.green(`✅ Store ${storeId} released from quarantine`));
    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      process.exit(1);
    }
  });

// Run processing command
program
  .command('run')
  .description('Run multi-store processing')
  .option('-s, --stores <ids>', 'Process specific stores (comma-separated)')
  .option('-p, --priority <priority>', 'Process only stores with specific priority')
  .option('-d, --dry-run', 'Simulate processing without actually running')
  .action(async (options) => {
    try {
      console.log(chalk.cyan('\n🚀 Starting Multi-Store Processing...\n'));

      const orchestrator = new MultiStoreOrchestrator({
        maxConcurrentStores: 3,
        maxBrowsersPerStore: 2,
        apiRateLimits: {
          possibleNOW: {
            requestsPerMinute: 60,
            burstLimit: 10,
          },
        },
        processingWindows: {},
        failureIsolation: {
          maxRetries: 3,
          backoffMultiplier: 2,
          quarantineThreshold: 5,
        },
      });

      // Set up progress monitoring
      orchestrator.on('storeProcessingStarted', ({ storeName }) => {
        console.log(chalk.blue(`▶️ Processing ${storeName}...`));
      });

      orchestrator.on('storeProcessingCompleted', (result) => {
        console.log(chalk.green(`✅ ${result.storeName}: ${result.metrics.processedCustomers} customers processed`));
      });

      orchestrator.on('storeProcessingFailed', ({ storeId, error }) => {
        console.log(chalk.red(`❌ Store ${storeId} failed: ${error}`));
      });

      if (options.dryRun) {
        console.log(chalk.yellow('🔍 DRY RUN MODE - No actual processing will occur\n'));
        
        await registry.loadStores();
        let stores = registry.getActiveStores();
        
        if (options.stores) {
          const ids = options.stores.split(',').map(s => s.trim());
          stores = stores.filter(s => ids.includes(s.id));
        }
        
        if (options.priority) {
          stores = stores.filter(s => s.priority === options.priority);
        }
        
        console.log(`Would process ${stores.length} stores:`);
        stores.forEach(s => console.log(`  - ${s.name} (${s.priority} priority)`));
        
        return;
      }

      await orchestrator.initialize();
      const report = await orchestrator.startProcessing();

      // Display results
      console.log(chalk.cyan('\n=== Processing Complete ===\n'));

      const summaryTable = createTable(['Metric', 'Value']);
      summaryTable.push(
        ['Total Stores', report.totalStores],
        ['Completed', chalk.green(report.completedStores)],
        ['Failed', chalk.red(report.failedStores)],
        ['Partial', chalk.yellow(report.partialStores)],
        ['Duration', formatDuration(report.totalDuration)],
        ['Total Customers', report.aggregatedMetrics.totalCustomers],
        ['Processed', report.aggregatedMetrics.processedCustomers],
        ['DNC Marked', report.aggregatedMetrics.dncMarkedCustomers],
        ['Compliance Rate', `${report.complianceStatistics.complianceRate.toFixed(1)}%`],
        ['API Usage', `${report.complianceStatistics.apiUsageRate.toFixed(1)}%`],
      );

      console.log(summaryTable.toString());

      // Save report
      const reportPath = path.join(process.cwd(), `multi-store-report-${new Date().toISOString()}.json`);
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
      console.log(chalk.gray(`\nReport saved to: ${reportPath}`));

      await orchestrator.cleanup();

    } catch (error) {
      console.error(chalk.red('\nError:', error.message));
      process.exit(1);
    }
  });

// Export/Import commands
program
  .command('export <filepath>')
  .description('Export store configurations')
  .action(async (filepath) => {
    try {
      await registry.loadStores();
      await registry.exportStores(filepath);
      console.log(chalk.green(`✅ Stores exported to ${filepath}`));
    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      process.exit(1);
    }
  });

program
  .command('import <filepath>')
  .description('Import store configurations')
  .option('-m, --merge', 'Merge with existing stores')
  .action(async (filepath, options) => {
    try {
      await registry.importStores(filepath, options.merge);
      console.log(chalk.green(`✅ Stores imported from ${filepath}`));
    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}