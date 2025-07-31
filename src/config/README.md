# DNC VINNY Configuration System

A comprehensive configuration management system for DNC VINNY that handles multi-dealership setups, secure credential storage, and flexible configuration options.

## Features

- **Multi-Dealership Support**: Configure multiple dealerships with independent settings
- **Secure Credential Storage**: AES-256-GCM encryption for sensitive data
- **Multiple Configuration Sources**: Environment variables, JSON, and YAML files
- **Configuration Validation**: Zod-based schema validation
- **Hot Reloading**: Watch for configuration changes in development
- **Migration Support**: Handle configuration version upgrades
- **Health Checks**: Test connections to configured services
- **CLI Tools**: Interactive configuration management

## Quick Start

### 1. Initialize Configuration

```bash
# Install dependencies
npm install

# Run the configuration CLI
npx ts-node src/config/cli/config-cli.ts init
```

This will create:
- `config/config.json` - Main configuration file
- `config/.env` - Environment variables template

### 2. Using ConfigManager

```typescript
import { createConfigManager } from './src/config';

// Create and initialize the config manager
const configManager = await createConfigManager({
  configPath: './config',
  masterPassword: 'your-secure-password'
});

// Get configuration
const config = configManager.getConfig();

// Get specific dealership config
const dealership = configManager.getDealershipConfig('dealership1');

// Listen for configuration updates
configManager.on('updated', (event) => {
  console.log('Configuration updated:', event);
});
```

## Configuration Structure

### Main Configuration Schema

```typescript
{
  version: string;           // Semantic version (e.g., "1.0.0")
  environment: string;       // "development" | "staging" | "production"
  dealerships: DealershipConfig[];
  security: SecurityConfig;
  global: GlobalConfig;
  features: FeatureFlags;
}
```

### Dealership Configuration

```typescript
{
  id: string;                // Unique identifier
  name: string;              // Display name
  active: boolean;           // Enable/disable dealership
  vinSolutions: {            // VinSolutions API config
    baseUrl: string;
    apiKey: string;          // Encrypted
    apiSecret: string;       // Encrypted
    dealershipId: string;
    timeout: number;
    retryAttempts: number;
    retryDelay: number;
  };
  possibleNOW: {             // PossibleNOW API config
    baseUrl: string;
    username: string;
    password: string;        // Encrypted
    accountId: string;
    apiVersion: string;
    timeout: number;
    retryAttempts: number;
    webhookUrl?: string;
  };
  workflow?: WorkflowConfig;
  reports?: ReportConfig;
  schedule?: ScheduleConfig;
}
```

## CLI Commands

### Initialize Configuration
```bash
npx ts-node src/config/cli/config-cli.ts init
```

### Validate Configuration
```bash
npx ts-node src/config/cli/config-cli.ts validate
```

### Test Connections
```bash
npx ts-node src/config/cli/config-cli.ts test
```

### Encrypt Configuration
```bash
npx ts-node src/config/cli/config-cli.ts encrypt
```

### Decrypt Configuration (for viewing)
```bash
npx ts-node src/config/cli/config-cli.ts decrypt -o decrypted-config.json
```

### List Dealerships
```bash
npx ts-node src/config/cli/config-cli.ts list
```

### Export Configuration
```bash
# Export as JSON
npx ts-node src/config/cli/config-cli.ts export -f json -o backup.json

# Export as environment variables
npx ts-node src/config/cli/config-cli.ts export -f env -o .env.export
```

### Import Configuration
```bash
npx ts-node src/config/cli/config-cli.ts import -f config-to-import.json
```

## Environment Variables

The system supports configuration through environment variables with the prefix `DNC_VINNY_`.

### Global Variables
- `DNC_VINNY_VERSION` - Configuration version
- `DNC_VINNY_ENVIRONMENT` - Environment name
- `DNC_VINNY_MASTER_PASSWORD` - Master password for encryption
- `DNC_VINNY_CONFIG_PATH` - Configuration directory path

### Per-Dealership Variables
Replace `{DEALERSHIP_ID}` with your dealership ID in uppercase:

- `DNC_VINNY_{DEALERSHIP_ID}_NAME` - Dealership name
- `DNC_VINNY_{DEALERSHIP_ID}_ACTIVE` - Enable/disable (true/false)
- `DNC_VINNY_{DEALERSHIP_ID}_VIN_API_KEY` - VinSolutions API key
- `DNC_VINNY_{DEALERSHIP_ID}_VIN_API_SECRET` - VinSolutions API secret
- `DNC_VINNY_{DEALERSHIP_ID}_PN_USERNAME` - PossibleNOW username
- `DNC_VINNY_{DEALERSHIP_ID}_PN_PASSWORD` - PossibleNOW password

