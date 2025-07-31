import { chromium, Browser, Page } from 'playwright';
import { createCustomerSearchModule } from './index';
import { Logger } from '../../../priority5-compliance/logger';
import { CustomerSearchCriteria, BatchSearchOptions } from './types';

/**
 * Example usage of the customer search module
 */
async function runCustomerSearchExample() {
  const logger = new Logger({
    level: 'info',
    format: 'pretty'
  });
  
  let browser: Browser | undefined;
  let page: Page | undefined;
  
  try {
    // Initialize browser
    browser = await chromium.launch({
      headless: false,
      slowMo: 50
    });
    
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });
    
    page = await context.newPage();
    
    // Create customer search module
    const { searchService, navigationService, dncStatusService } = createCustomerSearchModule(logger);
    
    // Login to VinSolutions (you would implement this)
    await page.goto('https://your-vinsolutions-url.com');
    // ... perform login ...
    
    // Example 1: Search by phone number
    logger.info('Example 1: Search by phone number');
    const phoneResults = await searchService.searchByPhone(page, '555-123-4567', {
      fuzzyMatch: true,
      partialMatch: true,
      maxResults: 5
    });
    
    logger.info(`Found ${phoneResults.length} customers by phone`);
    for (const result of phoneResults) {
      logger.info(`- ${result.customer.firstName} ${result.customer.lastName} (Score: ${result.matchScore})`);
    }
    
    // Example 2: Search by name
    logger.info('\nExample 2: Search by name');
    const nameResults = await searchService.searchByName(page, 'John', 'Smith', {
      fuzzyMatch: true,
      maxResults: 10
    });
    
    logger.info(`Found ${nameResults.length} customers by name`);
    
    // Example 3: Navigate to customer and check DNC status
    if (phoneResults.length > 0) {
      logger.info('\nExample 3: Navigate to customer and check DNC status');
      const customer = phoneResults[0].customer;
      
      if (customer.customerId) {
        // Navigate to customer
        const navSuccess = await navigationService.navigateToCustomerProfile(
          page,
          customer.customerId,
          {
            waitForPageLoad: true,
            screenshot: true
          }
        );
        
        if (navSuccess) {
          // Get current DNC status
          const currentStatus = await dncStatusService.getCurrentDNCStatus(page);
          logger.info(`Current DNC status: ${JSON.stringify(currentStatus)}`);
          
          // Update DNC status if not already marked
          if (!currentStatus.isDNC) {
            logger.info('Marking customer as DNC...');
            
            const updateResult = await dncStatusService.updateDNCStatus(page, true, {
              reason: 'Customer requested to be added to DNC list',
              addTag: true,
              updatePreferences: true,
              requireConfirmation: true
            });
            
            if (updateResult.success) {
              logger.info('Successfully marked customer as DNC');
              logger.info(`Screenshot saved: ${updateResult.confirmationScreenshot}`);
            } else {
              logger.error(`Failed to update DNC status: ${updateResult.error}`);
            }
          }
        }
      }
    }
    
    // Example 4: Batch search
    logger.info('\nExample 4: Batch search');
    const searchCriteria: CustomerSearchCriteria[] = [
      { phoneNumber: '555-111-1111' },
      { phoneNumber: '555-222-2222' },
      { firstName: 'Jane', lastName: 'Doe' },
      { email: 'test@example.com' }
    ];
    
    const batchOptions: BatchSearchOptions = {
      batchSize: 2,
      onProgress: (processed, total) => {
        logger.info(`Batch progress: ${processed}/${total}`);
      },
      onError: (criteria, error) => {
        logger.error(`Search failed for ${JSON.stringify(criteria)}: ${error.message}`);
      }
    };
    
    const batchResults = await searchService.batchSearch(page, searchCriteria, batchOptions);
    
    logger.info(`Batch search complete:`);
    logger.info(`- Total searched: ${batchResults.totalSearched}`);
    logger.info(`- Total found: ${batchResults.totalFound}`);
    logger.info(`- Errors: ${batchResults.errors.length}`);
    logger.info(`- Duration: ${batchResults.duration}ms`);
    
    // Example 5: Process DNC results from PossibleNOW
    logger.info('\nExample 5: Process DNC results from PossibleNOW');
    
    // Simulated DNC phone numbers from PossibleNOW API
    const dncPhoneNumbers = ['555-123-4567', '555-987-6543'];
    
    for (const phoneNumber of dncPhoneNumbers) {
      logger.info(`Processing DNC number: ${phoneNumber}`);
      
      // Search for customer
      const results = await searchService.searchByPhone(page, phoneNumber);
      
      if (results.length > 0) {
        for (const result of results) {
          if (result.customer.customerId) {
            // Navigate to customer
            await navigationService.navigateToCustomerProfile(page, result.customer.customerId);
            
            // Mark as DNC
            const updateResult = await dncStatusService.updateDNCStatus(page, true, {
              reason: `Phone number ${phoneNumber} found in Federal DNC Registry`,
              addTag: true,
              updatePreferences: true
            });
            
            if (updateResult.success) {
              logger.info(`✓ Marked customer ${result.customer.customerId} as DNC`);
            } else {
              logger.error(`✗ Failed to mark customer ${result.customer.customerId}: ${updateResult.error}`);
            }
          }
        }
      } else {
        logger.warn(`No customers found for DNC number: ${phoneNumber}`);
      }
    }
    
  } catch (error) {
    logger.error('Example failed', error as Error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Run the example
if (require.main === module) {
  runCustomerSearchExample().catch(console.error);
}