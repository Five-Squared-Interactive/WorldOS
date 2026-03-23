/**
 * Pack Command
 *
 * Story 8.4: Plugin Packaging
 *
 * Packages plugins for distribution.
 */

import { Command, Flags } from '@oclif/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);

/**
 * Plugin manifest structure
 */
interface PluginManifest {
  name: string;
  version: string;
  runtime: string;
  entrypoint: string;
  [key: string]: unknown;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Pack options
 */
export interface PackOptions {
  pluginDir: string;
  outputDir?: string;
  filename?: string;
  dryRun?: boolean;
}

/**
 * Pack result
 */
export interface PackResult {
  success: boolean;
  outputPath?: string;
  fileCount: number;
  size: number;
  errors: string[];
  warnings: string[];
  files: string[];
  dryRun?: boolean;
}

/**
 * Excluded directories
 */
const EXCLUDED_DIRS = [
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '__pycache__',
  '.pytest_cache',
  '.tox',
  '.venv',
  'venv',
  '.mypy_cache',
  'coverage',
  '.nyc_output',
];

/**
 * Excluded file patterns
 */
const EXCLUDED_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /_test\.py$/,
  /^test_.*\.py$/,
  /\.spec\.[jt]sx?$/,
  /\.d\.ts\.map$/,
  /\.tsbuildinfo$/,
  /^\.env/,
  /^\.DS_Store$/,
  /^Thumbs\.db$/,
];

/**
 * Validate plugin is packable
 */
export async function validatePackable(pluginDir: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check manifest exists
  const manifestPath = path.join(pluginDir, 'wos-plugin.yaml');
  const manifestExists = await fs.access(manifestPath).then(() => true).catch(() => false);

  if (!manifestExists) {
    errors.push('Missing wos-plugin.yaml');
    return { valid: false, errors, warnings };
  }

  // Load and validate manifest
  let manifest: PluginManifest;
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    manifest = yaml.parse(content) as PluginManifest;
  } catch (e) {
    errors.push(`Invalid wos-plugin.yaml: ${(e as Error).message}`);
    return { valid: false, errors, warnings };
  }

  // Check required fields
  if (!manifest.name) {
    errors.push('Missing required field: name');
  }

  if (!manifest.version) {
    errors.push('Missing required field: version');
  }

  if (!manifest.runtime) {
    errors.push('Missing required field: runtime');
  }

  if (!manifest.entrypoint) {
    errors.push('Missing required field: entrypoint');
  }

  // Check entrypoint exists
  if (manifest.entrypoint) {
    const entrypointPath = path.join(pluginDir, manifest.entrypoint);
    const entrypointExists = await fs.access(entrypointPath).then(() => true).catch(() => false);

    if (!entrypointExists) {
      errors.push(`Missing entrypoint file: ${manifest.entrypoint}`);
    }
  }

  // Check for README
  const readmePath = path.join(pluginDir, 'README.md');
  const readmeExists = await fs.access(readmePath).then(() => true).catch(() => false);

  if (!readmeExists) {
    warnings.push('Missing README.md (recommended)');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get files to include in package
 */
export async function getPackageFiles(pluginDir: string): Promise<string[]> {
  const files: string[] = [];

  // Load manifest to determine runtime
  const manifestPath = path.join(pluginDir, 'wos-plugin.yaml');
  let manifest: PluginManifest | undefined;

  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    manifest = yaml.parse(content) as PluginManifest;
  } catch {
    // Continue without manifest
  }

  const isPython = manifest?.runtime === 'python';

  async function walkDir(dir: string, relativePath: string = ''): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.join(relativePath, entry.name);

        if (entry.isDirectory()) {
          // Skip excluded directories
          if (EXCLUDED_DIRS.includes(entry.name)) {
            continue;
          }

          // For Node.js, skip src directory (use dist)
          if (!isPython && entry.name === 'src') {
            continue;
          }

          await walkDir(fullPath, relPath);
        } else if (entry.isFile()) {
          // Skip excluded patterns
          if (EXCLUDED_PATTERNS.some(pattern => pattern.test(entry.name))) {
            continue;
          }

          files.push(relPath);
        }
      }
    } catch {
      // Directory not accessible
    }
  }

  await walkDir(pluginDir);
  return files;
}

