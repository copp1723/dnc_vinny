import { Page } from 'playwright';
import { BulletproofActions } from '../../../priority2-checkbox/BulletproofActions';
import { Logger } from '../../../priority5-compliance/logger';
import { NavigationOptions } from './types';

/**
 * Service for navigating to customer profiles in VinSolutions
 */
export class CustomerNavigationService {
  private bulletproofActions: BulletproofActions;
  
  constructor(
    private logger: Logger
  ) {
    this.bulletproofActions = new BulletproofActions(logger);
  }

  /**
   * Navigate to customer profile by ID
   */
  async navigateToCustomerProfile(
    page: Page,
    customerId: string,
    options: NavigationOptions = {}
  ): Promise<boolean> {
    this.logger.info(`Navigating to customer profile: ${customerId}`);
    
    try {
      // Try multiple navigation strategies
      const navigationStrategies = [
        () => this.directUrlNavigation(page, customerId, options),
        () => this.searchAndNavigate(page, customerId, options),
        () => this.globalSearchNavigation(page, customerId, options)
      ];
      
      for (const strategy of navigationStrategies) {
        try {
          const success = await strategy();
          if (success) {
            // Verify we're on the correct customer page
            if (await this.verifyCustomerPage(page, customerId)) {
              // Take screenshot if requested
              if (options.screenshot) {
                await this.takeNavigationScreenshot(page, customerId, options.screenshotPath);
              }
              
              this.logger.info(`Successfully navigated to customer ${customerId}`);
              return true;
            }
          }
        } catch (error) {
          this.logger.warn(`Navigation strategy failed: ${error}`);
        }
      }
      
      throw new Error(`Failed to navigate to customer ${customerId}`);
      
    } catch (error) {
      this.logger.error(`Navigation failed for customer ${customerId}`, error as Error);
      return false;
    }
  }

  /**
   * Navigate using direct URL
   */
  private async directUrlNavigation(
    page: Page,
    customerId: string,
    options: NavigationOptions
  ): Promise<boolean> {
    this.logger.info('Trying direct URL navigation');
    
    // Build customer URL
    const baseUrl = page.url().split('/').slice(0, 3).join('/');
    const customerUrls = [
      `${baseUrl}/customers/${customerId}`,
      `${baseUrl}/customer/${customerId}`,
      `${baseUrl}/crm/customers/${customerId}`,
      `${baseUrl}/contact/${customerId}`
    ];
    
    for (const url of customerUrls) {
      try {
        await page.goto(url, { 
          waitUntil: options.waitForPageLoad ? 'networkidle' : 'domcontentloaded',
          timeout: options.timeout || 30000 
        });
        
        // Check if navigation was successful
        if (await this.isCustomerPageLoaded(page)) {
          return true;
        }
      } catch (error) {
        // Try next URL
      }
    }
    
    return false;
  }

  /**
   * Navigate using search
   */
  private async searchAndNavigate(
    page: Page,
    customerId: string,
    options: NavigationOptions
  ): Promise<boolean> {
    this.logger.info('Trying search navigation');
    
    // Navigate to search page
    const searchLink = await this.bulletproofActions.findElementWithFallbacks(
      page,
      [
        'a:has-text("Search")',
        'a:has-text("Customers")',
        '[href*="/search"]',
        '[href*="/customers"]'
      ],
      'Search navigation link'
    );
    
    if (searchLink) {
      await this.bulletproofActions.bulletproofClick(searchLink, 'Search link');
      await page.waitForLoadState('domcontentloaded');
    }
    
    // Find search input
    const searchInput = await this.bulletproofActions.findElementWithFallbacks(
      page,
      [
        'input[type="search"]',
        'input[placeholder*="search"]',
        'input[name*="search"]',
        '#searchInput'
      ],
      'Search input'
    );
    
    if (!searchInput) {
      return false;
    }
    
    // Enter customer ID
    await this.bulletproofActions.safeInput(searchInput, customerId, 'Customer ID search');
    
    // Submit search
    await page.keyboard.press('Enter');
    
    // Wait for results
    await page.waitForSelector('[role="grid"], table, .search-results', { 
      timeout: options.timeout || 30000 
    });
    
    // Click on customer result
    const customerResult = await this.bulletproofActions.findElementWithFallbacks(
      page,
      [
        `[data-customer-id="${customerId}"]`,
        `tr:has-text("${customerId}")`,
        `a[href*="${customerId}"]`,
        `.customer-row:has-text("${customerId}")`
      ],
      'Customer search result'
    );
    
    if (customerResult) {
      await this.bulletproofActions.bulletproofClick(customerResult, 'Customer result');
      
      if (options.waitForPageLoad) {
        await page.waitForLoadState('networkidle', { timeout: options.timeout || 30000 });
      }
      
      return true;
    }
    
    return false;
  }

