import { TaskOrchestrator, TaskDefinition, TaskResult } from '../../../priority3-orchestration/TaskOrchestrator';
import { VinSolutionsCustomerExtractor } from '../../adapters/vinsolutions-customer-extractor/VinSolutionsCustomerExtractor';
import { PossibleNOWClient } from '../../api-clients/possiblenow/client';
import { BulletproofActions } from '../../../priority2-checkbox/BulletproofActions';
import { Logger } from '../../../utils/Logger';
import { WorkflowCheckpoint } from './WorkflowCheckpoint';
import { WorkflowProgressTracker } from './WorkflowProgressTracker';
import { WorkflowConfig, WorkflowExecutionResult, DealershipConfig } from './types';
import { DNCMarkingService } from './services/DNCMarkingService';
import { ComplianceReportGenerator } from './services/ComplianceReportGenerator';
import { BatchProcessor } from './services/BatchProcessor';
import { chromium, Browser, Page } from 'playwright';
import { EventEmitter } from 'events';

/**
 * Main DNC Compliance Workflow Orchestrator
 * Handles end-to-end DNC compliance checking for dealerships
 */
export class DNCWorkflowOrchestrator extends EventEmitter {
  private orchestrator: TaskOrchestrator;
  private logger: Logger;
  private checkpoint: WorkflowCheckpoint;
  private progressTracker: WorkflowProgressTracker;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private isRunning = false;
  private abortSignal = false;

  // Services
  private customerExtractor: VinSolutionsCustomerExtractor;
  private possibleNowClient: PossibleNOWClient;
  private bulletproofActions: BulletproofActions;
  private dncMarkingService: DNCMarkingService;
  private reportGenerator: ComplianceReportGenerator;
  private batchProcessor: BatchProcessor;

  constructor(private config: WorkflowConfig) {
    super();
    this.logger = new Logger('DNCWorkflowOrchestrator');
    this.orchestrator = new TaskOrchestrator('dnc-compliance');
    
    // Initialize checkpoint and progress tracking
    this.checkpoint = new WorkflowCheckpoint(config.checkpointDir || './checkpoints');
    this.progressTracker = new WorkflowProgressTracker();

    // Initialize services
    this.customerExtractor = new VinSolutionsCustomerExtractor();
    this.possibleNowClient = new PossibleNOWClient(config.possibleNow);
    this.bulletproofActions = new BulletproofActions(this.logger);
    this.dncMarkingService = new DNCMarkingService(this.bulletproofActions, this.logger);
    this.reportGenerator = new ComplianceReportGenerator(config.reporting);
    this.batchProcessor = new BatchProcessor(config.batchSize || 1000, this.logger);

    // Register workflow tasks
    this.registerWorkflowTasks();
  }

