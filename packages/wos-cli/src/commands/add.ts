/**
 * Add Command
 *
 * Story 4.1: wos add from Local Path
 * Story 4.2: wos add from GitHub/Git/npm
 *
 * Installs a plugin from a local path, GitHub, Git URL, or npm.
 */

import { Command, Args, Flags } from '@oclif/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import { spawn } from 'child_process';

/**
 * Plugin manifest structure
 */
interface PluginManifest {
  name: string;
  version: string;
  runtime: string;
  entrypoint: string;
  description?: string;
}

/**
 * Validation error
 */
interface ValidationError {
  field: string;
  message: string;
}

export default class Add extends Command {
  static override description = 'Install a plugin from a local path, GitHub, or Git URL';

  static override examples = [
    '<%= config.bin %> add ./my-plugin',
    '<%= config.bin %> add ./my-plugin --enable',
    '<%= config.bin %> add ./my-plugin --force',
    '<%= config.bin %> add github:user/repo',
    '<%= config.bin %> add github:user/repo#v1.0.0',
    '<%= config.bin %> add git:https://github.com/user/repo.git',
    '<%= config.bin %> add npm:@worldos/plugin-example',
  ];

  static override args = {
    source: Args.string({
      description: 'Plugin source (local path, github:user/repo, or git:url)',
      required: true,
    }),
  };

