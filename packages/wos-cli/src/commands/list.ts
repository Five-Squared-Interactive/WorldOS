/**
 * List Command
 *
 * Story 4.4: wos list Command
 *
 * Lists all installed plugins with their status.
 */

import { Command, Flags } from '@oclif/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';

/**
 * Plugin entry from wos.yaml
 */
interface PluginEntry {
  name: string;
  version: string;
  enabled: boolean;
  source: string;
  description?: string;
  installedAt?: string;
}

/**
 * Plugin manifest
 */
interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  runtime?: string;
}

export default class List extends Command {
  static override description = 'List all installed plugins with their status';

  static override examples = [
    '<%= config.bin %> list',
    '<%= config.bin %> list --json',
    '<%= config.bin %> list --enabled',
    '<%= config.bin %> list --disabled',
  ];

  static override flags = {
    directory: Flags.string({
      char: 'd',
      description: 'Server directory (default: current directory)',
      default: process.cwd(),
    }),
    json: Flags.boolean({
      description: 'Output in JSON format',
      default: false,
    }),
    enabled: Flags.boolean({
      description: 'Show only enabled plugins',
      default: false,
    }),
    disabled: Flags.boolean({
      description: 'Show only disabled plugins',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(List);
    const serverDir = path.resolve(flags.directory);
    const wosYamlPath = path.join(serverDir, 'wos.yaml');
    const pluginsDir = path.join(serverDir, 'plugins');

    // Check if server is initialized
    const serverExists = await fs.access(wosYamlPath).then(() => true).catch(() => false);
    if (!serverExists) {
      this.error(`WorldOS not initialized in ${serverDir}. Run 'wos init' first.`, { exit: 1 });
      return;
    }

    // Load wos.yaml
    const wosYamlContent = await fs.readFile(wosYamlPath, 'utf-8');
    const config = yaml.parse(wosYamlContent) ?? {};

    // Get plugins from config
    const pluginsConfig = config.plugins as Record<string, unknown> | undefined;
    let plugins: PluginEntry[] = [];

    if (pluginsConfig && typeof pluginsConfig === 'object') {
      for (const [name, data] of Object.entries(pluginsConfig)) {
        if (data && typeof data === 'object') {
          const entry = data as Record<string, unknown>;
          const plugin: PluginEntry = {
            name,
            version: (entry.version as string) ?? 'unknown',
            enabled: Boolean(entry.enabled),
            source: (entry.source as string) ?? '',
            installedAt: entry.installedAt as string | undefined,
          };

          // Try to get description from manifest
          const manifest = await this.loadManifest(pluginsDir, name);
          if (manifest?.description) {
            plugin.description = manifest.description;
          }

          plugins.push(plugin);
        }
      }
    }

    // Apply filters
    if (flags.enabled) {
      plugins = plugins.filter(p => p.enabled);
    }
    if (flags.disabled) {
      plugins = plugins.filter(p => !p.enabled);
    }

    // Output results
    if (flags.json) {
      this.log(JSON.stringify(plugins, null, 2));
      return;
    }

    if (plugins.length === 0) {
      this.log('No plugins installed.');
      this.log('');
      this.log('To install a plugin, run:');
      this.log('  wos add ./path/to/plugin');
      return;
    }

    // Table output
    this.log('');
    this.log('Installed Plugins:');
    this.log('');

    // Calculate column widths
    const nameWidth = Math.max(10, ...plugins.map(p => p.name.length)) + 2;
    const versionWidth = Math.max(7, ...plugins.map(p => p.version.length)) + 2;
    const statusWidth = 10;

    // Header
    const header = [
      'Name'.padEnd(nameWidth),
      'Version'.padEnd(versionWidth),
      'Status'.padEnd(statusWidth),
      'Description',
    ].join('  ');
    this.log(header);
    this.log('-'.repeat(header.length + 20));

    // Rows
    for (const plugin of plugins) {
      const status = plugin.enabled ? 'Enabled' : 'Disabled';
      const row = [
        plugin.name.padEnd(nameWidth),
        plugin.version.padEnd(versionWidth),
        status.padEnd(statusWidth),
        plugin.description ?? '',
      ].join('  ');
      this.log(row);
    }

    this.log('');
    this.log(`Total: ${plugins.length} plugin(s)`);
  }

  /**
   * Load plugin manifest from directory
   */
  private async loadManifest(pluginsDir: string, name: string): Promise<PluginManifest | null> {
    const manifestPath = path.join(pluginsDir, name, 'wos-plugin.yaml');

    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      return yaml.parse(content) as PluginManifest;
    } catch {
      return null;
    }
  }
}