  /**
   * Register all workflow tasks with the orchestrator
   */
  private registerWorkflowTasks(): void {
    // Task 1: Initialize Browser
    this.orchestrator.registerTask({
      id: 'initialize-browser',
      name: 'Initialize Browser',
      description: 'Launch browser and prepare for automation',
      dependencies: [],
      critical: true,
      execute: async (context) => {
        this.logger.info('Initializing browser...');
        this.browser = await chromium.launch({
          headless: this.config.headless || false,
          slowMo: this.config.slowMo || 500,
          args: ['--disable-blink-features=AutomationControlled']
        });
        
        this.page = await this.browser.newPage({
          viewport: { width: 1920, height: 1080 }
        });

        context.page = this.page;
        return { browser: this.browser, page: this.page };
      }
    });

    // Task 2: VinSolutions Login with 2FA
    this.orchestrator.registerTask({
      id: 'vinsolutions-login',
      name: 'VinSolutions Login',
      description: 'Login to VinSolutions with 2FA support',
      dependencies: ['initialize-browser'],
      critical: true,
      timeout: 300000, // 5 minutes for 2FA
      retryCount: 2,
      execute: async (context) => {
        const dealership = this.config.dealerships[0]; // Current dealership
        this.logger.info(`Logging into VinSolutions for ${dealership.name}...`);
        
        await this.customerExtractor.initialize();
        const loginSuccess = await this.customerExtractor.login(dealership.credentials);
        
        if (!loginSuccess) {
          throw new Error('Failed to login to VinSolutions');
        }

        // Handle 2FA if needed
        if (await this.check2FARequired(context.page)) {
          this.emit('2fa-required', { dealership: dealership.name });
          await this.handle2FA(context.page);
        }

        return { loginSuccess: true };
      }
    });

    // Task 3: Extract Customer Data
    this.orchestrator.registerTask({
      id: 'extract-customers',
      name: 'Extract Customer Data',
      description: 'Extract customer data from last 30 days',
      dependencies: ['vinsolutions-login'],
      critical: true,
      timeout: 600000, // 10 minutes
      execute: async (context) => {
        const dealership = this.config.dealerships[0];
        this.logger.info('Starting customer data extraction...');
        
        // Check for existing checkpoint
        const checkpoint = await this.checkpoint.load(dealership.id);
        let startFrom = 0;
        
        if (checkpoint && checkpoint.lastProcessedCustomer) {
          startFrom = checkpoint.lastProcessedCustomer;
          this.logger.info(`Resuming from customer #${startFrom}`);
        }

        const extractionResult = await this.customerExtractor.extractCustomers({
          reportType: 'sold_customers',
          dateRange: {
            startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
            endDate: new Date()
          },
          includeContactInfo: true,
          skipRows: startFrom
        });

        this.progressTracker.updateTotal(extractionResult.totalRecords);
        this.emit('extraction-complete', {
          dealership: dealership.name,
          totalRecords: extractionResult.totalRecords
        });

        return extractionResult;
      }
    });

    // Task 4: Batch Submit to PossibleNOW
    this.orchestrator.registerTask({
      id: 'dnc-batch-submit',
      name: 'Submit to PossibleNOW',
      description: 'Batch submit phone numbers for DNC checking',
      dependencies: ['extract-customers'],
      critical: true,
      retryCount: 3,
      execute: async (context) => {
        const extractionResult = context.results.get('extract-customers')?.data;
        if (!extractionResult) {
          throw new Error('No extraction result found');
        }

        this.logger.info('Starting batch DNC submission...');
        await this.possibleNowClient.initialize();

        const batchResults = await this.batchProcessor.processBatches(
          extractionResult.customers,
          async (batch) => {
            return await this.possibleNowClient.submitBatch({
              records: batch.map(customer => ({
                recordId: customer.id,
                phoneNumbers: customer.phoneNumbers,
                customerName: `${customer.firstName} ${customer.lastName}`
              }))
            });
          },
          {
            onProgress: (processed, total) => {
              this.progressTracker.updateProgress(processed);
              this.emit('dnc-check-progress', {
                processed,
                total,
                percentage: (processed / total) * 100
              });
            },
            onBatchComplete: async (batchIndex, result) => {
              // Save checkpoint after each batch
              const dealership = this.config.dealerships[0];
              await this.checkpoint.save(dealership.id, {
                stage: 'dnc-checking',
                lastProcessedBatch: batchIndex,
                batchId: result.batchId,
                timestamp: new Date()
              });
            }
          }
        );

        return { batchResults };
      }
    });

    // Task 5: Process DNC Results
    this.orchestrator.registerTask({
      id: 'process-dnc-results',
      name: 'Process DNC Results',
      description: 'Retrieve and process DNC check results',
      dependencies: ['dnc-batch-submit'],
      critical: true,
      retryCount: 5,
      timeout: 900000, // 15 minutes
      execute: async (context) => {
        const batchResults = context.results.get('dnc-batch-submit')?.data?.batchResults;
        if (!batchResults) {
          throw new Error('No batch results found');
        }

        this.logger.info('Processing DNC results...');
        const dncResults = [];

        for (const batch of batchResults) {
          // Poll for results with exponential backoff
          const results = await this.pollForResults(batch.batchId);
          dncResults.push(...results);
        }

        // Analyze results
        const dncCustomers = dncResults.filter(r => r.isDNC);
        const cleanCustomers = dncResults.filter(r => !r.isDNC);

        this.emit('dnc-results-processed', {
          total: dncResults.length,
          dncCount: dncCustomers.length,
          cleanCount: cleanCustomers.length
        });

        return { dncResults, dncCustomers, cleanCustomers };
      }
    });

    // Task 6: Mark DNC Customers in VinSolutions
    this.orchestrator.registerTask({
      id: 'mark-dnc-customers',
      name: 'Mark DNC Customers',
      description: 'Update customer records with DNC status',
      dependencies: ['process-dnc-results'],
      critical: false, // Non-critical to allow partial completion
      retryCount: 2,
      execute: async (context) => {
        const dncCustomers = context.results.get('process-dnc-results')?.data?.dncCustomers;
        if (!dncCustomers || dncCustomers.length === 0) {
          this.logger.info('No DNC customers to mark');
          return { markedCount: 0 };
        }

        this.logger.info(`Marking ${dncCustomers.length} customers as DNC...`);
        
        const markingResults = await this.dncMarkingService.markCustomersAsDNC(
          context.page,
          dncCustomers,
          {
            onProgress: (marked, total) => {
              this.emit('marking-progress', {
                marked,
                total,
                percentage: (marked / total) * 100
              });
            },
            onError: async (customerId, error) => {
              this.logger.error(`Failed to mark customer ${customerId}: ${error.message}`);
              // Continue with other customers
            }
          }
        );

        return markingResults;
      }
    });

    // Task 7: Generate Compliance Report
    this.orchestrator.registerTask({
      id: 'generate-report',
      name: 'Generate Compliance Report',
      description: 'Create comprehensive compliance report',
      dependencies: ['mark-dnc-customers'],
      critical: false,
      execute: async (context) => {
        const dealership = this.config.dealerships[0];
        const allResults = context.results;

        this.logger.info('Generating compliance report...');
        
        const report = await this.reportGenerator.generateReport({
          dealership,
          executionDate: new Date(),
          results: allResults,
          dncStats: {
            totalChecked: context.results.get('process-dnc-results')?.data?.dncResults?.length || 0,
            dncFound: context.results.get('process-dnc-results')?.data?.dncCustomers?.length || 0,
            successfullyMarked: context.results.get('mark-dnc-customers')?.data?.markedCount || 0
          }
        });

        this.emit('report-generated', {
          reportPath: report.filePath,
          dealership: dealership.name
        });

        return report;
      }
    });
  }

