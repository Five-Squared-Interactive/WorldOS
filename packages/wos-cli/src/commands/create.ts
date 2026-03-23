/**
 * Create Plugin Command
 *
 * Story 8.1: `wos create plugin` Command
 * Story 8.2: Plugin Templates
 *
 * Scaffolds new plugins from templates.
 */

import { Command, Flags, Args } from '@oclif/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';

/**
 * Available plugin templates
 */
const TEMPLATES = ['node', 'typescript', 'python'] as const;
type Template = typeof TEMPLATES[number];

/**
 * Available plugin features
 */
const FEATURES = ['cli', 'admin'] as const;
type Feature = typeof FEATURES[number];

/**
 * Reserved plugin names
 */
const RESERVED_NAMES = ['node_modules', 'wos', 'worldos', 'core', 'system'];

/**
 * Create plugin options
 */
export interface CreatePluginOptions {
  name: string;
  directory: string;
  template: string;
  description?: string;
  author?: string;
  force?: boolean;
  features?: string[];
}

/**
 * Validate plugin name
 */
export function validatePluginName(name: string): boolean {
  // Must not be empty
  if (!name || name.length === 0) {
    return false;
  }

  // Must not start with dash or dot
  if (name.startsWith('-') || name.startsWith('.')) {
    return false;
  }

  // Must only contain alphanumeric, dash, underscore
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
    return false;
  }

  // Must not be reserved
  if (RESERVED_NAMES.includes(name.toLowerCase())) {
    return false;
  }

  return true;
}

/**
 * Get available templates
 */
export function getAvailableTemplates(): readonly string[] {
  return TEMPLATES;
}

/**
 * Create a new plugin from template
 */
export async function createPlugin(options: CreatePluginOptions): Promise<void> {
  const { name, directory, template, description, author, force, features = [] } = options;

  // Validate name
  if (!validatePluginName(name)) {
    throw new Error(`Invalid plugin name: ${name}`);
  }

  // Validate template
  if (!TEMPLATES.includes(template as Template)) {
    throw new Error(`Unknown template: ${template}. Available: ${TEMPLATES.join(', ')}`);
  }

  // Create plugin directory
  const pluginDir = path.join(directory, name);

  // Check if directory exists
  const exists = await fs.access(pluginDir).then(() => true).catch(() => false);
  if (exists && !force) {
    throw new Error(`Directory already exists: ${pluginDir}`);
  }

  // Create directory (or clean if force)
  if (exists && force) {
    await fs.rm(pluginDir, { recursive: true, force: true });
  }
  await fs.mkdir(pluginDir, { recursive: true });

  // Determine runtime
  const runtime = template === 'python' ? 'python' : 'node';

  // Generate files based on template
  if (template === 'typescript' || template === 'node') {
    await generateTypescriptPlugin(pluginDir, {
      name,
      description,
      author,
      features: features as Feature[],
    });
  } else if (template === 'python') {
    await generatePythonPlugin(pluginDir, {
      name,
      description,
      author,
      features: features as Feature[],
    });
  }

  // Generate manifest
  await generateManifest(pluginDir, {
    name,
    description,
    runtime,
    features: features as Feature[],
  });

  // Generate README
  await generateReadme(pluginDir, { name, description });
}

/**
 * Generate TypeScript plugin files
 */
