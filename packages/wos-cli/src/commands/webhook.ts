/**
 * Webhook Command
 *
 * Story 6.4: Webhook Notifications
 *
 * Test and manage webhook configurations.
 */

import { Command, Args, Flags } from '@oclif/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';

/**
 * Available webhook event types
 */
const WEBHOOK_EVENTS = [
  { type: 'plugin.crashed', description: 'Plugin process crashed unexpectedly' },
  { type: 'plugin.unhealthy', description: 'Plugin health check failed' },
  { type: 'plugin.recovered', description: 'Plugin recovered from unhealthy state' },
  { type: 'plugin.started', description: 'Plugin started successfully' },
  { type: 'plugin.stopped', description: 'Plugin stopped' },
  { type: 'server.started', description: 'Server started successfully' },
  { type: 'server.stopped', description: 'Server stopped' },
  { type: 'config.changed', description: 'Plugin configuration changed' },
];

export default class Webhook extends Command {
  static override description = 'Manage webhook notifications';

  static override examples = [
    '<%= config.bin %> webhook list',
    '<%= config.bin %> webhook events',
    '<%= config.bin %> webhook test https://example.com/hook',
    '<%= config.bin %> webhook list --json',
  ];

  static override args = {
    action: Args.string({
      description: 'Action to perform (list, test, events)',
      required: true,
      options: ['list', 'test', 'events'],
    }),
    url: Args.string({
      description: 'Webhook URL (for test action)',
      required: false,
    }),
  };

  static override flags = {
    directory: Flags.string({
      char: 'd',
      description: 'Server directory (default: current directory)',
      default: process.cwd(),
    }),
    json: Flags.boolean({
      description: 'Output in JSON format',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Webhook);
    const serverDir = path.resolve(flags.directory);
    const wosYamlPath = path.join(serverDir, 'wos.yaml');

    // Check if server is initialized (except for 'events' action)
    if (args.action !== 'events') {
      const serverExists = await fs.access(wosYamlPath).then(() => true).catch(() => false);
      if (!serverExists) {
        this.error(`WorldOS not initialized in ${serverDir}. Run 'wos init' first.`, { exit: 1 });
        return;
      }
    }

    switch (args.action) {
      case 'list':
        await this.listWebhooks(wosYamlPath, flags.json);
        break;
      case 'test':
        await this.testWebhook(args.url, flags);
        break;
      case 'events':
        this.listEvents(flags.json);
        break;
      default:
        this.error(`Unknown action: ${args.action}. Use 'list', 'test', or 'events'.`, { exit: 1 });
    }
  }

  /**
   * List configured webhooks
   */
  private async listWebhooks(wosYamlPath: string, json: boolean): Promise<void> {
    const content = await fs.readFile(wosYamlPath, 'utf-8');
    const config = yaml.parse(content) ?? {};
    const webhooks = config.webhooks as Array<{ url: string; events: string[]; secret?: string }> | undefined;

    if (!webhooks || webhooks.length === 0) {
      if (json) {
        this.log('[]');
      } else {
        this.log('No webhooks configured.');
        this.log('');
        this.log('Add webhooks to wos.yaml:');
        this.log('  webhooks:');
        this.log('    - url: https://example.com/webhook');
        this.log('      events: [plugin.crashed, plugin.unhealthy]');
        this.log('      secret: optional-signing-secret');
      }
      return;
    }

    if (json) {
      this.log(JSON.stringify(webhooks, null, 2));
    } else {
      this.log('Configured webhooks:');
      this.log('');

      for (const webhook of webhooks) {
        this.log(`  URL: ${webhook.url}`);
        this.log(`  Events: ${webhook.events.join(', ')}`);
        this.log(`  Secret: ${webhook.secret ? '(configured)' : '(none)'}`);
        this.log('');
      }
    }
  }

  /**
   * Test a webhook
   */
  private async testWebhook(url: string | undefined, flags: { directory: string }): Promise<void> {
    if (!url) {
      this.error('URL is required for test action. Usage: wos webhook test <url>', { exit: 1 });
      return;
    }

    this.log(`Testing webhook: ${url}`);

    try {
      const testEvent = {
        type: 'test',
        timestamp: Date.now(),
        data: {
          message: 'This is a test event from WorldOS',
          source: 'wos webhook test',
        },
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testEvent),
      });

      if (response.ok) {
        this.log(`Success! Response: ${response.status} ${response.statusText}`);
      } else {
        this.log(`Failed! Response: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log(`Error: ${message}`);
    }
  }

  /**
   * List available event types
   */
  private listEvents(json: boolean): void {
    if (json) {
      this.log(JSON.stringify(WEBHOOK_EVENTS, null, 2));
    } else {
      this.log('Available webhook events:');
      this.log('');

      for (const event of WEBHOOK_EVENTS) {
        this.log(`  ${event.type}`);
        this.log(`    ${event.description}`);
        this.log('');
      }

      this.log('Wildcards:');
      this.log('  *          - All events');
      this.log('  plugin.*   - All plugin events');
      this.log('  server.*   - All server events');
    }
  }
}
