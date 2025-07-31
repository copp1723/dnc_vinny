# Multi-Store Configuration and Orchestration System

A comprehensive system for managing and orchestrating DNC compliance processing across multiple dealerships in parallel, with intelligent resource management and failure isolation.

## Overview

The Multi-Store system extends the existing DNC_VINNY platform to support:
- **Parallel Processing**: Process multiple dealerships simultaneously
- **Resource Management**: Shared browser pools and API quota management
- **Intelligent Scheduling**: Store-specific processing windows and priorities
- **Failure Isolation**: Prevent one store's failure from affecting others
- **Real-time Monitoring**: Dashboard data and aggregated reporting

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   MultiStoreOrchestrator                      │
│  Coordinates workflows across all stores with parallelization │
└──────────────────────┬───────────────────────────────────────┘
                       │
         ┌─────────────┴─────────────┬────────────────┬────────────────┐
         │                           │                 │                │
    ┌────▼────┐             ┌───────▼──────┐   ┌─────▼─────┐   ┌─────▼──────┐
    │  Store  │             │    Queue     │   │ Resource  │   │ Dashboard  │
    │Registry │             │   Manager    │   │   Pool    │   │    Data    │
    └─────────┘             └──────────────┘   └───────────┘   └────────────┘
    Manages store           Priority-based      Browser &       Real-time
    configurations          processing queue     API quota       monitoring
```

## Components

### 1. MultiStoreOrchestrator
The main coordinator that manages parallel processing of multiple stores.

**Key Features:**
- Concurrent store processing up to configured limit
- Processing window enforcement
- Failure isolation and recovery
- Aggregated reporting

### 2. StoreRegistry
Manages store configurations and metadata.

**Key Features:**
- Store CRUD operations
- Priority management (HIGH/MEDIUM/LOW)
- Quarantine system for problematic stores
- Processing history tracking

### 3. QueueManager
Handles intelligent queuing of stores for processing.

**Key Features:**
- Priority-based queuing
- Retry logic with exponential backoff
- Processing statistics
- Queue reordering

### 4. ResourcePoolManager
Manages shared resources across all stores.

**Key Features:**
- Browser pool management with auto-recovery
- API rate limiting with burst support
- Resource allocation tracking
- Performance metrics

### 5. DashboardDataProvider
Provides real-time monitoring data.

**Key Features:**
- System status and metrics
- Store processing progress
- Resource utilization
- Alert management

## Installation & Setup

1. Ensure the multi-store directory exists:
```bash
cd /Users/joshcopp/Desktop/DNC_VINNY
```

2. Install dependencies (if not already installed):
```bash
npm install commander chalk cli-table3
```

3. Make the CLI executable:
```bash
chmod +x src/multi-store/cli/multi-store-cli.ts
```

## CLI Usage

The multi-store CLI provides comprehensive management capabilities:

### List Stores
```bash
# List all stores
./src/multi-store/cli/multi-store-cli.ts list

# List only active stores
./src/multi-store/cli/multi-store-cli.ts list --active

# List quarantined stores
./src/multi-store/cli/multi-store-cli.ts list --quarantined

# Filter by priority
./src/multi-store/cli/multi-store-cli.ts list --priority high
```

### Add a Store
```bash
./src/multi-store/cli/multi-store-cli.ts add \
  --id "store-001" \
  --name "ABC Motors" \
  --priority high
```

### Remove a Store
```bash
./src/multi-store/cli/multi-store-cli.ts remove store-001
```

### Enable/Disable Stores
```bash
# Enable a store
./src/multi-store/cli/multi-store-cli.ts enable store-001

# Disable a store
./src/multi-store/cli/multi-store-cli.ts disable store-001
```

### Set Store Priority
```bash
./src/multi-store/cli/multi-store-cli.ts set-priority store-001 high
```

### Set Processing Schedule
```bash
./src/multi-store/cli/multi-store-cli.ts set-schedule store-001
# Interactive prompts for schedule configuration
```

### View System Status
```bash
./src/multi-store/cli/multi-store-cli.ts status
```

### Run Processing
```bash
# Process all active stores
./src/multi-store/cli/multi-store-cli.ts run

# Process specific stores
./src/multi-store/cli/multi-store-cli.ts run --stores store-001,store-002

# Process only high priority stores
./src/multi-store/cli/multi-store-cli.ts run --priority high

# Dry run to see what would be processed
./src/multi-store/cli/multi-store-cli.ts run --dry-run
```

### Export/Import Configurations
```bash
# Export store configurations
./src/multi-store/cli/multi-store-cli.ts export ./stores-backup.json

# Import store configurations
./src/multi-store/cli/multi-store-cli.ts import ./stores-backup.json

# Merge with existing stores
./src/multi-store/cli/multi-store-cli.ts import ./stores-backup.json --merge
```

## Programmatic Usage

### Basic Setup
```typescript
import { 
  MultiStoreOrchestrator, 
  StoreRegistry,
  DashboardDataProvider 
} from './multi-store';

