/**
 * Config Command
 *
 * Story 5.1: wos config get Command
 * Story 5.2: wos config set Command
 * Story 5.4: wos config reset Command
 *
 * View, set, and reset plugin configuration.
 */

import { Command, Args, Flags } from '@oclif/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';

export default class Config extends Command {
  static override description = 'View, set, or reset plugin configuration';

  static override examples = [
    '<%= config.bin %> config my-plugin',
    '<%= config.bin %> config my-plugin port',
    '<%= config.bin %> config my-plugin port 3000',
    '<%= config.bin %> config my-plugin storage.backend sqlite',
    '<%= config.bin %> config my-plugin --json',
    '<%= config.bin %> config my-plugin --reset --yes',
    '<%= config.bin %> config my-plugin port --reset --yes',
  ];

  static override args = {
    plugin: Args.string({
      description: 'Plugin name',
      required: true,
    }),
    key: Args.string({
      description: 'Configuration key (supports dot notation for nested keys)',
      required: false,
    }),
    value: Args.string({
      description: 'Value to set (if setting a config value)',
      required: false,
    }),
  };

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
    reset: Flags.boolean({
      char: 'r',
      description: 'Reset configuration to defaults',
      default: false,
    }),
    yes: Flags.boolean({
      char: 'y',
      description: 'Skip confirmation prompts',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Config);
    const serverDir = path.resolve(flags.directory);
    const wosYamlPath = path.join(serverDir, 'wos.yaml');

    // Check if server is initialized
    const serverExists = await fs.access(wosYamlPath).then(() => true).catch(() => false);
    if (!serverExists) {
      this.error(`WorldOS not initialized in ${serverDir}. Run 'wos init' first.`, { exit: 1 });
      return;
    }

    // Load wos.yaml
    const wosYamlContent = await fs.readFile(wosYamlPath, 'utf-8');
    const config = yaml.parse(wosYamlContent) ?? {};

    // Check if plugin exists
    const plugins = config.plugins as Record<string, unknown> | undefined;
    if (!plugins || !plugins[args.plugin]) {
      this.error(`Plugin '${args.plugin}' is not installed.`, { exit: 1 });
      return;
    }

    const pluginEntry = plugins[args.plugin] as Record<string, unknown>;
    const pluginConfig = (pluginEntry.config as Record<string, unknown>) ?? {};

    // Handle reset
    if (flags.reset) {
      await this.handleReset(args, flags, config, wosYamlPath, pluginEntry);
      return;
    }

    // Handle set (if value is provided)
    if (args.value !== undefined) {
      await this.handleSet(args, config, wosYamlPath, pluginEntry);
      return;
    }

    // Handle get
    await this.handleGet(args, flags, pluginConfig);
  }

  /**
   * Handle get operation
   */
  private async handleGet(
    args: { plugin: string; key?: string },
    flags: { json: boolean },
    pluginConfig: Record<string, unknown>
  ): Promise<void> {
    // Get specific key
    if (args.key) {
      const value = this.getNestedValue(pluginConfig, args.key);

      if (value === undefined) {
        this.error(`Configuration key '${args.key}' not found for plugin '${args.plugin}'.`, { exit: 1 });
        return;
      }

      if (flags.json) {
        this.log(JSON.stringify({ [args.key]: value }, null, 2));
      } else {
        this.log(`${args.key}: ${this.formatValue(value)}`);
      }
      return;
    }

    // Get all config
    if (Object.keys(pluginConfig).length === 0) {
      if (flags.json) {
        this.log(JSON.stringify({}, null, 2));
      } else {
        this.log(`No custom configuration for '${args.plugin}'.`);
        this.log('Using default values from plugin manifest.');
      }
      return;
    }

    if (flags.json) {
      this.log(JSON.stringify(pluginConfig, null, 2));
    } else {
      this.log(`Configuration for '${args.plugin}':`);
      this.log('');
      this.printConfig(pluginConfig, '');
    }
  }

