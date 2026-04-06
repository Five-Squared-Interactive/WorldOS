// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

/**
 * RosbridgeConnection - WebSocket connection to a rosbridge v2.0 server
 *
 * Manages connection lifecycle, automatic reconnection with exponential backoff,
 * and subscription/advertise state tracking for reconnect recovery.
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import type {
  ConnectionState,
  ConnectionConfig,
  RosbridgeMessage,
  SubscribeOp,
  AdvertiseOp,
  UnadvertiseOp,
} from './types/rosbridge.js';

export interface RosbridgeConnectionEvents {
  connected: [];
  disconnected: [];
  reconnecting: [attempt: number, maxAttempts: number, delayMs: number];
  message: [message: RosbridgeMessage];
  error: [error: Error];
}

/**
 * Tracked subscription for replay on reconnect
 */
interface TrackedSubscription {
  topic: string;
  type: string;
  throttle_rate?: number;
}

/**
 * Tracked advertise for replay on reconnect
 */
interface TrackedAdvertise {
  topic: string;
  type: string;
}

export class RosbridgeConnection extends EventEmitter {
  readonly robotName: string;
  private config: ConnectionConfig;
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'disconnected';
  private reconnectAttempt = 0;
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private maxReconnectAttempts: number;
  private maxReconnectDelay: number;
  private connectedSince: number | null = null;
  // Latency measurement is not yet implemented (requires rosbridge ping/pong)
  // getLatency() returns null until a measurement mechanism is added.

  private trackedSubscriptions = new Map<string, TrackedSubscription>();
  private trackedAdvertises = new Map<string, TrackedAdvertise>();

  constructor(
    robotName: string,
    config: ConnectionConfig,
    options?: { maxReconnectAttempts?: number; maxReconnectDelay?: number },
  ) {
    super();
    this.robotName = robotName;
    this.config = config;
    this.maxReconnectAttempts = options?.maxReconnectAttempts ?? 10;
    this.maxReconnectDelay = options?.maxReconnectDelay ?? 30000;
  }

  getState(): ConnectionState {
    return this.state;
  }

  getUrl(): string {
    return this.config.url;
  }

  getLatency(): number | null {
    // Not yet implemented — requires rosbridge ping/pong mechanism
    return null;
  }

  getConnectedSince(): number | null {
    return this.connectedSince;
  }

  getSubscribedTopics(): string[] {
    return Array.from(this.trackedSubscriptions.keys());
  }

  getAdvertisedTopics(): string[] {
    return Array.from(this.trackedAdvertises.keys());
  }

  /**
   * Connect to rosbridge server
   */
  async connect(): Promise<void> {
    if (this.state === 'connected') return;

    this.setState('connecting');
    this.reconnectAttempt = 0;
    let initialConnectRejected = false;

    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.url);

        this.ws.on('open', () => {
          this.reconnectAttempt = 0;
          this.connectedSince = Date.now();
          this.setState('connected');
          this.emit('connected');
          resolve();
        });

        this.ws.on('close', () => {
          // Don't attempt reconnect if initial connect failed
          if (initialConnectRejected) {
            this.ws = null;
            return;
          }
          this.handleDisconnect();
        });

