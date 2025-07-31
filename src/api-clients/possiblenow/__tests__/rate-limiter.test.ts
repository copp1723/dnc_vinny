/**
 * Unit tests for Rate Limiter
 */

import { RateLimiter } from '../rate-limiter';
import { createConfig } from '../config';

jest.mock('../../../../priority5-compliance/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  const testConfig = createConfig({
    environment: 'sandbox',
    clientId: 'test',
    clientSecret: 'test',
    rateLimits: {
      requestsPerSecond: 2,
      requestsPerMinute: 10,
      requestsPerHour: 100
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    rateLimiter = new RateLimiter(testConfig);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('checkAndConsume', () => {
    it('should allow requests within rate limits', async () => {
      const result1 = await rateLimiter.checkAndConsume();
      const result2 = await rateLimiter.checkAndConsume();
      
      expect(result1).toBe(true);
      expect(result2).toBe(true);
    });

    it('should block requests exceeding per-second limit', async () => {
      // Consume all tokens
      await rateLimiter.checkAndConsume();
      await rateLimiter.checkAndConsume();
      
      // Third request should fail
      const result = await rateLimiter.checkAndConsume();
      expect(result).toBe(false);
    });

    it('should refill tokens over time', async () => {
      // Consume all tokens
      await rateLimiter.checkAndConsume();
      await rateLimiter.checkAndConsume();
      
      // Should be blocked
      expect(await rateLimiter.checkAndConsume()).toBe(false);
      
      // Wait 1 second for refill
      jest.advanceTimersByTime(1000);
      
      // Should be allowed again
      expect(await rateLimiter.checkAndConsume()).toBe(true);
    });

    it('should respect all rate limit buckets', async () => {
      // Consume 10 requests (minute limit)
      for (let i = 0; i < 10; i++) {
        if (i % 2 === 0) {
          jest.advanceTimersByTime(1000); // Refill second bucket
        }
        await rateLimiter.checkAndConsume();
      }
      
      // 11th request should fail (minute limit exceeded)
      jest.advanceTimersByTime(1000);
      const result = await rateLimiter.checkAndConsume();
      expect(result).toBe(false);
    });
  });

  describe('waitForCapacity', () => {
    it('should wait until capacity is available', async () => {
      // Consume all tokens
      await rateLimiter.checkAndConsume();
      await rateLimiter.checkAndConsume();
      
      // Start waiting
      const waitPromise = rateLimiter.waitForCapacity();
      
      // Advance time
      jest.advanceTimersByTime(1100);
      
      // Should resolve
      await expect(waitPromise).resolves.toBeUndefined();
    });

    it('should handle multiple waiters', async () => {
      // Consume all tokens
      await rateLimiter.checkAndConsume();
      await rateLimiter.checkAndConsume();
      
      // Multiple waiters
      const wait1 = rateLimiter.waitForCapacity();
      const wait2 = rateLimiter.waitForCapacity();
      
      // Advance time for first refill
      jest.advanceTimersByTime(1100);
      await wait1;
      
      // Advance time for second refill
      jest.advanceTimersByTime(1100);
      await wait2;
    });
  });

  describe('getRateLimitInfo', () => {
    it('should return current rate limit information', () => {
      const info = rateLimiter.getRateLimitInfo();
      
      expect(info.limit).toBe(2); // Per-second limit
      expect(info.remaining).toBe(2);
      expect(info.reset).toBeGreaterThan(Date.now());
    });

    it('should update info after consuming tokens', async () => {
      await rateLimiter.checkAndConsume();
      
      const info = rateLimiter.getRateLimitInfo();
      
      expect(info.remaining).toBe(1);
    });

    it('should return most restrictive limit', async () => {
      // Create limiter with different limits
      const customLimiter = new RateLimiter(createConfig({
        environment: 'sandbox',
        clientId: 'test',
        clientSecret: 'test',
        rateLimits: {
          requestsPerSecond: 10,
          requestsPerMinute: 5 // More restrictive
        }
      }));

      // Consume 5 requests quickly
      for (let i = 0; i < 5; i++) {
        await customLimiter.checkAndConsume();
      }

      const info = customLimiter.getRateLimitInfo();
      expect(info.limit).toBe(5); // Minute limit is most restrictive
      expect(info.remaining).toBe(0);
    });
  });

  describe('updateFromHeaders', () => {
    it('should update limits from API response headers', () => {
      const headers = {
        'x-ratelimit-limit': '2',
        'x-ratelimit-remaining': '1',
        'x-ratelimit-reset': String(Date.now() + 1000)
      };

      rateLimiter.updateFromHeaders(headers);
      
      const info = rateLimiter.getRateLimitInfo();
      expect(info.remaining).toBeLessThanOrEqual(1);
    });

    it('should handle missing headers gracefully', () => {
      const headers = {};
      
      expect(() => {
        rateLimiter.updateFromHeaders(headers);
      }).not.toThrow();
    });
  });

  describe('reset', () => {
    it('should reset all buckets to full capacity', async () => {
      // Consume some tokens
      await rateLimiter.checkAndConsume();
      await rateLimiter.checkAndConsume();
      
      // Reset
      rateLimiter.reset();
      
      // Should have full capacity again
      const info = rateLimiter.getRateLimitInfo();
      expect(info.remaining).toBe(2);
    });
  });

  describe('getBucketStates', () => {
    it('should return current state of all buckets', () => {
      const states = rateLimiter.getBucketStates();
      
      expect(states).toHaveProperty('second');
      expect(states).toHaveProperty('minute');
      expect(states).toHaveProperty('hour');
      
      expect(states.second).toEqual({
        tokens: 2,
        capacity: 2,
        percentFull: 100
      });
    });

    it('should update states after consumption', async () => {
      await rateLimiter.checkAndConsume();
      
      const states = rateLimiter.getBucketStates();
      
      expect(states.second.tokens).toBe(1);
      expect(states.second.percentFull).toBe(50);
    });
  });

  describe('edge cases', () => {
    it('should handle config without rate limits', () => {
      const noLimitConfig = createConfig({
        environment: 'sandbox',
        clientId: 'test',
        clientSecret: 'test',
        rateLimits: {}
      });

      const limiter = new RateLimiter(noLimitConfig);
      
      expect(await limiter.checkAndConsume()).toBe(true);
      expect(limiter.getRateLimitInfo().remaining).toBe(Infinity);
    });

    it('should handle partial rate limit config', () => {
      const partialConfig = createConfig({
        environment: 'sandbox',
        clientId: 'test',
        clientSecret: 'test',
        rateLimits: {
          requestsPerSecond: 5
          // No minute or hour limits
        }
      });

      const limiter = new RateLimiter(partialConfig);
      const states = limiter.getBucketStates();
      
      expect(states).toHaveProperty('second');
      expect(states).not.toHaveProperty('minute');
      expect(states).not.toHaveProperty('hour');
    });

    it('should handle very high request rates', async () => {
      const highRateConfig = createConfig({
        environment: 'sandbox',
        clientId: 'test',
        clientSecret: 'test',
        rateLimits: {
          requestsPerSecond: 1000
        }
      });

      const limiter = new RateLimiter(highRateConfig);
      
      // Should be able to consume many requests
      let consumed = 0;
      for (let i = 0; i < 100; i++) {
        if (await limiter.checkAndConsume()) {
          consumed++;
        }
      }
      
      expect(consumed).toBe(100);
    });
  });
});