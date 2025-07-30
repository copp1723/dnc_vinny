import { Logger } from '../utils/Logger';
import { Page } from 'playwright';

export interface TaskConfig {
  id: string;
  name: string;
  description: string;
  dependencies: string[];
  timeout?: number;
  retryCount?: number;
  critical?: boolean; // If true, failure stops entire flow
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  startTime: Date;
  endTime: Date;
  duration: number;
  data?: any;
  error?: string;
  retryCount?: number;
}

export interface TaskContext {
  page: Page;
  results: Map<string, TaskResult>;
  config: any;
  logger: Logger;
}

export type TaskFunction = (context: TaskContext) => Promise<any>;

export interface TaskDefinition extends TaskConfig {
  execute: TaskFunction;
}

/**
 * Task Orchestrator for Waterfall/Domino Automation
 * 
 * This orchestrator runs tasks in sequence, with each task depending on previous ones.
 * Perfect for protecting critical flows like 2FA while allowing flexible task composition.
 */
export class TaskOrchestrator {
  private logger: Logger;
  private tasks: Map<string, TaskDefinition> = new Map();
  private results: Map<string, TaskResult> = new Map();

  constructor(private name: string) {
    this.logger = new Logger(`TaskOrchestrator-${name}`);
  }

  /**
   * Register a task with the orchestrator
   */
  registerTask(task: TaskDefinition): void {
    this.tasks.set(task.id, task);
    this.logger.info(`📋 Registered task: ${task.id} - ${task.name}`);
  }

  /**
   * Get a task definition by its ID
   * @param taskId The ID of the task to retrieve
   * @returns The task definition, or undefined if not found
   */
  getTask(taskId: string): TaskDefinition | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Execute all tasks in dependency order
   */
  async executeAll(page: Page, config: any): Promise<Map<string, TaskResult>> {
    this.logger.info(`🚀 Starting task orchestration: ${this.name}`);
    this.results.clear();

    const context: TaskContext = {
      page,
      results: this.results,
      config,
      logger: this.logger
    };

    // Build execution order based on dependencies
    const executionOrder = this.buildExecutionOrder();
    
    this.logger.info(`📊 Execution order: ${executionOrder.join(' → ')}`);

    // Execute tasks in order
    for (const taskId of executionOrder) {
      const task = this.tasks.get(taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      // Check if dependencies are satisfied
      const depsSatisfied = await this.checkDependencies(task, context);
      if (!depsSatisfied) {
        const error = `Dependencies not satisfied for task: ${taskId}`;
        this.logger.error(error);
        
        this.results.set(taskId, {
          taskId,
          success: false,
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
          error
        });

        if (task.critical) {
          throw new Error(`Critical task failed: ${taskId}`);
        }
        continue;
      }

      // Execute the task
      const result = await this.executeTask(task, context);
      this.results.set(taskId, result);

      // Stop if critical task failed
      if (!result.success && task.critical) {
        this.logger.error(`❌ Critical task failed: ${taskId}`);
        throw new Error(`Critical task failed: ${taskId} - ${result.error}`);
      }

      // Log progress
      const completed = Array.from(this.results.values()).filter(r => r.success).length;
      const total = executionOrder.length;
      this.logger.info(`📈 Progress: ${completed}/${total} tasks completed`);
    }

    this.logger.info(`✅ Task orchestration completed: ${this.name}`);
    return this.results;
  }

  /**
   * Execute a specific task only (useful for testing individual tasks)
   */
  async executeTask(task: TaskDefinition, context: TaskContext): Promise<TaskResult> {
    const startTime = new Date();
    let retryCount = 0;
    const maxRetries = task.retryCount || 0;

    this.logger.info(`🔄 Starting task: ${task.id} - ${task.name}`);

    while (retryCount <= maxRetries) {
      try {
        // Set timeout if specified
        const timeoutMs = task.timeout || 300000; // 5 minutes default
        
        const executePromise = task.execute(context);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Task timeout: ${task.id}`)), timeoutMs);
        });

        const data = await Promise.race([executePromise, timeoutPromise]);

        const endTime = new Date();
        const duration = endTime.getTime() - startTime.getTime();

        this.logger.info(`✅ Task completed: ${task.id} (${duration}ms)`);

        return {
          taskId: task.id,
          success: true,
          startTime,
          endTime,
          duration,
          data,
          retryCount
        };

      } catch (error) {
        retryCount++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        this.logger.warn(`⚠️ Task failed (attempt ${retryCount}/${maxRetries + 1}): ${task.id} - ${errorMessage}`);

        if (retryCount > maxRetries) {
          const endTime = new Date();
          const duration = endTime.getTime() - startTime.getTime();

          this.logger.error(`❌ Task failed after ${retryCount} attempts: ${task.id}`);

          return {
            taskId: task.id,
            success: false,
            startTime,
            endTime,
            duration,
            error: errorMessage,
            retryCount
          };
        }

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    throw new Error('Should not reach here');
  }

  /**
   * Build execution order based on task dependencies
   */
  private buildExecutionOrder(): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const order: string[] = [];

    const visit = (taskId: string) => {
      if (visiting.has(taskId)) {
        throw new Error(`Circular dependency detected involving task: ${taskId}`);
      }
      
      if (visited.has(taskId)) {
        return;
      }

      const task = this.tasks.get(taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      visiting.add(taskId);

      // Visit dependencies first
      for (const depId of task.dependencies) {
        visit(depId);
      }

      visiting.delete(taskId);
      visited.add(taskId);
      order.push(taskId);
    };

    // Visit all tasks
    for (const taskId of Array.from(this.tasks.keys())) {
      visit(taskId);
    }

    return order;
  }

  /**
   * Check if task dependencies are satisfied
   */
  private async checkDependencies(task: TaskDefinition, context: TaskContext): Promise<boolean> {
    for (const depId of task.dependencies) {
      const depResult = this.results.get(depId);
      if (!depResult || !depResult.success) {
        this.logger.warn(`Dependency not satisfied: ${depId} for task ${task.id}`);
        return false;
      }
    }
    return true;
  }

  /**
   * Get results for a specific task
   */
  getTaskResult(taskId: string): TaskResult | undefined {
    return this.results.get(taskId);
  }

  /**
   * Get all results
   */
  getAllResults(): Map<string, TaskResult> {
    return new Map(this.results);
  }

  /**
   * Generate execution summary
   */
  generateSummary(): string {
    const results = Array.from(this.results.values());
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

    let summary = `\n📊 Task Orchestration Summary: ${this.name}\n`;
    summary += `==================================================\n`;
    summary += `✅ Successful: ${successful}\n`;
    summary += `❌ Failed: ${failed}\n`;
    summary += `⏱️ Total Time: ${(totalTime / 1000).toFixed(1)}s\n\n`;

    summary += `📋 Task Details:\n`;
    for (const result of results) {
      const status = result.success ? '✅' : '❌';
      const duration = (result.duration / 1000).toFixed(1);
      summary += `${status} ${result.taskId}: ${duration}s`;
      if (result.error) {
        summary += ` (${result.error})`;
      }
      summary += '\n';
    }

    return summary;
  }
} 