/**
 * Validate Command
 *
 * Story 4.7: Manifest Validation
 *
 * Validates a plugin's wos-plugin.yaml manifest.
 */

import { Command, Flags } from '@oclif/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';

/**
 * Validation error
 */
interface ValidationError {
  field: string;
  message: string;
  suggestion?: string;
}

/**
 * Validation warning
 */
interface ValidationWarning {
  field: string;
  message: string;
}

/**
 * Valid runtime types
 */
const VALID_RUNTIMES = ['node', 'python', 'binary', 'docker'];

/**
 * Runtime typo suggestions
 */
const RUNTIME_SUGGESTIONS: Record<string, string> = {
  nodejs: 'node',
  'node.js': 'node',
  py: 'python',
  python3: 'python',
  bin: 'binary',
  exe: 'binary',
  container: 'docker',
};

/**
 * Plugin name regex
 */
const NAME_REGEX = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/**
 * Semver regex
 */
const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;

export default class Validate extends Command {
  static override description = 'Validate a plugin manifest (wos-plugin.yaml)';

  static override examples = [
    '<%= config.bin %> validate',
    '<%= config.bin %> validate --directory ./my-plugin',
    '<%= config.bin %> validate --json',
  ];

  static override flags = {
    directory: Flags.string({
      char: 'd',
      description: 'Plugin directory (default: current directory)',
      default: process.cwd(),
    }),
    json: Flags.boolean({
      description: 'Output in JSON format',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Validate);
    const pluginDir = path.resolve(flags.directory);
    const manifestPath = path.join(pluginDir, 'wos-plugin.yaml');

    // Check if manifest exists
    const manifestExists = await fs.access(manifestPath).then(() => true).catch(() => false);
    if (!manifestExists) {
      this.error(`Manifest not found: ${manifestPath}`, { exit: 1 });
      return;
    }

    // Load manifest
    let manifest: unknown;
    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      manifest = yaml.parse(content);
    } catch (e) {
      this.error(`Invalid YAML in manifest: ${(e as Error).message}`, { exit: 1 });
      return;
    }

    // Validate
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    await this.validateManifest(manifest, pluginDir, errors, warnings);

    const valid = errors.length === 0;

    // Output results
    if (flags.json) {
      this.log(JSON.stringify({
        valid,
        errors,
        warnings,
        manifest,
      }, null, 2));
      return;
    }

    if (valid) {
      this.log('Manifest validation: PASSED');
      if (warnings.length > 0) {
        this.log('');
        this.log('Warnings:');
        for (const warning of warnings) {
          this.log(`  - ${warning.field}: ${warning.message}`);
        }
      }
    } else {
      this.log('Manifest validation: FAILED');
      this.log('');
      this.log('Errors:');
      for (const error of errors) {
        this.log(`  - ${error.field}: ${error.message}`);
        if (error.suggestion) {
          this.log(`    Suggestion: ${error.suggestion}`);
        }
      }
      if (warnings.length > 0) {
        this.log('');
        this.log('Warnings:');
        for (const warning of warnings) {
          this.log(`  - ${warning.field}: ${warning.message}`);
        }
      }
    }
  }

