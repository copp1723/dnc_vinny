import { Page } from 'playwright';
import { BulletproofActions } from '../../../priority2-checkbox/BulletproofActions';
import { Logger } from '../../../priority5-compliance/logger';
import { 
  CustomerSearchCriteria, 
  CustomerSearchResult, 
  SearchOptions,
  BatchSearchOptions,
  BatchSearchResult,
  PhoneFormatVariations
} from './types';
import { CustomerData } from '../../adapters/vinsolutions-customer-extractor/types';

/**
 * Service for searching customers in VinSolutions
 */
export class CustomerSearchService {
  private bulletproofActions: BulletproofActions;
  
  constructor(
    private logger: Logger
  ) {
    this.bulletproofActions = new BulletproofActions(logger);
  }

  /**
   * Search for customers by phone number
   */
  async searchByPhone(
    page: Page,
    phoneNumber: string,
    options: SearchOptions = {}
  ): Promise<CustomerSearchResult[]> {
    this.logger.info(`Searching for customer by phone: ${phoneNumber}`);
    
    const phoneVariations = this.generatePhoneVariations(phoneNumber);
    const results: CustomerSearchResult[] = [];
    
    // Try each phone variation
    for (const variation of phoneVariations.variations) {
      try {
        const searchResults = await this.performSearch(page, { phoneNumber: variation }, options);
        results.push(...searchResults);
        
        if (results.length >= (options.maxResults || 10)) {
          break;
        }
      } catch (error) {
        this.logger.warn(`Failed to search with phone variation ${variation}: ${error}`);
      }
    }
    
    // Remove duplicates and sort by match score
    return this.deduplicateAndSort(results, options.maxResults);
  }

  /**
   * Search for customers by name
   */
  async searchByName(
    page: Page,
    firstName: string,
    lastName: string,
    options: SearchOptions = {}
  ): Promise<CustomerSearchResult[]> {
    this.logger.info(`Searching for customer by name: ${firstName} ${lastName}`);
    
    return this.performSearch(page, { firstName, lastName }, options);
  }

  /**
   * Search for customers by email
   */
  async searchByEmail(
    page: Page,
    email: string,
    options: SearchOptions = {}
  ): Promise<CustomerSearchResult[]> {
    this.logger.info(`Searching for customer by email: ${email}`);
    
    return this.performSearch(page, { email }, options);
  }

  /**
   * Batch search for multiple customers
   */
  async batchSearch(
    page: Page,
    searchCriteria: CustomerSearchCriteria[],
    options: BatchSearchOptions = {}
  ): Promise<BatchSearchResult> {
    this.logger.info(`Starting batch search for ${searchCriteria.length} customers`);
    
    const startTime = Date.now();
    const results = new Map<string, CustomerSearchResult[]>();
    const errors: Array<{ criteria: CustomerSearchCriteria; error: string }> = [];
    let totalFound = 0;
    
    const batchSize = options.batchSize || 10;
    
    for (let i = 0; i < searchCriteria.length; i += batchSize) {
      const batch = searchCriteria.slice(i, i + batchSize);
      
      // Process batch in parallel pages if possible
      const batchPromises = batch.map(async (criteria) => {
        try {
          const searchResults = await this.performSearch(page, criteria, options);
          const key = this.getCriteriaKey(criteria);
          results.set(key, searchResults);
          totalFound += searchResults.length;
          
        } catch (error) {
          const err = error as Error;
          errors.push({ criteria, error: err.message });
          
          if (options.onError) {
            options.onError(criteria, err);
          }
          
          if (options.stopOnError) {
            throw err;
          }
        }
      });
      
      await Promise.all(batchPromises);
      
      // Report progress
      if (options.onProgress) {
        const processed = Math.min((i + batchSize), searchCriteria.length);
        options.onProgress(processed, searchCriteria.length);
      }
      
      // Small delay between batches
      if (i + batchSize < searchCriteria.length) {
        await page.waitForTimeout(1000);
      }
    }
    
    return {
      totalSearched: searchCriteria.length,
      totalFound,
      results,
      errors,
      duration: Date.now() - startTime
    };
  }

  /**
   * Perform the actual search
   */
  private async performSearch(
    page: Page,
    criteria: CustomerSearchCriteria,
    options: SearchOptions = {}
  ): Promise<CustomerSearchResult[]> {
    try {
      // Navigate to search page if not already there
      await this.navigateToSearchPage(page);
      
      // Clear previous search
      await this.clearSearch(page);
      
      // Enter search criteria
      await this.enterSearchCriteria(page, criteria);
      
      // Execute search
      await this.executeSearch(page);
      
      // Wait for results
      await this.waitForSearchResults(page, options.timeout);
      
      // Parse results
      const results = await this.parseSearchResults(page, criteria, options);
      
      // Handle pagination if needed
      if (results.length < (options.maxResults || 10)) {
        const additionalResults = await this.handlePagination(page, criteria, options, results.length);
        results.push(...additionalResults);
      }
      
      return results;
      
    } catch (error) {
      this.logger.error(`Search failed for criteria: ${JSON.stringify(criteria)}`, error as Error);
      throw error;
    }
  }

