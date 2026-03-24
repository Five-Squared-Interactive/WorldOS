/**
 * Plugin SDK MQTT Client
 *
 * Provides an MQTT client for plugins to communicate with the WorldOS server.
 * Automatically connects using the WOS_MQTT_URL environment variable.
 */
import { EventEmitter } from 'events';
import mqtt, { type MqttClient, type IClientOptions } from 'mqtt';

/**
 * Options for the plugin MQTT client
 */
export interface PluginMqttClientOptions {
  /** Override the MQTT URL (defaults to WOS_MQTT_URL env var) */
  url?: string;
  /** Custom client ID (defaults to plugin-{WOS_PLUGIN_NAME}-{random}) */
  clientId?: string;
  /** Auto-connect on construction (default: true) */
  autoConnect?: boolean;
  /** Connection timeout in ms (default: 10000) */
  connectTimeout?: number;
  /** Reconnect on disconnect (default: true) */
  reconnect?: boolean;
}

/**
 * Message received from MQTT
 */
export interface PluginMessage<T = unknown> {
  topic: string;
  payload: T;
  timestamp: number;
}

/**
 * Request message format for request/response pattern
 */
export interface RequestMessage<T = unknown> {
  correlationId: string;
  timestamp: number;
  payload: T;
}

/**
 * Response message format for request/response pattern
 */
export interface ResponseMessage<T = unknown> {
  correlationId: string;
  timestamp: number;
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Message handler callback for subscriptions
 */
export type MessageHandler<T = unknown> = (
  message: PluginMessage<T>,
) => void | Promise<void>;

/**
 * Options for request method
 */
export interface RequestOptions {
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
}

interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * MQTT client for WorldOS plugins
 */
export class PluginMqttClient extends EventEmitter {
  private client: MqttClient | null = null;
  private _url: string;
  private _clientId: string;
  private _pluginName: string;
  private _options: IClientOptions;
  private _isConnected = false;
  private _isConnecting = false;
  private connectPromise: Promise<void> | null = null;
  private subscriptions = new Set<string>();
  private handlers = new Map<string, MessageHandler[]>();
  private pendingRequests = new Map<
    string,
    PendingRequest<ResponseMessage>
  >();

  constructor(options: PluginMqttClientOptions = {}) {
    super();

    // Get MQTT URL from environment or options
    this._url = options.url ?? process.env.WOS_MQTT_URL ?? '';
    if (!this._url) {
      throw new Error(
        'MQTT URL not provided. Set WOS_MQTT_URL environment variable or pass url option.',
      );
    }

    // Get plugin name from environment
    this._pluginName = process.env.WOS_PLUGIN_NAME ?? 'unknown-plugin';

    // Generate client ID
    this._clientId =
      options.clientId ??
      `plugin-${this._pluginName}-${Math.random().toString(36).slice(2, 8)}`;

    this._options = {
      clientId: this._clientId,
      reconnectPeriod: options.reconnect !== false ? 1000 : 0,
      connectTimeout: options.connectTimeout ?? 10000,
    };

    // Auto-connect unless disabled
    if (options.autoConnect !== false) {
      this.connect().catch((error) => {
        this.emit('error', error);
      });
    }
  }

  /**
   * Connect to the MQTT broker
   */
  async connect(): Promise<void> {
    if (this._isConnected) {
      return;
    }

    if (this._isConnecting && this.connectPromise) {
      return this.connectPromise;
    }

    this._isConnecting = true;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.client = mqtt.connect(this._url, this._options);

      const onConnect = (): void => {
        this._isConnected = true;
        this._isConnecting = false;
        this.setupMessageHandler();
        this.emit('connected');
        resolve();
      };

      const onError = (error: Error): void => {
        this._isConnected = false;
        this._isConnecting = false;
        this.emit('error', error);
        reject(error);
      };

      this.client.once('connect', onConnect);
      this.client.once('error', onError);

      this.client.on('close', () => {
        this._isConnected = false;
        this.emit('disconnected');
      });

      this.client.on('reconnect', () => {
        this.emit('reconnecting');
      });
    });

