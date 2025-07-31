import { EventEmitter } from 'events';
import { DealershipConfig } from '../config/schemas';
import { ConfigManager } from '../config/ConfigManager';
import { logger } from '../../priority5-compliance/logger';
import * as fs from 'fs/promises';
import * as path from 'path';

export enum StorePriority {
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export interface StoreConfig {
  id: string;
  name: string;
  priority: StorePriority;
  active: boolean;
  dealershipConfig: DealershipConfig;
  processingWindow?: {
    start: string; // HH:MM format
    end: string;   // HH:MM format
    timezone: string;
    daysOfWeek?: number[]; // 0-6, where 0 is Sunday
  };
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    lastProcessed?: Date;
    failureCount: number;
    quarantined: boolean;
    quarantinedAt?: Date;
    quarantineReason?: string;
  };
  customSettings?: {
    maxRetries?: number;
    timeoutMultiplier?: number;
    batchSizeOverride?: number;
    [key: string]: any;
  };
}

export interface StoreRegistryState {
  stores: Map<string, StoreConfig>;
  version: string;
  lastModified: Date;
}

export class StoreRegistry extends EventEmitter {
  private stores: Map<string, StoreConfig> = new Map();
  private configManager: ConfigManager;
  private registryPath: string;
  private autoSave: boolean = true;

  constructor(registryPath: string = './data/store-registry.json') {
    super();
    this.registryPath = registryPath;
    this.configManager = new ConfigManager({
      configPath: './config',
      autoLoad: false,
    });
  }

  /**
   * Load stores from registry and configuration
   */
  async loadStores(): Promise<void> {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.registryPath);
      await fs.mkdir(dataDir, { recursive: true });

      // Load existing registry if it exists
      try {
        const registryData = await fs.readFile(this.registryPath, 'utf-8');
        const registry: StoreRegistryState = JSON.parse(registryData);
        
        for (const [id, store] of Object.entries(registry.stores)) {
          this.stores.set(id, {
            ...store,
            metadata: {
              ...store.metadata,
              createdAt: new Date(store.metadata.createdAt),
              updatedAt: new Date(store.metadata.updatedAt),
              lastProcessed: store.metadata.lastProcessed ? new Date(store.metadata.lastProcessed) : undefined,
              quarantinedAt: store.metadata.quarantinedAt ? new Date(store.metadata.quarantinedAt) : undefined,
            },
          });
        }
        
        logger.info(`📁 Loaded ${this.stores.size} stores from registry`);
      } catch (error) {
        logger.info('📁 No existing store registry found, starting fresh');
      }

      // Load dealership configurations
      await this.configManager.load();
      const config = this.configManager.getConfig();
      
      // Sync with dealership configurations
      for (const dealership of config.dealerships) {
        if (!this.stores.has(dealership.id)) {
          // Add new store
          const store: StoreConfig = {
            id: dealership.id,
            name: dealership.name,
            priority: StorePriority.MEDIUM,
            active: dealership.active,
            dealershipConfig: dealership,
            metadata: {
              createdAt: new Date(),
              updatedAt: new Date(),
              failureCount: 0,
              quarantined: false,
            },
          };
          
          this.stores.set(dealership.id, store);
          logger.info(`➕ Added new store: ${dealership.name}`);
          this.emit('storeAdded', store);
        } else {
          // Update existing store with latest dealership config
          const existingStore = this.stores.get(dealership.id)!;
          existingStore.dealershipConfig = dealership;
          existingStore.active = dealership.active;
          existingStore.metadata.updatedAt = new Date();
          
          logger.info(`🔄 Updated store configuration: ${dealership.name}`);
          this.emit('storeUpdated', existingStore);
        }
      }

