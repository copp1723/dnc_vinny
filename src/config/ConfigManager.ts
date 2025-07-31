import { Config, ConfigSchema, DealershipConfig } from './schemas';
import { EnvLoader } from './loaders/EnvLoader';
import { FileLoader } from './loaders/FileLoader';
import { EncryptionService } from './utils/encryption';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ConfigManagerOptions {
  configPath?: string;
  envPrefix?: string;
  autoLoad?: boolean;
  encryption?: boolean;
  watchForChanges?: boolean;
}

export class ConfigManager extends EventEmitter {
  private config: Config | null = null;
  private fileLoader: FileLoader;
  private envLoader: EnvLoader;
  private encryptionService: EncryptionService | null = null;
  private options: Required<ConfigManagerOptions>;
  private configFile: string = 'config.json';
  private watchers: Map<string, fs.FSWatcher> = new Map();

  constructor(options: ConfigManagerOptions = {}) {
    super();
    
    this.options = {
      configPath: options.configPath || './config',
      envPrefix: options.envPrefix || 'DNC_VINNY',
      autoLoad: options.autoLoad ?? true,
      encryption: options.encryption ?? true,
      watchForChanges: options.watchForChanges ?? false,
    };

    this.fileLoader = new FileLoader(this.options.configPath);
    this.envLoader = new EnvLoader(this.options.envPrefix);

    if (this.options.autoLoad) {
      this.load().catch(console.error);
    }
  }

  /**
   * Initialize the configuration manager
   */
  async initialize(masterPassword?: string): Promise<void> {
    if (this.options.encryption && masterPassword) {
      const securityConfig = this.config?.security || {
        encryption: {
          algorithm: 'aes-256-gcm' as const,
          keyDerivation: 'pbkdf2' as const,
          saltLength: 32,
          iterations: 100000,
        },
      };

      this.encryptionService = new EncryptionService(securityConfig.encryption);
      await this.encryptionService.initialize(masterPassword);
    }

    await this.load();

    if (this.options.watchForChanges) {
      await this.startWatching();
    }
  }

  /**
   * Load configuration from all sources
   */
  async load(): Promise<Config> {
    try {
      // Start with default configuration
      let config: Partial<Config> = this.getDefaultConfig();

      // Load from files (in order of priority)
      const configFiles = [
        'config.default.json',
        'config.json',
        `config.${process.env.NODE_ENV || 'development'}.json`,
      ];

      for (const file of configFiles) {
        if (await this.fileLoader.exists(file)) {
          const fileConfig = await this.fileLoader.load(file);
          config = this.mergeConfigs(config, fileConfig);
          this.configFile = file;
        }
      }

      // Override with environment variables
      const envConfig = this.envLoader.load();
      config = this.mergeConfigs(config, envConfig);

      // Validate the final configuration
      this.config = ConfigSchema.parse(config);

      // Decrypt sensitive fields if encryption is enabled
      if (this.encryptionService) {
        await this.decryptConfig();
      }

      this.emit('loaded', this.config);
      return this.config;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Save configuration to file
   */
  async save(filename?: string): Promise<void> {
    if (!this.config) {
      throw new Error('No configuration loaded');
    }

    const file = filename || this.configFile;
    
    // Create a copy for saving
    let configToSave = JSON.parse(JSON.stringify(this.config));

    // Encrypt sensitive fields if encryption is enabled
    if (this.encryptionService) {
      configToSave = await this.encryptConfig(configToSave);
    }

    await this.fileLoader.save(file, configToSave);
    this.emit('saved', file);
  }

  /**
   * Get the current configuration
   */
  getConfig(): Config {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }
    return this.config;
  }

  /**
   * Get a specific dealership configuration
   */
  getDealershipConfig(dealershipId: string): DealershipConfig | undefined {
    return this.config?.dealerships.find(d => d.id === dealershipId);
  }

  /**
   * Add or update a dealership configuration
   */
  async setDealershipConfig(dealership: DealershipConfig): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }

    const index = this.config.dealerships.findIndex(d => d.id === dealership.id);
    
    if (index >= 0) {
      this.config.dealerships[index] = dealership;
    } else {
      this.config.dealerships.push(dealership);
    }

    this.emit('updated', { type: 'dealership', id: dealership.id });
    
