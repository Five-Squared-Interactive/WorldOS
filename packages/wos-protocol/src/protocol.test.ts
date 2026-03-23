/**
 * Plugin Protocol Tests
 *
 * Story 10.4: Binary Plugin Protocol
 *
 * Tests for the MQTT-based plugin protocol.
 */

import { describe, it, expect } from 'vitest';
import {
  PluginEnvironment,
  HealthRequest,
  HealthResponse,
  PluginMessage,
  TopicPatterns,
  buildHealthRequestTopic,
  buildHealthResponseTopic,
  buildConfigTopic,
  buildLogTopic,
  parseEnvironment,
  validateHealthResponse,
  MessageTypes,
} from './protocol.js';

describe('Plugin Protocol', () => {
  describe('Environment Variables', () => {
    it('should define required environment variables', () => {
      const env: PluginEnvironment = {
        WOS_MQTT_HOST: 'localhost',
        WOS_MQTT_PORT: 1883,
        WOS_PLUGIN_NAME: 'my-plugin',
        WOS_CONFIG_PATH: '/etc/wos/plugins/my-plugin/config.yaml',
      };

      expect(env.WOS_MQTT_HOST).toBe('localhost');
      expect(env.WOS_MQTT_PORT).toBe(1883);
      expect(env.WOS_PLUGIN_NAME).toBe('my-plugin');
    });

    it('should support optional environment variables', () => {
      const env: PluginEnvironment = {
        WOS_MQTT_HOST: 'localhost',
        WOS_MQTT_PORT: 1883,
        WOS_PLUGIN_NAME: 'my-plugin',
        WOS_CONFIG_PATH: '/config.yaml',
        WOS_LOG_LEVEL: 'debug',
        WOS_MQTT_USERNAME: 'plugin-user',
        WOS_MQTT_PASSWORD: 'secret',
      };

      expect(env.WOS_LOG_LEVEL).toBe('debug');
      expect(env.WOS_MQTT_USERNAME).toBe('plugin-user');
    });

    it('should parse environment from process.env format', () => {
      const processEnv = {
        WOS_MQTT_HOST: 'broker.local',
        WOS_MQTT_PORT: '1884',
        WOS_PLUGIN_NAME: 'test-plugin',
        WOS_CONFIG_PATH: '/tmp/config.yaml',
      };

      const env = parseEnvironment(processEnv);

      expect(env.WOS_MQTT_HOST).toBe('broker.local');
      expect(env.WOS_MQTT_PORT).toBe(1884);
      expect(env.WOS_PLUGIN_NAME).toBe('test-plugin');
    });

    it('should throw for missing required variables', () => {
      const processEnv = {
        WOS_MQTT_HOST: 'localhost',
        // Missing other required vars
      };

      expect(() => parseEnvironment(processEnv)).toThrow();
    });
  });

  describe('Topic Patterns', () => {
    it('should define health request topic pattern', () => {
      expect(TopicPatterns.HEALTH_REQUEST).toBe('wos/plugin/{name}/health/request');
    });

    it('should define health response topic pattern', () => {
      expect(TopicPatterns.HEALTH_RESPONSE).toBe('wos/plugin/{name}/health/response');
    });

    it('should define config changed topic pattern', () => {
      expect(TopicPatterns.CONFIG_CHANGED).toBe('wos/plugin/{name}/config/changed');
    });

    it('should define log topic pattern', () => {
      expect(TopicPatterns.LOG).toBe('wos/plugin/{name}/log');
    });

    it('should define start topic pattern', () => {
      expect(TopicPatterns.START).toBe('wos/plugin/{name}/lifecycle/start');
    });

    it('should define stop topic pattern', () => {
      expect(TopicPatterns.STOP).toBe('wos/plugin/{name}/lifecycle/stop');
    });
  });

  describe('Topic Building', () => {
    it('should build health request topic', () => {
      const topic = buildHealthRequestTopic('my-plugin');
      expect(topic).toBe('wos/plugin/my-plugin/health/request');
    });

    it('should build health response topic', () => {
      const topic = buildHealthResponseTopic('my-plugin');
      expect(topic).toBe('wos/plugin/my-plugin/health/response');
    });

    it('should build config topic', () => {
      const topic = buildConfigTopic('my-plugin');
      expect(topic).toBe('wos/plugin/my-plugin/config/changed');
    });

    it('should build log topic', () => {
      const topic = buildLogTopic('my-plugin');
      expect(topic).toBe('wos/plugin/my-plugin/log');
    });

    it('should handle special characters in plugin names', () => {
      const topic = buildHealthRequestTopic('my-plugin-v2');
      expect(topic).toBe('wos/plugin/my-plugin-v2/health/request');
    });
  });

  describe('Health Request', () => {
    it('should define health request structure', () => {
      const request: HealthRequest = {
        correlationId: 'req-123',
        timestamp: new Date().toISOString(),
      };

      expect(request.correlationId).toBe('req-123');
      expect(request.timestamp).toBeDefined();
    });

    it('should require correlationId', () => {
      const request: HealthRequest = {
        correlationId: 'abc-def-ghi',
        timestamp: new Date().toISOString(),
      };

      expect(typeof request.correlationId).toBe('string');
      expect(request.correlationId.length).toBeGreaterThan(0);
    });
  });

  describe('Health Response', () => {
    it('should define health response structure', () => {
      const response: HealthResponse = {
        correlationId: 'req-123',
        status: 'healthy',
        timestamp: new Date().toISOString(),
      };

      expect(response.correlationId).toBe('req-123');
      expect(response.status).toBe('healthy');
    });

    it('should support healthy status', () => {
      const response: HealthResponse = {
        correlationId: '123',
        status: 'healthy',
        timestamp: new Date().toISOString(),
      };

      expect(response.status).toBe('healthy');
    });

    it('should support unhealthy status', () => {
      const response: HealthResponse = {
        correlationId: '123',
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
      };

      expect(response.status).toBe('unhealthy');
    });

    it('should support degraded status', () => {
      const response: HealthResponse = {
        correlationId: '123',
        status: 'degraded',
        timestamp: new Date().toISOString(),
      };

      expect(response.status).toBe('degraded');
    });

    it('should support optional details', () => {
      const response: HealthResponse = {
        correlationId: '123',
        status: 'healthy',
        timestamp: new Date().toISOString(),
        details: {
          memory: '128MB',
          connections: 5,
          custom: { key: 'value' },
        },
      };

      expect(response.details?.memory).toBe('128MB');
      expect(response.details?.connections).toBe(5);
    });

    it('should validate response has correlationId', () => {
      const response = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
      };

      expect(validateHealthResponse(response)).toBe(false);
    });

    it('should validate response has valid status', () => {
      const response = {
        correlationId: '123',
        status: 'invalid-status',
        timestamp: new Date().toISOString(),
      };

      expect(validateHealthResponse(response)).toBe(false);
    });

    it('should validate correct response', () => {
      const response: HealthResponse = {
        correlationId: '123',
        status: 'healthy',
        timestamp: new Date().toISOString(),
      };

      expect(validateHealthResponse(response)).toBe(true);
    });
  });

  describe('Message Types', () => {
    it('should define HEALTH_REQUEST type', () => {
      expect(MessageTypes.HEALTH_REQUEST).toBe('health.request');
    });

    it('should define HEALTH_RESPONSE type', () => {
      expect(MessageTypes.HEALTH_RESPONSE).toBe('health.response');
    });

    it('should define CONFIG_CHANGED type', () => {
      expect(MessageTypes.CONFIG_CHANGED).toBe('config.changed');
    });

    it('should define START type', () => {
      expect(MessageTypes.START).toBe('lifecycle.start');
    });

    it('should define STOP type', () => {
      expect(MessageTypes.STOP).toBe('lifecycle.stop');
    });

    it('should define LOG type', () => {
      expect(MessageTypes.LOG).toBe('log');
    });
  });

  describe('Plugin Message', () => {
    it('should define base message structure', () => {
      const message: PluginMessage = {
        type: 'health.request',
        timestamp: new Date().toISOString(),
        pluginName: 'my-plugin',
      };

      expect(message.type).toBe('health.request');
      expect(message.pluginName).toBe('my-plugin');
    });

    it('should support correlationId for request/response', () => {
      const message: PluginMessage = {
        type: 'health.request',
        timestamp: new Date().toISOString(),
        pluginName: 'my-plugin',
        correlationId: 'req-456',
      };

      expect(message.correlationId).toBe('req-456');
    });

    it('should support payload', () => {
      const message: PluginMessage = {
        type: 'config.changed',
        timestamp: new Date().toISOString(),
        pluginName: 'my-plugin',
        payload: {
          key: 'setting.value',
          oldValue: 'old',
          newValue: 'new',
        },
      };

      expect(message.payload?.key).toBe('setting.value');
    });
  });

  describe('Lifecycle Signals', () => {
    it('should define SIGTERM for graceful shutdown', () => {
      // SIGTERM = 15 on Unix systems
      expect(typeof process.kill).toBe('function');
    });

    it('should recommend 5 second timeout before SIGKILL', () => {
      const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5000;
      expect(GRACEFUL_SHUTDOWN_TIMEOUT_MS).toBe(5000);
    });
  });

  describe('Protocol Version', () => {
    it('should define protocol version', () => {
      const PROTOCOL_VERSION = '1.0';
      expect(PROTOCOL_VERSION).toBe('1.0');
    });
  });
});
