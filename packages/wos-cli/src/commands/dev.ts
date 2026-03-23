/**
 * Dev Command
 *
 * Story 8.3: `wos dev` Command
 *
 * Development mode with hot-reload for plugins.
 */

import { Command, Flags } from '@oclif/core';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import { spawn, ChildProcess } from 'child_process';

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
 * Dev runner options
 */
export interface DevRunnerOptions {
  pluginDir: string;
  serverDir?: string;
  noReload?: boolean;
  watchPatterns?: string[];
  debounceMs?: number;
}

/**
 * Dev runner events
 */
export interface DevRunnerEvents {
  watching: (dir: string) => void;
  change: (file: string) => void;
  'build:start': () => void;
  'build:complete': () => void;
  'build:error': (error: Error) => void;
  start: () => void;
  stop: () => void;
  reload: () => void;
  error: (error: Error) => void;
}

/**
 * Dev Runner - manages plugin development mode
 */
export class DevRunner extends EventEmitter {
  private pluginDir: string;
  private serverDir?: string;
  private noReload: boolean;
  private watchPatterns: string[];
  private debounceMs: number;
  private watchAbortController?: AbortController;
  private running: boolean = false;
  private pluginProcess?: ChildProcess;
  private debounceTimer?: ReturnType<typeof setTimeout>;

  constructor(options: DevRunnerOptions) {
    super();
    this.pluginDir = options.pluginDir;
    this.serverDir = options.serverDir;
    this.noReload = options.noReload ?? false;
    this.watchPatterns = options.watchPatterns ?? ['src/**/*'];
    this.debounceMs = options.debounceMs ?? 300;
  }

  /**
   * Validate plugin directory
   */
  async validatePluginDir(): Promise<boolean> {
    const manifestPath = path.join(this.pluginDir, 'wos-plugin.yaml');

    try {
      await fs.access(manifestPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load plugin manifest
   */
  async loadManifest(): Promise<PluginManifest> {
    const manifestPath = path.join(this.pluginDir, 'wos-plugin.yaml');
    const content = await fs.readFile(manifestPath, 'utf-8');
    return yaml.parse(content) as PluginManifest;
  }

  /**
   * Setup file watcher
   */
  async setupWatcher(): Promise<void> {
    if (this.noReload) {
      return;
    }

    const srcDir = path.join(this.pluginDir, 'src');

    try {
      // Create abort controller for cleanup
      this.watchAbortController = new AbortController();
      const { signal } = this.watchAbortController;

      // Use recursive watch on src directory
      const watcher = fs.watch(srcDir, { recursive: true, signal });

      this.emit('watching', srcDir);

      // Process watch events
      (async () => {
        try {
          for await (const event of watcher) {
            if (event.filename) {
              this.handleFileChange(path.join(srcDir, event.filename));
            }
          }
        } catch (error) {
          // Watcher aborted or error
          const err = error as NodeJS.ErrnoException;
          if (err.name !== 'AbortError' && err.code !== 'ERR_STREAM_DESTROYED') {
            this.emit('error', error as Error);
          }
        }
      })();
    } catch (error) {
      this.emit('error', error as Error);
    }
  }

  /**
   * Handle file change with debounce
   */
  private handleFileChange(file: string): void {
    this.emit('change', file);

    // Debounce rebuild
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      try {
        await this.reload();
      } catch (error) {
        this.emit('error', error as Error);
      }
    }, this.debounceMs);
  }

  /**
   * Build the plugin
   */
  async build(): Promise<void> {
    this.emit('build:start');

    return new Promise((resolve, reject) => {
      const buildProcess = spawn('npm', ['run', 'build'], {
        cwd: this.pluginDir,
        shell: true,
        stdio: 'pipe',
      });

      let stderr = '';

      buildProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      buildProcess.on('close', (code) => {
        if (code === 0) {
          this.emit('build:complete');
          resolve();
        } else {
          const error = new Error(`Build failed: ${stderr}`);
          this.emit('build:error', error);
          reject(error);
        }
      });

      buildProcess.on('error', (error) => {
        this.emit('build:error', error);
        reject(error);
      });
    });
  }

  /**
   * Reload the plugin
   */
  async reload(): Promise<void> {
    this.emit('reload');

    try {
      await this.build();
    } catch {
      // Build error already emitted
    }
  }

  /**
   * Start dev mode
   */
  async start(): Promise<void> {
    const valid = await this.validatePluginDir();
    if (!valid) {
      throw new Error('Not a valid plugin directory');
    }

    this.running = true;
    this.emit('start');

    // Initial build
    await this.build();

    // Setup file watching
    await this.setupWatcher();
  }

  /**
   * Stop dev mode
   */
  stop(): void {
    this.running = false;

    // Clear debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Abort watcher
    if (this.watchAbortController) {
      this.watchAbortController.abort();
      this.watchAbortController = undefined;
    }

    // Kill plugin process
    if (this.pluginProcess) {
      this.pluginProcess.kill();
    }

    this.emit('stop');
  }

  /**
   * Check if running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get server directory
   */
  getServerDir(): string | undefined {
    return this.serverDir;
  }

  /**
   * Get watch patterns
   */
  getWatchPatterns(): string[] {
    return this.watchPatterns;
  }

  /**
   * Get debounce milliseconds
   */
  getDebounceMs(): number {
    return this.debounceMs;
  }
}

/**
 * Dev CLI Command
 */
export default class Dev extends Command {
  static override description = 'Run plugin in development mode with hot-reload';

  static override examples = [
    '<%= config.bin %> dev',
    '<%= config.bin %> dev --no-reload',
    '<%= config.bin %> dev --server ./my-server',
  ];

  static override flags = {
    directory: Flags.string({
      char: 'd',
      description: 'Plugin directory',
      default: process.cwd(),
    }),
    server: Flags.string({
      char: 's',
      description: 'Server directory to connect to',
    }),
    'no-reload': Flags.boolean({
      description: 'Disable hot-reload',
      default: false,
    }),
    debounce: Flags.integer({
      description: 'Debounce time in ms',
      default: 300,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Dev);

    const runner = new DevRunner({
      pluginDir: flags.directory,
      serverDir: flags.server,
      noReload: flags['no-reload'],
      debounceMs: flags.debounce,
    });

    // Setup event handlers
    runner.on('watching', (dir) => {
      this.log(`Watching for changes in ${dir}...`);
    });

    runner.on('change', (file) => {
      this.log(`File changed: ${file}`);
    });

    runner.on('build:start', () => {
      this.log('Building...');
    });

    runner.on('build:complete', () => {
      this.log('Build complete');
    });

    runner.on('build:error', (error) => {
      this.log(`Build error: ${error.message}`);
    });

    runner.on('reload', () => {
      this.log('Reloading plugin...');
    });

    runner.on('error', (error) => {
      this.log(`Error: ${error.message}`);
    });

    // Handle exit
    const cleanup = () => {
      this.log('Stopping dev mode...');
      runner.stop();
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    try {
      await runner.start();
      this.log('Dev mode started. Press Ctrl+C to stop.');

      // Keep process running
      await new Promise(() => {});
    } catch (error) {
      this.error((error as Error).message);
    }
  }
}