  static override flags = {
    directory: Flags.string({
      char: 'd',
      description: 'Server directory (default: current directory)',
      default: process.cwd(),
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Overwrite existing plugin',
      default: false,
    }),
    enable: Flags.boolean({
      char: 'e',
      description: 'Enable plugin immediately after installation',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output in JSON format',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Add);
    const serverDir = path.resolve(flags.directory);
    const wosYamlPath = path.join(serverDir, 'wos.yaml');
    const pluginsDir = path.join(serverDir, 'plugins');

    // Check if server is initialized
    const serverExists = await fs.access(wosYamlPath).then(() => true).catch(() => false);
    if (!serverExists) {
      this.error(`WorldOS not initialized in ${serverDir}. Run 'wos init' first.`, { exit: 1 });
      return;
    }

    // Parse source type
    const sourceType = this.parseSourceType(args.source);

    try {
      switch (sourceType.type) {
        case 'local':
          await this.installFromLocal(sourceType.path!, serverDir, pluginsDir, flags);
          break;
        case 'github':
          await this.installFromGitHub(sourceType.repo!, sourceType.ref, serverDir, pluginsDir, flags);
          break;
        case 'git':
          await this.installFromGit(sourceType.url!, sourceType.ref, serverDir, pluginsDir, flags);
          break;
        case 'npm':
          await this.installFromNpm(sourceType.package!, sourceType.version, serverDir, pluginsDir, flags);
          break;
      }
    } catch (error) {
      if (flags.json) {
        this.log(JSON.stringify({ success: false, error: (error as Error).message }));
      } else {
        this.error((error as Error).message, { exit: 1 });
      }
    }
  }

  /**
   * Source type union
   */
  private parseSourceType(source: string): {
    type: 'local' | 'github' | 'git' | 'npm';
    path?: string;
    repo?: string;
    ref?: string;
    url?: string;
    package?: string;
    version?: string;
  } {
    if (source.startsWith('github:')) {
      const rest = source.slice(7);
      const [repo, ref] = rest.split('#');
      return { type: 'github', repo, ref };
    } else if (source.startsWith('git:')) {
      const rest = source.slice(4);
      const [url, ref] = rest.split('#');
      return { type: 'git', url, ref };
    } else if (source.startsWith('npm:')) {
      const rest = source.slice(4);
      // npm:@scope/package@version or npm:package@version
      const atIndex = rest.lastIndexOf('@');
      if (atIndex > 0 && rest[0] !== '@') {
        // package@version
        return {
          type: 'npm',
          package: rest.slice(0, atIndex),
          version: rest.slice(atIndex + 1),
        };
      } else if (atIndex > 0 && rest[0] === '@') {
        // @scope/package or @scope/package@version
        const secondAt = rest.indexOf('@', 1);
        if (secondAt > 0 && secondAt < rest.length - 1) {
          // Has version
          return {
            type: 'npm',
            package: rest.slice(0, secondAt),
            version: rest.slice(secondAt + 1),
          };
        }
      }
      return { type: 'npm', package: rest };
    } else {
      return { type: 'local', path: source };
    }
  }

  /**
   * Install plugin from local path
   */
  private async installFromLocal(
    sourcePath: string,
    serverDir: string,
    pluginsDir: string,
    flags: { force: boolean; enable: boolean; json: boolean }
  ): Promise<void> {
    const absoluteSourcePath = path.resolve(sourcePath);

    // Check source exists
    const sourceExists = await fs.access(absoluteSourcePath).then(() => true).catch(() => false);
    if (!sourceExists) {
      this.error(`Source path not found: ${absoluteSourcePath}`, { exit: 1 });
      return;
    }

    // Check for manifest
    const manifestPath = path.join(absoluteSourcePath, 'wos-plugin.yaml');
    const manifestExists = await fs.access(manifestPath).then(() => true).catch(() => false);
    if (!manifestExists) {
      this.error(`No wos-plugin.yaml manifest found in ${absoluteSourcePath}`, { exit: 1 });
      return;
    }

    // Load and validate manifest
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    let manifest: PluginManifest;
    try {
      manifest = yaml.parse(manifestContent) as PluginManifest;
    } catch (e) {
      this.error(`Invalid YAML in wos-plugin.yaml: ${(e as Error).message}`, { exit: 1 });
      return;
    }

    const errors = this.validateManifest(manifest);
    if (errors.length > 0) {
      const errorMessages = errors.map(e => `  - ${e.field}: ${e.message}`).join('\n');
      this.error(`Invalid manifest:\n${errorMessages}`, { exit: 1 });
      return;
    }

    const pluginName = manifest.name;
    const pluginVersion = manifest.version;
    const targetDir = path.join(pluginsDir, pluginName);

    // Check if plugin already exists
    const pluginExists = await fs.access(targetDir).then(() => true).catch(() => false);
    if (pluginExists && !flags.force) {
      this.error(`Plugin '${pluginName}' is already installed. Use --force to overwrite.`, { exit: 1 });
      return;
    }

    // Ensure plugins directory exists
    await fs.mkdir(pluginsDir, { recursive: true });

    // Remove existing plugin if force
    if (pluginExists && flags.force) {
      await fs.rm(targetDir, { recursive: true, force: true });
    }

    // Copy plugin directory
    await this.copyDirectory(absoluteSourcePath, targetDir);

    // Check for package.json
    const packageJsonPath = path.join(targetDir, 'package.json');
    const hasPackageJson = await fs.access(packageJsonPath).then(() => true).catch(() => false);

    // Update wos.yaml
    await this.registerPlugin(serverDir, pluginName, pluginVersion, sourcePath, flags.enable);

    // Output result
    if (flags.json) {
      this.log(JSON.stringify({
        status: 'installed',
        plugin: {
          name: pluginName,
          version: pluginVersion,
          enabled: flags.enable,
          path: targetDir,
        },
        hasDependencies: hasPackageJson,
      }, null, 2));
    } else {
      this.log(`Installed plugin: ${pluginName}@${pluginVersion}`);
      this.log(`  Location: ${targetDir}`);
      this.log(`  Enabled: ${flags.enable ? 'Yes' : 'No'}`);
      if (hasPackageJson) {
        this.log('');
        this.log('Plugin has dependencies. Run the following to install them:');
        this.log(`  cd ${targetDir} && npm install`);
      }
    }
  }

  /**
   * Validate plugin manifest
   */
  private validateManifest(manifest: PluginManifest): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!manifest.name || typeof manifest.name !== 'string') {
      errors.push({ field: 'name', message: 'required string field' });
    }
    if (!manifest.version || typeof manifest.version !== 'string') {
      errors.push({ field: 'version', message: 'required string field' });
    }
    if (!manifest.runtime || typeof manifest.runtime !== 'string') {
      errors.push({ field: 'runtime', message: 'required string field' });
    }
    if (!manifest.entrypoint || typeof manifest.entrypoint !== 'string') {
      errors.push({ field: 'entrypoint', message: 'required string field' });
    }

    return errors;
  }

  /**
   * Copy directory recursively
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });

    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        // Skip node_modules and .git
        if (entry.name === 'node_modules' || entry.name === '.git') {
          continue;
        }
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * Register plugin in wos.yaml
   */
  private async registerPlugin(
    serverDir: string,
    name: string,
    version: string,
    sourcePath: string,
    enabled: boolean
  ): Promise<void> {
    const wosYamlPath = path.join(serverDir, 'wos.yaml');

    // Load existing config
    const content = await fs.readFile(wosYamlPath, 'utf-8');
    const config = yaml.parse(content) ?? {};

    // Initialize plugins section if needed
    if (!config.plugins) {
      config.plugins = {};
    }

    // Add plugin entry
    config.plugins[name] = {
      enabled,
      version,
      source: sourcePath,
      installedAt: new Date().toISOString(),
    };

    // Write back
    await fs.writeFile(wosYamlPath, yaml.stringify(config), 'utf-8');
  }

