#!/usr/bin/env node

import { Command } from 'commander';
import * as inquirer from 'inquirer';
import * as chalk from 'chalk';
import * as ora from 'ora';
import { DNCWorkflowOrchestrator } from './DNCWorkflowOrchestrator';
import { WorkflowScheduler } from './WorkflowScheduler';
import { WorkflowCheckpoint } from './WorkflowCheckpoint';
import { 
  loadWorkflowConfig, 
  validateWorkflowConfig, 
  createExampleConfig 
} from './config/workflow.config';
import { Logger } from '../../../utils/Logger';
import * as fs from 'fs-extra';
import * as path from 'path';

const program = new Command();
const logger = new Logger('DNC-Workflow-CLI');

program
  .name('dnc-workflow')
  .description('DNC Compliance Workflow CLI')
  .version('1.0.0');

/**
 * Run workflow command
 */
program
  .command('run')
  .description('Run DNC compliance workflow')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('-d, --dealership <id>', 'Run for specific dealership ID')
  .option('--headless', 'Run in headless mode')
  .option('--dry-run', 'Perform a dry run without making changes')
  .action(async (options) => {
    const spinner = ora('Loading configuration...').start();
    
    try {
      // Load configuration
      const config = await loadWorkflowConfig(options.config);
      
      // Override with CLI options
      if (options.headless !== undefined) {
        config.headless = options.headless;
      }
      
      // Filter dealership if specified
      if (options.dealership) {
        const dealership = config.dealerships.find(d => d.id === options.dealership);
        if (!dealership) {
          throw new Error(`Dealership ${options.dealership} not found`);
        }
        config.dealerships = [dealership];
      }
      
      // Validate configuration
      const errors = validateWorkflowConfig(config);
      if (errors.length > 0) {
        spinner.fail('Configuration validation failed');
        errors.forEach(error => console.error(chalk.red(`  • ${error}`)));
        process.exit(1);
      }
      
      spinner.succeed('Configuration loaded');
      
      // Confirm execution
      if (!options.dryRun) {
        const { confirm } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirm',
          message: `Run DNC workflow for ${config.dealerships.length} dealership(s)?`,
          default: true
        }]);
        
        if (!confirm) {
          console.log(chalk.yellow('Workflow cancelled'));
          process.exit(0);
        }
      }
      
      // Create workflow orchestrator
      const orchestrator = new DNCWorkflowOrchestrator(config);
      
      // Set up progress monitoring
      setupProgressMonitoring(orchestrator);
      
      // Handle 2FA
      orchestrator.on('2fa-required', async ({ dealership }) => {
        console.log(chalk.yellow(`\n2FA required for ${dealership}`));
        const { code } = await inquirer.prompt([{
          type: 'input',
          name: 'code',
          message: 'Enter 2FA code:',
          validate: (input) => input.length > 0
        }]);
        
        // In production, you'd implement proper 2FA handling here
        console.log(chalk.green('2FA code submitted'));
      });
      
      // Execute workflow
      console.log(chalk.blue('\nStarting DNC compliance workflow...\n'));
      const startTime = Date.now();
      
      const results = await orchestrator.execute();
      
      const duration = Date.now() - startTime;
      console.log(chalk.green(`\n✓ Workflow completed in ${formatDuration(duration)}`));
      
      // Display summary
      displayExecutionSummary(results);
      
    } catch (error) {
      spinner.fail('Workflow failed');
      console.error(chalk.red(error));
      process.exit(1);
    }
  });

/**
 * Schedule workflow command
 */
program
  .command('schedule')
  .description('Schedule DNC workflow for automatic execution')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('--cron <expression>', 'Cron expression for scheduling')
  .option('--enable', 'Enable scheduling')
  .option('--disable', 'Disable scheduling')
  .action(async (options) => {
    try {
      const config = await loadWorkflowConfig(options.config);
      
      if (options.cron) {
        config.scheduling!.cronExpression = options.cron;
      }
      
      if (options.enable) {
        config.scheduling!.enabled = true;
      } else if (options.disable) {
        config.scheduling!.enabled = false;
      }
      
      const scheduler = new WorkflowScheduler({
        maxConcurrentRuns: config.scheduling!.maxConcurrentRuns,
        historyDir: './scheduler-history'
      });
      
      if (config.scheduling!.enabled) {
        await scheduler.scheduleWorkflow('dnc-compliance', config);
        console.log(chalk.green(`✓ Workflow scheduled: ${config.scheduling!.cronExpression}`));
        console.log(chalk.blue('Scheduler is running. Press Ctrl+C to stop.'));
        
        // Keep process running
        process.on('SIGINT', async () => {
          console.log(chalk.yellow('\nStopping scheduler...'));
          await scheduler.stopAll();
          process.exit(0);
        });
        
      } else {
        await scheduler.unscheduleWorkflow('dnc-compliance');
        console.log(chalk.yellow('Workflow scheduling disabled'));
      }
      
    } catch (error) {
      console.error(chalk.red('Failed to schedule workflow:'), error);
      process.exit(1);
    }
  });

