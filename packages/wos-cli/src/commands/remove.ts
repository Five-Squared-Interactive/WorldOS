/**
 * Remove Command
 *
 * Story 4.3: wos remove Command
 *
 * Removes (uninstalls) a plugin from the WorldOS server.
 */

import { Command, Args, Flags } from '@oclif/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';

/**
 * Plugin manifest structure (minimal for dependency checking)
 */
interface PluginManifest {
  name: string;
  version: string;
  dependencies?: string[];
}

export default class Remove extends Command {
  static override description = 'Remove (uninstall) a plugin from the WorldOS server';

  static override examples = [
    '<%= config.bin %> remove my-plugin',
    '<%= config.bin %> remove my-plugin --force',
    '<%= config.bin %> remove my-plugin --dry-run',
    '<%= config.bin %> remove my-plugin --json',
  ];

  static override args = {
    name: Args.string({
      description: 'Name of the plugin to remove',
      required: true,
    }),
  };

  static override flags = {
    directory: Flags.string({
      char: 'd',
      description: 'Server directory (default: current directory)',
      default: process.cwd(),
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Force removal even if other plugins depend on it',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output in JSON format',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would happen without making changes',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Remove);
    const serverDir = path.resolve(flags.directory);
    const wosYamlPath = path.join(serverDir, 'wos.yaml');
    const pluginsDir = path.join(serverDir, 'plugins');
    const pluginDir = path.join(pluginsDir, args.name);
    const dryRun = flags['dry-run'];

    // Check if server is initialized
    const serverExists = await fs.access(wosYamlPath).then(() => true).catch(() => false);
    if (!serverExists) {
      this.error(`WorldOS not initialized in ${serverDir}. Run 'wos init' first.`, { exit: 1 });
      return;
    }

    // Load wos.yaml
    const wosYamlContent = await fs.readFile(wosYamlPath, 'utf-8');
    const config = yaml.parse(wosYamlContent) ?? {};

    // Check if plugin is installed
    const plugins = config.plugins as Record<string, unknown> | undefined;
    if (!plugins || !plugins[args.name]) {
      this.error(`Plugin '${args.name}' is not installed.`, { exit: 1 });
      return;
    }

    const pluginEntry = plugins[args.name] as Record<string, unknown>;
    const pluginVersion = (pluginEntry.version as string) ?? 'unknown';
    const isEnabled = Boolean(pluginEntry.enabled);

    // Check for dependents
    const dependents = await this.findDependents(pluginsDir, args.name);
    if (dependents.length > 0 && !flags.force) {
      const dependentList = dependents.join(', ');
      this.error(
        `Cannot remove '${args.name}': other plugins depend on it (${dependentList}). Use --force to remove anyway.`,
        { exit: 1 }
      );
      return;
    }

    // Dry run mode
    if (dryRun) {
      if (flags.json) {
        this.log(JSON.stringify({
          dryRun: true,
          status: 'would-remove',
          plugin: {
            name: args.name,
            version: pluginVersion,
            enabled: isEnabled,
            path: pluginDir,
          },
          dependents: dependents.length > 0 ? dependents : undefined,
        }, null, 2));
      } else {
        this.log(`[Dry Run] Would remove plugin: ${args.name}@${pluginVersion}`);
        this.log(`  Directory: ${pluginDir}`);
        if (isEnabled) {
          this.log('  Note: Plugin is currently enabled');
        }
        if (dependents.length > 0) {
          this.log(`  Warning: Would break dependents: ${dependents.join(', ')}`);
        }
      }
      return;
    }

    // Warn if plugin is enabled (might be running)
    if (isEnabled && !flags.json) {
      this.warn(`Plugin '${args.name}' is enabled and may be running. It will be stopped.`);
    }

    // Remove plugin directory
    const pluginDirExists = await fs.access(pluginDir).then(() => true).catch(() => false);
    if (pluginDirExists) {
      await fs.rm(pluginDir, { recursive: true, force: true });
    }

    // Remove from wos.yaml
    delete plugins[args.name];
    await fs.writeFile(wosYamlPath, yaml.stringify(config), 'utf-8');

    // Output result
    if (flags.json) {
      this.log(JSON.stringify({
        status: 'removed',
        plugin: {
          name: args.name,
          version: pluginVersion,
        },
      }, null, 2));
    } else {
      this.log(`Removed plugin: ${args.name}@${pluginVersion}`);
      if (dependents.length > 0) {
        this.warn(`Note: The following plugins may no longer work: ${dependents.join(', ')}`);
      }
    }
  }

  /**
   * Find plugins that depend on the specified plugin
   */
  private async findDependents(pluginsDir: string, pluginName: string): Promise<string[]> {
    const dependents: string[] = [];

    // Check if plugins directory exists
    const pluginsDirExists = await fs.access(pluginsDir).then(() => true).catch(() => false);
    if (!pluginsDirExists) {
      return dependents;
    }

    // Scan all plugin directories
    const entries = await fs.readdir(pluginsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === pluginName) {
        continue;
      }

      const manifestPath = path.join(pluginsDir, entry.name, 'wos-plugin.yaml');
      const manifestExists = await fs.access(manifestPath).then(() => true).catch(() => false);

      if (manifestExists) {
        try {
          const manifestContent = await fs.readFile(manifestPath, 'utf-8');
          const manifest = yaml.parse(manifestContent) as PluginManifest;

          if (manifest.dependencies?.includes(pluginName)) {
            dependents.push(manifest.name || entry.name);
          }
        } catch {
          // Skip plugins with invalid manifests
        }
      }
    }

    return dependents;
  }
}
