import { Page, Locator, FrameLocator } from 'playwright';
import { Logger } from './Logger';

export interface BulletproofOptions {
  timeout?: number;
  retries?: number;
  waitForStable?: boolean;
  description?: string;
}

export interface ClickStrategy {
  name: string;
  execute: (locator: Locator) => Promise<void>;
}

export class BulletproofActions {
  private logger: Logger;
  private defaultTimeout: number;
  private defaultRetries: number;

  constructor(logger: Logger, defaultTimeout: number = 30000, defaultRetries: number = 3) {
    this.logger = logger;
    this.defaultTimeout = defaultTimeout;
    this.defaultRetries = defaultRetries;
  }

  /**
   * Golden Rule #2: Bulletproof Multi-Strategy Click
   * Combines standard clicks, JS dispatch events, and direct JS evaluation
   */
  async bulletproofClick(
    locator: Locator, 
    description: string,
    options: BulletproofOptions = {}
  ): Promise<boolean> {
    const timeout = options.timeout || this.defaultTimeout;
    const retries = options.retries || this.defaultRetries;
    
    this.logger.stepStart(`Bulletproof click: ${description}`);
    
    // Define click strategies in order of preference
    const strategies: ClickStrategy[] = [
      {
        name: 'Standard Click',
        execute: async (loc) => await loc.click({ timeout: timeout / 3 })
      },
      {
        name: 'Force Click',
        execute: async (loc) => await loc.click({ force: true, timeout: timeout / 3 })
      },
      {
        name: 'JS Dispatch Event',
        execute: async (loc) => await loc.dispatchEvent('click', { timeout: timeout / 3 })
      },
      {
        name: 'Direct JS Click',
        execute: async (loc) => await loc.evaluate((el: HTMLElement) => el.click())
      },
      {
        name: 'Mouse Click',
        execute: async (loc) => {
          const box = await loc.boundingBox();
          if (box) {
            await loc.page().mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          } else {
            throw new Error('Element not visible for mouse click');
          }
        }
      }
    ];

    for (let attempt = 1; attempt <= retries; attempt++) {
      for (const strategy of strategies) {
        try {
          // Wait for element to be visible and stable
          await locator.waitFor({ state: 'visible', timeout: timeout / 3 });
          
          if (options.waitForStable) {
            await locator.waitFor({ state: 'attached', timeout: timeout / 3 });
            await locator.page().waitForTimeout(500); // Brief stability wait
          }

          // Execute the strategy
          await strategy.execute(locator);
          
          this.logger.bulletproofClick(description, strategy.name, true);
          this.logger.stepSuccess(`Bulletproof click: ${description}`);
          return true;

        } catch (error) {
          this.logger.bulletproofClick(description, strategy.name, false);
          
          // If this is the last strategy and last attempt, log the error
          if (strategy === strategies[strategies.length - 1] && attempt === retries) {
            this.logger.stepFailed(`Bulletproof click: ${description}`, error as Error);
          }
        }
      }
      
      // Wait before retry
      if (attempt < retries) {
        await locator.page().waitForTimeout(1000 * attempt);
      }
    }

    return false;
  }

  /**
   * Golden Rule #1: Text-Based Selectors with Fallbacks
   * Try multiple selector strategies with text-based selectors prioritized
   */
  async findElementWithFallbacks(
    page: Page | FrameLocator,
    selectors: string[],
    description: string,
    options: BulletproofOptions = {}
  ): Promise<Locator | null> {
    const timeout = options.timeout || this.defaultTimeout;
    
    this.logger.stepStart(`Finding element: ${description}`);
    
    for (const selector of selectors) {
      try {
        const locator = page.locator(selector);
        await locator.waitFor({ state: 'visible', timeout: timeout / selectors.length });
        
        this.logger.selectorTried(selector, true);
        this.logger.stepSuccess(`Found element: ${description} using ${selector}`);
        return locator;
        
      } catch (error) {
        this.logger.selectorTried(selector, false);
      }
    }
    
    this.logger.stepFailed(`Finding element: ${description}`, new Error('All selectors failed'));
    return null;
  }

  /**
   * Golden Rule #3: Explicit Context Handling for iFrames
   */
  async getFrameLocator(page: Page, frameSelector: string, description: string): Promise<FrameLocator | null> {
    this.logger.stepStart(`Getting frame locator: ${description}`);
    
    try {
      // Wait for iframe to be present
      await page.waitForSelector(frameSelector, { timeout: this.defaultTimeout });
      
      // Get frame locator
      const frameLocator = page.frameLocator(frameSelector);
      
      // Verify frame is ready by checking for any content
      await frameLocator.locator('body').waitFor({ state: 'attached', timeout: 10000 });
      
      this.logger.contextSwitch('main page', description);
      this.logger.stepSuccess(`Frame locator ready: ${description}`);
      return frameLocator;
      
    } catch (error) {
      this.logger.stepFailed(`Getting frame locator: ${description}`, error as Error);
      return null;
    }
  }