  /**
   * Navigate to search page
   */
  private async navigateToSearchPage(page: Page): Promise<void> {
    // Check if already on search page
    const isOnSearchPage = await page.locator('[data-page="customer-search"], #customer-search').isVisible().catch(() => false);
    
    if (!isOnSearchPage) {
      // Click on search navigation item
      const searchNav = await this.bulletproofActions.findElementWithFallbacks(
        page,
        [
          'nav a:has-text("Search")',
          'nav a:has-text("Customers")',
          '[data-nav="search"]',
          '[href*="/search"]',
          'button:has-text("Search Customers")'
        ],
        'Search navigation'
      );
      
      if (searchNav) {
        await this.bulletproofActions.bulletproofClick(searchNav, 'Search navigation');
        await page.waitForLoadState('networkidle', { timeout: 30000 });
      }
    }
  }

  /**
   * Clear previous search
   */
  private async clearSearch(page: Page): Promise<void> {
    // Find and click clear/reset button if exists
    const clearButton = await page.locator('button:has-text("Clear"), button:has-text("Reset"), [aria-label*="clear"]').first();
    
    if (await clearButton.isVisible()) {
      await this.bulletproofActions.bulletproofClick(clearButton, 'Clear search button');
      await page.waitForTimeout(500);
    }
  }

  /**
   * Enter search criteria
   */
  private async enterSearchCriteria(page: Page, criteria: CustomerSearchCriteria): Promise<void> {
    // Phone number search
    if (criteria.phoneNumber) {
      const phoneInput = await this.bulletproofActions.findElementWithFallbacks(
        page,
        [
          'input[name*="phone"]',
          'input[placeholder*="phone"]',
          'input[type="tel"]',
          'label:has-text("Phone") input'
        ],
        'Phone input'
      );
      
      if (phoneInput) {
        await this.bulletproofActions.safeInput(phoneInput, criteria.phoneNumber, 'Phone number');
      }
    }
    
    // Name search
    if (criteria.firstName || criteria.lastName) {
      // Try combined name field first
      const nameInput = await page.locator('input[name*="name"]:not([name*="first"]):not([name*="last"])').first();
      
      if (await nameInput.isVisible()) {
        const fullName = `${criteria.firstName || ''} ${criteria.lastName || ''}`.trim();
        await this.bulletproofActions.safeInput(nameInput, fullName, 'Full name');
      } else {
        // Separate first/last name fields
        if (criteria.firstName) {
          const firstNameInput = await this.bulletproofActions.findElementWithFallbacks(
            page,
            [
              'input[name*="first"]',
              'input[placeholder*="First"]',
              'label:has-text("First Name") input'
            ],
            'First name input'
          );
          
          if (firstNameInput) {
            await this.bulletproofActions.safeInput(firstNameInput, criteria.firstName, 'First name');
          }
        }
        
        if (criteria.lastName) {
          const lastNameInput = await this.bulletproofActions.findElementWithFallbacks(
            page,
            [
              'input[name*="last"]',
              'input[placeholder*="Last"]',
              'label:has-text("Last Name") input'
            ],
            'Last name input'
          );
          
          if (lastNameInput) {
            await this.bulletproofActions.safeInput(lastNameInput, criteria.lastName, 'Last name');
          }
        }
      }
    }
    
    // Email search
    if (criteria.email) {
      const emailInput = await this.bulletproofActions.findElementWithFallbacks(
        page,
        [
          'input[name*="email"]',
          'input[type="email"]',
          'input[placeholder*="email"]',
          'label:has-text("Email") input'
        ],
        'Email input'
      );
      
      if (emailInput) {
        await this.bulletproofActions.safeInput(emailInput, criteria.email, 'Email');
      }
    }
    
    // Customer ID search
    if (criteria.customerId) {
      const idInput = await this.bulletproofActions.findElementWithFallbacks(
        page,
        [
          'input[name*="customer_id"]',
          'input[name*="customerId"]',
          'input[placeholder*="Customer ID"]',
          'label:has-text("Customer ID") input'
        ],
        'Customer ID input'
      );
      
      if (idInput) {
        await this.bulletproofActions.safeInput(idInput, criteria.customerId, 'Customer ID');
      }
    }
  }

