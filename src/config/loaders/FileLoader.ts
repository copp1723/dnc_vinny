import * as fs from 'fs/promises';
import * as path from 'path';
import { Config, ConfigSchema } from '../schemas';
import { z } from 'zod';
import * as yaml from 'js-yaml';

export class FileLoader {
  private configPath: string;

  constructor(configPath: string = './config') {
    this.configPath = configPath;
  }

  /**
   * Load configuration from a JSON file
   */
  async loadJson(filename: string): Promise<Config> {
    const filePath = path.join(this.configPath, filename);
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    return ConfigSchema.parse(data);
  }

  /**
   * Load configuration from a YAML file
   */
  async loadYaml(filename: string): Promise<Config> {
    const filePath = path.join(this.configPath, filename);
    const content = await fs.readFile(filePath, 'utf-8');
    const data = yaml.load(content) as any;
    return ConfigSchema.parse(data);
  }

  /**
   * Load configuration from any supported format
   */
  async load(filename: string): Promise<Config> {
    const ext = path.extname(filename).toLowerCase();
    
    switch (ext) {
      case '.json':
        return this.loadJson(filename);
      case '.yaml':
      case '.yml':
        return this.loadYaml(filename);
      default:
        throw new Error(`Unsupported file format: ${ext}`);
    }
  }

  /**
   * Save configuration to a JSON file
   */
  async saveJson(filename: string, config: Config): Promise<void> {
    const filePath = path.join(this.configPath, filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(config, null, 2));
  }

  /**
   * Save configuration to a YAML file
   */
  async saveYaml(filename: string, config: Config): Promise<void> {
    const filePath = path.join(this.configPath, filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, yaml.dump(config, { indent: 2 }));
  }

  /**
   * Save configuration to any supported format
   */
  async save(filename: string, config: Config): Promise<void> {
    const ext = path.extname(filename).toLowerCase();
    
    switch (ext) {
      case '.json':
        return this.saveJson(filename, config);
      case '.yaml':
      case '.yml':
        return this.saveYaml(filename, config);
      default:
        throw new Error(`Unsupported file format: ${ext}`);
    }
  }

  /**
   * Check if a configuration file exists
   */
  async exists(filename: string): Promise<boolean> {
    try {
      const filePath = path.join(this.configPath, filename);
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all configuration files
   */
  async list(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.configPath);
      return files.filter(file => 
        ['.json', '.yaml', '.yml'].includes(path.extname(file).toLowerCase())
      );
    } catch {
      return [];
    }
  }

  /**
   * Load and merge multiple configuration files
   */
  async loadMultiple(filenames: string[]): Promise<Config> {
    let mergedConfig: Partial<Config> = {};

    for (const filename of filenames) {
      if (await this.exists(filename)) {
        const config = await this.load(filename);
        mergedConfig = this.deepMerge(mergedConfig, config);
      }
    }

    return ConfigSchema.parse(mergedConfig);
  }

  /**
   * Deep merge two objects
   */
  private deepMerge(target: any, source: any): any {
    if (!source) return target;
    if (!target) return source;

    const result = { ...target };

    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (typeof source[key] === 'object' && !Array.isArray(source[key])) {
          result[key] = this.deepMerge(target[key], source[key]);
        } else {
          result[key] = source[key];
        }
      }
    }

    return result;
  }

  /**
   * Backup a configuration file
   */
  async backup(filename: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const backupName = `${path.basename(filename, path.extname(filename))}.${timestamp}${path.extname(filename)}`;
    const backupPath = path.join(this.configPath, 'backups', backupName);

    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.copyFile(
      path.join(this.configPath, filename),
      backupPath
    );

    return backupPath;
  }
}