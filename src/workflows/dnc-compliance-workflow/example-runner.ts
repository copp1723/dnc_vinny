/**
 * Example DNC Workflow Runner
 * Demonstrates how to use the DNC Compliance Workflow programmatically
 */

import { DNCWorkflowOrchestrator } from './DNCWorkflowOrchestrator';
import { WorkflowScheduler } from './WorkflowScheduler';
import { WorkflowConfig } from './types';
import { loadWorkflowConfig, validateWorkflowConfig } from './config/workflow.config';
import { Logger } from '../../../utils/Logger';

const logger = new Logger('DNC-Workflow-Example');

/**
 * Example 1: Run workflow immediately
 */
async function runWorkflowNow() {
  logger.info('Example 1: Running workflow immediately');
  
  // Load configuration
  const config = await loadWorkflowConfig('./config/workflow.json');
  
  // Validate configuration
  const errors = validateWorkflowConfig(config);
  if (errors.length > 0) {
    logger.error('Configuration errors:', errors);
    return;
  }
  
  // Create orchestrator
  const orchestrator = new DNCWorkflowOrchestrator(config);
  
  // Set up event listeners
  orchestrator.on('dealership-start', ({ dealership }) => {
    logger.info(`Processing dealership: ${dealership}`);
  });
  
  orchestrator.on('extraction-complete', ({ dealership, totalRecords }) => {
    logger.info(`Extracted ${totalRecords} records from ${dealership}`);
  });
  
  orchestrator.on('dnc-check-progress', ({ processed, total, percentage }) => {
    logger.info(`DNC check progress: ${processed}/${total} (${percentage.toFixed(1)}%)`);
  });
  
  orchestrator.on('marking-progress', ({ marked, total, percentage }) => {
    logger.info(`Marking progress: ${marked}/${total} (${percentage.toFixed(1)}%)`);
  });
  
  orchestrator.on('report-generated', ({ reportPath, dealership }) => {
    logger.info(`Report generated for ${dealership}: ${reportPath}`);
  });
  
  orchestrator.on('2fa-required', async ({ dealership }) => {
    logger.warn(`2FA required for ${dealership}`);
    // In production, implement your 2FA handling here
    // For example, send notification to admin or use automated 2FA service
  });
  
  // Execute workflow
  try {
    const results = await orchestrator.execute();
    
    // Process results
    results.forEach(result => {
      if (result.success) {
        logger.info(`✓ ${result.dealershipName} completed successfully`);
        if (result.stats) {
          logger.info(`  - Customers processed: ${result.stats.totalCustomersProcessed}`);
          logger.info(`  - DNC numbers found: ${result.stats.dncNumbersFound}`);
          logger.info(`  - Successfully marked: ${result.stats.successfullyMarked}`);
        }
      } else {
        logger.error(`✗ ${result.dealershipName} failed: ${result.error}`);
      }
    });
    
  } catch (error) {
    logger.error('Workflow failed:', error);
  }
}

/**
 * Example 2: Resume workflow from checkpoint
 */
async function resumeWorkflow(dealershipId: string) {
  logger.info(`Example 2: Resuming workflow for ${dealershipId}`);
  
  const config = await loadWorkflowConfig('./config/workflow.json');
  const orchestrator = new DNCWorkflowOrchestrator(config);
  
  try {
    const result = await orchestrator.resume(dealershipId);
    logger.info(`Resume completed: ${result.success ? 'Success' : 'Failed'}`);
  } catch (error) {
    logger.error('Resume failed:', error);
  }
}

/**
 * Example 3: Schedule workflow for automatic execution
 */
async function scheduleWorkflow() {
  logger.info('Example 3: Scheduling workflow');
  
  const config = await loadWorkflowConfig('./config/workflow.json');
  
  // Enable scheduling with custom settings
  config.scheduling = {
    enabled: true,
    cronExpression: '0 2 1 * *', // Run at 2 AM on the 1st of each month
    timezone: 'America/New_York',
    maxConcurrentRuns: 1,
    notifyBeforeRun: true,
    notificationLeadTime: 30
  };
  
  const scheduler = new WorkflowScheduler({
    maxConcurrentRuns: 1,
    historyDir: './scheduler-history'
  });
  
  // Set up event listeners
  scheduler.on('workflow-scheduled', ({ workflowId }) => {
    logger.info(`Workflow scheduled: ${workflowId}`);
  });
  
  scheduler.on('execution-started', ({ workflowId }) => {
    logger.info(`Scheduled execution started: ${workflowId}`);
  });
  
  scheduler.on('execution-completed', ({ workflowId, results }) => {
    logger.info(`Scheduled execution completed: ${workflowId}`);
  });
  
  scheduler.on('workflow-notification', ({ workflowId, message }) => {
    logger.info(`Notification: ${message}`);
    // Send email/SMS notification to admin
  });
  
  scheduler.on('workflow-2fa-required', async ({ workflowId, data }) => {
    logger.warn(`2FA required for scheduled workflow: ${workflowId}`);
    // Handle 2FA for scheduled runs
  });
  
  // Schedule the workflow
  await scheduler.scheduleWorkflow('dnc-compliance-monthly', config);
  
  // Load previously saved schedules
  await scheduler.loadSavedSchedules();
  
  // Keep the process running
  logger.info('Scheduler is running. Press Ctrl+C to stop.');
  
  process.on('SIGINT', async () => {
    logger.info('Stopping scheduler...');
    await scheduler.stopAll();
    process.exit(0);
  });
}

