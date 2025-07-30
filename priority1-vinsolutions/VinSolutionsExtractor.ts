import { chromium, Browser, Page } from 'playwright';
import path from 'path';
import fs from 'fs-extra';
import { FileManager } from './utils/FileManager';

interface VinSolutionsCredentials {
  username: string;
  password: string;
  url: string;
}

interface ExtractionResult {
  success: boolean;
  reportName: string;
  filePath?: string;
  error?: string;
  screenshots?: string[];
}

export class VinSolutionsExtractor {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private screenshots: string[] = [];
  private fileManager = new FileManager();

  async initialize(): Promise<void> {
    console.log('🚀 Initializing VinSolutions extractor...');
    
    this.browser = await chromium.launch({
      headless: false, // Show browser so you can see what's happening
      slowMo: 1000,    // Slow down actions so you can follow along
      timeout: 60000
    });

    this.page = await this.browser.newPage({
      viewport: { width: 1920, height: 1080 }
    });

    // Set up download handling
    this.page.on('download', async (download) => {
      const filename = download.suggestedFilename();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const downloadPath = path.join('./downloads', `${timestamp}_${filename}`);
      
      await this.fileManager.ensureDirectory('./downloads');
      await download.saveAs(downloadPath);
      console.log(`📥 Downloaded: ${downloadPath}`);
    });

    console.log('✅ Browser initialized');
  }