  /**
   * Navigate using global search
   */
  private async globalSearchNavigation(
    page: Page,
    customerId: string,
    options: NavigationOptions
  ): Promise<boolean> {
    this.logger.info('Trying global search navigation');
    
    // Find global search button/input
    const globalSearch = await this.bulletproofActions.findElementWithFallbacks(
      page,
      [
        '[aria-label*="global search"]',
        '[placeholder*="Search everywhere"]',
        '.global-search input',
        'button[aria-label*="search"]'
      ],
      'Global search'
    );
    
    if (!globalSearch) {
      return false;
    }
    
    // Click if it's a button
    if (await globalSearch.evaluate(el => el.tagName === 'BUTTON')) {
      await this.bulletproofActions.bulletproofClick(globalSearch, 'Global search button');
      
      // Wait for search input to appear
      const searchInput = await page.waitForSelector('input[type="search"], input[type="text"]', {
        timeout: 5000
      });
      
      await this.bulletproofActions.safeInput(searchInput, customerId, 'Global search input');
    } else {
      // It's already an input
      await this.bulletproofActions.safeInput(globalSearch, customerId, 'Global search');
    }
    
    // Submit search
    await page.keyboard.press('Enter');
    
    // Wait for and click result
    await page.waitForTimeout(2000); // Wait for search results
    
    const result = await page.locator(`[data-result-id="${customerId}"], div:has-text("${customerId}")`).first();
    
    if (await result.isVisible()) {
      await this.bulletproofActions.bulletproofClick(result, 'Global search result');
      
      if (options.waitForPageLoad) {
        await page.waitForLoadState('networkidle', { timeout: options.timeout || 30000 });
      }
      
      return true;
    }
    
    return false;
  }

  /**
   * Check if customer page is loaded
   */
  private async isCustomerPageLoaded(page: Page): Promise<boolean> {
    // Check for customer page indicators
    const indicators = [
      '[data-page="customer"]',
      '[data-customer-id]',
      '.customer-details',
      'h1:has-text("Customer")',
      '[role="main"]:has-text("Contact Information")'
    ];
    
    for (const indicator of indicators) {
      if (await page.locator(indicator).isVisible({ timeout: 5000 }).catch(() => false)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Verify we're on the correct customer page
   */
  private async verifyCustomerPage(page: Page, customerId: string): Promise<boolean> {
    try {
      // Check URL
      if (page.url().includes(customerId)) {
        return true;
      }
      
      // Check page content
      const idElements = await page.locator(`text="${customerId}"`).count();
      if (idElements > 0) {
        return true;
      }
      
      // Check data attributes
      const dataId = await page.locator('[data-customer-id]').first().getAttribute('data-customer-id');
      if (dataId === customerId) {
        return true;
      }
      
      return false;
      
    } catch (error) {
      return false;
    }
  }

  /**
   * Take navigation screenshot
   */
  private async takeNavigationScreenshot(
    page: Page,
    customerId: string,
    screenshotPath?: string
  ): Promise<void> {
    const path = screenshotPath || `screenshots/navigation/customer_${customerId}_${Date.now()}.png`;
    
    try {
      await page.screenshot({ path, fullPage: true });
      this.logger.info(`Screenshot saved: ${path}`);
    } catch (error) {
      this.logger.warn(`Failed to take screenshot: ${error}`);
    }
  }
}