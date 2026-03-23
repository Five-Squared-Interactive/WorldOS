/**
 * Plugin Scanner
 *
 * Story 1.9: Plugin Directory Discovery
 *
 * Scans the plugins directory for installed plugins by looking for
 * wos-plugin.yaml manifest files in each subdirectory.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import { ManifestValidator } from '../manifest/manifest-validator.js';
import type {
  DiscoveredPlugin,
  PluginScanResult,
  PluginScanError,
  PluginManifest,
} from './types.js';

/**
 * Manifest file name to look for
 */
const MANIFEST_FILENAME = 'wos-plugin.yaml';

/**
 * Scanner options
 */
export interface PluginScannerOptions {
  /** Whether to validate file existence for entrypoints/handlers */
  validateFiles?: boolean;
  /** Custom manifest validator instance */
  validator?: ManifestValidator;
}

/**
 * Scans for plugins in a directory
 */
export class PluginScanner {
  private validator: ManifestValidator;
  private validateFiles: boolean;

  constructor(options: PluginScannerOptions = {}) {
    this.validator = options.validator ?? new ManifestValidator();
    this.validateFiles = options.validateFiles ?? true;
  }

  /**
   * Scan a plugins directory for valid plugins
   *
   * @param pluginsDir - Path to the plugins directory
   * @returns Scan result with discovered plugins and errors
   */
  async scan(pluginsDir: string): Promise<PluginScanResult> {
    const plugins: DiscoveredPlugin[] = [];
    const errors: PluginScanError[] = [];

    // Check if plugins directory exists
    try {
      const stat = await fs.stat(pluginsDir);
      if (!stat.isDirectory()) {
        return {
          plugins: [],
          errors: [{
            pluginDir: pluginsDir,
            message: 'Plugins path is not a directory',
          }],
        };
      }
    } catch {
      // Directory doesn't exist - not an error, just no plugins
      return { plugins: [], errors: [] };
    }

    // Read all entries in the plugins directory
    let entries: string[];
    try {
      entries = await fs.readdir(pluginsDir);
    } catch (error) {
      return {
        plugins: [],
        errors: [{
          pluginDir: pluginsDir,
          message: `Failed to read plugins directory: ${(error as Error).message}`,
        }],
      };
    }

    // Process each subdirectory
    for (const entry of entries) {
      const pluginDir = path.join(pluginsDir, entry);

      // Skip files, only process directories
      try {
        const stat = await fs.stat(pluginDir);
        if (!stat.isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }

      // Try to load and validate the plugin
      const result = await this.scanPlugin(pluginDir);
      if (result.plugin) {
        plugins.push(result.plugin);
      }
      if (result.error) {
        errors.push(result.error);
      }
    }

    return { plugins, errors };
  }

  /**
   * Scan a single plugin directory
   *
   * @param pluginDir - Path to the plugin directory
   * @returns Plugin if valid, error if invalid
   */
  async scanPlugin(pluginDir: string): Promise<{
    plugin?: DiscoveredPlugin;
    error?: PluginScanError;
  }> {
    const manifestPath = path.join(pluginDir, MANIFEST_FILENAME);

    // Check if manifest exists
    try {
      await fs.access(manifestPath);
    } catch {
      return {
        error: {
          pluginDir,
          message: `Missing manifest file: ${MANIFEST_FILENAME}`,
        },
      };
    }

    // Read manifest file
    let manifestContent: string;
    try {
      manifestContent = await fs.readFile(manifestPath, 'utf-8');
    } catch (error) {
      return {
        error: {
          pluginDir,
          message: `Failed to read manifest: ${(error as Error).message}`,
        },
      };
    }

    // Parse YAML
    let manifest: unknown;
    try {
      manifest = yaml.parse(manifestContent);
    } catch (error) {
      return {
        error: {
          pluginDir,
          message: `Invalid YAML in manifest: ${(error as Error).message}`,
        },
      };
    }

    // Validate manifest
    const validation = this.validateFiles
      ? await this.validator.validateWithFiles(manifest, pluginDir)
      : this.validator.validate(manifest);

    if (!validation.valid) {
      return {
        error: {
          pluginDir,
          message: 'Manifest validation failed',
          validationErrors: validation.errors,
        },
      };
    }

    // Cast to typed manifest
    const typedManifest = manifest as PluginManifest;

    return {
      plugin: {
        name: typedManifest.name,
        pluginDir,
        manifest: typedManifest,
      },
    };
  }

  /**
   * Check if a directory contains a valid plugin
   *
   * @param pluginDir - Path to check
   * @returns true if valid plugin exists
   */
  async isValidPlugin(pluginDir: string): Promise<boolean> {
    const result = await this.scanPlugin(pluginDir);
    return result.plugin !== undefined;
  }

  /**
   * Get the manifest path for a plugin directory
   *
   * @param pluginDir - Plugin directory path
   * @returns Full path to the manifest file
   */
  getManifestPath(pluginDir: string): string {
    return path.join(pluginDir, MANIFEST_FILENAME);
  }
}

/**
 * Convenience function to scan plugins directory
 *
 * @param pluginsDir - Path to plugins directory
 * @param options - Scanner options
 * @returns Scan result
 */
export async function scanPlugins(
  pluginsDir: string,
  options?: PluginScannerOptions
): Promise<PluginScanResult> {
  const scanner = new PluginScanner(options);
  return scanner.scan(pluginsDir);
}

/**
 * Convenience function to scan a single plugin
 *
 * @param pluginDir - Path to plugin directory
 * @param options - Scanner options
 * @returns Discovered plugin or error
 */
export async function scanSinglePlugin(
  pluginDir: string,
  options?: PluginScannerOptions
): Promise<DiscoveredPlugin | null> {
  const scanner = new PluginScanner(options);
  const result = await scanner.scanPlugin(pluginDir);
  return result.plugin ?? null;
}
