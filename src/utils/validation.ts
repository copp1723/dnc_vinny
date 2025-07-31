/**
 * Input validation utilities to prevent injection attacks
 */

/**
 * Validates and sanitizes numeric input
 */
export function validateNumber(input: any, defaultValue: number, min?: number, max?: number): number {
  const num = parseInt(String(input), 10);
  
  if (isNaN(num)) {
    return defaultValue;
  }
  
  if (min !== undefined && num < min) {
    return min;
  }
  
  if (max !== undefined && num > max) {
    return max;
  }
  
  return num;
}

/**
 * Validates and sanitizes string input
 */
export function validateString(input: any, maxLength: number = 255): string {
  if (typeof input !== 'string') {
    return '';
  }
  
  // Remove any potential SQL injection attempts
  const sanitized = input
    .replace(/['"`;\\]/g, '') // Remove quotes and semicolons
    .trim()
    .slice(0, maxLength);
  
  return sanitized;
}

/**
 * Validates dealership ID format
 */
export function validateDealershipId(input: any): string | null {
  if (typeof input !== 'string') {
    return null;
  }
  
  // Assuming dealership IDs are alphanumeric with dashes/underscores
  const sanitized = input.replace(/[^a-zA-Z0-9_-]/g, '');
  
  if (sanitized.length === 0 || sanitized.length > 50) {
    return null;
  }
  
  return sanitized;
}

/**
 * Validates alert ID format
 */
export function validateAlertId(input: any): string | null {
  if (typeof input !== 'string') {
    return null;
  }
  
  // Assuming alert IDs are UUIDs or similar format
  const sanitized = input.replace(/[^a-zA-Z0-9_-]/g, '');
  
  if (sanitized.length === 0 || sanitized.length > 100) {
    return null;
  }
  
  return sanitized;
}

/**
 * Validates severity level
 */
export function validateSeverity(input: any): 'low' | 'medium' | 'high' | 'critical' | null {
  const validSeverities = ['low', 'medium', 'high', 'critical'];
  
  if (typeof input !== 'string' || !validSeverities.includes(input)) {
    return null;
  }
  
  return input as 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Validates username/email format
 */
export function validateUsername(input: any): string | null {
  if (typeof input !== 'string') {
    return null;
  }
  
  // Basic email/username validation
  const sanitized = input.trim().slice(0, 100);
  
  // Check for basic email format or alphanumeric username
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const usernameRegex = /^[a-zA-Z0-9._-]+$/;
  
  if (!emailRegex.test(sanitized) && !usernameRegex.test(sanitized)) {
    return null;
  }
  
  return sanitized;
}