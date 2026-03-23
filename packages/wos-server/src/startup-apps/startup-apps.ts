/**
 * Startup Apps Manager
 *
 * Story 3.7: Startup Apps Support
 *
 * Manages startup apps that run alongside plugins. Startup apps are
 * spawned before plugins and tracked with the same lifecycle management.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

/**
 * Configuration for a startup app
 */
export interface StartupAppConfig {
  /** Unique name for the app */
  name: string;
  /** Command to execute */
  command: string;
  /** Command line arguments */
  args?: string[];
  /** Working directory */
  workingDirectory?: string;
  /** Environment variables */
  environment?: Record<string, string>;
  /** Whether to restart on crash (default: true) */
  restartOnCrash?: boolean;
  /** Maximum restart attempts (default: 5) */
  maxRestarts?: number;
}

/**
 * App state enum
 */
export type AppState = 'pending' | 'starting' | 'running' | 'stopping' | 'stopped' | 'crashed' | 'failed';

/**
 * Runtime status of a startup app
 */
export interface StartupApp {
  name: string;
  config: StartupAppConfig;
  state: AppState;
  pid?: number;
  startedAt?: Date;
  stoppedAt?: Date;
  exitCode?: number;
  exitSignal?: string;
  restartCount: number;
  error?: string;
}

/**
 * Internal entry with child process reference
 */
interface AppEntry extends StartupApp {
  childProcess?: ChildProcess;
}

/**
 * Events emitted by StartupAppManager
 */
export interface StartupAppManagerEvents {
  'app:registered': (config: StartupAppConfig) => void;
  'app:starting': (name: string) => void;
  'app:started': (app: StartupApp) => void;
  'app:stopping': (name: string) => void;
  'app:stopped': (app: StartupApp) => void;
  'app:crashed': (app: StartupApp, error: Error) => void;
  'app:output': (name: string, data: string, stream: 'stdout' | 'stderr') => void;
}

/**
 * Manages startup applications
 */
export class StartupAppManager extends EventEmitter {
  private apps: Map<string, AppEntry> = new Map();

  /**
   * Register a startup app configuration
   */
  register(config: StartupAppConfig): void {
    // Validate required fields
    if (!config.name) {
      throw new Error('Startup app name is required');
    }
    if (!config.command) {
      throw new Error('Startup app command is required');
    }

    // Check for duplicates
    if (this.apps.has(config.name)) {
      throw new Error(`Startup app '${config.name}' is already registered`);
    }

    // Apply defaults
    const normalizedConfig: StartupAppConfig = {
      ...config,
      args: config.args ?? [],
      restartOnCrash: config.restartOnCrash ?? true,
      maxRestarts: config.maxRestarts ?? 5,
    };

    // Create app entry
    const entry: AppEntry = {
      name: config.name,
      config: normalizedConfig,
      state: 'pending',
      restartCount: 0,
    };

    this.apps.set(config.name, entry);
    this.emit('app:registered', normalizedConfig);
  }

  /**
   * Get all registered app configurations
   */
  getRegisteredApps(): StartupAppConfig[] {
    return Array.from(this.apps.values()).map(entry => entry.config);
  }

  /**
   * Get status of a specific app
   */
  getAppStatus(name: string): StartupApp | undefined {
    const entry = this.apps.get(name);
    return entry ? this.toStartupApp(entry) : undefined;
  }

  /**
   * Get status of all apps
   */
  getAllAppStatuses(): StartupApp[] {
    return Array.from(this.apps.values()).map(entry => this.toStartupApp(entry));
  }

  /**
   * Start all registered apps
   */
  async startAll(): Promise<void> {
    const startPromises = Array.from(this.apps.values())
      .filter(entry => entry.state === 'pending' || entry.state === 'stopped')
      .map(entry => this.startApp(entry));

    await Promise.all(startPromises);
  }

  /**
   * Start a specific app
   */
  async start(name: string): Promise<void> {
    const entry = this.apps.get(name);
    if (!entry) {
      throw new Error(`Startup app '${name}' not found`);
    }

    if (entry.state === 'running') {
      return; // Already running
    }

    await this.startApp(entry);
  }

  /**
   * Stop all running apps
   */
  async stopAll(): Promise<void> {
    const stopPromises = Array.from(this.apps.values())
      .filter(entry => entry.state === 'running' || entry.state === 'starting')
      .map(entry => this.stopApp(entry));

    await Promise.all(stopPromises);
  }

  /**
   * Stop a specific app
   */
  async stop(name: string): Promise<void> {
    const entry = this.apps.get(name);
    if (!entry) {
      throw new Error(`Startup app '${name}' not found`);
    }

    if (entry.state !== 'running' && entry.state !== 'starting') {
      return; // Not running
    }

    await this.stopApp(entry);
  }

