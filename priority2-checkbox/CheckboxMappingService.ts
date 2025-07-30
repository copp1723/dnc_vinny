import { Page, FrameLocator } from 'playwright';
import { Logger } from '../utils/Logger';
import { BulletproofActions } from '../utils/BulletproofActions';
import { OpenRouterService, CheckboxMappingResult, FactoryEquipmentResult } from './OpenRouterService';
import { CheckboxSyncOptions, CheckboxSyncResult } from '../types/shared';

// Legacy interface for compatibility
export interface CheckboxSyncResultLegacy {
  success: boolean;
  totalCheckboxes: number;
  checkboxesSynced: number;
  checkboxesAlreadyCorrect: number;
  checkboxesNotFound: number;
  errors: Array<{
    factoryCode: string;
    error: string;
  }>;
  syncDetails: Array<{
    factoryCode: string;
    description: string;
    selector: string;
    wasChecked: boolean;
    shouldBeChecked: boolean;
    action: 'checked' | 'unchecked' | 'already_correct' | 'failed';
  }>;
}

/**
 * Enhanced Checkbox Mapping Service with Vision AI
 * 
 * This service uses Claude 3 Opus to:
 * 1. Map factory equipment data to UI checkboxes
 * 2. Perform intelligent checkbox synchronization
 * 3. Handle ExtJS virtual scrolling and complex UI patterns
 */
export class CheckboxMappingService {
  private logger: Logger;
  private bulletproof: BulletproofActions;
  private visionService?: OpenRouterService;
  
  constructor(
    logger: Logger, 
    bulletproof: BulletproofActions,
    visionService?: OpenRouterService
  ) {
    this.logger = logger;
    this.bulletproof = bulletproof;
    this.visionService = visionService;
  }
  
  /**
   * Sync checkboxes based on factory equipment data using vision AI
   */
  async syncCheckboxesWithVision(
    frameContext: Page | FrameLocator,
    factoryData: FactoryEquipmentResult,
    screenshotDir: string = 'screenshots'
  ): Promise<CheckboxSyncResultLegacy> {
    const result: CheckboxSyncResultLegacy = {
      success: false,
      totalCheckboxes: 0,
      checkboxesSynced: 0,
      checkboxesAlreadyCorrect: 0,
      checkboxesNotFound: 0,
      errors: [],
      syncDetails: []
    };
    
    try {
      this.logger.stepStart('Starting vision-based checkbox synchronization');
      
      if (!factoryData.features || factoryData.features.length === 0) {
        result.success = true; // No checkboxes to sync
        this.logger.info('No factory features to sync');
        return result;
      }
      
      result.totalCheckboxes = factoryData.features.length;
      
      // Take screenshot for vision analysis
      let page: Page;
      if ('screenshot' in frameContext) {
        // It's already a Page
        page = frameContext as Page;
      } else {
        // It's a FrameLocator - take screenshot of the main page
        // FrameLocator doesn't have direct access to page, so we'll handle this differently
        this.logger.warn('Cannot take screenshot from FrameLocator context directly');
        // For now, we'll skip vision analysis for frame contexts
        result.success = true;
        result.errors.push({ factoryCode: 'N/A', error: 'Vision analysis not available for iframe context' });
        return result;
      }
      
      const screenshot = await page.screenshot({ 
        type: 'png',
        fullPage: true
      });
      const base64 = screenshot.toString('base64');
      
      // Save screenshot for debugging
      await page.screenshot({ 
        path: `${screenshotDir}/checkbox-mapping-analysis.png`, 
        fullPage: true 
      });
      
      // Use vision AI to map factory features to checkboxes
      if (!this.visionService) {
        throw new Error('Vision service not available for checkbox mapping');
      }
      
      const mappingResult = await this.visionService.analyzeCheckboxMapping(
        base64,
        factoryData.features,
        'vAuto vehicle inventory interface with ExtJS components'
      );
      
      this.logger.info(`Vision mapping found ${mappingResult.mappings.length} checkbox mappings`);
      
      // Process each mapping
      for (const mapping of mappingResult.mappings) {
        try {
          const factoryFeature = factoryData.features.find(f => f.code === mapping.factoryCode);
          if (!factoryFeature) continue;
          
          await this.syncSingleCheckbox(
            frameContext,
            mapping,
            factoryFeature,
            result
          );
          
        } catch (error) {
          this.logger.error(`Error syncing checkbox for ${mapping.factoryCode}`, { error: error as Error });
          result.errors.push({
            factoryCode: mapping.factoryCode,
            error: (error as Error).message
          });
        }
      }
      
      // Handle unmapped features
      const unmappedFeatures = mappingResult.unmappedFeatures;
      result.checkboxesNotFound = unmappedFeatures.length;

      for (const unmappedCode of unmappedFeatures) {
          const feature = factoryData.features.find(f => f.code === unmappedCode);
          if (feature) {
              result.syncDetails.push({
                  factoryCode: feature.code,
                  description: feature.description,
                  selector: 'N/A',
                  wasChecked: false,
                  shouldBeChecked: feature.checked,
                  action: 'failed'
              });

              result.errors.push({
                  factoryCode: feature.code,
                  error: 'Could not find matching checkbox in UI'
              });
          }
      }
      
      result.success = result.errors.length < result.totalCheckboxes / 2; // Success if less than 50% errors
      
      this.logger.stepSuccess(`Checkbox sync completed: ${result.checkboxesSynced} synced, ${result.checkboxesAlreadyCorrect} already correct, ${result.checkboxesNotFound} not found, ${result.errors.length} errors`);
      
      return result;
      
    } catch (error) {
      this.logger.stepFailed('Vision-based checkbox synchronization', error as Error);
      result.errors.push({
        factoryCode: 'SYSTEM',
        error: (error as Error).message
      });
      return result;
    }
  }
  