      // Save updated registry
      if (this.autoSave) {
        await this.saveRegistry();
      }

    } catch (error) {
      logger.error('Failed to load stores:', error);
      throw error;
    }
  }

  /**
   * Save registry to disk
   */
  async saveRegistry(): Promise<void> {
    try {
      const registry: StoreRegistryState = {
        stores: Object.fromEntries(this.stores),
        version: '1.0.0',
        lastModified: new Date(),
      };

      await fs.writeFile(
        this.registryPath,
        JSON.stringify(registry, null, 2)
      );

      logger.debug('💾 Store registry saved');
    } catch (error) {
      logger.error('Failed to save store registry:', error);
      throw error;
    }
  }

  /**
   * Add a new store
   */
  async addStore(store: StoreConfig): Promise<void> {
    if (this.stores.has(store.id)) {
      throw new Error(`Store with ID ${store.id} already exists`);
    }

    store.metadata.createdAt = new Date();
    store.metadata.updatedAt = new Date();
    store.metadata.failureCount = 0;
    store.metadata.quarantined = false;

    this.stores.set(store.id, store);
    logger.info(`➕ Added store: ${store.name} (ID: ${store.id})`);
    
    this.emit('storeAdded', store);
    
    if (this.autoSave) {
      await this.saveRegistry();
    }
  }

  /**
   * Update an existing store
   */
  async updateStore(storeId: string, updates: Partial<StoreConfig>): Promise<void> {
    const store = this.stores.get(storeId);
    if (!store) {
      throw new Error(`Store with ID ${storeId} not found`);
    }

    const updatedStore = {
      ...store,
      ...updates,
      id: store.id, // Ensure ID cannot be changed
      metadata: {
        ...store.metadata,
        ...updates.metadata,
        updatedAt: new Date(),
      },
    };

    this.stores.set(storeId, updatedStore);
    logger.info(`🔄 Updated store: ${updatedStore.name}`);
    
    this.emit('storeUpdated', updatedStore);
    
    if (this.autoSave) {
      await this.saveRegistry();
    }
  }

  /**
   * Remove a store
   */
  async removeStore(storeId: string): Promise<void> {
    const store = this.stores.get(storeId);
    if (!store) {
      throw new Error(`Store with ID ${storeId} not found`);
    }

    this.stores.delete(storeId);
    logger.info(`➖ Removed store: ${store.name}`);
    
    this.emit('storeRemoved', store);
    
    if (this.autoSave) {
      await this.saveRegistry();
    }
  }

  /**
   * Enable a store
   */
  async enableStore(storeId: string): Promise<void> {
    await this.updateStore(storeId, { active: true });
  }

  /**
   * Disable a store
   */
  async disableStore(storeId: string): Promise<void> {
    await this.updateStore(storeId, { active: false });
  }

  /**
   * Set store priority
   */
  async setStorePriority(storeId: string, priority: StorePriority): Promise<void> {
    await this.updateStore(storeId, { priority });
  }

  /**
   * Set processing window for a store
   */
  async setProcessingWindow(storeId: string, window: StoreConfig['processingWindow']): Promise<void> {
    await this.updateStore(storeId, { processingWindow: window });
  }

  /**
   * Increment failure count for a store
   */
  async incrementFailureCount(storeId: string): Promise<number> {
    const store = this.stores.get(storeId);
    if (!store) {
      throw new Error(`Store with ID ${storeId} not found`);
    }

    store.metadata.failureCount++;
    store.metadata.updatedAt = new Date();
    
    if (this.autoSave) {
      await this.saveRegistry();
    }

    return store.metadata.failureCount;
  }

  /**
   * Reset failure count for a store
   */
  async resetFailureCount(storeId: string): Promise<void> {
    const store = this.stores.get(storeId);
    if (!store) {
      throw new Error(`Store with ID ${storeId} not found`);
    }

    store.metadata.failureCount = 0;
    store.metadata.updatedAt = new Date();
    
    if (this.autoSave) {
      await this.saveRegistry();
    }
  }

  /**
   * Quarantine a store
   */
  async quarantineStore(storeId: string, reason?: string): Promise<void> {
    const store = this.stores.get(storeId);
    if (!store) {
      throw new Error(`Store with ID ${storeId} not found`);
    }

    store.metadata.quarantined = true;
    store.metadata.quarantinedAt = new Date();
    store.metadata.quarantineReason = reason || 'Exceeded failure threshold';
    store.metadata.updatedAt = new Date();
    store.active = false;
    
    logger.warn(`🔒 Store quarantined: ${store.name} - ${store.metadata.quarantineReason}`);
    this.emit('storeQuarantined', store);
    
    if (this.autoSave) {
      await this.saveRegistry();
    }
  }

  /**
   * Release store from quarantine
   */
  async releaseFromQuarantine(storeId: string): Promise<void> {
    const store = this.stores.get(storeId);
    if (!store) {
      throw new Error(`Store with ID ${storeId} not found`);
    }

    store.metadata.quarantined = false;
    store.metadata.quarantinedAt = undefined;
    store.metadata.quarantineReason = undefined;
    store.metadata.failureCount = 0;
    store.metadata.updatedAt = new Date();
    store.active = true;
    
    logger.info(`🔓 Store released from quarantine: ${store.name}`);
    this.emit('storeReleased', store);
    
    if (this.autoSave) {
      await this.saveRegistry();
    }
  }

  /**
   * Update last processed time
   */
  async updateLastProcessed(storeId: string, timestamp: Date = new Date()): Promise<void> {
    const store = this.stores.get(storeId);
    if (!store) {
      throw new Error(`Store with ID ${storeId} not found`);
    }

    store.metadata.lastProcessed = timestamp;
    store.metadata.updatedAt = new Date();
    
    if (this.autoSave) {
      await this.saveRegistry();
    }
  }

  /**
   * Get all stores
   */
  getAllStores(): StoreConfig[] {
    return Array.from(this.stores.values());
  }

  /**
   * Get active stores
   */
  getActiveStores(): StoreConfig[] {
    return Array.from(this.stores.values()).filter(store => 
      store.active && !store.metadata.quarantined
    );
  }

  /**
   * Get stores by priority
   */
  getStoresByPriority(priority: StorePriority): StoreConfig[] {
    return Array.from(this.stores.values()).filter(store => 
      store.priority === priority && store.active && !store.metadata.quarantined
    );
  }

  /**
   * Get quarantined stores
   */
  getQuarantinedStores(): StoreConfig[] {
    return Array.from(this.stores.values()).filter(store => 
      store.metadata.quarantined
    );
  }

  /**
   * Get a specific store
   */
  getStore(storeId: string): StoreConfig | undefined {
    return this.stores.get(storeId);
  }

  /**
   * Check if a store exists
   */
  hasStore(storeId: string): boolean {
    return this.stores.has(storeId);
  }

  /**
   * Get store statistics
   */
  getStatistics(): {
    total: number;
    active: number;
    inactive: number;
    quarantined: number;
    byPriority: Record<StorePriority, number>;
    withProcessingWindows: number;
  } {
    const stores = Array.from(this.stores.values());
    
    return {
      total: stores.length,
      active: stores.filter(s => s.active && !s.metadata.quarantined).length,
      inactive: stores.filter(s => !s.active && !s.metadata.quarantined).length,
      quarantined: stores.filter(s => s.metadata.quarantined).length,
      byPriority: {
        [StorePriority.HIGH]: stores.filter(s => s.priority === StorePriority.HIGH).length,
        [StorePriority.MEDIUM]: stores.filter(s => s.priority === StorePriority.MEDIUM).length,
        [StorePriority.LOW]: stores.filter(s => s.priority === StorePriority.LOW).length,
      },
      withProcessingWindows: stores.filter(s => s.processingWindow).length,
    };
  }

  /**
   * Export stores to JSON
   */
  async exportStores(filepath: string): Promise<void> {
    const exportData = {
      stores: Array.from(this.stores.values()),
      exported: new Date(),
      statistics: this.getStatistics(),
    };

    await fs.writeFile(filepath, JSON.stringify(exportData, null, 2));
    logger.info(`📤 Exported ${this.stores.size} stores to ${filepath}`);
  }

  /**
   * Import stores from JSON
   */
  async importStores(filepath: string, merge: boolean = false): Promise<void> {
    const data = await fs.readFile(filepath, 'utf-8');
    const importData = JSON.parse(data);

    if (!merge) {
      this.stores.clear();
    }

    for (const store of importData.stores) {
      store.metadata.createdAt = new Date(store.metadata.createdAt);
      store.metadata.updatedAt = new Date(store.metadata.updatedAt);
      if (store.metadata.lastProcessed) {
        store.metadata.lastProcessed = new Date(store.metadata.lastProcessed);
      }
      if (store.metadata.quarantinedAt) {
        store.metadata.quarantinedAt = new Date(store.metadata.quarantinedAt);
      }

      this.stores.set(store.id, store);
    }

    logger.info(`📥 Imported ${importData.stores.length} stores from ${filepath}`);
    
    if (this.autoSave) {
      await this.saveRegistry();
    }
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    if (this.autoSave) {
      await this.saveRegistry();
    }
    this.removeAllListeners();
  }
}