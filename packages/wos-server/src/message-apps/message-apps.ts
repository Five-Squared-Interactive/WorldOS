/**
 * Message-Triggered Apps Manager
 *
 * Story 3.8: Message-Triggered Apps
 *
 * Manages apps that start when specific MQTT topics receive messages.
 * Apps are spawned on-demand and tracked with lifecycle management.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

/**
 * Concurrency mode for message handling
 */
export type ConcurrencyMode = 'queue' | 'spawn' | 'ignore';

/**
 * Configuration for a message-triggered app
 */
export interface MessageAppConfig {
  /** Unique name for the app */
  name: string;
  /** MQTT topic that triggers this app */
  trigger: string;
  /** Command to execute */
  command: string;
  /** Command line arguments */
  args?: string[];
  /** Working directory */
  workingDirectory?: string;
  /** Environment variables */
  environment?: Record<string, string>;
  /** How to handle concurrent triggers (default: queue) */
  concurrency?: ConcurrencyMode;
}

/**
 * App state enum
 */
export type MessageAppState = 'idle' | 'running' | 'completing';

/**
 * Runtime status of a message-triggered app
 */
export interface MessageApp {
  name: string;
  config: MessageAppConfig;
  state: MessageAppState;
  pid?: number;
  lastTriggeredAt?: Date;
  lastCompletedAt?: Date;
  lastTriggerPayload?: unknown;
  exitCode?: number;
  triggerCount: number;
  queuedMessages: number;
  error?: string;
}

/**
 * Internal entry with child process reference
 */
interface AppEntry extends MessageApp {
  childProcess?: ChildProcess;
  messageQueue: unknown[];
}

/**
 * MQTT client interface (minimal)
 */
interface MqttClient {
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
  on(event: 'message', handler: (topic: string, payload: Buffer) => void): void;
  off(event: 'message', handler: (topic: string, payload: Buffer) => void): void;
}

/**
 * Events emitted by MessageAppManager
 */
export interface MessageAppManagerEvents {
  'app:registered': (config: MessageAppConfig) => void;
  'app:triggered': (name: string, payload: unknown) => void;
  'app:started': (app: MessageApp) => void;
  'app:completed': (app: MessageApp & { exitCode: number }) => void;
  'app:failed': (app: MessageApp, error: Error) => void;
  'app:output': (name: string, data: string, stream: 'stdout' | 'stderr') => void;
}

/**
 * Options for MessageAppManager
 */
export interface MessageAppManagerOptions {
  mqttClient: MqttClient;
}

/**
 * Manages message-triggered applications
 */
export class MessageAppManager extends EventEmitter {
  private apps: Map<string, AppEntry> = new Map();
  private mqttClient: MqttClient;
  private messageHandler: (topic: string, payload: Buffer) => void;

  constructor(options: MessageAppManagerOptions) {
    super();
    this.mqttClient = options.mqttClient;
    this.messageHandler = this.handleMessage.bind(this);
    this.mqttClient.on('message', this.messageHandler);
  }

  /**
   * Register a message-triggered app configuration
   */
  register(config: MessageAppConfig): void {
    // Validate required fields
    if (!config.name) {
      throw new Error('Message app name is required');
    }
    if (!config.trigger) {
      throw new Error('Message app trigger topic is required');
    }
    if (!config.command) {
      throw new Error('Message app command is required');
    }

    // Check for duplicates
    if (this.apps.has(config.name)) {
      throw new Error(`Message app '${config.name}' is already registered`);
    }

    // Apply defaults
    const normalizedConfig: MessageAppConfig = {
      ...config,
      args: config.args ?? [],
      concurrency: config.concurrency ?? 'queue',
    };

    // Create app entry
    const entry: AppEntry = {
      name: config.name,
      config: normalizedConfig,
      state: 'idle',
      triggerCount: 0,
      queuedMessages: 0,
      messageQueue: [],
    };

    this.apps.set(config.name, entry);

    // Subscribe to trigger topic
    this.mqttClient.subscribe(config.trigger);

    this.emit('app:registered', normalizedConfig);
  }

  /**
   * Get all registered app configurations
   */
  getRegisteredApps(): MessageAppConfig[] {
    return Array.from(this.apps.values()).map(entry => entry.config);
  }

  /**
   * Get status of a specific app
   */
  getAppStatus(name: string): MessageApp | undefined {
    const entry = this.apps.get(name);
    return entry ? this.toMessageApp(entry) : undefined;
  }

  /**
   * Get status of all apps
   */
  getAllAppStatuses(): MessageApp[] {
    return Array.from(this.apps.values()).map(entry => this.toMessageApp(entry));
  }