  /**
   * Sync a single checkbox using bulletproof actions with enhanced ExtJS patterns
   */
  private async syncSingleCheckbox(
    frameContext: Page | FrameLocator,
    mapping: CheckboxMappingResult['mappings'][0],
    factoryFeature: { code: string; description: string; checked: boolean },
    result: CheckboxSyncResultLegacy
  ): Promise<void> {
    try {
      this.logger.stepStart(`Syncing checkbox for ${mapping.factoryCode}: ${factoryFeature.description}`);
      
      // Use enhanced detection strategies from proven patterns
      const syncSuccess = await this.syncCheckboxWithStrategies(
        frameContext,
        mapping.factoryCode,
        mapping.shouldCheck,
        factoryFeature.description
      );
      
      if (syncSuccess.found) {
        if (syncSuccess.wasAlreadyCorrect) {
          result.checkboxesAlreadyCorrect++;
          result.syncDetails.push({
            factoryCode: mapping.factoryCode,
            description: factoryFeature.description,
            selector: syncSuccess.selector || 'N/A',
            wasChecked: !mapping.shouldCheck,
            shouldBeChecked: mapping.shouldCheck,
            action: 'already_correct'
          });
        } else if (syncSuccess.synced) {
          result.checkboxesSynced++;
          result.syncDetails.push({
            factoryCode: mapping.factoryCode,
            description: factoryFeature.description,
            selector: syncSuccess.selector || 'N/A',
            wasChecked: !mapping.shouldCheck,
            shouldBeChecked: mapping.shouldCheck,
            action: mapping.shouldCheck ? 'checked' : 'unchecked'
          });
        } else {
          throw new Error(syncSuccess.error || 'Failed to sync checkbox');
        }
      } else {
        throw new Error('Checkbox not found with any strategy');
      }
      
    } catch (error) {
      this.logger.stepFailed(`Syncing checkbox ${mapping.factoryCode}`, error as Error);
      
      result.syncDetails.push({
        factoryCode: mapping.factoryCode,
        description: factoryFeature.description,
        selector: mapping.checkboxSelector,
        wasChecked: false,
        shouldBeChecked: mapping.shouldCheck,
        action: 'failed'
      });
      
      throw error;
    }
  }