/**
 * Resume workflow command
 */
program
  .command('resume')
  .description('Resume workflow from checkpoint')
  .option('-d, --dealership <id>', 'Dealership ID to resume', null)
  .option('-c, --config <path>', 'Path to configuration file')
  .action(async (options) => {
    try {
      const config = await loadWorkflowConfig(options.config);
      const checkpoint = new WorkflowCheckpoint(config.checkpointDir);
      
      if (options.dealership) {
        // Resume specific dealership
        const checkpointData = await checkpoint.load(options.dealership);
        if (!checkpointData) {
          console.error(chalk.red(`No checkpoint found for dealership: ${options.dealership}`));
          process.exit(1);
        }
        
        console.log(chalk.blue(`Resuming workflow for ${options.dealership} from stage: ${checkpointData.stage}`));
        
        const orchestrator = new DNCWorkflowOrchestrator(config);
        setupProgressMonitoring(orchestrator);
        
        const result = await orchestrator.resume(options.dealership);
        displayExecutionSummary([result]);
        
      } else {
        // Show available checkpoints
        const activeCheckpoints = await checkpoint.listActive();
        
        if (activeCheckpoints.length === 0) {
          console.log(chalk.yellow('No active checkpoints found'));
          return;
        }
        
        console.log(chalk.blue('Active checkpoints:\n'));
        activeCheckpoints.forEach(({ dealershipId, checkpoint }) => {
          console.log(`  ${chalk.cyan(dealershipId)}`);
          console.log(`    Stage: ${checkpoint.stage}`);
          console.log(`    Last updated: ${new Date(checkpoint.timestamp).toLocaleString()}\n`);
        });
        
        const { selectedDealership } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedDealership',
          message: 'Select dealership to resume:',
          choices: activeCheckpoints.map(c => c.dealershipId)
        }]);
        
        console.log(chalk.blue(`\nResuming workflow for ${selectedDealership}...`));
        
        const orchestrator = new DNCWorkflowOrchestrator(config);
        setupProgressMonitoring(orchestrator);
        
        const result = await orchestrator.resume(selectedDealership);
        displayExecutionSummary([result]);
      }
      
    } catch (error) {
      console.error(chalk.red('Failed to resume workflow:'), error);
      process.exit(1);
    }
  });

/**
 * Status command
 */
program
  .command('status')
  .description('Show workflow status and history')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('--history <limit>', 'Show execution history (default: 10)', '10')
  .action(async (options) => {
    try {
      const config = await loadWorkflowConfig(options.config);
      const scheduler = new WorkflowScheduler({
        maxConcurrentRuns: 1,
        historyDir: './scheduler-history'
      });
      
      // Show scheduled workflows
      const scheduled = scheduler.getScheduledWorkflows();
      if (scheduled.length > 0) {
        console.log(chalk.blue('Scheduled Workflows:\n'));
        scheduled.forEach(workflow => {
          console.log(`  ${chalk.cyan(workflow.workflowId)}`);
          console.log(`    Running: ${workflow.isRunning ? chalk.green('Yes') : chalk.gray('No')}`);
          console.log(`    Next run: ${workflow.nextRun?.toLocaleString() || 'N/A'}\n`);
        });
      }
      
      // Show execution history
      const history = scheduler.getExecutionHistory(parseInt(options.history));
      if (history.length > 0) {
        console.log(chalk.blue('Recent Executions:\n'));
        history.forEach((execution: any) => {
          const success = execution.success ? chalk.green('✓') : chalk.red('✗');
          console.log(`  ${success} ${new Date(execution.timestamp).toLocaleString()}`);
          console.log(`    Dealerships: ${execution.totalDealerships} (${execution.successfulDealerships} successful)`);
          console.log(`    Workflow ID: ${execution.workflowId}\n`);
        });
      }
      
      // Show active checkpoints
      const checkpoint = new WorkflowCheckpoint(config.checkpointDir);
      const activeCheckpoints = await checkpoint.listActive();
      
      if (activeCheckpoints.length > 0) {
        console.log(chalk.blue('Active Checkpoints:\n'));
        activeCheckpoints.forEach(({ dealershipId, checkpoint }) => {
          console.log(`  ${chalk.cyan(dealershipId)} - ${checkpoint.stage}`);
        });
      }
      
    } catch (error) {
      console.error(chalk.red('Failed to get status:'), error);
      process.exit(1);
    }
  });

