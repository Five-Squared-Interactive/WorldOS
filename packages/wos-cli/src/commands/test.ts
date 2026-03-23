/**
 * Test Command
 *
 * Story 8.5: Local Testing Support
 *
 * Plugin test runner with harness support.
 */

import { Command, Flags } from '@oclif/core';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
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
  [key: string]: unknown;
}

/**
 * Published message tracking
 */
interface PublishedMessage {
  topic: string;
  payload: unknown;
  timestamp: Date;
}

/**
 * Plugin context for testing
 */
export interface PluginContext {
  pluginName: string;
  version: string;
  config: {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
  };
  state: {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
  };
  logger: Logger;
}

/**
 * Logger interface
 */
export interface Logger {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
}

/**
 * Mock MQTT client for testing
 */
export class MockMqttClient extends EventEmitter {
  private subscriptions: string[] = [];
  private publishedMessages: PublishedMessage[] = [];

  subscribe(topic: string): void {
    if (!this.subscriptions.includes(topic)) {
      this.subscriptions.push(topic);
    }
  }

  unsubscribe(topic: string): void {
    this.subscriptions = this.subscriptions.filter(t => t !== topic);
  }

  publish(topic: string, payload: unknown): void {
    const message: PublishedMessage = {
      topic,
      payload,
      timestamp: new Date(),
    };
    this.publishedMessages.push(message);

    // Deliver to matching subscribers
    setTimeout(() => {
      for (const sub of this.subscriptions) {
        if (this.topicMatches(sub, topic)) {
          this.emit('message', topic, payload);
        }
      }
    }, 0);
  }

  getSubscriptions(): string[] {
    return [...this.subscriptions];
  }

  getPublishedMessages(): PublishedMessage[] {
    return [...this.publishedMessages];
  }

  clearSubscriptions(): void {
    this.subscriptions = [];
  }

  clearMessages(): void {
    this.publishedMessages = [];
  }

  private topicMatches(pattern: string, topic: string): boolean {
    const patternParts = pattern.split('/');
    const topicParts = topic.split('/');

    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i];

      if (patternPart === '#') {
        // Multi-level wildcard matches everything after
        return true;
      }

      if (patternPart === '+') {
        // Single-level wildcard matches any single level
        continue;
      }

      if (i >= topicParts.length || patternPart !== topicParts[i]) {
        return false;
      }
    }

    return patternParts.length === topicParts.length;
  }
}

/**
 * Test harness options
 */
export interface TestHarnessOptions {
  pluginDir: string;
  mqttBroker?: string;
}

/**
 * Test Harness - provides test context for plugin testing
 */
export class TestHarness {
  private pluginDir: string;
  private mqttClient: MockMqttClient;
  private logger: Logger;
  private _isSetup: boolean = false;
  private manifest?: PluginManifest;
  private configStore: Map<string, unknown> = new Map();
  private stateStore: Map<string, unknown> = new Map();
  private logs: { level: string; message: string; args: unknown[] }[] = [];

  constructor(options: TestHarnessOptions) {
    this.pluginDir = options.pluginDir;
    this.mqttClient = new MockMqttClient();
    this.logger = this.createLogger();
    this.loadManifestSync();
  }

  private loadManifestSync(): void {
    try {
      const manifestPath = path.join(this.pluginDir, 'wos-plugin.yaml');
      const fs = require('fs');
      const content = fs.readFileSync(manifestPath, 'utf-8');
      this.manifest = yaml.parse(content) as PluginManifest;
    } catch {
      // Manifest will be loaded async if needed
    }
  }

  private createLogger(): Logger {
    const log = (level: string, message: string, ...args: unknown[]) => {
      this.logs.push({ level, message, args });
    };

    return {
      info: (message: string, ...args: unknown[]) => log('info', message, ...args),
      warn: (message: string, ...args: unknown[]) => log('warn', message, ...args),
      error: (message: string, ...args: unknown[]) => log('error', message, ...args),
      debug: (message: string, ...args: unknown[]) => log('debug', message, ...args),
    };
  }

  async setup(): Promise<void> {
    // Load manifest
    const manifestPath = path.join(this.pluginDir, 'wos-plugin.yaml');
    const content = await fs.readFile(manifestPath, 'utf-8');
    this.manifest = yaml.parse(content) as PluginManifest;

    this._isSetup = true;
  }

  async teardown(): Promise<void> {
    this.cleanup();
    this._isSetup = false;
  }

  cleanup(): void {
    this.mqttClient.clearSubscriptions();
    this.mqttClient.clearMessages();
    this.configStore.clear();
    this.stateStore.clear();
    this.logs = [];
  }

  isSetup(): boolean {
    return this._isSetup;
  }

  getPluginContext(): PluginContext {
    return {
      pluginName: this.manifest?.name ?? 'unknown',
      version: this.manifest?.version ?? '0.0.0',
      config: {
        get: (key: string) => this.configStore.get(key),
        set: (key: string, value: unknown) => this.configStore.set(key, value),
      },
      state: {
        get: (key: string) => this.stateStore.get(key),
        set: (key: string, value: unknown) => this.stateStore.set(key, value),
      },
      logger: this.logger,
    };
  }

  getMqttClient(): MockMqttClient {
    return this.mqttClient;
  }

  getLogger(): Logger {
    return this.logger;
  }

  getPublishedMessages(): PublishedMessage[] {
    return this.mqttClient.getPublishedMessages();
  }

  getLogs(): { level: string; message: string; args: unknown[] }[] {
    return [...this.logs];
  }

  setConfig(key: string, value: unknown): void {
    this.configStore.set(key, value);
  }

  setState(key: string, value: unknown): void {
    this.stateStore.set(key, value);
  }
}