  /**
   * Enhanced checkbox sync with multiple strategies from proven patterns
   * Implements Golden Rule #4: Specialized logic for ExtJS components
   */
  private async syncCheckboxWithStrategies(
    frameContext: Page | FrameLocator,
    optionCode: string,
    shouldBeChecked: boolean,
    description: string
  ): Promise<{
    found: boolean;
    synced: boolean;
    wasAlreadyCorrect: boolean;
    selector?: string;
    error?: string;
  }> {
    try {
      // Strategy 1: Try standard checkbox approaches first
      const standardResult = await this.tryStandardCheckbox(frameContext, optionCode, shouldBeChecked, description);
      if (standardResult.found) {
        return standardResult;
      }
      
      // Strategy 2: Try ExtJS image-based checkbox with enhanced patterns
      const extjsResult = await this.tryExtJSCheckbox(frameContext, optionCode, shouldBeChecked, description);
      if (extjsResult.found) {
        return extjsResult;
      }
      
      // Strategy 3: Try CSS class-based detection (FeatureTrue, FeatureStandout)
      const cssResult = await this.tryFeatureCSSCheckbox(frameContext, optionCode, shouldBeChecked, description);
      if (cssResult.found) {
        return cssResult;
      }
      
      // Strategy 4: Try text-based association with ancestor navigation
      const textResult = await this.tryTextBasedCheckbox(frameContext, optionCode, shouldBeChecked, description);
      if (textResult.found) {
        return textResult;
      }
      
      return {
        found: false,
        synced: false,
        wasAlreadyCorrect: false,
        error: `No checkbox found for option: ${optionCode}`
      };
      
    } catch (error) {
      return {
        found: false,
        synced: false,
        wasAlreadyCorrect: false,
        error: (error as Error).message
      };
    }
  }

  private async tryStandardCheckbox(
    frameContext: Page | FrameLocator,
    optionCode: string,
    shouldBeChecked: boolean,
    _description: string
  ): Promise<{
    found: boolean;
    synced: boolean;
    wasAlreadyCorrect: boolean;
    selector?: string;
  }> {
    // Standard HTML checkbox selectors
    const standardSelectors = [
      `input[type="checkbox"][name="${optionCode}"]`,
      `input[type="checkbox"][id="${optionCode}"]`,
      `input[type="checkbox"][value="${optionCode}"]`,
      `input[type="checkbox"][data-option="${optionCode}"]`,
      `input[type="checkbox"][data-code="${optionCode}"]`
    ];
    
    for (const selector of standardSelectors) {
      try {
        const checkbox = frameContext.locator(selector).first();
        const isVisible = await checkbox.isVisible({ timeout: 2000 });
        
        if (isVisible) {
          const currentState = await checkbox.isChecked();
          
          if (currentState === shouldBeChecked) {
            this.logger.info(`Standard checkbox already in correct state: ${optionCode}`);
            return {
              found: true,
              synced: true,
              wasAlreadyCorrect: true,
              selector
            };
          }
          
          // Change state
          if (shouldBeChecked) {
            await checkbox.check();
          } else {
            await checkbox.uncheck();
          }
          
          // Verify state change
          const newState = await checkbox.isChecked();
          if (newState === shouldBeChecked) {
            this.logger.info(`Standard checkbox synced: ${optionCode} using ${selector}`);
            return {
              found: true,
              synced: true,
              wasAlreadyCorrect: false,
              selector
            };
          }
        }
      } catch {
        // Try next selector
      }
    }
    
    return { found: false, synced: false, wasAlreadyCorrect: false };
  }

