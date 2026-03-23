/**
 * Runtime Detection and Configuration
 *
 * Story 10.3: Runtime Detection
 *
 * Support for multiple plugin runtimes (Node.js, Python, binary, Docker).
 */

import { spawn } from 'child_process';

/**
 * Supported runtime types
 */
export type RuntimeType = 'node' | 'python' | 'binary' | 'docker';

/**
 * Runtime configuration
 */
export interface RuntimeConfig {
  type: RuntimeType;
  entrypoint: string;
  workingDir: string;
  env?: Record<string, string>;
  args?: string[];
}

/**
 * Command to execute a runtime
 */
export interface RuntimeCommand {
  executable: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * Runtime requirements
 */
export interface RuntimeRequirements {
  node?: { minVersion: string };
  python?: { minVersion: string };
  docker?: { minVersion: string };
}

/**
 * Runtime validation result
 */
export interface RuntimeValidation {
  available: boolean;
  version?: string;
  error?: string;
}

/**
 * Plugin manifest (minimal for runtime detection)
 */
interface PluginManifest {
  runtime?: string;
  entrypoint: string;
}

/**
 * Detect runtime from manifest
 */
export function detectRuntime(manifest: PluginManifest): RuntimeType {
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

  if (entrypoint.endsWith('.exe') || !entrypoint.includes('.')) {
    return 'binary';
  }

  if (entrypoint.includes(':')) {
    return 'docker';
  }

  // Default to node
  return 'node';
}

/**
 * Get command to run a plugin
 */
export function getRuntimeCommand(config: RuntimeConfig): RuntimeCommand {
  const baseEnv = {
    ...process.env,
    ...config.env,
  } as Record<string, string>;

  switch (config.type) {
    case 'node':
      return {
        executable: 'node',
        args: config.args ? [...config.args, config.entrypoint] : [config.entrypoint],
        env: baseEnv,
        cwd: config.workingDir,
      };

    case 'python':
      return {
        executable: process.platform === 'win32' ? 'python' : 'python3',
        args: config.args ? [...config.args, config.entrypoint] : [config.entrypoint],
        env: baseEnv,
        cwd: config.workingDir,
      };

    case 'binary':
      const execPath = config.entrypoint.startsWith('.')
        ? `${config.workingDir}/${config.entrypoint}`
        : config.entrypoint;
      return {
        executable: execPath,
        args: config.args ?? [],
        env: baseEnv,
        cwd: config.workingDir,
      };

    case 'docker':
      return {
        executable: 'docker',
        args: [
          'run',
          '--rm',
          '--network', 'host',
          ...Object.entries(config.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
          config.entrypoint,
          ...(config.args ?? []),
        ],
        env: baseEnv,
        cwd: config.workingDir,
      };

    default:
      throw new Error(`Unknown runtime: ${config.type}`);
  }
}

/**
 * Validate a runtime is available
 */
export async function validateRuntime(runtime: RuntimeType): Promise<RuntimeValidation> {
  try {
    switch (runtime) {
      case 'node':
        return await checkCommand('node', ['--version'], /^v(\d+\.\d+\.\d+)/);

      case 'python':
        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
        return await checkCommand(pythonCmd, ['--version'], /Python (\d+\.\d+\.\d+)/);

      case 'docker':
        return await checkCommand('docker', ['--version'], /Docker version (\d+\.\d+\.\d+)/);

      case 'binary':
        // Binary runtime is always "available" - actual validation happens at execution
        return { available: true, version: 'native' };

      default:
        return { available: false, error: `Unknown runtime: ${runtime}` };
    }
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if a runtime is available
 */
export async function isRuntimeAvailable(runtime: RuntimeType): Promise<boolean> {
  const result = await validateRuntime(runtime);
  return result.available;
}

/**
 * Check a command and extract version
 */
async function checkCommand(
  cmd: string,
  args: string[],
  versionPattern: RegExp
): Promise<RuntimeValidation> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(cmd, args, {
        shell: process.platform === 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          const output = stdout + stderr;
          const match = output.match(versionPattern);
          resolve({
            available: true,
            version: match ? match[1] : 'unknown',
          });
        } else {
          resolve({
            available: false,
            error: `Command exited with code ${code}`,
          });
        }
      });

      proc.on('error', (error) => {
        resolve({
          available: false,
          error: error.message,
        });
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        proc.kill();
        resolve({
          available: false,
          error: 'Command timed out',
        });
      }, 5000);
    } catch (error) {
      resolve({
        available: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
