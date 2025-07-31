import * as cron from 'node-cron';
import { EventEmitter } from 'events';
import { Logger } from '../../../utils/Logger';
import { DNCWorkflowOrchestrator } from './DNCWorkflowOrchestrator';
import { WorkflowConfig, SchedulingConfig, WorkflowExecutionResult } from './types';
import * as fs from 'fs-extra';
import * as path from 'path';

/**
 * Workflow Scheduler
 * Handles scheduled execution of DNC compliance workflows
 */
export class WorkflowScheduler extends EventEmitter {
  private logger: Logger;
  private scheduledTasks: Map<string, cron.ScheduledTask> = new Map();
  private runningWorkflows: Map<string, DNCWorkflowOrchestrator> = new Map();
  private executionHistory: WorkflowExecutionResult[] = [];
  private historyFile: string;

  constructor(private schedulerConfig: {
    maxConcurrentRuns: number;
    historyDir: string;
  }) {
    super();
    this.logger = new Logger('WorkflowScheduler');
    this.historyFile = path.join(schedulerConfig.historyDir, 'execution_history.json');
    this.loadExecutionHistory();
  }

  /**
   * Schedule a workflow
   */
  async scheduleWorkflow(
    workflowId: string,
    config: WorkflowConfig
  ): Promise<void> {
    if (!config.scheduling?.enabled) {
      throw new Error('Scheduling is not enabled for this workflow');
    }

    const scheduling = config.scheduling;
    
    // Validate cron expression
    if (!cron.validate(scheduling.cronExpression)) {
      throw new Error(`Invalid cron expression: ${scheduling.cronExpression}`);
    }

    // Stop existing schedule if any
    if (this.scheduledTasks.has(workflowId)) {
      await this.unscheduleWorkflow(workflowId);
    }

    this.logger.info(`Scheduling workflow ${workflowId} with cron: ${scheduling.cronExpression}`);

    // Create scheduled task
    const task = cron.schedule(
      scheduling.cronExpression,
      async () => {
        await this.executeScheduledWorkflow(workflowId, config);
      },
      {
        timezone: scheduling.timezone || 'America/New_York',
        scheduled: true
      }
    );

    this.scheduledTasks.set(workflowId, task);
    
    // Send notification if configured
    if (scheduling.notifyBeforeRun && scheduling.notificationLeadTime) {
      this.scheduleNotification(workflowId, scheduling);
    }

    this.emit('workflow-scheduled', { workflowId, config });
    
    // Save schedule configuration
    await this.saveScheduleConfig(workflowId, config);
  }

  /**
   * Unschedule a workflow
   */
  async unscheduleWorkflow(workflowId: string): Promise<void> {
    const task = this.scheduledTasks.get(workflowId);
    if (task) {
      task.stop();
      this.scheduledTasks.delete(workflowId);
      this.logger.info(`Unscheduled workflow: ${workflowId}`);
      this.emit('workflow-unscheduled', { workflowId });
    }
  }

  /**
   * Execute scheduled workflow
   */
  private async executeScheduledWorkflow(
    workflowId: string,
    config: WorkflowConfig
  ): Promise<void> {
    try {
      // Check concurrent run limit
      if (this.runningWorkflows.size >= this.schedulerConfig.maxConcurrentRuns) {
        this.logger.warn(`Max concurrent runs reached. Skipping execution of ${workflowId}`);
        this.emit('execution-skipped', { workflowId, reason: 'max-concurrent-runs' });
        return;
      }

      this.logger.info(`Starting scheduled execution of workflow: ${workflowId}`);
      this.emit('execution-started', { workflowId });

      // Create workflow orchestrator
      const orchestrator = new DNCWorkflowOrchestrator(config);
      this.runningWorkflows.set(workflowId, orchestrator);

      // Set up event forwarding
      orchestrator.on('dealership-start', (data) => 
        this.emit('workflow-progress', { workflowId, event: 'dealership-start', data })
      );
      orchestrator.on('dealership-complete', (data) => 
        this.emit('workflow-progress', { workflowId, event: 'dealership-complete', data })
      );
      orchestrator.on('2fa-required', (data) => 
        this.emit('workflow-2fa-required', { workflowId, data })
      );

      // Execute workflow
      const results = await orchestrator.execute();

      // Record execution history
      await this.recordExecution(workflowId, results);

      this.logger.info(`Completed scheduled execution of workflow: ${workflowId}`);
      this.emit('execution-completed', { workflowId, results });

    } catch (error) {
      this.logger.error(`Failed to execute scheduled workflow ${workflowId}: ${error}`);
      this.emit('execution-failed', { workflowId, error });
      
      // Record failed execution
      await this.recordExecution(workflowId, [{
        dealershipId: 'unknown',
        dealershipName: 'unknown',
        success: false,
        startTime: new Date(),
        endTime: new Date(),
        duration: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
        taskResults: new Map()
      }]);

    } finally {
      this.runningWorkflows.delete(workflowId);
    }
  }

