/**
 * Docs Command
 *
 * Story 8.5: Developer Documentation
 *
 * Generates documentation for plugins.
 */

import { Command, Flags } from '@oclif/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';

/**
 * Plugin manifest structure
 */
interface PluginManifest {
  name: string;
  version: string;
  runtime: string;
  entrypoint: string;
  description?: string;
  author?: string;
  cli?: {
    commands?: Array<{
      name: string;
      description?: string;
      handler: string;
    }>;
  };
  mqtt?: {
    subscriptions?: string[];
    publications?: string[];
  };
  admin?: {
    panel?: {
      displayName?: string;
      entrypoint?: string;
    };
  };
  [key: string]: unknown;
}

/**
 * Doc generator options
 */
export interface DocGeneratorOptions {
  pluginDir: string;
  outputDir: string;
  generateReadme?: boolean;
  force?: boolean;
}

/**
 * Doc generation result
 */
export interface DocGeneratorResult {
  success: boolean;
  files: string[];
  errors: string[];
}

/**
 * Extracted API documentation
 */
export interface ApiDocs {
  commands: Array<{ name: string; description?: string }>;
  subscriptions: string[];
  publications: string[];
  adminPanel?: { displayName?: string };
}

/**
 * Generate documentation for a plugin
 */
export async function generateDocs(options: DocGeneratorOptions): Promise<DocGeneratorResult> {
  const { pluginDir, outputDir, generateReadme: genReadme, force } = options;
  const files: string[] = [];
  const errors: string[] = [];

  // Check manifest exists
  const manifestPath = path.join(pluginDir, 'wos-plugin.yaml');
  const manifestExists = await fs.access(manifestPath).then(() => true).catch(() => false);

  if (!manifestExists) {
    return {
      success: false,
      files: [],
      errors: ['Missing wos-plugin.yaml'],
    };
  }

  // Create output directory
  await fs.mkdir(outputDir, { recursive: true });

  // Generate API reference
  const apiReference = await generateApiReference(pluginDir);
  const apiPath = path.join(outputDir, 'API.md');
  await fs.writeFile(apiPath, apiReference);
  files.push(apiPath);

  // Generate README if requested
  if (genReadme) {
    const readmePath = path.join(pluginDir, 'README.md');
    const readmeExists = await fs.access(readmePath).then(() => true).catch(() => false);

    if (!readmeExists || force) {
      const readme = await generateReadme(pluginDir);
      await fs.writeFile(readmePath, readme);
      files.push(readmePath);
    }
  }

  return {
    success: true,
    files,
    errors,
  };
}

/**
 * Generate README content
 */
