/**
 * Secret Manager
 *
 * Story 5-5: Secret Management
 *
 * Securely handles sensitive configuration values.
 * Supports references to:
 * - Environment variables (env:VAR_NAME)
 * - Files (file:/path/to/secret)
 * - Vault (vault:path/to/secret) - placeholder for future integration
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Secret reference types
 */
export type SecretType = 'env' | 'file' | 'vault';

/**
 * Parsed secret reference
 */
export interface SecretReference {
  type: SecretType;
  source: string;
}

/**
 * Secret validation error
 */
export interface SecretValidationError {
  field: string;
  reference: string;
  message: string;
}

/**
 * Secret validation result
 */
export interface SecretValidationResult {
  valid: boolean;
  errors: SecretValidationError[];
}

/**
 * Secret reference prefixes
 */
const SECRET_PREFIXES: SecretType[] = ['env', 'file', 'vault'];

/**
 * Manages secret references in configuration
 */
export class SecretManager {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /**
   * Check if a value is a secret reference
   */
  static isSecretReference(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    return SECRET_PREFIXES.some(prefix => value.startsWith(`${prefix}:`));
  }

  /**
   * Parse a secret reference string
   */
  static parseReference(value: string): SecretReference | null {
    for (const prefix of SECRET_PREFIXES) {
      if (value.startsWith(`${prefix}:`)) {
        return {
          type: prefix,
          source: value.slice(prefix.length + 1),
        };
      }
    }
    return null;
  }

  /**
   * Mask secret references for display
   */
  static maskSecrets(config: Record<string, unknown>): Record<string, unknown> {
    const masked: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string' && SecretManager.isSecretReference(value)) {
        masked[key] = `***[${value}]***`;
      } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        masked[key] = SecretManager.maskSecrets(value as Record<string, unknown>);
      } else if (Array.isArray(value)) {
        masked[key] = value.map(item => {
          if (typeof item === 'string' && SecretManager.isSecretReference(item)) {
            return `***[${item}]***`;
          }
          return item;
        });
      } else {
        masked[key] = value;
      }
    }

    return masked;
  }

  /**
   * Resolve a secret reference to its actual value
   */
  async resolveSecret(reference: string): Promise<string | undefined> {
    // If not a reference, return as-is
    if (!SecretManager.isSecretReference(reference)) {
      return reference;
    }

    const parsed = SecretManager.parseReference(reference);
    if (!parsed) return undefined;

    switch (parsed.type) {
      case 'env':
        return this.resolveEnvSecret(parsed.source);
      case 'file':
        return this.resolveFileSecret(parsed.source);
      case 'vault':
        // Placeholder for future vault integration
        return undefined;
      default:
        return undefined;
    }
  }

  /**
   * Resolve environment variable secret
   */
  private resolveEnvSecret(varName: string): string | undefined {
    // First try exact match
    if (process.env[varName] !== undefined) {
      return process.env[varName];
    }

    // Try with WOS_SECRET_ prefix
    const prefixedName = `WOS_SECRET_${varName}`;
    if (process.env[prefixedName] !== undefined) {
      return process.env[prefixedName];
    }

    return undefined;
  }

  /**
   * Resolve file-based secret
   */
  private async resolveFileSecret(filePath: string): Promise<string | undefined> {
    try {
      // Resolve relative paths from base directory
      const resolvedPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(this.baseDir, filePath);

      const content = await fs.readFile(resolvedPath, 'utf-8');
      return content.trim();
    } catch {
      return undefined;
    }
  }

  /**
   * Resolve all secret references in a config object
   */
  async resolveConfigSecrets(config: Record<string, unknown>): Promise<Record<string, unknown>> {
    const resolved: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(config)) {
      resolved[key] = await this.resolveValue(value);
    }

    return resolved;
  }

  /**
   * Resolve a single value (recursive for objects/arrays)
   */
  private async resolveValue(value: unknown): Promise<unknown> {
    if (typeof value === 'string') {
      return SecretManager.isSecretReference(value)
        ? await this.resolveSecret(value)
        : value;
    }

    if (Array.isArray(value)) {
      return Promise.all(value.map(item => this.resolveValue(item)));
    }

    if (value !== null && typeof value === 'object') {
      return this.resolveConfigSecrets(value as Record<string, unknown>);
    }

    return value;
  }

  /**
   * Validate all secret references in a config object
   */
  async validateSecretReferences(config: Record<string, unknown>): Promise<SecretValidationResult> {
    const errors: SecretValidationError[] = [];
    await this.validateObject(config, '', errors);

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate secrets in an object recursively
   */
  private async validateObject(
    obj: Record<string, unknown>,
    prefix: string,
    errors: SecretValidationError[]
  ): Promise<void> {
    for (const [key, value] of Object.entries(obj)) {
      const fieldPath = prefix ? `${prefix}.${key}` : key;

      if (typeof value === 'string' && SecretManager.isSecretReference(value)) {
        const resolved = await this.resolveSecret(value);
        if (resolved === undefined) {
          errors.push({
            field: fieldPath,
            reference: value,
            message: `Secret reference not found: ${value}`,
          });
        }
      } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        await this.validateObject(value as Record<string, unknown>, fieldPath, errors);
      } else if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          if (typeof item === 'string' && SecretManager.isSecretReference(item)) {
            const resolved = await this.resolveSecret(item);
            if (resolved === undefined) {
              errors.push({
                field: `${fieldPath}[${i}]`,
                reference: item,
                message: `Secret reference not found: ${item}`,
              });
            }
          }
        }
      }
    }
  }
}