  /**
   * Handle set operation
   */
  private async handleSet(
    args: { plugin: string; key?: string; value?: string },
    config: Record<string, unknown>,
    wosYamlPath: string,
    pluginEntry: Record<string, unknown>
  ): Promise<void> {
    if (!args.key) {
      this.error('Key is required when setting a value.', { exit: 1 });
      return;
    }

    // Parse value with type inference
    const parsedValue = this.parseValue(args.value!);

    // Ensure config object exists
    if (!pluginEntry.config) {
      pluginEntry.config = {};
    }

    const pluginConfig = pluginEntry.config as Record<string, unknown>;

    // Set nested value
    this.setNestedValue(pluginConfig, args.key, parsedValue);

    // Save config
    await fs.writeFile(wosYamlPath, yaml.stringify(config), 'utf-8');

    this.log(`Set ${args.plugin}.${args.key} = ${this.formatValue(parsedValue)}`);
  }

  /**
   * Handle reset operation
   */
  private async handleReset(
    args: { plugin: string; key?: string },
    flags: { yes: boolean },
    config: Record<string, unknown>,
    wosYamlPath: string,
    pluginEntry: Record<string, unknown>
  ): Promise<void> {
    const pluginConfig = pluginEntry.config as Record<string, unknown> | undefined;

    if (!pluginConfig || Object.keys(pluginConfig).length === 0) {
      this.log(`No custom configuration to reset for '${args.plugin}'.`);
      return;
    }

    if (args.key) {
      // Reset specific key
      const value = this.getNestedValue(pluginConfig, args.key);
      if (value === undefined) {
        this.log(`Key '${args.key}' not found in configuration.`);
        return;
      }

      this.deleteNestedValue(pluginConfig, args.key);

      // Clean up empty parent objects
      this.cleanupEmptyObjects(pluginConfig);

      await fs.writeFile(wosYamlPath, yaml.stringify(config), 'utf-8');
      this.log(`Reset ${args.plugin}.${args.key} to default.`);
    } else {
      // Reset all config
      delete pluginEntry.config;

      await fs.writeFile(wosYamlPath, yaml.stringify(config), 'utf-8');
      this.log(`Reset all configuration for '${args.plugin}' to defaults.`);
    }
  }

  /**
   * Get nested value using dot notation
   */
  private getNestedValue(obj: Record<string, unknown>, key: string): unknown {
    const parts = key.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Set nested value using dot notation
   */
  private setNestedValue(obj: Record<string, unknown>, key: string, value: unknown): void {
    const parts = key.split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current[part] || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }

  /**
   * Delete nested value using dot notation
   */
  private deleteNestedValue(obj: Record<string, unknown>, key: string): void {
    const parts = key.split('.');

    if (parts.length === 1) {
      delete obj[key];
      return;
    }

    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current[part] || typeof current[part] !== 'object') {
        return;
      }
      current = current[part] as Record<string, unknown>;
    }

    delete current[parts[parts.length - 1]];
  }

  /**
   * Clean up empty objects after deletion
   */
  private cleanupEmptyObjects(obj: Record<string, unknown>): void {
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        this.cleanupEmptyObjects(value as Record<string, unknown>);
        if (Object.keys(value as object).length === 0) {
          delete obj[key];
        }
      }
    }
  }

  /**
   * Parse value with type inference
   */
  private parseValue(value: string): unknown {
    // Boolean
    if (value === 'true') return true;
    if (value === 'false') return false;

    // Null
    if (value === 'null') return null;

    // Number
    const num = Number(value);
    if (!isNaN(num) && value.trim() !== '') {
      return num;
    }

    // String
    return value;
  }

  /**
   * Format value for display
   */
  private formatValue(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    return JSON.stringify(value);
  }

  /**
   * Print config with indentation
   */
  private printConfig(obj: Record<string, unknown>, indent: string): void {
    for (const [key, value] of Object.entries(obj)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        this.log(`${indent}${key}:`);
        this.printConfig(value as Record<string, unknown>, indent + '  ');
      } else {
        this.log(`${indent}${key}: ${this.formatValue(value)}`);
      }
    }
  }
}