    return this.connectPromise;
  }

  private setupMessageHandler(): void {
    if (!this.client) return;

    this.client.on('message', (topic: string, payload: Buffer) => {
      let parsedPayload: unknown;
      try {
        parsedPayload = JSON.parse(payload.toString());
      } catch {
        parsedPayload = payload.toString();
      }

      const message: PluginMessage = {
        topic,
        payload: parsedPayload,
        timestamp: Date.now(),
      };

      // Emit general message event
      this.emit('message', message);

      // Check for pending request response
      if (typeof parsedPayload === 'object' && parsedPayload !== null) {
        const response = parsedPayload as ResponseMessage;
        if (
          response.correlationId &&
          this.pendingRequests.has(response.correlationId)
        ) {
          const pending = this.pendingRequests.get(response.correlationId)!;
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(response.correlationId);
          pending.resolve(response);
          return;
        }
      }

      // Dispatch to registered handlers
      this.dispatchToHandlers(topic, message);
    });
  }

  /**
   * Dispatch message to matching handlers
   */
  private dispatchToHandlers(topic: string, message: PluginMessage): void {
    for (const [pattern, handlerList] of this.handlers.entries()) {
      if (this.topicMatches(pattern, topic)) {
        for (const handler of handlerList) {
          try {
            const result = handler(message);
            if (result instanceof Promise) {
              result.catch((error) => {
                this.emit('error', error);
              });
            }
          } catch (error) {
            this.emit('error', error);
          }
        }
      }
    }
  }

  /**
   * Check if topic matches pattern (supports + and # wildcards)
   */
  private topicMatches(pattern: string, topic: string): boolean {
    const patternParts = pattern.split('/');
    const topicParts = topic.split('/');

    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i];

      if (patternPart === '#') {
        // # matches everything after this point
        return true;
      }

      if (i >= topicParts.length) {
        return false;
      }

      if (patternPart !== '+' && patternPart !== topicParts[i]) {
        return false;
      }
    }

    return patternParts.length === topicParts.length;
  }

  /**
   * Disconnect from the MQTT broker
   */
  async disconnect(): Promise<void> {
    if (!this.client || !this._isConnected) {
      return;
    }

    return new Promise<void>((resolve) => {
      this.client!.end(false, {}, () => {
        this._isConnected = false;
        this.client = null;
        this.subscriptions.clear();
        resolve();
      });
    });
  }

  /**
   * Subscribe to a topic within the plugin's namespace
   *
   * @param path - Topic path segments (joined with /)
   */
  async subscribe(...path: string[]): Promise<void> {
    await this.ensureConnected();
    const topic = this.buildPluginTopic(...path);

    return new Promise<void>((resolve, reject) => {
      this.client!.subscribe(topic, (error) => {
        if (error) {
          reject(error);
        } else {
          this.subscriptions.add(topic);
          resolve();
        }
      });
    });
  }

  /**
   * Subscribe to a raw topic (not within plugin namespace)
   */
  async subscribeRaw(topic: string): Promise<void> {
    await this.ensureConnected();

    return new Promise<void>((resolve, reject) => {
      this.client!.subscribe(topic, (error) => {
        if (error) {
          reject(error);
        } else {
          this.subscriptions.add(topic);
          resolve();
        }
      });
    });
  }

  /**
   * Unsubscribe from a topic within the plugin's namespace
   */
  async unsubscribe(...path: string[]): Promise<void> {
    await this.ensureConnected();
    const topic = this.buildPluginTopic(...path);

    return new Promise<void>((resolve, reject) => {
      this.client!.unsubscribe(topic, (error?: Error) => {
        if (error) {
          reject(error);
        } else {
          this.subscriptions.delete(topic);
          resolve();
        }
      });
    });
  }

  /**
   * Subscribe to a topic with a typed message handler
   *
   * @param topic - Topic to subscribe to (can include + and # wildcards)
   * @param handler - Handler function called when messages arrive
   */
  async subscribeWithHandler<T = unknown>(
    topic: string,
    handler: MessageHandler<T>,
  ): Promise<void> {
    await this.ensureConnected();

    // Register handler
    if (!this.handlers.has(topic)) {
      this.handlers.set(topic, []);
    }
    this.handlers.get(topic)!.push(handler as MessageHandler);

    // Subscribe to topic if not already subscribed
    if (!this.subscriptions.has(topic)) {
      return new Promise<void>((resolve, reject) => {
        this.client!.subscribe(topic, (error) => {
          if (error) {
            reject(error);
          } else {
            this.subscriptions.add(topic);
            resolve();
          }
        });
      });
    }
  }

  /**
   * Send a request and wait for response
   *
   * @param topic - Topic to send request to
   * @param payload - Request payload
   * @param options - Request options (timeout)
   * @returns Promise resolving with the response
   */
  async request<TRequest = unknown, TResponse = unknown>(
    topic: string,
    payload: TRequest,
    options: RequestOptions = {},
  ): Promise<ResponseMessage<TResponse>> {
    await this.ensureConnected();

    const timeout = options.timeout ?? 30000;
    const correlationId = this.generateCorrelationId();
    const responseTopic = `${this.buildPluginTopic()}/response/${correlationId}`;

    // Subscribe to response topic
    await this.subscribeRaw(responseTopic);

    return new Promise<ResponseMessage<TResponse>>((resolve, reject) => {
      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        this.client?.unsubscribe(responseTopic);
        reject(new Error('Request timeout'));
      }, timeout);

      // Register pending request
      this.pendingRequests.set(correlationId, {
        resolve: resolve as (value: ResponseMessage) => void,
        reject,
        timeout: timeoutHandle,
      });

      // Send request
      const requestMessage: RequestMessage = {
        correlationId,
        timestamp: Date.now(),
        payload: {
          ...(payload as Record<string, unknown>),
          correlationId,
          responseTopic,
        },
      };

      this.publishRaw(topic, requestMessage.payload).catch((error) => {
        clearTimeout(timeoutHandle);
        this.pendingRequests.delete(correlationId);
        reject(error);
      });
    });
  }

  /**
   * Generate a unique correlation ID
   */
  private generateCorrelationId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Publish a message to a topic within the plugin's namespace
   */
  async publish<T>(path: string[], payload: T): Promise<void> {
    await this.ensureConnected();
    const topic = this.buildPluginTopic(...path);
    const message = JSON.stringify(payload);

    return new Promise<void>((resolve, reject) => {
      this.client!.publish(topic, message, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Publish a message to a raw topic (not within plugin namespace)
   */
  async publishRaw<T>(topic: string, payload: T): Promise<void> {
    await this.ensureConnected();
    const message = JSON.stringify(payload);

    return new Promise<void>((resolve, reject) => {
      this.client!.publish(topic, message, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Respond to a request with success
   */
  async respond<T>(
    responseTopic: string,
    correlationId: string,
    data: T,
  ): Promise<void> {
    const response: ResponseMessage<T> = {
      correlationId,
      timestamp: Date.now(),
      success: true,
      data,
    };
    return this.publishRaw(responseTopic, response);
  }

  /**
   * Respond to a request with an error
   */
  async respondError(
    responseTopic: string,
    correlationId: string,
    code: string,
    message: string,
    details?: unknown,
  ): Promise<void> {
    const response: ResponseMessage = {
      correlationId,
      timestamp: Date.now(),
      success: false,
      error: { code, message, details },
    };
    return this.publishRaw(responseTopic, response);
  }

  /**
   * Build a topic within the plugin's namespace
   */
  buildPluginTopic(...path: string[]): string {
    if (path.length === 0) {
      return `wos/plugin/${this._pluginName}`;
    }
    return `wos/plugin/${this._pluginName}/${path.join('/')}`;
  }

  /**
   * Ensure client is connected before operations
   */
  private async ensureConnected(): Promise<void> {
    if (!this._isConnected) {
      if (this._isConnecting && this.connectPromise) {
        await this.connectPromise;
      } else {
        await this.connect();
      }
    }
  }

  /**
   * Get connection status
   */
  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Get the client ID
   */
  get clientId(): string {
    return this._clientId;
  }

  /**
   * Get the plugin name
   */
  get pluginName(): string {
    return this._pluginName;
  }

  /**
   * Get the broker URL
   */
  get url(): string {
    return this._url;
  }

  /**
   * Get subscribed topics
   */
  get subscribedTopics(): string[] {
    return Array.from(this.subscriptions);
  }
}
