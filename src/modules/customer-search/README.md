# Customer Search Module

A comprehensive module for searching, navigating, and managing DNC status for customers in VinSolutions CRM.

## Features

### 1. Customer Search
- **Search by Phone**: Supports multiple phone format variations
- **Search by Name**: With fuzzy matching support
- **Search by Email**: Direct email matching
- **Batch Search**: Process multiple customers efficiently
- **Smart Matching**: Fuzzy and partial match capabilities

### 2. Customer Navigation
- Direct URL navigation
- Search-based navigation
- Global search navigation
- Automatic fallback strategies
- Page verification

### 3. DNC Status Management
- Get current DNC status from multiple sources
- Update DNC checkbox/toggle
- Manage DNC tags
- Update contact preferences
- Add DNC notes with reasons
- Confirmation handling
- Before/after screenshots

## Installation

```typescript
import { createCustomerSearchModule } from './src/modules/customer-search';
import { Logger } from './priority5-compliance/logger';

const logger = new Logger({ level: 'info' });
const { searchService, navigationService, dncStatusService } = createCustomerSearchModule(logger);
```

## Usage Examples

### Search for Customer by Phone
```typescript
const results = await searchService.searchByPhone(page, '555-123-4567', {
  fuzzyMatch: true,
  partialMatch: true,
  maxResults: 5
});

for (const result of results) {
  console.log(`Found: ${result.customer.firstName} ${result.customer.lastName}`);
  console.log(`Match Score: ${result.matchScore}`);
  console.log(`Match Type: ${result.matchType}`);
}
```

### Navigate to Customer Profile
```typescript
const success = await navigationService.navigateToCustomerProfile(
  page,
  'CUST123456',
  {
    waitForPageLoad: true,
    screenshot: true,
    screenshotPath: 'screenshots/customer_profile.png'
  }
);
```

### Update DNC Status
```typescript
// Get current status
const currentStatus = await dncStatusService.getCurrentDNCStatus(page);

// Update status
const result = await dncStatusService.updateDNCStatus(page, true, {
  reason: 'Customer requested to be added to DNC list',
  addTag: true,
  updatePreferences: true,
  requireConfirmation: true
});

if (result.success) {
  console.log('DNC status updated successfully');
  console.log(`Previous: ${result.previousStatus.isDNC}`);
  console.log(`New: ${result.newStatus.isDNC}`);
}
```

### Batch Search
```typescript
const searchCriteria = [
  { phoneNumber: '555-111-1111' },
  { phoneNumber: '555-222-2222' },
  { firstName: 'John', lastName: 'Doe' }
];

const results = await searchService.batchSearch(page, searchCriteria, {
  batchSize: 10,
  onProgress: (processed, total) => {
    console.log(`Progress: ${processed}/${total}`);
  },
  onError: (criteria, error) => {
    console.error(`Failed: ${JSON.stringify(criteria)}`);
  }
});
```

### Process DNC Results from PossibleNOW
```typescript
// After receiving DNC phone numbers from PossibleNOW API
const dncPhoneNumbers = possibleNowResponse.dncNumbers;

for (const phoneNumber of dncPhoneNumbers) {
  // Search for customer
  const results = await searchService.searchByPhone(page, phoneNumber);
  
  if (results.length > 0) {
    const customer = results[0].customer;
    
    // Navigate to customer
    await navigationService.navigateToCustomerProfile(page, customer.customerId);
    
    // Mark as DNC
    await dncStatusService.updateDNCStatus(page, true, {
      reason: `Phone ${phoneNumber} found in Federal DNC Registry`,
      addTag: true,
      updatePreferences: true
    });
  }
}
```

## Phone Number Handling

The module automatically handles various phone formats:
- `5551234567` (10 digits)
- `555-123-4567` (dashes)
- `(555) 123-4567` (parentheses)
- `555.123.4567` (dots)
- `+15551234567` (E.164)
- `15551234567` (with country code)

## Error Handling

The module includes comprehensive error handling:
- **No Results Found**: Returns empty array
- **Multiple Matches**: Returns all matches sorted by score
- **Navigation Timeouts**: Falls back to alternative strategies
- **Save Failures**: Returns detailed error information

## Features

### Search Features
- **Fuzzy Matching**: Uses Levenshtein distance for name matching
- **Phone Variations**: Automatically tries multiple phone formats
- **Partial Matching**: Finds customers with partial information
- **Pagination Support**: Handles multi-page results

### Navigation Features
- **Multiple Strategies**: Direct URL, search, and global search
- **Automatic Verification**: Confirms correct customer page
- **Screenshot Support**: Documents navigation results

### DNC Status Features
- **Multiple Sources**: Checks checkboxes, tags, custom fields, preferences, and notes
- **Comprehensive Updates**: Updates all DNC indicators
- **Audit Trail**: Adds notes with timestamps and reasons
- **Confirmation Handling**: Manages confirmation dialogs
- **Status Verification**: Confirms changes were saved

## Best Practices

1. **Always verify navigation** before updating DNC status
2. **Use batch search** for processing multiple customers
3. **Include reasons** when updating DNC status for audit trails
4. **Take screenshots** for compliance documentation
5. **Handle errors gracefully** and log failures

## Integration with DNC Workflow

This module integrates seamlessly with the DNC compliance workflow:

```typescript
// In DNCMarkingService
import { createCustomerSearchModule } from '../customer-search';

const { searchService, navigationService, dncStatusService } = createCustomerSearchModule(logger);

// Use in workflow
for (const dncResult of dncResults) {
  const searchResults = await searchService.searchByPhone(page, dncResult.phoneNumber);
  
  for (const result of searchResults) {
    await navigationService.navigateToCustomerProfile(page, result.customer.customerId);
    await dncStatusService.updateDNCStatus(page, true, {
      reason: dncResult.reason,
      addTag: true
    });
  }
}
```