## Security

### Encryption
- Uses AES-256-GCM encryption for sensitive data
- Master password required for encryption/decryption
- Supports multiple key derivation functions (PBKDF2, scrypt)

### Best Practices
1. Never commit unencrypted configuration files with credentials
2. Store master password securely (e.g., environment variable, secrets manager)
3. Use different configurations for different environments
4. Regularly rotate credentials
5. Enable audit logging in production

## Configuration Priority

Configuration is loaded and merged in the following order (later sources override earlier ones):

1. Default configuration
2. `config.default.json`
3. `config.json`
4. `config.{environment}.json`
5. Environment variables

## Migration Support

The system includes automatic migration support for configuration version changes:

```typescript
import { ConfigMigrationManager } from './src/config';

const migrationManager = new ConfigMigrationManager();

// Check if migration is needed
if (migrationManager.needsMigration(config)) {
  // Create backup
  const backup = migrationManager.createBackup(config);
  
  // Migrate to latest version
  const migratedConfig = await migrationManager.migrate(config);
}
```

## Events

The ConfigManager emits the following events:

- `loaded` - Configuration loaded successfully
- `saved` - Configuration saved to file
- `updated` - Configuration updated (with details)
- `error` - Error occurred
- `fileChanged` - Configuration file changed (when watching)
- `healthCheck` - Health check completed
- `imported` - Configuration imported

## Examples

### Basic Usage

```typescript
import { ConfigManager } from './src/config';

async function main() {
  // Create config manager
  const configManager = new ConfigManager({
    configPath: './config',
    encryption: true,
    watchForChanges: true
  });

  // Initialize with master password
  await configManager.initialize('my-secure-password');

  // Get configuration
  const config = configManager.getConfig();
  
  // Access dealership config
  for (const dealership of config.dealerships) {
    if (dealership.active) {
      console.log(`Processing ${dealership.name}`);
      // Use dealership.vinSolutions and dealership.possibleNOW configs
    }
  }
}
```

### Adding a New Dealership

```typescript
await configManager.setDealershipConfig({
  id: 'new-dealership',
  name: 'New Dealership',
  active: true,
  vinSolutions: {
    baseUrl: 'https://api.vinsolutions.com',
    apiKey: 'new-api-key',
    apiSecret: 'new-api-secret',
    dealershipId: '67890',
    timeout: 30000,
    retryAttempts: 3,
    retryDelay: 1000
  },
  possibleNOW: {
    baseUrl: 'https://api.possiblenow.com',
    username: 'new-username',
    password: 'new-password',
    accountId: 'new-account',
    apiVersion: 'v1',
    timeout: 30000,
    retryAttempts: 3
  }
});
```

### Health Check

```typescript
const healthResults = await configManager.healthCheck();

for (const [dealershipId, result] of healthResults) {
  console.log(`${result.name}:`);
  console.log(`  VinSolutions: ${result.services.vinSolutions.status}`);
  console.log(`  PossibleNOW: ${result.services.possibleNOW.status}`);
}
```

## Troubleshooting

### Common Issues

1. **"Encryption service not initialized"**
   - Ensure you call `initialize()` with a master password
   - Check that `DNC_VINNY_MASTER_PASSWORD` is set

2. **"Configuration validation failed"**
   - Check the error details for specific fields
   - Ensure all required fields are present
   - Verify data types match the schema

3. **"Failed to decrypt field"**
   - Verify the master password is correct
   - Check if the field was encrypted with a different password
   - The field might not be encrypted

4. **Connection test failures**
   - Verify API credentials are correct
   - Check network connectivity
   - Ensure API endpoints are accessible

## Development

### Running Tests
```bash
npm test
```

### Adding New Configuration Fields

1. Update the schema in `src/config/schemas/index.ts`
2. Add migration in `src/config/utils/ConfigMigration.ts`
3. Update documentation
4. Run validation tests

### Creating Custom Loaders

```typescript
import { Config } from './src/config/schemas';

export class CustomLoader {
  async load(): Promise<Partial<Config>> {
    // Your custom loading logic
    return {
      // Partial configuration
    };
  }
}
```