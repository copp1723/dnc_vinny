import { 
  VinSolutionsCustomerExtractor, 
  CustomerReportType,
  CustomerExtractionOptions,
  VinSolutionsCredentials 
} from './index';

async function extractCustomersExample() {
  // Configure credentials
  const credentials: VinSolutionsCredentials = {
    username: process.env.VINSOLUTIONS_USERNAME || 'your-username',
    password: process.env.VINSOLUTIONS_PASSWORD || 'your-password',
    url: process.env.VINSOLUTIONS_URL || 'https://dealer.vinsolutions.com',
    dealershipId: process.env.DEALERSHIP_ID
  };

  // Configure extraction options
  const options: CustomerExtractionOptions = {
    dateRangeDays: 30,                                    // Last 30 days
    reportType: CustomerReportType.CUSTOMER_CONTACT_LIST, // Type of report
    includeInactive: false,                               // Skip inactive customers
    phoneNumbersOnly: true,                               // Also create phone list file
    batchSize: 1000,                                      // Process in batches
    maxRecords: 50000                                     // Limit for testing
  };

  const extractor = new VinSolutionsCustomerExtractor();

  try {
    console.log('Starting customer extraction...');
    
    // Extract customers
    const result = await extractor.extractCustomers(credentials, options);
    
    if (result.success) {
      console.log('✅ Extraction successful!');
      console.log(`📁 File: ${result.filePath}`);
      console.log(`📊 Records: ${result.recordCount}`);
      console.log(`⏱️ Time: ${result.extractionTime}ms`);
      console.log(`📸 Screenshots: ${result.screenshots?.join(', ')}`);
    } else {
      console.error('❌ Extraction failed:', result.error);
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

async function streamCustomersExample() {
  const credentials: VinSolutionsCredentials = {
    username: process.env.VINSOLUTIONS_USERNAME || 'your-username',
    password: process.env.VINSOLUTIONS_PASSWORD || 'your-password',
    url: process.env.VINSOLUTIONS_URL || 'https://dealer.vinsolutions.com'
  };

  const options: CustomerExtractionOptions = {
    dateRangeDays: 7,
    reportType: CustomerReportType.CRM_CONTACT_EXPORT
  };

  const extractor = new VinSolutionsCustomerExtractor();

  try {
    console.log('Starting customer streaming...');
    
    let count = 0;
    // Stream process customers without loading all into memory
    for await (const customer of extractor.streamCustomers(credentials, options)) {
      count++;
      
      // Process each customer
      console.log(`Customer ${count}: ${customer.firstName} ${customer.lastName} - ${customer.phone}`);
      
      // You can add your processing logic here
      // e.g., save to database, check DNC status, etc.
      
      // Example: Stop after 100 for demo
      if (count >= 100) break;
    }
    
    console.log(`✅ Processed ${count} customers`);

  } catch (error) {
    console.error('Error:', error);
  }
}

async function parseExistingCSVExample() {
  const extractor = new VinSolutionsCustomerExtractor();
  
  try {
    // Parse an existing CSV file
    const customers = await extractor.parseCustomerCSV('./downloads/customers/existing-file.csv', {
      maxRecords: 1000
    });
    
    console.log(`Parsed ${customers.length} customers`);
    
    // Group by area code
    const byAreaCode = new Map<string, number>();
    customers.forEach(customer => {
      const areaCode = customer.phone.substring(2, 5); // Skip +1
      byAreaCode.set(areaCode, (byAreaCode.get(areaCode) || 0) + 1);
    });
    
    console.log('Customers by area code:');
    byAreaCode.forEach((count, areaCode) => {
      console.log(`  ${areaCode}: ${count} customers`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run examples based on command line argument
const example = process.argv[2];

switch (example) {
  case 'extract':
    extractCustomersExample();
    break;
  case 'stream':
    streamCustomersExample();
    break;
  case 'parse':
    parseExistingCSVExample();
    break;
  default:
    console.log('Usage: ts-node example.ts [extract|stream|parse]');
    console.log('  extract - Extract customers from VinSolutions');
    console.log('  stream  - Stream process customers');
    console.log('  parse   - Parse existing CSV file');
}