// Initialize components
const registry = new StoreRegistry();
await registry.loadStores();

const orchestrator = new MultiStoreOrchestrator({
  maxConcurrentStores: 3,
  maxBrowsersPerStore: 2,
  apiRateLimits: {
    possibleNOW: {
      requestsPerMinute: 60,
      burstLimit: 10,
    },
  },
  processingWindows: {
    'store-001': {
      start: '22:00',
      end: '06:00',
      timezone: 'America/Los_Angeles',
    },
  },
  failureIsolation: {
    maxRetries: 3,
    backoffMultiplier: 2,
    quarantineThreshold: 5,
  },
});

await orchestrator.initialize();
```

### Start Processing
```typescript
// Process all stores
const report = await orchestrator.startProcessing();

console.log(`Completed: ${report.completedStores}`);
console.log(`Failed: ${report.failedStores}`);
console.log(`Compliance Rate: ${report.complianceStatistics.complianceRate}%`);
```

### Monitor Progress
```typescript
// Set up monitoring
const dashboard = new DashboardDataProvider(
  orchestrator,
  registry,
  queueManager,
  resourcePool
);

dashboard.on('dataUpdate', (data) => {
  console.log(`Active stores: ${data.stores.processing}`);
  console.log(`Queue length: ${data.stores.queued}`);
  console.log(`Resource usage: ${data.resources.browsers.utilization}%`);
});

dashboard.start(1000); // Update every second
```

### Handle Events
```typescript
orchestrator.on('storeProcessingStarted', ({ storeId, storeName }) => {
  console.log(`Started processing: ${storeName}`);
});

orchestrator.on('storeProcessingCompleted', (result) => {
  console.log(`Completed: ${result.storeName}`);
  console.log(`Customers processed: ${result.metrics.processedCustomers}`);
});

orchestrator.on('storeQuarantined', ({ storeId, failures }) => {
  console.log(`Store quarantined: ${storeId} (${failures} failures)`);
});
```

## Configuration

### Store Configuration
Each store requires:
- **VinSolutions credentials**: API key, secret, dealership ID
- **PossibleNOW credentials**: Username, password, account ID
- **Priority level**: HIGH, MEDIUM, or LOW
- **Processing window** (optional): Time restrictions

### Resource Limits
Configure in `MultiStoreConfig`:
- `maxConcurrentStores`: Maximum stores processing simultaneously
- `maxBrowsersPerStore`: Browser instances per store
- `apiRateLimits`: PossibleNOW API rate limits

### Failure Handling
- `maxRetries`: Retry attempts before quarantine
- `backoffMultiplier`: Exponential backoff factor
- `quarantineThreshold`: Failures before quarantine

## Monitoring & Reporting

### Real-time Metrics
- Active store processing status
- Resource utilization (browsers, API)
- Queue status by priority
- Recent errors and alerts

### Aggregated Reports
- Total stores processed
- Success/failure rates
- Compliance statistics
- API usage metrics

### Historical Data
- Processing trends over time
- Performance metrics
- Error patterns

## Best Practices

1. **Priority Management**
   - Set HIGH priority for critical stores
   - Use MEDIUM for regular processing
   - Set LOW for less critical or problematic stores

2. **Processing Windows**
   - Schedule during off-peak hours
   - Consider store timezone differences
   - Avoid overlapping with business hours

3. **Resource Allocation**
   - Monitor browser pool utilization
   - Adjust concurrent store limit based on performance
   - Watch API rate limit usage

4. **Failure Handling**
   - Review quarantined stores regularly
   - Investigate repeated failures
   - Adjust retry policies as needed

5. **Monitoring**
   - Set up alerts for critical conditions
   - Review aggregated reports daily
   - Export historical data for analysis

## Troubleshooting

### Common Issues

1. **Store stuck in queue**
   - Check processing window restrictions
   - Verify store is active and not quarantined
   - Review queue priorities

2. **High failure rate**
   - Check VinSolutions/PossibleNOW credentials
   - Review browser health metrics
   - Verify network connectivity

3. **API throttling**
   - Reduce concurrent store limit
   - Adjust API quota per store
   - Enable burst limit if available

4. **Browser crashes**
   - Check system resources
   - Review browser pool size
   - Enable auto-recovery in ResourcePoolManager

## Future Enhancements

- [ ] Web-based monitoring dashboard
- [ ] Email/SMS alerts for critical events
- [ ] Advanced scheduling with dependencies
- [ ] Automatic performance optimization
- [ ] Integration with external monitoring tools
- [ ] Store grouping and batch operations
- [ ] Custom processing strategies per store

## Support

For issues or questions:
1. Check the logs in `./logs/` directory
2. Review store-specific error messages
3. Use the CLI status command for system overview
4. Export dashboard data for detailed analysis