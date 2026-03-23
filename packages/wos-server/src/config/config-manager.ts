/**
 * Config Manager
 *
 * Story 5.3: Environment Variable Support
 * Story 5.5: Configuration Schema Validation
 *
 * Loads, validates, and manages plugin configuration with
 * environment variable overrides and schema validation.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';

/**
 * JSON Schema property definition
 */
export interface SchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  properties?: Record<string, SchemaProperty>;
  items?: SchemaProperty;
  required?: string[];
}

/**
 * Configuration schema (simplified JSON Schema)
 */
export interface ConfigSchema {
  type: 'object';
  properties?: Record<string, SchemaProperty>;
  required?: string[];
}

/**
 * Validation error
 */
export interface ConfigValidationError {
  field: string;
  message: string;
  value?: unknown;
}

/**
 * Validation result
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: ConfigValidationError[];
}

/**
 * Manages plugin configuration
 */
export class ConfigManager {
  private serverDir: string;
  private wosYamlPath: string;

  constructor(serverDir: string) {
    this.serverDir = serverDir;
    this.wosYamlPath = path.join(serverDir, 'wos.yaml');
  }

  /**
   * Load configuration for a plugin
   */
  async loadConfig(pluginName: string): Promise<Record<string, unknown>> {
    const wosConfig = await this.loadWosYaml();
    const plugins = wosConfig.plugins as Record<string, unknown> | undefined;

    if (!plugins || !plugins[pluginName]) {
      throw new Error(`Plugin '${pluginName}' not found`);
    }

    const pluginEntry = plugins[pluginName] as Record<string, unknown>;
    const baseConfig = (pluginEntry.config as Record<string, unknown>) ?? {};

    // Apply environment variable overrides
    const config = this.applyEnvOverrides(pluginName, { ...baseConfig });

    return config;
  }

  /**
   * Load configuration with defaults applied
   */
  async loadConfigWithDefaults(
    pluginName: string,
    schema: ConfigSchema
  ): Promise<Record<string, unknown>> {
    const config = await this.loadConfig(pluginName);
    return this.applyDefaults(config, schema);
  }

  /**
   * Save configuration for a plugin
   */
  async saveConfig(pluginName: string, config: Record<string, unknown>): Promise<void> {
    const wosConfig = await this.loadWosYaml();
    const plugins = wosConfig.plugins as Record<string, unknown> | undefined;

    if (!plugins || !plugins[pluginName]) {
      throw new Error(`Plugin '${pluginName}' not found`);
    }

    const pluginEntry = plugins[pluginName] as Record<string, unknown>;
    const existingConfig = (pluginEntry.config as Record<string, unknown>) ?? {};

    // Merge configs
    pluginEntry.config = { ...existingConfig, ...config };

    await this.saveWosYaml(wosConfig);
  }

  /**
   * Validate configuration against schema
   */
  async validateConfig(
    pluginName: string,
    schema: ConfigSchema
  ): Promise<ConfigValidationResult> {
    const config = await this.loadConfig(pluginName);
    return this.validateObject(config, schema, '');
  }

