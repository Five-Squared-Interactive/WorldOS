/**
 * MQTT-WebSocket Bridge Tests
 *
 * Story 7.6: MQTT-WebSocket Bridge
 *
 * Tests for bridging MQTT messages to WebSocket clients
 * for real-time updates in the admin UI.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { MQTTBridge, MQTTBridgeOptions, WebSocketClient } from './mqtt-bridge.js';

/**
 * Mock MQTT client
 */
class MockMQTTClient extends EventEmitter {
  subscriptions: Map<string, Set<(topic: string, payload: Buffer) => void>> = new Map();
  published: Array<{ topic: string; payload: string }> = [];
  connected = true;

  subscribe(topic: string, callback: (topic: string, payload: Buffer) => void): void {
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Set());
    }
    this.subscriptions.get(topic)!.add(callback);
  }

  unsubscribe(topic: string): void {
    this.subscriptions.delete(topic);
  }

  publish(topic: string, payload: string | Buffer): void {
    this.published.push({ topic, payload: payload.toString() });
  }

  // Simulate receiving a message
  simulateMessage(topic: string, payload: object | string): void {
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const payloadBuffer = Buffer.from(payloadStr);

    for (const [pattern, callbacks] of this.subscriptions) {
      if (this.matchTopic(pattern, topic)) {
        for (const callback of callbacks) {
          callback(topic, payloadBuffer);
        }
      }
    }
  }

  private matchTopic(pattern: string, topic: string): boolean {
    const patternParts = pattern.split('/');
    const topicParts = topic.split('/');

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === '#') {
        return true;
      }
      if (patternParts[i] === '+') {
        continue;
      }
      if (patternParts[i] !== topicParts[i]) {
        return false;
      }
    }

    return patternParts.length === topicParts.length;
  }
}

/**
 * Mock WebSocket
 */
class MockWebSocket extends EventEmitter {
  messages: string[] = [];
  closed = false;
  readyState = 1; // OPEN

  send(data: string): void {
    this.messages.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3; // CLOSED
    this.emit('close');
  }

  // Simulate receiving a message from client
  simulateMessage(data: object): void {
    this.emit('message', JSON.stringify(data));
  }
}

