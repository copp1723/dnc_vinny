// server/security/prompt-sanitizer.ts
/**
 * AI PROMPT INJECTION PROTECTION
 * 
 * Sanitizes and validates inputs to AI models to prevent prompt injection attacks,
 * data exfiltration, and unauthorized command execution.
 */

import { logger } from '../utils/logger';

export interface SanitizationOptions {
  maxLength: number;
  allowedPatterns?: RegExp[];
  blockedPatterns?: RegExp[];
  stripHTML: boolean;
  normalizeWhitespace: boolean;
  logViolations: boolean;
}

export interface SanitizationResult {
  sanitized: string;
  violations: string[];
  safe: boolean;
}

export class PromptSanitizer {
  private static readonly DEFAULT_OPTIONS: SanitizationOptions = {
    maxLength: 2000,
    stripHTML: true,
    normalizeWhitespace: true,
    logViolations: true,
    blockedPatterns: [
      // Prompt injection patterns
      /ignore\s+(previous|all)\s+(instructions?|commands?|prompts?)/gi,
      /forget\s+(everything|all)\s+(above|before)/gi,
      /disregard\s+(previous|all)\s+(instructions?|commands?)/gi,
      /new\s+(instructions?|prompt|task|role)/gi,
      
      // System message injection
      /\[?system\]?:?\s*(you are|act as|pretend|roleplay)/gi,
      /\[?(user|human|assistant)\]?:?\s*(you are|act as)/gi,
      
      // Jailbreak attempts
      /jailbreak|sudo|administrator|override|bypass/gi,
      /developer\s+mode|debug\s+mode|maintenance\s+mode/gi,
      
      // Data exfiltration attempts
      /extract\s+(data|information|credentials|secrets)/gi,
      /show\s+(me\s+)?(all\s+)?(data|users|credentials|keys)/gi,
      /list\s+(all\s+)?(users|credentials|secrets|keys)/gi,
      
      // Code execution attempts
      /<script[^>]*>.*?<\/script>/gis,
      /javascript:|data:|vbscript:/gi,
      /eval\s*\(/gi,
      /function\s*\([^)]*\)\s*{/gi,
      
      // SQL injection patterns
      /union\s+select|drop\s+table|delete\s+from|insert\s+into/gi,
      /--\s*$|\/\*.*?\*\//g,
    ]
  };

  /**
   * Sanitize a user task input for AI processing
   */
  public static sanitizeTask(task: string, options?: Partial<SanitizationOptions>): SanitizationResult {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    const violations: string[] = [];
    let sanitized = task;
    let safe = true;

    try {
      // Length validation
      if (sanitized.length > opts.maxLength) {
        sanitized = sanitized.substring(0, opts.maxLength);
        violations.push(`Input truncated to ${opts.maxLength} characters`);
      }

      // Strip HTML if requested
      if (opts.stripHTML) {
        const originalLength = sanitized.length;
        sanitized = sanitized.replace(/<[^>]*>/g, '');
        if (sanitized.length !== originalLength) {
          violations.push('HTML tags removed');
        }
      }

      // Normalize whitespace
      if (opts.normalizeWhitespace) {
        sanitized = sanitized.replace(/\s+/g, ' ').trim();
      }

      // Check blocked patterns
      if (opts.blockedPatterns) {
        for (const pattern of opts.blockedPatterns) {
          if (pattern.test(sanitized)) {
            const match = sanitized.match(pattern);
            violations.push(`Blocked pattern detected: ${match?.[0] || 'unknown'}`);
            safe = false;
            
            // Remove the malicious content
            sanitized = sanitized.replace(pattern, '[REDACTED]');
          }
        }
      }

      // Check allowed patterns (if specified)
      if (opts.allowedPatterns && opts.allowedPatterns.length > 0) {
        const isAllowed = opts.allowedPatterns.some(pattern => pattern.test(sanitized));
        if (!isAllowed) {
          violations.push('Input does not match allowed patterns');
          safe = false;
        }
      }

      // Additional safety checks
      const suspiciousPatterns = [
        { pattern: /[{}[\]<>]/g, name: 'special characters' },
        { pattern: /\b(password|key|secret|token|auth|admin)\b/gi, name: 'sensitive keywords' },
        { pattern: /\b(delete|drop|truncate|alter|update)\b/gi, name: 'destructive keywords' },
      ];

      for (const check of suspiciousPatterns) {
        const matches = sanitized.match(check.pattern);
        if (matches && matches.length > 5) {
          violations.push(`High count of ${check.name}: ${matches.length}`);
          safe = false;
        }
      }

      // Log violations if requested
      if (opts.logViolations && violations.length > 0) {
        logger.warn('🚨 Prompt sanitization violations detected', {
          originalLength: task.length,
          sanitizedLength: sanitized.length,
          violations,
          safe,
          sample: task.substring(0, 100),
        });
      }

      return {
        sanitized,
        violations,
        safe,
      };

    } catch (error) {
      logger.error('❌ Error during prompt sanitization:', error);
      return {
        sanitized: '[ERROR: Unable to sanitize input]',
        violations: ['Sanitization error'],
        safe: false,
      };
    }
  }

  /**
   * Create a safe prompt template for AI requests
   */
  public static createSafePrompt(taskInput: string, templateType: 'element_detection' | 'automation' | 'analysis'): string {
    const sanitizationResult = this.sanitizeTask(taskInput);
    
    if (!sanitizationResult.safe) {
      logger.error('🚨 Unsafe task input rejected', {
        violations: sanitizationResult.violations,
        sample: taskInput.substring(0, 100),
      });
      throw new Error('Task input contains potentially malicious content and has been rejected');
    }

    const templates = {
      element_detection: `
You are a professional web automation assistant for an automotive dealership. Your role is strictly limited to identifying UI elements on dealership management system web pages.

TASK CONTEXT: ${sanitizationResult.sanitized}

STRICT RULES:
1. Only analyze the provided screenshot
2. Only identify standard HTML form elements (buttons, inputs, links)
3. Never execute any commands or code
4. Never access or modify system data
5. Response must be valid JSON with the exact structure specified
6. Do not include any executable content in responses

Analyze the screenshot and provide element selectors for the specified task.`,

      automation: `
You are a web automation assistant for automotive dealership systems. Your role is limited to providing navigation guidance for legitimate business tasks.

BUSINESS TASK: ${sanitizationResult.sanitized}

CONSTRAINTS:
1. Only provide guidance for standard business operations
2. Never suggest accessing unauthorized areas
3. Never recommend data export or system modification beyond normal business use
4. Responses must be professional and business-appropriate
5. Focus only on UI interaction guidance`,

      analysis: `
You are a business process analyst for automotive dealership operations. Your role is to analyze legitimate business workflows.

ANALYSIS REQUEST: ${sanitizationResult.sanitized}

SCOPE LIMITATIONS:
1. Only analyze standard business processes
2. Do not recommend system modifications
3. Focus on efficiency and compliance
4. Maintain professional business context
5. No technical system analysis beyond UI workflow`
    };

    return templates[templateType];
  }

  /**
   * Validate AI response for safety
   */
  public static validateAIResponse(response: string): { safe: boolean; sanitized: string; issues: string[] } {
    const issues: string[] = [];
    let sanitized = response;
    
    // Check for code injection in response
    const dangerousPatterns = [
      /<script/gi,
      /javascript:/gi,
      /eval\(/gi,
      /document\./gi,
      /window\./gi,
      /\$\(/gi, // jQuery
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(sanitized)) {
        issues.push(`Potentially dangerous pattern in response: ${pattern.source}`);
        sanitized = sanitized.replace(pattern, '[FILTERED]');
      }
    }

    // Validate JSON structure if expected
    try {
      if (sanitized.trim().startsWith('{')) {
        const parsed = JSON.parse(sanitized);
        // Ensure no executable content in JSON values
        const jsonString = JSON.stringify(parsed);
        if (jsonString !== sanitized.trim()) {
          sanitized = jsonString;
        }
      }
    } catch (error) {
      // Not valid JSON, but that might be okay depending on context
    }

    return {
      safe: issues.length === 0,
      sanitized,
      issues,
    };
  }
}

// Export commonly used sanitization functions
export const sanitizeTask = PromptSanitizer.sanitizeTask;
export const createSafePrompt = PromptSanitizer.createSafePrompt;
export const validateAIResponse = PromptSanitizer.validateAIResponse;