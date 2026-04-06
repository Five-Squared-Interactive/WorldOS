// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { WorldSyncService } from '@fivesquaredinteractive/worldsync';
import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import type { SyncManagerConfig } from './types.js';
import type { Logger } from '@worldos/plugin-sdk';

export class SyncBridge {
  private _service: WorldSyncService | null = null;
  private _mqttClient: MqttClient | null = null;
  private _config: SyncManagerConfig;
  private _logger: Logger;
  private _isRunning = false;

  constructor(config: SyncManagerConfig, logger: Logger) {
    this._config = config;
    this._logger = logger;
  }

  async start(): Promise<void> {
    // Map SyncManagerConfig to WorldSyncConfig
    const worldSyncConfig = {
      mqtt: {
        host: this._config.sync_mqtt_host,
        port: this._config.sync_mqtt_tcp_port,
      },
      heartbeatIntervalMs: this._config.heartbeat_interval_ms,
      maxEntitiesPerSession: this._config.max_entities_per_session,
      maxClientsPerSession: this._config.max_clients_per_session,
      persistence: {
        enabled: this._config.persistence_enabled,
        backend: this._config.persistence_backend,
        path: this._config.persistence_path,
      },
    };

    // Create and start WorldSyncService (initializes persistence only — no MQTT)
    this._service = new WorldSyncService(worldSyncConfig);
    await this._service.start();

    // Connect separate MQTT client to Mosquitto for wsync/ transport
    const brokerUrl = `mqtt://${this._config.sync_mqtt_host}:${this._config.sync_mqtt_tcp_port}`;
    this._mqttClient = mqtt.connect(brokerUrl, {
      clientId: `wos-sync-bridge-${Date.now()}`,
      clean: true,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('MQTT connection to Mosquitto timed out'));
      }, 10000);

      this._mqttClient!.on('connect', () => {
        clearTimeout(timeout);
        resolve();
      });

      this._mqttClient!.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Subscribe to wsync/# for incoming client messages
    await new Promise<void>((resolve, reject) => {
      this._mqttClient!.subscribe('wsync/#', { qos: 0 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // TODO Epic2-Task2.4: Wire incoming wsync/ messages to WorldSyncService methods via TopicSubscriber
    // TODO Epic2-Task2.4: Wire WorldSyncService results to outbound wsync/ messages via TopicPublisher

    this._isRunning = true;
    this._logger.info('SyncBridge started');
  }

  async stop(): Promise<void> {
    if (!this._isRunning && !this._service) {
      return;
    }

    if (this._mqttClient) {
      await new Promise<void>((resolve) => {
        this._mqttClient!.end(false, () => resolve());
      });
      this._mqttClient = null;
    }

    if (this._service) {
      await this._service.stop();
      this._service = null;
    }

    this._isRunning = false;
    this._logger.info('SyncBridge stopped');
  }

  get service(): WorldSyncService | null {
    return this._service;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }
}
