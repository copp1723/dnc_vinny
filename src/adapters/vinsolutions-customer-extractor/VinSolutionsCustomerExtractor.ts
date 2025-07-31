import { chromium, Browser, Page } from 'playwright';
import path from 'path';
import fs from 'fs-extra';
import { FileManager } from './utils/FileManager';
import { CSVStreamParser } from './utils/CSVStreamParser';
import { PhoneNumberUtils } from './utils/PhoneNumberUtils';
import { 
  VinSolutionsCredentials, 
  CustomerData, 
  CustomerExtractionOptions, 
  ExtractionResult,
  CustomerReportType 
} from './types';

export class VinSolutionsCustomerExtractor {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private screenshots: string[] = [];
  private fileManager = new FileManager();
  private downloadPath = './downloads/customers';
  private screenshotPath = './screenshots/customers';

  async initialize(): Promise<void> {
    console.log('🚀 Initializing VinSolutions Customer Extractor...');
    
    this.browser = await chromium.launch({
      headless: false,
      slowMo: 1000,
      timeout: 60000,
      args: ['--disable-blink-features=AutomationControlled']
    });

    this.page = await this.browser.newPage({
      viewport: { width: 1920, height: 1080 }
    });

    // Set up download handling
    await this.fileManager.ensureDirectory(this.downloadPath);
    this.page.on('download', async (download) => {
      const filename = download.suggestedFilename();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const savePath = path.join(this.downloadPath, `${timestamp}_${filename}`);
      
      await download.saveAs(savePath);
      console.log(`📥 Downloaded: ${savePath}`);
    });

    console.log('✅ Customer extractor initialized');
  }