describe('MQTTBridge', () => {
  let mqttClient: MockMQTTClient;
  let bridge: MQTTBridge;

  beforeEach(() => {
    mqttClient = new MockMQTTClient();
    bridge = new MQTTBridge({ mqttClient: mqttClient as any });
  });

  afterEach(() => {
    bridge.close();
  });

  describe('initialization', () => {
    it('should create bridge with MQTT client', () => {
      expect(bridge).toBeDefined();
    });

    it('should track connected clients', () => {
      expect(bridge.getClientCount()).toBe(0);
    });
  });

  describe('client connection', () => {
    it('should add client on connection', () => {
      const ws = new MockWebSocket();
      bridge.addClient(ws as any, 'user1');

      expect(bridge.getClientCount()).toBe(1);
    });

    it('should remove client on disconnect', () => {
      const ws = new MockWebSocket();
      bridge.addClient(ws as any, 'user1');

      ws.close();

      expect(bridge.getClientCount()).toBe(0);
    });

    it('should handle multiple clients', () => {
      const ws1 = new MockWebSocket();
      const ws2 = new MockWebSocket();

      bridge.addClient(ws1 as any, 'user1');
      bridge.addClient(ws2 as any, 'user2');

      expect(bridge.getClientCount()).toBe(2);
    });
  });

  describe('subscription handling', () => {
    it('should subscribe to MQTT topic when client requests', () => {
      const ws = new MockWebSocket();
      bridge.addClient(ws as any, 'user1');

      ws.simulateMessage({ action: 'subscribe', topic: 'wos/plugin/+/status' });

      expect(mqttClient.subscriptions.has('wos/plugin/+/status')).toBe(true);
    });

    it('should forward MQTT messages to subscribed clients', () => {
      const ws = new MockWebSocket();
      bridge.addClient(ws as any, 'user1');

      ws.simulateMessage({ action: 'subscribe', topic: 'wos/plugin/+/status' });

      mqttClient.simulateMessage('wos/plugin/my-plugin/status', { status: 'running' });

      expect(ws.messages.length).toBe(1);
      const message = JSON.parse(ws.messages[0]);
      expect(message.topic).toBe('wos/plugin/my-plugin/status');
      expect(message.payload.status).toBe('running');
    });

    it('should not forward messages to unsubscribed clients', () => {
      const ws1 = new MockWebSocket();
      const ws2 = new MockWebSocket();

      bridge.addClient(ws1 as any, 'user1');
      bridge.addClient(ws2 as any, 'user2');

      ws1.simulateMessage({ action: 'subscribe', topic: 'wos/plugin/+/status' });

      mqttClient.simulateMessage('wos/plugin/my-plugin/status', { status: 'running' });

      expect(ws1.messages.length).toBe(1);
      expect(ws2.messages.length).toBe(0);
    });

    it('should unsubscribe from MQTT when client requests', () => {
      const ws = new MockWebSocket();
      bridge.addClient(ws as any, 'user1');

      ws.simulateMessage({ action: 'subscribe', topic: 'wos/plugin/+/status' });
      ws.simulateMessage({ action: 'unsubscribe', topic: 'wos/plugin/+/status' });

      // Should not receive messages after unsubscribe
      mqttClient.simulateMessage('wos/plugin/my-plugin/status', { status: 'running' });

      expect(ws.messages.length).toBe(0);
    });

    it('should clean up subscriptions when client disconnects', () => {
      const ws = new MockWebSocket();
      bridge.addClient(ws as any, 'user1');

      ws.simulateMessage({ action: 'subscribe', topic: 'wos/plugin/+/status' });
      ws.close();

      // Subscription tracking should be cleaned up
      expect(bridge.getClientCount()).toBe(0);
    });
  });

  describe('publishing', () => {
    it('should publish to MQTT when client sends publish action', () => {
      const ws = new MockWebSocket();
      bridge.addClient(ws as any, 'user1');

      ws.simulateMessage({
        action: 'publish',
        topic: 'wos/command/restart',
        payload: { plugin: 'my-plugin' },
      });

      expect(mqttClient.published.length).toBe(1);
      expect(mqttClient.published[0].topic).toBe('wos/command/restart');
      const payload = JSON.parse(mqttClient.published[0].payload);
      expect(payload.plugin).toBe('my-plugin');
    });

    it('should include client username in published messages', () => {
      const ws = new MockWebSocket();
      bridge.addClient(ws as any, 'admin');

      ws.simulateMessage({
        action: 'publish',
        topic: 'wos/command/restart',
        payload: { plugin: 'my-plugin' },
      });

      const payload = JSON.parse(mqttClient.published[0].payload);
      expect(payload._sender).toBe('admin');
    });
  });

  describe('topic permissions', () => {
    it('should allow subscribing to wos/# topics', () => {
      const ws = new MockWebSocket();
      bridge.addClient(ws as any, 'user1');

      ws.simulateMessage({ action: 'subscribe', topic: 'wos/plugin/status' });

      expect(mqttClient.subscriptions.has('wos/plugin/status')).toBe(true);
    });

    it('should reject subscribing to non-wos topics by default', () => {
      const ws = new MockWebSocket();
      bridge.addClient(ws as any, 'user1');

      ws.simulateMessage({ action: 'subscribe', topic: 'other/topic' });

      expect(mqttClient.subscriptions.has('other/topic')).toBe(false);
      expect(ws.messages.length).toBe(1);
      const response = JSON.parse(ws.messages[0]);
      expect(response.error).toBeDefined();
    });

    it('should reject publishing to non-wos topics by default', () => {
      const ws = new MockWebSocket();
      bridge.addClient(ws as any, 'user1');

      ws.simulateMessage({
        action: 'publish',
        topic: 'other/topic',
        payload: {},
      });

      expect(mqttClient.published.length).toBe(0);
      expect(ws.messages.length).toBe(1);
      const response = JSON.parse(ws.messages[0]);
      expect(response.error).toBeDefined();
    });
  });

  describe('message format', () => {
    it('should send messages in expected format', () => {
      const ws = new MockWebSocket();
      bridge.addClient(ws as any, 'user1');

      ws.simulateMessage({ action: 'subscribe', topic: 'wos/test' });
      mqttClient.simulateMessage('wos/test', { data: 'test' });

      const message = JSON.parse(ws.messages[0]);
      expect(message).toEqual({
        type: 'message',
        topic: 'wos/test',
        payload: { data: 'test' },
        timestamp: expect.any(Number),
      });
    });

    it('should handle non-JSON MQTT payloads', () => {
      const ws = new MockWebSocket();
      bridge.addClient(ws as any, 'user1');

      ws.simulateMessage({ action: 'subscribe', topic: 'wos/test' });
      mqttClient.simulateMessage('wos/test', 'plain text');

      const message = JSON.parse(ws.messages[0]);
      expect(message.payload).toBe('plain text');
    });
  });

  describe('error handling', () => {
    it('should handle invalid JSON from client', () => {
      const ws = new MockWebSocket();
      bridge.addClient(ws as any, 'user1');

      ws.emit('message', 'not valid json');

      expect(ws.messages.length).toBe(1);
      const response = JSON.parse(ws.messages[0]);
      expect(response.error).toBeDefined();
      expect(response.error).toContain('Invalid');
    });

    it('should handle unknown action', () => {
      const ws = new MockWebSocket();
      bridge.addClient(ws as any, 'user1');

      ws.simulateMessage({ action: 'unknown' });

      expect(ws.messages.length).toBe(1);
      const response = JSON.parse(ws.messages[0]);
      expect(response.error).toBeDefined();
    });
  });

  describe('broadcast', () => {
    it('should broadcast to all clients', () => {
      const ws1 = new MockWebSocket();
      const ws2 = new MockWebSocket();

      bridge.addClient(ws1 as any, 'user1');
      bridge.addClient(ws2 as any, 'user2');

      bridge.broadcast({ type: 'notification', message: 'Server restarting' });

      expect(ws1.messages.length).toBe(1);
      expect(ws2.messages.length).toBe(1);
    });
  });

  describe('ping/pong', () => {
    it('should respond to ping with pong', () => {
      const ws = new MockWebSocket();
      bridge.addClient(ws as any, 'user1');

      ws.simulateMessage({ action: 'ping' });

      expect(ws.messages.length).toBe(1);
      const response = JSON.parse(ws.messages[0]);
      expect(response.type).toBe('pong');
      expect(response.timestamp).toBeDefined();
    });
  });
});
