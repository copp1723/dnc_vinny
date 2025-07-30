// Centralized sanitization utilities for input validation
// Place all DOMPurify and custom sanitization helpers here

import DOMPurify from 'isomorphic-dompurify';

/**
 * Sanitize a string to remove dangerous HTML and scripts
 */
export function sanitizeHtml(input: string): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'img',
      'table', 'tr', 'td', 'th'
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'style', 'class', 'id'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+\-:]|$))/i
  });
}

/**
 * Sanitize a plain string (no HTML allowed)
 */
export function sanitizeString(input: string, maxLength = 1000): string {
  return input
    .trim()
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .substring(0, maxLength);
}

/**
 * Recursively sanitize all string fields in an object
 */
export function sanitizeObjectStrings(obj: any): any {
  if (typeof obj === 'string') return sanitizeString(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeObjectStrings);
  if (obj && typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObjectStrings(value);
    }
    return sanitized;
  }
  return obj;
}

/**
 * Sanitize metadata object (all string values)
 */
export function sanitizeMetadata(meta: Record<string, any>): Record<string, any> {
  if (!meta) return {};
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(meta)) {
    sanitized[key] = typeof value === 'string' ? sanitizeString(value) : value;
  }
  return sanitized;
}

export default {
  sanitizeHtml,
  sanitizeString,
  sanitizeObjectStrings,
  sanitizeMetadata
};
