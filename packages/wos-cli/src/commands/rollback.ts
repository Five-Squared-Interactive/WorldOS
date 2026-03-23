/**
 * Rollback Command
 *
 * Story 4.8: Installation Rollback
 *
 * Rolls back a plugin to a previous backup.
 */

import { Command, Args, Flags } from '@oclif/core';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Backup entry
 */
interface BackupEntry {
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

export default class Rollback extends Command {
  static override description = 'Rollback a plugin to a previous backup';

  static override examples = [
    '<%= config.bin %> rollback --list',
    '<%= config.bin %> rollback my-plugin',
    '<%= config.bin %> rollback my-plugin --id abc123',
    '<%= config.bin %> rollback --list --json',
  ];

  static override args = {
    plugin: Args.string({
      description: 'Plugin name to rollback',
      required: false,
    }),
  };

  static override flags = {
    directory: Flags.string({
      char: 'd',
      description: 'Server directory (default: current directory)',
      default: process.cwd(),
    }),
    list: Flags.boolean({
      char: 'l',
      description: 'List available backups',
      default: false,
    }),
    id: Flags.string({
      description: 'Specific backup ID to restore',
    }),
    json: Flags.boolean({
      description: 'Output in JSON format',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Rollback);
    const serverDir = path.resolve(flags.directory);
    const wosYamlPath = path.join(serverDir, 'wos.yaml');
    const backupsDir = path.join(serverDir, '.wos-backups');
    const manifestPath = path.join(backupsDir, 'manifest.json');

    // Check if server is initialized
    const serverExists = await fs.access(wosYamlPath).then(() => true).catch(() => false);
    if (!serverExists) {
      this.error(`WorldOS not initialized in ${serverDir}. Run 'wos init' first.`, { exit: 1 });
      return;
    }

    // Load backup manifest
    const manifest = await this.loadManifest(manifestPath);

    // List mode
    if (flags.list) {
      this.listBackups(manifest, args.plugin, flags.json);
      return;
    }

    // Rollback mode requires plugin name
    if (!args.plugin) {
      this.error('Plugin name required for rollback. Use --list to see available backups.', { exit: 1 });
      return;
    }

    // Find backup to restore
    let backup: BackupEntry | undefined;

    if (flags.id) {
      backup = manifest.backups.find(b => b.id === flags.id);
      if (!backup) {
        this.error(`Backup '${flags.id}' not found.`, { exit: 1 });
        return;
      }
    } else {
      // Get latest backup for plugin
      const pluginBackups = manifest.backups
        .filter(b => b.pluginName === args.plugin)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      if (pluginBackups.length === 0) {
        this.error(`No backups found for plugin '${args.plugin}'.`, { exit: 1 });
        return;
      }

      backup = pluginBackups[0];
    }

    // Perform rollback
    await this.performRollback(serverDir, backup);

    // Output result
    if (flags.json) {
      this.log(JSON.stringify({
        status: 'restored',
        plugin: backup.pluginName,
        backupId: backup.id,
        version: backup.version,
        timestamp: backup.timestamp,
      }, null, 2));
    } else {
      this.log(`Restored plugin '${backup.pluginName}' from backup`);
      this.log(`  Backup ID: ${backup.id}`);
      this.log(`  Backup Date: ${new Date(backup.timestamp).toLocaleString()}`);
      if (backup.version) {
        this.log(`  Version: ${backup.version}`);
      }
      this.log(`  Reason: ${backup.reason}`);
    }
  }

  /**
   * Load backup manifest
   */
  private async loadManifest(manifestPath: string): Promise<BackupManifest> {
    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return { version: 1, backups: [] };
    }
  }

  /**
   * List available backups
   */
  private listBackups(manifest: BackupManifest, pluginName: string | undefined, json: boolean): void {
    let backups = manifest.backups;

    if (pluginName) {
      backups = backups.filter(b => b.pluginName === pluginName);
    }

    // Sort by timestamp descending
    backups.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (json) {
      this.log(JSON.stringify({ backups }, null, 2));
      return;
    }

    if (backups.length === 0) {
      this.log('No backups available.');
      this.log('');
      this.log('Backups are created automatically before plugin upgrades.');
      return;
    }

    this.log('Available Backups:');
    this.log('');

    // Table header
    const idWidth = 18;
    const pluginWidth = Math.max(12, ...backups.map(b => b.pluginName.length)) + 2;
    const versionWidth = 10;
    const dateWidth = 20;

    this.log([
      'ID'.padEnd(idWidth),
      'Plugin'.padEnd(pluginWidth),
      'Version'.padEnd(versionWidth),
      'Date'.padEnd(dateWidth),
      'Reason',
    ].join('  '));
    this.log('-'.repeat(idWidth + pluginWidth + versionWidth + dateWidth + 30));

    for (const backup of backups) {
      const date = new Date(backup.timestamp).toLocaleString();
      this.log([
        backup.id.padEnd(idWidth),
        backup.pluginName.padEnd(pluginWidth),
        (backup.version ?? 'unknown').padEnd(versionWidth),
        date.padEnd(dateWidth),
        backup.reason,
      ].join('  '));
    }

    this.log('');
    this.log(`Total: ${backups.length} backup(s)`);
  }

  /**
   * Perform the rollback
   */
  private async performRollback(serverDir: string, backup: BackupEntry): Promise<void> {
    const pluginDir = path.join(serverDir, 'plugins', backup.pluginName);

    // Verify backup exists
    const backupExists = await fs.access(backup.backupPath).then(() => true).catch(() => false);
    if (!backupExists) {
      throw new Error(`Backup directory not found: ${backup.backupPath}`);
    }

    // Remove current plugin if exists
    const pluginExists = await fs.access(pluginDir).then(() => true).catch(() => false);
    if (pluginExists) {
      await fs.rm(pluginDir, { recursive: true, force: true });
    }

    // Ensure plugins directory exists
    await fs.mkdir(path.dirname(pluginDir), { recursive: true });

    // Copy backup to plugin directory
    await this.copyDirectory(backup.backupPath, pluginDir);
  }

  /**
   * Copy directory recursively
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });

    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}