  private async tryExtJSCheckbox(
    frameContext: Page | FrameLocator,
    optionCode: string,
    shouldBeChecked: boolean,
    _description: string
  ): Promise<{
    found: boolean;
    synced: boolean;
    wasAlreadyCorrect: boolean;
    selector?: string;
  }> {
    // ExtJS image-based checkbox selectors with sprite handling
    const extjsSelectors = [
      `img[id*="${optionCode}"][src*="checkbox"]`,
      `img[alt*="${optionCode}"][src*="checkbox"]`,
      `img[title*="${optionCode}"][src*="checkbox"]`,
      `img[class*="checkbox"][id*="${optionCode}"]`,
      `//img[contains(@src, 'checkbox') and (contains(@id, '${optionCode}') or contains(@alt, '${optionCode}') or contains(@title, '${optionCode}'))]`,
      `//img[contains(@class, 'checkbox') and contains(@id, '${optionCode}')]`,
      `//td[contains(text(), '${optionCode}')]//img[contains(@src, 'checkbox')]`,
      `//label[contains(text(), '${optionCode}')]//img[contains(@src, 'checkbox')]`
    ];
    
    for (const selector of extjsSelectors) {
      try {
        const checkbox = frameContext.locator(selector).first();
        const isVisible = await checkbox.isVisible({ timeout: 2000 });
        
        if (isVisible) {
          // Enhanced state detection: Check both src and CSS classes
          const currentState = await this.detectExtJSCheckboxState(checkbox);
          
          if (currentState === shouldBeChecked) {
            this.logger.info(`ExtJS checkbox already in correct state: ${optionCode}`);
            return {
              found: true,
              synced: true,
              wasAlreadyCorrect: true,
              selector
            };
          }
          
          // Click to change state
          const success = await this.bulletproof.bulletproofClick(checkbox, `ExtJS checkbox ${optionCode}`);
          
          if (success) {
            // Brief wait for UI update
            await new Promise(resolve => setTimeout(resolve, 500));
          
            // Verify state change
            const newState = await this.detectExtJSCheckboxState(checkbox);
            
            if (newState === shouldBeChecked) {
              this.logger.info(`ExtJS checkbox synced: ${optionCode} using ${selector}`);
              return {
                found: true,
                synced: true,
                wasAlreadyCorrect: false,
                selector
              };
            }
          }
        }
      } catch {
        // Try next selector
      }
    }
    
    return { found: false, synced: false, wasAlreadyCorrect: false };
  }

  /**
   * Enhanced ExtJS checkbox state detection using both src and CSS classes
   */
  private async detectExtJSCheckboxState(checkbox: any): Promise<boolean> {
    try {
      // Method 1: Check image source
      const src = await checkbox.getAttribute('src');
      if (src && (
        src.includes('checked') || 
        src.includes('selected') || 
        src.includes('on') ||
        src.includes('true')
      )) {
        return true;
      }
      
      // Method 2: Check CSS classes for feature states (FeatureTrue, FeatureStandout)
      const className = await checkbox.getAttribute('class') || '';
      if (className.includes('FeatureTrue') || className.includes('FeatureStandout')) {
        return true;
      }
      if (className.includes('checked') || className.includes('selected')) {
        return true;
      }
      
      // Method 3: Check parent element classes (for complex ExtJS structures)
      const parentClass = await checkbox.evaluate((el: HTMLElement) => {
        const parent = el.parentElement;
        return parent ? parent.className : '';
      });
      if (parentClass.includes('FeatureTrue') || parentClass.includes('FeatureStandout')) {
        return true;
      }
      
      return false;
    } catch {
      return false;
    }
  }

