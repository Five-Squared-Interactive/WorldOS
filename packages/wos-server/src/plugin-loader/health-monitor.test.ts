/**
 * Health Monitor Tests
 *
 * Stories 1.3, 1.4, 1.8: MQTT Health Checks
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import {
  HealthMonitor,
  MqttClient,
  buildHealthRequestTopic,
  buildHealthResponseTopic,
  validateHealthResponse,
  createHealthRequest,
  createHealthResponse,
  HealthTopics,
} from './health-monitor.js';

// Mock MQTT client
class MockMqttClient extends EventEmitter implements MqttClient {
  connected = true;
  publishedMessages: Array<{ topic: string; message: string }> = [];
  subscribedTopics: string[] = [];
  unsubscribedTopics: string[] = [];

  async publish(topic: string, message: string): Promise<void> {
    this.publishedMessages.push({ topic, message });
  }

  async subscribe(topic: string): Promise<void> {
    this.subscribedTopics.push(topic);
  }

  async unsubscribe(topic: string): Promise<void> {
    this.unsubscribedTopics.push(topic);
  }

  // Simulate receiving a message
  simulateMessage(topic: string, message: string): void {
    this.emit('message', topic, Buffer.from(message));
  }
}

// Mock child process
function createMockProcess(): any {
  const mockProcess = new EventEmitter() as any;
  mockProcess.pid = 12345;
  mockProcess.kill = vi.fn();
  return mockProcess;
}

describe('HealthMonitor', () => {
  let monitor: HealthMonitor;
  let mqttClient: MockMqttClient;

  beforeEach(() => {
    vi.useFakeTimers();
    monitor = new HealthMonitor({
      intervalMs: 1000,
      timeoutMs: 500,
      failureThreshold: 3,
      gracefulShutdownMs: 1000,
    });
    mqttClient = new MockMqttClient();
    monitor.setMqttClient(mqttClient);
  });

  afterEach(async () => {
    await monitor.stopAll();
    vi.useRealTimers();
  });

  describe('startMonitoring', () => {
    it('should subscribe to health response topic', async () => {
      const process = createMockProcess();

      await monitor.startMonitoring('test-plugin', process);

      expect(mqttClient.subscribedTopics).toContain('wos/plugin/test-plugin/health/response');
    });

    it('should send initial health check', async () => {
      const process = createMockProcess();

      await monitor.startMonitoring('test-plugin', process);

      expect(mqttClient.publishedMessages).toHaveLength(1);
      expect(mqttClient.publishedMessages[0].topic).toBe('wos/plugin/test-plugin/health/request');
    });

    it('should send periodic health checks', async () => {
      const process = createMockProcess();

      await monitor.startMonitoring('test-plugin', process);

      // Clear initial health check
      mqttClient.publishedMessages = [];

      // Advance timer by interval
      vi.advanceTimersByTime(1000);

      expect(mqttClient.publishedMessages).toHaveLength(1);

      // Advance again
      vi.advanceTimersByTime(1000);

      expect(mqttClient.publishedMessages).toHaveLength(2);
    });
  });

  describe('stopMonitoring', () => {
    it('should unsubscribe from health response topic', async () => {
      const process = createMockProcess();

      await monitor.startMonitoring('test-plugin', process);
      await monitor.stopMonitoring('test-plugin');

      expect(mqttClient.unsubscribedTopics).toContain('wos/plugin/test-plugin/health/response');
    });

    it('should stop periodic health checks', async () => {
      const process = createMockProcess();

      await monitor.startMonitoring('test-plugin', process);
      await monitor.stopMonitoring('test-plugin');

      mqttClient.publishedMessages = [];

      // Advance timer
      vi.advanceTimersByTime(2000);

      expect(mqttClient.publishedMessages).toHaveLength(0);
    });
  });

  describe('health response handling', () => {
    it('should emit health:ok for healthy response', async () => {
      const process = createMockProcess();
      const healthOkHandler = vi.fn();
      monitor.on('health:ok', healthOkHandler);

      await monitor.startMonitoring('test-plugin', process);

      // Get the correlation ID from the sent request
      const request = JSON.parse(mqttClient.publishedMessages[0].message);

      // Simulate response
      const response = createHealthResponse(request.correlationId, 'healthy', { memory: '100MB' });
      mqttClient.simulateMessage(
        'wos/plugin/test-plugin/health/response',
        JSON.stringify(response)
      );

      expect(healthOkHandler).toHaveBeenCalledWith('test-plugin', { memory: '100MB' });
    });

    it('should emit health:degraded for degraded response', async () => {
      const process = createMockProcess();
      const degradedHandler = vi.fn();
      monitor.on('health:degraded', degradedHandler);

      await monitor.startMonitoring('test-plugin', process);

      const request = JSON.parse(mqttClient.publishedMessages[0].message);

      const response = createHealthResponse(request.correlationId, 'degraded');
      mqttClient.simulateMessage(
        'wos/plugin/test-plugin/health/response',
        JSON.stringify(response)
      );

      expect(degradedHandler).toHaveBeenCalledWith('test-plugin', undefined);
    });

    it('should emit health:unhealthy for unhealthy response', async () => {
      const process = createMockProcess();
      const unhealthyHandler = vi.fn();
      monitor.on('health:unhealthy', unhealthyHandler);

      await monitor.startMonitoring('test-plugin', process);

      const request = JSON.parse(mqttClient.publishedMessages[0].message);

      const response = createHealthResponse(request.correlationId, 'unhealthy');
      mqttClient.simulateMessage(
        'wos/plugin/test-plugin/health/response',
        JSON.stringify(response)
      );

      expect(unhealthyHandler).toHaveBeenCalledWith('test-plugin', 1);
    });

    it('should ignore responses with wrong correlation ID', async () => {
      const process = createMockProcess();
      const healthOkHandler = vi.fn();
      monitor.on('health:ok', healthOkHandler);

      await monitor.startMonitoring('test-plugin', process);

      // Send response with wrong correlation ID
      const response = createHealthResponse('wrong-id', 'healthy');
      mqttClient.simulateMessage(
        'wos/plugin/test-plugin/health/response',
        JSON.stringify(response)
      );

      expect(healthOkHandler).not.toHaveBeenCalled();
    });
  });

  describe('health timeout', () => {
    it('should emit health:timeout on timeout', async () => {
      const process = createMockProcess();
      const timeoutHandler = vi.fn();
      monitor.on('health:timeout', timeoutHandler);

      await monitor.startMonitoring('test-plugin', process);

      // Advance past timeout
      vi.advanceTimersByTime(600);

      expect(timeoutHandler).toHaveBeenCalledWith('test-plugin', 1);
    });

    it('should increment consecutive failures on timeout', async () => {
      const process = createMockProcess();
      const unhealthyHandler = vi.fn();
      monitor.on('health:unhealthy', unhealthyHandler);

      await monitor.startMonitoring('test-plugin', process);

      // First timeout
      vi.advanceTimersByTime(600);
      expect(unhealthyHandler).toHaveBeenCalledWith('test-plugin', 1);

      // Trigger next health check
      vi.advanceTimersByTime(500);

      // Second timeout
      vi.advanceTimersByTime(600);
      expect(unhealthyHandler).toHaveBeenCalledWith('test-plugin', 2);
    });
  });

  describe('health threshold', () => {
    it('should emit health:threshold after consecutive failures', async () => {
      const process = createMockProcess();
      const thresholdHandler = vi.fn();
      monitor.on('health:threshold', thresholdHandler);

      await monitor.startMonitoring('test-plugin', process);

      // Simulate 3 timeouts (threshold)
      for (let i = 0; i < 3; i++) {
        vi.advanceTimersByTime(600); // timeout
        vi.advanceTimersByTime(500); // wait for next check
      }

      expect(thresholdHandler).toHaveBeenCalledWith('test-plugin', 3);
    });

    it('should reset failures on healthy response', async () => {
      const process = createMockProcess();
      const thresholdHandler = vi.fn();
      const unhealthyHandler = vi.fn();
      monitor.on('health:threshold', thresholdHandler);
      monitor.on('health:unhealthy', unhealthyHandler);

      await monitor.startMonitoring('test-plugin', process);

      // First timeout (failure 1)
      vi.advanceTimersByTime(600);
      expect(unhealthyHandler).toHaveBeenCalledWith('test-plugin', 1);

      // Wait for next health check
      vi.advanceTimersByTime(500);

      // Get latest request (second health check)
      const lastRequest = JSON.parse(
        mqttClient.publishedMessages[mqttClient.publishedMessages.length - 1].message
      );

      // Healthy response resets counter
      const response = createHealthResponse(lastRequest.correlationId, 'healthy');
      mqttClient.simulateMessage(
        'wos/plugin/test-plugin/health/response',
        JSON.stringify(response)
      );

      // Verify failures were reset
      const state = monitor.getHealthState('test-plugin');
      expect(state?.consecutiveFailures).toBe(0);
    });
  });

  describe('getHealthState', () => {
    it('should return undefined for unknown plugin', () => {
      expect(monitor.getHealthState('unknown')).toBeUndefined();
    });

    it('should return health state for monitored plugin', async () => {
      const process = createMockProcess();
      await monitor.startMonitoring('test-plugin', process);

      const state = monitor.getHealthState('test-plugin');

      expect(state).toBeDefined();
      expect(state?.consecutiveFailures).toBe(0);
    });

    it('should reflect failure count', async () => {
      const process = createMockProcess();
      await monitor.startMonitoring('test-plugin', process);

      vi.advanceTimersByTime(600); // timeout

      const state = monitor.getHealthState('test-plugin');
      expect(state?.consecutiveFailures).toBe(1);
      expect(state?.lastStatus).toBe('unhealthy');
    });
  });
});

describe('Topic builders', () => {
  describe('buildHealthRequestTopic', () => {
    it('should build correct topic', () => {
      expect(buildHealthRequestTopic('my-plugin')).toBe('wos/plugin/my-plugin/health/request');
    });
  });

  describe('buildHealthResponseTopic', () => {
    it('should build correct topic', () => {
      expect(buildHealthResponseTopic('my-plugin')).toBe('wos/plugin/my-plugin/health/response');
    });
  });
});

describe('validateHealthResponse', () => {
  it('should return true for valid response', () => {
    const response = {
      correlationId: 'test-123',
      status: 'healthy',
      timestamp: new Date().toISOString(),
    };

    expect(validateHealthResponse(response)).toBe(true);
  });

  it('should return true for all valid statuses', () => {
    const statuses = ['healthy', 'unhealthy', 'degraded', 'ok'];

    for (const status of statuses) {
      expect(validateHealthResponse({
        correlationId: 'test',
        status,
        timestamp: '',
      })).toBe(true);
    }
  });

  it('should return false for missing correlationId', () => {
    expect(validateHealthResponse({
      status: 'healthy',
      timestamp: '',
    })).toBe(false);
  });

  it('should return false for empty correlationId', () => {
    expect(validateHealthResponse({
      correlationId: '',
      status: 'healthy',
      timestamp: '',
    })).toBe(false);
  });

  it('should return false for invalid status', () => {
    expect(validateHealthResponse({
      correlationId: 'test',
      status: 'invalid',
      timestamp: '',
    })).toBe(false);
  });

  it('should return false for non-object', () => {
    expect(validateHealthResponse(null)).toBe(false);
    expect(validateHealthResponse(undefined)).toBe(false);
    expect(validateHealthResponse('string')).toBe(false);
    expect(validateHealthResponse(123)).toBe(false);
  });
});

describe('createHealthRequest', () => {
  it('should create request with correlation ID', () => {
    const request = createHealthRequest();

    expect(request.correlationId).toBeDefined();
    expect(request.correlationId.length).toBeGreaterThan(0);
  });

  it('should create request with timestamp', () => {
    const request = createHealthRequest();

    expect(request.timestamp).toBeDefined();
    expect(new Date(request.timestamp).getTime()).not.toBeNaN();
  });

  it('should create unique correlation IDs', () => {
    const request1 = createHealthRequest();
    const request2 = createHealthRequest();

    expect(request1.correlationId).not.toBe(request2.correlationId);
  });
});

describe('createHealthResponse', () => {
  it('should create response with correct fields', () => {
    const response = createHealthResponse('test-123', 'healthy', { memory: '100MB' });

    expect(response.correlationId).toBe('test-123');
    expect(response.status).toBe('healthy');
    expect(response.details).toEqual({ memory: '100MB' });
    expect(response.timestamp).toBeDefined();
  });

  it('should work without details', () => {
    const response = createHealthResponse('test-123', 'unhealthy');

    expect(response.correlationId).toBe('test-123');
    expect(response.status).toBe('unhealthy');
    expect(response.details).toBeUndefined();
  });
});

describe('HealthTopics', () => {
  it('should have correct topic patterns', () => {
    expect(HealthTopics.REQUEST).toBe('wos/plugin/{name}/health/request');
    expect(HealthTopics.RESPONSE).toBe('wos/plugin/{name}/health/response');
    expect(HealthTopics.CRASHED).toBe('wos/plugin/{name}/event/crashed');
    expect(HealthTopics.RESTARTING).toBe('wos/plugin/{name}/event/restarting');
  });
});
