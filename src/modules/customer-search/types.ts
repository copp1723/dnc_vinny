import { CustomerData } from '../../adapters/vinsolutions-customer-extractor/types';

/**
 * Customer search criteria
 */
export interface CustomerSearchCriteria {
  phoneNumber?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  customerId?: string;
}

/**
 * Customer search result
 */
export interface CustomerSearchResult {
  customer: CustomerData;
  matchScore: number;
  matchType: 'exact' | 'fuzzy' | 'partial';
  matchedFields: string[];
}

/**
 * Search options
 */
export interface SearchOptions {
  fuzzyMatch?: boolean;
  partialMatch?: boolean;
  maxResults?: number;
  includeInactive?: boolean;
  timeout?: number;
}

/**
 * DNC status information
 */
export interface DNCStatus {
  isDNC: boolean;
  dncType?: 'federal' | 'state' | 'internal' | 'manual';
  dateMarked?: Date;
  markedBy?: string;
  reason?: string;
  tags?: string[];
}

/**
 * DNC update result
 */
export interface DNCUpdateResult {
  success: boolean;
  previousStatus: DNCStatus;
  newStatus: DNCStatus;
  updateTime: Date;
  confirmationScreenshot?: string;
  error?: string;
}

/**
 * Batch search options
 */
export interface BatchSearchOptions extends SearchOptions {
  batchSize?: number;
  onProgress?: (processed: number, total: number) => void;
  onError?: (criteria: CustomerSearchCriteria, error: Error) => void;
  stopOnError?: boolean;
}

/**
 * Batch search result
 */
export interface BatchSearchResult {
  totalSearched: number;
  totalFound: number;
  results: Map<string, CustomerSearchResult[]>;
  errors: Array<{
    criteria: CustomerSearchCriteria;
    error: string;
  }>;
  duration: number;
}

/**
 * Navigation options
 */
export interface NavigationOptions {
  waitForPageLoad?: boolean;
  screenshot?: boolean;
  screenshotPath?: string;
  timeout?: number;
}

/**
 * Phone format variations
 */
export interface PhoneFormatVariations {
  original: string;
  normalized: string;
  e164: string;
  national: string;
  variations: string[];
}