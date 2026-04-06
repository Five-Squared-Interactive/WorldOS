// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TopicBridge } from './topic-bridge.js';
import type { TopicConfig } from './types/rosbridge.js';

function createMockConnection() {
  const listeners = new Map<string, Function[]>();
  return {
    robotName: 'arm-1',
    subscribeTopic: vi.fn(),
    unsubscribeTopic: vi.fn(),
    advertise: vi.fn(),
    unadvertise: vi.fn(),
    publishToRos: vi.fn(),
    getAdvertisedTopics: vi.fn().mockReturnValue(['/cmd_vel']),
    on: vi.fn((event: string, handler: Function) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
    }),
    off: vi.fn((event: string, handler: Function) => {
      const list = listeners.get(event);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      }
    }),
    emit: (event: string, ...args: unknown[]) => {
      for (const h of listeners.get(event) ?? []) h(...args);
    },
  };
}

function createMockMqtt() {
  const handlers = new Map<string, Function>();
  return {
    publishRaw: vi.fn().mockResolvedValue(undefined),
    subscribeWithHandler: vi.fn(async (topic: string, handler: Function) => {
      handlers.set(topic, handler);
    }),
    _triggerHandler: (topic: string, payload: unknown) => {
      // Find matching handler (support wildcards)
      for (const [pattern, handler] of handlers) {
        if (topicMatches(pattern, topic)) {
          handler({ topic, payload, timestamp: Date.now() });
        }
      }
    },
  };
}

function topicMatches(pattern: string, topic: string): boolean {
  const pp = pattern.split('/');
  const tp = topic.split('/');
  for (let i = 0; i < pp.length; i++) {
    if (pp[i] === '#') return true;
    if (i >= tp.length) return false;
    if (pp[i] !== '+' && pp[i] !== tp[i]) return false;
  }
  return pp.length === tp.length;
}

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe('TopicBridge', () => {
  let conn: ReturnType<typeof createMockConnection>;
  let mqtt: ReturnType<typeof createMockMqtt>;
  let bridge: TopicBridge;
  let stopped: boolean;

  const topicConfigs: TopicConfig[] = [
    { name: '/joint_states', type: 'sensor_msgs/JointState', throttle_rate: 100 },
    { name: '/arm_controller/command', type: 'std_msgs/Float64MultiArray' },
  ];

  beforeEach(() => {
    conn = createMockConnection();
    mqtt = createMockMqtt();
    stopped = false;

    bridge = new TopicBridge(
      'arm-1',
      conn as any,
      mqtt as any,
      topicConfigs,
      () => stopped,
      mockLogger,
    );
  });

  it('subscribes to configured ROS topics on start', async () => {
    await bridge.start();

    expect(conn.subscribeTopic).toHaveBeenCalledWith('/joint_states', 'sensor_msgs/JointState', 100);
    expect(conn.subscribeTopic).toHaveBeenCalledWith('/arm_controller/command', 'std_msgs/Float64MultiArray', undefined);
  });

  it('advertises configured topics on start', async () => {
    await bridge.start();

    expect(conn.advertise).toHaveBeenCalledWith('/joint_states', 'sensor_msgs/JointState');
    expect(conn.advertise).toHaveBeenCalledWith('/arm_controller/command', 'std_msgs/Float64MultiArray');
  });

  it('subscribes to MQTT publish wildcard', async () => {
    await bridge.start();

    expect(mqtt.subscribeWithHandler).toHaveBeenCalledWith(
      'wos/ros2/arm-1/publish/#',
      expect.any(Function),
    );
  });

  it('forwards ROS messages to MQTT (ROS-to-MQTT)', async () => {
    await bridge.start();

    // Simulate rosbridge publishing a message
    conn.emit('message', {
      op: 'publish',
      topic: '/joint_states',
      msg: { name: ['joint1'], position: [1.0] },
    });

    expect(mqtt.publishRaw).toHaveBeenCalledWith(
      'wos/ros2/arm-1/joint_states',
      { name: ['joint1'], position: [1.0] },
    );
  });

  it('handles multi-segment ROS topics correctly', async () => {
    await bridge.start();

    conn.emit('message', {
      op: 'publish',
      topic: '/arm_controller/command',
      msg: { data: [1.0, 2.0] },
    });

    expect(mqtt.publishRaw).toHaveBeenCalledWith(
      'wos/ros2/arm-1/arm_controller/command',
      { data: [1.0, 2.0] },
    );
  });

  it('forwards MQTT messages to ROS for configured topics (bare payload)', async () => {
    await bridge.start();

    // Simulate MQTT message on publish topic for a configured topic
    mqtt._triggerHandler(
      'wos/ros2/arm-1/publish/arm_controller/command',
      { data: [0.5, 1.5] },
    );

    expect(conn.publishToRos).toHaveBeenCalledWith(
      '/arm_controller/command',
      { data: [0.5, 1.5] },
    );
  });

  it('handles ad-hoc MQTT-to-ROS with _ros_type field', async () => {
    await bridge.start();

    mqtt._triggerHandler(
      'wos/ros2/arm-1/publish/custom/topic',
      { _ros_type: 'std_msgs/String', data: 'hello' },
    );

    expect(conn.advertise).toHaveBeenCalledWith('/custom/topic', 'std_msgs/String');
    expect(conn.publishToRos).toHaveBeenCalledWith('/custom/topic', { data: 'hello' });
  });

  it('drops MQTT-to-ROS message without type info', async () => {
    await bridge.start();

    mqtt._triggerHandler(
      'wos/ros2/arm-1/publish/unknown/topic',
      { data: 'hello' },
    );

    expect(conn.publishToRos).not.toHaveBeenCalledWith('/unknown/topic', expect.anything());
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Cannot publish to ROS topic /unknown/topic'),
    );
  });

  it('does not forward messages when stopped', async () => {
    await bridge.start();
    stopped = true;

    conn.emit('message', {
      op: 'publish',
      topic: '/joint_states',
      msg: { name: ['j1'], position: [0] },
    });

    expect(mqtt.publishRaw).not.toHaveBeenCalled();
  });

  it('tracks message statistics', async () => {
    await bridge.start();

    conn.emit('message', { op: 'publish', topic: '/joint_states', msg: {} });
    conn.emit('message', { op: 'publish', topic: '/joint_states', msg: {} });

    mqtt._triggerHandler('wos/ros2/arm-1/publish/arm_controller/command', { data: [1] });

    const stats = bridge.getStats();
    const rosToMqtt = stats.find((s) => s.name === '/joint_states' && s.direction === 'ros-to-mqtt');
    const mqttToRos = stats.find((s) => s.name === '/arm_controller/command' && s.direction === 'mqtt-to-ros');

    expect(rosToMqtt?.messageCount).toBe(2);
    expect(rosToMqtt?.lastMessageAt).toBeTypeOf('number');
    expect(mqttToRos?.messageCount).toBe(1);
  });

  it('unadvertises all topics on stop', async () => {
    await bridge.start();
    await bridge.stop();

    expect(conn.unadvertise).toHaveBeenCalledWith('/cmd_vel');
  });
});