  /**
   * Execute workflow for all configured dealerships
   */
  async execute(): Promise<WorkflowExecutionResult[]> {
    if (this.isRunning) {
      throw new Error('Workflow is already running');
    }

    this.isRunning = true;
    this.abortSignal = false;
    const results: WorkflowExecutionResult[] = [];

    try {
      this.logger.info(`Starting DNC compliance workflow for ${this.config.dealerships.length} dealerships`);
      
      for (const dealership of this.config.dealerships) {
        if (this.abortSignal) {
          this.logger.warn('Workflow aborted by user');
          break;
        }

        this.logger.info(`Processing dealership: ${dealership.name}`);
        this.emit('dealership-start', { dealership: dealership.name });

        try {
          // Update config for current dealership
          this.config.dealerships = [dealership];
          
          // Execute workflow
          const startTime = Date.now();
          const taskResults = await this.orchestrator.executeAll(this.page!, this.config);
          const endTime = Date.now();

          const result: WorkflowExecutionResult = {
            dealershipId: dealership.id,
            dealershipName: dealership.name,
            success: true,
            startTime: new Date(startTime),
            endTime: new Date(endTime),
            duration: endTime - startTime,
            taskResults,
            summary: this.orchestrator.generateSummary()
          };

          results.push(result);
          this.emit('dealership-complete', result);

          // Clear checkpoint on successful completion
          await this.checkpoint.clear(dealership.id);

        } catch (error) {
          const errorResult: WorkflowExecutionResult = {
            dealershipId: dealership.id,
            dealershipName: dealership.name,
            success: false,
            startTime: new Date(),
            endTime: new Date(),
            duration: 0,
            error: error instanceof Error ? error.message : 'Unknown error',
            taskResults: this.orchestrator.getAllResults()
          };

          results.push(errorResult);
          this.emit('dealership-error', { dealership: dealership.name, error });
          
          if (this.config.stopOnError) {
            throw error;
          }
        }
      }

      return results;

    } finally {
      this.isRunning = false;
      await this.cleanup();
    }
  }

