import { Page } from 'playwright';
import { BulletproofActions } from '../../../priority2-checkbox/BulletproofActions';
import { Logger } from '../../../priority5-compliance/logger';
import { DNCStatus, DNCUpdateResult } from './types';

/**
 * Service for managing DNC status in VinSolutions
 */
export class DNCStatusService {
  private bulletproofActions: BulletproofActions;
  
  constructor(
    private logger: Logger
  ) {
    this.bulletproofActions = new BulletproofActions(logger);
  }

  /**
   * Get current DNC status
   */
  async getCurrentDNCStatus(page: Page): Promise<DNCStatus> {
    this.logger.info('Getting current DNC status');
    
    try {
      const status: DNCStatus = {
        isDNC: false,
        tags: []
      };
      
      // Check multiple locations for DNC status
      
      // 1. Check DNC checkbox/toggle
      const dncCheckbox = await this.findDNCCheckbox(page);
      if (dncCheckbox) {
        status.isDNC = await this.isCheckboxChecked(dncCheckbox);
      }
      
      // 2. Check DNC tags
      const dncTags = await this.findDNCTags(page);
      status.tags = dncTags;
      if (dncTags.length > 0) {
        status.isDNC = true;
      }
      
      // 3. Check custom fields
      const customFieldStatus = await this.checkCustomFields(page);
      if (customFieldStatus.isDNC) {
        status.isDNC = true;
        status.dncType = customFieldStatus.type;
      }
      
      // 4. Check contact preferences
      const contactPrefs = await this.checkContactPreferences(page);
      if (contactPrefs.phoneOptedOut) {
        status.isDNC = true;
      }
      
      // 5. Look for DNC notes
      const dncNote = await this.findDNCNote(page);
      if (dncNote) {
        status.isDNC = true;
        status.dateMarked = dncNote.date;
        status.markedBy = dncNote.markedBy;
        status.reason = dncNote.reason;
      }
      
      this.logger.info(`Current DNC status: ${JSON.stringify(status)}`);
      return status;
      
    } catch (error) {
      this.logger.error('Failed to get DNC status', error as Error);
      throw error;
    }
  }

  /**
   * Update DNC status
   */
  async updateDNCStatus(
    page: Page,
    markAsDNC: boolean,
    options: {
      reason?: string;
      addTag?: boolean;
      updatePreferences?: boolean;
      requireConfirmation?: boolean;
    } = {}
  ): Promise<DNCUpdateResult> {
    this.logger.info(`Updating DNC status to: ${markAsDNC ? 'DNC' : 'Active'}`);
    
    const startTime = new Date();
    const previousStatus = await this.getCurrentDNCStatus(page);
    
    try {
      // Take before screenshot
      const beforeScreenshot = await this.takeStatusScreenshot(page, 'before');
      
      // Update DNC checkbox/toggle
      const checkboxUpdated = await this.updateDNCCheckbox(page, markAsDNC);
      
      // Add/remove DNC tag if requested
      if (options.addTag) {
        if (markAsDNC) {
          await this.addDNCTag(page);
        } else {
          await this.removeDNCTag(page);
        }
      }
      
      // Update contact preferences if requested
      if (options.updatePreferences) {
        await this.updateContactPreferences(page, markAsDNC);
      }
      
      // Add note with reason
      if (options.reason) {
        await this.addDNCNote(page, markAsDNC, options.reason);
      }
      
      // Save changes
      await this.saveChanges(page);
      
      // Handle confirmation if required
      if (options.requireConfirmation) {
        await this.handleConfirmation(page);
      }
      
      // Wait for save to complete
      await this.waitForSaveComplete(page);
      
      // Get new status
      const newStatus = await this.getCurrentDNCStatus(page);
      
      // Take after screenshot
      const afterScreenshot = await this.takeStatusScreenshot(page, 'after');
      
      return {
        success: true,
        previousStatus,
        newStatus,
        updateTime: startTime,
        confirmationScreenshot: afterScreenshot
      };
      
    } catch (error) {
      const err = error as Error;
      
      return {
        success: false,
        previousStatus,
        newStatus: previousStatus,
        updateTime: startTime,
        error: err.message
      };
    }
  }

