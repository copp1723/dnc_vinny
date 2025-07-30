import { logger } from './logger';

export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half-open'
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  monitoringPeriod: number;
  fallbackFunction?: () => Promise<any>;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;
  
  constructor(
    private serviceName: string,
    private options: CircuitBreakerOptions = {
      failureThreshold: 5,
      resetTimeout: 60000, // 1 minute
      monitoringPeriod: 60000 // 1 minute
    }
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitState.HALF_OPEN;
        logger.info('Circuit breaker half-open', { service: this.serviceName });
      } else {
        return this.handleOpenCircuit();
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.successCount++;
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.CLOSED;
      this.failureCount = 0;
      logger.info('Circuit breaker closed after successful test', { 
        service: this.serviceName 
      });
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.options.failureThreshold) {
      this.state = CircuitState.OPEN;
      logger.warn('Circuit breaker opened', { 
        service: this.serviceName,
        failureCount: this.failureCount 
      });
    }
  }

  private shouldAttemptReset(): boolean {
    return Date.now() - this.lastFailureTime >= this.options.resetTimeout;
  }

  private async handleOpenCircuit<T>(): Promise<T> {
    if (this.options.fallbackFunction) {
      logger.info('Circuit breaker executing fallback', { service: this.serviceName });
      return await this.options.fallbackFunction();
    }
    
    throw new Error(`Circuit breaker is open for service: ${this.serviceName}`);
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureTime: number;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime
    };
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    logger.info('Circuit breaker manually reset', { service: this.serviceName });
  }
}

// Pre-configured circuit breakers for common services
export const twilioCircuitBreaker = new CircuitBreaker('twilio', {
  failureThreshold: 3,
  resetTimeout: 30000, // 30 seconds
  monitoringPeriod: 60000,
  fallbackFunction: async () => {
    logger.warn('Twilio circuit breaker fallback triggered');
    return { success: false, message: 'SMS service temporarily unavailable' };
  }
});

export const mailgunCircuitBreaker = new CircuitBreaker('mailgun', {
  failureThreshold: 5,
  resetTimeout: 60000, // 1 minute
  monitoringPeriod: 60000,
  fallbackFunction: async () => {
    logger.warn('Mailgun circuit breaker fallback triggered');
    return { success: false, message: 'Email service temporarily unavailable' };
  }
});

export const openrouterCircuitBreaker = new CircuitBreaker('openrouter', {
  failureThreshold: 3,
  resetTimeout: 30000, // 30 seconds
  monitoringPeriod: 60000,
  fallbackFunction: async () => {
    logger.warn('OpenRouter circuit breaker fallback triggered');
    return 'I apologize, but I am unable to process your request at this time.';
  }
});

// Helper functions for easy usage
export async function executeWithTwilioBreaker<T>(operation: () => Promise<T>): Promise<T> {
  return await twilioCircuitBreaker.execute(operation);
}

export async function executeWithMailgunBreaker<T>(operation: () => Promise<T>): Promise<T> {
  return await mailgunCircuitBreaker.execute(operation);
}

export async function executeWithOpenRouterBreaker<T>(operation: () => Promise<T>): Promise<T> {
  return await openrouterCircuitBreaker.execute(operation);
}