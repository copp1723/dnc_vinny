import { Page } from 'playwright';
import { BulletproofActions } from '../../../../priority2-checkbox/BulletproofActions';
import { Logger } from '../../../../utils/Logger';
import { CustomerDNCResult, DNCMarkingOptions } from '../types';

/**
 * Service for marking customers as DNC in VinSolutions
 */
export class DNCMarkingService {
  constructor(
    private bulletproofActions: BulletproofActions,
    private logger: Logger
  ) {}

  /**
   * Mark multiple customers as DNC
   */
  async markCustomersAsDNC(
    page: Page,
    dncCustomers: CustomerDNCResult[],
    options: {
      onProgress?: (marked: number, total: number) => void;
      onError?: (customerId: string, error: Error) => void;
      markingOptions?: DNCMarkingOptions;
    } = {}
  ): Promise<{ markedCount: number; failedCount: number; errors: any[] }> {
    this.logger.info(`Starting to mark ${dncCustomers.length} customers as DNC`);
    
    let markedCount = 0;
    let failedCount = 0;
    const errors: any[] = [];

    for (let i = 0; i < dncCustomers.length; i++) {
      const customer = dncCustomers[i];
      
      try {
        await this.markSingleCustomer(page, customer, options.markingOptions);
        markedCount++;
        
        this.logger.info(`Successfully marked customer ${customer.customerId} as DNC`);
        
        // Report progress
        if (options.onProgress) {
          options.onProgress(markedCount, dncCustomers.length);
        }
        
      } catch (error) {
        failedCount++;
        const err = error as Error;
        
        errors.push({
          customerId: customer.customerId,
          error: err.message
        });
        
        this.logger.error(`Failed to mark customer ${customer.customerId}: ${err.message}`);
        
        if (options.onError) {
          options.onError(customer.customerId, err);
        }
      }

      // Small delay between customers to avoid overwhelming the system
      if (i < dncCustomers.length - 1) {
        await page.waitForTimeout(1000);
      }
    }

    this.logger.info(`DNC marking complete: ${markedCount} marked, ${failedCount} failed`);
    
    return { markedCount, failedCount, errors };
  }

  /**
   * Mark a single customer as DNC
   */
  private async markSingleCustomer(
    page: Page,
    customer: CustomerDNCResult,
    markingOptions?: DNCMarkingOptions
  ): Promise<void> {
    try {
      // Navigate to customer record
      await this.navigateToCustomer(page, customer.customerId);
      
      // Wait for customer page to load
      await page.waitForLoadState('networkidle', { timeout: 30000 });
      
      // Take screenshot before marking
      await page.screenshot({ 
        path: `screenshots/dnc-marking/before_${customer.customerId}.png` 
      });

      // Apply DNC marking based on options
      const options = markingOptions || this.getDefaultMarkingOptions();
      
      if (options.updateMethod === 'tag' || options.updateMethod === 'both') {
        await this.addDNCTag(page, options.tagName || 'DNC');
      }
      
      if (options.updateMethod === 'field' || options.updateMethod === 'both') {
        await this.updateDNCField(page, options.fieldName || 'dnc_status');
      }
      
      if (options.addNote) {
        await this.addDNCNote(page, customer, options.noteTemplate);
      }
      
      if (options.updateContactPreferences) {
        await this.updateContactPreferences(page, options.optOutFromMarketing);
      }

      // Save changes
      await this.saveCustomerChanges(page);
      
      // Take screenshot after marking
      await page.screenshot({ 
        path: `screenshots/dnc-marking/after_${customer.customerId}.png` 
      });
      
    } catch (error) {
      throw new Error(`Failed to mark customer ${customer.customerId}: ${error}`);
    }
  }

  /**
   * Navigate to customer record
   */
  private async navigateToCustomer(page: Page, customerId: string): Promise<void> {
    this.logger.info(`Navigating to customer ${customerId}`);
    
    // Try direct URL navigation first
    const customerUrl = `${page.url().split('/').slice(0, 3).join('/')}/customers/${customerId}`;
    
    try {
      await page.goto(customerUrl, { waitUntil: 'networkidle', timeout: 30000 });
      
      // Verify we're on the correct page
      const pageTitle = await page.title();
      if (!pageTitle.toLowerCase().includes('customer')) {
        throw new Error('Not on customer page');
      }
      
    } catch (error) {
      // Fallback: Use search
      this.logger.warn('Direct navigation failed, using search');
      await this.searchForCustomer(page, customerId);
    }
  }

  /**
   * Search for customer using search function
   */
  private async searchForCustomer(page: Page, customerId: string): Promise<void> {
    // Click on search button/icon
    const searchButton = page.locator('[aria-label*="search" i], [title*="search" i], button:has-text("Search")').first();
    await this.bulletproofActions.bulletproofClick(searchButton, 'Search button');
    
    // Enter customer ID
    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i]').first();
    await searchInput.fill(customerId);
    await searchInput.press('Enter');
    
