import { WorkflowConfig } from '../types';

/**
 * Default DNC Workflow Configuration
 */
export const defaultWorkflowConfig: WorkflowConfig = {
  // Dealerships configuration (to be populated from environment or database)
  dealerships: [],
  
  // PossibleNOW API configuration
  possibleNow: {
    clientId: process.env.POSSIBLENOW_CLIENT_ID || '',
    clientSecret: process.env.POSSIBLENOW_CLIENT_SECRET || '',
    baseUrl: process.env.POSSIBLENOW_BASE_URL || 'https://api.possiblenow.com',
    environment: (process.env.POSSIBLENOW_ENVIRONMENT || 'production') as 'production' | 'sandbox',
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
  
  // Workflow settings
  batchSize: 1000,
  parallelWorkers: 3,
  checkpointDir: './checkpoints/dnc-workflow',
  
  // Browser settings
  headless: process.env.WORKFLOW_HEADLESS === 'true',
  slowMo: parseInt(process.env.WORKFLOW_SLOWMO || '500'),
  screenshotOnError: true,
  
  // Retry policies
  retryAttempts: 3,
  retryDelay: 2000,
  
  // Error handling
  stopOnError: false,
  partialCompletionAllowed: true,
  
  // Reporting configuration
  reporting: {
    outputDir: './reports/dnc-compliance',
    formats: ['pdf', 'excel', 'json', 'html'],
    includeScreenshots: true,
    emailRecipients: process.env.REPORT_EMAIL_RECIPIENTS?.split(',') || [],
    emailOnCompletion: true,
    emailOnError: true,
    retentionDays: 90
  },
  
  // Scheduling configuration
  scheduling: {
    enabled: false,
    cronExpression: '0 0 1 * *', // Monthly on the 1st at midnight
    timezone: 'America/New_York',
    maxConcurrentRuns: 1,
    notifyBeforeRun: true,
    notificationLeadTime: 30 // 30 minutes
  }
};

/**
 * Load workflow configuration from various sources
 */
export async function loadWorkflowConfig(configPath?: string): Promise<WorkflowConfig> {
  let config = { ...defaultWorkflowConfig };
  
  // Load from file if provided
  if (configPath) {
    try {
      const fs = await import('fs-extra');
      const fileConfig = await fs.readJson(configPath);
      config = { ...config, ...fileConfig };
    } catch (error) {
      console.error(`Failed to load config from ${configPath}:`, error);
    }
  }
  
  // Override with environment variables
  if (process.env.WORKFLOW_BATCH_SIZE) {
    config.batchSize = parseInt(process.env.WORKFLOW_BATCH_SIZE);
  }
  
  if (process.env.WORKFLOW_PARALLEL_WORKERS) {
    config.parallelWorkers = parseInt(process.env.WORKFLOW_PARALLEL_WORKERS);
  }
  
  if (process.env.WORKFLOW_CHECKPOINT_DIR) {
    config.checkpointDir = process.env.WORKFLOW_CHECKPOINT_DIR;
  }
  
  if (process.env.WORKFLOW_REPORT_DIR) {
    config.reporting.outputDir = process.env.WORKFLOW_REPORT_DIR;
  }
  
  if (process.env.WORKFLOW_SCHEDULE_ENABLED === 'true') {
    config.scheduling!.enabled = true;
  }
  
  if (process.env.WORKFLOW_SCHEDULE_CRON) {
    config.scheduling!.cronExpression = process.env.WORKFLOW_SCHEDULE_CRON;
  }
  
  return config;
}

/**
 * Validate workflow configuration
 */
export function validateWorkflowConfig(config: WorkflowConfig): string[] {
  const errors: string[] = [];
  
  // Validate dealerships
  if (!config.dealerships || config.dealerships.length === 0) {
    errors.push('At least one dealership must be configured');
  }
  
  config.dealerships.forEach((dealership, index) => {
    if (!dealership.id) {
      errors.push(`Dealership ${index} is missing an ID`);
    }
    if (!dealership.name) {
      errors.push(`Dealership ${index} is missing a name`);
    }
    if (!dealership.credentials?.url) {
      errors.push(`Dealership ${dealership.name || index} is missing VinSolutions URL`);
    }
    if (!dealership.credentials?.username) {
      errors.push(`Dealership ${dealership.name || index} is missing VinSolutions username`);
    }
    if (!dealership.credentials?.password) {
      errors.push(`Dealership ${dealership.name || index} is missing VinSolutions password`);
    }
  });
  
  // Validate PossibleNOW config
  if (!config.possibleNow.clientId) {
    errors.push('PossibleNOW client ID is required');
  }
  if (!config.possibleNow.clientSecret) {
    errors.push('PossibleNOW client secret is required');
  }
  
  // Validate batch settings
  if (config.batchSize < 1 || config.batchSize > 5000) {
    errors.push('Batch size must be between 1 and 5000');
  }
  
  if (config.parallelWorkers < 1 || config.parallelWorkers > 10) {
    errors.push('Parallel workers must be between 1 and 10');
  }
  
  // Validate reporting
  if (!config.reporting.outputDir) {
    errors.push('Report output directory is required');
  }
  
  if (config.reporting.formats.length === 0) {
    errors.push('At least one report format must be specified');
  }
  
  // Validate scheduling if enabled
  if (config.scheduling?.enabled) {
    const cron = require('node-cron');
    if (!cron.validate(config.scheduling.cronExpression)) {
      errors.push(`Invalid cron expression: ${config.scheduling.cronExpression}`);
    }
  }
  
  return errors;
}

/**
 * Create example configuration file
 */
export async function createExampleConfig(outputPath: string): Promise<void> {
  const fs = await import('fs-extra');
  
  const exampleConfig: WorkflowConfig = {
    ...defaultWorkflowConfig,
    dealerships: [
      {
        id: 'dealership-001',
        name: 'Example Dealership',
        credentials: {
          url: 'https://example.vinsolutions.com',
          username: 'your-username',
          password: 'your-password'
        },
        settings: {
          markDNCInCRM: true,
          addDNCTag: true,
          updateContactPreferences: true,
          dncFieldName: 'dnc_status',
          dncTagName: 'DNC - Do Not Call'
        }
      }
    ]
  };
  
  await fs.writeJson(outputPath, exampleConfig, { spaces: 2 });
  console.log(`Example configuration created at: ${outputPath}`);
}