# DNC Compliance Workflow

A production-ready, end-to-end DNC (Do Not Call) compliance workflow that automates the process of checking customer phone numbers against DNC registries and updating CRM records accordingly.

## Features

- **Automated Customer Data Extraction**: Extracts customer data from VinSolutions with configurable date ranges
- **Batch DNC Checking**: Submits phone numbers to PossibleNOW API in optimized batches
- **CRM Updates**: Automatically marks DNC customers in VinSolutions using bulletproof actions
- **Checkpoint/Resume**: Full checkpoint support for resuming interrupted workflows
- **Progress Tracking**: Real-time progress tracking with ETA estimation
- **Scheduling**: Built-in scheduler for monthly automated runs
- **Multi-Dealership Support**: Process multiple dealerships in a single workflow
- **Comprehensive Reporting**: Generate compliance reports in PDF, Excel, JSON, and HTML formats
- **Error Recovery**: Robust error handling with partial completion support
- **2FA Support**: Handles two-factor authentication for VinSolutions login

## Architecture

The workflow is built using a modular architecture with the following components:

- **DNCWorkflowOrchestrator**: Main orchestrator that coordinates all workflow tasks
- **TaskOrchestrator**: Manages task dependencies and execution order
- **WorkflowCheckpoint**: Handles checkpoint saving/loading for resume capability
- **WorkflowProgressTracker**: Tracks progress and estimates time remaining
- **WorkflowScheduler**: Manages scheduled executions with cron support
- **BatchProcessor**: Processes large datasets in configurable batches
- **DNCMarkingService**: Handles marking customers as DNC in VinSolutions
- **ComplianceReportGenerator**: Generates multi-format compliance reports

## Installation

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Create configuration file
node dist/src/workflows/dnc-compliance-workflow/cli.js config --create config.json
```

## Configuration

Edit the generated `config.json` file with your settings:

```json
{
  "dealerships": [
    {
      "id": "dealership-001",
      "name": "Example Dealership",
      "credentials": {
        "url": "https://example.vinsolutions.com",
        "username": "your-username",
        "password": "your-password"
      },
      "settings": {
        "markDNCInCRM": true,
        "addDNCTag": true,
        "updateContactPreferences": true,
        "dncFieldName": "dnc_status",
        "dncTagName": "DNC - Do Not Call"
      }
    }
  ],
  "possibleNow": {
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret",
    "baseUrl": "https://api.possiblenow.com",
    "environment": "production"
  },
  "batchSize": 1000,
  "parallelWorkers": 3,
  "reporting": {
    "formats": ["pdf", "excel", "json", "html"],
    "emailRecipients": ["compliance@dealership.com"]
  },
  "scheduling": {
    "enabled": true,
    "cronExpression": "0 0 1 * *",
    "timezone": "America/New_York"
  }
}
```

## Usage

### Run Workflow Manually

```bash
# Run for all configured dealerships
node dist/src/workflows/dnc-compliance-workflow/cli.js run -c config.json

# Run for specific dealership
node dist/src/workflows/dnc-compliance-workflow/cli.js run -c config.json -d dealership-001

# Run in headless mode
node dist/src/workflows/dnc-compliance-workflow/cli.js run -c config.json --headless

# Dry run (no changes made)
node dist/src/workflows/dnc-compliance-workflow/cli.js run -c config.json --dry-run
```

### Schedule Workflow

```bash
# Enable scheduling (uses cron expression from config)
node dist/src/workflows/dnc-compliance-workflow/cli.js schedule -c config.json --enable

# Schedule with custom cron expression
node dist/src/workflows/dnc-compliance-workflow/cli.js schedule -c config.json --cron "0 2 1 * *"

# Disable scheduling
node dist/src/workflows/dnc-compliance-workflow/cli.js schedule -c config.json --disable
```

### Resume from Checkpoint

```bash
# Show available checkpoints
node dist/src/workflows/dnc-compliance-workflow/cli.js resume -c config.json

