import * as fs from 'fs-extra';
import * as path from 'path';
import { CheckpointData } from './types';
import { Logger } from '../../../utils/Logger';

/**
 * Workflow Checkpoint Manager
 * Handles saving and loading checkpoint data for workflow resume capability
 */
export class WorkflowCheckpoint {
  private logger: Logger;
  
  constructor(private checkpointDir: string) {
    this.logger = new Logger('WorkflowCheckpoint');
    this.ensureCheckpointDir();
  }

  /**
   * Ensure checkpoint directory exists
   */
  private async ensureCheckpointDir(): Promise<void> {
    await fs.ensureDir(this.checkpointDir);
  }

  /**
   * Get checkpoint file path for a dealership
   */
  private getCheckpointPath(dealershipId: string): string {
    return path.join(this.checkpointDir, `checkpoint_${dealershipId}.json`);
  }

  /**
   * Save checkpoint data
   */
  async save(dealershipId: string, data: Partial<CheckpointData>): Promise<void> {
    try {
      const checkpointPath = this.getCheckpointPath(dealershipId);
      
      // Load existing checkpoint if exists
      let checkpoint: CheckpointData = await this.load(dealershipId) || {
        dealershipId,
        stage: '',
        timestamp: new Date()
      };

      // Merge with new data
      checkpoint = {
        ...checkpoint,
        ...data,
        dealershipId,
        timestamp: new Date()
      };

      // Save to file
      await fs.writeJson(checkpointPath, checkpoint, { spaces: 2 });
      
      this.logger.info(`Checkpoint saved for dealership ${dealershipId} at stage: ${checkpoint.stage}`);
      
      // Also create a backup
      const backupPath = path.join(
        this.checkpointDir, 
        'backups',
        `checkpoint_${dealershipId}_${Date.now()}.json`
      );
      await fs.ensureDir(path.dirname(backupPath));
      await fs.copy(checkpointPath, backupPath);
      
    } catch (error) {
      this.logger.error(`Failed to save checkpoint: ${error}`);
      throw error;
    }
  }

  /**
   * Load checkpoint data
   */
  async load(dealershipId: string): Promise<CheckpointData | null> {
    try {
      const checkpointPath = this.getCheckpointPath(dealershipId);
      
      if (!await fs.pathExists(checkpointPath)) {
        return null;
      }

      const checkpoint = await fs.readJson(checkpointPath);
      
      this.logger.info(`Checkpoint loaded for dealership ${dealershipId}: ${checkpoint.stage}`);
      
      return checkpoint;
      
    } catch (error) {
      this.logger.error(`Failed to load checkpoint: ${error}`);
      return null;
    }
  }

  /**
   * Clear checkpoint data
   */
  async clear(dealershipId: string): Promise<void> {
    try {
      const checkpointPath = this.getCheckpointPath(dealershipId);
      
      if (await fs.pathExists(checkpointPath)) {
        // Archive before clearing
        const archivePath = path.join(
          this.checkpointDir,
          'archive',
          `checkpoint_${dealershipId}_completed_${Date.now()}.json`
        );
        await fs.ensureDir(path.dirname(archivePath));
        await fs.move(checkpointPath, archivePath);
        
        this.logger.info(`Checkpoint cleared and archived for dealership ${dealershipId}`);
      }
      
    } catch (error) {
      this.logger.error(`Failed to clear checkpoint: ${error}`);
      throw error;
    }
  }

  /**
   * List all active checkpoints
   */
  async listActive(): Promise<Array<{dealershipId: string, checkpoint: CheckpointData}>> {
    try {
      const files = await fs.readdir(this.checkpointDir);
      const checkpoints = [];

      for (const file of files) {
        if (file.startsWith('checkpoint_') && file.endsWith('.json')) {
          const checkpointPath = path.join(this.checkpointDir, file);
          const checkpoint = await fs.readJson(checkpointPath);
          const dealershipId = file.replace('checkpoint_', '').replace('.json', '');
          
          checkpoints.push({ dealershipId, checkpoint });
        }
      }

      return checkpoints;
      
    } catch (error) {
      this.logger.error(`Failed to list checkpoints: ${error}`);
      return [];
    }
  }

  /**
   * Clean up old checkpoints and backups
   */
  async cleanup(retentionDays: number = 30): Promise<void> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      // Clean backups
      const backupDir = path.join(this.checkpointDir, 'backups');
      if (await fs.pathExists(backupDir)) {
        const backups = await fs.readdir(backupDir);
        
        for (const backup of backups) {
          const backupPath = path.join(backupDir, backup);
          const stats = await fs.stat(backupPath);
          
          if (stats.mtime < cutoffDate) {
            await fs.remove(backupPath);
            this.logger.info(`Removed old backup: ${backup}`);
          }
        }
      }

      // Clean archives
      const archiveDir = path.join(this.checkpointDir, 'archive');
      if (await fs.pathExists(archiveDir)) {
        const archives = await fs.readdir(archiveDir);
        
        for (const archive of archives) {
          const archivePath = path.join(archiveDir, archive);
          const stats = await fs.stat(archivePath);
          
          if (stats.mtime < cutoffDate) {
            await fs.remove(archivePath);
            this.logger.info(`Removed old archive: ${archive}`);
          }
        }
      }
      
    } catch (error) {
      this.logger.error(`Failed to cleanup old checkpoints: ${error}`);
    }
  }

  /**
   * Export checkpoint for debugging or migration
   */
  async export(dealershipId: string, exportPath: string): Promise<void> {
    try {
      const checkpoint = await this.load(dealershipId);
      
      if (!checkpoint) {
        throw new Error(`No checkpoint found for dealership ${dealershipId}`);
      }

      await fs.writeJson(exportPath, {
        checkpoint,
        exported: new Date(),
        version: '1.0'
      }, { spaces: 2 });
      
      this.logger.info(`Checkpoint exported to: ${exportPath}`);
      
    } catch (error) {
      this.logger.error(`Failed to export checkpoint: ${error}`);
      throw error;
    }
  }

  /**
   * Import checkpoint from external source
   */
  async import(dealershipId: string, importPath: string): Promise<void> {
    try {
      const data = await fs.readJson(importPath);
      
      if (!data.checkpoint) {
        throw new Error('Invalid checkpoint format');
      }

      await this.save(dealershipId, data.checkpoint);
      
      this.logger.info(`Checkpoint imported from: ${importPath}`);
      
    } catch (error) {
      this.logger.error(`Failed to import checkpoint: ${error}`);
      throw error;
    }
  }
}