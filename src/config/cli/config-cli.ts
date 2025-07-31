#!/usr/bin/env node

import { Command } from 'commander';
import { ConfigManager } from '../ConfigManager';
import { EncryptionService } from '../utils/encryption';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import chalk from 'chalk';
import Table from 'cli-table3';

const program = new Command();
const rl = readline.createInterface({ input, output });

program
  .name('dnc-vinny-config')
  .description('DNC VINNY Configuration Management CLI')
  .version('1.0.0');

// Initialize command
program
  .command('init')
  .description('Initialize a new configuration')
  .option('-p, --path <path>', 'Configuration path', './config')
  .option('-f, --format <format>', 'Configuration format (json|yaml)', 'json')
  .action(async (options) => {
    try {
      console.log(chalk.blue('🚀 Initializing DNC VINNY configuration...'));

      // Create config directory
      await fs.mkdir(options.path, { recursive: true });

      // Copy template
      const templatePath = path.join(__dirname, '../templates/default.config.json');
      const configPath = path.join(options.path, `config.${options.format}`);

      const templateContent = await fs.readFile(templatePath, 'utf-8');
      const template = JSON.parse(templateContent);

      // Interactive setup
      console.log(chalk.yellow('\n📋 Basic Configuration'));
      
      const dealershipId = await rl.question('Dealership ID: ');
      const dealershipName = await rl.question('Dealership Name: ');
      
      console.log(chalk.yellow('\n🔑 VinSolutions Configuration'));
      const vinApiKey = await rl.question('VinSolutions API Key: ');
      const vinApiSecret = await rl.question('VinSolutions API Secret: ');
      const vinDealershipId = await rl.question('VinSolutions Dealership ID: ');
      
      console.log(chalk.yellow('\n🔑 PossibleNOW Configuration'));
      const pnUsername = await rl.question('PossibleNOW Username: ');
      const pnPassword = await rl.question('PossibleNOW Password: ');
      const pnAccountId = await rl.question('PossibleNOW Account ID: ');

      // Update template with user input
      template.dealerships[0] = {
        ...template.dealerships[0],
        id: dealershipId,
        name: dealershipName,
        vinSolutions: {
          ...template.dealerships[0].vinSolutions,
          apiKey: vinApiKey,
          apiSecret: vinApiSecret,
          dealershipId: vinDealershipId,
        },
        possibleNOW: {
          ...template.dealerships[0].possibleNOW,
          username: pnUsername,
          password: pnPassword,
          accountId: pnAccountId,
        },
      };

      // Ask about encryption
      const useEncryption = await rl.question('\nEnable encryption for sensitive data? (y/n): ');
      
      if (useEncryption.toLowerCase() === 'y') {
        const masterPassword = await rl.question('Master password for encryption: ');
        
        // Encrypt sensitive fields
        const encryptionService = new EncryptionService(template.security.encryption);
        await encryptionService.initialize(masterPassword);
        
        template.dealerships[0].vinSolutions.apiKey = await encryptionService.encrypt(vinApiKey);
        template.dealerships[0].vinSolutions.apiSecret = await encryptionService.encrypt(vinApiSecret);
        template.dealerships[0].possibleNOW.password = await encryptionService.encrypt(pnPassword);
      }

      // Save configuration
      if (options.format === 'yaml') {
        const yaml = require('js-yaml');
        await fs.writeFile(configPath, yaml.dump(template, { indent: 2 }));
      } else {
        await fs.writeFile(configPath, JSON.stringify(template, null, 2));
      }

      // Create .env file
      const envPath = path.join(options.path, '.env');
      const envContent = `# DNC VINNY Configuration
DNC_VINNY_VERSION=1.0.0
DNC_VINNY_ENVIRONMENT=development
DNC_VINNY_DEALERSHIP_IDS=${dealershipId}
${useEncryption.toLowerCase() === 'y' ? '# Remember to set DNC_VINNY_MASTER_PASSWORD in your environment' : ''}
`;
      await fs.writeFile(envPath, envContent);

      console.log(chalk.green('\n✅ Configuration initialized successfully!'));
      console.log(chalk.gray(`Configuration saved to: ${configPath}`));
      console.log(chalk.gray(`Environment file saved to: ${envPath}`));
      
    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      process.exit(1);
    } finally {
      rl.close();
    }
  });

// Validate command
program
  .command('validate')
  .description('Validate configuration')
  .option('-p, --path <path>', 'Configuration path', './config')
  .option('-f, --file <file>', 'Configuration file', 'config.json')
  .action(async (options) => {
    try {
      console.log(chalk.blue('🔍 Validating configuration...'));

      const configManager = new ConfigManager({
        configPath: options.path,
        autoLoad: false,
      });

      await configManager.load();
      const result = configManager.validate();

      if (result.valid) {
        console.log(chalk.green('✅ Configuration is valid!'));
      } else {
        console.log(chalk.red('❌ Configuration validation failed:'));
        result.errors?.forEach((error, index) => {
          console.log(chalk.red(`  ${index + 1}. ${JSON.stringify(error, null, 2)}`));
        });
      }

      await configManager.destroy();
      
    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      process.exit(1);
    }
  });

