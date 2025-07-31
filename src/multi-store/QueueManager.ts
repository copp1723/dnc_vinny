import { EventEmitter } from 'events';
import { StoreConfig, StorePriority } from './StoreRegistry';
import { logger } from '../../priority5-compliance/logger';

export interface QueuedStore {
  store: StoreConfig;
  queuedAt: Date;
  priority: number; // Numeric priority for sorting
  attempts: number;
  lastAttempt?: Date;
  nextRetry?: Date;
}

export interface QueueStatistics {
  totalQueued: number;
  byPriority: Record<StorePriority, number>;
  averageWaitTime: number;
  processingRate: number;
  estimatedCompletionTime: Date | null;
}

export class QueueManager extends EventEmitter {
  private queues: Map<StorePriority, QueuedStore[]> = new Map();
  private processingHistory: Array<{
    storeId: string;
    queuedAt: Date;
    startedAt: Date;
    completedAt?: Date;
  }> = [];
  private maxQueueSize: number = 1000;
  private retryDelays: number[] = [60000, 300000, 900000]; // 1min, 5min, 15min

  constructor() {
    super();
    
    // Initialize priority queues
    this.queues.set(StorePriority.HIGH, []);
    this.queues.set(StorePriority.MEDIUM, []);
    this.queues.set(StorePriority.LOW, []);
  }

  /**
   * Enqueue a store for processing
   */
  async enqueueStore(store: StoreConfig, attempts: number = 0): Promise<void> {
    const queue = this.queues.get(store.priority);
    if (!queue) {
      throw new Error(`Invalid store priority: ${store.priority}`);
    }

    // Check queue size limit
    const totalQueued = this.getTotalQueuedCount();
    if (totalQueued >= this.maxQueueSize) {
      throw new Error('Queue is full');
    }

    // Check if store is already queued
    const existingIndex = queue.findIndex(q => q.store.id === store.id);
    if (existingIndex !== -1) {
      logger.warn(`Store ${store.name} is already queued`);
      return;
    }

    const queuedStore: QueuedStore = {
      store,
      queuedAt: new Date(),
      priority: this.calculateNumericPriority(store),
      attempts,
      lastAttempt: attempts > 0 ? new Date() : undefined,
      nextRetry: attempts > 0 ? this.calculateNextRetry(attempts) : undefined,
    };

    queue.push(queuedStore);
    
    // Sort queue by numeric priority (higher priority first)
    queue.sort((a, b) => b.priority - a.priority);

    logger.info(`📥 Enqueued store: ${store.name} (Priority: ${store.priority}, Queue size: ${queue.length})`);
    this.emit('storeEnqueued', { store, queueLength: this.getTotalQueuedCount() });
  }

  /**
   * Dequeue the next store for processing
   */
  async dequeueStore(): Promise<QueuedStore | null> {
    const now = new Date();

    // Check high priority queue first
    for (const priority of [StorePriority.HIGH, StorePriority.MEDIUM, StorePriority.LOW]) {
      const queue = this.queues.get(priority)!;
      
      // Find first store that's ready to process
      const readyIndex = queue.findIndex(q => 
        !q.nextRetry || q.nextRetry <= now
      );

      if (readyIndex !== -1) {
        const [queuedStore] = queue.splice(readyIndex, 1);
        
        // Record in processing history
        this.processingHistory.push({
          storeId: queuedStore.store.id,
          queuedAt: queuedStore.queuedAt,
          startedAt: now,
        });

        logger.info(`📤 Dequeued store: ${queuedStore.store.name} (Wait time: ${this.formatDuration(now.getTime() - queuedStore.queuedAt.getTime())})`);
        this.emit('storeDequeued', { store: queuedStore.store, waitTime: now.getTime() - queuedStore.queuedAt.getTime() });
        
        return queuedStore;
      }
    }

    return null;
  }

  /**
   * Requeue a store after failure
   */
  async requeueStore(store: StoreConfig, previousAttempts: number): Promise<void> {
    if (previousAttempts >= this.retryDelays.length) {
      logger.error(`Store ${store.name} exceeded maximum retry attempts`);
      this.emit('storeMaxRetriesExceeded', { store, attempts: previousAttempts });
      return;
    }

    await this.enqueueStore(store, previousAttempts + 1);
    logger.info(`🔄 Requeued store: ${store.name} (Attempt ${previousAttempts + 1})`);
  }

  /**
   * Remove a store from queue
   */
  removeFromQueue(storeId: string): boolean {
    for (const [priority, queue] of this.queues) {
      const index = queue.findIndex(q => q.store.id === storeId);
      if (index !== -1) {
        const [removed] = queue.splice(index, 1);
        logger.info(`🗑️ Removed store from queue: ${removed.store.name}`);
        this.emit('storeRemovedFromQueue', { store: removed.store });
        return true;
      }
    }
    return false;
  }

  /**
   * Clear all queues
   */
  clearQueues(): void {
    let totalCleared = 0;
    for (const queue of this.queues.values()) {
      totalCleared += queue.length;
      queue.length = 0;
    }
    
    logger.info(`🧹 Cleared ${totalCleared} stores from all queues`);
    this.emit('queuesCleared', { count: totalCleared });
  }

  /**
   * Get queue length
   */
  getQueueLength(priority?: StorePriority): number {
    if (priority) {
      return this.queues.get(priority)?.length || 0;
    }
    return this.getTotalQueuedCount();
  }

  /**
   * Check if there are stores in queue
   */
  hasStores(): boolean {
    return this.getTotalQueuedCount() > 0;
  }