  async takeScreenshot(name: string): Promise<string> {
    if (!this.page) throw new Error('Page not initialized');
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${timestamp}_${name}.png`;
    const screenshotPath = path.join(this.screenshotPath, filename);
    
    await this.fileManager.ensureDirectory(this.screenshotPath);
    await this.page.screenshot({ path: screenshotPath, fullPage: true });
    
    this.screenshots.push(screenshotPath);
    console.log(`📸 Screenshot: ${screenshotPath}`);
    return screenshotPath;
  }

  async login(credentials: VinSolutionsCredentials): Promise<boolean> {
    if (!this.page) throw new Error('Page not initialized');

    try {
      console.log('🔐 Starting login process...');
      
      await this.page.goto(credentials.url, { waitUntil: 'networkidle' });
      await this.takeScreenshot('01_login_page');

      await this.page.waitForTimeout(3000);

      // Username field selectors
      const usernameSelectors = [
        'input[name="username"]',
        'input[type="email"]', 
        '#username',
        'input[placeholder*="username" i]',
        'input[placeholder*="email" i]',
        'input[aria-label*="username" i]'
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
          continue;
        }
      }

      if (!usernameFound) {
        console.log('❌ Could not find username field');
        await this.takeScreenshot('02_username_not_found');
        return false;
      }

      // Password field selectors
      const passwordSelectors = [
        'input[name="password"]',
        'input[type="password"]',
        '#password',
        'input[placeholder*="password" i]',
        'input[aria-label*="password" i]'
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
          continue;
        }
      }

      if (!passwordFound) {
        console.log('❌ Could not find password field');
        await this.takeScreenshot('03_password_not_found');
        return false;
      }

      await this.takeScreenshot('04_credentials_entered');

      // Login button selectors
      const loginSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Login")',
        'button:has-text("Sign In")',
        'button:has-text("Log In")',
        '.login-button',
        '#login-button',
        'button[aria-label*="login" i]'
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
          continue;
        }
      }

      if (!loginClicked) {
        console.log('❌ Could not find login button');
        await this.takeScreenshot('05_login_button_not_found');
        return false;
      }

      console.log('⏳ Waiting for login to complete...');
      await this.page.waitForLoadState('networkidle', { timeout: 30000 });
      await this.takeScreenshot('06_after_login');

      const currentUrl = this.page.url();
      console.log(`📍 Current URL: ${currentUrl}`);

      if (currentUrl.includes('dashboard') || currentUrl.includes('home') || currentUrl.includes('dealer')) {
        console.log('✅ Login successful!');
        return true;
      }

      return false;

    } catch (error) {
      console.log(`❌ Login error: ${error.message}`);
      await this.takeScreenshot('07_login_error');
      return false;
    }
  }

  async navigateToCustomerReports(): Promise<boolean> {
    if (!this.page) throw new Error('Page not initialized');

    try {
      console.log('👥 Navigating to customer reports...');
      
      // First try to find Reports navigation
      const reportNavSelectors = [
        'a:has-text("Reports")',
        'button:has-text("Reports")',
        '[href*="reports"]',
        '.nav-reports',
        '#reports-nav',
        'nav >> text=Reports',
        '[aria-label*="reports" i]'
      ];

      let reportsFound = false;
      for (const selector of reportNavSelectors) {
        try {
          const element = await this.page.locator(selector).first();
          if (await element.isVisible({ timeout: 5000 })) {
            await element.click();
            console.log(`✅ Reports navigation clicked`);
            reportsFound = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!reportsFound) {
        console.log('⚠️ Could not find Reports navigation, looking for CRM...');
        
        // Try CRM navigation as alternative
        const crmSelectors = [
          'a:has-text("CRM")',
          'button:has-text("CRM")',
          '[href*="crm"]',
          'a:has-text("Customers")',
          'button:has-text("Customers")',
          '[href*="customers"]',
          'a:has-text("Contacts")',
          '[href*="contacts"]'
        ];

        for (const selector of crmSelectors) {
          try {
            const element = await this.page.locator(selector).first();
            if (await element.isVisible({ timeout: 5000 })) {
              await element.click();
              console.log(`✅ CRM/Customers navigation clicked`);
              reportsFound = true;
              break;
            }
          } catch (e) {
            continue;
          }
        }
      }

      if (!reportsFound) {
        console.log('❌ Could not find Reports or CRM navigation');
        await this.takeScreenshot('08_navigation_not_found');
        return false;
      }

      await this.page.waitForLoadState('networkidle');
      await this.takeScreenshot('09_reports_page');

      // Look for customer-related reports or export options
      console.log('🔍 Looking for customer export options...');
      
      const customerReportSelectors = [
        'text=Customer List',
        'text=Contact List',
        'text=Customer Export',
        'text=Export Customers',
        'text=Export Contacts',
        'text=Download Customers',
        'text=Customer Report',
        'text=Contact Report',
        'button:has-text("Export")',
        'a:has-text("Export")',
        '[aria-label*="export" i]'
      ];

      for (const selector of customerReportSelectors) {
        try {
          const element = await this.page.locator(selector).first();
          if (await element.isVisible({ timeout: 5000 })) {
            console.log(`✅ Found customer export option: ${selector}`);
            await this.takeScreenshot('10_customer_export_found');
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      // Check if we're on a page with customer data
      const pageContent = await this.page.textContent('body');
      if (pageContent?.toLowerCase().includes('customer') || 
          pageContent?.toLowerCase().includes('contact')) {
        console.log('✅ On customer/contact page');
        return true;
      }

      console.log('⚠️ Customer reports not directly found, but continuing...');
      return true;

    } catch (error) {
      console.log(`❌ Navigation error: ${error.message}`);
      await this.takeScreenshot('11_navigation_error');
      return false;
    }
  }

  async selectDateRange(days: number): Promise<boolean> {
    if (!this.page) throw new Error('Page not initialized');

    try {
      console.log(`📅 Selecting date range: Last ${days} days...`);
      
      // Look for date range selectors
      const dateRangeSelectors = [
        'text=Date Range',
        'text=Date Filter',
        '[aria-label*="date" i]',
        'input[type="date"]',
        '.date-range-picker',
        '#dateRange',
        'button:has-text("Last 30 Days")',
        'button:has-text("Date")'
      ];

      let dateRangeFound = false;
      for (const selector of dateRangeSelectors) {
        try {
          const element = await this.page.locator(selector).first();
          if (await element.isVisible({ timeout: 5000 })) {
            await element.click();
            console.log(`✅ Date range selector clicked`);
            dateRangeFound = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!dateRangeFound) {
        console.log('⚠️ No date range selector found, proceeding with default range');
        return true;
      }

      await this.page.waitForTimeout(1000);

      // Try to select predefined range
      const rangeOptions = [
        `Last ${days} Days`,
        'Last 30 Days',
        'Last Month',
        'Custom Range'
      ];

      for (const option of rangeOptions) {
        try {
          const optionElement = await this.page.locator(`text="${option}"`).first();
          if (await optionElement.isVisible({ timeout: 2000 })) {
            await optionElement.click();
            console.log(`✅ Selected date range: ${option}`);
            await this.takeScreenshot('12_date_range_selected');
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      // If no predefined option, try custom date inputs
      console.log('📅 Using custom date range...');
      
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      // Try to find and fill date inputs
      const startInputs = await this.page.locator('input[type="date"]').all();
      if (startInputs.length >= 2) {
        await startInputs[0].fill(startDateStr);
        await startInputs[1].fill(endDateStr);
        console.log(`✅ Custom date range set: ${startDateStr} to ${endDateStr}`);
        
        // Look for apply button
        const applyButton = await this.page.locator('button:has-text("Apply")').first();
        if (await applyButton.isVisible({ timeout: 2000 })) {
          await applyButton.click();
        }
      }

      await this.takeScreenshot('13_date_range_complete');
      return true;

    } catch (error) {
      console.log(`❌ Date range selection error: ${error.message}`);
      return true; // Continue anyway
    }
  }

  async extractCustomerData(reportType: CustomerReportType): Promise<string | null> {
    if (!this.page) throw new Error('Page not initialized');

    try {
      console.log(`📊 Extracting customer data for report type: ${reportType}...`);
      
      // Map report types to UI text
      const reportTypeMap = {
        [CustomerReportType.CUSTOMER_CONTACT_LIST]: ['Customer List', 'Contact List', 'All Customers'],
        [CustomerReportType.SALES_ACTIVITY_REPORT]: ['Sales Activity', 'Sales Report', 'Sales Customers'],
        [CustomerReportType.CRM_CONTACT_EXPORT]: ['CRM Export', 'Export All', 'Full Export'],
        [CustomerReportType.SERVICE_CUSTOMER_LIST]: ['Service Customers', 'Service List'],
        [CustomerReportType.MARKETING_LIST]: ['Marketing List', 'Campaign List']
      };

      const reportTexts = reportTypeMap[reportType] || ['Export', 'Download'];

      // Look for specific report type
      let reportFound = false;
      for (const reportText of reportTexts) {
        try {
          const reportElement = await this.page.locator(`text="${reportText}"`).first();
          if (await reportElement.isVisible({ timeout: 5000 })) {
            await reportElement.click();
            console.log(`✅ Selected report: ${reportText}`);
            reportFound = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      // Look for export/download button
      console.log('⬇️ Looking for export button...');
      
      const exportSelectors = [
        'button:has-text("Export")',
        'button:has-text("Download")',
        'button:has-text("Export to CSV")',
        'button:has-text("Download CSV")',
        'a:has-text("Export")',
        'a:has-text("Download")',
        '[aria-label*="export" i]',
        '[aria-label*="download" i]',
        '.export-button',
        '.download-button'
      ];

      let downloadStarted = false;
      let downloadPath: string | null = null;

      for (const selector of exportSelectors) {
        try {
          const element = await this.page.locator(selector).first();
          if (await element.isVisible({ timeout: 5000 })) {
            // Set up download promise before clicking
            const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 });
            
            await element.click();
            console.log(`✅ Export button clicked`);
            
            // Wait for download
            const download = await downloadPromise;
            const filename = download.suggestedFilename();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            downloadPath = path.join(this.downloadPath, `${timestamp}_${filename}`);
            
            await download.saveAs(downloadPath);
            console.log(`✅ File downloaded: ${downloadPath}`);
            
            downloadStarted = true;
            break;
          }
        } catch (e) {
          console.log(`Export attempt failed: ${e.message}`);
          continue;
        }
      }

      if (!downloadStarted) {
        // Try alternative approach - look for existing download links
        console.log('🔍 Looking for existing download links...');
        
        const downloadLinks = await this.page.locator('a[href*=".csv"], a[href*=".xlsx"], a[href*="download"], a[href*="export"]').all();
        
        for (const link of downloadLinks) {
          try {
            const href = await link.getAttribute('href');
            if (href && (href.includes('.csv') || href.includes('export') || href.includes('download'))) {
              const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 });
              await link.click();
              
              const download = await downloadPromise;
              const filename = download.suggestedFilename();
              const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
              downloadPath = path.join(this.downloadPath, `${timestamp}_${filename}`);
              
              await download.saveAs(downloadPath);
              console.log(`✅ File downloaded via link: ${downloadPath}`);
              downloadStarted = true;
              break;
            }
          } catch (e) {
            continue;
          }
        }
      }

      if (!downloadStarted) {
        console.log('❌ Could not initiate download');
        await this.takeScreenshot('14_download_failed');
        return null;
      }

      await this.takeScreenshot('15_download_complete');
      return downloadPath;

    } catch (error) {
      console.log(`❌ Data extraction error: ${error.message}`);
      await this.takeScreenshot('16_extraction_error');
      return null;
    }
  }

  async parseCustomerCSV(filePath: string, options?: { maxRecords?: number }): Promise<CustomerData[]> {
    console.log(`📄 Parsing CSV file: ${filePath}`);
    
    const parser = new CSVStreamParser({
      maxRows: options?.maxRecords,
      skipEmptyLines: true
    });

    const customers: CustomerData[] = [];
    const uniquePhones = new Set<string>();

    try {
      // Parse in batches for memory efficiency
      for await (const batch of parser.parseInBatches(filePath, 1000)) {
        for (const customer of batch) {
          // Skip duplicates based on phone number
          if (!uniquePhones.has(customer.phone)) {
            uniquePhones.add(customer.phone);
            customers.push(customer);
            
            if (options?.maxRecords && customers.length >= options.maxRecords) {
              break;
            }
          }
        }
        
        if (options?.maxRecords && customers.length >= options.maxRecords) {
          break;
        }
      }

      const stats = parser.getStats();
      console.log(`✅ Parsing complete. Stats:`, stats);
      console.log(`📊 Unique customers: ${customers.length}`);

      return customers;

    } catch (error) {
      console.error(`❌ CSV parsing error: ${error.message}`);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      console.log('🔒 Browser closed');
    }
  }

  /**
   * Main extraction workflow
   */
  async extractCustomers(
    credentials: VinSolutionsCredentials, 
    options: CustomerExtractionOptions
  ): Promise<ExtractionResult> {
    const startTime = Date.now();
    
    try {
      await this.initialize();
      
      // Login
      const loginSuccess = await this.login(credentials);
      if (!loginSuccess) {
        return {
          success: false,
          reportName: 'Customer Extract',
          reportType: options.reportType,
          error: 'Login failed',
          screenshots: this.screenshots
        };
      }

      // Navigate to customer reports
      const navSuccess = await this.navigateToCustomerReports();
      if (!navSuccess) {
        return {
          success: false,
          reportName: 'Customer Extract',
          reportType: options.reportType,
          error: 'Navigation to customer reports failed',
          screenshots: this.screenshots
        };
      }

      // Select date range
      await this.selectDateRange(options.dateRangeDays);

      // Extract data
      const downloadPath = await this.extractCustomerData(options.reportType);
      if (!downloadPath) {
        return {
          success: false,
          reportName: 'Customer Extract',
          reportType: options.reportType,
          error: 'Failed to download customer data',
          screenshots: this.screenshots
        };
      }

      // Parse the downloaded file
      const customers = await this.parseCustomerCSV(downloadPath, {
        maxRecords: options.maxRecords
      });

      // Optionally save phone numbers only
      if (options.phoneNumbersOnly) {
        const phoneListPath = downloadPath.replace(/\.[^.]+$/, '_phones.txt');
        const phoneNumbers = customers.map(c => PhoneNumberUtils.formatForDisplay(c.phone));
        await this.fileManager.writeFile(phoneListPath, phoneNumbers.join('\n'));
        console.log(`📱 Phone list saved: ${phoneListPath}`);
      }

      const endTime = Date.now();

      return {
        success: true,
        reportName: 'Customer Extract',
        reportType: options.reportType,
        filePath: downloadPath,
        recordCount: customers.length,
        screenshots: this.screenshots,
        extractionTime: endTime - startTime,
        metadata: {
          dateRange: {
            start: new Date(Date.now() - options.dateRangeDays * 24 * 60 * 60 * 1000),
            end: new Date()
          }
        }
      };

    } catch (error) {
      return {
        success: false,
        reportName: 'Customer Extract',
        reportType: options.reportType,
        error: `Unexpected error: ${error.message}`,
        screenshots: this.screenshots
      };
    } finally {
      await this.close();
    }
  }

  /**
   * Stream customers for processing without loading all into memory
   */
  async *streamCustomers(
    credentials: VinSolutionsCredentials,
    options: CustomerExtractionOptions
  ): AsyncGenerator<CustomerData, void, unknown> {
    try {
      // First extract the file
      const result = await this.extractCustomers(credentials, {
        ...options,
        phoneNumbersOnly: false // Ensure we get full data
      });

      if (!result.success || !result.filePath) {
        throw new Error(result.error || 'Failed to extract customer data');
      }

      // Stream parse the file
      const parser = new CSVStreamParser();
      yield* parser.parseCustomerData(result.filePath);

    } catch (error) {
      console.error(`❌ Streaming error: ${error.message}`);
      throw error;
    }
  }
}