export async function generateReadme(pluginDir: string): Promise<string> {
  const manifestPath = path.join(pluginDir, 'wos-plugin.yaml');
  const content = await fs.readFile(manifestPath, 'utf-8');
  const manifest = yaml.parse(content) as PluginManifest;

  const lines: string[] = [];

  // Title
  lines.push(`# ${manifest.name}`);
  lines.push('');

  // Description
  if (manifest.description) {
    lines.push(manifest.description);
    lines.push('');
  }

  // Badges
  lines.push(`![Version](https://img.shields.io/badge/version-${manifest.version}-blue)`);
  lines.push(`![Runtime](https://img.shields.io/badge/runtime-${manifest.runtime}-green)`);
  lines.push('');

  // Installation
  lines.push('## Installation');
  lines.push('');
  lines.push('```bash');
  lines.push(`wos plugin add ${manifest.name}`);
  lines.push('```');
  lines.push('');

  // Usage
  lines.push('## Usage');
  lines.push('');

  // CLI commands
  if (manifest.cli?.commands && manifest.cli.commands.length > 0) {
    lines.push('### CLI Commands');
    lines.push('');

    for (const cmd of manifest.cli.commands) {
      lines.push(`#### \`${cmd.name}\``);
      if (cmd.description) {
        lines.push('');
        lines.push(cmd.description);
      }
      lines.push('');
      lines.push('```bash');
      lines.push(`wos ${manifest.name} ${cmd.name}`);
      lines.push('```');
      lines.push('');
    }
  }

  // Admin panel
  if (manifest.admin?.panel) {
    lines.push('### Admin Panel');
    lines.push('');
    lines.push(`This plugin provides an admin panel: **${manifest.admin.panel.displayName || manifest.name}**`);
    lines.push('');
    lines.push('Access it through the WorldOS admin interface.');
    lines.push('');
  }

  // MQTT topics
  if (manifest.mqtt) {
    lines.push('### MQTT Topics');
    lines.push('');

    if (manifest.mqtt.subscriptions && manifest.mqtt.subscriptions.length > 0) {
      lines.push('**Subscriptions:**');
      for (const topic of manifest.mqtt.subscriptions) {
        lines.push(`- \`${topic}\``);
      }
      lines.push('');
    }

    if (manifest.mqtt.publications && manifest.mqtt.publications.length > 0) {
      lines.push('**Publications:**');
      for (const topic of manifest.mqtt.publications) {
        lines.push(`- \`${topic}\``);
      }
      lines.push('');
    }
  }

  // Development
  lines.push('## Development');
  lines.push('');
  lines.push('```bash');
  lines.push('# Install dependencies');
  lines.push('npm install');
  lines.push('');
  lines.push('# Build');
  lines.push('npm run build');
  lines.push('');
  lines.push('# Run tests');
  lines.push('npm test');
  lines.push('');
  lines.push('# Development mode');
  lines.push('wos dev');
  lines.push('```');
  lines.push('');

  // Author
  if (manifest.author) {
    lines.push('## Author');
    lines.push('');
    lines.push(manifest.author);
    lines.push('');
  }

  // License
  lines.push('## License');
  lines.push('');
  lines.push('MIT');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate API reference documentation
 */
export async function generateApiReference(pluginDir: string): Promise<string> {
  const manifestPath = path.join(pluginDir, 'wos-plugin.yaml');
  const content = await fs.readFile(manifestPath, 'utf-8');
  const manifest = yaml.parse(content) as PluginManifest;

  const lines: string[] = [];

  lines.push(`# ${manifest.name} API Reference`);
  lines.push('');
  lines.push(`Version: ${manifest.version}`);
  lines.push('');

  // CLI Commands
  if (manifest.cli?.commands && manifest.cli.commands.length > 0) {
    lines.push('## CLI Commands');
    lines.push('');
    lines.push('| Command | Description |');
    lines.push('|---------|-------------|');

    for (const cmd of manifest.cli.commands) {
      lines.push(`| \`${cmd.name}\` | ${cmd.description || '-'} |`);
    }
    lines.push('');
  }

  // MQTT Topics
  if (manifest.mqtt) {
    lines.push('## MQTT Topics');
    lines.push('');

    if (manifest.mqtt.subscriptions && manifest.mqtt.subscriptions.length > 0) {
      lines.push('### Subscriptions');
      lines.push('');
      lines.push('Topics this plugin subscribes to:');
      lines.push('');
      for (const topic of manifest.mqtt.subscriptions) {
        lines.push(`- \`${topic}\``);
      }
      lines.push('');
    }

    if (manifest.mqtt.publications && manifest.mqtt.publications.length > 0) {
      lines.push('### Publications');
      lines.push('');
      lines.push('Topics this plugin publishes to:');
      lines.push('');
      for (const topic of manifest.mqtt.publications) {
        lines.push(`- \`${topic}\``);
      }
      lines.push('');
    }
  }

  // Admin Panel
  if (manifest.admin?.panel) {
    lines.push('## Admin Panel');
    lines.push('');
    lines.push(`- **Display Name:** ${manifest.admin.panel.displayName || manifest.name}`);
    if (manifest.admin.panel.entrypoint) {
      lines.push(`- **Entrypoint:** ${manifest.admin.panel.entrypoint}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Extract API documentation from manifest
 */
export async function extractApiDocs(pluginDir: string): Promise<ApiDocs> {
  const manifestPath = path.join(pluginDir, 'wos-plugin.yaml');
  const content = await fs.readFile(manifestPath, 'utf-8');
  const manifest = yaml.parse(content) as PluginManifest;

  return {
    commands: manifest.cli?.commands?.map(cmd => ({
      name: cmd.name,
      description: cmd.description,
    })) ?? [],
    subscriptions: manifest.mqtt?.subscriptions ?? [],
    publications: manifest.mqtt?.publications ?? [],
    adminPanel: manifest.admin?.panel ? {
      displayName: manifest.admin.panel.displayName,
    } : undefined,
  };
}

/**
 * Docs CLI Command
 */
export default class Docs extends Command {
  static override description = 'Generate documentation for a plugin';

  static override examples = [
    '<%= config.bin %> docs',
    '<%= config.bin %> docs --output ./docs',
    '<%= config.bin %> docs --readme',
    '<%= config.bin %> docs --readme --force',
  ];

  static override flags = {
    directory: Flags.string({
      char: 'd',
      description: 'Plugin directory',
      default: process.cwd(),
    }),
    output: Flags.string({
      char: 'o',
      description: 'Output directory for documentation',
      default: 'docs',
    }),
    readme: Flags.boolean({
      description: 'Generate README.md',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Overwrite existing files',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Docs);

    const outputDir = path.isAbsolute(flags.output)
      ? flags.output
      : path.join(flags.directory, flags.output);

    this.log('Generating documentation...');

    const result = await generateDocs({
      pluginDir: flags.directory,
      outputDir,
      generateReadme: flags.readme,
      force: flags.force,
    });

    if (!result.success) {
      this.log('');
      this.log('Documentation generation failed:');
      for (const error of result.errors) {
        this.log(`  - ${error}`);
      }
      this.exit(1);
      return;
    }

    this.log('');
    this.log('Generated files:');
    for (const file of result.files) {
      this.log(`  - ${file}`);
    }

    this.log('');
    this.log('Documentation generated successfully!');
  }
}
