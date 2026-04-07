// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

/**
 * ServiceBridge - Bridge ROS2 service calls via WOS MQTT request/response
 *
 * Clients call mqtt.request('wos/ros2/{robot}/service/call', { service, args })
 * The SDK flattens this into { service, args, correlationId, responseTopic }
 * ServiceBridge reads all four fields as siblings from the flat payload.
 */

import type { PluginMqttClient, PluginMessage } from '@worldos/plugin-sdk';
import type { RosbridgeConnection } from './rosbridge-connection.js';
import type { RosbridgeMessage, BridgeLogger } from './types/rosbridge.js';

interface PendingServiceCall {
  correlationId: string;
  responseTopic: string;
  timeout: ReturnType<typeof setTimeout>;
  service: string;
}

export class ServiceBridge {
  private robotName: string;
  private connection: RosbridgeConnection;
  private mqtt: PluginMqttClient;
  private isStopped: () => boolean;
  private logger: BridgeLogger;
  private serviceTimeoutMs: number;
  private configuredServices: Set<string>;

  private pendingCalls = new Map<string, PendingServiceCall>();
  private callIdCounter = 0;
  private successCount = 0;
  private errorCount = 0;
  private messageHandler: ((msg: RosbridgeMessage) => void) | null = null;

  constructor(
    robotName: string,
    connection: RosbridgeConnection,
    mqtt: PluginMqttClient,
    isStopped: () => boolean,
    logger: BridgeLogger,
    serviceTimeoutMs = 10000,
    configuredServices: string[] = [],
  ) {
    this.robotName = robotName;
    this.connection = connection;
    this.mqtt = mqtt;
    this.isStopped = isStopped;
    this.logger = logger;
    this.serviceTimeoutMs = serviceTimeoutMs;
    this.configuredServices = new Set(configuredServices);
  }

  /**
   * Start listening for service call requests
   */
  async start(): Promise<void> {
    const topic = `wos/ros2/${this.robotName}/service/call`;

    await this.mqtt.subscribeWithHandler(topic, (msg: PluginMessage) => {
      if (this.isStopped()) return;
      this.handleServiceRequest(msg.payload as Record<string, unknown>);
    });

    // Listen for rosbridge service responses
    this.messageHandler = (msg: RosbridgeMessage) => {
      if (this.isStopped()) return;
      if (msg.op === 'service_response') {
        this.handleServiceResponse(msg);
      }
    };
    this.connection.on('message', this.messageHandler);
  }

  /**
   * Stop and clean up pending calls
   */
  async stop(): Promise<void> {
    // Remove message listener
    if (this.messageHandler) {
      this.connection.off('message', this.messageHandler);
      this.messageHandler = null;
    }

    for (const [id, pending] of this.pendingCalls) {
      clearTimeout(pending.timeout);
      this.pendingCalls.delete(id);
    }
  }

  getSuccessCount(): number {
    return this.successCount;
  }

  getErrorCount(): number {
    return this.errorCount;
  }

  getPendingCount(): number {
    return this.pendingCalls.size;
  }

  /**
   * Handle incoming MQTT service call request
   * Payload is FLAT: { service, args, correlationId, responseTopic }
   */
  private handleServiceRequest(payload: Record<string, unknown>): void {
    const service = payload.service as string | undefined;
    const args = payload.args as unknown;
    const correlationId = payload.correlationId as string | undefined;
    const responseTopic = payload.responseTopic as string | undefined;

    if (!service || !correlationId || !responseTopic) {
      this.logger.error(`Invalid service call request: missing service, correlationId, or responseTopic`);
      return;
    }

    // Validate service against configured whitelist (if any services are configured)
    if (this.configuredServices.size > 0 && !this.configuredServices.has(service)) {
      this.logger.error(`Service call rejected: ${service} is not in the configured services whitelist`);
      this.mqtt.respondError(
        responseTopic,
        correlationId,
        'SERVICE_NOT_ALLOWED',
        `Service ${service} is not in the configured services list for robot ${this.robotName}`,
      ).catch((err) => {
        this.logger.error(`Failed to send rejection response: ${err}`);
      });
      return;
    }

    // Generate a unique ID for the rosbridge call to match responses
    const callId = `svc-${this.robotName}-${++this.callIdCounter}`;

    // Set up timeout
    const timeout = setTimeout(() => {
      const pending = this.pendingCalls.get(callId);
      if (pending) {
        this.pendingCalls.delete(callId);
        this.errorCount++;
        this.mqtt.respondError(
          pending.responseTopic,
          pending.correlationId,
          'SERVICE_TIMEOUT',
          `ROS service call to ${pending.service} timed out after ${this.serviceTimeoutMs}ms`,
        ).catch((err) => {
          this.logger.error(`Failed to send timeout error response: ${err}`);
        });
      }
    }, this.serviceTimeoutMs);

    // Track pending call
    this.pendingCalls.set(callId, {
      correlationId,
      responseTopic,
      timeout,
      service,
    });

    // Send to rosbridge
    this.connection.callService(service, args, callId);
  }

  /**
   * Handle rosbridge service response
   */
  private handleServiceResponse(msg: RosbridgeMessage): void {
    const callId = msg.id;
    if (!callId) return;

    const pending = this.pendingCalls.get(callId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingCalls.delete(callId);

    if (msg.result === true) {
      this.successCount++;
      this.mqtt.respond(pending.responseTopic, pending.correlationId, msg.values).catch((err) => {
        this.logger.error(`Failed to send service response: ${err}`);
      });
    } else {
      this.errorCount++;
      this.mqtt.respondError(
        pending.responseTopic,
        pending.correlationId,
        'ROS_SERVICE_ERROR',
        `ROS service ${pending.service} returned error`,
      ).catch((err) => {
        this.logger.error(`Failed to send service error response: ${err}`);
      });
    }
  }
}
