/**
 * Standardized CSV Injection Prevention & Sanitization Utilities
 * Consolidates CSV injection prevention logic across the application
 */

import Papa from 'papaparse';

// Dangerous CSV formula prefixes that could execute in spreadsheet applications
const DANGEROUS_PREFIXES = ['=', '+', '-', '@', '\t=', '\t+', '\t-', '\t@', ' =', ' +', ' -', ' @'];

// Common dangerous patterns for CSV injection
const DANGEROUS_PATTERNS = [
  /^=/, /^\+/, /^-/, /^@/, /^\t=/, /^\t\+/, /^\t-/, /^\t@/, /^ =/, /^ \+/, /^ -/, /^ @/,
  /^[\s\t]*=/, /^[\s\t]*\+/, /^[\s\t]*-/, /^[\s\t]*@/
];

// Email validation regex
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * Sanitizes a single CSV cell value to prevent CSV injection
 * @param value - The value to sanitize
 * @returns Sanitized string safe for CSV
 */
export function sanitizeCSVCell(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }
  
  const stringValue = String(value).trim();
  
  // Check for dangerous formula prefixes
  for (const prefix of DANGEROUS_PREFIXES) {
    if (stringValue.startsWith(prefix)) {
      // Prefix with single quote to prevent formula execution
      return `'${stringValue}`;
    }
  }
  
  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(stringValue)) {
      return `'${stringValue}`;
    }
  }
  
  // Escape pipe characters that might be interpreted as cell separators
  return stringValue.replace(/\|/g, '\\|');
}

/**
 * Validates an email address format
 * @param email - The email address to validate
 * @returns boolean indicating if the email is valid
 */
export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email) && email.length <= 254;
}

/**
 * Validates and sanitizes a CSV row object
 * @param row - The CSV row object to validate and sanitize
 * @param emailFields - Array of field names that should contain email addresses
 * @returns Sanitized row object
 */
export function sanitizeCSVRow(row: Record<string, any>, emailFields: string[] = []): Record<string, any> {
  const sanitized: Record<string, any> = {};
  
  Object.keys(row).forEach(key => {
    const value = row[key];
    
    // Special handling for email fields
    if (emailFields.some(emailKey => key.toLowerCase().includes(emailKey.toLowerCase()))) {
      if (isValidEmail(value)) {
        sanitized[key] = value.toLowerCase();
      } else {
        sanitized[key] = ''; // Invalid email becomes empty string
      }
    } else {
      sanitized[key] = sanitizeCSVCell(value);
    }
  });
  
  return sanitized;
}

/**
 * Validates a CSV file with security checks
 * @param file - The CSV file to validate
 * @param options - Validation options
 * @returns Promise with validation result
 */
export async function validateCSVFile(
  file: File,
  options: {
    maxSize?: number;
    maxRows?: number;
    allowedTypes?: string[];
    emailFields?: string[];
  } = {}
): Promise<{
  valid: boolean;
  data?: any[];
  errors: string[];
}> {
  const {
    maxSize = 10 * 1024 * 1024, // 10MB
    maxRows = 10000,
    allowedTypes = ['text/csv', 'application/vnd.ms-excel', 'application/csv'],
    emailFields = []
  } = options;

  const errors: string[] = [];

  // File size validation
  if (file.size > maxSize) {
    errors.push(`File size exceeds ${maxSize / (1024 * 1024)}MB limit`);
    return { valid: false, errors };
  }

  // File type validation
  if (!allowedTypes.includes(file.type) && !file.name.endsWith('.csv')) {
    errors.push('Invalid file type. Please upload a CSV file.');
    return { valid: false, errors };
  }

  return new Promise((resolve) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => {
        // Sanitize header names
        return sanitizeCSVCell(header).replace(/[^\w\s-]/g, '').trim();
      },
      transform: (value) => {
        // Sanitize all cell values
        return sanitizeCSVCell(value);
      },
      complete: (results: Papa.ParseResult<any>) => {
        if (results.errors.length > 0) {
          errors.push(`CSV parsing error: ${results.errors[0].message}`);
          resolve({ valid: false, errors });
          return;
        }

        if (!results.data || results.data.length === 0) {
          errors.push('CSV file is empty');
          resolve({ valid: false, errors });
          return;
        }

        // Row limit validation
        if (results.data.length > maxRows) {
          errors.push(`CSV file exceeds ${maxRows} row limit`);
          resolve({ valid: false, errors });
          return;
        }

        // Process and validate contacts
        const validData = results.data
          .map((row: any) => sanitizeCSVRow(row, emailFields))
          .filter((row: any) => {
            // Must have at least one valid email if email fields are specified
            if (emailFields.length > 0) {
              return emailFields.some(emailField => 
                emailField in row && isValidEmail(row[emailField])
              );
            }
            return true;
          });

        if (validData.length === 0) {
          errors.push('No valid data found in CSV');
          resolve({ valid: false, errors });
          return;
        }

        resolve({ valid: true, data: validData, errors });
      },
      error: (error: Error) => {
        errors.push(`Error reading file: ${error.message}`);
        resolve({ valid: false, errors });
      }
    });
  });
}

/**
 * Generates a secure CSV response with proper headers
 * @param data - The data to export as CSV
 * @param filename - The filename for the CSV download
 * @returns Response object ready for download
 */
export function generateSecureCSVResponse(data: any[], filename: string): Response {
  const csvContent = Papa.unparse(data, {
    header: true,
    quotes: true, // Always quote fields to prevent injection
    delimiter: ',',
    newline: '\r\n'
  });
  
  return new Response(csvContent, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'X-Frame-Options': 'DENY',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  });
}

/**
 * Creates a CSV-safe string from any value
 * @param value - The value to make CSV-safe
 * @returns CSV-safe string
 */
export function makeCSVSafe(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }
  
  const stringValue = String(value);
  
  // If the value contains quotes, double them
  let escaped = stringValue.replace(/"/g, '""');
  
  // If the value contains special characters, wrap in quotes
  if (escaped.includes(',') || escaped.includes('"') || escaped.includes('\n') || escaped.includes('\r')) {
    escaped = `"${escaped}"`;
  }
  
  return escaped;
}

/**
 * Validates CSV headers against expected schema
 * @param headers - Array of CSV headers
 * @param expectedHeaders - Array of expected header names
 * @returns Object with validation result and any errors
 */
export function validateCSVHeaders(
  headers: string[],
  expectedHeaders: string[]
): { valid: boolean; errors: string[]; missing: string[]; extra: string[] } {
  const normalizedHeaders = headers.map(h => h.toLowerCase().trim());
  const normalizedExpected = expectedHeaders.map(h => h.toLowerCase().trim());
  
  const missing = normalizedExpected.filter(h => !normalizedHeaders.includes(h));
  const extra = normalizedHeaders.filter(h => !normalizedExpected.includes(h));
  
  return {
    valid: missing.length === 0,
    errors: [
      ...(missing.length > 0 ? [`Missing required headers: ${missing.join(', ')}`] : []),
      ...(extra.length > 0 ? [`Unexpected headers: ${extra.join(', ')}`] : [])
    ],
    missing: missing.map(h => expectedHeaders[normalizedExpected.indexOf(h)]),
    extra: extra.map(h => headers[normalizedHeaders.indexOf(h)])
  };
}

/**
 * Export all CSV sanitization utilities
 */
export const CSVUtils = {
  sanitizeCSVCell,
  sanitizeCSVRow,
  validateCSVFile,
  generateSecureCSVResponse,
  makeCSVSafe,
  validateCSVHeaders,
  isValidEmail
};