  /**
   * Golden Rule #3: Explicit Context Handling for New Windows
   */
  async handleNewWindow(
    page: Page,
    triggerAction: () => Promise<void>,
    description: string
  ): Promise<Page | null> {
    this.logger.stepStart(`Handling new window: ${description}`);
    
    try {
      // Set up promise to wait for new page
      const newPagePromise = page.context().waitForEvent('page');
      
      // Execute the trigger action
      await triggerAction();
      
      // Wait for new page
      const newPage = await newPagePromise;
      
      // Wait for new page to load
      await newPage.waitForLoadState('domcontentloaded');
      
      this.logger.contextSwitch('main page', `new window: ${description}`);
      this.logger.stepSuccess(`New window ready: ${description}`);
      return newPage;
      
    } catch (error) {
      this.logger.stepFailed(`Handling new window: ${description}`, error as Error);
      return null;
    }
  }

  /**
   * Enhanced element interaction with explicit waits
   */
  async safeInput(
    locator: Locator,
    text: string,
    description: string,
    options: BulletproofOptions = {}
  ): Promise<boolean> {
    this.logger.stepStart(`Safe input: ${description}`);
    
    try {
      // Wait for element to be visible and enabled
      await locator.waitFor({ state: 'visible', timeout: options.timeout || this.defaultTimeout });
      
      // Clear existing content
      await locator.clear();
      
      // Type the text
      await locator.fill(text);
      
      // Verify the text was entered
      const value = await locator.inputValue();
      if (value !== text) {
        throw new Error(`Text verification failed. Expected: "${text}", Got: "${value}"`);
      }
      
      this.logger.stepSuccess(`Safe input: ${description}`);
      return true;
      
    } catch (error) {
      this.logger.stepFailed(`Safe input: ${description}`, error as Error);
      return false;
    }
  }

  /**
   * Enhanced element waiting with multiple conditions
   */
  async waitForElement(
    locator: Locator,
    description: string,
    options: {
      state?: 'visible' | 'attached' | 'detached' | 'hidden';
      timeout?: number;
      stable?: boolean;
    } = {}
  ): Promise<boolean> {
    const state = options.state || 'visible';
    const timeout = options.timeout || this.defaultTimeout;
    
    this.logger.stepStart(`Waiting for element: ${description} (${state})`);
    
    try {
      await locator.waitFor({ state, timeout });
      
      // Additional stability check if requested
      if (options.stable) {
        await locator.page().waitForTimeout(500);
        await locator.waitFor({ state, timeout: 2000 });
      }
      
      this.logger.stepSuccess(`Element ready: ${description}`);
      return true;
      
    } catch (error) {
      this.logger.stepFailed(`Waiting for element: ${description}`, error as Error);
      return false;
    }
  }

  /**
   * Specialized logic for ExtJS img-based checkboxes (Golden Rule #4)
   */
  async handleExtJSCheckbox(
    frameLocator: FrameLocator,
    optionCode: string,
    shouldCheck: boolean,
    description: string
  ): Promise<boolean> {
    this.logger.stepStart(`ExtJS checkbox: ${description} (${shouldCheck ? 'check' : 'uncheck'})`);
    
    // Multiple strategies for finding ExtJS checkboxes
    const checkboxSelectors = [
      `img[id*="${optionCode}"]`,
      `img[src*="checkbox"][alt*="${optionCode}"]`,
      `td:has-text("${optionCode}") img[src*="checkbox"]`,
      `label:has-text("${optionCode}") img`,
      `//img[contains(@src, 'checkbox') and (contains(@id, '${optionCode}') or contains(@alt, '${optionCode}'))]`
    ];
    
    for (const selector of checkboxSelectors) {
      try {
        const checkbox = frameLocator.locator(selector).first();
        await checkbox.waitFor({ state: 'visible', timeout: 5000 });
        
        // Check current state
        const src = await checkbox.getAttribute('src');
        const isCurrentlyChecked = src && (src.includes('checked') || src.includes('selected'));
        
        // Only click if state needs to change
        if (isCurrentlyChecked !== shouldCheck) {
          const success = await this.bulletproofClick(checkbox, `${description} checkbox`);
          if (success) {
            this.logger.stepSuccess(`ExtJS checkbox: ${description}`);
            return true;
          }
        } else {
          this.logger.info(`ExtJS checkbox already in correct state: ${description}`);
          return true;
        }
        
      } catch (error) {
        // Try next selector
      }
    }
    
    this.logger.stepFailed(`ExtJS checkbox: ${description}`, new Error('All checkbox selectors failed'));
    return false;
  }
}