/**
 * Manifest Validator
 *
 * Story 4.7: Manifest Validation
 *
 * Validates wos-plugin.yaml manifests against the schema,
 * checking required fields, types, and file existence.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Validation error
 */
export interface ValidationError {
  field: string;
  message: string;
  suggestion?: string;
}

/**
 * Validation warning (non-fatal)
 */
export interface ValidationWarning {
  field: string;
  message: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/**
 * Plugin manifest structure
 */
export interface PluginManifest {
  name: string;
  version: string;
  runtime: string;
  entrypoint: string;
  description?: string;
  dependencies?: string[];
  cli?: {
    commands?: Array<{
      name: string;
      handler: string;
      description?: string;
      flags?: Array<{
        name: string;
        type: string;
        description?: string;
      }>;
    }>;
  };
  admin?: {
    panels?: Array<{
      name: string;
      component: string;
    }>;
    cards?: Array<{
      component: string;
    }>;
  };
  mqtt?: {
    subscriptions?: string[];
    publications?: string[];
  };
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
 * Plugin name regex (npm-style)
 */
const NAME_REGEX = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/**
 * Semver regex (simplified)
 */
const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;

/**
 * Validates plugin manifests
 */
export class ManifestValidator {
  /**
   * Validate manifest structure (no file checks)
   */
  validate(manifest: unknown): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    if (!manifest || typeof manifest !== 'object') {
      errors.push({
        field: 'manifest',
        message: 'Manifest must be an object',
      });
      return { valid: false, errors, warnings };
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

    // Version format (warning only)
    if (typeof m.version === 'string' && !SEMVER_REGEX.test(m.version)) {
      warnings.push({
        field: 'version',
        message: 'Version does not follow semver format (e.g., 1.0.0)',
      });
    }

    // Runtime validation
    if (typeof m.runtime === 'string') {
      if (!VALID_RUNTIMES.includes(m.runtime)) {
        const suggestion = RUNTIME_SUGGESTIONS[m.runtime.toLowerCase()];
        errors.push({
          field: 'runtime',
          message: `Invalid runtime '${m.runtime}'. Must be one of: ${VALID_RUNTIMES.join(', ')}`,
          suggestion: suggestion ? `Did you mean '${suggestion}'?` : undefined,
        });
      }
    }

    // Dependencies
    if (m.dependencies !== undefined) {
      if (!Array.isArray(m.dependencies)) {
        errors.push({
          field: 'dependencies',
          message: 'Dependencies must be an array of plugin names',
        });
      }
    }

    // CLI commands
    if (m.cli !== undefined) {
      this.validateCli(m.cli, errors);
    }

    // Admin panels
    if (m.admin !== undefined) {
      this.validateAdmin(m.admin, errors);
    }

    // MQTT topics
    if (m.mqtt !== undefined) {
      this.validateMqtt(m.mqtt, errors);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate manifest with file existence checks
   */
  async validateWithFiles(manifest: unknown, pluginDir: string): Promise<ValidationResult> {
    // First do structural validation
    const result = this.validate(manifest);

    if (!manifest || typeof manifest !== 'object') {
      return result;
    }

    const m = manifest as Record<string, unknown>;

    // Check entrypoint exists
    if (typeof m.entrypoint === 'string') {
      const entrypointPath = path.join(pluginDir, m.entrypoint);
      const exists = await this.fileExists(entrypointPath);
      if (!exists) {
        result.errors.push({
          field: 'entrypoint',
          message: `Entrypoint file not found: ${m.entrypoint}`,
        });
      }
    }

    // Check CLI handler files
    if (m.cli && typeof m.cli === 'object') {
      const cli = m.cli as Record<string, unknown>;
      if (Array.isArray(cli.commands)) {
        for (let i = 0; i < cli.commands.length; i++) {
          const cmd = cli.commands[i] as Record<string, unknown>;
          if (typeof cmd.handler === 'string') {
            const handlerPath = path.join(pluginDir, cmd.handler);
            const exists = await this.fileExists(handlerPath);
            if (!exists) {
              result.errors.push({
                field: `cli.commands[${i}].handler`,
                message: `Handler file not found: ${cmd.handler}`,
              });
            }
          }
        }
      }
    }

    // Check admin component files
    if (m.admin && typeof m.admin === 'object') {
      const admin = m.admin as Record<string, unknown>;
      if (Array.isArray(admin.panels)) {
        for (let i = 0; i < admin.panels.length; i++) {
          const panel = admin.panels[i] as Record<string, unknown>;
          if (typeof panel.component === 'string') {
            const componentPath = path.join(pluginDir, panel.component);
            const exists = await this.fileExists(componentPath);
            if (!exists) {
              result.errors.push({
                field: `admin.panels[${i}].component`,
                message: `Component file not found: ${panel.component}`,
              });
            }
          }
        }
      }
    }

    result.valid = result.errors.length === 0;
    return result;
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
  private validateCli(cli: unknown, errors: ValidationError[]): void {
    if (typeof cli !== 'object' || cli === null) {
      errors.push({
        field: 'cli',
        message: 'CLI section must be an object',
      });
      return;
    }

    const cliObj = cli as Record<string, unknown>;

    if (cliObj.commands !== undefined) {
      if (!Array.isArray(cliObj.commands)) {
        errors.push({
          field: 'cli.commands',
          message: 'CLI commands must be an array',
        });
      } else {
        cliObj.commands.forEach((cmd, i) => {
          if (typeof cmd !== 'object' || cmd === null) {
            errors.push({
              field: `cli.commands[${i}]`,
              message: 'Command must be an object',
            });
            return;
          }

          const cmdObj = cmd as Record<string, unknown>;

          if (!cmdObj.name || typeof cmdObj.name !== 'string') {
            errors.push({
              field: `cli.commands[${i}].name`,
              message: 'Command name is required',
            });
          }

          if (!cmdObj.handler || typeof cmdObj.handler !== 'string') {
            errors.push({
              field: `cli.commands[${i}].handler`,
              message: 'Command handler is required',
            });
          }
        });
      }
    }
  }

  /**
   * Validate admin section
   */
  private validateAdmin(admin: unknown, errors: ValidationError[]): void {
    if (typeof admin !== 'object' || admin === null) {
      errors.push({
        field: 'admin',
        message: 'Admin section must be an object',
      });
      return;
    }

    const adminObj = admin as Record<string, unknown>;

    if (adminObj.panels !== undefined && !Array.isArray(adminObj.panels)) {
      errors.push({
        field: 'admin.panels',
        message: 'Admin panels must be an array',
      });
    }

    if (adminObj.cards !== undefined && !Array.isArray(adminObj.cards)) {
      errors.push({
        field: 'admin.cards',
        message: 'Admin cards must be an array',
      });
    }
  }

  /**
   * Validate MQTT section
   */
  private validateMqtt(mqtt: unknown, errors: ValidationError[]): void {
    if (typeof mqtt !== 'object' || mqtt === null) {
      errors.push({
        field: 'mqtt',
        message: 'MQTT section must be an object',
      });
      return;
    }

    const mqttObj = mqtt as Record<string, unknown>;

    if (mqttObj.subscriptions !== undefined && !Array.isArray(mqttObj.subscriptions)) {
      errors.push({
        field: 'mqtt.subscriptions',
        message: 'MQTT subscriptions must be an array of topic patterns',
      });
    }

    if (mqttObj.publications !== undefined && !Array.isArray(mqttObj.publications)) {
      errors.push({
        field: 'mqtt.publications',
        message: 'MQTT publications must be an array of topic patterns',
      });
    }
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