  /**
   * CSS class-based feature detection for ExtJS components
   */
  private async tryFeatureCSSCheckbox(
    frameContext: Page | FrameLocator,
    optionCode: string,
    shouldBeChecked: boolean,
    description: string
  ): Promise<{
    found: boolean;
    synced: boolean;
    wasAlreadyCorrect: boolean;
    selector?: string;
  }> {
    // CSS class-based selectors for feature detection
    const featureSelectors = [
      `[data-option="${optionCode}"].FeatureTrue`,
      `[data-option="${optionCode}"].FeatureStandout`,
      `[data-code="${optionCode}"].FeatureTrue`,
      `[data-code="${optionCode}"].FeatureStandout`,
      `//div[contains(@class, 'FeatureTrue') and contains(text(), '${optionCode}')]`,
      `//div[contains(@class, 'FeatureStandout') and contains(text(), '${optionCode}')]`,
      `//td[contains(text(), '${optionCode}')]//ancestor::tr//div[contains(@class, 'FeatureTrue')]`,
      `//td[contains(text(), '${optionCode}')]//ancestor::tr//div[contains(@class, 'FeatureStandout')]`,
      // Ancestor navigation patterns
      `//td[contains(text(), '${optionCode}')]//ancestor::a[1]`,
      `//span[contains(text(), '${optionCode}')]//ancestor::a[1]`
    ];
    
    for (const selector of featureSelectors) {
      try {
        const element = frameContext.locator(selector).first();
        const isVisible = await element.isVisible({ timeout: 2000 });
        
        if (isVisible) {
          // Check current state based on CSS classes
          const className = await element.getAttribute('class') || '';
          const isCurrentlyChecked = className.includes('FeatureTrue') || className.includes('FeatureStandout');
          
          if (isCurrentlyChecked === shouldBeChecked) {
            this.logger.info(`CSS feature checkbox already in correct state: ${optionCode}`);
            return {
              found: true,
              synced: true,
              wasAlreadyCorrect: true,
              selector
            };
          }
          
          // Click to change state
          const success = await this.bulletproof.bulletproofClick(element, `CSS feature checkbox ${optionCode}`);
          
          if (success) {
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Verify state change
            const newClassName = await element.getAttribute('class') || '';
            const isNowChecked = newClassName.includes('FeatureTrue') || newClassName.includes('FeatureStandout');
            
            if (isNowChecked === shouldBeChecked) {
              this.logger.info(`CSS feature checkbox synced: ${optionCode} using ${selector}`);
              return {
                found: true,
                synced: true,
                wasAlreadyCorrect: false,
                selector
              };
            }
          }
        }
      } catch {
        // Try next selector
      }
    }
    
    return { found: false, synced: false, wasAlreadyCorrect: false };
  }

  private async tryTextBasedCheckbox(
    frameContext: Page | FrameLocator,
    optionCode: string,
    shouldBeChecked: boolean,
    description: string
  ): Promise<{
    found: boolean;
    synced: boolean;
    wasAlreadyCorrect: boolean;
    selector?: string;
  }> {
    // Enhanced text-based association selectors with ancestor navigation
    const textSelectors = [
      // Option code based selectors
      `//td[contains(text(), '${optionCode}')]/following-sibling::td//input[@type='checkbox']`,
      `//td[contains(text(), '${optionCode}')]/preceding-sibling::td//input[@type='checkbox']`,
      `//span[contains(text(), '${optionCode}')]/following-sibling::*//input[@type='checkbox']`,
      `//span[contains(text(), '${optionCode}')]/preceding-sibling::*//input[@type='checkbox']`,
      `//label[contains(text(), '${optionCode}')]//input[@type='checkbox']`,
      
      // Description based selectors
      `//td[contains(text(), '${description}')]/following-sibling::td//input[@type='checkbox']`,
      `//td[contains(text(), '${description}')]/preceding-sibling::td//input[@type='checkbox']`,
      `//span[contains(text(), '${description}')]/following-sibling::*//input[@type='checkbox']`,
      `//span[contains(text(), '${description}')]/preceding-sibling::*//input[@type='checkbox']`,
      `//label[contains(text(), '${description}')]//input[@type='checkbox']`,
      
      // Image checkbox selectors with ancestor navigation
      `//td[contains(text(), '${optionCode}')]/following-sibling::td//img[contains(@src, 'checkbox')]`,
      `//td[contains(text(), '${optionCode}')]/preceding-sibling::td//img[contains(@src, 'checkbox')]`,
      `//span[contains(text(), '${optionCode}')]/following-sibling::*//img[contains(@src, 'checkbox')]`,
      `//span[contains(text(), '${optionCode}')]/preceding-sibling::*//img[contains(@src, 'checkbox')]`,
      `//td[contains(text(), '${optionCode}')]//ancestor::tr//img[contains(@src, 'checkbox')]`,
      `//td[contains(text(), '${description}')]//ancestor::tr//img[contains(@src, 'checkbox')]`
    ];
    
    for (const selector of textSelectors) {
      try {
        const element = frameContext.locator(selector).first();
        const isVisible = await element.isVisible({ timeout: 2000 });
        
        if (isVisible) {
          const success = await this.handleTextBasedElement(element, shouldBeChecked, optionCode, selector);
          if (success.found) {
            return success;
          }
        }
      } catch {
        // Try next selector
      }
    }
    
    return { found: false, synced: false, wasAlreadyCorrect: false };
  }