  /**
   * Clear all registered apps
   */
  clear(): void {
    this.apps.clear();
  }

  /**
   * Check if an app is running
   */
  isRunning(name: string): boolean {
    const entry = this.apps.get(name);
    return entry?.state === 'running';
  }

  /**
   * Start a single app
   */
  private async startApp(entry: AppEntry): Promise<void> {
    this.emit('app:starting', entry.name);
    entry.state = 'starting';

    const config = entry.config;
    const workingDirectory = config.workingDirectory ?? process.cwd();

    // Merge environment variables
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...config.environment,
      WOS_APP_NAME: config.name,
    };

    try {
      const childProcess = spawn(config.command, config.args ?? [], {
        cwd: workingDirectory,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      entry.childProcess = childProcess;
      entry.pid = childProcess.pid;
      entry.startedAt = new Date();

      // Set up event handlers
      this.setupProcessHandlers(entry, childProcess);

      // Mark as running if we got a PID
      if (childProcess.pid) {
        entry.state = 'running';
        this.emit('app:started', this.toStartupApp(entry));
      }
    } catch (error) {
      entry.state = 'failed';
      entry.error = (error as Error).message;
      this.emit('app:crashed', this.toStartupApp(entry), error as Error);
      throw error;
    }
  }

  /**
   * Stop a single app
   */
  private async stopApp(entry: AppEntry): Promise<void> {
    if (!entry.childProcess) {
      entry.state = 'stopped';
      return;
    }

    this.emit('app:stopping', entry.name);
    entry.state = 'stopping';

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if graceful shutdown takes too long
        entry.childProcess?.kill('SIGKILL');
      }, 5000);

      entry.childProcess?.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      // Send SIGTERM for graceful shutdown
      entry.childProcess?.kill('SIGTERM');
    });
  }

  /**
   * Set up process event handlers
   */
  private setupProcessHandlers(entry: AppEntry, childProcess: ChildProcess): void {
    // Handle stdout
    childProcess.stdout?.on('data', (data: Buffer) => {
      this.emit('app:output', entry.name, data.toString(), 'stdout');
    });

    // Handle stderr
    childProcess.stderr?.on('data', (data: Buffer) => {
      this.emit('app:output', entry.name, data.toString(), 'stderr');
    });

    // Handle process exit
    childProcess.on('exit', (code, signal) => {
      entry.exitCode = code ?? undefined;
      entry.exitSignal = signal ?? undefined;
      entry.stoppedAt = new Date();
      entry.childProcess = undefined;

      // Determine if this was a crash
      const isCrash = (code !== null && code !== 0) || signal !== null;

      if (isCrash && entry.state !== 'stopping') {
        entry.state = 'crashed';
        entry.error = signal
          ? `Process killed by signal ${signal}`
          : `Process exited with code ${code}`;
        this.emit('app:crashed', this.toStartupApp(entry), new Error(entry.error));

        // Auto-restart if configured
        this.handleCrashRestart(entry);
      } else {
        entry.state = 'stopped';
        this.emit('app:stopped', this.toStartupApp(entry));
      }
    });

    // Handle process error
    childProcess.on('error', (error) => {
      entry.state = 'crashed';
      entry.error = error.message;
      entry.stoppedAt = new Date();
      entry.childProcess = undefined;

      this.emit('app:crashed', this.toStartupApp(entry), error);

      // Auto-restart if configured
      this.handleCrashRestart(entry);
    });
  }

  /**
   * Handle automatic restart on crash
   */
  private handleCrashRestart(entry: AppEntry): void {
    if (!entry.config.restartOnCrash) {
      return;
    }

    const maxRestarts = entry.config.maxRestarts ?? 5;
    if (entry.restartCount >= maxRestarts) {
      entry.state = 'failed';
      entry.error = `Max restarts (${maxRestarts}) exceeded`;
      return;
    }

    entry.restartCount++;

    // Restart after a brief delay
    setTimeout(() => {
      if (entry.state === 'crashed') {
        this.startApp(entry).catch(() => {
          // Restart failed, will be handled by error handler
        });
      }
    }, 1000);
  }

  /**
   * Convert internal entry to public StartupApp
   */
  private toStartupApp(entry: AppEntry): StartupApp {
    return {
      name: entry.name,
      config: entry.config,
      state: entry.state,
      pid: entry.pid,
      startedAt: entry.startedAt,
      stoppedAt: entry.stoppedAt,
      exitCode: entry.exitCode,
      exitSignal: entry.exitSignal,
      restartCount: entry.restartCount,
      error: entry.error,
    };
  }
}