  /**
   * Find DNC checkbox/toggle
   */
  private async findDNCCheckbox(page: Page): Promise<any> {
    const checkboxSelectors = [
      'input[name*="dnc"]',
      'input[name*="do_not_call"]',
      'input[aria-label*="Do Not Call"]',
      'label:has-text("DNC") input',
      'label:has-text("Do Not Call") input',
      '[data-field="dnc_status"] input',
      '.dnc-toggle input'
    ];
    
    for (const selector of checkboxSelectors) {
      const checkbox = page.locator(selector).first();
      if (await checkbox.isVisible({ timeout: 1000 }).catch(() => false)) {
        return checkbox;
      }
    }
    
    return null;
  }

  /**
   * Check if checkbox is checked
   */
  private async isCheckboxChecked(checkbox: any): Promise<boolean> {
    try {
      // Handle different checkbox types
      if (await checkbox.getAttribute('type') === 'checkbox') {
        return await checkbox.isChecked();
      }
      
      // Handle toggle switches
      const ariaChecked = await checkbox.getAttribute('aria-checked');
      if (ariaChecked) {
        return ariaChecked === 'true';
      }
      
      // Handle custom checkboxes
      const classes = await checkbox.getAttribute('class');
      if (classes) {
        return classes.includes('checked') || classes.includes('active');
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Update DNC checkbox
   */
  private async updateDNCCheckbox(page: Page, check: boolean): Promise<boolean> {
    const checkbox = await this.findDNCCheckbox(page);
    
    if (!checkbox) {
      this.logger.warn('DNC checkbox not found');
      return false;
    }
    
    const isChecked = await this.isCheckboxChecked(checkbox);
    
    if (isChecked !== check) {
      await this.bulletproofActions.bulletproofClick(checkbox, 'DNC checkbox');
      
      // Verify state changed
      await page.waitForTimeout(500);
      const newState = await this.isCheckboxChecked(checkbox);
      
      if (newState !== check) {
        throw new Error('Failed to update DNC checkbox state');
      }
    }
    
    return true;
  }

  /**
   * Find DNC tags
   */
  private async findDNCTags(page: Page): Promise<string[]> {
    const tags: string[] = [];
    
    const tagSelectors = [
      '.tag:has-text("DNC")',
      '.chip:has-text("DNC")',
      'span.badge:has-text("DNC")',
      '[data-tag*="DNC"]',
      '.customer-tags span:has-text("Do Not Call")'
    ];
    
    for (const selector of tagSelectors) {
      const tagElements = await page.locator(selector).all();
      for (const tag of tagElements) {
        const text = await tag.textContent();
        if (text) {
          tags.push(text.trim());
        }
      }
    }
    
    return [...new Set(tags)]; // Remove duplicates
  }

  /**
   * Add DNC tag
   */
  private async addDNCTag(page: Page): Promise<void> {
    this.logger.info('Adding DNC tag');
    
    // Find tags section
    const tagsSection = await this.bulletproofActions.findElementWithFallbacks(
      page,
      [
        '[data-section="tags"]',
        '.tags-container',
        'div:has-text("Tags"):has(button)',
        '[aria-label="Customer tags"]'
      ],
      'Tags section'
    );
    
    if (!tagsSection) {
      this.logger.warn('Tags section not found');
      return;
    }
    
    // Click add tag button
    const addButton = await tagsSection.locator('button:has-text("Add"), button[aria-label*="add tag"]').first();
    
    if (await addButton.isVisible()) {
      await this.bulletproofActions.bulletproofClick(addButton, 'Add tag button');
      
      // Enter tag
      const tagInput = await page.locator('input[placeholder*="tag"], input[name*="tag"]').last();
      await this.bulletproofActions.safeInput(tagInput, 'DNC', 'DNC tag');
      
      // Confirm
      await page.keyboard.press('Enter');
      
      // Wait for tag to appear
      await page.waitForSelector('span:has-text("DNC")', { timeout: 5000 });
    }
  }

  /**
   * Remove DNC tag
   */
  private async removeDNCTag(page: Page): Promise<void> {
    this.logger.info('Removing DNC tag');
    
    const dncTags = await page.locator('.tag:has-text("DNC"), .chip:has-text("DNC")').all();
    
    for (const tag of dncTags) {
      // Look for remove button on the tag
      const removeButton = await tag.locator('button, [aria-label*="remove"]').first();
      
      if (await removeButton.isVisible()) {
        await this.bulletproofActions.bulletproofClick(removeButton, 'Remove tag button');
      } else {
        // Try clicking the tag itself
        await this.bulletproofActions.bulletproofClick(tag, 'DNC tag');
        
        // Look for delete option
        const deleteOption = await page.locator('button:has-text("Delete"), button:has-text("Remove")').first();
        if (await deleteOption.isVisible()) {
          await this.bulletproofActions.bulletproofClick(deleteOption, 'Delete tag option');
        }
      }
    }
  }

  /**
   * Check custom fields for DNC status
   */
  private async checkCustomFields(page: Page): Promise<{ isDNC: boolean; type?: string }> {
    const customFields = await page.locator('[data-section="custom-fields"], .custom-fields').first();
    
    if (await customFields.isVisible()) {
      // Look for DNC-related fields
      const dncFields = await customFields.locator('[name*="dnc"], [data-field*="dnc"]').all();
      
      for (const field of dncFields) {
        const value = await field.inputValue().catch(() => '');
        
        if (value && (value.toLowerCase().includes('true') || value.toLowerCase().includes('yes'))) {
          return { isDNC: true, type: 'manual' };
        }
      }
    }
    
    return { isDNC: false };
  }

  /**
   * Check contact preferences
   */
  private async checkContactPreferences(page: Page): Promise<{ phoneOptedOut: boolean }> {
    const prefsSection = await page.locator('[data-section="preferences"], .contact-preferences').first();
    
    if (await prefsSection.isVisible()) {
      // Check phone preferences
      const phonePrefs = await prefsSection.locator('input[name*="phone"][type="checkbox"]').all();
      
      let allUnchecked = true;
      for (const pref of phonePrefs) {
        if (await pref.isChecked()) {
          allUnchecked = false;
          break;
        }
      }
      
      return { phoneOptedOut: allUnchecked };
    }
    
    return { phoneOptedOut: false };
  }

  /**
   * Update contact preferences
   */
  private async updateContactPreferences(page: Page, optOut: boolean): Promise<void> {
    this.logger.info(`Updating contact preferences: ${optOut ? 'opt out' : 'opt in'}`);
    
    const prefsSection = await page.locator('[data-section="preferences"], .contact-preferences').first();
    
    if (await prefsSection.isVisible()) {
      const phonePrefs = await prefsSection.locator('input[name*="phone"][type="checkbox"]').all();
      
      for (const pref of phonePrefs) {
        const isChecked = await pref.isChecked();
        
        if (optOut && isChecked) {
          await pref.uncheck();
        } else if (!optOut && !isChecked) {
          await pref.check();
        }
      }
    }
  }

  /**
   * Find DNC note
   */
  private async findDNCNote(page: Page): Promise<{ date: Date; markedBy: string; reason: string } | null> {
    // Navigate to notes if not visible
    const notesTab = await page.locator('[data-tab="notes"], button:has-text("Notes")').first();
    
    if (await notesTab.isVisible() && !(await notesTab.getAttribute('aria-selected'))) {
      await this.bulletproofActions.bulletproofClick(notesTab, 'Notes tab');
      await page.waitForTimeout(1000);
    }
    
    // Look for DNC notes
    const notes = await page.locator('.note-content:has-text("DNC"), .note:has-text("Do Not Call")').all();
    
    for (const note of notes) {
      const noteText = await note.textContent();
      
      if (noteText) {
        // Extract date
        const dateMatch = noteText.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        const date = dateMatch ? new Date(dateMatch[1]) : new Date();
        
        // Extract marked by
        const markedByMatch = noteText.match(/by: (.+?)(\n|$)/i);
        const markedBy = markedByMatch ? markedByMatch[1] : 'System';
        
        return {
          date,
          markedBy,
          reason: noteText
        };
      }
    }
    
    return null;
  }

  /**
   * Add DNC note
   */
  private async addDNCNote(page: Page, isDNC: boolean, reason: string): Promise<void> {
    this.logger.info('Adding DNC note');
    
    // Navigate to notes
    const notesTab = await page.locator('[data-tab="notes"], button:has-text("Notes")').first();
    
    if (await notesTab.isVisible()) {
      await this.bulletproofActions.bulletproofClick(notesTab, 'Notes tab');
      await page.waitForTimeout(1000);
    }
    
    // Click add note
    const addNoteButton = await page.locator('button:has-text("Add Note"), button[aria-label*="add note"]').first();
    
    if (await addNoteButton.isVisible()) {
      await this.bulletproofActions.bulletproofClick(addNoteButton, 'Add note button');
      
      // Enter note
      const noteContent = `DNC Status Update - ${new Date().toLocaleDateString()}
Status: ${isDNC ? 'DO NOT CALL' : 'Active'}
Reason: ${reason}
Updated by: DNC Compliance System`;
      
      const noteTextarea = await page.locator('textarea[name*="note"], textarea[placeholder*="note"]').first();
      await this.bulletproofActions.safeInput(noteTextarea, noteContent, 'DNC note');
      
      // Save note
      const saveButton = await page.locator('button:has-text("Save"), button:has-text("Add")').last();
      await this.bulletproofActions.bulletproofClick(saveButton, 'Save note button');
    }
  }

  /**
   * Save changes
   */
  private async saveChanges(page: Page): Promise<void> {
    this.logger.info('Saving changes');
    
    const saveButton = await this.bulletproofActions.findElementWithFallbacks(
      page,
      [
        'button[type="submit"]:has-text("Save")',
        'button:has-text("Save")',
        'button:has-text("Update")',
        'button:has-text("Apply")'
      ],
      'Save button'
    );
    
    if (saveButton) {
      await this.bulletproofActions.bulletproofClick(saveButton, 'Save button');
    }
  }

  /**
   * Handle confirmation dialog
   */
  private async handleConfirmation(page: Page): Promise<void> {
    try {
      // Wait for confirmation dialog
      const confirmDialog = await page.waitForSelector('[role="dialog"], .modal, .confirmation-dialog', {
        timeout: 5000
      });
      
      if (confirmDialog) {
        // Look for confirm button
        const confirmButton = await page.locator('button:has-text("Confirm"), button:has-text("Yes"), button:has-text("OK")').first();
        
        if (await confirmButton.isVisible()) {
          await this.bulletproofActions.bulletproofClick(confirmButton, 'Confirm button');
        }
      }
    } catch (error) {
      // No confirmation required
    }
  }

  /**
   * Wait for save to complete
   */
  private async waitForSaveComplete(page: Page): Promise<void> {
    try {
      // Wait for success message
      await page.waitForSelector('[role="alert"]:has-text("saved"), .success-message, .toast-success', {
        timeout: 10000
      });
    } catch (error) {
      // Wait for network idle as fallback
      await page.waitForLoadState('networkidle', { timeout: 5000 });
    }
  }

  /**
   * Take status screenshot
   */
  private async takeStatusScreenshot(page: Page, type: 'before' | 'after'): Promise<string> {
    const timestamp = Date.now();
    const path = `screenshots/dnc-status/${type}_${timestamp}.png`;
    
    try {
      await page.screenshot({ path, fullPage: true });
      return path;
    } catch (error) {
      this.logger.warn(`Failed to take screenshot: ${error}`);
      return '';
    }
  }
}