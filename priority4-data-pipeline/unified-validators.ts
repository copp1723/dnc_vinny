/**
 * Unified UUID and ID Validation Utilities
 * Consolidates all UUID and ID validation functions into a single, reusable module
 */

import { z } from 'zod';

// UUID validation regex patterns
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Numeric ID validation
const NUMERIC_ID_REGEX = /^\d+$/;
const POSITIVE_ID_REGEX = /^[1-9]\d*$/;

/**
 * Validates if a string is a valid UUID format
 * @param id - The string to validate
 * @param version - Optional UUID version (1-5), defaults to any version
 * @returns boolean indicating if the string is a valid UUID
 */
export function isValidUUID(id: string, version?: number): boolean {
  if (!id || typeof id !== 'string') return false;
  
  if (version === 4) {
    return UUID_V4_REGEX.test(id);
  }
  
  if (version && version >= 1 && version <= 5) {
    const versionRegex = new RegExp(`^[0-9a-f]{8}-[0-9a-f]{4}-${version}[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, 'i');
    return versionRegex.test(id);
  }
  
  return UUID_REGEX.test(id);
}

/**
 * Validates if a string is a valid UUID v4
 * @param id - The string to validate
 * @returns boolean indicating if the string is a valid UUID v4
 */
export function isValidUUIDv4(id: string): boolean {
  return isValidUUID(id, 4);
}

/**
 * Validates if a string is a valid numeric ID
 * @param id - The string to validate
 * @param positiveOnly - Whether to only accept positive integers
 * @returns boolean indicating if the string is a valid numeric ID
 */
export function isValidNumericId(id: string, positiveOnly: boolean = false): boolean {
  if (!id || typeof id !== 'string') return false;
  
  if (positiveOnly) {
    return POSITIVE_ID_REGEX.test(id);
  }
  
  return NUMERIC_ID_REGEX.test(id);
}

/**
 * Validates if a string is a valid positive integer ID
 * @param id - The string to validate
 * @returns boolean indicating if the string is a valid positive integer ID
 */
export function isValidPositiveId(id: string): boolean {
  return isValidNumericId(id, true);
}

/**
 * Zod schema for UUID validation
 */
export const uuidSchema = z.string().regex(UUID_REGEX, 'Invalid UUID format');

/**
 * Zod schema for UUID v4 validation
 */
export const uuidV4Schema = z.string().regex(UUID_V4_REGEX, 'Invalid UUID v4 format');

/**
 * Zod schema for numeric ID validation
 */
export const numericIdSchema = z.string().regex(NUMERIC_ID_REGEX, 'Invalid numeric ID format');

/**
 * Zod schema for positive integer ID validation
 */
export const positiveIdSchema = z.string().regex(POSITIVE_ID_REGEX, 'Invalid positive integer ID format');

/**
 * Validates and sanitizes an ID based on expected type
 * @param id - The ID to validate and sanitize
 * @param expectedType - The expected type ('uuid', 'uuid-v4', 'numeric', 'positive-numeric')
 * @returns The sanitized ID or null if invalid
 */
export function sanitizeId(id: string, expectedType: 'uuid' | 'uuid-v4' | 'numeric' | 'positive-numeric'): string | null {
  const trimmedId = id?.toString().trim();
  if (!trimmedId) return null;

  switch (expectedType) {
    case 'uuid':
      return isValidUUID(trimmedId) ? trimmedId : null;
    case 'uuid-v4':
      return isValidUUIDv4(trimmedId) ? trimmedId : null;
    case 'numeric':
      return isValidNumericId(trimmedId) ? trimmedId : null;
    case 'positive-numeric':
      return isValidPositiveId(trimmedId) ? trimmedId : null;
    default:
      return null;
  }
}

/**
 * Validates an array of IDs
 * @param ids - Array of IDs to validate
 * @param validator - Validation function to use
 * @returns Array of valid IDs
 */
export function validateIdArray<T extends string>(
  ids: T[],
  validator: (id: T) => boolean
): T[] {
  return ids.filter(validator);
}

/**
 * Validates and sanitizes an array of IDs
 * @param ids - Array of IDs to validate and sanitize
 * @param expectedType - The expected type for all IDs
 * @returns Array of sanitized valid IDs
 */
export function sanitizeIdArray(
  ids: string[],
  expectedType: 'uuid' | 'uuid-v4' | 'numeric' | 'positive-numeric'
): string[] {
  return ids
    .map(id => sanitizeId(id, expectedType))
    .filter((id): id is string => id !== null);
}