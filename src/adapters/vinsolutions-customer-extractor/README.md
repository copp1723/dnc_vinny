# VinSolutions Customer Data Extractor

A robust customer data extraction adapter for VinSolutions CRM with streaming CSV parsing support for handling large datasets efficiently.

## Features

- 🚀 Automated browser-based extraction using Playwright
- 📊 Support for multiple report types (Customer List, CRM Export, Sales Activity, etc.)
- 🔄 Memory-efficient streaming CSV parser for 50,000+ records
- 📱 Phone number normalization and validation
- 📸 Screenshot capture for debugging
- 🔐 Secure credential handling
- 📅 Flexible date range selection
- 🎯 Batch processing for large datasets

## Installation

```bash
cd src/adapters/vinsolutions-customer-extractor
npm install
```

## Usage

### Basic Extraction

```typescript
import { VinSolutionsCustomerExtractor, CustomerReportType } from './index';

const extractor = new VinSolutionsCustomerExtractor();

const credentials = {
  username: 'your-username',
  password: 'your-password',
  url: 'https://dealer.vinsolutions.com'
};

const options = {
  dateRangeDays: 30,
  reportType: CustomerReportType.CUSTOMER_CONTACT_LIST,
  phoneNumbersOnly: true,
  maxRecords: 50000
};

const result = await extractor.extractCustomers(credentials, options);
```

### Streaming Large Datasets

```typescript
// Stream process customers without loading all into memory
for await (const customer of extractor.streamCustomers(credentials, options)) {
  // Process each customer
  console.log(`${customer.firstName} ${customer.lastName} - ${customer.phone}`);
}
```

### Parse Existing CSV

```typescript
const customers = await extractor.parseCustomerCSV('./path/to/file.csv', {
  maxRecords: 10000
});
```

## Report Types

- `CUSTOMER_CONTACT_LIST` - Full customer contact list
- `SALES_ACTIVITY_REPORT` - Sales-related customer data
- `CRM_CONTACT_EXPORT` - Complete CRM export
- `SERVICE_CUSTOMER_LIST` - Service department customers
- `MARKETING_LIST` - Marketing campaign contacts

## Customer Data Structure

```typescript
interface CustomerData {
  firstName: string;
  lastName: string;
  phone: string;          // Normalized to E.164 format
  email?: string;
  customerId?: string;
  dealershipId?: string;
  lastContactDate?: Date;
  source?: string;
  status?: string;
  tags?: string[];
  metadata?: Record<string, any>;
}
```

## Phone Number Handling

The extractor includes robust phone number processing:

- Normalizes to E.164 format (+1XXXXXXXXXX)
- Validates US phone numbers
- Removes invalid/test numbers
- Handles multiple formats: (XXX) XXX-XXXX, XXX-XXX-XXXX, etc.

```typescript
import { PhoneNumberUtils } from './utils/PhoneNumberUtils';

// Normalize phone
const normalized = PhoneNumberUtils.normalize('(555) 123-4567');
// Returns: '+15551234567'

// Validate phone
const isValid = PhoneNumberUtils.isValid('555-123-4567');
// Returns: true

// Format for display
const formatted = PhoneNumberUtils.formatForDisplay('+15551234567');
// Returns: '(555) 123-4567'
```

## CSV Parsing

The streaming CSV parser handles various VinSolutions export formats:

- Auto-detects column headers
- Maps multiple field name variations
- Processes files in configurable batches
- Skips invalid records
- Provides parsing statistics

## Environment Variables

```bash
VINSOLUTIONS_USERNAME=your-username
VINSOLUTIONS_PASSWORD=your-password
VINSOLUTIONS_URL=https://dealer.vinsolutions.com
DEALERSHIP_ID=optional-dealer-id
```

## Running Examples

```bash
# Extract customers
npm run extract

# Stream process customers
npm run stream

# Parse existing CSV
npm run parse
```

## Error Handling

The extractor includes comprehensive error handling:

- Login failures with screenshots
- Navigation issues with fallback strategies
- Download failures with retry logic
- CSV parsing errors with detailed logs

## Performance Considerations

- Streaming parser for memory efficiency
- Batch processing to handle large datasets
- Configurable record limits
- Duplicate detection based on phone numbers

## Debugging

Enable detailed logging and screenshots:

1. Screenshots are saved to `./screenshots/customers/`
2. Downloads are saved to `./downloads/customers/`
3. Each step is logged with status indicators

## Security

- Credentials are never logged
- Secure browser context
- Phone numbers are validated before processing
- CSV injection prevention

## License

MIT