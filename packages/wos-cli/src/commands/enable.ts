/**
 * Enable Command
 *
 * Story 4.5: wos enable/disable Commands
 *
 * Enables one or more disabled plugins.
 */

import { Command, Flags } from '@oclif/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';

export default class Enable extends Command {
  static override description = 'Enable one or more plugins';

  static override examples = [
    '<%= config.bin %> enable my-plugin',
    '<%= config.bin %> enable plugin-a plugin-b',
    '<%= config.bin %> enable my-plugin --json',
  ];

  // Allow multiple arguments (variadic)
  static override strict = false;

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
  };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(Enable);
    const pluginNames = argv as string[];
    const serverDir = path.resolve(flags.directory);
    const wosYamlPath = path.join(serverDir, 'wos.yaml');

    // Check if plugin names were provided
    if (pluginNames.length === 0) {
      this.error('Plugin name(s) required. Usage: wos enable <plugin> [plugin2...]', { exit: 1 });
      return;
    }

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
    const plugins = config.plugins as Record<string, unknown> | undefined;
    if (!plugins) {
      this.error('No plugins installed.', { exit: 1 });
      return;
    }

    const enabled: string[] = [];
    const alreadyEnabled: string[] = [];
    const notFound: string[] = [];

    for (const name of pluginNames) {
      if (!plugins[name]) {
        notFound.push(name);
        continue;
      }

      const pluginEntry = plugins[name] as Record<string, unknown>;

      if (pluginEntry.enabled === true) {
        alreadyEnabled.push(name);
      } else {
        pluginEntry.enabled = true;
        enabled.push(name);
      }
    }

    // Handle errors first
    if (notFound.length > 0) {
      this.error(`Plugin(s) not found: ${notFound.join(', ')}`, { exit: 1 });
      return;
    }

    // Save config if any changes were made
    if (enabled.length > 0) {
      await fs.writeFile(wosYamlPath, yaml.stringify(config), 'utf-8');
    }

    // Output results
    if (flags.json) {
      this.log(JSON.stringify({
        enabled,
        alreadyEnabled,
      }, null, 2));
      return;
    }

    if (enabled.length > 0) {
      this.log(`Enabled: ${enabled.join(', ')}`);
    }

    if (alreadyEnabled.length > 0) {
      this.log(`Already enabled: ${alreadyEnabled.join(', ')}`);
    }
  }
}
