import * as fs from 'fs/promises';
import * as path from 'path';
import * as cron from 'node-cron';
import { logger } from '../../priority5-compliance/logger';

export interface RetentionPolicy {
  metrics: {
    enabled: boolean;
    days: number;
    compress: boolean;
  };
  compliance: {
    enabled: boolean;
    days: number;
    archivePath?: string;
  };
  reports: {
    enabled: boolean;
    days: number;
    keepMonthly: boolean;
  };
  logs: {
    enabled: boolean;
    days: number;
    compress: boolean;
  };
}

export interface CleanupResult {
  type: string;
  filesDeleted: number;
  filesArchived: number;
  spaceSaved: number;
  errors: string[];
}

export class DataRetentionManager {
  private static instance: DataRetentionManager;
  private policy: RetentionPolicy;
  private scheduledJobs: Map<string, cron.ScheduledTask> = new Map();
  private basePath: string;

  private constructor() {
    this.basePath = process.cwd();
    this.policy = this.getDefaultPolicy();
  }

  public static getInstance(): DataRetentionManager {
    if (!DataRetentionManager.instance) {
      DataRetentionManager.instance = new DataRetentionManager();
    }
    return DataRetentionManager.instance;
  }

  private getDefaultPolicy(): RetentionPolicy {
    return {
      metrics: {
        enabled: true,
        days: 90,
        compress: true
      },
      compliance: {
        enabled: true,
        days: 365,
        archivePath: path.join(this.basePath, 'archive', 'compliance')
      },
      reports: {
        enabled: true,
        days: 90,
        keepMonthly: true
      },
      logs: {
        enabled: true,
        days: 30,
        compress: true
      }
    };
  }

  public updatePolicy(policy: Partial<RetentionPolicy>): void {
    this.policy = { ...this.policy, ...policy };
    logger.info('Data retention policy updated', { policy: this.policy });
    this.rescheduleJobs();
  }

  public startRetentionManagement(): void {
    logger.info('Starting data retention management');
    
    // Schedule daily cleanup at 3 AM
    const dailyCleanup = cron.schedule('0 3 * * *', async () => {
      await this.performCleanup();
    });
    
    this.scheduledJobs.set('daily-cleanup', dailyCleanup);
    
    // Schedule weekly archive job at Sunday 2 AM
    const weeklyArchive = cron.schedule('0 2 * * 0', async () => {
      await this.performArchiving();
    });
    
    this.scheduledJobs.set('weekly-archive', weeklyArchive);
    
    logger.info('Data retention jobs scheduled');
  }

  public stopRetentionManagement(): void {
    this.scheduledJobs.forEach((job, name) => {
      job.stop();
      logger.info(`Stopped retention job: ${name}`);
    });
    this.scheduledJobs.clear();
  }

  private rescheduleJobs(): void {
    this.stopRetentionManagement();
    this.startRetentionManagement();
  }

  public async performCleanup(): Promise<CleanupResult[]> {
    logger.info('Starting data cleanup');
    const results: CleanupResult[] = [];
    
    if (this.policy.metrics.enabled) {
      const metricsResult = await this.cleanupMetrics();
      results.push(metricsResult);
    }
    
    if (this.policy.compliance.enabled) {
      const complianceResult = await this.cleanupCompliance();
      results.push(complianceResult);
    }
    
    if (this.policy.reports.enabled) {
      const reportsResult = await this.cleanupReports();
      results.push(reportsResult);
    }
    
    if (this.policy.logs.enabled) {
      const logsResult = await this.cleanupLogs();
      results.push(logsResult);
    }
    
    // Log summary
    const totalDeleted = results.reduce((sum, r) => sum + r.filesDeleted, 0);
    const totalSaved = results.reduce((sum, r) => sum + r.spaceSaved, 0);
    
    logger.info('Data cleanup completed', {
      totalFilesDeleted: totalDeleted,
      totalSpaceSaved: `${(totalSaved / 1024 / 1024).toFixed(2)} MB`
    });
    
    return results;
  }

  private async cleanupMetrics(): Promise<CleanupResult> {
    const result: CleanupResult = {
      type: 'metrics',
      filesDeleted: 0,
      filesArchived: 0,
      spaceSaved: 0,
      errors: []
    };
    
    try {
      const metricsPath = path.join(this.basePath, 'data', 'metrics');
      const files = await this.getOldFiles(metricsPath, this.policy.metrics.days);
      
      for (const file of files) {
        try {
          const stats = await fs.stat(file);
          
          if (this.policy.metrics.compress && file.endsWith('.json')) {
            // Compress old metrics files
            await this.compressFile(file);
            result.filesArchived++;
          } else {
            // Delete old files
            await fs.unlink(file);
            result.filesDeleted++;
            result.spaceSaved += stats.size;
          }
        } catch (error) {
          result.errors.push(`Failed to process ${file}: ${error.message}`);
        }
      }
    } catch (error) {
      result.errors.push(`Metrics cleanup failed: ${error.message}`);
    }
    
    return result;
  }

