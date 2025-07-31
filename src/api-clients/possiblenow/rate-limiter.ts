/**
 * Rate Limiter for PossibleNOW API
 * Implements token bucket algorithm with multiple time windows
 */

import { PossibleNOWConfig, RateLimitInfo } from './types';
import { logger } from '../../../priority5-compliance/logger';

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  capacity: number;
  refillRate: number;
}

export class RateLimiter {
  private buckets: {
    second?: TokenBucket;
    minute?: TokenBucket;
    hour?: TokenBucket;
  } = {};

  constructor(private config: PossibleNOWConfig) {
    this.initializeBuckets();
  }

  /**
   * Initializes token buckets based on configuration
   */
  private initializeBuckets(): void {
    const limits = this.config.rateLimits;
    
    if (limits?.requestsPerSecond) {
      this.buckets.second = {
        tokens: limits.requestsPerSecond,
        lastRefill: Date.now(),
        capacity: limits.requestsPerSecond,
        refillRate: limits.requestsPerSecond
      };
    }

    if (limits?.requestsPerMinute) {
      this.buckets.minute = {
        tokens: limits.requestsPerMinute,
        lastRefill: Date.now(),
        capacity: limits.requestsPerMinute,
        refillRate: limits.requestsPerMinute / 60
      };
    }

    if (limits?.requestsPerHour) {
      this.buckets.hour = {
        tokens: limits.requestsPerHour,
        lastRefill: Date.now(),
        capacity: limits.requestsPerHour,
        refillRate: limits.requestsPerHour / 3600
      };
    }
  }

  /**
   * Checks if a request can be made and consumes a token if possible
   */
  async checkAndConsume(): Promise<boolean> {
    // Refill all buckets
    this.refillBuckets();

    // Check if all buckets have tokens
    for (const [period, bucket] of Object.entries(this.buckets)) {
      if (bucket && bucket.tokens < 1) {
        logger.warn('Rate limit exceeded', {
          period,
          tokens: bucket.tokens,
          capacity: bucket.capacity
        });
        return false;
      }
    }

    // Consume one token from each bucket
    for (const bucket of Object.values(this.buckets)) {
      if (bucket) {
        bucket.tokens -= 1;
      }
    }

    return true;
  }

  /**
   * Waits until a request can be made
   */
  async waitForCapacity(): Promise<void> {
    while (!(await this.checkAndConsume())) {
      // Calculate minimum wait time
      const waitTime = this.getMinimumWaitTime();
      
      logger.debug('Waiting for rate limit capacity', {
        waitTimeMs: waitTime
      });

      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  /**
   * Gets current rate limit information
   */
  getRateLimitInfo(): RateLimitInfo {
    this.refillBuckets();

    // Find the most restrictive limit
    let minTokens = Infinity;
    let limitingBucket: TokenBucket | null = null;
    let limitingPeriod = '';

    for (const [period, bucket] of Object.entries(this.buckets)) {
      if (bucket && bucket.tokens < minTokens) {
        minTokens = bucket.tokens;
        limitingBucket = bucket;
        limitingPeriod = period;
      }
    }

    if (!limitingBucket) {
      return {
        limit: 0,
        remaining: Infinity,
        reset: 0
      };
    }

    // Calculate reset time based on limiting period
    let resetMs = 1000; // Default 1 second
    switch (limitingPeriod) {
      case 'second':
        resetMs = 1000;
        break;
      case 'minute':
        resetMs = 60000;
        break;
      case 'hour':
        resetMs = 3600000;
        break;
    }

    return {
      limit: limitingBucket.capacity,
      remaining: Math.floor(limitingBucket.tokens),
      reset: Date.now() + resetMs
    };
  }

  /**
   * Updates rate limits from API response headers
   */
  updateFromHeaders(headers: Record<string, string>): void {
    const remaining = headers['x-ratelimit-remaining'];
    const limit = headers['x-ratelimit-limit'];
    const reset = headers['x-ratelimit-reset'];

    if (remaining && limit) {
      logger.debug('Updating rate limits from API headers', {
        remaining,
        limit,
        reset
      });

      // Update the most appropriate bucket based on the limit value
      const limitNum = parseInt(limit);
      const remainingNum = parseInt(remaining);

      // Try to match with configured buckets
      for (const bucket of Object.values(this.buckets)) {
        if (bucket && bucket.capacity === limitNum) {
          bucket.tokens = Math.min(bucket.tokens, remainingNum);
          break;
        }
      }
    }
  }

  /**
   * Refills token buckets based on elapsed time
   */
  private refillBuckets(): void {
    const now = Date.now();

    for (const [period, bucket] of Object.entries(this.buckets)) {
      if (!bucket) continue;

      const elapsed = (now - bucket.lastRefill) / 1000; // Convert to seconds
      const tokensToAdd = elapsed * bucket.refillRate;

      bucket.tokens = Math.min(bucket.capacity, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }
  }

  /**
   * Calculates minimum wait time until next token is available
   */
  private getMinimumWaitTime(): number {
    let minWait = Infinity;

    for (const bucket of Object.values(this.buckets)) {
      if (!bucket || bucket.tokens >= 1) continue;

      const tokensNeeded = 1 - bucket.tokens;
      const waitTime = (tokensNeeded / bucket.refillRate) * 1000; // Convert to ms

      minWait = Math.min(minWait, waitTime);
    }

    // Add small buffer to avoid race conditions
    return minWait === Infinity ? 100 : Math.ceil(minWait) + 50;
  }

  /**
   * Resets all rate limit buckets
   */
  reset(): void {
    this.initializeBuckets();
  }

  /**
   * Gets current bucket states for monitoring
   */
  getBucketStates(): Record<string, {
    tokens: number;
    capacity: number;
    percentFull: number;
  }> {
    this.refillBuckets();

    const states: Record<string, any> = {};

    for (const [period, bucket] of Object.entries(this.buckets)) {
      if (bucket) {
        states[period] = {
          tokens: Math.floor(bucket.tokens),
          capacity: bucket.capacity,
          percentFull: (bucket.tokens / bucket.capacity) * 100
        };
      }
    }

    return states;
  }
}