  /**
   * Abort the current workflow execution
   */
  async abort(): Promise<void> {
    this.logger.warn('Aborting workflow...');
    this.abortSignal = true;
    this.emit('workflow-aborted');
  }

  /**
   * Resume workflow from checkpoint
   */
  async resume(dealershipId: string): Promise<WorkflowExecutionResult> {
    const checkpoint = await this.checkpoint.load(dealershipId);
    if (!checkpoint) {
      throw new Error(`No checkpoint found for dealership ${dealershipId}`);
    }

    this.logger.info(`Resuming workflow from checkpoint: ${checkpoint.stage}`);
    this.emit('workflow-resumed', { dealershipId, checkpoint });

    // Find dealership config
    const dealership = this.config.dealerships.find(d => d.id === dealershipId);
    if (!dealership) {
      throw new Error(`Dealership ${dealershipId} not found in config`);
    }

    // Update config and execute
    this.config.dealerships = [dealership];
    const results = await this.execute();
    return results[0];
  }

  /**
   * Get current progress information
   */
  getProgress(): any {
    return {
      isRunning: this.isRunning,
      ...this.progressTracker.getProgress(),
      currentDealership: this.config.dealerships[0]?.name || null
    };
  }

  /**
   * Check if 2FA is required
   */
  private async check2FARequired(page: Page): Promise<boolean> {
    try {
      // Check for common 2FA indicators
      const twoFASelectors = [
        'input[name*="code"]',
        'input[placeholder*="verification"]',
        'input[placeholder*="2fa"]',
        'div:has-text("verification code")',
        'div:has-text("two-factor")'
      ];

      for (const selector of twoFASelectors) {
        if (await page.locator(selector).isVisible({ timeout: 5000 })) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Handle 2FA authentication
   */
  private async handle2FA(page: Page): Promise<void> {
    this.logger.info('2FA required - waiting for code input...');
    
    // Wait for 2FA code to be entered (manual intervention or automated)
    // This is a simplified version - in production, you'd integrate with your 2FA solution
    await page.waitForNavigation({ 
      waitUntil: 'networkidle',
      timeout: 300000 // 5 minutes for manual 2FA
    });
  }

  /**
   * Poll for DNC results with exponential backoff
   */
  private async pollForResults(batchId: string): Promise<any[]> {
    let attempts = 0;
    const maxAttempts = 30;
    let delay = 2000; // Start with 2 seconds

    while (attempts < maxAttempts) {
      try {
        const results = await this.possibleNowClient.getBatchResults(batchId);
        
        if (results.status === 'completed') {
          return results.records;
        } else if (results.status === 'failed') {
          throw new Error(`Batch ${batchId} failed: ${results.error}`);
        }

        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 1.5, 30000); // Max 30 seconds
        attempts++;

      } catch (error) {
        if (attempts >= maxAttempts - 1) {
          throw error;
        }
        this.logger.warn(`Polling attempt ${attempts + 1} failed, retrying...`);
      }
    }

    throw new Error(`Timeout waiting for batch ${batchId} results`);
  }

  /**
   * Cleanup resources
   */
  private async cleanup(): Promise<void> {
    this.logger.info('Cleaning up resources...');
    
    if (this.page) {
      await this.page.close().catch(() => {});
    }
    
    if (this.browser) {
      await this.browser.close().catch(() => {});
    }

    this.page = null;
    this.browser = null;
  }
}