/**
 * Create tarball from files
 */
export async function createTarball(
  pluginDir: string,
  files: string[],
  outputPath: string
): Promise<void> {
  // Simple tar-like format for .wospkg
  // Format: JSON header + gzipped file contents

  const fileContents: { name: string; content: string }[] = [];

  for (const file of files) {
    const filePath = path.join(pluginDir, file);
    try {
      const content = await fs.readFile(filePath, 'base64');
      fileContents.push({ name: file, content });
    } catch {
      // Skip unreadable files
    }
  }

  const packageData = {
    format: 'wospkg-1.0',
    files: fileContents,
    created: new Date().toISOString(),
  };

  const json = JSON.stringify(packageData);
  const compressed = await gzip(Buffer.from(json, 'utf-8'));

  await fs.writeFile(outputPath, compressed);
}

/**
 * Pack a plugin for distribution
 */
export async function packPlugin(options: PackOptions): Promise<PackResult> {
  const { pluginDir, outputDir, filename, dryRun } = options;

  // Validate
  const validation = await validatePackable(pluginDir);

  if (!validation.valid) {
    return {
      success: false,
      fileCount: 0,
      size: 0,
      errors: validation.errors,
      warnings: validation.warnings,
      files: [],
    };
  }

  // Get files to package
  const files = await getPackageFiles(pluginDir);

  // Load manifest for naming
  const manifestPath = path.join(pluginDir, 'wos-plugin.yaml');
  const manifestContent = await fs.readFile(manifestPath, 'utf-8');
  const manifest = yaml.parse(manifestContent) as PluginManifest;

  // Determine output path
  const defaultFilename = `${manifest.name}-${manifest.version}.wospkg`;
  const finalFilename = filename ?? defaultFilename;
  const finalOutputDir = outputDir ?? pluginDir;
  const outputPath = path.join(finalOutputDir, finalFilename);

  if (dryRun) {
    return {
      success: true,
      outputPath,
      fileCount: files.length,
      size: 0,
      errors: [],
      warnings: validation.warnings,
      files,
      dryRun: true,
    };
  }

  // Create tarball
  await createTarball(pluginDir, files, outputPath);

  // Get size
  const stat = await fs.stat(outputPath);

  return {
    success: true,
    outputPath,
    fileCount: files.length,
    size: stat.size,
    errors: [],
    warnings: validation.warnings,
    files,
  };
}

/**
 * Pack CLI Command
 */
export default class Pack extends Command {
  static override description = 'Package a plugin for distribution';

  static override examples = [
    '<%= config.bin %> pack',
    '<%= config.bin %> pack --output ./releases',
    '<%= config.bin %> pack --dry-run',
  ];

  static override flags = {
    directory: Flags.string({
      char: 'd',
      description: 'Plugin directory',
      default: process.cwd(),
    }),
    output: Flags.string({
      char: 'o',
      description: 'Output directory for the package',
    }),
    filename: Flags.string({
      char: 'f',
      description: 'Custom filename for the package',
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be packaged without creating the file',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Pack);

    this.log('Packaging plugin...');

    const result = await packPlugin({
      pluginDir: flags.directory,
      outputDir: flags.output,
      filename: flags.filename,
      dryRun: flags['dry-run'],
    });

    if (!result.success) {
      this.log('');
      this.log('Packaging failed:');
      for (const error of result.errors) {
        this.log(`  - ${error}`);
      }
      this.exit(1);
      return;
    }

    if (result.warnings.length > 0) {
      this.log('');
      this.log('Warnings:');
      for (const warning of result.warnings) {
        this.log(`  - ${warning}`);
      }
    }

    if (result.dryRun) {
      this.log('');
      this.log('Dry run - no file created');
      this.log(`Would create: ${result.outputPath}`);
      this.log(`Files to include (${result.fileCount}):`);
      for (const file of result.files) {
        this.log(`  - ${file}`);
      }
    } else {
      this.log('');
      this.log(`Package created: ${result.outputPath}`);
      this.log(`Files: ${result.fileCount}`);
      this.log(`Size: ${formatBytes(result.size)}`);
    }
  }
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));

  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}