# Resume specific dealership
node dist/src/workflows/dnc-compliance-workflow/cli.js resume -c config.json -d dealership-001
```

### Check Status

```bash
# Show workflow status and history
node dist/src/workflows/dnc-compliance-workflow/cli.js status -c config.json

# Show last 20 executions
node dist/src/workflows/dnc-compliance-workflow/cli.js status -c config.json --history 20
```

## Workflow Steps

1. **Initialize Browser**: Launch Playwright browser with configured settings
2. **VinSolutions Login**: Authenticate with VinSolutions (handles 2FA if required)
3. **Extract Customer Data**: Extract customers from last 30 days
4. **Batch Submit to PossibleNOW**: Submit phone numbers in batches for DNC checking
5. **Process DNC Results**: Retrieve and process DNC check results
6. **Mark DNC Customers**: Update customer records in VinSolutions
7. **Generate Compliance Report**: Create comprehensive compliance reports

## Progress Monitoring

The workflow provides real-time progress updates:

- Customer extraction progress
- DNC checking progress with ETA
- CRM update progress
- Overall workflow progress

## Error Handling

- **Automatic Retries**: Configurable retry attempts for each task
- **Checkpoint on Error**: Saves progress to allow resuming from last successful point
- **Partial Completion**: Can continue processing other dealerships if one fails
- **Detailed Error Logging**: Comprehensive error information for debugging

## Reporting

Generated reports include:

- Executive summary with compliance statistics
- Detailed task execution results
- List of DNC customers found
- Compliance actions taken
- Recommendations for improvement

Reports are available in:
- **PDF**: Professional formatted report
- **Excel**: Detailed data with multiple sheets
- **JSON**: Machine-readable format
- **HTML**: Web-viewable report

## Performance Considerations

- **Batch Processing**: Processes customers in configurable batches (default: 1000)
- **Parallel Workers**: Supports parallel processing for faster execution
- **Rate Limiting**: Respects API rate limits automatically
- **Memory Management**: Streams large datasets to avoid memory issues

## Monitoring and Alerts

- **Email Notifications**: Sends reports via email on completion or error
- **Event Emissions**: Emits events for external monitoring integration
- **Audit Trail**: Maintains detailed audit log of all actions
- **Resource Monitoring**: Tracks CPU, memory, and API usage

## Security

- **Credential Management**: Supports environment variables for sensitive data
- **Secure Storage**: Encrypted checkpoint data
- **Access Control**: Configurable permissions for different operations
- **Compliance Logging**: Maintains audit trail for compliance purposes

## Troubleshooting

### Common Issues

1. **2FA Required**: The workflow will pause and prompt for 2FA code
2. **Rate Limiting**: Automatic backoff and retry for API rate limits
3. **Network Issues**: Automatic retry with exponential backoff
4. **Browser Crashes**: Checkpoint allows resuming from last successful step

### Debug Mode

Set environment variables for debugging:

```bash
export DEBUG=dnc-workflow:*
export LOG_LEVEL=debug
```

## Environment Variables

- `POSSIBLENOW_CLIENT_ID`: PossibleNOW API client ID
- `POSSIBLENOW_CLIENT_SECRET`: PossibleNOW API client secret
- `WORKFLOW_HEADLESS`: Run browser in headless mode (true/false)
- `WORKFLOW_BATCH_SIZE`: Override batch size
- `WORKFLOW_CHECKPOINT_DIR`: Custom checkpoint directory
- `REPORT_EMAIL_RECIPIENTS`: Comma-separated email recipients

## API Integration

### PossibleNOW API

The workflow integrates with PossibleNOW's DNC checking API:
- OAuth2 authentication
- Batch submission support
- Automatic result polling
- Rate limit handling

### VinSolutions Integration

Uses Playwright for reliable browser automation:
- Handles dynamic content loading
- Bulletproof click strategies
- Automatic retry on failures
- Screenshot capture for debugging

## Contributing

When adding new features:

1. Follow the existing modular architecture
2. Add appropriate error handling
3. Update checkpoint logic if adding new stages
4. Include progress tracking for long operations
5. Add unit tests for new components

## License

[Your License Here]