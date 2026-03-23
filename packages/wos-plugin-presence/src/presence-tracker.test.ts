/**
 * Presence Tracker Tests
 *
 * Story 11.1: Presence Plugin Core
 *
 * Tests for core presence tracking logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PresenceTracker,
  UserPresence,
  SessionJoinedEvent,
  SessionLeftEvent,
  DEFAULT_CONFIG,
} from './presence-tracker.js';

describe('PresenceTracker', () => {
  let tracker: PresenceTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    tracker = new PresenceTracker();
  });

  afterEach(() => {
    tracker.stop();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const tracker = new PresenceTracker();
      expect(tracker.getOnlineCount()).toBe(0);
    });

    it('should accept custom config', () => {
      const tracker = new PresenceTracker({
        heartbeatInterval: 60,
        maxInactivityTime: 600,
      });
      expect(tracker.getOnlineCount()).toBe(0);
    });
  });

  describe('handleSessionJoined', () => {
    it('should add user to presence list', () => {
      const event: SessionJoinedEvent = {
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      };

      const presence = tracker.handleSessionJoined(event);

      expect(presence.userId).toBe('user-1');
      expect(presence.sessionId).toBe('session-1');
      expect(tracker.getOnlineCount()).toBe(1);
    });

    it('should include user info', () => {
      const event: SessionJoinedEvent = {
        sessionId: 'session-1',
        userId: 'user-1',
        displayName: 'Test User',
        avatarUrl: 'https://example.com/avatar.png',
        timestamp: new Date().toISOString(),
      };

      const presence = tracker.handleSessionJoined(event);

      expect(presence.displayName).toBe('Test User');
      expect(presence.avatarUrl).toBe('https://example.com/avatar.png');
    });

    it('should set joined timestamp', () => {
      const timestamp = '2026-02-21T12:00:00.000Z';
      const event: SessionJoinedEvent = {
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp,
      };

      const presence = tracker.handleSessionJoined(event);

      expect(presence.joinedAt.toISOString()).toBe(timestamp);
    });

    it('should set initial status to online', () => {
      const event: SessionJoinedEvent = {
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      };

      const presence = tracker.handleSessionJoined(event);

      expect(presence.status).toBe('online');
    });

    it('should emit user:joined event', () => {
      const handler = vi.fn();
      tracker.on('user:joined', handler);

      const event: SessionJoinedEvent = {
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      };

      tracker.handleSessionJoined(event);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].userId).toBe('user-1');
    });

    it('should track world if configured', () => {
      const event: SessionJoinedEvent = {
        sessionId: 'session-1',
        userId: 'user-1',
        worldId: 'world-1',
        timestamp: new Date().toISOString(),
      };

      const presence = tracker.handleSessionJoined(event);

      expect(presence.worldId).toBe('world-1');
    });
  });

  describe('handleSessionLeft', () => {
    it('should remove user from presence list', () => {
      tracker.handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      const removed = tracker.handleSessionLeft({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      expect(removed).toBe(true);
      expect(tracker.getOnlineCount()).toBe(0);
    });

    it('should return false for unknown session', () => {
      const removed = tracker.handleSessionLeft({
        sessionId: 'unknown',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      expect(removed).toBe(false);
    });

    it('should emit user:left event', () => {
      const handler = vi.fn();
      tracker.on('user:left', handler);

      tracker.handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      tracker.handleSessionLeft({
        sessionId: 'session-1',
        userId: 'user-1',
        reason: 'disconnect',
        timestamp: new Date().toISOString(),
      });

      expect(handler).toHaveBeenCalledWith('user-1', 'session-1', 'disconnect');
    });
  });

  describe('getUser', () => {
    it('should return user by user ID', () => {
      tracker.handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        displayName: 'Test User',
        timestamp: new Date().toISOString(),
      });

      const user = tracker.getUser('user-1');

      expect(user).toBeDefined();
      expect(user?.displayName).toBe('Test User');
    });

    it('should return undefined for unknown user', () => {
      const user = tracker.getUser('unknown');
      expect(user).toBeUndefined();
    });
  });

  describe('getUserBySession', () => {
    it('should return user by session ID', () => {
      tracker.handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      const user = tracker.getUserBySession('session-1');

      expect(user).toBeDefined();
      expect(user?.userId).toBe('user-1');
    });

    it('should return undefined for unknown session', () => {
      const user = tracker.getUserBySession('unknown');
      expect(user).toBeUndefined();
    });
  });

  describe('getAllUsers', () => {
    it('should return all online users', () => {
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

      const users = tracker.getAllUsers();

      expect(users).toHaveLength(2);
    });

    it('should return empty array when no users', () => {
      const users = tracker.getAllUsers();
      expect(users).toHaveLength(0);
    });
  });

  describe('getUsersInWorld', () => {
    it('should return users in specific world', () => {
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
      tracker.handleSessionJoined({
        sessionId: 'session-3',
        userId: 'user-3',
        worldId: 'world-1',
        timestamp: new Date().toISOString(),
      });

      const users = tracker.getUsersInWorld('world-1');

      expect(users).toHaveLength(2);
      expect(users.map((u) => u.userId)).toContain('user-1');
      expect(users.map((u) => u.userId)).toContain('user-3');
    });
  });

  describe('getWorldCounts', () => {
    it('should return user counts per world', () => {
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

      const counts = tracker.getWorldCounts();

      expect(counts['world-1']).toBe(2);
      expect(counts['world-2']).toBe(1);
    });
  });

  describe('isOnline', () => {
    it('should return true for online user', () => {
      tracker.handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      expect(tracker.isOnline('user-1')).toBe(true);
    });

    it('should return false for offline user', () => {
      expect(tracker.isOnline('user-1')).toBe(false);
    });
  });

  describe('kickUser', () => {
    it('should remove user and emit event', () => {
      const handler = vi.fn();
      tracker.on('user:left', handler);

      tracker.handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      const kicked = tracker.kickUser('user-1', 'bad behavior');

      expect(kicked).toBe(true);
      expect(tracker.isOnline('user-1')).toBe(false);
      expect(handler).toHaveBeenCalledWith('user-1', 'session-1', 'bad behavior');
    });

    it('should return false for unknown user', () => {
      const kicked = tracker.kickUser('unknown');
      expect(kicked).toBe(false);
    });

    it('should use default reason of kick', () => {
      const handler = vi.fn();
      tracker.on('user:left', handler);

      tracker.handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      tracker.kickUser('user-1');

      expect(handler).toHaveBeenCalledWith('user-1', 'session-1', 'kick');
    });
  });

  describe('updateActivity', () => {
    it('should update last activity timestamp', () => {
      tracker.handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      const before = tracker.getUser('user-1')?.lastActivity;

      vi.advanceTimersByTime(1000);

      tracker.updateActivity('user-1');

      const after = tracker.getUser('user-1')?.lastActivity;

      expect(after!.getTime()).toBeGreaterThan(before!.getTime());
    });

    it('should change status from away to online', () => {
      tracker.handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      const user = tracker.getUser('user-1')!;
      user.status = 'away';

      const handler = vi.fn();
      tracker.on('user:back', handler);

      tracker.updateActivity('user-1');

      expect(user.status).toBe('online');
      expect(handler).toHaveBeenCalledWith('user-1');
    });

    it('should return false for unknown user', () => {
      const result = tracker.updateActivity('unknown');
      expect(result).toBe(false);
    });
  });

  describe('updateUserWorld', () => {
    it('should update user world', () => {
      tracker.handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        worldId: 'world-1',
        timestamp: new Date().toISOString(),
      });

      tracker.updateUserWorld('user-1', 'world-2');

      const user = tracker.getUser('user-1');
      expect(user?.worldId).toBe('world-2');
    });

    it('should return false when tracking disabled', () => {
      const tracker = new PresenceTracker({ trackWorldPresence: false });

      tracker.handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      const result = tracker.updateUserWorld('user-1', 'world-1');
      expect(result).toBe(false);
    });
  });

  describe('inactivity checking', () => {
    it('should mark users as away after inactivity timeout', () => {
      const tracker = new PresenceTracker({
        heartbeatInterval: 1,
        maxInactivityTime: 5,
      });

      const handler = vi.fn();
      tracker.on('user:away', handler);

      tracker.handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      tracker.start();

      // Advance past inactivity timeout
      vi.advanceTimersByTime(6000);

      expect(handler).toHaveBeenCalledWith('user-1');
      expect(tracker.getUser('user-1')?.status).toBe('away');

      tracker.stop();
    });

    it('should not mark active users as away', () => {
      const tracker = new PresenceTracker({
        heartbeatInterval: 1,
        maxInactivityTime: 5,
      });

      const handler = vi.fn();
      tracker.on('user:away', handler);

      tracker.handleSessionJoined({
        sessionId: 'session-1',
        userId: 'user-1',
        timestamp: new Date().toISOString(),
      });

      tracker.start();

      // Keep updating activity
      vi.advanceTimersByTime(2000);
      tracker.updateActivity('user-1');
      vi.advanceTimersByTime(2000);
      tracker.updateActivity('user-1');
      vi.advanceTimersByTime(2000);

      expect(handler).not.toHaveBeenCalled();
      expect(tracker.getUser('user-1')?.status).toBe('online');

      tracker.stop();
    });
  });

  describe('getUptime', () => {
    it('should return tracker uptime in seconds', () => {
      const tracker = new PresenceTracker();

      vi.advanceTimersByTime(5000);

      expect(tracker.getUptime()).toBe(5);
    });
  });

  describe('default config', () => {
    it('should have expected defaults', () => {
      expect(DEFAULT_CONFIG.heartbeatInterval).toBe(30);
      expect(DEFAULT_CONFIG.maxInactivityTime).toBe(300);
      expect(DEFAULT_CONFIG.trackWorldPresence).toBe(true);
    });
  });
});