  /**
   * Install plugin from GitHub
   */
  private async installFromGitHub(
    repo: string,
    ref: string | undefined,
    serverDir: string,
    pluginsDir: string,
    flags: { force: boolean; enable: boolean; json: boolean }
  ): Promise<void> {
    // GitHub URL: https://github.com/user/repo.git
    const gitUrl = `https://github.com/${repo}.git`;
    await this.installFromGit(gitUrl, ref, serverDir, pluginsDir, flags, `github:${repo}`);
  }

  /**
   * Install plugin from Git URL
   */
  private async installFromGit(
    url: string,
    ref: string | undefined,
    serverDir: string,
    pluginsDir: string,
    flags: { force: boolean; enable: boolean; json: boolean },
    sourceDisplay?: string
  ): Promise<void> {
    // Create temp directory
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-git-'));

    try {
      // Clone repository
      if (!flags.json) {
        this.log(`Cloning from ${url}...`);
      }

      await this.runCommand('git', ['clone', '--depth', '1', ...(ref ? ['--branch', ref] : []), url, tempDir]);

      // Checkout specific ref if provided
      if (ref) {
        await this.runCommand('git', ['checkout', ref], { cwd: tempDir });
      }

      // Install from cloned directory
      await this.installFromLocal(tempDir, serverDir, pluginsDir, flags);

      // Update source in wos.yaml to reflect git source
      if (sourceDisplay) {
        const wosYamlPath = path.join(serverDir, 'wos.yaml');
        const content = await fs.readFile(wosYamlPath, 'utf-8');
        const config = yaml.parse(content) ?? {};

        // Find the plugin that was just installed
        const manifestPath = path.join(tempDir, 'wos-plugin.yaml');
        const manifestContent = await fs.readFile(manifestPath, 'utf-8');
        const manifest = yaml.parse(manifestContent) as PluginManifest;

        if (config.plugins && config.plugins[manifest.name]) {
          config.plugins[manifest.name].source = sourceDisplay + (ref ? `#${ref}` : '');
          config.plugins[manifest.name].sourceType = 'github';
          await fs.writeFile(wosYamlPath, yaml.stringify(config), 'utf-8');
        }
      }
    } finally {
      // Clean up temp directory
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Install plugin from npm
   */
  private async installFromNpm(
    packageName: string,
    version: string | undefined,
    serverDir: string,
    pluginsDir: string,
    flags: { force: boolean; enable: boolean; json: boolean }
  ): Promise<void> {
    // Create temp directory
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-npm-'));

    try {
      // Initialize package.json
      await fs.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'temp', version: '1.0.0' }),
        'utf-8'
      );

      // Install package
      const packageSpec = version ? `${packageName}@${version}` : packageName;

      if (!flags.json) {
        this.log(`Installing ${packageSpec} from npm...`);
      }

      await this.runCommand('npm', ['install', packageSpec], { cwd: tempDir });

      // Find the installed package
      const packageDir = path.join(tempDir, 'node_modules', packageName);

      // Check for wos-plugin.yaml
      const manifestPath = path.join(packageDir, 'wos-plugin.yaml');
      const manifestExists = await fs.access(manifestPath).then(() => true).catch(() => false);

      if (!manifestExists) {
        throw new Error(`Package '${packageName}' is not a WorldOS plugin (no wos-plugin.yaml)`);
      }

      // Install from package directory
      await this.installFromLocal(packageDir, serverDir, pluginsDir, flags);

      // Update source in wos.yaml
      const wosYamlPath = path.join(serverDir, 'wos.yaml');
      const content = await fs.readFile(wosYamlPath, 'utf-8');
      const config = yaml.parse(content) ?? {};

      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(manifestContent) as PluginManifest;

      if (config.plugins && config.plugins[manifest.name]) {
        config.plugins[manifest.name].source = `npm:${packageSpec}`;
        config.plugins[manifest.name].sourceType = 'npm';
        await fs.writeFile(wosYamlPath, yaml.stringify(config), 'utf-8');
      }
    } finally {
      // Clean up temp directory
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Run a command and wait for completion
   */
  private async runCommand(
    command: string,
    args: string[],
    options: { cwd?: string } = {}
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        cwd: options.cwd,
        stdio: 'pipe',
        shell: true,
      });

      let stderr = '';
      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command '${command}' failed with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (error) => {
        reject(error);
      });
    });
  }
}
