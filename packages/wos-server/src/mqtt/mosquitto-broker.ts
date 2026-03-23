/**
 * Mosquitto Broker Manager
 *
 * Manages an embedded Mosquitto MQTT broker process.
 * Bundles Mosquitto binaries with WorldOS so no external
 * broker installation is required.
 *
 * Lifecycle:
 *   1. Generates a mosquitto.conf in the server's runtime dir
 *   2. Spawns mosquitto as a child process
 *   3. Waits for the broker to accept connections
 *   4. On stop, sends SIGTERM and waits for graceful exit
 */

import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as net from 'net';
import { fileURLToPath } from 'url';

/**
 * Mosquitto broker configuration
 */
export interface MosquittoBrokerConfig {
  /** MQTT listener port (default 1883) */
  port?: number;
  /** Bind address (default 0.0.0.0) */
  host?: string;
  /** Enable WebSocket listener */
  websocketPort?: number;
  /** MQTT username (omit for anonymous) */
  username?: string;
  /** MQTT password */
  password?: string;
  /** Server directory for runtime files (conf, pid, log) */
  serverDir: string;
  /** Path to mosquitto binary (auto-detected if omitted) */
  mosquittoPath?: string;
  /** Log level: quiet, error, warning, notice, information, debug */
  logLevel?: string;
  /** Max queued messages per client (default 1000) */
  maxQueuedMessages?: number;
  /** Persistence (default false for embedded use) */
  persistence?: boolean;
}

/**
 * Manages an embedded Mosquitto MQTT broker
 */
export class MosquittoBroker extends EventEmitter {
  private config: Required<Pick<MosquittoBrokerConfig, 'port' | 'host' | 'serverDir'>> & MosquittoBrokerConfig;
  private process?: ChildProcess;
  private running = false;
  private confPath = '';
  private passwordFilePath = '';

  constructor(config: MosquittoBrokerConfig) {
    super();
    this.config = {
      port: 1883,
      host: '0.0.0.0',
      ...config,
    };
  }

