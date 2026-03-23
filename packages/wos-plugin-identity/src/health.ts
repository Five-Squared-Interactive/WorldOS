// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import type { UserStore } from './user-store.js';
import type { SessionManager } from './session-manager.js';

export type HealthStatusValue = 'ok' | 'degraded' | 'unhealthy';

export interface IdentityHealthStatus {
  status: HealthStatusValue;
  details: {
    totalUsers: number;
    activeSessions: number;
    dbConnected: boolean;
  };
}

export interface IdentityMetrics {
  totalUsers: number;
  activeSessions: number;
  hasAdmin: boolean;
  timestamp: string;
}

/**
 * Collect health status from identity services.
 */
export function collectHealthStatus(
  userStore: UserStore,
  sessionManager: SessionManager,
): IdentityHealthStatus {
  let dbConnected = true;
  let totalUsers = 0;
  let activeSessions = 0;

  try {
    const users = userStore.listUsers();
    totalUsers = users.length;
    activeSessions = sessionManager.getActiveSessionCount();
  } catch {
    dbConnected = false;
  }

  return {
    status: dbConnected ? 'ok' : 'degraded',
    details: {
      totalUsers,
      activeSessions,
      dbConnected,
    },
  };
}

/**
 * Collect metrics from identity services.
 */
export function collectMetrics(
  userStore: UserStore,
  sessionManager: SessionManager,
): IdentityMetrics {
  return {
    totalUsers: userStore.listUsers().length,
    activeSessions: sessionManager.getActiveSessionCount(),
    hasAdmin: userStore.hasAdminUsers(),
    timestamp: new Date().toISOString(),
  };
}
