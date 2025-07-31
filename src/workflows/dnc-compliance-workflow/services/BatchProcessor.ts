import { Logger } from '../../../../utils/Logger';
import { BatchProcessingResult } from '../types';

/**
 * Batch processor for handling large datasets
 */
export class BatchProcessor {
  constructor(
    private batchSize: number,
    private logger: Logger
  ) {}

  /**
   * Process items in batches
   */
  async processBatches<T, R>(
    items: T[],
    processFn: (batch: T[]) => Promise<R>,
    options: {
      onProgress?: (processed: number, total: number) => void;
      onBatchComplete?: (batchIndex: number, result: R) => Promise<void>;
      onBatchError?: (batchIndex: number, error: Error) => Promise<boolean>; // Return true to continue
      parallelBatches?: number;
    } = {}
  ): Promise<R[]> {
    const results: R[] = [];
    const totalBatches = Math.ceil(items.length / this.batchSize);
    let processedItems = 0;

    this.logger.info(`Processing ${items.length} items in ${totalBatches} batches of ${this.batchSize}`);

    if (options.parallelBatches && options.parallelBatches > 1) {
      // Parallel batch processing
      return this.processParallelBatches(items, processFn, options);
    }

    // Sequential batch processing
    for (let i = 0; i < totalBatches; i++) {
      const startIdx = i * this.batchSize;
      const endIdx = Math.min(startIdx + this.batchSize, items.length);
      const batch = items.slice(startIdx, endIdx);
      
      this.logger.info(`Processing batch ${i + 1}/${totalBatches} (${batch.length} items)`);
      
      try {
        const startTime = Date.now();
        const result = await processFn(batch);
        const duration = Date.now() - startTime;
        
        results.push(result);
        processedItems += batch.length;
        
        this.logger.info(`Batch ${i + 1} completed in ${duration}ms`);
        
        // Report progress
        if (options.onProgress) {
          options.onProgress(processedItems, items.length);
        }
        
        // Batch complete callback
        if (options.onBatchComplete) {
          await options.onBatchComplete(i, result);
        }
        
      } catch (error) {
        const err = error as Error;
        this.logger.error(`Batch ${i + 1} failed: ${err.message}`);
        
        // Handle batch error
        if (options.onBatchError) {
          const shouldContinue = await options.onBatchError(i, err);
          if (!shouldContinue) {
            throw error;
          }
        } else {
          throw error;
        }
      }
      
      // Small delay between batches to avoid overwhelming the system
      if (i < totalBatches - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return results;
  }

  /**
   * Process batches in parallel
   */
  private async processParallelBatches<T, R>(
    items: T[],
    processFn: (batch: T[]) => Promise<R>,
    options: any
  ): Promise<R[]> {
    const totalBatches = Math.ceil(items.length / this.batchSize);
    const parallelLimit = options.parallelBatches || 3;
    const results: R[] = new Array(totalBatches);
    let processedBatches = 0;
    let processedItems = 0;

    this.logger.info(`Processing ${totalBatches} batches in parallel (limit: ${parallelLimit})`);

    // Create batch tasks
    const batchTasks = Array.from({ length: totalBatches }, (_, i) => {
      const startIdx = i * this.batchSize;
      const endIdx = Math.min(startIdx + this.batchSize, items.length);
      return {
        index: i,
        batch: items.slice(startIdx, endIdx)
      };
    });

    // Process with concurrency limit
    const inProgress = new Set<Promise<void>>();
    
    for (const task of batchTasks) {
      // Wait if we've reached the parallel limit
      if (inProgress.size >= parallelLimit) {
        await Promise.race(inProgress);
      }
      
      const promise = this.processSingleBatch(
        task,
        processFn,
        results,
        options
      ).then(() => {
        processedBatches++;
        processedItems += task.batch.length;
        
        if (options.onProgress) {
          options.onProgress(processedItems, items.length);
        }
        
        inProgress.delete(promise);
      });
      
      inProgress.add(promise);
    }
    
    // Wait for all remaining batches
    await Promise.all(inProgress);
    
    return results;
  }

  /**
   * Process a single batch
   */
  private async processSingleBatch<T, R>(
    task: { index: number; batch: T[] },
    processFn: (batch: T[]) => Promise<R>,
    results: R[],
    options: any
  ): Promise<void> {
    try {
      const startTime = Date.now();
      const result = await processFn(task.batch);
      const duration = Date.now() - startTime;
      
      results[task.index] = result;
      
      this.logger.info(`Batch ${task.index + 1} completed in ${duration}ms`);
      
      if (options.onBatchComplete) {
        await options.onBatchComplete(task.index, result);
      }
      
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Batch ${task.index + 1} failed: ${err.message}`);
      
      if (options.onBatchError) {
        const shouldContinue = await options.onBatchError(task.index, err);
        if (!shouldContinue) {
          throw error;
        }
      } else {
        throw error;
      }
    }
  }

  /**
   * Split items into batches
   */
  createBatches<T>(items: T[]): T[][] {
    const batches: T[][] = [];
    const totalBatches = Math.ceil(items.length / this.batchSize);
    
    for (let i = 0; i < totalBatches; i++) {
      const startIdx = i * this.batchSize;
      const endIdx = Math.min(startIdx + this.batchSize, items.length);
      batches.push(items.slice(startIdx, endIdx));
    }
    
    return batches;
  }

  /**
   * Process items with retry logic
   */
  async processWithRetry<T, R>(
    items: T[],
    processFn: (item: T) => Promise<R>,
    options: {
      maxRetries?: number;
      retryDelay?: number;
      onItemError?: (item: T, error: Error, attempt: number) => Promise<boolean>;
    } = {}
  ): Promise<Array<{ item: T; result?: R; error?: Error }>> {
    const maxRetries = options.maxRetries || 3;
    const retryDelay = options.retryDelay || 1000;
    const results: Array<{ item: T; result?: R; error?: Error }> = [];
    
    for (const item of items) {
      let lastError: Error | undefined;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const result = await processFn(item);
          results.push({ item, result });
          break;
          
        } catch (error) {
          lastError = error as Error;
          this.logger.warn(`Processing failed (attempt ${attempt}/${maxRetries}): ${lastError.message}`);
          
          if (options.onItemError) {
            const shouldRetry = await options.onItemError(item, lastError, attempt);
            if (!shouldRetry) {
              results.push({ item, error: lastError });
              break;
            }
          }
          
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
          } else {
            results.push({ item, error: lastError });
          }
        }
      }
    }
    
    return results;
  }

  /**
   * Get batch statistics
   */
  getBatchStatistics<T>(items: T[]): {
    totalItems: number;
    batchSize: number;
    totalBatches: number;
    lastBatchSize: number;
  } {
    const totalItems = items.length;
    const totalBatches = Math.ceil(totalItems / this.batchSize);
    const lastBatchSize = totalItems % this.batchSize || this.batchSize;
    
    return {
      totalItems,
      batchSize: this.batchSize,
      totalBatches,
      lastBatchSize
    };
  }
}