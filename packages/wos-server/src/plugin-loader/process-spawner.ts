/**
 * Process Spawner
 *
 * Story 1.2: Spawn Plugin Processes
 *
 * Spawns plugin processes using child_process.spawn with proper
 * PID tracking and environment setup.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import type { PluginManifest } from './types.js';

/**
 * Runtime types supported by the spawner
 */
export type RuntimeType = 'node' | 'python' | 'binary' | 'docker';

/**
 * Configuration for spawning a plugin process
 */
export interface SpawnConfig {
  /** Plugin manifest */
  manifest: PluginManifest;
  /** Plugin directory path */
  pluginDir: string;
  /** MQTT broker host */
  mqttHost: string;
  /** MQTT broker port */
  mqttPort: number;
  /** Plugin config file path */
  configPath: string;
  /** Server directory */
  serverDir: string;
  /** Optional: MQTT username */
  mqttUsername?: string;
  /** Optional: MQTT password */
  mqttPassword?: string;
  /** Optional: Log level */
  logLevel?: string;
  /** Additional environment variables */
  extraEnv?: Record<string, string>;
}

/**
 * Result of spawning a process
 */
export interface SpawnResult {
  /** The spawned child process */
  process: ChildProcess;
  /** Process ID */
  pid: number;
  /** Command that was executed */
  command: string;
  /** Arguments passed to the command */
  args: string[];
}

/**
 * Runtime command configuration
 */
interface RuntimeCommand {
  executable: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

/**
 * Spawns plugin processes
 */
export class ProcessSpawner {
  /**
   * Spawn a plugin process
   *
   * @param config - Spawn configuration
   * @returns The spawned process and its PID
   * @throws Error if process fails to spawn
   */
  spawn(config: SpawnConfig): SpawnResult {
    const runtime = this.detectRuntime(config.manifest);
    const command = this.buildCommand(runtime, config);

    // 'node' uses process.execPath (absolute) and 'binary' uses a direct
    // path, so neither needs shell resolution. On Windows, 'python' and
    // 'docker' may be .cmd shims that require shell: true. To avoid
    // DEP0190, when shell is needed we pass the full command as a single
    // string with no separate args array.
    const needsShell = process.platform === 'win32' && runtime !== 'node' && runtime !== 'binary';

    // On Windows, spawn with detached: true so each plugin gets its own
    // process group.  Without this, all children share the parent's console
    // group and ANY console-control event (Ctrl+C, CTRL_CLOSE, or a stray
    // GenerateConsoleCtrlEvent from another child like Mosquitto) propagates
    // to every process, killing all plugins simultaneously.
    const isWindows = process.platform === 'win32';

    let childProcess: ChildProcess;
    if (needsShell) {
      // Single string avoids DEP0190 (no args + shell)
      const fullCmd = [command.executable, ...command.args.map(a => `"${a}"`)].join(' ');
      childProcess = spawn(fullCmd, {
        cwd: command.cwd,
        env: command.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: isWindows,
        shell: true,
      });
    } else {
      childProcess = spawn(command.executable, command.args, {
        cwd: command.cwd,
        env: command.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: isWindows,
      });
    }

    if (!childProcess.pid) {
      throw new Error(`Failed to spawn process for plugin ${config.manifest.name}`);
    }

    return {
      process: childProcess,
      pid: childProcess.pid,
      command: command.executable,
      args: command.args,
    };
  }

  /**
   * Detect runtime type from manifest
   */
  detectRuntime(manifest: PluginManifest): RuntimeType {
    // Use explicit runtime if specified
    if (manifest.runtime) {
      const runtime = manifest.runtime.toLowerCase();
      if (runtime === 'node' || runtime === 'nodejs') return 'node';
      if (runtime === 'python' || runtime === 'py') return 'python';
      if (runtime === 'binary' || runtime === 'bin') return 'binary';
      if (runtime === 'docker' || runtime === 'container') return 'docker';
    }

    // Infer from entrypoint extension
    const entrypoint = manifest.entrypoint.toLowerCase();

    if (entrypoint.endsWith('.js') || entrypoint.endsWith('.mjs') || entrypoint.endsWith('.cjs')) {
      return 'node';
    }

    if (entrypoint.endsWith('.py')) {
      return 'python';
    }

    // Docker images contain colon for tag (e.g., "image:tag" or "registry/image:tag")
    if (entrypoint.includes(':') && !entrypoint.includes('\\') && entrypoint.indexOf(':') !== 1) {
      return 'docker';
    }

    if (entrypoint.endsWith('.exe') || !entrypoint.includes('.')) {
      return 'binary';
    }

    // Default to node
    return 'node';
  }

