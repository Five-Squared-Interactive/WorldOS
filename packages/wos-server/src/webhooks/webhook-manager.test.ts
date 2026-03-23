/**
 * Webhook Manager Tests
 *
 * Story 6.4: Webhook Notifications
 *
 * HTTP webhook notifications for health events.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebhookManager, WebhookConfig, WebhookEvent } from './webhook-manager.js';

describe('WebhookManager', () => {
  let manager: WebhookManager;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    manager = new WebhookManager({ fetch: mockFetch as any });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('registerWebhook', () => {
    it('should register a webhook', () => {
      const config: WebhookConfig = {
        url: 'https://example.com/webhook',
        events: ['plugin.crashed'],
      };

      manager.registerWebhook(config);

      expect(manager.getWebhooks()).toHaveLength(1);
      expect(manager.getWebhooks()[0].url).toBe('https://example.com/webhook');
    });

    it('should register multiple webhooks', () => {
      manager.registerWebhook({
        url: 'https://example.com/hook1',
        events: ['plugin.crashed'],
      });
      manager.registerWebhook({
        url: 'https://example.com/hook2',
        events: ['plugin.unhealthy'],
      });

      expect(manager.getWebhooks()).toHaveLength(2);
    });
  });

  describe('sendEvent', () => {
    it('should send event to matching webhook', async () => {
      manager.registerWebhook({
        url: 'https://example.com/webhook',
        events: ['plugin.crashed'],
      });

      const event: WebhookEvent = {
        type: 'plugin.crashed',
        timestamp: Date.now(),
        data: { pluginName: 'test-plugin', error: 'Process exited' },
      };

      await manager.sendEvent(event);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should include event data in payload', async () => {
      manager.registerWebhook({
        url: 'https://example.com/webhook',
        events: ['plugin.crashed'],
      });

      const event: WebhookEvent = {
        type: 'plugin.crashed',
        timestamp: 1234567890,
        data: { pluginName: 'test-plugin' },
      };

      await manager.sendEvent(event);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.type).toBe('plugin.crashed');
      expect(body.timestamp).toBe(1234567890);
      expect(body.data.pluginName).toBe('test-plugin');
    });

    it('should not send to non-matching webhooks', async () => {
      manager.registerWebhook({
        url: 'https://example.com/webhook',
        events: ['plugin.crashed'],
      });

      const event: WebhookEvent = {
        type: 'plugin.unhealthy',
        timestamp: Date.now(),
        data: {},
      };

      await manager.sendEvent(event);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should send to multiple matching webhooks', async () => {
      manager.registerWebhook({
        url: 'https://example.com/hook1',
        events: ['plugin.crashed'],
      });
      manager.registerWebhook({
        url: 'https://example.com/hook2',
        events: ['plugin.crashed', 'plugin.unhealthy'],
      });

      const event: WebhookEvent = {
        type: 'plugin.crashed',
        timestamp: Date.now(),
        data: {},
      };

      await manager.sendEvent(event);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should support wildcard event matching', async () => {
      manager.registerWebhook({
        url: 'https://example.com/webhook',
        events: ['*'],
      });

      const event: WebhookEvent = {
        type: 'plugin.crashed',
        timestamp: Date.now(),
        data: {},
      };

      await manager.sendEvent(event);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('signature', () => {
    it('should include signature header when secret is configured', async () => {
      manager.registerWebhook({
        url: 'https://example.com/webhook',
        events: ['plugin.crashed'],
        secret: 'my-secret-key',
      });

      const event: WebhookEvent = {
        type: 'plugin.crashed',
        timestamp: Date.now(),
        data: {},
      };

      await manager.sendEvent(event);

      expect(mockFetch.mock.calls[0][1].headers).toHaveProperty('X-WOS-Signature');
    });

    it('should generate HMAC-SHA256 signature', async () => {
      manager.registerWebhook({
        url: 'https://example.com/webhook',
        events: ['plugin.crashed'],
        secret: 'test-secret',
      });

      const event: WebhookEvent = {
        type: 'plugin.crashed',
        timestamp: Date.now(),
        data: {},
      };

      await manager.sendEvent(event);

      const signature = mockFetch.mock.calls[0][1].headers['X-WOS-Signature'];
      expect(signature).toMatch(/^sha256=/);
    });

    it('should not include signature when no secret', async () => {
      manager.registerWebhook({
        url: 'https://example.com/webhook',
        events: ['plugin.crashed'],
      });

      const event: WebhookEvent = {
        type: 'plugin.crashed',
        timestamp: Date.now(),
        data: {},
      };

      await manager.sendEvent(event);

      expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('X-WOS-Signature');
    });
  });

  describe('retry', () => {
    it('should retry on failure', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockResolvedValueOnce({ ok: true, status: 200 });

      manager.registerWebhook({
        url: 'https://example.com/webhook',
        events: ['plugin.crashed'],
      });

      const event: WebhookEvent = {
        type: 'plugin.crashed',
        timestamp: Date.now(),
        data: {},
      };

      await manager.sendEvent(event);

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should stop after max retries', async () => {
      mockFetch.mockRejectedValue(new Error('Connection failed'));

      manager.registerWebhook({
        url: 'https://example.com/webhook',
        events: ['plugin.crashed'],
      });

      const event: WebhookEvent = {
        type: 'plugin.crashed',
        timestamp: Date.now(),
        data: {},
      };

      // Should not throw, just log warning
      await expect(manager.sendEvent(event)).resolves.not.toThrow();

      // 3 attempts (initial + 2 retries)
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should retry on non-2xx response', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      manager.registerWebhook({
        url: 'https://example.com/webhook',
        events: ['plugin.crashed'],
      });

      const event: WebhookEvent = {
        type: 'plugin.crashed',
        timestamp: Date.now(),
        data: {},
      };

      await manager.sendEvent(event);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('loadFromConfig', () => {
    it('should load webhooks from config object', () => {
      const config = {
        webhooks: [
          {
            url: 'https://example.com/hook1',
            events: ['plugin.crashed'],
          },
          {
            url: 'https://example.com/hook2',
            events: ['plugin.unhealthy'],
            secret: 'secret-key',
          },
        ],
      };

      manager.loadFromConfig(config);

      expect(manager.getWebhooks()).toHaveLength(2);
    });

    it('should handle empty webhooks config', () => {
      manager.loadFromConfig({});

      expect(manager.getWebhooks()).toHaveLength(0);
    });
  });

  describe('event types', () => {
    it('should handle plugin.crashed event', async () => {
      manager.registerWebhook({
        url: 'https://example.com/webhook',
        events: ['plugin.crashed'],
      });

      await manager.sendEvent({
        type: 'plugin.crashed',
        timestamp: Date.now(),
        data: {
          pluginName: 'test-plugin',
          exitCode: 1,
          error: 'Process crashed',
        },
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle plugin.unhealthy event', async () => {
      manager.registerWebhook({
        url: 'https://example.com/webhook',
        events: ['plugin.unhealthy'],
      });

      await manager.sendEvent({
        type: 'plugin.unhealthy',
        timestamp: Date.now(),
        data: {
          pluginName: 'test-plugin',
          healthStatus: 'unhealthy',
          details: { error: 'Connection timeout' },
        },
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle plugin.recovered event', async () => {
      manager.registerWebhook({
        url: 'https://example.com/webhook',
        events: ['plugin.recovered'],
      });

      await manager.sendEvent({
        type: 'plugin.recovered',
        timestamp: Date.now(),
        data: {
          pluginName: 'test-plugin',
          healthStatus: 'ok',
        },
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle server.started event', async () => {
      manager.registerWebhook({
        url: 'https://example.com/webhook',
        events: ['server.started'],
      });

      await manager.sendEvent({
        type: 'server.started',
        timestamp: Date.now(),
        data: {
          version: '1.0.0',
          plugins: ['plugin-a', 'plugin-b'],
        },
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('testWebhook', () => {
    it('should send test event to webhook', async () => {
      manager.registerWebhook({
        url: 'https://example.com/webhook',
        events: ['plugin.crashed'],
      });

      const result = await manager.testWebhook('https://example.com/webhook');

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.type).toBe('test');
    });

    it('should return failure for non-existent webhook', async () => {
      const result = await manager.testWebhook('https://unknown.com/webhook');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    it('should return failure on connection error', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      manager.registerWebhook({
        url: 'https://example.com/webhook',
        events: ['plugin.crashed'],
      });

      const result = await manager.testWebhook('https://example.com/webhook');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');
    });
  });
});