async function generateTypescriptPlugin(
  pluginDir: string,
  options: { name: string; description?: string; author?: string; features: Feature[] }
): Promise<void> {
  const { name, description, author, features } = options;

  // Create src directory
  const srcDir = path.join(pluginDir, 'src');
  await fs.mkdir(srcDir, { recursive: true });

  // Generate package.json
  const pkg = {
    name,
    version: '0.1.0',
    description: description ?? `${name} WorldOS plugin`,
    author: author ?? '',
    type: 'module',
    main: 'dist/index.js',
    types: 'dist/index.d.ts',
    scripts: {
      build: 'tsc',
      test: 'vitest run',
      'test:watch': 'vitest',
      dev: 'tsc --watch',
    },
    dependencies: {
      '@worldos/plugin-sdk': '^0.1.0',
    },
    devDependencies: {
      typescript: '^5.3.0',
      vitest: '^1.6.0',
      '@types/node': '^20.10.0',
    },
  };
  await fs.writeFile(
    path.join(pluginDir, 'package.json'),
    JSON.stringify(pkg, null, 2)
  );

  // Generate tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      outDir: './dist',
      rootDir: './src',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      declaration: true,
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist'],
  };
  await fs.writeFile(
    path.join(pluginDir, 'tsconfig.json'),
    JSON.stringify(tsconfig, null, 2)
  );

  // Generate main source file
  const indexTs = `/**
 * ${name} Plugin
 *
 * ${description ?? 'A WorldOS plugin.'}
 */

import { WOSPlugin, PluginContext } from '@worldos/plugin-sdk';

export class ${toPascalCase(name)}Plugin extends WOSPlugin {
  async onStart(context: PluginContext): Promise<void> {
    context.logger.info('${name} plugin started');
  }

  async onStop(): Promise<void> {
    // Cleanup resources
  }

  async onHealthCheck(): Promise<{ status: string }> {
    return { status: 'ok' };
  }
}

export default ${toPascalCase(name)}Plugin;
`;
  await fs.writeFile(path.join(srcDir, 'index.ts'), indexTs);

  // Generate test file
  const testTs = `/**
 * ${name} Plugin Tests
 */

import { describe, it, expect } from 'vitest';
import { ${toPascalCase(name)}Plugin } from './index.js';

describe('${toPascalCase(name)}Plugin', () => {
  it('should create plugin instance', () => {
    const plugin = new ${toPascalCase(name)}Plugin();
    expect(plugin).toBeDefined();
  });

  it('should return healthy status', async () => {
    const plugin = new ${toPascalCase(name)}Plugin();
    const health = await plugin.onHealthCheck();
    expect(health.status).toBe('ok');
  });
});
`;
  await fs.writeFile(path.join(srcDir, 'index.test.ts'), testTs);

  // Generate feature files
  if (features.includes('cli')) {
    await generateCliFeature(srcDir, name);
  }

  if (features.includes('admin')) {
    await generateAdminFeature(srcDir, name);
  }
}

/**
 * Generate Python plugin files
 */
async function generatePythonPlugin(
  pluginDir: string,
  options: { name: string; description?: string; author?: string; features: Feature[] }
): Promise<void> {
  const { name, description, author, features } = options;

  // Create src directory
  const srcDir = path.join(pluginDir, 'src');
  await fs.mkdir(srcDir, { recursive: true });

  // Generate pyproject.toml
  const pyproject = `[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[project]
name = "${name}"
version = "0.1.0"
description = "${description ?? `${name} WorldOS plugin`}"
authors = [${author ? `{name = "${author}"}` : ''}]
dependencies = [
    "worldos-plugin>=0.1.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
]
`;
  await fs.writeFile(path.join(pluginDir, 'pyproject.toml'), pyproject);

  // Generate main source file
  const pluginPy = `"""
${name} Plugin

${description ?? 'A WorldOS plugin.'}
"""

from worldos_plugin import WOSPlugin, PluginContext


class ${toPascalCase(name)}Plugin(WOSPlugin):
    """${name} plugin implementation."""

    async def on_start(self, context: PluginContext) -> None:
        """Called when the plugin starts."""
        context.logger.info("${name} plugin started")

    async def on_stop(self) -> None:
        """Called when the plugin stops."""
        pass

    async def on_health_check(self) -> dict:
        """Return health status."""
        return {"status": "ok"}


plugin = ${toPascalCase(name)}Plugin()
`;
  await fs.writeFile(path.join(srcDir, 'plugin.py'), pluginPy);

  // Generate __init__.py
  await fs.writeFile(
    path.join(srcDir, '__init__.py'),
    `from .plugin import plugin, ${toPascalCase(name)}Plugin\n`
  );

  // Generate test file
  const testPy = `"""
${name} Plugin Tests
"""

import pytest
from src.plugin import ${toPascalCase(name)}Plugin


class Test${toPascalCase(name)}Plugin:
    def test_create_instance(self):
        plugin = ${toPascalCase(name)}Plugin()
        assert plugin is not None

    @pytest.mark.asyncio
    async def test_health_check(self):
        plugin = ${toPascalCase(name)}Plugin()
        health = await plugin.on_health_check()
        assert health["status"] == "ok"
`;
  await fs.writeFile(path.join(pluginDir, 'test_plugin.py'), testPy);

  // Generate feature files
  if (features.includes('cli')) {
    await generateCliFeaturePython(srcDir, name);
  }

  if (features.includes('admin')) {
    await generateAdminFeature(srcDir, name);
  }
}

/**
 * Generate CLI feature for TypeScript
 */
async function generateCliFeature(srcDir: string, name: string): Promise<void> {
  const cliDir = path.join(srcDir, 'cli');
  await fs.mkdir(cliDir, { recursive: true });

  const cliTs = `/**
 * ${name} CLI Commands
 */

import { CommandContext } from '@worldos/plugin-sdk';

/**
 * Example command handler
 */
export async function exampleCommand(
  args: string[],
  context: CommandContext
): Promise<void> {
  console.log('${name} example command executed');
  console.log('Args:', args);
}
`;
  await fs.writeFile(path.join(cliDir, 'index.ts'), cliTs);
}