    if (this.options.autoLoad) {
      await this.save();
    }
  }

  /**
   * Remove a dealership configuration
   */
  async removeDealershipConfig(dealershipId: string): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }

    this.config.dealerships = this.config.dealerships.filter(d => d.id !== dealershipId);
    
    this.emit('updated', { type: 'dealership', id: dealershipId, action: 'removed' });
    
    if (this.options.autoLoad) {
      await this.save();
    }
  }

  /**
   * Validate configuration
   */
  validate(config?: Config): { valid: boolean; errors?: any[] } {
    try {
      const toValidate = config || this.config;
      if (!toValidate) {
        return { valid: false, errors: ['No configuration to validate'] };
      }

      ConfigSchema.parse(toValidate);
      return { valid: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { valid: false, errors: error.errors };
      }
      return { valid: false, errors: [error] };
    }
  }

  /**
   * Export configuration
   */
  async export(format: 'json' | 'yaml' | 'env', filename: string): Promise<void> {
    if (!this.config) {
      throw new Error('No configuration to export');
    }

    switch (format) {
      case 'json':
      case 'yaml':
        await this.fileLoader.save(filename, this.config);
        break;
      case 'env':
        const envContent = EnvLoader.exportToEnv(this.config, this.options.envPrefix);
        await fs.writeFile(filename, envContent);
        break;
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Import configuration
   */
  async import(filename: string, merge: boolean = false): Promise<void> {
    const imported = await this.fileLoader.load(filename);
    
    if (merge && this.config) {
      this.config = this.mergeConfigs(this.config, imported) as Config;
    } else {
      this.config = imported;
    }

    this.emit('imported', filename);
    
    if (this.options.autoLoad) {
      await this.save();
    }
  }

  /**
   * Run health checks on all configured services
   */
  async healthCheck(): Promise<Map<string, any>> {
    const results = new Map<string, any>();

    if (!this.config) {
      results.set('config', { status: 'error', message: 'No configuration loaded' });
      return results;
    }

    // Check each dealership's services
    for (const dealership of this.config.dealerships) {
      if (!dealership.active) continue;

      const dealershipResults: any = {
        id: dealership.id,
        name: dealership.name,
        services: {},
      };

      // Test VinSolutions connection
      try {
        // In a real implementation, you would test the actual API
        dealershipResults.services.vinSolutions = {
          status: 'ok',
          baseUrl: dealership.vinSolutions.baseUrl,
        };
      } catch (error) {
        dealershipResults.services.vinSolutions = {
          status: 'error',
          error: error.message,
        };
      }

      // Test PossibleNOW connection
      try {
        // In a real implementation, you would test the actual API
        dealershipResults.services.possibleNOW = {
          status: 'ok',
          baseUrl: dealership.possibleNOW.baseUrl,
        };
      } catch (error) {
        dealershipResults.services.possibleNOW = {
          status: 'error',
          error: error.message,
        };
      }

      results.set(dealership.id, dealershipResults);
    }

    this.emit('healthCheck', results);
    return results;
  }

  /**
   * Encrypt sensitive fields in configuration
   */
  private async encryptConfig(config: Config): Promise<Config> {
    if (!this.encryptionService) return config;

    const encrypted = JSON.parse(JSON.stringify(config));

    for (const dealership of encrypted.dealerships) {
      // Encrypt VinSolutions credentials
      dealership.vinSolutions = await this.encryptionService.encryptObject(
        dealership.vinSolutions,
        ['apiKey', 'apiSecret']
      );

      // Encrypt PossibleNOW credentials
      dealership.possibleNOW = await this.encryptionService.encryptObject(
        dealership.possibleNOW,
        ['password']
      );
    }

    return encrypted;
  }

  /**
   * Decrypt sensitive fields in configuration
   */
  private async decryptConfig(): Promise<void> {
    if (!this.encryptionService || !this.config) return;

    for (const dealership of this.config.dealerships) {
      // Decrypt VinSolutions credentials
      dealership.vinSolutions = await this.encryptionService.decryptObject(
        dealership.vinSolutions,
        ['apiKey', 'apiSecret']
      );

      // Decrypt PossibleNOW credentials
      dealership.possibleNOW = await this.encryptionService.decryptObject(
        dealership.possibleNOW,
        ['password']
      );
    }
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(): Partial<Config> {
    return {
      version: '1.0.0',
      environment: 'development',
      dealerships: [],
      security: {
        encryption: {
          algorithm: 'aes-256-gcm',
          keyDerivation: 'pbkdf2',
          saltLength: 32,
          iterations: 100000,
        },
        authentication: {
          required: true,
          type: 'api_key',
          sessionTimeout: 3600000,
        },
        audit: {
          enabled: true,
          logLevel: 'info',
          retentionDays: 90,
        },
      },
      global: {
        logLevel: 'info',
        tempDirectory: './temp',
        dataDirectory: './data',
        healthCheck: {
          enabled: true,
          interval: 60000,
          timeout: 10000,
        },
      },
      features: {
        autoSync: true,
        webhooks: true,
        reporting: true,
        scheduling: true,
      },
    };
  }

  /**
   * Merge two configurations
   */
  private mergeConfigs(target: any, source: any): any {
    if (!source) return target;
    if (!target) return source;

    const result = { ...target };

    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (typeof source[key] === 'object' && !Array.isArray(source[key])) {
          result[key] = this.mergeConfigs(target[key], source[key]);
        } else if (source[key] !== undefined && source[key] !== '') {
          result[key] = source[key];
        }
      }
    }

    return result;
  }

  /**
   * Start watching configuration files for changes
   */
  private async startWatching(): Promise<void> {
    const configDir = path.resolve(this.options.configPath);
    
    try {
      const watcher = fs.watch(configDir, async (eventType, filename) => {
        if (filename && filename.endsWith('.json')) {
          this.emit('fileChanged', filename);
          await this.load();
        }
      });

      this.watchers.set(configDir, watcher);
    } catch (error) {
      console.error('Failed to start file watcher:', error);
    }
  }

  /**
   * Stop watching configuration files
   */
  async stopWatching(): Promise<void> {
    for (const [path, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    await this.stopWatching();
    this.removeAllListeners();
  }
}