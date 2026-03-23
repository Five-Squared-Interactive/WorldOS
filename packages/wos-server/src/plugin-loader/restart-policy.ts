/**
 * Restart Policy
 *
 * Story 1.6: Automatic Restart with Exponential Backoff
 *
 * Implements exponential backoff (1s-30s) and circuit breaker logic
 * for plugin restart decisions.
 */

import {
  RestartPolicyConfig,
  DEFAULT_RESTART_POLICY,
  RestartDecision,
} from './types.js';

/**
 * Restart history entry
 */
interface RestartHistoryEntry {
  /** Timestamp of the crash/restart */
  timestamp: number;
  /** Backoff delay used (0 if circuit broken) */
  backoffMs: number;
}

/**
 * Plugin restart state
 */
interface PluginRestartState {
  /** Number of consecutive restart attempts */
  restartCount: number;
  /** History of recent restarts for circuit breaker */
  history: RestartHistoryEntry[];
  /** Timestamp when plugin last became stable */
  lastStableAt?: number;
  /** Whether circuit breaker is tripped */
  circuitBroken: boolean;
}

/**
 * Manages restart policy decisions for plugins
 */
export class RestartPolicy {
  private config: RestartPolicyConfig;
  private states: Map<string, PluginRestartState> = new Map();

  constructor(config?: Partial<RestartPolicyConfig>) {
    this.config = {
      ...DEFAULT_RESTART_POLICY,
      ...config,
    };
  }

  /**
   * Get a restart decision for a plugin
   *
   * @param pluginName - Name of the plugin
   * @returns Decision about whether and when to restart
   */
  getRestartDecision(pluginName: string): RestartDecision {
    const state = this.getOrCreateState(pluginName);
    const now = Date.now();

    // Check if circuit breaker is tripped
    if (state.circuitBroken) {
      return {
        shouldRestart: false,
        delayMs: 0,
        reason: 'Circuit breaker is tripped - too many failures',
      };
    }

    // Clean old history entries
    this.cleanHistory(state, now);

    // Check if we would trip the circuit breaker
    if (state.history.length >= this.config.circuitBreakerThreshold) {
      state.circuitBroken = true;
      return {
        shouldRestart: false,
        delayMs: 0,
        reason: `Circuit breaker tripped: ${state.history.length} failures within ${this.formatDuration(this.config.circuitBreakerWindowMs)}`,
      };
    }

    // Calculate exponential backoff delay
    const delayMs = this.calculateBackoff(state.restartCount);

    return {
      shouldRestart: true,
      delayMs,
      reason: `Restart attempt ${state.restartCount + 1} with ${this.formatDuration(delayMs)} delay`,
    };
  }

  /**
   * Record a restart attempt
   *
   * @param pluginName - Name of the plugin
   */
  recordRestart(pluginName: string): void {
    const state = this.getOrCreateState(pluginName);
    const now = Date.now();

    state.restartCount++;
    state.history.push({
      timestamp: now,
      backoffMs: this.calculateBackoff(state.restartCount - 1),
    });
  }

  /**
   * Record that a plugin has become stable (running successfully)
   *
   * @param pluginName - Name of the plugin
   */
  recordStable(pluginName: string): void {
    const state = this.getOrCreateState(pluginName);
    const now = Date.now();

    // Check if plugin has been stable long enough to reset
    if (!state.lastStableAt) {
      state.lastStableAt = now;
      return;
    }

    const stableDuration = now - state.lastStableAt;
    if (stableDuration >= this.config.stableThresholdMs) {
      // Reset restart count and history
      state.restartCount = 0;
      state.history = [];
      state.circuitBroken = false;
    }
  }

  /**
   * Reset the state for a plugin
   *
   * @param pluginName - Name of the plugin
   */
  reset(pluginName: string): void {
    this.states.delete(pluginName);
  }

  /**
   * Reset the circuit breaker for a plugin (manual override)
   *
   * @param pluginName - Name of the plugin
   */
  resetCircuitBreaker(pluginName: string): void {
    const state = this.states.get(pluginName);
    if (state) {
      state.circuitBroken = false;
      state.history = [];
      state.restartCount = 0;
    }
  }

  /**
   * Check if circuit breaker is tripped for a plugin
   *
   * @param pluginName - Name of the plugin
   * @returns true if circuit breaker is tripped
   */
  isCircuitBroken(pluginName: string): boolean {
    return this.states.get(pluginName)?.circuitBroken ?? false;
  }

  /**
   * Get current restart count for a plugin
   *
   * @param pluginName - Name of the plugin
   * @returns Number of restart attempts
   */
  getRestartCount(pluginName: string): number {
    return this.states.get(pluginName)?.restartCount ?? 0;
  }

  /**
   * Get the current configuration
   */
  getConfig(): RestartPolicyConfig {
    return { ...this.config };
  }

  /**
   * Calculate backoff delay for a given restart count
   */
  private calculateBackoff(restartCount: number): number {
    if (restartCount === 0) {
      return this.config.initialBackoffMs;
    }

    const delay = this.config.initialBackoffMs *
      Math.pow(this.config.backoffMultiplier, restartCount);

    return Math.min(delay, this.config.maxBackoffMs);
  }

  /**
   * Get or create state for a plugin
   */
  private getOrCreateState(pluginName: string): PluginRestartState {
    let state = this.states.get(pluginName);
    if (!state) {
      state = {
        restartCount: 0,
        history: [],
        circuitBroken: false,
      };
      this.states.set(pluginName, state);
    }
    return state;
  }

  /**
   * Clean old entries from restart history
   */
  private cleanHistory(state: PluginRestartState, now: number): void {
    const cutoff = now - this.config.circuitBreakerWindowMs;
    state.history = state.history.filter(entry => entry.timestamp > cutoff);
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    if (ms < 60000) {
      return `${(ms / 1000).toFixed(1)}s`;
    }
    return `${(ms / 60000).toFixed(1)}m`;
  }
}

/**
 * Calculate backoff delay for a given restart count
 *
 * @param restartCount - Number of previous restart attempts
 * @param config - Restart policy configuration
 * @returns Backoff delay in milliseconds
 */
export function calculateBackoffDelay(
  restartCount: number,
  config: Partial<RestartPolicyConfig> = {}
): number {
  const fullConfig = { ...DEFAULT_RESTART_POLICY, ...config };

  if (restartCount === 0) {
    return fullConfig.initialBackoffMs;
  }

  const delay = fullConfig.initialBackoffMs *
    Math.pow(fullConfig.backoffMultiplier, restartCount);

  return Math.min(delay, fullConfig.maxBackoffMs);
}
