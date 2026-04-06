// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { writeFileSync, unlinkSync, mkdtempSync, rmdirSync } from 'fs';
import { Socket } from 'net';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import type { Logger } from '@worldos/plugin-sdk';

export interface BrokerConfig {
  tcpPort: number;
  wsPort: number;
  mosquittoPath: string;
}

export class BrokerManager extends EventEmitter {
  private _process: ChildProcess | null = null;
  private _configPath: string | null = null;
  private _tmpDir: string | null = null;
  private _isRunning = false;
  private _isStopping = false;
  private _logger: Logger;

  constructor(logger: Logger) {
    super();
    this._logger = logger;
  }

  async start(config: BrokerConfig): Promise<void> {
    this._tmpDir = mkdtempSync(path.join(os.tmpdir(), 'wos-mosquitto-'));
    const configPath = path.join(this._tmpDir, 'mosquitto.conf');

    const configContent = [
      'allow_anonymous true',
      `listener ${config.tcpPort}`,
      'protocol mqtt',
      `listener ${config.wsPort}`,
      'protocol websockets',
    ].join('\n');

    writeFileSync(configPath, configContent);
    this._configPath = configPath;

    this._process = spawn(config.mosquittoPath, ['-c', configPath], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this._process.stdout?.on('data', (data: Buffer) => {
      this._logger.debug(`[mosquitto] ${data.toString().trim()}`);
    });

    this._process.stderr?.on('data', (data: Buffer) => {
      this._logger.debug(`[mosquitto] ${data.toString().trim()}`);
    });

    this._process.on('exit', (code: number | null, signal: string | null) => {
      if (!this._isStopping) {
        this._isRunning = false;
        this._logger.error(`Mosquitto crashed with code ${code}`);
        this.emit('crashed', { code, signal });
      }
    });

    // Wait for TCP readiness
    await this._waitForPort(config.tcpPort, 5000, 100);
    this._isRunning = true;
    this._logger.info(`Mosquitto started on TCP:${config.tcpPort} WS:${config.wsPort} (PID ${this._process.pid})`);
  }

  async stop(): Promise<void> {
    if (!this._isRunning && !this._process) {
      return;
    }

    this._isStopping = true;

    if (this._process) {
      this._process.kill();
      this._process = null;
    }

    if (this._configPath) {
      try {
        unlinkSync(this._configPath);
      } catch (err: any) {
        this._logger.debug(`Failed to remove config file: ${err.message}`);
      }
      this._configPath = null;
    }

    if (this._tmpDir) {
      try {
        rmdirSync(this._tmpDir);
      } catch (err: any) {
        this._logger.debug(`Failed to remove temp directory: ${err.message}`);
      }
      this._tmpDir = null;
    }

    this._isRunning = false;
    this._isStopping = false;
    this._logger.info('Mosquitto stopped');
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  get pid(): number | undefined {
    return this._process?.pid;
  }

  private _waitForPort(port: number, timeoutMs: number, intervalMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;

      const tryConnect = () => {
        const socket = new Socket();

        socket.on('error', () => {
          socket.destroy();
          if (Date.now() >= deadline) {
            reject(new Error(`Mosquitto not ready on port ${port} after ${timeoutMs}ms`));
          } else {
            setTimeout(tryConnect, intervalMs);
          }
        });

        socket.connect(port, 'localhost', () => {
          socket.destroy();
          resolve();
        });
      };

      tryConnect();
    });
  }
}
