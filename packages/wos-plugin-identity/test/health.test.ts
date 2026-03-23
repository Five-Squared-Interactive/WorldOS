// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, vi } from 'vitest';
import { collectHealthStatus, collectMetrics } from '../src/health.js';

// Mock service interfaces matching what health module expects
function mockUserStore(overrides: Partial<{ userCount: number; adminCount: number; dbOk: boolean }> = {}) {
  const { userCount = 5, adminCount = 1, dbOk = true } = overrides;
  return {
    listUsers: vi.fn(() => {
      if (!dbOk) throw new Error('database is closed');
      return Array.from({ length: userCount }, (_, i) => ({ id: `u${i}` }));
    }),
    hasAdminUsers: vi.fn(() => adminCount > 0),
  };
}

function mockSessionManager(overrides: Partial<{ activeCount: number }> = {}) {
  const { activeCount = 3 } = overrides;
  return {
    getActiveSessionCount: vi.fn(() => activeCount),
  };
}

describe('Health Module', () => {
  describe('collectHealthStatus', () => {
    it('should return ok status when all services are healthy', () => {
      const status = collectHealthStatus(
        mockUserStore() as any,
        mockSessionManager() as any,
      );
      expect(status.status).toBe('ok');
      expect(status.details.totalUsers).toBe(5);
      expect(status.details.activeSessions).toBe(3);
    });

    it('should return degraded when DB is unreachable', () => {
      const status = collectHealthStatus(
        mockUserStore({ dbOk: false }) as any,
        mockSessionManager() as any,
      );
      expect(status.status).toBe('degraded');
    });

    it('should include user count and session count in details', () => {
      const status = collectHealthStatus(
        mockUserStore({ userCount: 10 }) as any,
        mockSessionManager({ activeCount: 7 }) as any,
      );
      expect(status.details.totalUsers).toBe(10);
      expect(status.details.activeSessions).toBe(7);
    });
  });

  describe('collectMetrics', () => {
    it('should return total users and active sessions', () => {
      const metrics = collectMetrics(
        mockUserStore({ userCount: 8 }) as any,
        mockSessionManager({ activeCount: 4 }) as any,
      );
      expect(metrics.totalUsers).toBe(8);
      expect(metrics.activeSessions).toBe(4);
      expect(metrics.timestamp).toBeDefined();
    });

    it('should include hasAdmin flag', () => {
      const metrics = collectMetrics(
        mockUserStore({ adminCount: 1 }) as any,
        mockSessionManager() as any,
      );
      expect(metrics.hasAdmin).toBe(true);

      const metrics2 = collectMetrics(
        mockUserStore({ adminCount: 0 }) as any,
        mockSessionManager() as any,
      );
      expect(metrics2.hasAdmin).toBe(false);
    });
  });
});