// Test command
program
  .command('test')
  .description('Test connections to configured services')
  .option('-p, --path <path>', 'Configuration path', './config')
  .option('-d, --dealership <id>', 'Test specific dealership')
  .action(async (options) => {
    try {
      console.log(chalk.blue('🧪 Testing connections...'));

      const masterPassword = process.env.DNC_VINNY_MASTER_PASSWORD || 
        await rl.question('Master password (if encryption enabled): ');

      const configManager = new ConfigManager({
        configPath: options.path,
        encryption: true,
      });

      await configManager.initialize(masterPassword);
      const results = await configManager.healthCheck();

      // Display results in a table
      const table = new Table({
        head: ['Dealership', 'Service', 'Status', 'Details'],
        colWidths: [20, 15, 10, 40],
      });

      for (const [dealershipId, result] of results) {
        if (options.dealership && dealershipId !== options.dealership) continue;

        for (const [service, status] of Object.entries(result.services)) {
          table.push([
            result.name,
            service,
            status.status === 'ok' ? chalk.green('✓') : chalk.red('✗'),
            status.error || status.baseUrl || '',
          ]);
        }
      }

      console.log(table.toString());
      
      await configManager.destroy();
      rl.close();
      
    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      rl.close();
      process.exit(1);
    }
  });

// Encrypt command
program
  .command('encrypt')
  .description('Encrypt sensitive values in configuration')
  .option('-p, --path <path>', 'Configuration path', './config')
  .option('-f, --file <file>', 'Configuration file', 'config.json')
  .action(async (options) => {
    try {
      console.log(chalk.blue('🔐 Encrypting configuration...'));

      const masterPassword = await rl.question('Master password: ');

      const configManager = new ConfigManager({
        configPath: options.path,
        encryption: true,
        autoLoad: false,
      });

      await configManager.initialize(masterPassword);
      await configManager.load();
      await configManager.save(options.file);

      console.log(chalk.green('✅ Configuration encrypted successfully!'));
      
      await configManager.destroy();
      rl.close();
      
    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      rl.close();
      process.exit(1);
    }
  });

// Decrypt command
program
  .command('decrypt')
  .description('Decrypt configuration for viewing')
  .option('-p, --path <path>', 'Configuration path', './config')
  .option('-f, --file <file>', 'Configuration file', 'config.json')
  .option('-o, --output <file>', 'Output file (optional)')
  .action(async (options) => {
    try {
      console.log(chalk.blue('🔓 Decrypting configuration...'));

      const masterPassword = await rl.question('Master password: ');

      const configManager = new ConfigManager({
        configPath: options.path,
        encryption: true,
        autoLoad: false,
      });

      await configManager.initialize(masterPassword);
      await configManager.load();
      const config = configManager.getConfig();

      if (options.output) {
        await fs.writeFile(options.output, JSON.stringify(config, null, 2));
        console.log(chalk.green(`✅ Decrypted configuration saved to: ${options.output}`));
      } else {
        console.log(JSON.stringify(config, null, 2));
      }
      
      await configManager.destroy();
      rl.close();
      
    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      rl.close();
      process.exit(1);
    }
  });

// List command
program
  .command('list')
  .description('List all dealership configurations')
  .option('-p, --path <path>', 'Configuration path', './config')
  .action(async (options) => {
    try {
      const configManager = new ConfigManager({
        configPath: options.path,
        autoLoad: true,
      });

      await configManager.load();
      const config = configManager.getConfig();

      const table = new Table({
        head: ['ID', 'Name', 'Active', 'VinSolutions', 'PossibleNOW'],
        colWidths: [20, 30, 10, 15, 15],
      });

      for (const dealership of config.dealerships) {
        table.push([
          dealership.id,
          dealership.name,
          dealership.active ? chalk.green('Yes') : chalk.red('No'),
          chalk.gray('Configured'),
          chalk.gray('Configured'),
        ]);
      }

      console.log(chalk.blue('\n📋 Configured Dealerships:'));
      console.log(table.toString());
      
      await configManager.destroy();
      
    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      process.exit(1);
    }
  });

// Export command
program
  .command('export')
  .description('Export configuration')
  .option('-p, --path <path>', 'Configuration path', './config')
  .option('-f, --format <format>', 'Export format (json|yaml|env)', 'json')
  .option('-o, --output <file>', 'Output file', 'exported-config')
  .action(async (options) => {
    try {
      console.log(chalk.blue('📤 Exporting configuration...'));

      const configManager = new ConfigManager({
        configPath: options.path,
      });

      await configManager.load();
      
      const outputFile = options.output.includes('.') 
        ? options.output 
        : `${options.output}.${options.format === 'env' ? 'env' : options.format}`;

      await configManager.export(options.format as any, outputFile);

      console.log(chalk.green(`✅ Configuration exported to: ${outputFile}`));
      
      await configManager.destroy();
      
    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      process.exit(1);
    }
  });

// Import command
program
  .command('import')
  .description('Import configuration')
  .option('-p, --path <path>', 'Configuration path', './config')
  .option('-f, --file <file>', 'File to import')
  .option('-m, --merge', 'Merge with existing configuration')
  .action(async (options) => {
    try {
      if (!options.file) {
        console.error(chalk.red('Error: Import file is required'));
        process.exit(1);
      }

      console.log(chalk.blue('📥 Importing configuration...'));

      const configManager = new ConfigManager({
        configPath: options.path,
      });

      await configManager.import(options.file, options.merge);

      console.log(chalk.green('✅ Configuration imported successfully!'));
      
      await configManager.destroy();
      
    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      process.exit(1);
    }
  });

program.parse(process.argv);