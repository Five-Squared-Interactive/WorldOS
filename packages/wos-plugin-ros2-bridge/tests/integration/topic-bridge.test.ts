// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockRosbridgeServer } from './mock-rosbridge-server.js';
import { RosbridgeConnection } from '../../src/rosbridge-connection.js';
import { TopicBridge } from '../../src/topic-bridge.js';

function createMockMqtt() {
  const handlers = new Map<string, Function>();
  return {
    publishRaw: vi.fn().mockResolvedValue(undefined),
    subscribeWithHandler: vi.fn(async (topic: string, handler: Function) => {
      handlers.set(topic, handler);
    }),
    _trigger: (topic: string, payload: unknown) => {
      for (const [pattern, handler] of handlers) {
        if (matchTopic(pattern, topic)) {
          handler({ topic, payload, timestamp: Date.now() });
        }
      }
    },
  };
}

function matchTopic(pattern: string, topic: string): boolean {
  const pp = pattern.split('/');
  const tp = topic.split('/');
  for (let i = 0; i < pp.length; i++) {
    if (pp[i] === '#') return true;
    if (i >= tp.length) return false;
    if (pp[i] !== '+' && pp[i] !== tp[i]) return false;
  }
  return pp.length === tp.length;
}

const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe('Integration: TopicBridge', () => {
  let server: MockRosbridgeServer;
  let conn: RosbridgeConnection;
  let mqtt: ReturnType<typeof createMockMqtt>;
  let bridge: TopicBridge;

  beforeEach(async () => {
    server = new MockRosbridgeServer();
    await server.start();

    conn = new RosbridgeConnection('test-bot', {
      url: server.url,
      topics: [{ name: '/odom', type: 'nav_msgs/Odometry' }],
      services: [],
    });

    mqtt = createMockMqtt();

    bridge = new TopicBridge(
      'test-bot',
      conn,
      mqtt as any,
      [{ name: '/odom', type: 'nav_msgs/Odometry' }],
      () => false,
      logger,
    );

    await conn.connect();
    await bridge.start();
  });

  afterEach(async () => {
    await bridge.stop();
    conn.disconnect();
    await server.stop();
  });

  it('bridges ROS topic to MQTT end-to-end', async () => {
    // Give time for rosbridge subscribe op to reach server and register
    await new Promise((r) => setTimeout(r, 200));

    // Server publishes a message on /odom
    server.publishToSubscribers('/odom', { x: 1.0, y: 2.0, z: 0.0 });

    // Wait for message to propagate through connection -> bridge -> mqtt
    await new Promise((r) => setTimeout(r, 200));

    expect(mqtt.publishRaw).toHaveBeenCalledWith(
      'wos/ros2/test-bot/odom',
      { x: 1.0, y: 2.0, z: 0.0 },
    );
  });

  it('bridges MQTT publish to ROS end-to-end', async () => {
    // Wait a moment for subscriptions to be ready
    await new Promise((r) => setTimeout(r, 50));

    // Simulate MQTT publish for a configured topic
    mqtt._trigger('wos/ros2/test-bot/publish/odom', { x: 5.0 });

    // Small delay for processing
    await new Promise((r) => setTimeout(r, 50));

    // The connection should have publishToRos called
    // We can verify by checking stats
    const stats = bridge.getStats();
    const mqttToRos = stats.find((s) => s.direction === 'mqtt-to-ros');
    expect(mqttToRos).toBeDefined();
    expect(mqttToRos!.messageCount).toBeGreaterThan(0);
  });
});