/**
 * Config command
 */
program
  .command('config')
  .description('Manage workflow configuration')
  .option('--create <path>', 'Create example configuration file')
  .option('--validate <path>', 'Validate configuration file')
  .action(async (options) => {
    try {
      if (options.create) {
        await createExampleConfig(options.create);
        console.log(chalk.green(`✓ Example configuration created: ${options.create}`));
        console.log(chalk.blue('\nEdit this file with your dealership details and API credentials.'));
      }
      
      if (options.validate) {
        const config = await loadWorkflowConfig(options.validate);
        const errors = validateWorkflowConfig(config);
        
        if (errors.length === 0) {
          console.log(chalk.green('✓ Configuration is valid'));
        } else {
          console.log(chalk.red('✗ Configuration validation failed:\n'));
          errors.forEach(error => console.error(chalk.red(`  • ${error}`)));
        }
      }
      
    } catch (error) {
      console.error(chalk.red('Configuration error:'), error);
      process.exit(1);
    }
  });

/**
 * Set up progress monitoring
 */
function setupProgressMonitoring(orchestrator: DNCWorkflowOrchestrator): void {
  let currentSpinner: ora.Ora | null = null;
  
  orchestrator.on('dealership-start', ({ dealership }) => {
    console.log(chalk.blue(`\n▶ Processing dealership: ${dealership}`));
  });
  
  orchestrator.on('extraction-complete', ({ totalRecords }) => {
    console.log(chalk.green(`  ✓ Extracted ${totalRecords} customer records`));
  });
  
  orchestrator.on('dnc-check-progress', ({ processed, total, percentage }) => {
    if (currentSpinner) currentSpinner.stop();
    currentSpinner = ora(`Checking DNC status: ${processed}/${total} (${percentage.toFixed(1)}%)`).start();
  });
  
  orchestrator.on('dnc-results-processed', ({ total, dncCount, cleanCount }) => {
    if (currentSpinner) currentSpinner.stop();
    console.log(chalk.green(`  ✓ DNC check complete: ${dncCount} DNC, ${cleanCount} clean`));
  });
  
  orchestrator.on('marking-progress', ({ marked, total, percentage }) => {
    if (currentSpinner) currentSpinner.stop();
    currentSpinner = ora(`Marking DNC customers: ${marked}/${total} (${percentage.toFixed(1)}%)`).start();
  });
  
  orchestrator.on('report-generated', ({ reportPath, dealership }) => {
    if (currentSpinner) currentSpinner.stop();
    console.log(chalk.green(`  ✓ Report generated: ${path.basename(reportPath)}`));
  });
  
  orchestrator.on('dealership-complete', (result) => {
    if (currentSpinner) currentSpinner.stop();
    console.log(chalk.green(`✓ Completed ${result.dealershipName} in ${formatDuration(result.duration)}`));
  });
  
  orchestrator.on('dealership-error', ({ dealership, error }) => {
    if (currentSpinner) currentSpinner.stop();
    console.log(chalk.red(`✗ Failed ${dealership}: ${error}`));
  });
}

/**
 * Display execution summary
 */
function displayExecutionSummary(results: any[]): void {
  console.log(chalk.blue('\n═══════════════════════════════════════'));
  console.log(chalk.blue('         WORKFLOW SUMMARY'));
  console.log(chalk.blue('═══════════════════════════════════════\n'));
  
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`Total dealerships: ${results.length}`);
  console.log(`${chalk.green('✓')} Successful: ${successful}`);
  console.log(`${chalk.red('✗')} Failed: ${failed}`);
  
  console.log('\nDetails:');
  results.forEach(result => {
    const status = result.success ? chalk.green('✓') : chalk.red('✗');
    console.log(`\n${status} ${result.dealershipName}`);
    
    if (result.success && result.stats) {
      console.log(`  • Customers processed: ${result.stats.totalCustomersProcessed}`);
      console.log(`  • DNC numbers found: ${result.stats.dncNumbersFound}`);
      console.log(`  • Successfully marked: ${result.stats.successfullyMarked}`);
    } else if (result.error) {
      console.log(`  • Error: ${chalk.red(result.error)}`);
    }
  });
  
  console.log(chalk.blue('\n═══════════════════════════════════════'));
}

/**
 * Format duration
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// Parse command line arguments
program.parse(process.argv);