    // Wait for results and click on customer
    await page.waitForSelector(`[data-customer-id="${customerId}"], tr:has-text("${customerId}")`, { timeout: 30000 });
    const customerResult = page.locator(`[data-customer-id="${customerId}"], tr:has-text("${customerId}")`).first();
    await this.bulletproofActions.bulletproofClick(customerResult, 'Customer search result');
  }

  /**
   * Add DNC tag to customer
   */
  private async addDNCTag(page: Page, tagName: string): Promise<void> {
    this.logger.info(`Adding DNC tag: ${tagName}`);
    
    // Look for tags section
    const tagsSection = page.locator('[data-section="tags"], [aria-label*="tags" i], div:has-text("Tags"):has(button)').first();
    
    // Click add tag button
    const addTagButton = tagsSection.locator('button:has-text("Add"), button[aria-label*="add tag" i]').first();
    await this.bulletproofActions.bulletproofClick(addTagButton, 'Add tag button');
    
    // Enter tag name
    const tagInput = page.locator('input[placeholder*="tag" i], input[name*="tag" i]').last();
    await tagInput.fill(tagName);
    
    // Confirm tag addition
    const confirmButton = page.locator('button:has-text("Add"), button:has-text("Save")').last();
    await this.bulletproofActions.bulletproofClick(confirmButton, 'Confirm tag button');
    
    // Wait for tag to appear
    await page.waitForSelector(`span:has-text("${tagName}"), div:has-text("${tagName}")`, { timeout: 10000 });
  }

  /**
   * Update DNC field
   */
  private async updateDNCField(page: Page, fieldName: string): Promise<void> {
    this.logger.info(`Updating DNC field: ${fieldName}`);
    
    // Look for custom fields or contact preferences section
    const fieldsSection = page.locator('[data-section="custom-fields"], [aria-label*="custom fields" i], div:has-text("Custom Fields")').first();
    
    // Find the DNC field
    const dncField = fieldsSection.locator(`[name="${fieldName}"], [data-field="${fieldName}"], label:has-text("${fieldName}")`).first();
    
    // Update based on field type
    if (await dncField.locator('input[type="checkbox"]').isVisible()) {
      // Checkbox field
      await dncField.locator('input[type="checkbox"]').check();
    } else if (await dncField.locator('select').isVisible()) {
      // Dropdown field
      await dncField.locator('select').selectOption('true');
    } else {
      // Text field
      await dncField.locator('input').fill('DNC - Do Not Call');
    }
  }

  /**
   * Add DNC note to customer record
   */
  private async addDNCNote(page: Page, customer: CustomerDNCResult, template?: string): Promise<void> {
    this.logger.info('Adding DNC note');
    
    // Navigate to notes section
    const notesTab = page.locator('[data-tab="notes"], button:has-text("Notes"), a:has-text("Notes")').first();
    await this.bulletproofActions.bulletproofClick(notesTab, 'Notes tab');
    
    // Click add note button
    const addNoteButton = page.locator('button:has-text("Add Note"), button[aria-label*="add note" i]').first();
    await this.bulletproofActions.bulletproofClick(addNoteButton, 'Add note button');
    
    // Create note content
    const noteContent = template || this.createDNCNoteContent(customer);
    
    // Enter note
    const noteTextarea = page.locator('textarea[name*="note" i], textarea[placeholder*="note" i]').first();
    await noteTextarea.fill(noteContent);
    
    // Save note
    const saveNoteButton = page.locator('button:has-text("Save Note"), button:has-text("Add")').last();
    await this.bulletproofActions.bulletproofClick(saveNoteButton, 'Save note button');
  }

  /**
   * Create DNC note content
   */
  private createDNCNoteContent(customer: CustomerDNCResult): string {
    const dncNumbers = customer.dncResults
      .filter(r => r.isDNC)
      .map(r => r.phoneNumber)
      .join(', ');
    
    return `DNC Compliance Update - ${new Date().toLocaleDateString()}
    
Customer has been marked as DNC based on compliance check.
DNC Phone Numbers: ${dncNumbers}
Total Numbers Checked: ${customer.phoneNumbers.length}
DNC Numbers Found: ${customer.dncResults.filter(r => r.isDNC).length}

This customer should not be contacted via phone for marketing purposes.
Updated by: DNC Compliance Workflow`;
  }

  /**
   * Update contact preferences
   */
  private async updateContactPreferences(page: Page, optOutFromMarketing: boolean): Promise<void> {
    this.logger.info('Updating contact preferences');
    
    // Navigate to preferences section
    const preferencesSection = page.locator('[data-section="preferences"], div:has-text("Contact Preferences")').first();
    
    // Uncheck phone contact options
    const phoneOptions = preferencesSection.locator('input[type="checkbox"][name*="phone" i]');
    const count = await phoneOptions.count();
    
    for (let i = 0; i < count; i++) {
      const checkbox = phoneOptions.nth(i);
      if (await checkbox.isChecked()) {
        await checkbox.uncheck();
      }
    }
    
    // Opt out from marketing if requested
    if (optOutFromMarketing) {
      const marketingOptOut = preferencesSection.locator('input[name*="marketing" i][type="checkbox"]').first();
      if (await marketingOptOut.isVisible() && await marketingOptOut.isChecked()) {
        await marketingOptOut.uncheck();
      }
    }
  }

  /**
   * Save customer changes
   */
  private async saveCustomerChanges(page: Page): Promise<void> {
    this.logger.info('Saving customer changes');
    
    // Look for save button
    const saveButton = page.locator('button:has-text("Save"), button:has-text("Update"), button[type="submit"]').first();
    await this.bulletproofActions.bulletproofClick(saveButton, 'Save button');
    
    // Wait for save confirmation
    await page.waitForSelector('[role="alert"]:has-text("saved"), .success-message, .toast-success', { 
      timeout: 10000 
    }).catch(() => {
      // Some systems don't show confirmation, just wait for network idle
      return page.waitForLoadState('networkidle', { timeout: 5000 });
    });
  }

  /**
   * Get default marking options
   */
  private getDefaultMarkingOptions(): DNCMarkingOptions {
    return {
      updateMethod: 'both',
      tagName: 'DNC',
      fieldName: 'dnc_status',
      addNote: true,
      updateContactPreferences: true,
      optOutFromMarketing: true
    };
  }
}