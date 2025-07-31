# DNC Compliance Workflow - Quick Start Guide

## Prerequisites

- Node.js 18+ installed
- Access to VinSolutions CRM
- PossibleNOW API credentials
- Chrome/Chromium browser

## Installation

```bash
cd src/workflows/dnc-compliance-workflow
npm install
npm run build
```

## Quick Setup

### 1. Create Configuration File

```bash
npm run dnc:config:create config.json
```

### 2. Edit Configuration

Open `config.json` and update with your credentials:

```json
{
  "dealerships": [{
    "id": "your-dealership-id",
    "name": "Your Dealership Name",
    "credentials": {
      "url": "https://your-dealership.vinsolutions.com",
      "username": "your-username",
      "password": "your-password"
    }
  }],
  "possibleNow": {
    "clientId": "your-possiblenow-client-id",
    "clientSecret": "your-possiblenow-client-secret"
  }
}
```

### 3. Validate Configuration

```bash
npm run dnc:config:validate config.json
```

## Running the Workflow

### Option 1: Interactive Mode (Recommended for First Run)

```bash
npm run dnc:run config.json
```

This will:
- Show progress in real-time
- Prompt for 2FA if required
- Generate reports in `./reports/dnc-compliance/`

### Option 2: Headless Mode (For Automation)

```bash
npm run dnc:run config.json -- --headless
```

### Option 3: Dry Run (Test Without Making Changes)

```bash
npm run dnc:run config.json -- --dry-run
```

## Scheduling Monthly Runs

### Enable Monthly Schedule (1st of each month at 2 AM)

```bash
npm run dnc:schedule config.json -- --enable
```

### Custom Schedule (e.g., Weekly on Sundays at 3 AM)

```bash
npm run dnc:schedule config.json -- --cron "0 3 * * 0" --enable
```

## Monitoring

### Check Workflow Status

```bash
npm run dnc:status config.json
```

### View Execution History

```bash
npm run dnc:status config.json -- --history 20
```

## Resuming Failed Workflows

### Show Available Checkpoints

```bash
npm run dnc:resume config.json
```

### Resume Specific Dealership

```bash
npm run dnc:resume config.json -- -d your-dealership-id
```

## Common Scenarios

### Processing Multiple Dealerships

1. Add multiple dealerships to `config.json`:

```json
{
  "dealerships": [
    { "id": "dealer-1", "name": "Dealership 1", ... },
    { "id": "dealer-2", "name": "Dealership 2", ... }
  ]
}
```

2. Run workflow:

```bash
npm run dnc:run config.json
```

### Handling 2FA

When 2FA is required:
1. The workflow will pause and prompt for the code
2. Enter the 2FA code when prompted
3. The workflow will continue automatically

### Custom Batch Sizes

For large dealerships, adjust batch size in config:

```json
{
  "batchSize": 2000,
  "parallelWorkers": 5
}
```

## Output

### Reports Location

Reports are generated in: `./reports/dnc-compliance/`

- `dnc_compliance_report_[dealership]_[timestamp].pdf` - Executive summary
- `dnc_compliance_report_[dealership]_[timestamp].xlsx` - Detailed data
- `dnc_compliance_report_[dealership]_[timestamp].json` - Machine-readable
- `dnc_compliance_report_[dealership]_[timestamp].html` - Web viewable

### Checkpoint Files

Checkpoints are saved in: `./checkpoints/dnc-workflow/`

## Environment Variables (Optional)

Create a `.env` file for sensitive data:

```bash
POSSIBLENOW_CLIENT_ID=your-client-id
POSSIBLENOW_CLIENT_SECRET=your-client-secret
WORKFLOW_HEADLESS=false
WORKFLOW_BATCH_SIZE=1000
REPORT_EMAIL_RECIPIENTS=compliance@dealership.com,manager@dealership.com
```

## Troubleshooting

### Enable Debug Logging

```bash
DEBUG=dnc-workflow:* npm run dnc:run config.json
```

### Common Issues

1. **"Cannot find Chrome"**
   - Install Playwright browsers: `npx playwright install chromium`

2. **"Authentication failed"**
   - Verify VinSolutions credentials
   - Check if account requires 2FA

3. **"Rate limit exceeded"**
   - Reduce `parallelWorkers` in config
   - Increase `retryDelay`

4. **"Checkpoint not found"**
   - Run `npm run dnc:status config.json` to see available checkpoints

## Support

For issues or questions:
1. Check the detailed README.md
2. Review logs in `./logs/`
3. Use debug mode for detailed output