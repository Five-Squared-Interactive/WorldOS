/**
 * Presence Tracker
 *
 * Story 11.1: Presence Plugin Core
 *
 * Core presence tracking logic that maintains an in-memory
 * map of online users and publishes presence events.
 */

import { EventEmitter } from 'events';

/**
 * User presence information
 */
export interface UserPresence {
  /** User ID */
  userId: string;
  /** Session ID */
  sessionId: string;
  /** World ID the user is in (if tracked) */
  worldId?: string;
  /** When the user joined */
  joinedAt: Date;
  /** Last activity timestamp */
  lastActivity: Date;
  /** User display name */
  displayName?: string;
  /** Avatar URL */
  avatarUrl?: string;
  /** Current status */
  status: 'online' | 'away' | 'busy';
}

/**
 * Session joined event data
 */
export interface SessionJoinedEvent {
  sessionId: string;
  userId: string;
  worldId?: string;
  displayName?: string;
  avatarUrl?: string;
  timestamp: string;
}

/**
 * Session left event data
 */
export interface SessionLeftEvent {
  sessionId: string;
  userId: string;
  reason?: 'disconnect' | 'timeout' | 'kick' | 'ban';
  timestamp: string;
}

/**
 * Presence tracker configuration
 */
export interface PresenceTrackerConfig {
  /** Interval in seconds between heartbeat checks */
  heartbeatInterval: number;
  /** Time in seconds before marking user as away */
  maxInactivityTime: number;
  /** Track which world each user is in */
  trackWorldPresence: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: PresenceTrackerConfig = {
  heartbeatInterval: 30,
  maxInactivityTime: 300,
  trackWorldPresence: true,
};

/**
 * Presence tracker events
 */
export interface PresenceTrackerEvents {
  'user:joined': (presence: UserPresence) => void;
  'user:left': (userId: string, sessionId: string, reason?: string) => void;
  'user:away': (userId: string) => void;
  'user:back': (userId: string) => void;
}

/**
 * Presence Tracker
 *
 * Maintains an in-memory map of online users and emits events
 * when users join, leave, or change status.
 */
export class PresenceTracker extends EventEmitter {
  private users: Map<string, UserPresence> = new Map();
  private sessionToUser: Map<string, string> = new Map();
  private config: PresenceTrackerConfig;
  private heartbeatTimer?: NodeJS.Timeout;
  private startTime: Date;

  constructor(config: Partial<PresenceTrackerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startTime = new Date();
  }

  /**
   * Start the presence tracker
   */
  start(): void {
    this.startHeartbeat();
  }

  /**
   * Stop the presence tracker
   */
  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /**
   * Handle session joined event
   */
  handleSessionJoined(event: SessionJoinedEvent): UserPresence {
    const presence: UserPresence = {
      userId: event.userId,
      sessionId: event.sessionId,
      worldId: event.worldId,
      joinedAt: new Date(event.timestamp),
      lastActivity: new Date(),
      displayName: event.displayName,
      avatarUrl: event.avatarUrl,
      status: 'online',
    };

    this.users.set(event.userId, presence);
    this.sessionToUser.set(event.sessionId, event.userId);

    this.emit('user:joined', presence);

    return presence;
  }

  /**
   * Handle session left event
   */
  handleSessionLeft(event: SessionLeftEvent): boolean {
    const userId = this.sessionToUser.get(event.sessionId);

    if (!userId) {
      return false;
    }

    this.users.delete(userId);
    this.sessionToUser.delete(event.sessionId);

    this.emit('user:left', userId, event.sessionId, event.reason);

    return true;
  }

  /**
   * Update user activity
   */
  updateActivity(userId: string): boolean {
    const user = this.users.get(userId);

    if (!user) {
      return false;
    }

    const wasAway = user.status === 'away';
    user.lastActivity = new Date();
    user.status = 'online';

    if (wasAway) {
      this.emit('user:back', userId);
    }

    return true;
  }

  /**
   * Update user world
   */
  updateUserWorld(userId: string, worldId: string): boolean {
    if (!this.config.trackWorldPresence) {
      return false;
    }

    const user = this.users.get(userId);

    if (!user) {
      return false;
    }

    user.worldId = worldId;
    user.lastActivity = new Date();

    return true;
  }

  /**
   * Get user presence by user ID
   */
  getUser(userId: string): UserPresence | undefined {
    return this.users.get(userId);
  }

  /**
   * Get user presence by session ID
   */
  getUserBySession(sessionId: string): UserPresence | undefined {
    const userId = this.sessionToUser.get(sessionId);
    return userId ? this.users.get(userId) : undefined;
  }

  /**
   * Get all online users
   */
  getAllUsers(): UserPresence[] {
    return Array.from(this.users.values());
  }

  /**
   * Get users in a specific world
   */
  getUsersInWorld(worldId: string): UserPresence[] {
    return this.getAllUsers().filter((user) => user.worldId === worldId);
  }

  /**
   * Get online user count
   */
  getOnlineCount(): number {
    return this.users.size;
  }

  /**
   * Get user counts per world
   */
  getWorldCounts(): Record<string, number> {
    const counts: Record<string, number> = {};

    for (const user of this.users.values()) {
      if (user.worldId) {
        counts[user.worldId] = (counts[user.worldId] || 0) + 1;
      }
    }

    return counts;
  }

  /**
   * Check if user is online
   */
  isOnline(userId: string): boolean {
    return this.users.has(userId);
  }

  /**
   * Kick a user
   */
  kickUser(userId: string, reason?: string): boolean {
    const user = this.users.get(userId);

    if (!user) {
      return false;
    }

    this.users.delete(userId);
    this.sessionToUser.delete(user.sessionId);

    this.emit('user:left', userId, user.sessionId, reason || 'kick');

    return true;
  }

  /**
   * Get tracker uptime in seconds
   */
  getUptime(): number {
    return Math.floor((Date.now() - this.startTime.getTime()) / 1000);
  }

  /**
   * Start heartbeat timer for inactivity checks
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.checkInactivity();
    }, this.config.heartbeatInterval * 1000);
  }

  /**
   * Check for inactive users
   */
  private checkInactivity(): void {
    const now = Date.now();
    const maxInactivityMs = this.config.maxInactivityTime * 1000;

    for (const user of this.users.values()) {
      const inactiveTime = now - user.lastActivity.getTime();

      if (inactiveTime > maxInactivityMs && user.status === 'online') {
        user.status = 'away';
        this.emit('user:away', user.userId);
      }
    }
  }
}
