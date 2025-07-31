import { EventEmitter } from 'events';
import { ProgressInfo } from './types';

/**
 * Workflow Progress Tracker
 * Tracks progress and estimates time remaining
 */
export class WorkflowProgressTracker extends EventEmitter {
  private stage: string = 'initializing';
  private current: number = 0;
  private total: number = 0;
  private startTime: number = Date.now();
  private stageStartTime: number = Date.now();
  private processedItems: Array<{ timestamp: number; count: number }> = [];
  private readonly windowSize = 20; // Rolling window for rate calculation

  /**
   * Update current stage
   */
  updateStage(stage: string): void {
    this.stage = stage;
    this.stageStartTime = Date.now();
    this.current = 0;
    this.total = 0;
    this.processedItems = [];
    
    this.emit('stage-changed', { stage });
  }

  /**
   * Update total items for current stage
   */
  updateTotal(total: number): void {
    this.total = total;
    this.emit('total-updated', { total });
  }

  /**
   * Update progress
   */
  updateProgress(current: number): void {
    this.current = current;
    
    // Track for rate calculation
    this.processedItems.push({
      timestamp: Date.now(),
      count: current
    });

    // Keep only recent items for rolling window
    if (this.processedItems.length > this.windowSize) {
      this.processedItems.shift();
    }

    const progress = this.getProgress();
    this.emit('progress-updated', progress);
  }

  /**
   * Increment progress by amount
   */
  incrementProgress(amount: number = 1): void {
    this.updateProgress(this.current + amount);
  }

  /**
   * Get current progress information
   */
  getProgress(): ProgressInfo {
    const percentage = this.total > 0 ? (this.current / this.total) * 100 : 0;
    const processingRate = this.calculateProcessingRate();
    const estimatedTimeRemaining = this.calculateETA(processingRate);

    return {
      stage: this.stage,
      current: this.current,
      total: this.total,
      percentage,
      estimatedTimeRemaining,
      processingRate
    };
  }

  /**
   * Calculate processing rate (items per second)
   */
  private calculateProcessingRate(): number {
    if (this.processedItems.length < 2) {
      return 0;
    }

    const recent = this.processedItems.slice(-10); // Use last 10 items
    const timeSpan = recent[recent.length - 1].timestamp - recent[0].timestamp;
    const itemsProcessed = recent[recent.length - 1].count - recent[0].count;

    if (timeSpan === 0) {
      return 0;
    }

    return (itemsProcessed / timeSpan) * 1000; // Convert to per second
  }

  /**
   * Calculate estimated time remaining
   */
  private calculateETA(processingRate: number): number {
    if (processingRate === 0 || this.current >= this.total) {
      return 0;
    }

    const remaining = this.total - this.current;
    return Math.ceil(remaining / processingRate) * 1000; // Convert to milliseconds
  }

  /**
   * Get formatted progress string
   */
  getProgressString(): string {
    const progress = this.getProgress();
    const etaString = this.formatDuration(progress.estimatedTimeRemaining);
    const rateString = progress.processingRate.toFixed(1);

    return `Stage: ${progress.stage} | Progress: ${progress.current}/${progress.total} (${progress.percentage.toFixed(1)}%) | Rate: ${rateString}/s | ETA: ${etaString}`;
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(milliseconds: number): string {
    if (milliseconds === 0) {
      return 'calculating...';
    }

    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      const remainingMinutes = minutes % 60;
      return `${hours}h ${remainingMinutes}m`;
    } else if (minutes > 0) {
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Get detailed statistics
   */
  getStatistics(): any {
    const elapsedTime = Date.now() - this.startTime;
    const stageElapsedTime = Date.now() - this.stageStartTime;
    const averageRate = this.current > 0 ? this.current / (stageElapsedTime / 1000) : 0;

    return {
      stage: this.stage,
      current: this.current,
      total: this.total,
      percentage: this.total > 0 ? (this.current / this.total) * 100 : 0,
      elapsedTime,
      stageElapsedTime,
      averageRate,
      currentRate: this.calculateProcessingRate(),
      estimatedTimeRemaining: this.calculateETA(this.calculateProcessingRate()),
      startTime: new Date(this.startTime),
      stageStartTime: new Date(this.stageStartTime)
    };
  }

  /**
   * Reset tracker
   */
  reset(): void {
    this.stage = 'initializing';
    this.current = 0;
    this.total = 0;
    this.startTime = Date.now();
    this.stageStartTime = Date.now();
    this.processedItems = [];
    
    this.emit('reset');
  }

  /**
   * Create progress bar string
   */
  getProgressBar(width: number = 30): string {
    const percentage = this.total > 0 ? this.current / this.total : 0;
    const filled = Math.floor(percentage * width);
    const empty = width - filled;
    
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const percentStr = `${(percentage * 100).toFixed(1)}%`.padStart(6);
    
    return `[${bar}] ${percentStr}`;
  }

  /**
   * Export progress data for monitoring
   */
  exportMetrics(): any {
    return {
      timestamp: new Date(),
      stage: this.stage,
      progress: this.getProgress(),
      statistics: this.getStatistics(),
      recentItems: this.processedItems.slice(-5)
    };
  }
}