/**
 * Generate CLI feature for Python
 */
async function generateCliFeaturePython(srcDir: string, name: string): Promise<void> {
  const cliDir = path.join(srcDir, 'cli');
  await fs.mkdir(cliDir, { recursive: true });

  const cliPy = `"""
${name} CLI Commands
"""


async def example_command(args: list, context) -> None:
    """Example command handler."""
    print("${name} example command executed")
    print(f"Args: {args}")
`;
  await fs.writeFile(path.join(cliDir, '__init__.py'), cliPy);
}

/**
 * Generate admin feature
 */
async function generateAdminFeature(srcDir: string, name: string): Promise<void> {
  const adminDir = path.join(srcDir, 'admin');
  await fs.mkdir(adminDir, { recursive: true });

  const adminTs = `/**
 * ${name} Admin Panel
 */

import { PanelContext } from '@worldos/plugin-sdk';

/**
 * Mount the admin panel
 */
export function mount(container: HTMLElement, context: PanelContext): void {
  container.innerHTML = \`
    <div class="plugin-panel">
      <h1>${name}</h1>
      <p>Admin panel content goes here.</p>
    </div>
  \`;
}

/**
 * Unmount the admin panel
 */
export function unmount(): void {
  // Cleanup
}
`;
  await fs.writeFile(path.join(adminDir, 'index.ts'), adminTs);
}

/**
 * Generate plugin manifest
 */
async function generateManifest(
  pluginDir: string,
  options: { name: string; description?: string; runtime: string; features: Feature[] }
): Promise<void> {
  const { name, description, runtime, features } = options;

  const manifest: Record<string, unknown> = {
    name,
    version: '0.1.0',
    description: description ?? `${name} WorldOS plugin`,
    runtime,
    entrypoint: runtime === 'python' ? 'src/plugin.py' : 'dist/index.js',
  };

  if (features.includes('cli')) {
    manifest.cli = {
      commands: [
        {
          name: 'example',
          description: 'Example command',
          handler: runtime === 'python' ? 'src/cli/__init__.py:example_command' : 'dist/cli/index.js',
        },
      ],
    };
  }

  if (features.includes('admin')) {
    manifest.admin = {
      panel: {
        displayName: name,
        entrypoint: 'dist/admin/index.js',
      },
    };
  }

  await fs.writeFile(
    path.join(pluginDir, 'wos-plugin.yaml'),
    yaml.stringify(manifest)
  );
}

/**
 * Generate README
 */
async function generateReadme(
  pluginDir: string,
  options: { name: string; description?: string }
): Promise<void> {
  const { name, description } = options;

  const readme = `# ${name}

${description ?? 'A WorldOS plugin.'}

## Installation

\`\`\`bash
wos plugin add ./${name}
\`\`\`

## Development

\`\`\`bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Development mode
wos dev
\`\`\`

## License

MIT
`;

  await fs.writeFile(path.join(pluginDir, 'README.md'), readme);
}

/**
 * Convert string to PascalCase
 */
function toPascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

/**
 * Create Plugin CLI Command
 */
export default class Create extends Command {
  static override description = 'Create a new WorldOS plugin from template';

  static override examples = [
    '<%= config.bin %> create my-plugin',
    '<%= config.bin %> create my-plugin --template typescript',
    '<%= config.bin %> create my-plugin --template python',
    '<%= config.bin %> create my-plugin --features cli,admin',
  ];

  static override args = {
    name: Args.string({
      description: 'Plugin name',
      required: true,
    }),
  };

  static override flags = {
    template: Flags.string({
      char: 't',
      description: 'Template to use',
      options: [...TEMPLATES],
      default: 'typescript',
    }),
    directory: Flags.string({
      char: 'd',
      description: 'Directory to create plugin in',
      default: process.cwd(),
    }),
    description: Flags.string({
      description: 'Plugin description',
    }),
    author: Flags.string({
      description: 'Plugin author',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Overwrite existing directory',
      default: false,
    }),
    features: Flags.string({
      description: 'Features to include (comma-separated: cli,admin)',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Create);

    const features = flags.features?.split(',').map(f => f.trim()) ?? [];

    try {
      await createPlugin({
        name: args.name,
        directory: flags.directory,
        template: flags.template,
        description: flags.description,
        author: flags.author,
        force: flags.force,
        features,
      });

      this.log(`Created plugin: ${args.name}`);
      this.log(`  Directory: ${path.join(flags.directory, args.name)}`);
      this.log(`  Template: ${flags.template}`);
      this.log('');
      this.log('Next steps:');
      this.log(`  cd ${args.name}`);
      this.log('  npm install');
      this.log('  npm run build');
      this.log('  wos plugin add .');
    } catch (error) {
      this.error((error as Error).message);
    }
  }
}
