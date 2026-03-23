/**
 * Disable Command
 *
 * Story 4.5: wos enable/disable Commands
 *
 * Disables one or more enabled plugins.
 */

import { Command, Flags } from '@oclif/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';

export default class Disable extends Command {
  static override description = 'Disable one or more plugins';

  static override examples = [
    '<%= config.bin %> disable my-plugin',
    '<%= config.bin %> disable plugin-a plugin-b',
    '<%= config.bin %> disable my-plugin --json',
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
    const { argv, flags } = await this.parse(Disable);
    const pluginNames = argv as string[];
    const serverDir = path.resolve(flags.directory);
    const wosYamlPath = path.join(serverDir, 'wos.yaml');

    // Check if plugin names were provided
    if (pluginNames.length === 0) {
      this.error('Plugin name(s) required. Usage: wos disable <plugin> [plugin2...]', { exit: 1 });
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

    const disabled: string[] = [];
    const alreadyDisabled: string[] = [];
    const notFound: string[] = [];

    for (const name of pluginNames) {
      if (!plugins[name]) {
        notFound.push(name);
        continue;
      }

      const pluginEntry = plugins[name] as Record<string, unknown>;

      if (pluginEntry.enabled !== true) {
        alreadyDisabled.push(name);
      } else {
        pluginEntry.enabled = false;
        disabled.push(name);
      }
    }

    // Handle errors first
    if (notFound.length > 0) {
      this.error(`Plugin(s) not found: ${notFound.join(', ')}`, { exit: 1 });
      return;
    }

    // Save config if any changes were made
    if (disabled.length > 0) {
      await fs.writeFile(wosYamlPath, yaml.stringify(config), 'utf-8');
    }

    // Output results
    if (flags.json) {
      this.log(JSON.stringify({
        disabled,
        alreadyDisabled,
      }, null, 2));
      return;
    }

    if (disabled.length > 0) {
      this.log(`Disabled: ${disabled.join(', ')}`);
    }

    if (alreadyDisabled.length > 0) {
      this.log(`Already disabled: ${alreadyDisabled.join(', ')}`);
    }
  }
}