  /**
   * Schedule notification before workflow execution
   */
  private scheduleNotification(
    workflowId: string,
    scheduling: SchedulingConfig
  ): void {
    const notificationCron = this.calculateNotificationCron(
      scheduling.cronExpression,
      scheduling.notificationLeadTime || 30
    );

    if (notificationCron) {
      cron.schedule(
        notificationCron,
        () => {
          this.emit('workflow-notification', {
            workflowId,
            message: `Workflow ${workflowId} will run in ${scheduling.notificationLeadTime} minutes`,
            runTime: this.getNextRunTime(workflowId)
          });
        },
        {
          timezone: scheduling.timezone || 'America/New_York'
        }
      );
    }
  }

  /**
   * Calculate notification cron expression
   */
  private calculateNotificationCron(
    originalCron: string,
    leadTimeMinutes: number
  ): string | null {
    // This is a simplified implementation
    // In production, you'd want a more sophisticated cron parser
    try {
      const parts = originalCron.split(' ');
      const minutes = parseInt(parts[0]);
      const notificationMinutes = minutes - leadTimeMinutes;
      
      if (notificationMinutes >= 0) {
        parts[0] = notificationMinutes.toString();
        return parts.join(' ');
      }
      
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get next run time for a workflow
   */
  getNextRunTime(workflowId: string): Date | null {
    const task = this.scheduledTasks.get(workflowId);
    if (!task) return null;

    // This would require parsing the cron expression
    // For now, return a placeholder
    return new Date(Date.now() + 24 * 60 * 60 * 1000); // Next day
  }

  /**
   * Get all scheduled workflows
   */
  getScheduledWorkflows(): Array<{
    workflowId: string;
    isRunning: boolean;
    nextRun: Date | null;
  }> {
    return Array.from(this.scheduledTasks.keys()).map(workflowId => ({
      workflowId,
      isRunning: this.runningWorkflows.has(workflowId),
      nextRun: this.getNextRunTime(workflowId)
    }));
  }

  /**
   * Record execution history
   */
  private async recordExecution(
    workflowId: string,
    results: WorkflowExecutionResult[]
  ): Promise<void> {
    const execution = {
      workflowId,
      timestamp: new Date(),
      results,
      success: results.every(r => r.success),
      totalDealerships: results.length,
      successfulDealerships: results.filter(r => r.success).length
    };

    this.executionHistory.push(execution as any);

    // Keep only last 100 executions
    if (this.executionHistory.length > 100) {
      this.executionHistory = this.executionHistory.slice(-100);
    }

    await this.saveExecutionHistory();
  }

  /**
   * Load execution history
   */
  private async loadExecutionHistory(): Promise<void> {
    try {
      if (await fs.pathExists(this.historyFile)) {
        this.executionHistory = await fs.readJson(this.historyFile);
        this.logger.info(`Loaded ${this.executionHistory.length} execution history records`);
      }
    } catch (error) {
      this.logger.error(`Failed to load execution history: ${error}`);
    }
  }

  /**
   * Save execution history
   */
  private async saveExecutionHistory(): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.historyFile));
      await fs.writeJson(this.historyFile, this.executionHistory, { spaces: 2 });
    } catch (error) {
      this.logger.error(`Failed to save execution history: ${error}`);
    }
  }

  /**
   * Save schedule configuration
   */
  private async saveScheduleConfig(
    workflowId: string,
    config: WorkflowConfig
  ): Promise<void> {
    const configFile = path.join(
      this.schedulerConfig.historyDir,
      'schedules',
      `${workflowId}.json`
    );

    try {
      await fs.ensureDir(path.dirname(configFile));
      await fs.writeJson(configFile, {
        workflowId,
        config,
        createdAt: new Date(),
        updatedAt: new Date()
      }, { spaces: 2 });
    } catch (error) {
      this.logger.error(`Failed to save schedule config: ${error}`);
    }
  }

  /**
   * Load all saved schedules
   */
  async loadSavedSchedules(): Promise<void> {
    const schedulesDir = path.join(this.schedulerConfig.historyDir, 'schedules');
    
    try {
      if (!await fs.pathExists(schedulesDir)) {
        return;
      }

      const files = await fs.readdir(schedulesDir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const configPath = path.join(schedulesDir, file);
          const data = await fs.readJson(configPath);
          
          if (data.config?.scheduling?.enabled) {
            await this.scheduleWorkflow(data.workflowId, data.config);
            this.logger.info(`Restored schedule for workflow: ${data.workflowId}`);
          }
        }
      }
    } catch (error) {
      this.logger.error(`Failed to load saved schedules: ${error}`);
    }
  }

  /**
   * Get execution history
   */
  getExecutionHistory(limit: number = 50): any[] {
    return this.executionHistory.slice(-limit);
  }

  /**
   * Stop all scheduled workflows
   */
  async stopAll(): Promise<void> {
    this.logger.info('Stopping all scheduled workflows...');
    
    // Stop all scheduled tasks
    for (const [workflowId, task] of this.scheduledTasks) {
      task.stop();
      this.logger.info(`Stopped scheduled task: ${workflowId}`);
    }
    
    this.scheduledTasks.clear();
    
    // Wait for running workflows to complete
    if (this.runningWorkflows.size > 0) {
      this.logger.info(`Waiting for ${this.runningWorkflows.size} running workflows to complete...`);
      
      // In production, you'd want to implement proper graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    this.emit('scheduler-stopped');
  }
}