  /**
   * Execute search
   */
  private async executeSearch(page: Page): Promise<void> {
    const searchButton = await this.bulletproofActions.findElementWithFallbacks(
      page,
      [
        'button[type="submit"]:has-text("Search")',
        'button:has-text("Search")',
        'button:has-text("Find")',
        'input[type="submit"][value*="Search"]'
      ],
      'Search button'
    );
    
    if (searchButton) {
      await this.bulletproofActions.bulletproofClick(searchButton, 'Search button');
    } else {
      // Try pressing Enter as fallback
      await page.keyboard.press('Enter');
    }
  }

  /**
   * Wait for search results
   */
  private async waitForSearchResults(page: Page, timeout?: number): Promise<void> {
    const resultSelectors = [
      '[data-results]',
      '.search-results',
      'table tbody tr',
      '[role="grid"] [role="row"]'
    ];
    
    try {
      await page.waitForSelector(resultSelectors.join(', '), { 
        timeout: timeout || 30000,
        state: 'visible'
      });
      
      // Additional wait for results to stabilize
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      
    } catch (error) {
      // Check for "no results" message
      const noResults = await page.locator(':text-matches("no results", "i"), :text-matches("not found", "i")').isVisible();
      
      if (!noResults) {
        throw new Error('Search timeout - no results appeared');
      }
    }
  }

  /**
   * Parse search results
   */
  private async parseSearchResults(
    page: Page,
    criteria: CustomerSearchCriteria,
    options: SearchOptions
  ): Promise<CustomerSearchResult[]> {
    const results: CustomerSearchResult[] = [];
    
    // Find result rows
    const resultRows = await page.locator('tbody tr, [role="row"]:not([role="columnheader"])').all();
    
    for (const row of resultRows) {
      try {
        const customer = await this.extractCustomerData(row);
        const matchInfo = this.calculateMatchScore(customer, criteria, options);
        
        results.push({
          customer,
          matchScore: matchInfo.score,
          matchType: matchInfo.type,
          matchedFields: matchInfo.fields
        });
        
      } catch (error) {
        this.logger.warn('Failed to parse result row', error as Error);
      }
    }
    
    return results;
  }

  /**
   * Extract customer data from result row
   */
  private async extractCustomerData(row: any): Promise<CustomerData> {
    // Extract text from all cells
    const cells = await row.locator('td, [role="cell"]').allTextContents();
    
    // Try to identify fields by position or headers
    const customer: CustomerData = {
      firstName: '',
      lastName: '',
      phone: '',
      email: '',
      customerId: ''
    };
    
    // Look for specific data patterns
    for (const cellText of cells) {
      // Phone number pattern
      if (/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(cellText)) {
        customer.phone = cellText;
      }
      // Email pattern
      else if (/\S+@\S+\.\S+/.test(cellText)) {
        customer.email = cellText;
      }
      // Customer ID (usually numeric or alphanumeric)
      else if (/^[A-Z0-9]{6,}$/i.test(cellText)) {
        customer.customerId = cellText;
      }
    }
    
    // Try to extract name from remaining cells
    const nameCells = cells.filter(c => 
      c && !c.includes('@') && !c.match(/\d{3}[-.\s]?\d{3}/) && c.length > 1
    );
    
    if (nameCells.length >= 2) {
      customer.firstName = nameCells[0];
      customer.lastName = nameCells[1];
    } else if (nameCells.length === 1) {
      const parts = nameCells[0].split(' ');
      customer.firstName = parts[0];
      customer.lastName = parts.slice(1).join(' ');
    }
    
    // Try to get customer ID from row attributes
    const rowId = await row.getAttribute('data-customer-id');
    if (rowId) {
      customer.customerId = rowId;
    }
    
    return customer;
  }

  /**
   * Calculate match score
   */
  private calculateMatchScore(
    customer: CustomerData,
    criteria: CustomerSearchCriteria,
    options: SearchOptions
  ): { score: number; type: 'exact' | 'fuzzy' | 'partial'; fields: string[] } {
    let score = 0;
    const matchedFields: string[] = [];
    let matchType: 'exact' | 'fuzzy' | 'partial' = 'exact';
    
    // Phone match
    if (criteria.phoneNumber && customer.phone) {
      const normalizedSearch = this.normalizePhone(criteria.phoneNumber);
      const normalizedCustomer = this.normalizePhone(customer.phone);
      
      if (normalizedSearch === normalizedCustomer) {
        score += 100;
        matchedFields.push('phone');
      } else if (normalizedCustomer.includes(normalizedSearch) || normalizedSearch.includes(normalizedCustomer)) {
        score += 70;
        matchedFields.push('phone');
        matchType = 'partial';
      }
    }
    
    // Name match
    if (criteria.firstName && customer.firstName) {
      if (customer.firstName.toLowerCase() === criteria.firstName.toLowerCase()) {
        score += 40;
        matchedFields.push('firstName');
      } else if (options.fuzzyMatch && this.fuzzyMatch(customer.firstName, criteria.firstName)) {
        score += 25;
        matchedFields.push('firstName');
        matchType = 'fuzzy';
      }
    }
    
    if (criteria.lastName && customer.lastName) {
      if (customer.lastName.toLowerCase() === criteria.lastName.toLowerCase()) {
        score += 40;
        matchedFields.push('lastName');
      } else if (options.fuzzyMatch && this.fuzzyMatch(customer.lastName, criteria.lastName)) {
        score += 25;
        matchedFields.push('lastName');
        matchType = 'fuzzy';
      }
    }
    
    // Email match
    if (criteria.email && customer.email) {
      if (customer.email.toLowerCase() === criteria.email.toLowerCase()) {
        score += 80;
        matchedFields.push('email');
      }
    }
    
    // Customer ID match
    if (criteria.customerId && customer.customerId) {
      if (customer.customerId === criteria.customerId) {
        score += 100;
        matchedFields.push('customerId');
      }
    }
    
    return { score, type: matchType, fields: matchedFields };
  }