  /**
   * Stop all running apps
   */
  async stopAll(): Promise<void> {
    const stopPromises = Array.from(this.apps.values())
      .filter(entry => entry.state === 'running')
      .map(entry => this.stopApp(entry));

    await Promise.all(stopPromises);
  }

  /**
   * Clear all registered apps
   */
  clear(): void {
    // Unsubscribe from all topics
    for (const entry of this.apps.values()) {
      this.mqttClient.unsubscribe(entry.config.trigger);
    }
    this.apps.clear();
  }

  /**
   * Handle incoming MQTT message
   */
  private handleMessage(topic: string, payload: Buffer): void {
    // Find app matching this topic
    for (const entry of this.apps.values()) {
      if (entry.config.trigger === topic) {
        this.triggerApp(entry, payload);
        break;
      }
    }
  }

  /**
   * Trigger an app with a message
   */
  private triggerApp(entry: AppEntry, payload: Buffer): void {
    // Parse payload
    let parsedPayload: unknown;
    try {
      const payloadStr = payload.toString();
      parsedPayload = payloadStr ? JSON.parse(payloadStr) : {};
    } catch {
      parsedPayload = { raw: payload.toString() };
    }

    entry.triggerCount++;
    entry.lastTriggerPayload = parsedPayload;

    // Handle based on concurrency mode
    const concurrency = entry.config.concurrency ?? 'queue';

    if (entry.state === 'running') {
      switch (concurrency) {
        case 'queue':
          entry.messageQueue.push(parsedPayload);
          entry.queuedMessages = entry.messageQueue.length;
          return;
        case 'ignore':
          // Simply ignore the message
          return;
        case 'spawn':
          // Spawn a new instance (parallel)
          break;
      }
    }

    this.emit('app:triggered', entry.name, parsedPayload);
    this.startApp(entry, parsedPayload);
  }

  /**
   * Start the app
   */
  private startApp(entry: AppEntry, payload: unknown): void {
    const config = entry.config;
    const workingDirectory = config.workingDirectory ?? process.cwd();

    // Serialize payload for environment variable
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);

    // Merge environment variables
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...config.environment,
      WOS_APP_NAME: config.name,
      WOS_TRIGGER_TOPIC: config.trigger,
      WOS_MESSAGE_PAYLOAD: payloadStr,
    };

    try {
      const childProcess = spawn(config.command, config.args ?? [], {
        cwd: workingDirectory,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      entry.childProcess = childProcess;
      entry.pid = childProcess.pid;
      entry.state = 'running';
      entry.lastTriggeredAt = new Date();

      // Set up event handlers
      this.setupProcessHandlers(entry, childProcess);

      if (childProcess.pid) {
        this.emit('app:started', this.toMessageApp(entry));
      }
    } catch (error) {
      entry.state = 'idle';
      entry.error = (error as Error).message;
      this.emit('app:failed', this.toMessageApp(entry), error as Error);
    }
  }

  /**
   * Stop a single app
   */
  private async stopApp(entry: AppEntry): Promise<void> {
    if (!entry.childProcess) {
      entry.state = 'idle';
      return;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        entry.childProcess?.kill('SIGKILL');
      }, 5000);

      entry.childProcess?.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

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
      entry.lastCompletedAt = new Date();
      entry.childProcess = undefined;
      entry.pid = undefined;

      const exitCode = code ?? (signal ? -1 : 0);

      this.emit('app:completed', {
        ...this.toMessageApp(entry),
        exitCode,
      });

      // Process queued messages
      if (entry.messageQueue.length > 0) {
        const nextPayload = entry.messageQueue.shift();
        entry.queuedMessages = entry.messageQueue.length;
        this.startApp(entry, nextPayload);
      } else {
        entry.state = 'idle';
      }
    });

    // Handle process error
    childProcess.on('error', (error) => {
      entry.state = 'idle';
      entry.error = error.message;
      entry.childProcess = undefined;
      entry.pid = undefined;

      this.emit('app:failed', this.toMessageApp(entry), error);
    });
  }

  /**
   * Convert internal entry to public MessageApp
   */
  private toMessageApp(entry: AppEntry): MessageApp {
    return {
      name: entry.name,
      config: entry.config,
      state: entry.state,
      pid: entry.pid,
      lastTriggeredAt: entry.lastTriggeredAt,
      lastCompletedAt: entry.lastCompletedAt,
      lastTriggerPayload: entry.lastTriggerPayload,
      exitCode: entry.exitCode,
      triggerCount: entry.triggerCount,
      queuedMessages: entry.queuedMessages,
      error: entry.error,
    };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.mqttClient.off('message', this.messageHandler);
    this.clear();
  }
}