  async takeScreenshot(name: string): Promise<string> {
    if (!this.page) throw new Error('Page not initialized');
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${timestamp}_${name}.png`;
    const screenshotPath = path.join('./screenshots', filename);
    
    await this.fileManager.ensureDirectory('./screenshots');
    await this.page.screenshot({ path: screenshotPath, fullPage: true });
    
    this.screenshots.push(screenshotPath);
    console.log(`📸 Screenshot: ${screenshotPath}`);
    return screenshotPath;
  }

  async login(credentials: VinSolutionsCredentials): Promise<boolean> {
    if (!this.page) throw new Error('Page not initialized');

    try {
      console.log('🔐 Starting login process...');
      
      // Navigate to VinSolutions
      await this.page.goto(credentials.url, { waitUntil: 'networkidle' });
      await this.takeScreenshot('01_login_page');

      // Wait a bit for page to fully load
      await this.page.waitForTimeout(3000);

      // Try to find username field - multiple strategies
      console.log('👤 Looking for username field...');
      
      const usernameSelectors = [
        'input[name="username"]',
        'input[type="email"]', 
        '#username',
        'input[placeholder*="username" i]',
        'input[placeholder*="email" i]'
      ];

      let usernameFound = false;
      for (const selector of usernameSelectors) {
        try {
          const element = await this.page.locator(selector).first();
          if (await element.isVisible({ timeout: 2000 })) {
            await element.fill(credentials.username);
            console.log(`✅ Username entered using selector: ${selector}`);
            usernameFound = true;
            break;
          }
        } catch (e) {
          console.log(`❌ Username selector failed: ${selector}`);
        }
      }

      if (!usernameFound) {
        console.log('❌ Could not find username field');
        await this.takeScreenshot('02_username_not_found');
        return false;
      }

      // Try to find password field
      console.log('🔑 Looking for password field...');
      
      const passwordSelectors = [
        'input[name="password"]',
        'input[type="password"]',
        '#password',
        'input[placeholder*="password" i]'
      ];

      let passwordFound = false;
      for (const selector of passwordSelectors) {
        try {
          const element = await this.page.locator(selector).first();
          if (await element.isVisible({ timeout: 2000 })) {
            await element.fill(credentials.password);
            console.log(`✅ Password entered using selector: ${selector}`);
            passwordFound = true;
            break;
          }
        } catch (e) {
          console.log(`❌ Password selector failed: ${selector}`);
        }
      }

      if (!passwordFound) {
        console.log('❌ Could not find password field');
        await this.takeScreenshot('03_password_not_found');
        return false;
      }

      await this.takeScreenshot('04_credentials_entered');

      // Try to find and click login button
      console.log('🔘 Looking for login button...');
      
      const loginSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Login")',
        'button:has-text("Sign In")',
        '.login-button',
        '#login-button'
      ];

      let loginClicked = false;
      for (const selector of loginSelectors) {
        try {
          const element = await this.page.locator(selector).first();
          if (await element.isVisible({ timeout: 2000 })) {
            await element.click();
            console.log(`✅ Login button clicked using selector: ${selector}`);
            loginClicked = true;
            break;
          }
        } catch (e) {
          console.log(`❌ Login button selector failed: ${selector}`);
        }
      }

      if (!loginClicked) {
        console.log('❌ Could not find login button');
        await this.takeScreenshot('05_login_button_not_found');
        return false;
      }

      // Wait for navigation
      console.log('⏳ Waiting for login to complete...');
      await this.page.waitForLoadState('networkidle', { timeout: 30000 });
      await this.takeScreenshot('06_after_login');

      // Check if login was successful
      const currentUrl = this.page.url();
      console.log(`📍 Current URL: ${currentUrl}`);

      if (currentUrl.includes('dashboard') || currentUrl.includes('dealer-dashboard')) {
        console.log('✅ Login successful!');
        return true;
      } else {
        console.log('❌ Login may have failed - not on dashboard');
        return false;
      }

    } catch (error) {
      console.log(`❌ Login error: ${error.message}`);
      await this.takeScreenshot('07_login_error');
      return false;
    }
  }

  async navigateToReports(): Promise<boolean> {
    if (!this.page) throw new Error('Page not initialized');

    try {
      console.log('📊 Navigating to reports section...');
      
      // Look for Reports link/button
      const reportSelectors = [
        'a:has-text("Reports")',
        'button:has-text("Reports")',
        '[href*="reports"]',
        '.nav-reports',
        '#reports-nav'
      ];

      let reportsFound = false;
      for (const selector of reportSelectors) {
        try {
          const element = await this.page.locator(selector).first();
          if (await element.isVisible({ timeout: 5000 })) {
            await element.click();
            console.log(`✅ Reports navigation clicked using selector: ${selector}`);
            reportsFound = true;
            break;
          }
        } catch (e) {
          console.log(`❌ Reports selector failed: ${selector}`);
        }
      }

      if (!reportsFound) {
        console.log('❌ Could not find Reports navigation');
        await this.takeScreenshot('08_reports_nav_not_found');
        return false;
      }

      await this.page.waitForLoadState('networkidle');
      await this.takeScreenshot('09_reports_page');

      // Verify we're on reports page
      const currentUrl = this.page.url();
      const pageContent = await this.page.textContent('body');
      
      if (currentUrl.includes('reports') || pageContent?.includes('REPORTS & DASHBOARDS')) {
        console.log('✅ Successfully navigated to reports');
        return true;
      } else {
        console.log('❌ May not be on reports page');
        return false;
      }

    } catch (error) {
      console.log(`❌ Navigation error: ${error.message}`);
      await this.takeScreenshot('10_navigation_error');
      return false;
    }
  }

  async extractLeadSourceROI(): Promise<ExtractionResult> {
    if (!this.page) throw new Error('Page not initialized');

    try {
      console.log('🎯 Looking for Lead Source ROI report...');

      // Look for "Lead Source ROI" text
      const reportName = 'Lead Source ROI';
      const reportLocator = this.page.locator(`text=${reportName}`).first();
      
      if (!(await reportLocator.isVisible({ timeout: 10000 }))) {
        console.log('❌ Lead Source ROI report not found');
        await this.takeScreenshot('11_report_not_found');
        return {
          success: false,
          reportName,
          error: 'Report not found on page',
          screenshots: this.screenshots
        };
      }

      console.log('✅ Found Lead Source ROI report');
      await this.takeScreenshot('12_report_found');

      // Look for checkbox in the same row
      console.log('☑️ Looking for checkbox...');
      
      try {
        // Find the row containing the report
        const reportRow = reportLocator.locator('..');
        const checkbox = reportRow.locator('input[type="checkbox"]').first();
        
        if (await checkbox.isVisible({ timeout: 5000 })) {
          await checkbox.click();
          console.log('✅ Checkbox clicked');
          await this.takeScreenshot('13_checkbox_selected');
        } else {
          console.log('⚠️ No checkbox found, continuing...');
        }
      } catch (e) {
        console.log('⚠️ Checkbox interaction failed, continuing...');
      }

      // Click on the report name to open it
      console.log('🖱️ Clicking on report to open...');
      await reportLocator.click();
      await this.page.waitForLoadState('networkidle');
      await this.takeScreenshot('14_report_opened');

      // Look for download button
      console.log('⬇️ Looking for download button...');
      
      const downloadSelectors = [
        'text=Download',
        'button:has-text("Download")',
        'a:has-text("Download")',
        '[data-testid*="download"]',
        '.download-button'
      ];

      let downloadClicked = false;
      for (const selector of downloadSelectors) {
        try {
          const element = await this.page.locator(selector).first();
          if (await element.isVisible({ timeout: 5000 })) {
            // Set up download promise before clicking
            const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 });
            
            await element.click();
            console.log(`✅ Download button clicked using selector: ${selector}`);
            
            // Wait for download to complete
            const download = await downloadPromise;
            const filename = download.suggestedFilename();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const downloadPath = path.join('./downloads', `${timestamp}_${filename}`);
            
            await fs.ensureDir('./downloads');
            await download.saveAs(downloadPath);
            
            console.log(`✅ File downloaded: ${downloadPath}`);
            await this.takeScreenshot('15_download_complete');
            
            downloadClicked = true;
            
            return {
              success: true,
              reportName,
              filePath: downloadPath,
              screenshots: this.screenshots
            };
          }
        } catch (e) {
          console.log(`❌ Download selector failed: ${selector} - ${e.message}`);
        }
      }

      if (!downloadClicked) {
        console.log('❌ Could not find or click download button');
        await this.takeScreenshot('16_download_not_found');
        return {
          success: false,
          reportName,
          error: 'Download button not found',
          screenshots: this.screenshots
        };
      }

      return {
        success: false,
        reportName,
        error: 'Unexpected end of extraction',
        screenshots: this.screenshots
      };

    } catch (error) {
      console.log(`❌ Extraction error: ${error.message}`);
      await this.takeScreenshot('17_extraction_error');
      return {
        success: false,
        reportName: 'Lead Source ROI',
        error: error.message,
        screenshots: this.screenshots
      };
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      console.log('🔒 Browser closed');
    }
  }

  // Main extraction workflow
  async extractReport(credentials: VinSolutionsCredentials): Promise<ExtractionResult> {
    try {
      await this.initialize();
      
      const loginSuccess = await this.login(credentials);
      if (!loginSuccess) {
        return {
          success: false,
          reportName: 'Lead Source ROI',
          error: 'Login failed',
          screenshots: this.screenshots
        };
      }

      const navSuccess = await this.navigateToReports();
      if (!navSuccess) {
        return {
          success: false,
          reportName: 'Lead Source ROI',
          error: 'Navigation to reports failed',
          screenshots: this.screenshots
        };
      }

      const result = await this.extractLeadSourceROI();
      return result;

    } catch (error) {
      return {
        success: false,
        reportName: 'Lead Source ROI',
        error: `Unexpected error: ${error.message}`,
        screenshots: this.screenshots
      };
    } finally {
      await this.close();
    }
  }
}