  private async handleTextBasedElement(
    element: any,
    shouldBeChecked: boolean,
    optionCode: string,
    selector: string
  ): Promise<{
    found: boolean;
    synced: boolean;
    wasAlreadyCorrect: boolean;
    selector?: string;
  }> {
    try {
      const tagName = await element.evaluate((el: HTMLElement) => el.tagName.toLowerCase());
      
      if (tagName === 'input') {
        // Standard checkbox
        const currentState = await element.isChecked();
        
        if (currentState === shouldBeChecked) {
          this.logger.info(`Text-based checkbox already in correct state: ${optionCode}`);
          return {
            found: true,
            synced: true,
            wasAlreadyCorrect: true,
            selector
          };
        }
        
        if (shouldBeChecked) {
          await element.check();
        } else {
          await element.uncheck();
        }
        
        const newState = await element.isChecked();
        if (newState === shouldBeChecked) {
          this.logger.info(`Text-based checkbox synced: ${optionCode} using ${selector}`);
          return {
            found: true,
            synced: true,
            wasAlreadyCorrect: false,
            selector
          };
        }
        
      } else if (tagName === 'img') {
        // Image checkbox with enhanced detection
        const currentState = await this.detectExtJSCheckboxState(element);
        
        if (currentState === shouldBeChecked) {
          this.logger.info(`Text-based image checkbox already in correct state: ${optionCode}`);
          return {
            found: true,
            synced: true,
            wasAlreadyCorrect: true,
            selector
          };
        }
        
        const success = await this.bulletproof.bulletproofClick(element, `Text-based image checkbox ${optionCode}`);
        
        if (success) {
          await new Promise(resolve => setTimeout(resolve, 500));
          
          const newState = await this.detectExtJSCheckboxState(element);
          
          if (newState === shouldBeChecked) {
            this.logger.info(`Text-based image checkbox synced: ${optionCode} using ${selector}`);
            return {
              found: true,
              synced: true,
              wasAlreadyCorrect: false,
              selector
            };
          }
        }
      }
    } catch {
      // Element handling failed
    }
    
    return { found: false, synced: false, wasAlreadyCorrect: false };
  }
  
  /**
   * Batch sync multiple checkboxes using enhanced strategies
   */
  async syncMultipleCheckboxes(
    frameContext: Page | FrameLocator,
    options: Array<{ code: string; description: string; shouldBeChecked: boolean }>
  ): Promise<Array<{
    optionCode: string;
    description: string;
    found: boolean;
    synced: boolean;
    wasAlreadyCorrect: boolean;
    selector?: string;
    error?: string;
  }>> {
    this.logger.stepStart(`Sync ${options.length} checkboxes using enhanced strategies`);
    
    const results: Array<{
      optionCode: string;
      description: string;
      found: boolean;
      synced: boolean;
      wasAlreadyCorrect: boolean;
      selector?: string;
      error?: string;
    }> = [];
    
    for (const option of options) {
      const result: {
        optionCode: string;
        description: string;
        found: boolean;
        synced: boolean;
        wasAlreadyCorrect: boolean;
        selector?: string;
        error?: string;
      } = {
        optionCode: option.code,
        description: option.description,
        found: false,
        synced: false,
        wasAlreadyCorrect: false
      };
      
      try {
        const syncResult = await this.syncCheckboxWithStrategies(
          frameContext,
          option.code,
          option.shouldBeChecked,
          option.description
        );
        
        Object.assign(result, syncResult);
        
      } catch (error) {
        result.error = (error as Error).message;
      }
      
      results.push(result);
    }
    
    const syncedCount = results.filter(r => r.synced).length;
    this.logger.stepSuccess(`Enhanced batch checkbox sync completed: ${syncedCount}/${options.length}`);
    
    return results;
  }

