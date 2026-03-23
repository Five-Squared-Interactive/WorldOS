/**
 * Backup Manager
 *
 * Story 4.8: Installation Rollback
 *
 * Creates and manages backups of plugins for rollback support.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Backup entry metadata
 */
export interface BackupEntry {
  id: string;
  pluginName: string;
  version?: string;
  reason: string;
  timestamp: string;
  backupPath: string;
}

/**
 * Backup manifest
 */
interface BackupManifest {
  version: number;
  backups: BackupEntry[];
}

/**
 * Manages plugin backups for rollback support
 */
export class BackupManager {
  private serverDir: string;
  private backupsDir: string;
  private manifestPath: string;

  constructor(serverDir: string) {
    this.serverDir = serverDir;
    this.backupsDir = path.join(serverDir, '.wos-backups');
    this.manifestPath = path.join(this.backupsDir, 'manifest.json');
  }

  /**
   * Create a backup of a plugin
   */
  async createBackup(pluginName: string, reason: string): Promise<BackupEntry> {
    const pluginDir = path.join(this.serverDir, 'plugins', pluginName);

    // Ensure plugin exists
    const exists = await fs.access(pluginDir).then(() => true).catch(() => false);
    if (!exists) {
      throw new Error(`Plugin '${pluginName}' not found`);
    }

    // Generate unique backup ID
    const id = this.generateId();
    const timestamp = new Date().toISOString();
    const backupPath = path.join(this.backupsDir, id);

    // Create backup directory
    await fs.mkdir(backupPath, { recursive: true });

    // Copy plugin files (excluding node_modules and .git)
    await this.copyDirectory(pluginDir, backupPath);

    // Get plugin version from manifest if available
    let version: string | undefined;
    try {
      const manifestPath = path.join(pluginDir, 'wos-plugin.yaml');
      const content = await fs.readFile(manifestPath, 'utf-8');
      const match = content.match(/version:\s*['"]?([^'"\n]+)['"]?/);
      if (match) {
        version = match[1];
      }
    } catch {
      // Ignore version extraction errors
    }

    // Create backup entry
    const entry: BackupEntry = {
      id,
      pluginName,
      version,
      reason,
      timestamp,
      backupPath,
    };

    // Add to manifest
    await this.addToManifest(entry);

    return entry;
  }

  /**
   * Restore a backup
   */
  async restore(backupId: string): Promise<void> {
    const manifest = await this.loadManifest();
    const entry = manifest.backups.find(b => b.id === backupId);

    if (!entry) {
      throw new Error(`Backup '${backupId}' not found`);
    }

    const pluginDir = path.join(this.serverDir, 'plugins', entry.pluginName);

    // Remove current plugin if exists
    const exists = await fs.access(pluginDir).then(() => true).catch(() => false);
    if (exists) {
      await fs.rm(pluginDir, { recursive: true, force: true });
    }

    // Restore from backup
    await this.copyDirectory(entry.backupPath, pluginDir);
  }

  /**
   * List all backups, optionally filtered by plugin name
   */
  async list(pluginName?: string): Promise<BackupEntry[]> {
    const manifest = await this.loadManifest();

    if (pluginName) {
      return manifest.backups.filter(b => b.pluginName === pluginName);
    }

    return manifest.backups;
  }

  /**
   * Delete a backup
   */
  async delete(backupId: string): Promise<void> {
    const manifest = await this.loadManifest();
    const entryIndex = manifest.backups.findIndex(b => b.id === backupId);

    if (entryIndex === -1) {
      throw new Error(`Backup '${backupId}' not found`);
    }

    const entry = manifest.backups[entryIndex];

    // Remove backup directory
    await fs.rm(entry.backupPath, { recursive: true, force: true });

    // Remove from manifest
    manifest.backups.splice(entryIndex, 1);
    await this.saveManifest(manifest);
  }

  /**
   * Cleanup old backups
   * @param retentionDays Number of days to keep backups
   * @returns Number of backups deleted
   */
  async cleanup(retentionDays: number): Promise<number> {
    const manifest = await this.loadManifest();
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    let deleted = 0;

    const toDelete: string[] = [];

    for (const entry of manifest.backups) {
      const backupDate = new Date(entry.timestamp);
      if (backupDate < cutoffDate) {
        toDelete.push(entry.id);
      }
    }

    for (const id of toDelete) {
      await this.delete(id);
      deleted++;
    }

    return deleted;
  }

  /**
   * Get the latest backup for a plugin
   */
  async getLatest(pluginName: string): Promise<BackupEntry | undefined> {
    const backups = await this.list(pluginName);

    if (backups.length === 0) {
      return undefined;
    }

    // Sort by timestamp descending
    backups.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return backups[0];
  }

  /**
   * Generate unique backup ID
   */
  private generateId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * Load backup manifest
   */
  private async loadManifest(): Promise<BackupManifest> {
    try {
      const content = await fs.readFile(this.manifestPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return { version: 1, backups: [] };
    }
  }

  /**
   * Save backup manifest
   */
  private async saveManifest(manifest: BackupManifest): Promise<void> {
    await fs.mkdir(this.backupsDir, { recursive: true });
    await fs.writeFile(this.manifestPath, JSON.stringify(manifest, null, 2));
  }

  /**
   * Add entry to manifest
   */
  private async addToManifest(entry: BackupEntry): Promise<void> {
    const manifest = await this.loadManifest();
    manifest.backups.push(entry);
    await this.saveManifest(manifest);
  }

  /**
   * Copy directory recursively (excluding node_modules and .git)
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });

    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      // Skip node_modules and .git
      if (entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}
