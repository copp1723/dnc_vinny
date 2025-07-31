import { Config } from '../schemas';
import * as semver from 'semver';

export interface Migration {
  fromVersion: string;
  toVersion: string;
  description: string;
  migrate: (config: any) => any;
}

export class ConfigMigrationManager {
  private migrations: Migration[] = [];

  constructor() {
    this.registerMigrations();
  }

  /**
   * Register all configuration migrations
   */
  private registerMigrations(): void {
    // Example migration from 1.0.0 to 1.1.0
    this.addMigration({
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      description: 'Add multi-tenant support',
      migrate: (config) => {
        // Ensure dealerships have metadata field
        if (config.dealerships) {
          config.dealerships = config.dealerships.map((d: any) => ({
            ...d,
            metadata: d.metadata || {},
          }));
        }
        return config;
      },
    });

    // Example migration from 1.1.0 to 1.2.0
    this.addMigration({
      fromVersion: '1.1.0',
      toVersion: '1.2.0',
      description: 'Add webhook configuration',
      migrate: (config) => {
        // Add webhook URL to PossibleNOW config if not present
        if (config.dealerships) {
          config.dealerships = config.dealerships.map((d: any) => ({
            ...d,
            possibleNOW: {
              ...d.possibleNOW,
              webhookUrl: d.possibleNOW.webhookUrl || undefined,
            },
          }));
        }
        return config;
      },
    });

    // Add more migrations as needed
  }

  /**
   * Add a migration
   */
  addMigration(migration: Migration): void {
    this.migrations.push(migration);
    // Sort migrations by version
    this.migrations.sort((a, b) => 
      semver.compare(a.fromVersion, b.fromVersion)
    );
  }

  /**
   * Migrate configuration to the latest version
   */
  async migrate(config: any, targetVersion?: string): Promise<Config> {
    const currentVersion = config.version || '1.0.0';
    const latestVersion = targetVersion || this.getLatestVersion();

    if (semver.gte(currentVersion, latestVersion)) {
      // Already at or above target version
      return config;
    }

    console.log(`Migrating configuration from ${currentVersion} to ${latestVersion}`);

    let migratedConfig = { ...config };
    const applicableMigrations = this.getApplicableMigrations(currentVersion, latestVersion);

    for (const migration of applicableMigrations) {
      console.log(`Applying migration: ${migration.description}`);
      migratedConfig = await migration.migrate(migratedConfig);
      migratedConfig.version = migration.toVersion;
    }

    return migratedConfig;
  }

  /**
   * Get applicable migrations for a version range
   */
  private getApplicableMigrations(fromVersion: string, toVersion: string): Migration[] {
    return this.migrations.filter(m => 
      semver.gte(m.fromVersion, fromVersion) && 
      semver.lte(m.toVersion, toVersion)
    );
  }

  /**
   * Get the latest version available
   */
  private getLatestVersion(): string {
    if (this.migrations.length === 0) {
      return '1.0.0';
    }
    return this.migrations[this.migrations.length - 1].toVersion;
  }

  /**
   * Check if migration is needed
   */
  needsMigration(config: any, targetVersion?: string): boolean {
    const currentVersion = config.version || '1.0.0';
    const latestVersion = targetVersion || this.getLatestVersion();
    return semver.lt(currentVersion, latestVersion);
  }

  /**
   * Get migration history
   */
  getMigrationHistory(fromVersion: string, toVersion?: string): Migration[] {
    const target = toVersion || this.getLatestVersion();
    return this.getApplicableMigrations(fromVersion, target);
  }

  /**
   * Validate configuration version
   */
  validateVersion(config: any): { valid: boolean; message?: string } {
    if (!config.version) {
      return { valid: false, message: 'Configuration version is missing' };
    }

    if (!semver.valid(config.version)) {
      return { valid: false, message: 'Invalid version format' };
    }

    const latestVersion = this.getLatestVersion();
    if (semver.gt(config.version, latestVersion)) {
      return { 
        valid: false, 
        message: `Configuration version ${config.version} is newer than supported version ${latestVersion}` 
      };
    }

    return { valid: true };
  }

  /**
   * Create a backup before migration
   */
  createBackup(config: any): { timestamp: string; config: any } {
    return {
      timestamp: new Date().toISOString(),
      config: JSON.parse(JSON.stringify(config)),
    };
  }
}