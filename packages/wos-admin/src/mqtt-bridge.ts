/**
 * MQTT-WebSocket Bridge
 *
 * Story 7.6: MQTT-WebSocket Bridge
 *
 * Bridges MQTT messages to WebSocket clients for real-time
 * updates in the admin UI.
 */

import { EventEmitter } from 'events';

/**
 * MQTT client interface (minimal subset we need)
 */
export interface MQTTClient {
  subscribe(topic: string, callback: (topic: string, payload: Buffer) => void): void;
  unsubscribe(topic: string): void;
  publish(topic: string, payload: string | Buffer): void;
  connected: boolean;
}

/**
 * WebSocket client interface
 */
export interface WebSocketClient {
  send(data: string): void;
  close(): void;
  readyState: number;
  on(event: 'message', handler: (data: string) => void): void;
  on(event: 'close', handler: () => void): void;
  on(event: 'error', handler: (error: Error) => void): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

/**
 * Bridge options
 */
export interface MQTTBridgeOptions {
  mqttClient: MQTTClient;
  topicPrefix?: string;
}

/**
 * Connected client tracking
 */
interface ConnectedClient {
  ws: WebSocketClient;
  username: string;
  subscriptions: Set<string>;
}

/**
 * Message from WebSocket client
 */
interface ClientMessage {
  action: 'subscribe' | 'unsubscribe' | 'publish' | 'ping';
  topic?: string;
  payload?: unknown;
}

/**
 * Message to WebSocket client
 */
interface ServerMessage {
  type: 'message' | 'pong' | 'error' | 'notification';
  topic?: string;
  payload?: unknown;
  timestamp?: number;
  error?: string;
  message?: string;
}

/**
 * MQTT-WebSocket Bridge
 *
 * Bridges MQTT messages to WebSocket clients for real-time updates.
 */
export class MQTTBridge extends EventEmitter {
  private mqttClient: MQTTClient;
  private topicPrefix: string;
  private clients: Map<WebSocketClient, ConnectedClient> = new Map();
  private topicSubscribers: Map<string, Set<WebSocketClient>> = new Map();
  private mqttCallbacks: Map<string, (topic: string, payload: Buffer) => void> = new Map();

  constructor(options: MQTTBridgeOptions) {
    super();
    this.mqttClient = options.mqttClient;
    this.topicPrefix = options.topicPrefix ?? 'wos/';
  }

  /**
   * Add a WebSocket client to the bridge
   */
  addClient(ws: WebSocketClient, username: string): void {
    const client: ConnectedClient = {
      ws,
      username,
      subscriptions: new Set(),
    };

    this.clients.set(ws, client);

    // Handle messages from client
    ws.on('message', (data: string) => {
      this.handleClientMessage(ws, data);
    });

    // Handle client disconnect
    ws.on('close', () => {
      this.removeClient(ws);
    });

    ws.on('error', () => {
      this.removeClient(ws);
    });
  }

  /**
   * Remove a WebSocket client from the bridge
   */
  private removeClient(ws: WebSocketClient): void {
    const client = this.clients.get(ws);
    if (!client) return;

    // Unsubscribe from all topics
    for (const topic of client.subscriptions) {
      this.unsubscribeFromTopic(ws, topic);
    }

    this.clients.delete(ws);
  }

  /**
   * Get the number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Handle a message from a WebSocket client
   */
  private handleClientMessage(ws: WebSocketClient, data: string): void {
    let message: ClientMessage;

    try {
      message = JSON.parse(data);
    } catch {
      this.sendError(ws, 'Invalid JSON message');
      return;
    }

    switch (message.action) {
      case 'subscribe':
        if (message.topic) {
          this.handleSubscribe(ws, message.topic);
        }
        break;

      case 'unsubscribe':
        if (message.topic) {
          this.handleUnsubscribe(ws, message.topic);
        }
        break;

      case 'publish':
        if (message.topic) {
          this.handlePublish(ws, message.topic, message.payload);
        }
        break;

      case 'ping':
        this.sendMessage(ws, { type: 'pong', timestamp: Date.now() });
        break;

      default:
        this.sendError(ws, `Unknown action: ${message.action}`);
    }
  }