/**
 * Test result
 */
export interface TestResult {
  success: boolean;
  output: string;
  errorOutput: string;
  duration: number;
  testCount?: number;
  passCount?: number;
  failCount?: number;
}

/**
 * Test runner options
 */
export interface TestRunnerOptions {
  pluginDir: string;
  watch?: boolean;
  filter?: string;
}

/**
 * Test Runner - executes plugin tests
 */
export class TestRunner extends EventEmitter {
  private pluginDir: string;
  private _watch: boolean;
  private filter?: string;
  private manifest?: PluginManifest;

  constructor(options: TestRunnerOptions) {
    super();
    this.pluginDir = options.pluginDir;
    this._watch = options.watch ?? false;
    this.filter = options.filter;
  }

  async detectRuntime(): Promise<string> {
    await this.loadManifest();
    return this.manifest?.runtime ?? 'node';
  }

  private async loadManifest(): Promise<void> {
    if (this.manifest) return;

    const manifestPath = path.join(this.pluginDir, 'wos-plugin.yaml');
    const content = await fs.readFile(manifestPath, 'utf-8');
    this.manifest = yaml.parse(content) as PluginManifest;
  }

  isWatchMode(): boolean {
    return this._watch;
  }

  async run(): Promise<TestResult> {
    this.emit('start');
    const startTime = Date.now();

    await this.loadManifest();
    const runtime = this.manifest?.runtime ?? 'node';

    let result: TestResult;

    if (runtime === 'python') {
      result = await this.runPythonTests();
    } else {
      result = await this.runNodeTests();
    }

    result.duration = Date.now() - startTime;

    this.emit('complete', result);
    return result;
  }

  private async runNodeTests(): Promise<TestResult> {
    return new Promise((resolve) => {
      const testProcess = spawn('npm', ['test'], {
        cwd: this.pluginDir,
        shell: true,
        stdio: 'pipe',
      });

      let stdout = '';
      let stderr = '';

      testProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
        this.emit('output', data.toString());
      });

      testProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
        this.emit('error', data.toString());
      });

      testProcess.on('close', (code) => {
        resolve({
          success: code === 0,
          output: stdout,
          errorOutput: stderr,
          duration: 0,
        });
      });

      testProcess.on('error', (error) => {
        resolve({
          success: false,
          output: '',
          errorOutput: error.message,
          duration: 0,
        });
      });
    });
  }

  private async runPythonTests(): Promise<TestResult> {
    return new Promise((resolve) => {
      const testProcess = spawn('pytest', [], {
        cwd: this.pluginDir,
        shell: true,
        stdio: 'pipe',
      });

      let stdout = '';
      let stderr = '';

      testProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
        this.emit('output', data.toString());
      });

      testProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
        this.emit('error', data.toString());
      });

      testProcess.on('close', (code) => {
        resolve({
          success: code === 0,
          output: stdout,
          errorOutput: stderr,
          duration: 0,
        });
      });

      testProcess.on('error', (error) => {
        resolve({
          success: false,
          output: '',
          errorOutput: error.message,
          duration: 0,
        });
      });
    });
  }
}

/**
 * Discover test files in a plugin directory
 */
export async function discoverTestFiles(pluginDir: string): Promise<string[]> {
  const testFiles: string[] = [];

  async function walkDir(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== 'dist') {
            await walkDir(fullPath);
          }
        } else if (entry.isFile()) {
          const name = entry.name;
          // Match test patterns
          if (
            name.endsWith('.test.ts') ||
            name.endsWith('.test.js') ||
            name.endsWith('_test.py') ||
            name.startsWith('test_') && name.endsWith('.py')
          ) {
            testFiles.push(fullPath);
          }
        }
      }
    } catch {
      // Directory not accessible
    }
  }

  await walkDir(pluginDir);
  return testFiles;
}

/**
 * Test CLI Command
 */
export default class Test extends Command {
  static override description = 'Run plugin tests';

  static override examples = [
    '<%= config.bin %> test',
    '<%= config.bin %> test --watch',
    '<%= config.bin %> test --filter "unit"',
  ];

  static override flags = {
    directory: Flags.string({
      char: 'd',
      description: 'Plugin directory',
      default: process.cwd(),
    }),
    watch: Flags.boolean({
      char: 'w',
      description: 'Run tests in watch mode',
      default: false,
    }),
    filter: Flags.string({
      char: 'f',
      description: 'Filter tests by name pattern',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Test);

    // Validate plugin directory
    const manifestPath = path.join(flags.directory, 'wos-plugin.yaml');
    const exists = await fs.access(manifestPath).then(() => true).catch(() => false);

    if (!exists) {
      this.error('Not a valid plugin directory (wos-plugin.yaml not found)');
      return;
    }

    // Discover tests
    const testFiles = await discoverTestFiles(flags.directory);

    if (testFiles.length === 0) {
      this.log('No test files found');
      return;
    }

    this.log(`Found ${testFiles.length} test file(s)`);

    // Run tests
    const runner = new TestRunner({
      pluginDir: flags.directory,
      watch: flags.watch,
      filter: flags.filter,
    });

    runner.on('start', () => {
      this.log('Running tests...');
    });

    runner.on('output', (data: string) => {
      process.stdout.write(data);
    });

    runner.on('error', (data: string) => {
      process.stderr.write(data);
    });

    runner.on('complete', (result: TestResult) => {
      this.log('');
      if (result.success) {
        this.log('Tests passed');
      } else {
        this.log('Tests failed');
      }
      this.log(`Duration: ${result.duration}ms`);
    });

    const result = await runner.run();

    if (!result.success) {
      this.exit(1);
    }
  }
}