  /**
   * Get all queued stores
   */
  getQueuedStores(priority?: StorePriority): QueuedStore[] {
    if (priority) {
      return [...(this.queues.get(priority) || [])];
    }

    const allStores: QueuedStore[] = [];
    for (const queue of this.queues.values()) {
      allStores.push(...queue);
    }
    
    return allStores.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get stores ready for processing
   */
  getReadyStores(): QueuedStore[] {
    const now = new Date();
    const readyStores: QueuedStore[] = [];

    for (const queue of this.queues.values()) {
      const ready = queue.filter(q => !q.nextRetry || q.nextRetry <= now);
      readyStores.push(...ready);
    }

    return readyStores.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get queue statistics
   */
  getStatistics(): QueueStatistics {
    const now = new Date();
    const totalQueued = this.getTotalQueuedCount();
    
    // Calculate average wait time from recent history
    const recentHistory = this.processingHistory.slice(-50);
    let totalWaitTime = 0;
    let completedCount = 0;

    for (const entry of recentHistory) {
      if (entry.startedAt) {
        totalWaitTime += entry.startedAt.getTime() - entry.queuedAt.getTime();
        completedCount++;
      }
    }

    const averageWaitTime = completedCount > 0 ? totalWaitTime / completedCount : 0;

    // Calculate processing rate (stores per hour)
    const hourAgo = new Date(now.getTime() - 3600000);
    const processedLastHour = this.processingHistory.filter(h => 
      h.startedAt && h.startedAt >= hourAgo
    ).length;

    // Estimate completion time
    let estimatedCompletionTime: Date | null = null;
    if (processedLastHour > 0 && totalQueued > 0) {
      const hoursToComplete = totalQueued / processedLastHour;
      estimatedCompletionTime = new Date(now.getTime() + (hoursToComplete * 3600000));
    }

    return {
      totalQueued,
      byPriority: {
        [StorePriority.HIGH]: this.queues.get(StorePriority.HIGH)!.length,
        [StorePriority.MEDIUM]: this.queues.get(StorePriority.MEDIUM)!.length,
        [StorePriority.LOW]: this.queues.get(StorePriority.LOW)!.length,
      },
      averageWaitTime,
      processingRate: processedLastHour,
      estimatedCompletionTime,
    };
  }

  /**
   * Mark store processing as completed
   */
  markCompleted(storeId: string): void {
    const now = new Date();
    const entry = this.processingHistory.find(h => 
      h.storeId === storeId && !h.completedAt
    );

    if (entry) {
      entry.completedAt = now;
      const processingTime = now.getTime() - entry.startedAt.getTime();
      logger.debug(`✅ Store ${storeId} processing completed in ${this.formatDuration(processingTime)}`);
    }
  }

  /**
   * Reorder queue based on new priorities
   */
  reorderQueues(): void {
    for (const queue of this.queues.values()) {
      queue.sort((a, b) => b.priority - a.priority);
    }
    
    logger.info('🔄 Reordered all queues by priority');
    this.emit('queuesReordered');
  }

  /**
   * Calculate numeric priority for sorting
   */
  private calculateNumericPriority(store: StoreConfig): number {
    let basePriority = 0;
    
    switch (store.priority) {
      case StorePriority.HIGH:
        basePriority = 1000;
        break;
      case StorePriority.MEDIUM:
        basePriority = 500;
        break;
      case StorePriority.LOW:
        basePriority = 100;
        break;
    }

    // Adjust based on failure count (lower priority for stores with more failures)
    basePriority -= store.metadata.failureCount * 10;

    // Adjust based on last processed time (boost stores that haven't been processed recently)
    if (store.metadata.lastProcessed) {
      const daysSinceProcessed = (Date.now() - store.metadata.lastProcessed.getTime()) / (1000 * 60 * 60 * 24);
      basePriority += Math.min(daysSinceProcessed * 5, 100);
    }

    return Math.max(basePriority, 0);
  }

  /**
   * Calculate next retry time
   */
  private calculateNextRetry(attempts: number): Date {
    const delayIndex = Math.min(attempts - 1, this.retryDelays.length - 1);
    const delay = this.retryDelays[delayIndex];
    return new Date(Date.now() + delay);
  }

  /**
   * Get total queued count
   */
  private getTotalQueuedCount(): number {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.length;
    }
    return total;
  }

  /**
   * Format duration for logging
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(1)}s`;
    } else if (ms < 3600000) {
      return `${(ms / 60000).toFixed(1)}m`;
    } else {
      return `${(ms / 3600000).toFixed(1)}h`;
    }
  }

  /**
   * Clean up old processing history
   */
  cleanupHistory(retentionHours: number = 24): void {
    const cutoffTime = new Date(Date.now() - (retentionHours * 3600000));
    const originalLength = this.processingHistory.length;
    
    this.processingHistory = this.processingHistory.filter(h => 
      h.queuedAt >= cutoffTime
    );

    const removed = originalLength - this.processingHistory.length;
    if (removed > 0) {
      logger.info(`🧹 Cleaned up ${removed} old processing history entries`);
    }
  }

  /**
   * Export queue state
   */
  exportState(): {
    queues: Record<StorePriority, QueuedStore[]>;
    statistics: QueueStatistics;
    processingHistory: typeof this.processingHistory;
  } {
    return {
      queues: {
        [StorePriority.HIGH]: [...this.queues.get(StorePriority.HIGH)!],
        [StorePriority.MEDIUM]: [...this.queues.get(StorePriority.MEDIUM)!],
        [StorePriority.LOW]: [...this.queues.get(StorePriority.LOW)!],
      },
      statistics: this.getStatistics(),
      processingHistory: [...this.processingHistory],
    };
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.clearQueues();
    this.processingHistory = [];
    this.removeAllListeners();
  }
}