// Main exports
export { ConfigManager, ConfigManagerOptions } from './ConfigManager';
export { ConfigMigrationManager, Migration } from './utils/ConfigMigration';
export { EncryptionService, EncryptionConfig } from './utils/encryption';

// Schema exports
export {
  Config,
  ConfigSchema,
  DealershipConfig,
  DealershipConfigSchema,
  VinSolutionsConfig,
  VinSolutionsConfigSchema,
  PossibleNOWConfig,
  PossibleNOWConfigSchema,
  WorkflowConfig,
  WorkflowConfigSchema,
  ReportConfig,
  ReportConfigSchema,
  ScheduleConfig,
  ScheduleConfigSchema,
  SecurityConfig,
  SecurityConfigSchema,
} from './schemas';

// Loader exports
export { EnvLoader } from './loaders/EnvLoader';
export { FileLoader } from './loaders/FileLoader';

// Utility function to create a pre-configured instance
export async function createConfigManager(options?: {
  configPath?: string;
  masterPassword?: string;
  autoLoad?: boolean;
}): Promise<ConfigManager> {
  const manager = new ConfigManager({
    configPath: options?.configPath || process.env.DNC_VINNY_CONFIG_PATH || './config',
    envPrefix: process.env.DNC_VINNY_ENV_PREFIX || 'DNC_VINNY',
    autoLoad: options?.autoLoad ?? true,
    encryption: true,
    watchForChanges: process.env.NODE_ENV === 'development',
  });

  const masterPassword = options?.masterPassword || 
    process.env.DNC_VINNY_MASTER_PASSWORD;

  if (masterPassword) {
    await manager.initialize(masterPassword);
  }

  return manager;
}

// Helper function to validate environment
export function validateEnvironment(): { valid: boolean; missing: string[] } {
  const required = [
    'DNC_VINNY_VERSION',
    'DNC_VINNY_ENVIRONMENT',
  ];

  const missing = required.filter(key => !process.env[key]);

  return {
    valid: missing.length === 0,
    missing,
  };
}