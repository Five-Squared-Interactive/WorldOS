// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

/**
 * Mock Rosbridge Server for integration testing
 *
 * WebSocket server that implements a subset of rosbridge v2.0 protocol:
 * subscribe, publish, call_service/service_response, advertise/unadvertise
 */

import { WebSocketServer, WebSocket } from 'ws';

export interface MockServerOptions {
  port?: number;
  latencyMs?: number;
}

export class MockRosbridgeServer {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private subscriptions = new Map<string, Set<WebSocket>>();
  private serviceHandlers = new Map<string, (args: unknown) => { result: boolean; values?: unknown }>();
  private latencyMs: number;
  private _port = 0;

  constructor(options: MockServerOptions = {}) {
    this.latencyMs = options.latencyMs ?? 0;
  }

  get port(): number {
    return this._port;
  }

  get url(): string {
    return `ws://127.0.0.1:${this._port}`;
  }

  /**
   * Start the mock server
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: 0 }, () => {
        const addr = this.wss!.address();
        this._port = typeof addr === 'object' ? addr.port : 0;
        resolve();
      });

      this.wss.on('connection', (ws) => {
        this.clients.add(ws);

        ws.on('message', (data) => {
          this.handleMessage(ws, JSON.parse(data.toString()));
        });

        ws.on('close', () => {
          this.clients.delete(ws);
          // Remove from subscriptions
          for (const subs of this.subscriptions.values()) {
            subs.delete(ws);
          }
        });
      });
    });
  }

  /**
   * Stop the mock server
   */
  async stop(): Promise<void> {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => resolve());
        this.wss = null;
      } else {
        resolve();
      }
    });
  }

  /**
   * Publish a message to all subscribers of a topic
   */
  publishToSubscribers(topic: string, msg: unknown): void {
    const subs = this.subscriptions.get(topic);
    if (!subs) return;

    const message = JSON.stringify({ op: 'publish', topic, msg });
    for (const ws of subs) {
      if (ws.readyState === WebSocket.OPEN) {
        if (this.latencyMs > 0) {
          setTimeout(() => ws.send(message), this.latencyMs);
        } else {
          ws.send(message);
        }
      }
    }
  }

  /**
   * Register a service handler
   */
  onService(service: string, handler: (args: unknown) => { result: boolean; values?: unknown }): void {
    this.serviceHandlers.set(service, handler);
  }

  /**
   * Disconnect all clients (simulate server failure)
   */
  disconnectAll(): void {
    for (const client of this.clients) {
      client.close();
    }
  }

  /**
   * Get current number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  private handleMessage(ws: WebSocket, msg: Record<string, unknown>): void {
    switch (msg.op) {
      case 'subscribe':
        this.handleSubscribe(ws, msg.topic as string);
        break;

      case 'unsubscribe':
        this.handleUnsubscribe(ws, msg.topic as string);
        break;

      case 'advertise':
      case 'unadvertise':
        // Acknowledge silently
        break;

      case 'publish':
        // Could forward to other subscribers, but for testing we just acknowledge
        break;

      case 'call_service':
        this.handleCallService(ws, msg);
        break;
    }
  }

  private handleSubscribe(ws: WebSocket, topic: string): void {
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Set());
    }
    this.subscriptions.get(topic)!.add(ws);
  }

  private handleUnsubscribe(ws: WebSocket, topic: string): void {
    this.subscriptions.get(topic)?.delete(ws);
  }

  private handleCallService(ws: WebSocket, msg: Record<string, unknown>): void {
    const service = msg.service as string;
    const args = msg.args;
    const id = msg.id as string | undefined;

    const handler = this.serviceHandlers.get(service);
    const response = handler
      ? handler(args)
      : { result: false };

    const responseMsg = JSON.stringify({
      op: 'service_response',
      service,
      ...response,
      id,
    });

    if (this.latencyMs > 0) {
      setTimeout(() => ws.send(responseMsg), this.latencyMs);
    } else {
      ws.send(responseMsg);
    }
  }
}
