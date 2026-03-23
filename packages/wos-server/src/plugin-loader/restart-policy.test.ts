/**
 * Restart Policy Tests
 *
 * Story 1.6: Automatic Restart with Exponential Backoff
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RestartPolicy, calculateBackoffDelay } from './restart-policy.js';
import { DEFAULT_RESTART_POLICY } from './types.js';

describe('RestartPolicy', () => {
  let policy: RestartPolicy;

  beforeEach(() => {
    policy = new RestartPolicy();
  });

  describe('getRestartDecision', () => {
    it('should allow restart on first failure', () => {
      const decision = policy.getRestartDecision('test-plugin');

      expect(decision.shouldRestart).toBe(true);
      expect(decision.delayMs).toBe(1000); // Initial backoff
      expect(decision.reason).toContain('Restart attempt 1');
    });

    it('should increase delay with exponential backoff', () => {
      // First restart
      policy.recordRestart('test-plugin');
      let decision = policy.getRestartDecision('test-plugin');
      expect(decision.delayMs).toBe(2000); // 1000 * 2^1

      // Second restart
      policy.recordRestart('test-plugin');
      decision = policy.getRestartDecision('test-plugin');
      expect(decision.delayMs).toBe(4000); // 1000 * 2^2

      // Third restart
      policy.recordRestart('test-plugin');
      decision = policy.getRestartDecision('test-plugin');
      expect(decision.delayMs).toBe(8000); // 1000 * 2^3
    });

    it('should cap delay at maxBackoffMs', () => {
      // Use a policy with a high circuit breaker threshold to test max backoff
      const highThresholdPolicy = new RestartPolicy({
        circuitBreakerThreshold: 20,
      });

      // Simulate many restarts
      for (let i = 0; i < 10; i++) {
        highThresholdPolicy.recordRestart('test-plugin');
      }

      const decision = highThresholdPolicy.getRestartDecision('test-plugin');
      expect(decision.delayMs).toBe(30000); // maxBackoffMs
    });

    it('should trip circuit breaker after threshold', () => {
      // Record failures within window
      for (let i = 0; i < 5; i++) {
        policy.recordRestart('test-plugin');
      }

      const decision = policy.getRestartDecision('test-plugin');
      expect(decision.shouldRestart).toBe(false);
      expect(decision.reason).toContain('Circuit breaker tripped');
    });

    it('should not restart if circuit breaker is already tripped', () => {
      // Trip the circuit breaker
      for (let i = 0; i < 5; i++) {
        policy.recordRestart('test-plugin');
      }
      policy.getRestartDecision('test-plugin'); // This trips it

      // Try again
      const decision = policy.getRestartDecision('test-plugin');
      expect(decision.shouldRestart).toBe(false);
    });
  });

  describe('recordRestart', () => {
    it('should increment restart count', () => {
      expect(policy.getRestartCount('test-plugin')).toBe(0);

      policy.recordRestart('test-plugin');
      expect(policy.getRestartCount('test-plugin')).toBe(1);

      policy.recordRestart('test-plugin');
      expect(policy.getRestartCount('test-plugin')).toBe(2);
    });
  });

  describe('recordStable', () => {
    it('should reset restart count after stable period', () => {
      vi.useFakeTimers();

      // Simulate some restarts
      policy.recordRestart('test-plugin');
      policy.recordRestart('test-plugin');
      expect(policy.getRestartCount('test-plugin')).toBe(2);

      // First stable call sets the timestamp
      policy.recordStable('test-plugin');
      expect(policy.getRestartCount('test-plugin')).toBe(2);

      // Advance time past stable threshold
      vi.advanceTimersByTime(60001);

      // Second stable call should reset
      policy.recordStable('test-plugin');
      expect(policy.getRestartCount('test-plugin')).toBe(0);

      vi.useRealTimers();
    });

    it('should reset circuit breaker after stable period', () => {
      vi.useFakeTimers();

      // Trip circuit breaker
      for (let i = 0; i < 5; i++) {
        policy.recordRestart('test-plugin');
      }
      policy.getRestartDecision('test-plugin');
      expect(policy.isCircuitBroken('test-plugin')).toBe(true);

      // Stable calls
      policy.recordStable('test-plugin');
      vi.advanceTimersByTime(60001);
      policy.recordStable('test-plugin');

      expect(policy.isCircuitBroken('test-plugin')).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('reset', () => {
    it('should clear all state for plugin', () => {
      policy.recordRestart('test-plugin');
      policy.recordRestart('test-plugin');
      expect(policy.getRestartCount('test-plugin')).toBe(2);

      policy.reset('test-plugin');
      expect(policy.getRestartCount('test-plugin')).toBe(0);
    });
  });

  describe('resetCircuitBreaker', () => {
    it('should reset circuit breaker manually', () => {
      // Trip circuit breaker
      for (let i = 0; i < 5; i++) {
        policy.recordRestart('test-plugin');
      }
      policy.getRestartDecision('test-plugin');
      expect(policy.isCircuitBroken('test-plugin')).toBe(true);

      policy.resetCircuitBreaker('test-plugin');

      expect(policy.isCircuitBroken('test-plugin')).toBe(false);
      expect(policy.getRestartCount('test-plugin')).toBe(0);
    });
  });

  describe('isCircuitBroken', () => {
    it('should return false for new plugin', () => {
      expect(policy.isCircuitBroken('new-plugin')).toBe(false);
    });

    it('should return true after circuit breaker trips', () => {
      for (let i = 0; i < 5; i++) {
        policy.recordRestart('test-plugin');
      }
      policy.getRestartDecision('test-plugin');

      expect(policy.isCircuitBroken('test-plugin')).toBe(true);
    });
  });

  describe('getConfig', () => {
    it('should return copy of config', () => {
      const config = policy.getConfig();

      expect(config.initialBackoffMs).toBe(DEFAULT_RESTART_POLICY.initialBackoffMs);
      expect(config.maxBackoffMs).toBe(DEFAULT_RESTART_POLICY.maxBackoffMs);
      expect(config.backoffMultiplier).toBe(DEFAULT_RESTART_POLICY.backoffMultiplier);
    });
  });

  describe('custom configuration', () => {
    it('should use custom initial backoff', () => {
      const customPolicy = new RestartPolicy({ initialBackoffMs: 2000 });

      const decision = customPolicy.getRestartDecision('test-plugin');
      expect(decision.delayMs).toBe(2000);
    });

    it('should use custom max backoff', () => {
      const customPolicy = new RestartPolicy({
        initialBackoffMs: 1000,
        maxBackoffMs: 5000,
        circuitBreakerThreshold: 20, // High threshold so we can test max backoff
      });

      // Simulate many restarts
      for (let i = 0; i < 10; i++) {
        customPolicy.recordRestart('test-plugin');
      }

      const decision = customPolicy.getRestartDecision('test-plugin');
      expect(decision.delayMs).toBe(5000);
    });

    it('should use custom circuit breaker threshold', () => {
      const customPolicy = new RestartPolicy({ circuitBreakerThreshold: 3 });

      for (let i = 0; i < 3; i++) {
        customPolicy.recordRestart('test-plugin');
      }

      const decision = customPolicy.getRestartDecision('test-plugin');
      expect(decision.shouldRestart).toBe(false);
    });
  });

  describe('circuit breaker window', () => {
    it('should clear old entries from history', () => {
      vi.useFakeTimers();

      // Record some restarts (2 failures)
      policy.recordRestart('test-plugin');
      policy.recordRestart('test-plugin');

      // Advance past window (5 minutes)
      vi.advanceTimersByTime(300001);

      // These should be the only ones in the window (2 more failures)
      policy.recordRestart('test-plugin');
      policy.recordRestart('test-plugin');

      // Check the decision - should still allow restart (4 total but only 2 in window)
      // The old entries should be cleared, leaving only 2 in the window
      const decision = policy.getRestartDecision('test-plugin');
      // The restart count is 4, but circuit breaker looks at history within window
      // After cleaning, only 2 entries should remain, which is below threshold of 5
      expect(decision.shouldRestart).toBe(true);

      vi.useRealTimers();
    });
  });
});

describe('calculateBackoffDelay', () => {
  it('should return initial backoff for count 0', () => {
    expect(calculateBackoffDelay(0)).toBe(1000);
  });

  it('should double for each restart', () => {
    expect(calculateBackoffDelay(1)).toBe(2000);
    expect(calculateBackoffDelay(2)).toBe(4000);
    expect(calculateBackoffDelay(3)).toBe(8000);
  });

  it('should cap at max backoff', () => {
    expect(calculateBackoffDelay(10)).toBe(30000);
    expect(calculateBackoffDelay(100)).toBe(30000);
  });

  it('should use custom config', () => {
    expect(calculateBackoffDelay(0, { initialBackoffMs: 500 })).toBe(500);
    expect(calculateBackoffDelay(1, { initialBackoffMs: 500 })).toBe(1000);
    expect(calculateBackoffDelay(10, { maxBackoffMs: 10000 })).toBe(10000);
  });
});