  private async cleanupCompliance(): Promise<CleanupResult> {
    const result: CleanupResult = {
      type: 'compliance',
      filesDeleted: 0,
      filesArchived: 0,
      spaceSaved: 0,
      errors: []
    };
    
    try {
      const compliancePath = path.join(this.basePath, 'logs', 'compliance-audit');
      const files = await this.getOldFiles(compliancePath, this.policy.compliance.days);
      
      // Create archive directory if needed
      if (this.policy.compliance.archivePath) {
        await fs.mkdir(this.policy.compliance.archivePath, { recursive: true });
      }
      
      for (const file of files) {
        try {
          const stats = await fs.stat(file);
          
          if (this.policy.compliance.archivePath) {
            // Archive compliance data
            const archiveName = path.basename(file);
            const archivePath = path.join(this.policy.compliance.archivePath, archiveName);
            await fs.copyFile(file, archivePath);
            await fs.unlink(file);
            result.filesArchived++;
            result.spaceSaved += stats.size;
          } else {
            // Delete if no archive path
            await fs.unlink(file);
            result.filesDeleted++;
            result.spaceSaved += stats.size;
          }
        } catch (error) {
          result.errors.push(`Failed to process ${file}: ${error.message}`);
        }
      }
    } catch (error) {
      result.errors.push(`Compliance cleanup failed: ${error.message}`);
    }
    
    return result;
  }

  private async cleanupReports(): Promise<CleanupResult> {
    const result: CleanupResult = {
      type: 'reports',
      filesDeleted: 0,
      filesArchived: 0,
      spaceSaved: 0,
      errors: []
    };
    
    try {
      const reportsPath = path.join(this.basePath, 'reports', 'generated');
      const files = await this.getOldFiles(reportsPath, this.policy.reports.days);
      
      for (const file of files) {
        try {
          const stats = await fs.stat(file);
          const filename = path.basename(file);
          
          // Check if this is a monthly report that should be kept
          if (this.policy.reports.keepMonthly && this.isMonthlyReport(filename)) {
            continue; // Skip deletion
          }
          
          await fs.unlink(file);
          result.filesDeleted++;
          result.spaceSaved += stats.size;
        } catch (error) {
          result.errors.push(`Failed to process ${file}: ${error.message}`);
        }
      }
    } catch (error) {
      result.errors.push(`Reports cleanup failed: ${error.message}`);
    }
    
    return result;
  }

  private async cleanupLogs(): Promise<CleanupResult> {
    const result: CleanupResult = {
      type: 'logs',
      filesDeleted: 0,
      filesArchived: 0,
      spaceSaved: 0,
      errors: []
    };
    
    try {
      const logsPath = path.join(this.basePath, 'logs');
      const files = await this.getOldFiles(logsPath, this.policy.logs.days);
      
      for (const file of files) {
        try {
          // Skip compliance audit logs (handled separately)
          if (file.includes('compliance-audit')) {
            continue;
          }
          
          const stats = await fs.stat(file);
          
          if (this.policy.logs.compress && file.endsWith('.log')) {
            // Compress old log files
            await this.compressFile(file);
            result.filesArchived++;
          } else if (!file.endsWith('.gz')) {
            // Delete uncompressed old files
            await fs.unlink(file);
            result.filesDeleted++;
            result.spaceSaved += stats.size;
          }
        } catch (error) {
          result.errors.push(`Failed to process ${file}: ${error.message}`);
        }
      }
    } catch (error) {
      result.errors.push(`Logs cleanup failed: ${error.message}`);
    }
    
    return result;
  }

  private async getOldFiles(dirPath: string, days: number): Promise<string[]> {
    const oldFiles: string[] = [];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    try {
      const files = await this.walkDirectory(dirPath);
      
      for (const file of files) {
        const stats = await fs.stat(file);
        if (stats.mtime < cutoffDate) {
          oldFiles.push(file);
        }
      }
    } catch (error) {
      logger.error('Failed to get old files', { dirPath, error });
    }
    
    return oldFiles;
  }

  private async walkDirectory(dir: string): Promise<string[]> {
    const files: string[] = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          const subFiles = await this.walkDirectory(fullPath);
          files.push(...subFiles);
        } else {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Directory might not exist
      logger.debug('Directory not found', { dir });
    }
    