        this.ws.on('error', (error: Error) => {
          if (this.state === 'connecting' && this.reconnectAttempt === 0) {
            initialConnectRejected = true;
            this.setState('disconnected');
            reject(new Error(`Failed to connect to rosbridge at ${this.config.url}: ${error.message}`));
          } else {
            this.emit('error', error);
          }
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data.toString());
        });
      } catch (error) {
        this.setState('disconnected');
        reject(error);
      }
    });
  }

  /**
   * Disconnect from rosbridge server
   */
  disconnect(): void {
    this.cancelReconnect();

    if (this.ws) {
      this.ws.removeAllListeners('close');
      this.ws.close();
      this.ws = null;
    }

    this.connectedSince = null;
    this.setState('disconnected');
    this.emit('disconnected');
  }

  /**
   * Send a message to rosbridge
   */
  send(message: Record<string, unknown>): boolean {
    if (this.state !== 'connected' || !this.ws) {
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Subscribe to a ROS topic via rosbridge
   */
  subscribeTopic(topic: string, type: string, throttleRate?: number): boolean {
    // Track for reconnect replay
    this.trackedSubscriptions.set(topic, { topic, type, throttle_rate: throttleRate });

    const op: SubscribeOp = { op: 'subscribe', topic, type };
    if (throttleRate !== undefined) {
      op.throttle_rate = throttleRate;
    }
    return this.send(op as unknown as Record<string, unknown>);
  }

  /**
   * Unsubscribe from a ROS topic
   */
  unsubscribeTopic(topic: string): boolean {
    this.trackedSubscriptions.delete(topic);
    return this.send({ op: 'unsubscribe', topic });
  }

  /**
   * Advertise a ROS topic (required before publishing)
   */
  advertise(topic: string, type: string): boolean {
    if (this.trackedAdvertises.has(topic)) return true; // Already advertised
    this.trackedAdvertises.set(topic, { topic, type });

    const op: AdvertiseOp = { op: 'advertise', topic, type };
    return this.send(op as unknown as Record<string, unknown>);
  }

  /**
   * Unadvertise a ROS topic
   */
  unadvertise(topic: string): boolean {
    this.trackedAdvertises.delete(topic);
    const op: UnadvertiseOp = { op: 'unadvertise', topic };
    return this.send(op as unknown as Record<string, unknown>);
  }

  /**
   * Publish a message to a ROS topic (must advertise first)
   */
  publishToRos(topic: string, msg: unknown): boolean {
    return this.send({ op: 'publish', topic, msg });
  }

  /**
   * Call a ROS service
   */
  callService(service: string, args?: unknown, id?: string): boolean {
    const op: Record<string, unknown> = { op: 'call_service', service };
    if (args !== undefined) op.args = args;
    if (id !== undefined) op.id = id;
    return this.send(op);
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as RosbridgeMessage;
      this.emit('message', message);
    } catch {
      this.emit('error', new Error(`Unparseable rosbridge message: ${data.slice(0, 200)}`));
    }
  }

  private handleDisconnect(): void {
    this.ws = null;
    this.connectedSince = null;

    if (this.state === 'disconnected') return; // Intentional disconnect

    this.attemptReconnect();
  }

  private attemptReconnect(): void {
    this.reconnectAttempt++;

    if (this.reconnectAttempt > this.maxReconnectAttempts) {
      this.setState('disconnected');
      this.emit('disconnected');
      return;
    }

    const delay = this.calculateBackoffDelay(this.reconnectAttempt);
    this.setState('reconnecting');
    this.emit('reconnecting', this.reconnectAttempt, this.maxReconnectAttempts, delay);

    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectTimeoutId = null;

      try {
        this.ws = new WebSocket(this.config.url);

        this.ws.on('open', () => {
          this.reconnectAttempt = 0;
          this.connectedSince = Date.now();
          this.setState('connected');
          this.emit('connected');
          this.replayTrackedState();
        });

        this.ws.on('close', () => {
          this.handleDisconnect();
        });

        this.ws.on('error', () => {
          // Errors during reconnect are expected (ECONNREFUSED etc.)
          // The close event will follow and trigger the next reconnect attempt
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data.toString());
        });
      } catch {
        this.attemptReconnect();
      }
    }, delay);
  }

  /**
   * Replay all tracked subscriptions and advertises after reconnect
   */
  private replayTrackedState(): void {
    for (const sub of this.trackedSubscriptions.values()) {
      const op: SubscribeOp = { op: 'subscribe', topic: sub.topic, type: sub.type };
      if (sub.throttle_rate !== undefined) op.throttle_rate = sub.throttle_rate;
      this.send(op as unknown as Record<string, unknown>);
    }

    for (const adv of this.trackedAdvertises.values()) {
      const op: AdvertiseOp = { op: 'advertise', topic: adv.topic, type: adv.type };
      this.send(op as unknown as Record<string, unknown>);
    }
  }

  private calculateBackoffDelay(attempt: number): number {
    const baseDelay = 1000;
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    return Math.min(exponentialDelay, this.maxReconnectDelay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimeoutId !== null) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
  }

  private setState(newState: ConnectionState): void {
    if (this.state === newState) return;
    this.state = newState;
  }
}
