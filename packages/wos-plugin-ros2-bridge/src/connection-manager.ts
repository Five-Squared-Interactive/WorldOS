// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

/**
 * ConnectionManager - Manages multiple RosbridgeConnection + TopicBridge + ServiceBridge triplets
 *
 * Each robot gets its own connection, topic bridge, and service bridge.
 * Individual robot failures do not affect other robots.
 */

import { EventEmitter } from 'events';
import type { PluginMqttClient } from '@worldos/plugin-sdk';
import { RosbridgeConnection } from './rosbridge-connection.js';
import { TopicBridge } from './topic-bridge.js';
import { ServiceBridge } from './service-bridge.js';
import type { ROS2BridgeConfig, ConnectionConfig, RobotStatus, BridgeLogger } from './types/rosbridge.js';

interface RobotBridge {
  connection: RosbridgeConnection;
  topicBridge: TopicBridge;
  serviceBridge: ServiceBridge;
}

export class ConnectionManager extends EventEmitter {
  private robots = new Map<string, RobotBridge>();
  private config: ROS2BridgeConfig;
  private mqtt: PluginMqttClient;
  private isStopped: () => boolean;
  private logger: BridgeLogger;

  constructor(
    config: ROS2BridgeConfig,
    mqtt: PluginMqttClient,
    isStopped: () => boolean,
    logger: BridgeLogger,
  ) {
    super();
    this.config = config;
    this.mqtt = mqtt;
    this.isStopped = isStopped;
    this.logger = logger;
  }

  /**
   * Start all configured robot connections
   */
  async startAll(): Promise<void> {
    const maxAttempts = this.config.reconnect?.maxAttempts;
    const maxDelayMs = this.config.reconnect?.maxDelayMs;

    const results = await Promise.allSettled(
      Object.entries(this.config.connections).map(async ([robotName, connConfig]) => {
        await this.startRobot(robotName, connConfig, { maxReconnectAttempts: maxAttempts, maxReconnectDelay: maxDelayMs });
        this.logger.info(`Robot ${robotName} connected to ${connConfig.url}`);
        return robotName;
      }),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.error(`Failed to connect robot: ${result.reason}`);
      }
    }
  }

  /**
   * Stop all robot connections
   */
  async stopAll(): Promise<void> {
    // Copy entries to avoid mutation during iteration
    const entries = [...this.robots.entries()];
    this.robots.clear();

    for (const [robotName, robot] of entries) {
      try {
        await robot.topicBridge.stop();
        await robot.serviceBridge.stop();
        robot.connection.disconnect();
        this.logger.info(`Robot ${robotName} disconnected`);
      } catch (error) {
        this.logger.error(`Error stopping robot ${robotName}: ${error}`);
      }
    }
  }

  /**
   * Get status for all robots
   */
  getStatus(): RobotStatus[] {
    const statuses: RobotStatus[] = [];

    for (const [robotName, robot] of this.robots) {
      statuses.push({
        robotName,
        url: robot.connection.getUrl(),
        state: robot.connection.getState(),
        latencyMs: robot.connection.getLatency(),
        topics: robot.topicBridge.getStats(),
        serviceCallCount: robot.serviceBridge.getSuccessCount() + robot.serviceBridge.getErrorCount(),
        serviceErrorCount: robot.serviceBridge.getErrorCount(),
        connectedSince: robot.connection.getConnectedSince(),
      });
    }

    return statuses;
  }

  /**
   * Get status for a specific robot
   */
  getRobotStatus(robotName: string): RobotStatus | undefined {
    return this.getStatus().find((s) => s.robotName === robotName);
  }

  /**
   * Get the number of connected robots
   */
  getConnectedCount(): number {
    let count = 0;
    for (const robot of this.robots.values()) {
      if (robot.connection.getState() === 'connected') count++;
    }
    return count;
  }

  /**
   * Get total number of configured robots
   */
  getTotalCount(): number {
    return this.robots.size;
  }

  private async startRobot(
    robotName: string,
    connConfig: ConnectionConfig,
    options?: { maxReconnectAttempts?: number; maxReconnectDelay?: number },
  ): Promise<void> {
    const connection = new RosbridgeConnection(robotName, connConfig, options);

    connection.on('connected', () => {
      this.logger.info(`Robot ${robotName} connected`);
      this.emit('robot:connected', robotName);
    });

    connection.on('disconnected', () => {
      this.logger.info(`Robot ${robotName} disconnected`);
      this.emit('robot:disconnected', robotName);
    });

    connection.on('reconnecting', (attempt, max, delay) => {
      this.logger.info(`Robot ${robotName} reconnecting (attempt ${attempt}/${max}, delay ${delay}ms)`);
    });

    connection.on('error', (error) => {
      this.logger.error(`Robot ${robotName} error: ${error}`);
    });

    const topicBridge = new TopicBridge(
      robotName,
      connection,
      this.mqtt,
      connConfig.topics,
      this.isStopped,
      this.logger,
    );

    const serviceBridge = new ServiceBridge(
      robotName,
      connection,
      this.mqtt,
      this.isStopped,
      this.logger,
      undefined,
      connConfig.services,
    );

    this.robots.set(robotName, { connection, topicBridge, serviceBridge });

    // Connect first, then start bridges
    await connection.connect();
    await topicBridge.start();
    await serviceBridge.start();
  }
}
