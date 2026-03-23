/**
 * Webhook Manager
 *
 * Story 6.4: Webhook Notifications
 *
 * Manages HTTP webhook notifications for health events.
 * Supports event filtering, HMAC signatures, and retry with backoff.
 */

import * as crypto from 'crypto';

/**
 * Webhook configuration
 */
export interface WebhookConfig {
  url: string;
  events: string[];
  secret?: string;
}

/**
 * Webhook event structure
 */
export interface WebhookEvent {
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
}

/**
 * Webhook test result
 */
export interface WebhookTestResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

/**
 * Webhook manager options
 */
export interface WebhookManagerOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  fetch?: typeof fetch;
}

/**
 * Manages webhook notifications
 */
export class WebhookManager {
  private webhooks: WebhookConfig[] = [];
  private maxRetries: number;
  private retryDelayMs: number;
  private fetchFn: typeof fetch;

  constructor(options: WebhookManagerOptions = {}) {
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    this.fetchFn = options.fetch ?? globalThis.fetch;
  }

  /**
   * Register a webhook
   */
  registerWebhook(config: WebhookConfig): void {
    this.webhooks.push(config);
  }

  /**
   * Get all registered webhooks
   */
  getWebhooks(): WebhookConfig[] {
    return [...this.webhooks];
  }

  /**
   * Load webhooks from config object
   */
  loadFromConfig(config: Record<string, unknown>): void {
    const webhooks = config.webhooks as WebhookConfig[] | undefined;
    if (webhooks && Array.isArray(webhooks)) {
      for (const webhook of webhooks) {
        this.registerWebhook(webhook);
      }
    }
  }

  /**
   * Send an event to all matching webhooks
   */
  async sendEvent(event: WebhookEvent): Promise<void> {
    const matchingWebhooks = this.webhooks.filter(webhook =>
      this.matchesEvent(webhook, event.type)
    );

    // Send to all matching webhooks in parallel
    await Promise.all(
      matchingWebhooks.map(webhook => this.sendToWebhook(webhook, event))
    );
  }

  /**
   * Test a webhook by sending a test event
   */
  async testWebhook(url: string): Promise<WebhookTestResult> {
    const webhook = this.webhooks.find(w => w.url === url);
    if (!webhook) {
      return { success: false, error: 'Webhook not found' };
    }

    const testEvent: WebhookEvent = {
      type: 'test',
      timestamp: Date.now(),
      data: { message: 'This is a test event from WorldOS' },
    };

    try {
      const response = await this.sendToWebhookOnce(webhook, testEvent);
      return {
        success: response.ok,
        statusCode: response.status,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check if webhook matches event type
   */
  private matchesEvent(webhook: WebhookConfig, eventType: string): boolean {
    return webhook.events.some(pattern => {
      if (pattern === '*') return true;
      if (pattern === eventType) return true;
      // Support prefix matching (e.g., 'plugin.*' matches 'plugin.crashed')
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        return eventType.startsWith(prefix);
      }
      return false;
    });
  }

  /**
   * Send event to a webhook with retry
   */
  private async sendToWebhook(
    webhook: WebhookConfig,
    event: WebhookEvent
  ): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.sendToWebhookOnce(webhook, event);
        if (response.ok) {
          return;
        }
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
      }

      // Wait before retry (exponential backoff)
      if (attempt < this.maxRetries - 1) {
        await this.sleep(this.retryDelayMs * Math.pow(2, attempt));
      }
    }

    // Log warning but don't throw
    console.warn(
      `Failed to send webhook to ${webhook.url} after ${this.maxRetries} attempts:`,
      lastError?.message
    );
  }

  /**
   * Send event to webhook once (no retry)
   */
  private async sendToWebhookOnce(
    webhook: WebhookConfig,
    event: WebhookEvent
  ): Promise<Response> {
    const payload = JSON.stringify(event);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add signature if secret is configured
    if (webhook.secret) {
      headers['X-WOS-Signature'] = this.generateSignature(payload, webhook.secret);
    }

    return this.fetchFn(webhook.url, {
      method: 'POST',
      headers,
      body: payload,
    });
  }

  /**
   * Generate HMAC-SHA256 signature
   */
  private generateSignature(payload: string, secret: string): string {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    return `sha256=${hmac.digest('hex')}`;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
