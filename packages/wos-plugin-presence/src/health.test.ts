/**
 * Presence Health & Metrics Tests
 *
 * Story 11.4: Presence Health & Metrics
 *
 * Tests for health status and metrics collection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  collectHealthStatus,
  collectMetrics,
  formatHealthStatus,
  createHealthHandler,
  PresenceHealthStatus,
  PresenceMetrics,
} from './health.js';
import { PresenceTracker } from './presence-tracker.js';

describe('Health & Metrics', () => {
  let tracker: PresenceTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    tracker = new PresenceTracker();
  });

  afterEach(() => {
    tracker.stop();
    vi.useRealTimers();
  });

  describe('collectHealthStatus', () => {
    it('should return ok status when healthy', () => {
      const status = collectHealthStatus(tracker);

      expect(status.status).toBe('ok');
    });

    it('should include online user count', () => {
      tracker.handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      const status = collectHealthStatus(tracker);

      expect(status.onlineUsers).toBe(1);
    });

    it('should include world counts', () => {
      tracker.handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        worldId: 'world-1',
        timestamp: new Date().toISOString(),
      });

      const status = collectHealthStatus(tracker);

      expect(status.worldCounts['world-1']).toBe(1);
    });

    it('should include uptime', () => {
      vi.advanceTimersByTime(5000);

      const status = collectHealthStatus(tracker);

      expect(status.uptime).toBe(5);
    });

    it('should return degraded when MQTT disconnected', () => {
      const status = collectHealthStatus(tracker, { mqttConnected: false });

      expect(status.status).toBe('degraded');
    });

    it('should include MQTT connection status in details', () => {
      const status = collectHealthStatus(tracker, { mqttConnected: true });

      expect(status.details?.mqttConnected).toBe(true);
    });

    it('should include away users count', () => {
      tracker.handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      // Mark user as away
      const user = tracker.getUser('user-1');
      if (user) user.status = 'away';

      const status = collectHealthStatus(tracker);

      expect(status.details?.awayUsers).toBe(1);
    });

    it('should include last activity timestamp', () => {
      tracker.handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      const status = collectHealthStatus(tracker);

      expect(status.details?.lastActivity).toBeDefined();
    });

    it('should include memory usage', () => {
      const status = collectHealthStatus(tracker);

      expect(status.details?.memoryUsage).toBeDefined();
      expect(status.details?.memoryUsage?.heapUsed).toBeGreaterThan(0);
    });
  });

  describe('collectMetrics', () => {
    it('should return online users count', () => {
      tracker.handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });
      tracker.handleSessionJoined({
        sessionId: 'session-2',
        userId: 'user-2',
        timestamp: new Date().toISOString(),
      });

      const metrics = collectMetrics(tracker);

      expect(metrics.onlineUsers).toBe(2);
    });

    it('should return away users count', () => {
      tracker.handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      const user = tracker.getUser('user-1');
      if (user) user.status = 'away';

      const metrics = collectMetrics(tracker);

      expect(metrics.awayUsers).toBe(1);
    });

    it('should return world counts', () => {
      tracker.handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        worldId: 'world-1',
        timestamp: new Date().toISOString(),
      });
      tracker.handleSessionJoined({
        sessionId: 'session-2',
        userId: 'user-2',
        worldId: 'world-1',
        timestamp: new Date().toISOString(),
      });
      tracker.handleSessionJoined({
        sessionId: 'session-3',
        userId: 'user-3',
        worldId: 'world-2',
        timestamp: new Date().toISOString(),
      });

      const metrics = collectMetrics(tracker);

      expect(metrics.worldCounts['world-1']).toBe(2);
      expect(metrics.worldCounts['world-2']).toBe(1);
    });

    it('should return active worlds count', () => {
      tracker.handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        worldId: 'world-1',
        timestamp: new Date().toISOString(),
      });
      tracker.handleSessionJoined({
        sessionId: 'session-2',
        userId: 'user-2',
        worldId: 'world-2',
        timestamp: new Date().toISOString(),
      });

      const metrics = collectMetrics(tracker);

      expect(metrics.activeWorlds).toBe(2);
    });

    it('should include timestamp', () => {
      const metrics = collectMetrics(tracker);

      expect(metrics.timestamp).toBeDefined();
      expect(() => new Date(metrics.timestamp)).not.toThrow();
    });

    it('should include uptime', () => {
      vi.advanceTimersByTime(10000);

      const metrics = collectMetrics(tracker);

      expect(metrics.uptime).toBe(10);
    });
  });

  describe('formatHealthStatus', () => {
    it('should show ok status with checkmark', () => {
      const status: PresenceHealthStatus = {
        status: 'ok',
        onlineUsers: 5,
        worldCounts: {},
        uptime: 100,
      };

      const output = formatHealthStatus(status);

      expect(output).toContain('✓');
      expect(output).toContain('OK');
    });

    it('should show degraded status with warning', () => {
      const status: PresenceHealthStatus = {
        status: 'degraded',
        onlineUsers: 5,
        worldCounts: {},
        uptime: 100,
      };

      const output = formatHealthStatus(status);

      expect(output).toContain('!');
      expect(output).toContain('DEGRADED');
    });

    it('should show unhealthy status with X', () => {
      const status: PresenceHealthStatus = {
        status: 'unhealthy',
        onlineUsers: 0,
        worldCounts: {},
        uptime: 0,
      };

      const output = formatHealthStatus(status);

      expect(output).toContain('✗');
      expect(output).toContain('UNHEALTHY');
    });

    it('should show online users count', () => {
      const status: PresenceHealthStatus = {
        status: 'ok',
        onlineUsers: 10,
        worldCounts: {},
        uptime: 100,
      };

      const output = formatHealthStatus(status);

      expect(output).toContain('Online users: 10');
    });

    it('should show world breakdown', () => {
      const status: PresenceHealthStatus = {
        status: 'ok',
        onlineUsers: 5,
        worldCounts: {
          'world-1': 3,
          'world-2': 2,
        },
        uptime: 100,
      };

      const output = formatHealthStatus(status);

      expect(output).toContain('Worlds:');
      expect(output).toContain('world-1: 3 users');
      expect(output).toContain('world-2: 2 users');
    });

    it('should format uptime with days/hours/minutes/seconds', () => {
      const status: PresenceHealthStatus = {
        status: 'ok',
        onlineUsers: 0,
        worldCounts: {},
        uptime: 90061, // 1 day, 1 hour, 1 minute, 1 second
      };

      const output = formatHealthStatus(status);

      expect(output).toContain('1d');
      expect(output).toContain('1h');
      expect(output).toContain('1m');
      expect(output).toContain('1s');
    });

    it('should show MQTT disconnected warning', () => {
      const status: PresenceHealthStatus = {
        status: 'degraded',
        onlineUsers: 0,
        worldCounts: {},
        uptime: 100,
        details: {
          mqttConnected: false,
        },
      };

      const output = formatHealthStatus(status);

      expect(output).toContain('MQTT disconnected');
    });

    it('should show away users count', () => {
      const status: PresenceHealthStatus = {
        status: 'ok',
        onlineUsers: 5,
        worldCounts: {},
        uptime: 100,
        details: {
          awayUsers: 2,
        },
      };

      const output = formatHealthStatus(status);

      expect(output).toContain('Away users: 2');
    });
  });

  describe('createHealthHandler', () => {
    it('should create a health handler function', () => {
      const handler = createHealthHandler(tracker);

      expect(typeof handler).toBe('function');
    });

    it('should return health status when called', () => {
      const handler = createHealthHandler(tracker);

      tracker.handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      const status = handler();

      expect(status.status).toBe('ok');
      expect(status.onlineUsers).toBe(1);
    });

    it('should accept MQTT connection status', () => {
      const handler = createHealthHandler(tracker);

      const status = handler({ mqttConnected: false });

      expect(status.status).toBe('degraded');
    });
  });
});
