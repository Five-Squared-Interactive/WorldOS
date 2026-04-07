// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

/**
 * TopicBridge - Bidirectional topic bridge between ROS2 and WOS MQTT
 *
 * ROS-to-MQTT: Subscribes to rosbridge topics, republishes on MQTT.
 * MQTT-to-ROS: Subscribes to MQTT publish topics, forwards to rosbridge.
 */

import type { PluginMqttClient, PluginMessage } from '@worldos/plugin-sdk';
import type { RosbridgeConnection } from './rosbridge-connection.js';
import type { TopicConfig, TopicStats, RosbridgeMessage, BridgeLogger } from './types/rosbridge.js';

export class TopicBridge {
  private robotName: string;
  private connection: RosbridgeConnection;
  private mqtt: PluginMqttClient;
  private topicConfigs: TopicConfig[];
  private isStopped: () => boolean;
  private logger: BridgeLogger;

  // Stats tracking
  private rosToMqttStats = new Map<string, { count: number; lastAt: number | null }>();
  private mqttToRosStats = new Map<string, { count: number; lastAt: number | null }>();

  // Track configured topic types for two-tier type resolution
  private configuredTopicTypes = new Map<string, string>();

  // Stored listener reference for cleanup
  private messageHandler: ((msg: RosbridgeMessage) => void) | null = null;

  constructor(
    robotName: string,
    connection: RosbridgeConnection,
    mqtt: PluginMqttClient,
    topicConfigs: TopicConfig[],
    isStopped: () => boolean,
    logger: BridgeLogger,
  ) {
    this.robotName = robotName;
    this.connection = connection;
    this.mqtt = mqtt;
    this.topicConfigs = topicConfigs;
    this.isStopped = isStopped;
    this.logger = logger;

    // Build configured type lookup
    for (const tc of topicConfigs) {
      this.configuredTopicTypes.set(tc.name, tc.type);
    }
  }

  /**
   * Start bridging topics
   */
  async start(): Promise<void> {
    // ROS-to-MQTT: Subscribe to configured ROS topics
    for (const tc of this.topicConfigs) {
      this.connection.subscribeTopic(tc.name, tc.type, tc.throttle_rate);
      this.rosToMqttStats.set(tc.name, { count: 0, lastAt: null });
    }

    // Listen for rosbridge messages and forward to MQTT
    this.messageHandler = (msg: RosbridgeMessage) => {
      if (this.isStopped()) return;
      if (msg.op === 'publish' && msg.topic) {
        this.handleRosToMqtt(msg.topic, msg.msg);
      }
    };
    this.connection.on('message', this.messageHandler);

    // MQTT-to-ROS: Advertise configured topics at startup (type known from config)
    for (const tc of this.topicConfigs) {
      this.connection.advertise(tc.name, tc.type);
    }

    // Subscribe to MQTT publish wildcard for this robot
    const mqttPublishTopic = `wos/ros2/${this.robotName}/publish/#`;
    await this.mqtt.subscribeWithHandler(mqttPublishTopic, (msg: PluginMessage) => {
      if (this.isStopped()) return;
      this.handleMqttToRos(msg.topic, msg.payload);
    });
  }

  /**
   * Stop bridging and clean up
   */
  async stop(): Promise<void> {
    // Remove message listener
    if (this.messageHandler) {
      this.connection.off('message', this.messageHandler);
      this.messageHandler = null;
    }

    // Unadvertise all topics
    for (const topic of this.connection.getAdvertisedTopics()) {
      this.connection.unadvertise(topic);
    }
  }

  /**
   * Get topic statistics
   */
  getStats(): TopicStats[] {
    const stats: TopicStats[] = [];

    for (const [name, s] of this.rosToMqttStats) {
      stats.push({
        name,
        direction: 'ros-to-mqtt',
        messageCount: s.count,
        lastMessageAt: s.lastAt,
      });
    }

    for (const [name, s] of this.mqttToRosStats) {
      stats.push({
        name,
        direction: 'mqtt-to-ros',
        messageCount: s.count,
        lastMessageAt: s.lastAt,
      });
    }

    return stats;
  }

  /**
   * Handle ROS message -> MQTT
   */
  private handleRosToMqtt(rosTopic: string, payload: unknown): void {
    // Map ROS topic to MQTT: /joint_states -> wos/ros2/arm-1/joint_states
    const strippedTopic = rosTopic.startsWith('/') ? rosTopic.slice(1) : rosTopic;
    const mqttTopic = `wos/ros2/${this.robotName}/${strippedTopic}`;

    // Update stats
    const stats = this.rosToMqttStats.get(rosTopic);
    if (stats) {
      stats.count++;
      stats.lastAt = Date.now();
    } else {
      this.rosToMqttStats.set(rosTopic, { count: 1, lastAt: Date.now() });
    }

    this.mqtt.publishRaw(mqttTopic, payload).catch((err) => {
      this.logger.error(`Failed to publish to MQTT ${mqttTopic}: ${err}`);
    });
  }

  /**
   * Handle MQTT message -> ROS
   */
  private handleMqttToRos(mqttTopic: string, payload: unknown): void {
    // Extract ROS topic from MQTT topic
    // wos/ros2/arm-1/publish/arm_controller/command -> /arm_controller/command
    const prefix = `wos/ros2/${this.robotName}/publish/`;
    if (!mqttTopic.startsWith(prefix)) return;

    const rosTopicSegment = mqttTopic.slice(prefix.length);
    const rosTopic = `/${rosTopicSegment}`;

    // Update stats
    const stats = this.mqttToRosStats.get(rosTopic);
    if (stats) {
      stats.count++;
      stats.lastAt = Date.now();
    } else {
      this.mqttToRosStats.set(rosTopic, { count: 1, lastAt: Date.now() });
    }

    // Two-tier type resolution for advertise
    let rosPayload = payload;
    const configuredType = this.configuredTopicTypes.get(rosTopic);

    if (configuredType) {
      // Tier 1: Configured topic - type known, advertised at startup, bare payload
      // Already advertised in start(), just publish
    } else if (
      typeof payload === 'object' &&
      payload !== null &&
      '_ros_type' in (payload as Record<string, unknown>)
    ) {
      // Tier 2: Ad-hoc topic - type from _ros_type field
      const { _ros_type, ...rest } = payload as Record<string, unknown>;
      this.connection.advertise(rosTopic, _ros_type as string);
      rosPayload = rest;
    } else {
      // No type available - cannot advertise, drop message
      this.logger.error(
        `Cannot publish to ROS topic ${rosTopic}: no type configured and no _ros_type field in message`,
      );
      return;
    }

    this.connection.publishToRos(rosTopic, rosPayload);
  }
}
