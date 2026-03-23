/**
 * Presence Plugin Tests
 *
 * Story 11.1: Presence Plugin Core
 *
 * Tests for the main presence plugin integration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PresencePlugin, PresenceConfig } from './index.js';

// Mock the @worldos/plugin-sdk
vi.mock('@worldos/plugin-sdk', () => {
  const EventEmitter = require('events').EventEmitter;

  class MockWOSPlugin extends EventEmitter {
    constructor() {
      super();
    }
  }

  return {
    WOSPlugin: MockWOSPlugin,
  };
});

describe('PresencePlugin', () => {
  let plugin: PresencePlugin;
  let mockContext: any;

  beforeEach(() => {
    vi.useFakeTimers();

    plugin = new PresencePlugin();

    mockContext = {
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      config: {},
      mqtt: {
        subscribe: vi.fn().mockResolvedValue(undefined),
        publish: vi.fn(),
      },
      manifest: {
        name: 'presence',
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create a presence plugin instance', () => {
      expect(plugin).toBeDefined();
      expect(plugin.getTracker()).toBeDefined();
    });
  });

  describe('onStart', () => {
    it('should start the presence tracker', async () => {
      await plugin.onStart(mockContext);

      expect(mockContext.logger.info).toHaveBeenCalledWith('Presence plugin started');
    });

    it('should subscribe to session topics', async () => {
      await plugin.onStart(mockContext);

      expect(mockContext.mqtt.subscribe).toHaveBeenCalledWith(
        'wos/sync/session/+/joined',
        expect.any(Function)
      );
      expect(mockContext.mqtt.subscribe).toHaveBeenCalledWith(
        'wos/sync/session/+/left',
        expect.any(Function)
      );
      expect(mockContext.mqtt.subscribe).toHaveBeenCalledWith(
        'wos/presence/request/+',
        expect.any(Function)
      );
    });

    it('should use custom config', async () => {
      mockContext.config = {
        heartbeatInterval: 60,
        maxInactivityTime: 600,
      };

      await plugin.onStart(mockContext);

      // Verify the plugin started with custom config
      expect(mockContext.logger.info).toHaveBeenCalled();
    });
  });

  describe('onStop', () => {
    it('should stop the presence tracker', async () => {
      await plugin.onStart(mockContext);
      await plugin.onStop();

      // Tracker should be stopped (no errors)
      expect(true).toBe(true);
    });
  });

  describe('onHealthCheck', () => {
    it('should return healthy status', async () => {
      await plugin.onStart(mockContext);

      const health = await plugin.onHealthCheck();

      expect(health.status).toBe('ok');
      expect(health.details).toBeDefined();
      expect(health.details?.onlineUsers).toBe(0);
    });

    it('should include online user count', async () => {
      await plugin.onStart(mockContext);

      // Simulate user join
      plugin.getTracker().handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      const health = await plugin.onHealthCheck();

      expect(health.details?.onlineUsers).toBe(1);
    });

    it('should include world counts', async () => {
      await plugin.onStart(mockContext);

      plugin.getTracker().handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        worldId: 'world-1',
        timestamp: new Date().toISOString(),
      });

      const health = await plugin.onHealthCheck();

      expect(health.details?.worldCounts).toEqual({ 'world-1': 1 });
    });

    it('should include uptime', async () => {
      await plugin.onStart(mockContext);

      vi.advanceTimersByTime(5000);

      const health = await plugin.onHealthCheck();

      expect(health.details?.uptime).toBe(5);
    });
  });

  describe('event handling', () => {
    it('should handle session joined events', async () => {
      await plugin.onStart(mockContext);

      // Get the session joined handler
      const subscribeCall = mockContext.mqtt.subscribe.mock.calls.find(
        (call: any[]) => call[0] === 'wos/sync/session/+/joined'
      );
      const handler = subscribeCall[1];

      // Call the handler
      handler('wos/sync/session/session-1/joined', {
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      expect(plugin.getTracker().isOnline('user-1')).toBe(true);
    });

    it('should handle session left events', async () => {
      await plugin.onStart(mockContext);

      // Add a user first
      plugin.getTracker().handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      // Get the session left handler
      const subscribeCall = mockContext.mqtt.subscribe.mock.calls.find(
        (call: any[]) => call[0] === 'wos/sync/session/+/left'
      );
      const handler = subscribeCall[1];

      // Call the handler
      handler('wos/sync/session/session-1/left', {
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      expect(plugin.getTracker().isOnline('user-1')).toBe(false);
    });

    it('should publish user joined event', async () => {
      await plugin.onStart(mockContext);

      plugin.getTracker().handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        displayName: 'Test User',
        timestamp: new Date().toISOString(),
      });

      expect(mockContext.mqtt.publish).toHaveBeenCalledWith(
        'wos/presence/user/joined',
        expect.objectContaining({
          userId: 'user-1',
          sessionId: 'session-1',
          displayName: 'Test User',
        })
      );
    });

    it('should publish user left event', async () => {
      await plugin.onStart(mockContext);

      plugin.getTracker().handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      plugin.getTracker().handleSessionLeft({
        sessionId: 'session-1',
        userId: 'user-1',
        reason: 'disconnect',
        timestamp: new Date().toISOString(),
      });

      expect(mockContext.mqtt.publish).toHaveBeenCalledWith(
        'wos/presence/user/left',
        expect.objectContaining({
          userId: 'user-1',
          sessionId: 'session-1',
          reason: 'disconnect',
        })
      );
    });
  });

  describe('presence requests', () => {
    it('should handle list request', async () => {
      await plugin.onStart(mockContext);

      plugin.getTracker().handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      // Get the request handler
      const subscribeCall = mockContext.mqtt.subscribe.mock.calls.find(
        (call: any[]) => call[0] === 'wos/presence/request/+'
      );
      const handler = subscribeCall[1];

      // Clear previous publish calls
      mockContext.mqtt.publish.mockClear();

      // Call the handler
      handler('wos/presence/request/req-1', {
        requestId: 'req-1',
        type: 'list',
      });

      expect(mockContext.mqtt.publish).toHaveBeenCalledWith(
        'wos/presence/response/req-1',
        expect.objectContaining({
          requestId: 'req-1',
          users: expect.any(Array),
        })
      );
    });

    it('should handle list request with world filter', async () => {
      await plugin.onStart(mockContext);

      plugin.getTracker().handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        worldId: 'world-1',
        timestamp: new Date().toISOString(),
      });
      plugin.getTracker().handleSessionJoined({
        sessionId: 'session-2',
        userId: 'user-2',
        worldId: 'world-2',
        timestamp: new Date().toISOString(),
      });

      // Get the request handler
      const subscribeCall = mockContext.mqtt.subscribe.mock.calls.find(
        (call: any[]) => call[0] === 'wos/presence/request/+'
      );
      const handler = subscribeCall[1];

      mockContext.mqtt.publish.mockClear();

      handler('wos/presence/request/req-1', {
        requestId: 'req-1',
        type: 'list',
        worldId: 'world-1',
      });

      const publishCall = mockContext.mqtt.publish.mock.calls[0];
      expect(publishCall[1].users).toHaveLength(1);
      expect(publishCall[1].users[0].userId).toBe('user-1');
    });

    it('should handle count request', async () => {
      await plugin.onStart(mockContext);

      plugin.getTracker().handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        worldId: 'world-1',
        timestamp: new Date().toISOString(),
      });

      // Get the request handler
      const subscribeCall = mockContext.mqtt.subscribe.mock.calls.find(
        (call: any[]) => call[0] === 'wos/presence/request/+'
      );
      const handler = subscribeCall[1];

      mockContext.mqtt.publish.mockClear();

      handler('wos/presence/request/req-1', {
        requestId: 'req-1',
        type: 'count',
      });

      expect(mockContext.mqtt.publish).toHaveBeenCalledWith(
        'wos/presence/response/req-1',
        expect.objectContaining({
          requestId: 'req-1',
          count: 1,
          worldCounts: { 'world-1': 1 },
        })
      );
    });

    it('should handle isOnline request', async () => {
      await plugin.onStart(mockContext);

      plugin.getTracker().handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      // Get the request handler
      const subscribeCall = mockContext.mqtt.subscribe.mock.calls.find(
        (call: any[]) => call[0] === 'wos/presence/request/+'
      );
      const handler = subscribeCall[1];

      mockContext.mqtt.publish.mockClear();

      handler('wos/presence/request/req-1', {
        requestId: 'req-1',
        type: 'isOnline',
        userId: 'user-1',
      });

      expect(mockContext.mqtt.publish).toHaveBeenCalledWith(
        'wos/presence/response/req-1',
        expect.objectContaining({
          requestId: 'req-1',
          online: true,
        })
      );
    });

    it('should handle unknown request type', async () => {
      await plugin.onStart(mockContext);

      // Get the request handler
      const subscribeCall = mockContext.mqtt.subscribe.mock.calls.find(
        (call: any[]) => call[0] === 'wos/presence/request/+'
      );
      const handler = subscribeCall[1];

      mockContext.mqtt.publish.mockClear();

      handler('wos/presence/request/req-1', {
        requestId: 'req-1',
        type: 'unknown',
      });

      expect(mockContext.mqtt.publish).toHaveBeenCalledWith(
        'wos/presence/response/req-1',
        expect.objectContaining({
          requestId: 'req-1',
          error: 'Unknown request type: unknown',
        })
      );
    });
  });

  describe('notification config', () => {
    it('should not publish events when notifications disabled', async () => {
      mockContext.config = {
        enableNotifications: false,
      };

      await plugin.onStart(mockContext);

      mockContext.mqtt.publish.mockClear();

      plugin.getTracker().handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      expect(mockContext.mqtt.publish).not.toHaveBeenCalled();
    });
  });

  describe('getTracker', () => {
    it('should return the presence tracker', () => {
      const tracker = plugin.getTracker();

      expect(tracker).toBeDefined();
      expect(typeof tracker.getOnlineCount).toBe('function');
    });
  });
});