  /**
   * Start the Mosquitto broker
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Mosquitto broker is already running');
    }

    const runtimeDir = path.join(this.config.serverDir, '.mosquitto');
    await fs.mkdir(runtimeDir, { recursive: true });

    // Write password file if credentials are set
    if (this.config.username && this.config.password) {
      this.passwordFilePath = path.join(runtimeDir, 'passwd');
      await this.writePasswordFile();
    }

    // Generate mosquitto.conf
    this.confPath = path.join(runtimeDir, 'mosquitto.conf');
    await this.writeConfig(runtimeDir);

    // Resolve mosquitto binary
    const mosquittoPath = this.config.mosquittoPath ?? await this.findMosquitto();

    // Spawn mosquitto — use detached on Windows so it gets its own process
    // group and doesn't propagate console-control events to sibling processes
    this.process = spawn(mosquittoPath, ['-c', this.confPath, '-v'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform === 'win32',
    });

    // Capture output — split multi-line chunks so each line gets its own log entry
    this.process.stdout?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n')) {
        const msg = line.trim();
        if (msg) this.emit('log', 'info', msg);
      }
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n')) {
        const msg = line.trim();
        if (msg) this.emit('log', 'error', msg);
      }
    });

    this.process.on('exit', (code, signal) => {
      this.running = false;
      this.emit('exit', code, signal);
    });

    this.process.on('error', (error) => {
      this.running = false;
      this.emit('error', error);
    });

    // Wait for broker to accept connections
    await this.waitForReady(this.config.port, this.config.host, 10000);

    this.running = true;
    this.emit('ready', { port: this.config.port, pid: this.process.pid });
  }

  /**
   * Stop the Mosquitto broker gracefully
   */
  async stop(timeoutMs = 5000): Promise<void> {
    if (!this.process || !this.running) {
      return;
    }

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if graceful shutdown takes too long
        if (this.process && !this.process.killed) {
          if (process.platform === 'win32' && this.process.pid) {
            spawn('taskkill', ['/pid', String(this.process.pid), '/f', '/t'], {
              stdio: 'ignore',
              windowsHide: true,
            });
          } else {
            this.process.kill('SIGKILL');
          }
        }
        this.running = false;
        resolve();
      }, timeoutMs);

      this.process!.once('exit', () => {
        clearTimeout(timeout);
        this.running = false;
        resolve();
      });

      // Send SIGTERM for graceful shutdown
      // On Windows, .kill() calls TerminateProcess which is the closest
      // equivalent to SIGTERM
      if (process.platform === 'win32') {
        this.process!.kill();
      } else {
        this.process!.kill('SIGTERM');
      }
    });
  }

  /**
   * Check if the broker is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the broker PID
   */
  getPid(): number | undefined {
    return this.process?.pid;
  }

  /**
   * Get the MQTT port
   */
  getPort(): number {
    return this.config.port;
  }

  /**
   * Write mosquitto.conf
   */
  private async writeConfig(runtimeDir: string): Promise<void> {
    const lines: string[] = [
      `# Auto-generated by WorldOS — do not edit`,
      `# Regenerated on every server start`,
      ``,
      `listener ${this.config.port} ${this.config.host}`,
      `protocol mqtt`,
      ``,
    ];

    // WebSocket listener
    if (this.config.websocketPort) {
      lines.push(`listener ${this.config.websocketPort}`);
      lines.push(`protocol websockets`);
      lines.push(``);
    }

    // Auth
    if (this.config.username && this.passwordFilePath) {
      lines.push(`allow_anonymous false`);
      lines.push(`password_file ${this.passwordFilePath.replace(/\\/g, '/')}`);
    } else {
      lines.push(`allow_anonymous true`);
    }
    lines.push(``);

    // Persistence
    if (this.config.persistence) {
      const persistDir = path.join(runtimeDir, 'data');
      await fs.mkdir(persistDir, { recursive: true });
      lines.push(`persistence true`);
      lines.push(`persistence_location ${persistDir.replace(/\\/g, '/')}/`);
    } else {
      lines.push(`persistence false`);
    }
    lines.push(``);

    // Logging
    lines.push(`log_dest stderr`);
    if (this.config.logLevel) {
      lines.push(`log_type ${this.config.logLevel}`);
    }
    lines.push(``);

    // Limits
    lines.push(`max_queued_messages ${this.config.maxQueuedMessages ?? 1000}`);
    lines.push(``);

    await fs.writeFile(this.confPath, lines.join('\n'), 'utf-8');
  }

  /**
   * Write a Mosquitto password file.
   *
   * Note: This writes a plain-text password entry. For production,
   * use `mosquitto_passwd` to generate hashed entries. The plain-text
   * format (user:password) works when Mosquitto is compiled with
   * allow_plaintext_passwords or when using the -c flag with mosquitto_passwd.
   *
   * For the embedded use case we hash with mosquitto_passwd if available,
   * otherwise fall back to plain text.
   */
  private async writePasswordFile(): Promise<void> {
    const { username, password } = this.config;
    if (!username || !password) return;

    // Write plain text first, then try to hash
    await fs.writeFile(this.passwordFilePath, `${username}:${password}\n`, 'utf-8');

    // Try to hash with mosquitto_passwd
    try {
      const mosquittoDir = path.dirname(
        this.config.mosquittoPath ?? await this.findMosquitto()
      );
      const passwdTool = path.join(mosquittoDir, process.platform === 'win32' ? 'mosquitto_passwd.exe' : 'mosquitto_passwd');

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(passwdTool, ['-U', this.passwordFilePath], {
          stdio: 'ignore',
          windowsHide: true,
        });
        proc.on('exit', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`mosquitto_passwd exited with code ${code}`));
        });
        proc.on('error', reject);
      });
    } catch {
      // mosquitto_passwd not available — plain text will work if
      // mosquitto is configured to allow it, or we add the setting
    }
  }

  /**
   * Find the bundled mosquitto binary
   */
  private async findMosquitto(): Promise<string> {
    // 1. Check bundled binary relative to this package
    const packageRoot = await this.findPackageRoot();
    const platform = process.platform;
    const ext = platform === 'win32' ? '.exe' : '';
    const bundledPath = path.join(packageRoot, 'mosquitto', 'bin', `mosquitto${ext}`);

    try {
      await fs.access(bundledPath);
      return bundledPath;
    } catch {
      // Not bundled
    }

    // 2. Check PATH
    const pathDirs = (process.env.PATH || '').split(path.delimiter);
    for (const dir of pathDirs) {
      const candidate = path.join(dir, `mosquitto${ext}`);
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Not here
      }
    }

    // 3. Check common install locations on Windows
    if (platform === 'win32') {
      const common = [
        'C:\\Program Files\\mosquitto\\mosquitto.exe',
        'C:\\Program Files (x86)\\mosquitto\\mosquitto.exe',
      ];
      for (const p of common) {
        try {
          await fs.access(p);
          return p;
        } catch {
          // Not here
        }
      }
    }

    throw new Error(
      'Mosquitto binary not found. Place mosquitto binaries in the ' +
      `wos-server/mosquitto/bin/ directory, or install Mosquitto and add it to PATH.`
    );
  }

  /**
   * Find the wos-server package root (where mosquitto/ lives)
   */
  private async findPackageRoot(): Promise<string> {
    // Walk up from this file to find package.json
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 10; i++) {
      try {
        await fs.access(path.join(dir, 'package.json'));
        return dir;
      } catch {
        dir = path.dirname(dir);
      }
    }
    return process.cwd();
  }

  /**
   * Wait for the broker to accept TCP connections
   */
  private waitForReady(port: number, host: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;

      const tryConnect = () => {
        if (Date.now() > deadline) {
          reject(new Error(`Mosquitto did not start within ${timeoutMs}ms`));
          return;
        }

        // Check if process died
        if (this.process?.exitCode !== null && this.process?.exitCode !== undefined) {
          reject(new Error(`Mosquitto exited with code ${this.process.exitCode}`));
          return;
        }

        const socket = net.createConnection({ port, host: host === '0.0.0.0' ? '127.0.0.1' : host });

        socket.once('connect', () => {
          socket.destroy();
          resolve();
        });

        socket.once('error', () => {
          socket.destroy();
          setTimeout(tryConnect, 100);
        });
      };

      // Give mosquitto a moment to start before first attempt
      setTimeout(tryConnect, 200);
    });
  }
}