  /**
   * Apply environment variable overrides
   */
  private applyEnvOverrides(
    pluginName: string,
    config: Record<string, unknown>
  ): Record<string, unknown> {
    // Convert plugin name to env var prefix
    // e.g., "my-cool-plugin" -> "WOS_PLUGIN_MY_COOL_PLUGIN_"
    const prefix = `WOS_PLUGIN_${pluginName.toUpperCase().replace(/-/g, '_')}_`;

    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith(prefix) && value !== undefined) {
        const configKey = key.slice(prefix.length);
        const parsedValue = this.parseEnvValue(value);

        // Handle nested keys (double underscore = nesting)
        if (configKey.includes('__')) {
          const parts = configKey.toLowerCase().split('__');
          this.setNestedValue(config, parts, parsedValue);
        } else {
          config[configKey.toLowerCase()] = parsedValue;
        }
      }
    }

    return config;
  }

  /**
   * Parse environment variable value with type inference
   */
  private parseEnvValue(value: string): unknown {
    // Boolean
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;

    // Null
    if (value.toLowerCase() === 'null') return null;

    // Number
    const num = Number(value);
    if (!isNaN(num) && value.trim() !== '') {
      return num;
    }

    // JSON (for arrays/objects)
    if ((value.startsWith('[') && value.endsWith(']')) ||
        (value.startsWith('{') && value.endsWith('}'))) {
      try {
        return JSON.parse(value);
      } catch {
        // Fall through to string
      }
    }

    return value;
  }

  /**
   * Set nested value in config
   */
  private setNestedValue(
    obj: Record<string, unknown>,
    parts: string[],
    value: unknown
  ): void {
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
   * Apply schema defaults to config
   */
  private applyDefaults(
    config: Record<string, unknown>,
    schema: ConfigSchema
  ): Record<string, unknown> {
    if (!schema.properties) {
      return config;
    }

    const result = { ...config };

    for (const [key, prop] of Object.entries(schema.properties)) {
      if (result[key] === undefined && prop.default !== undefined) {
        result[key] = prop.default;
      } else if (prop.type === 'object' && prop.properties && result[key]) {
        result[key] = this.applyDefaults(
          result[key] as Record<string, unknown>,
          { type: 'object', properties: prop.properties }
        );
      }
    }

    return result;
  }

  /**
   * Validate object against schema
   */
  private validateObject(
    obj: Record<string, unknown>,
    schema: ConfigSchema,
    pathPrefix: string
  ): ConfigValidationResult {
    const errors: ConfigValidationError[] = [];

    // Check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (obj[field] === undefined) {
          errors.push({
            field: pathPrefix ? `${pathPrefix}.${field}` : field,
            message: `'${field}' is required`,
          });
        }
      }
    }

    // Validate properties
    if (schema.properties) {
      for (const [key, prop] of Object.entries(schema.properties)) {
        const value = obj[key];
        const fieldPath = pathPrefix ? `${pathPrefix}.${key}` : key;

        if (value !== undefined) {
          const propErrors = this.validateProperty(value, prop, fieldPath);
          errors.push(...propErrors);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate a single property
   */
  private validateProperty(
    value: unknown,
    prop: SchemaProperty,
    fieldPath: string
  ): ConfigValidationError[] {
    const errors: ConfigValidationError[] = [];

    // Type check
    const actualType = this.getType(value);
    if (actualType !== prop.type) {
      errors.push({
        field: fieldPath,
        message: `Expected ${prop.type}, got ${actualType}`,
        value,
      });
      return errors; // Skip further validation on type mismatch
    }

    // Enum check
    if (prop.enum && !prop.enum.includes(value)) {
      errors.push({
        field: fieldPath,
        message: `Must be one of: ${prop.enum.join(', ')}`,
        value,
      });
    }

    // Number range checks
    if (prop.type === 'number' && typeof value === 'number') {
      if (prop.minimum !== undefined && value < prop.minimum) {
        errors.push({
          field: fieldPath,
          message: `Must be at least ${prop.minimum}`,
          value,
        });
      }
      if (prop.maximum !== undefined && value > prop.maximum) {
        errors.push({
          field: fieldPath,
          message: `Must be at most ${prop.maximum}`,
          value,
        });
      }
    }

    // String length checks
    if (prop.type === 'string' && typeof value === 'string') {
      if (prop.minLength !== undefined && value.length < prop.minLength) {
        errors.push({
          field: fieldPath,
          message: `Must be at least ${prop.minLength} characters`,
          value,
        });
      }
      if (prop.maxLength !== undefined && value.length > prop.maxLength) {
        errors.push({
          field: fieldPath,
          message: `Must be at most ${prop.maxLength} characters`,
          value,
        });
      }
    }

    // Nested object validation
    if (prop.type === 'object' && prop.properties && typeof value === 'object' && value !== null) {
      const nestedResult = this.validateObject(
        value as Record<string, unknown>,
        { type: 'object', properties: prop.properties, required: prop.required },
        fieldPath
      );
      errors.push(...nestedResult.errors);
    }

    return errors;
  }

  /**
   * Get type of value
   */
  private getType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  /**
   * Load wos.yaml
   */
  private async loadWosYaml(): Promise<Record<string, unknown>> {
    try {
      const content = await fs.readFile(this.wosYamlPath, 'utf-8');
      return yaml.parse(content) ?? {};
    } catch {
      return {};
    }
  }

  /**
   * Save wos.yaml
   */
  private async saveWosYaml(config: Record<string, unknown>): Promise<void> {
    await fs.writeFile(this.wosYamlPath, yaml.stringify(config), 'utf-8');
  }
}