  /**
   * Handle subscribe request
   */
  private handleSubscribe(ws: WebSocketClient, topic: string): void {
    // Validate topic
    if (!this.isTopicAllowed(topic)) {
      this.sendError(ws, `Topic not allowed: ${topic}`);
      return;
    }

    const client = this.clients.get(ws);
    if (!client) return;

    // Track subscription for this client
    client.subscriptions.add(topic);

    // Add to topic subscribers
    if (!this.topicSubscribers.has(topic)) {
      this.topicSubscribers.set(topic, new Set());

      // Subscribe to MQTT topic
      const callback = (mqttTopic: string, payload: Buffer) => {
        this.handleMQTTMessage(topic, mqttTopic, payload);
      };
      this.mqttCallbacks.set(topic, callback);
      this.mqttClient.subscribe(topic, callback);
    }

    this.topicSubscribers.get(topic)!.add(ws);
  }

  /**
   * Handle unsubscribe request
   */
  private handleUnsubscribe(ws: WebSocketClient, topic: string): void {
    this.unsubscribeFromTopic(ws, topic);
  }

  /**
   * Unsubscribe a client from a topic
   */
  private unsubscribeFromTopic(ws: WebSocketClient, topic: string): void {
    const client = this.clients.get(ws);
    if (client) {
      client.subscriptions.delete(topic);
    }

    const subscribers = this.topicSubscribers.get(topic);
    if (subscribers) {
      subscribers.delete(ws);

      // If no more subscribers, unsubscribe from MQTT
      if (subscribers.size === 0) {
        this.topicSubscribers.delete(topic);
        this.mqttClient.unsubscribe(topic);
        this.mqttCallbacks.delete(topic);
      }
    }
  }

  /**
   * Handle publish request
   */
  private handlePublish(ws: WebSocketClient, topic: string, payload: unknown): void {
    // Validate topic
    if (!this.isTopicAllowed(topic)) {
      this.sendError(ws, `Topic not allowed: ${topic}`);
      return;
    }

    const client = this.clients.get(ws);
    if (!client) return;

    // Add sender info to payload
    const enrichedPayload = {
      ...(typeof payload === 'object' && payload !== null ? payload : { value: payload }),
      _sender: client.username,
    };

    this.mqttClient.publish(topic, JSON.stringify(enrichedPayload));
  }

  /**
   * Handle incoming MQTT message
   */
  private handleMQTTMessage(subscriptionPattern: string, topic: string, payload: Buffer): void {
    const subscribers = this.topicSubscribers.get(subscriptionPattern);
    if (!subscribers || subscribers.size === 0) return;

    // Parse payload
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(payload.toString());
    } catch {
      parsedPayload = payload.toString();
    }

    // Create message
    const message: ServerMessage = {
      type: 'message',
      topic,
      payload: parsedPayload,
      timestamp: Date.now(),
    };

    // Send to all subscribers
    for (const ws of subscribers) {
      this.sendMessage(ws, message);
    }
  }

  /**
   * Check if a topic is allowed
   */
  private isTopicAllowed(topic: string): boolean {
    return topic.startsWith(this.topicPrefix);
  }

  /**
   * Send a message to a WebSocket client
   */
  private sendMessage(ws: WebSocketClient, message: ServerMessage): void {
    if (ws.readyState === 1) { // OPEN
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send an error to a WebSocket client
   */
  private sendError(ws: WebSocketClient, error: string): void {
    this.sendMessage(ws, { type: 'error', error });
  }

  /**
   * Broadcast a message to all connected clients
   */
  broadcast(message: Omit<ServerMessage, 'timestamp'>): void {
    const fullMessage: ServerMessage = {
      ...message,
      timestamp: Date.now(),
    };

    for (const { ws } of this.clients.values()) {
      this.sendMessage(ws, fullMessage);
    }
  }

  /**
   * Close all client connections
   */
  close(): void {
    for (const { ws } of this.clients.values()) {
      ws.close();
    }
    this.clients.clear();
    this.topicSubscribers.clear();
  }
}