  /**
   * Build the command to execute
   */
  private buildCommand(runtime: RuntimeType, config: SpawnConfig): RuntimeCommand {
    const env = this.buildEnvironment(config);
    const cwd = config.pluginDir;
    const entrypoint = config.manifest.entrypoint;

    switch (runtime) {
      case 'node':
        return {
          executable: process.execPath,
          args: [entrypoint],
          env,
          cwd,
        };

      case 'python':
        return {
          executable: process.platform === 'win32' ? 'python' : 'python3',
          args: [entrypoint],
          env,
          cwd,
        };

      case 'binary':
        const execPath = entrypoint.startsWith('.')
          ? path.join(cwd, entrypoint)
          : entrypoint;
        return {
          executable: execPath,
          args: [],
          env,
          cwd,
        };

      case 'docker':
        return {
          executable: 'docker',
          args: [
            'run',
            '--rm',
            '--network', 'host',
            ...Object.entries(env)
              .filter(([key]) => key.startsWith('WOS_'))
              .flatMap(([k, v]) => ['-e', `${k}=${v}`]),
            entrypoint,
          ],
          env,
          cwd,
        };

      default:
        throw new Error(`Unknown runtime: ${runtime}`);
    }
  }

  /**
   * Build environment variables for the plugin
   */
  private buildEnvironment(config: SpawnConfig): Record<string, string> {
    const env: Record<string, string> = {
      // Inherit current process environment
      ...(process.env as Record<string, string>),

      // WorldOS plugin environment variables
      WOS_MQTT_HOST: config.mqttHost,
      WOS_MQTT_PORT: String(config.mqttPort),
      WOS_PLUGIN_NAME: config.manifest.name,
      WOS_CONFIG_PATH: config.configPath,
      WOS_SERVER_DIR: config.serverDir,
      WOS_PLUGIN_DIR: config.pluginDir,
    };

    // Optional environment variables
    if (config.mqttUsername) {
      env.WOS_MQTT_USERNAME = config.mqttUsername;
    }
    if (config.mqttPassword) {
      env.WOS_MQTT_PASSWORD = config.mqttPassword;
    }
    if (config.logLevel) {
      env.WOS_LOG_LEVEL = config.logLevel;
    }

    // Add any extra environment variables
    if (config.extraEnv) {
      Object.assign(env, config.extraEnv);
    }

    return env;
  }

  /**
   * Kill a process gracefully with timeout fallback to SIGKILL
   *
   * @param process - The child process to kill
   * @param timeoutMs - Time to wait before SIGKILL (default: 5000)
   * @returns Promise that resolves when process exits
   */
  async killGracefully(childProcess: ChildProcess, timeoutMs = 5000): Promise<void> {
    if (!childProcess.pid) {
      return;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if graceful shutdown takes too long
        try {
          if (process.platform === 'win32') {
            // On Windows with detached processes, kill the process tree
            spawn('taskkill', ['/pid', String(childProcess.pid), '/f', '/t'], {
              stdio: 'ignore',
              windowsHide: true,
            });
          } else {
            childProcess.kill('SIGKILL');
          }
        } catch {
          // Process may already be dead
        }
      }, timeoutMs);

      childProcess.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      // Send SIGTERM for graceful shutdown
      try {
        if (process.platform === 'win32') {
          // On Windows with detached processes, TerminateProcess the leader;
          // Node translates .kill() → TerminateProcess which is the closest
          // equivalent to SIGTERM.
          childProcess.kill();
        } else {
          childProcess.kill('SIGTERM');
        }
      } catch {
        // Process may already be dead
        clearTimeout(timeout);
        resolve();
      }
    });
  }

  /**
   * Force kill a process immediately
   *
   * @param process - The child process to kill
   */
  forceKill(childProcess: ChildProcess): void {
    if (!childProcess.pid) {
      return;
    }

    try {
      childProcess.kill('SIGKILL');
    } catch {
      // Process may already be dead
    }
  }
}

/**
 * Convenience function to spawn a plugin process
 */
export function spawnPlugin(config: SpawnConfig): SpawnResult {
  const spawner = new ProcessSpawner();
  return spawner.spawn(config);
}