  /**
   * Validate manifest structure and files
   */
  private async validateManifest(
    manifest: unknown,
    pluginDir: string,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): Promise<void> {
    if (!manifest || typeof manifest !== 'object') {
      errors.push({
        field: 'manifest',
        message: 'Manifest must be an object',
      });
      return;
    }

    const m = manifest as Record<string, unknown>;

    // Required fields
    this.validateRequiredString(m, 'name', errors);
    this.validateRequiredString(m, 'version', errors);
    this.validateRequiredString(m, 'runtime', errors);
    this.validateRequiredString(m, 'entrypoint', errors);

    // Name format
    if (typeof m.name === 'string' && !NAME_REGEX.test(m.name)) {
      errors.push({
        field: 'name',
        message: 'Invalid plugin name format. Use lowercase letters, numbers, and hyphens.',
        suggestion: m.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      });
    }

    // Version format (warning)
    if (typeof m.version === 'string' && !SEMVER_REGEX.test(m.version)) {
      warnings.push({
        field: 'version',
        message: 'Version does not follow semver format (e.g., 1.0.0)',
      });
    }

    // Runtime validation
    if (typeof m.runtime === 'string' && !VALID_RUNTIMES.includes(m.runtime)) {
      const suggestion = RUNTIME_SUGGESTIONS[m.runtime.toLowerCase()];
      errors.push({
        field: 'runtime',
        message: `Invalid runtime '${m.runtime}'. Must be one of: ${VALID_RUNTIMES.join(', ')}`,
        suggestion: suggestion ? `Did you mean '${suggestion}'?` : undefined,
      });
    }

    // Check entrypoint file exists
    if (typeof m.entrypoint === 'string') {
      const entrypointPath = path.join(pluginDir, m.entrypoint);
      const exists = await fs.access(entrypointPath).then(() => true).catch(() => false);
      if (!exists) {
        errors.push({
          field: 'entrypoint',
          message: `Entrypoint file not found: ${m.entrypoint}`,
        });
      }
    }

    // CLI commands
    if (m.cli && typeof m.cli === 'object') {
      await this.validateCli(m.cli as Record<string, unknown>, pluginDir, errors);
    }

    // Dependencies
    if (m.dependencies !== undefined && !Array.isArray(m.dependencies)) {
      errors.push({
        field: 'dependencies',
        message: 'Dependencies must be an array of plugin names',
      });
    }

    // MQTT topics
    if (m.mqtt && typeof m.mqtt === 'object') {
      this.validateMqtt(m.mqtt as Record<string, unknown>, errors);
    }
  }

  /**
   * Validate required string field
   */
  private validateRequiredString(
    obj: Record<string, unknown>,
    field: string,
    errors: ValidationError[]
  ): void {
    const value = obj[field];

    if (value === undefined || value === null || value === '') {
      errors.push({
        field,
        message: `'${field}' is required`,
      });
    } else if (typeof value !== 'string') {
      errors.push({
        field,
        message: `'${field}' must be a string`,
      });
    }
  }

  /**
   * Validate CLI section
   */
  private async validateCli(
    cli: Record<string, unknown>,
    pluginDir: string,
    errors: ValidationError[]
  ): Promise<void> {
    if (cli.commands !== undefined) {
      if (!Array.isArray(cli.commands)) {
        errors.push({
          field: 'cli.commands',
          message: 'CLI commands must be an array',
        });
        return;
      }

      for (let i = 0; i < cli.commands.length; i++) {
        const cmd = cli.commands[i] as Record<string, unknown>;

        if (!cmd.name || typeof cmd.name !== 'string') {
          errors.push({
            field: `cli.commands[${i}].name`,
            message: 'Command name is required',
          });
        }

        if (!cmd.handler || typeof cmd.handler !== 'string') {
          errors.push({
            field: `cli.commands[${i}].handler`,
            message: 'Command handler is required',
          });
        } else {
          // Check handler file exists
          const handlerPath = path.join(pluginDir, cmd.handler);
          const exists = await fs.access(handlerPath).then(() => true).catch(() => false);
          if (!exists) {
            errors.push({
              field: `cli.commands[${i}].handler`,
              message: `Handler file not found: ${cmd.handler}`,
            });
          }
        }
      }
    }
  }

  /**
   * Validate MQTT section
   */
  private validateMqtt(mqtt: Record<string, unknown>, errors: ValidationError[]): void {
    if (mqtt.subscriptions !== undefined && !Array.isArray(mqtt.subscriptions)) {
      errors.push({
        field: 'mqtt.subscriptions',
        message: 'MQTT subscriptions must be an array of topic patterns',
      });
    }

    if (mqtt.publications !== undefined && !Array.isArray(mqtt.publications)) {
      errors.push({
        field: 'mqtt.publications',
        message: 'MQTT publications must be an array of topic patterns',
      });
    }
  }
}