    return files;
  }

  private async compressFile(filePath: string): Promise<void> {
    const zlib = require('zlib');
    const pipeline = require('util').promisify(require('stream').pipeline);
    
    const source = require('fs').createReadStream(filePath);
    const destination = require('fs').createWriteStream(`${filePath}.gz`);
    const gzip = zlib.createGzip();
    
    await pipeline(source, gzip, destination);
    await fs.unlink(filePath); // Remove original file
  }

  private isMonthlyReport(filename: string): boolean {
    // Check if filename indicates a monthly report
    return filename.includes('monthly') || 
           filename.match(/\d{4}-\d{2}-01/); // First day of month
  }

  public async performArchiving(): Promise<void> {
    logger.info('Starting weekly archiving');
    
    try {
      // Archive old metrics
      if (this.policy.metrics.enabled && this.policy.metrics.compress) {
        await this.archiveMetrics();
      }
      
      // Archive compliance data is handled in cleanup
      
      // Archive important reports
      await this.archiveReports();
      
      logger.info('Weekly archiving completed');
    } catch (error) {
      logger.error('Archiving failed', { error });
    }
  }

  private async archiveMetrics(): Promise<void> {
    const metricsPath = path.join(this.basePath, 'data', 'metrics');
    const archivePath = path.join(this.basePath, 'archive', 'metrics');
    
    await fs.mkdir(archivePath, { recursive: true });
    
    // Get files older than 7 days but newer than retention period
    const files = await this.getFilesInRange(metricsPath, 7, this.policy.metrics.days);
    
    for (const file of files) {
      try {
        if (!file.endsWith('.gz')) {
          await this.compressFile(file);
        }
      } catch (error) {
        logger.error('Failed to archive metric file', { file, error });
      }
    }
  }

  private async archiveReports(): Promise<void> {
    const reportsPath = path.join(this.basePath, 'reports', 'generated');
    const archivePath = path.join(this.basePath, 'archive', 'reports');
    
    await fs.mkdir(archivePath, { recursive: true });
    
    // Archive monthly reports
    const files = await this.walkDirectory(reportsPath);
    
    for (const file of files) {
      if (this.isMonthlyReport(path.basename(file))) {
        try {
          const archiveName = path.basename(file);
          const archiveFile = path.join(archivePath, archiveName);
          await fs.copyFile(file, archiveFile);
          logger.info('Archived monthly report', { file: archiveName });
        } catch (error) {
          logger.error('Failed to archive report', { file, error });
        }
      }
    }
  }

  private async getFilesInRange(dirPath: string, minDays: number, maxDays: number): Promise<string[]> {
    const files: string[] = [];
    const minDate = new Date();
    minDate.setDate(minDate.getDate() - maxDays);
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() - minDays);
    
    try {
      const allFiles = await this.walkDirectory(dirPath);
      
      for (const file of allFiles) {
        const stats = await fs.stat(file);
        if (stats.mtime >= minDate && stats.mtime <= maxDate) {
          files.push(file);
        }
      }
    } catch (error) {
      logger.error('Failed to get files in range', { dirPath, error });
    }
    
    return files;
  }

  public async getStorageUsage(): Promise<{
    metrics: number;
    compliance: number;
    reports: number;
    logs: number;
    total: number;
  }> {
    const usage = {
      metrics: 0,
      compliance: 0,
      reports: 0,
      logs: 0,
      total: 0
    };
    
    try {
      usage.metrics = await this.getDirectorySize(path.join(this.basePath, 'data', 'metrics'));
      usage.compliance = await this.getDirectorySize(path.join(this.basePath, 'logs', 'compliance-audit'));
      usage.reports = await this.getDirectorySize(path.join(this.basePath, 'reports'));
      usage.logs = await this.getDirectorySize(path.join(this.basePath, 'logs'));
      usage.total = usage.metrics + usage.compliance + usage.reports + usage.logs;
    } catch (error) {
      logger.error('Failed to calculate storage usage', { error });
    }
    
    return usage;
  }

  private async getDirectorySize(dirPath: string): Promise<number> {
    let size = 0;
    
    try {
      const files = await this.walkDirectory(dirPath);
      
      for (const file of files) {
        const stats = await fs.stat(file);
        size += stats.size;
      }
    } catch (error) {
      // Directory might not exist
      logger.debug('Directory not found for size calculation', { dirPath });
    }
    
    return size;
  }

  public getPolicy(): RetentionPolicy {
    return { ...this.policy };
  }

  public async manualCleanup(type?: 'metrics' | 'compliance' | 'reports' | 'logs'): Promise<CleanupResult[]> {
    logger.info('Starting manual cleanup', { type });
    
    if (type) {
      switch (type) {
        case 'metrics':
          return [await this.cleanupMetrics()];
        case 'compliance':
          return [await this.cleanupCompliance()];
        case 'reports':
          return [await this.cleanupReports()];
        case 'logs':
          return [await this.cleanupLogs()];
      }
    }
    
    return this.performCleanup();
  }
}

export default DataRetentionManager.getInstance();