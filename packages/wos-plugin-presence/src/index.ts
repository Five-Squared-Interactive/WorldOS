/**
 * Presence Plugin
 *
 * Story 11.1: Presence Plugin Core
 *
 * Reference plugin that tracks online user presence in WorldOS.
 * Demonstrates all plugin patterns from the SDK.
 */

import { WOSPlugin, PluginContext, HealthCheckResult } from '@worldos/plugin-sdk';
import { PresenceTracker, SessionJoinedEvent, SessionLeftEvent } from './presence-tracker.js';

/**
 * Presence plugin configuration
 */
export interface PresenceConfig {
  heartbeatInterval: number;
  maxInactivityTime: number;
  trackWorldPresence: boolean;
  enableNotifications: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: PresenceConfig = {
  heartbeatInterval: 30,
  maxInactivityTime: 300,
  trackWorldPresence: true,
  enableNotifications: true,
};

/**
 * Presence Plugin
 *
 * Tracks online users and provides presence information
 * through MQTT topics, CLI commands, and admin panel.
 */
export class PresencePlugin extends WOSPlugin {
  private tracker: PresenceTracker;
  private presenceConfig: PresenceConfig;

  constructor() {
    super();
    this.presenceConfig = DEFAULT_CONFIG;
    this.tracker = new PresenceTracker(this.presenceConfig);
  }

  /**
   * Called when plugin starts
   */
  async onStart(context: PluginContext): Promise<void> {
    // Load configuration
    this.presenceConfig = {
      ...DEFAULT_CONFIG,
      ...context.config,
    };

    // Initialize tracker with config
    this.tracker = new PresenceTracker({
      heartbeatInterval: this.presenceConfig.heartbeatInterval,
      maxInactivityTime: this.presenceConfig.maxInactivityTime,
      trackWorldPresence: this.presenceConfig.trackWorldPresence,
    });

    // Subscribe to session events
    await this.subscribeToTopics(context);

    // Set up event handlers
    this.setupEventHandlers(context);

    // Start tracker
    this.tracker.start();

    context.logger.info('Presence plugin started');
  }

  /**
   * Called when plugin stops
   */
  async onStop(): Promise<void> {
    this.tracker.stop();
  }

  /**
   * Health check handler
   */
  async onHealthCheck(): Promise<HealthCheckResult> {
    return {
      status: 'ok',
      details: {
        onlineUsers: this.tracker.getOnlineCount(),
        worldCounts: this.tracker.getWorldCounts(),
        uptime: this.tracker.getUptime(),
      },
    };
  }

  /**
   * Subscribe to MQTT topics
   */
  private async subscribeToTopics(context: PluginContext): Promise<void> {
    await context.mqtt.subscribeWithHandler(
      'wos/sync/session/+/joined',
      (msg: any) => this.handleSessionJoined(context, msg.topic, msg.payload),
    );

    await context.mqtt.subscribeWithHandler(
      'wos/sync/session/+/left',
      (msg: any) => this.handleSessionLeft(context, msg.topic, msg.payload),
    );

    await context.mqtt.subscribeWithHandler(
      'wos/presence/request/+',
      (msg: any) => this.handlePresenceRequest(context, msg.topic, msg.payload),
    );
  }

  /**
   * Set up event handlers
   */
  private setupEventHandlers(context: PluginContext): void {
    this.tracker.on('user:joined', (presence) => {
      if (this.presenceConfig.enableNotifications) {
        context.mqtt.publishRaw('wos/presence/user/joined', {
          userId: presence.userId,
          sessionId: presence.sessionId,
          worldId: presence.worldId,
          displayName: presence.displayName,
          joinedAt: presence.joinedAt.toISOString(),
        });
      }
    });

    this.tracker.on('user:left', (userId, sessionId, reason) => {
      if (this.presenceConfig.enableNotifications) {
        context.mqtt.publishRaw('wos/presence/user/left', {
          userId,
          sessionId,
          reason,
          leftAt: new Date().toISOString(),
        });
      }
    });
  }

  /**
   * Handle session joined MQTT message
   */
  private handleSessionJoined(
    context: PluginContext,
    topic: string,
    message: unknown
  ): void {
    try {
      const event = message as SessionJoinedEvent;
      this.tracker.handleSessionJoined(event);
      context.logger.debug(`User joined: ${event.userId}`);
    } catch (error) {
      context.logger.error('Failed to handle session joined', { error });
    }
  }

  /**
   * Handle session left MQTT message
   */
  private handleSessionLeft(
    context: PluginContext,
    topic: string,
    message: unknown
  ): void {
    try {
      const event = message as SessionLeftEvent;
      this.tracker.handleSessionLeft(event);
      context.logger.debug(`User left: ${event.userId}`);
    } catch (error) {
      context.logger.error('Failed to handle session left', { error });
    }
  }

  /**
   * Handle presence request
   */
  private handlePresenceRequest(
    context: PluginContext,
    topic: string,
    message: unknown
  ): void {
    try {
      const request = message as { requestId: string; type: string; worldId?: string };
      let response: unknown;

      switch (request.type) {
        case 'list':
          response = {
            requestId: request.requestId,
            users: request.worldId
              ? this.tracker.getUsersInWorld(request.worldId)
              : this.tracker.getAllUsers(),
          };
          break;

        case 'count':
          response = {
            requestId: request.requestId,
            count: request.worldId
              ? this.tracker.getUsersInWorld(request.worldId).length
              : this.tracker.getOnlineCount(),
            worldCounts: this.tracker.getWorldCounts(),
          };
          break;

        case 'isOnline':
          const userId = (message as { userId: string }).userId;
          response = {
            requestId: request.requestId,
            online: this.tracker.isOnline(userId),
            user: this.tracker.getUser(userId),
          };
          break;

        default:
          response = {
            requestId: request.requestId,
            error: `Unknown request type: ${request.type}`,
          };
      }

      context.mqtt.publishRaw(`wos/presence/response/${request.requestId}`, response);
    } catch (error) {
      context.logger.error('Failed to handle presence request', { error });
    }
  }

  /**
   * Get the presence tracker (for testing/CLI)
   */
  getTracker(): PresenceTracker {
    return this.tracker;
  }
}

// Export the plugin instance
export const plugin = new PresencePlugin();

// Re-export types and modules
export * from './presence-tracker.js';
export * from './health.js';
export * from './cli/index.js';