  /**
   * Verify checkbox states match expected values using enhanced detection
   */
  async verifyCheckboxStates(
    frameContext: Page | FrameLocator,
    expectedStates: Array<{ code: string; shouldBeChecked: boolean }>
  ): Promise<boolean> {
    this.logger.stepStart('Verify checkbox states with enhanced detection');
    
    let allCorrect = true;
    
    for (const expected of expectedStates) {
      try {
        const found = await this.checkSingleCheckboxState(frameContext, expected.code, expected.shouldBeChecked);
        if (!found) {
          allCorrect = false;
          this.logger.warn(`Enhanced checkbox state verification failed for: ${expected.code}`);
        }
      } catch (error) {
        allCorrect = false;
        this.logger.warn(`Error verifying checkbox ${expected.code}: ${error}`);
      }
    }
    
    if (allCorrect) {
      this.logger.stepSuccess('All checkbox states verified with enhanced detection');
    } else {
      this.logger.stepFailed('Enhanced checkbox state verification', new Error('Some checkboxes not in expected state'));
    }
    
    return allCorrect;
  }

  private async checkSingleCheckboxState(
    frameContext: Page | FrameLocator,
    optionCode: string,
    expectedState: boolean
  ): Promise<boolean> {
    // Enhanced quick check using multiple detection methods
    const quickSelectors = [
      `input[type="checkbox"][name="${optionCode}"]`,
      `img[id*="${optionCode}"][src*="checkbox"]`,
      `//td[contains(text(), '${optionCode}')]//input[@type='checkbox']`,
      `[data-option="${optionCode}"].FeatureTrue`,
      `[data-option="${optionCode}"].FeatureStandout`
    ];
    
    for (const selector of quickSelectors) {
      try {
        const element = frameContext.locator(selector).first();
        const isVisible = await element.isVisible({ timeout: 1000 });
        
        if (isVisible) {
          const tagName = await element.evaluate((el: HTMLElement) => el.tagName.toLowerCase());
          
          if (tagName === 'input') {
            const currentState = await element.isChecked();
            return currentState === expectedState;
          } else if (tagName === 'img') {
            const currentState = await this.detectExtJSCheckboxState(element);
            return currentState === expectedState;
          } else {
            // Check CSS classes for feature states
            const className = await element.getAttribute('class') || '';
            const isChecked = className.includes('FeatureTrue') || className.includes('FeatureStandout');
            return isChecked === expectedState;
          }
        }
      } catch {
        // Try next selector
      }
    }
    
    return false; // Could not verify
  }

  /**
   * Handle ExtJS virtual scrolling to reveal all checkboxes
   */
  async handleVirtualScrolling(frameContext: Page | FrameLocator): Promise<void> {
    try {
      this.logger.stepStart('Handling ExtJS virtual scrolling');
      
      // Find scrollable container
      const scrollContainers = [
        '.x-grid-body',
        '.x-panel-body',
        '.x-container',
        '[role="grid"]',
        '.scrollable-content'
      ];
      
      for (const containerSelector of scrollContainers) {
        try {
          const container = frameContext.locator(containerSelector).first();
          
          if (await container.isVisible({ timeout: 2000 })) {
            this.logger.info(`Found scrollable container: ${containerSelector}`);
            
            // Scroll to top first
            await container.evaluate((el) => {
              el.scrollTop = 0;
            });
            
            // Scroll down in increments to load all virtual content
            const scrollHeight = await container.evaluate((el) => el.scrollHeight);
            const clientHeight = await container.evaluate((el) => el.clientHeight);
            
            if (scrollHeight > clientHeight) {
              this.logger.info(`Scrolling through ${scrollHeight}px of content`);
              
              let currentScroll = 0;
              const scrollIncrement = Math.min(clientHeight, 500);
              
              while (currentScroll < scrollHeight) {
                await container.evaluate((el, scroll) => {
                  el.scrollTop = scroll;
                }, currentScroll);
                
                // Wait for virtual content to load
                await new Promise(resolve => setTimeout(resolve, 500));
                
                currentScroll += scrollIncrement;
              }
              
              // Scroll back to top
              await container.evaluate((el) => {
                el.scrollTop = 0;
              });
              
              this.logger.stepSuccess('Virtual scrolling completed');
              return;
            }
          }
        } catch (error) {
          // Continue trying other containers
        }
      }
      
      this.logger.info('No virtual scrolling needed or container not found');
      
    } catch (error) {
      this.logger.stepFailed('ExtJS virtual scrolling', error as Error);
      // Don't fail the entire operation if scrolling fails
    }
  }
}