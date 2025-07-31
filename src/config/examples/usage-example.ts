import { createConfigManager, ConfigManager } from '../index';
import { DealershipConfig } from '../schemas';

/**
 * Example: Basic Configuration Usage
 */
async function basicUsageExample() {
  console.log('=== Basic Configuration Usage ===\n');

  // Create and initialize config manager
  const configManager = await createConfigManager({
    configPath: './config',
    masterPassword: process.env.DNC_VINNY_MASTER_PASSWORD || 'demo-password'
  });

  // Get the full configuration
  const config = configManager.getConfig();
  console.log(`Environment: ${config.environment}`);
  console.log(`Version: ${config.version}`);
  console.log(`Total Dealerships: ${config.dealerships.length}\n`);

  // Get specific dealership
  const dealership = configManager.getDealershipConfig('dealership1');
  if (dealership) {
    console.log(`Dealership: ${dealership.name}`);
    console.log(`VinSolutions URL: ${dealership.vinSolutions.baseUrl}`);
    console.log(`PossibleNOW Account: ${dealership.possibleNOW.accountId}\n`);
  }

  // Clean up
  await configManager.destroy();
}

/**
 * Example: Adding and Managing Dealerships
 */
async function dealershipManagementExample() {
  console.log('=== Dealership Management Example ===\n');

  const configManager = new ConfigManager({
    configPath: './config',
    autoLoad: true
  });

  await configManager.initialize('demo-password');

  // Add a new dealership
  const newDealership: DealershipConfig = {
    id: 'sunshine-motors',
    name: 'Sunshine Motors',
    active: true,
    vinSolutions: {
      baseUrl: 'https://api.vinsolutions.com',
      apiKey: 'sunshine-api-key',
      apiSecret: 'sunshine-api-secret',
      dealershipId: 'SM12345',
      timeout: 30000,
      retryAttempts: 3,
      retryDelay: 1000
    },
    possibleNOW: {
      baseUrl: 'https://api.possiblenow.com',
      username: 'sunshine_user',
      password: 'sunshine_pass',
      accountId: 'sunshine_account',
      apiVersion: 'v1',
      timeout: 30000,
      retryAttempts: 3
    },
    workflow: {
      batchSize: 50,
      maxConcurrent: 3,
      processingDelay: 2000,
      errorThreshold: 5,
      retryPolicy: {
        maxRetries: 3,
        backoffMultiplier: 2,
        maxBackoffMs: 30000
      },
      timeout: {
        job: 180000,
        batch: 360000,
        total: 1800000
      }
    }
  };

  await configManager.setDealershipConfig(newDealership);
  console.log(`Added dealership: ${newDealership.name}`);

  // Update dealership settings
  newDealership.workflow!.batchSize = 100;
  await configManager.setDealershipConfig(newDealership);
  console.log('Updated batch size to 100');

  // List all dealerships
  const config = configManager.getConfig();
  console.log('\nAll Dealerships:');
  for (const d of config.dealerships) {
    console.log(`- ${d.name} (${d.id}) - Active: ${d.active}`);
  }

  await configManager.destroy();
}

/**
 * Example: Configuration with Events
 */
async function eventHandlingExample() {
  console.log('=== Event Handling Example ===\n');

  const configManager = new ConfigManager({
    configPath: './config',
    watchForChanges: true
  });

  // Set up event listeners
  configManager.on('loaded', (config) => {
    console.log('✓ Configuration loaded');
  });

  configManager.on('updated', (event) => {
    console.log(`✓ Configuration updated: ${JSON.stringify(event)}`);
  });

  configManager.on('saved', (filename) => {
    console.log(`✓ Configuration saved to: ${filename}`);
  });

  configManager.on('error', (error) => {
    console.error(`✗ Error: ${error.message}`);
  });

  await configManager.initialize('demo-password');

  // Make a change to trigger events
  const dealership = configManager.getDealershipConfig('dealership1');
  if (dealership) {
    dealership.active = !dealership.active;
    await configManager.setDealershipConfig(dealership);
  }

  // Wait a bit to see events
  await new Promise(resolve => setTimeout(resolve, 1000));

  await configManager.destroy();
}

/**
 * Example: Health Checks
 */
async function healthCheckExample() {
  console.log('=== Health Check Example ===\n');

  const configManager = await createConfigManager({
    masterPassword: 'demo-password'
  });

  console.log('Running health checks...\n');
  const results = await configManager.healthCheck();

  for (const [dealershipId, result] of results) {
    console.log(`${result.name} (${dealershipId}):`);
    
    for (const [service, status] of Object.entries(result.services)) {
      const icon = status.status === 'ok' ? '✓' : '✗';
      console.log(`  ${icon} ${service}: ${status.status}`);
      if (status.error) {
        console.log(`     Error: ${status.error}`);
      }
    }
    console.log();
  }

  await configManager.destroy();
}

/**
 * Example: Configuration Validation
 */
async function validationExample() {
  console.log('=== Configuration Validation Example ===\n');

  const configManager = new ConfigManager({
    configPath: './config',
    autoLoad: false
  });

  // Test with invalid configuration
  const invalidConfig = {
    version: 'invalid-version', // Should be semver
    environment: 'invalid-env', // Should be development/staging/production
    dealerships: [
      {
        id: 'test',
        // Missing required fields
      }
    ]
  };

  console.log('Testing invalid configuration:');
  const result = configManager.validate(invalidConfig as any);
  if (!result.valid) {
    console.log('✗ Validation failed:');
    result.errors?.forEach((error, index) => {
      console.log(`  ${index + 1}. ${JSON.stringify(error)}`);
    });
  }

  console.log('\nTesting valid configuration:');
  await configManager.load();
  const validResult = configManager.validate();
  console.log(`✓ Configuration is ${validResult.valid ? 'valid' : 'invalid'}`);

  await configManager.destroy();
}

/**
 * Example: Secure Credential Handling
 */
async function secureCredentialsExample() {
  console.log('=== Secure Credentials Example ===\n');

  // Initialize without encryption
  const configManager = new ConfigManager({
    configPath: './config',
    encryption: false
  });

  await configManager.load();
  
  // Show that credentials are in plain text
  const dealership = configManager.getDealershipConfig('dealership1');
  if (dealership) {
    console.log('Without encryption:');
    console.log(`API Key: ${dealership.vinSolutions.apiKey.substring(0, 10)}...`);
    console.log(`Password: ${dealership.possibleNOW.password.substring(0, 5)}...\n`);
  }

  await configManager.destroy();

  // Now with encryption
  const secureManager = new ConfigManager({
    configPath: './config',
    encryption: true
  });

  await secureManager.initialize('secure-master-password');
  
  console.log('With encryption:');
  console.log('✓ Credentials are encrypted in storage');
  console.log('✓ Decrypted automatically when accessed through ConfigManager');

  await secureManager.destroy();
}

/**
 * Main function to run all examples
 */
async function main() {
  try {
    await basicUsageExample();
    console.log('\n' + '='.repeat(50) + '\n');

    await dealershipManagementExample();
    console.log('\n' + '='.repeat(50) + '\n');

    await eventHandlingExample();
    console.log('\n' + '='.repeat(50) + '\n');

    await healthCheckExample();
    console.log('\n' + '='.repeat(50) + '\n');

    await validationExample();
    console.log('\n' + '='.repeat(50) + '\n');

    await secureCredentialsExample();

  } catch (error) {
    console.error('Error running examples:', error);
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  main();
}