/**
 * Example 4: Get workflow progress
 */
async function monitorProgress() {
  logger.info('Example 4: Monitoring workflow progress');
  
  const config = await loadWorkflowConfig('./config/workflow.json');
  const orchestrator = new DNCWorkflowOrchestrator(config);
  
  // Start workflow in background
  const workflowPromise = orchestrator.execute();
  
  // Monitor progress every 5 seconds
  const progressInterval = setInterval(() => {
    const progress = orchestrator.getProgress();
    logger.info('Current progress:', progress);
    
    if (!progress.isRunning) {
      clearInterval(progressInterval);
    }
  }, 5000);
  
  // Wait for completion
  await workflowPromise;
}

/**
 * Example 5: Custom configuration
 */
async function runWithCustomConfig() {
  logger.info('Example 5: Running with custom configuration');
  
  const customConfig: WorkflowConfig = {
    dealerships: [{
      id: 'custom-dealer-001',
      name: 'Custom Dealership',
      credentials: {
        url: process.env.VINSOLUTIONS_URL!,
        username: process.env.VINSOLUTIONS_USERNAME!,
        password: process.env.VINSOLUTIONS_PASSWORD!
      },
      settings: {
        markDNCInCRM: true,
        addDNCTag: true,
        updateContactPreferences: true,
        dncFieldName: 'custom_dnc_field',
        dncTagName: 'DNC-COMPLIANCE'
      }
    }],
    possibleNow: {
      clientId: process.env.POSSIBLENOW_CLIENT_ID!,
      clientSecret: process.env.POSSIBLENOW_CLIENT_SECRET!,
      baseUrl: 'https://api.possiblenow.com',
      environment: 'production',
      timeout: 30000,
      retryAttempts: 3,
      retryDelay: 1000,
      rateLimits: {
        requestsPerSecond: 10,
        requestsPerMinute: 100,
        requestsPerHour: 1000,
        requestsPerDay: 10000
      }
    },
    batchSize: 500, // Smaller batches for testing
    parallelWorkers: 2,
    checkpointDir: './test-checkpoints',
    headless: true,
    slowMo: 0,
    screenshotOnError: true,
    retryAttempts: 2,
    retryDelay: 1000,
    stopOnError: false,
    partialCompletionAllowed: true,
    reporting: {
      outputDir: './test-reports',
      formats: ['pdf', 'json'],
      includeScreenshots: false,
      emailRecipients: ['test@example.com'],
      emailOnCompletion: false,
      emailOnError: true,
      retentionDays: 30
    }
  };
  
  const orchestrator = new DNCWorkflowOrchestrator(customConfig);
  const results = await orchestrator.execute();
  
  logger.info('Custom workflow completed:', results.length, 'dealerships processed');
}

/**
 * Main function to run examples
 */
async function main() {
  const args = process.argv.slice(2);
  const example = args[0] || '1';
  
  switch (example) {
    case '1':
      await runWorkflowNow();
      break;
    case '2':
      const dealershipId = args[1] || 'dealership-001';
      await resumeWorkflow(dealershipId);
      break;
    case '3':
      await scheduleWorkflow();
      break;
    case '4':
      await monitorProgress();
      break;
    case '5':
      await runWithCustomConfig();
      break;
    default:
      logger.info('Usage: ts-node example-runner.ts [example-number]');
      logger.info('Examples:');
      logger.info('  1 - Run workflow immediately');
      logger.info('  2 - Resume from checkpoint');
      logger.info('  3 - Schedule workflow');
      logger.info('  4 - Monitor progress');
      logger.info('  5 - Custom configuration');
  }
}

// Run the example
if (require.main === module) {
  main().catch(error => {
    logger.error('Example failed:', error);
    process.exit(1);
  });
}

export { runWorkflowNow, resumeWorkflow, scheduleWorkflow, monitorProgress, runWithCustomConfig };