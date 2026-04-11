// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

/**
 * ROS2 Bridge Plugin
 *
 * Generic, config-driven WOS 2.0 plugin that bridges ROS2 topics (pub/sub)
 * and services (request/response) to WOS MQTT via rosbridge WebSocket.
 * Supports multiple simultaneous rosbridge connections.
 */

import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { WOSPlugin, PluginContext, HealthCheckResult } from '@worldos/plugin-sdk';
import { ConnectionManager } from './connection-manager.js';
import { collectHealthStatus } from './health.js';
import type { ROS2BridgeConfig } from './types/rosbridge.js';
import type { PluginMqttClient } from '@worldos/plugin-sdk';
import type { Logger } from '@worldos/plugin-sdk';

export class ROS2BridgePlugin extends WOSPlugin {
  private connectionManager: ConnectionManager | null = null;
  private mqttClient: PluginMqttClient | null = null;
  private pluginLogger: Logger | null = null;
  private _isStopped = true;

  constructor() {
    super();
  }

  async onStart(context: PluginContext): Promise<void> {
    this._isStopped = false;
    this.mqttClient = context.mqtt;
    this.pluginLogger = context.logger;

    // Load config file path from plugin config
    const configFileName = (context.config.configFile as string) || 'ros2-bridge.json';

    // Resolve config file path
    let configFilePath: string;
    if (context.pluginDir) {
      configFilePath = join(context.pluginDir, configFileName);
    } else {
      // Fallback: resolve relative to plugin source directory
      const pluginDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
      configFilePath = join(pluginDir, configFileName);
      context.logger.info(`WOS_PLUGIN_DIR not set, falling back to ${configFilePath}`);
    }

    // Read and parse config
    let bridgeConfig: ROS2BridgeConfig;
    try {
      const raw = readFileSync(configFilePath, 'utf-8');
      bridgeConfig = JSON.parse(raw) as ROS2BridgeConfig;
    } catch (error) {
      throw new Error(`Failed to load ROS2 bridge config from ${configFilePath}: ${error}`);
    }

    // Validate config
    if (!bridgeConfig.connections || typeof bridgeConfig.connections !== 'object') {
      throw new Error('Invalid ROS2 bridge config: missing connections object');
    }

    // Validate each connection entry
    for (const [name, conn] of Object.entries(bridgeConfig.connections)) {
      if (!conn.url || typeof conn.url !== 'string') {
        throw new Error(`Invalid ROS2 bridge config: connection "${name}" missing required "url" field`);
      }
      if (!Array.isArray(conn.topics)) {
        throw new Error(`Invalid ROS2 bridge config: connection "${name}" missing required "topics" array`);
      }
      for (const topic of conn.topics) {
        if (!topic.name || !topic.type) {
          throw new Error(`Invalid ROS2 bridge config: topic in "${name}" missing required "name" or "type" field`);
        }
      }
      if (!Array.isArray(conn.services)) {
        throw new Error(`Invalid ROS2 bridge config: connection "${name}" missing required "services" array`);
      }
    }

    // Create and start connection manager
    this.connectionManager = new ConnectionManager(
      bridgeConfig,
      context.mqtt,
      () => this._isStopped,
      context.logger,
    );

    await this.connectionManager.startAll();

    context.logger.info(
      `ROS2 Bridge plugin started with ${Object.keys(bridgeConfig.connections).length} robot(s)`,
    );
  }

  async onStop(): Promise<void> {
    this._isStopped = true;

    if (this.connectionManager) {
      await this.connectionManager.stopAll();
      this.connectionManager = null;
    }

    this.pluginLogger?.info('ROS2 Bridge plugin stopped');
  }

  async onHealthCheck(): Promise<HealthCheckResult> {
    if (!this.connectionManager) {
      return { status: 'unhealthy', error: 'Plugin not started' };
    }

    const health = collectHealthStatus(this.connectionManager);

    return {
      status: health.status,
      details: {
        connectedRobots: health.connectedRobots,
        totalRobots: health.totalRobots,
        robots: health.robots.map((r) => ({
          name: r.robotName,
          state: r.state,
          latencyMs: r.latencyMs,
          topicCount: r.topics.length,
          serviceCallCount: r.serviceCallCount,
        })),
      },
    };
  }

  /**
   * Get the connection manager (for CLI/testing)
   */
  getConnectionManager(): ConnectionManager | null {
    return this.connectionManager;
  }
}

// Export the plugin instance
export const plugin = new ROS2BridgePlugin();

// Auto-start when spawned as a child process by wos-server
if (process.env.WOS_PLUGIN_NAME) {
  // Bridge WOS_MQTT_HOST/PORT to WOS_MQTT_URL for the SDK client
  if (!process.env.WOS_MQTT_URL && process.env.WOS_MQTT_HOST) {
    process.env.WOS_MQTT_URL = `mqtt://${process.env.WOS_MQTT_HOST}:${process.env.WOS_MQTT_PORT || '1883'}`;
  }

  const handleHealthCheck = (data: Buffer) => {
    for (const line of data.toString().split('\n')) {
      try {
        const msg = JSON.parse(line.trim());
        if (msg.type === 'health_check') {
          plugin.checkHealth().then((health) => {
            process.stdout.write(JSON.stringify({
              type: 'health_response',
              correlationId: msg.correlationId,
              status: health?.status === 'ok' ? 'healthy' : (health?.status ?? 'healthy'),
              timestamp: new Date().toISOString(),
              details: health?.details,
            }) + '\n');
          }).catch(() => {});
        }
      } catch { /* not JSON */ }
    }
  };

  plugin.start().then(() => {
    process.stdin.on('data', handleHealthCheck);
  }).catch((err: Error) => {
    console.error(`[ros2-bridge] Failed to start: ${err.message}`);
    process.exit(1);
  });

  const shutdown = () => {
    plugin.stop().then(() => process.exit(0)).catch(() => process.exit(1));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Re-export types and modules
export * from './types/rosbridge.js';
export * from './rosbridge-connection.js';
export * from './topic-bridge.js';
export * from './service-bridge.js';
export * from './connection-manager.js';
export * from './health.js';
export * from './cli/index.js';