  /**
   * Handle pagination
   */
  private async handlePagination(
    page: Page,
    criteria: CustomerSearchCriteria,
    options: SearchOptions,
    currentCount: number
  ): Promise<CustomerSearchResult[]> {
    const results: CustomerSearchResult[] = [];
    const maxResults = options.maxResults || 10;
    
    while (currentCount + results.length < maxResults) {
      // Look for next page button
      const nextButton = await page.locator('button:has-text("Next"), a:has-text("Next"), [aria-label="Next page"]').first();
      
      if (await nextButton.isVisible() && await nextButton.isEnabled()) {
        await this.bulletproofActions.bulletproofClick(nextButton, 'Next page button');
        await this.waitForSearchResults(page, options.timeout);
        
        const pageResults = await this.parseSearchResults(page, criteria, options);
        results.push(...pageResults);
        
        if (pageResults.length === 0) {
          break; // No more results
        }
      } else {
        break; // No more pages
      }
    }
    
    return results;
  }

  /**
   * Generate phone variations
   */
  private generatePhoneVariations(phoneNumber: string): PhoneFormatVariations {
    const normalized = this.normalizePhone(phoneNumber);
    const variations: string[] = [phoneNumber, normalized];
    
    // Add common formats
    if (normalized.length === 10) {
      variations.push(
        normalized, // 1234567890
        `${normalized.slice(0, 3)}-${normalized.slice(3, 6)}-${normalized.slice(6)}`, // 123-456-7890
        `(${normalized.slice(0, 3)}) ${normalized.slice(3, 6)}-${normalized.slice(6)}`, // (123) 456-7890
        `${normalized.slice(0, 3)}.${normalized.slice(3, 6)}.${normalized.slice(6)}`, // 123.456.7890
        `+1${normalized}`, // +11234567890
        `1${normalized}` // 11234567890
      );
    }
    
    return {
      original: phoneNumber,
      normalized,
      e164: `+1${normalized}`,
      national: `(${normalized.slice(0, 3)}) ${normalized.slice(3, 6)}-${normalized.slice(6)}`,
      variations: [...new Set(variations)] // Remove duplicates
    };
  }

  /**
   * Normalize phone number
   */
  private normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '').replace(/^1/, '');
  }

  /**
   * Simple fuzzy string matching
   */
  private fuzzyMatch(str1: string, str2: string): boolean {
    str1 = str1.toLowerCase();
    str2 = str2.toLowerCase();
    
    // Levenshtein distance threshold
    const threshold = Math.max(str1.length, str2.length) * 0.3;
    const distance = this.levenshteinDistance(str1, str2);
    
    return distance <= threshold;
  }

  /**
   * Calculate Levenshtein distance
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * Deduplicate and sort results
   */
  private deduplicateAndSort(results: CustomerSearchResult[], maxResults?: number): CustomerSearchResult[] {
    // Remove duplicates based on customer ID
    const uniqueResults = new Map<string, CustomerSearchResult>();
    
    for (const result of results) {
      const key = result.customer.customerId || `${result.customer.firstName}-${result.customer.lastName}-${result.customer.phone}`;
      
      if (!uniqueResults.has(key) || uniqueResults.get(key)!.matchScore < result.matchScore) {
        uniqueResults.set(key, result);
      }
    }
    
    // Sort by match score
    const sorted = Array.from(uniqueResults.values()).sort((a, b) => b.matchScore - a.matchScore);
    
    // Limit results
    return sorted.slice(0, maxResults || 10);
  }

  /**
   * Get criteria key for caching
   */
  private getCriteriaKey(criteria: CustomerSearchCriteria): string {
    return JSON.stringify(criteria, Object.keys(criteria).sort());
  }
}