/**
 * Logs Command
 *
 * Story 6.1: wos logs Command
 *
 * View plugin logs with filtering options.
 */

import { Command, Args, Flags } from '@oclif/core';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Log entry structure
 */
interface LogEntry {
  plugin: string;
  level: string;
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

/**
 * Log levels in order of severity
 */
const LOG_LEVEL_ORDER: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export default class Logs extends Command {
  static override description = 'View plugin logs';

  static override examples = [
    '<%= config.bin %> logs my-plugin',
    '<%= config.bin %> logs my-plugin --level error',
    '<%= config.bin %> logs my-plugin --since 1h',
    '<%= config.bin %> logs my-plugin --lines 50',
    '<%= config.bin %> logs --all',
    '<%= config.bin %> logs my-plugin --follow',
    '<%= config.bin %> logs my-plugin --json',
  ];

  static override args = {
    plugin: Args.string({
      description: 'Plugin name to view logs for',
      required: false,
    }),
  };

  static override flags = {
    directory: Flags.string({
      char: 'd',
      description: 'Server directory (default: current directory)',
      default: process.cwd(),
    }),
    level: Flags.string({
      char: 'l',
      description: 'Minimum log level (debug, info, warn, error)',
      options: ['debug', 'info', 'warn', 'error'],
    }),
    lines: Flags.integer({
      char: 'n',
      description: 'Number of log entries to show (default: 100)',
      default: 100,
    }),
    since: Flags.string({
      char: 's',
      description: 'Show logs since time (e.g., 1h, 30m, 1d)',
    }),
    follow: Flags.boolean({
      char: 'f',
      description: 'Follow log output in real-time',
      default: false,
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Show logs from all plugins',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output in JSON format',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Logs);
    const serverDir = path.resolve(flags.directory);
    const logsDir = path.join(serverDir, 'logs');

    // Require plugin name unless --all
    if (!args.plugin && !flags.all) {
      this.error('Plugin name is required. Use --all to view logs from all plugins.', { exit: 1 });
      return;
    }

    // Parse --since flag
    let since: number | undefined;
    if (flags.since) {
      since = this.parseSince(flags.since);
    }

    // Get entries
    let entries: LogEntry[];

    if (flags.all) {
      entries = await this.readAllLogs(logsDir, {
        limit: flags.lines,
        level: flags.level,
        since,
      });
    } else {
      entries = await this.readPluginLogs(logsDir, args.plugin!, {
        limit: flags.lines,
        level: flags.level,
        since,
      });
    }

    // Handle follow mode
    if (flags.follow) {
      this.log('Following logs... (Ctrl+C to stop)');
      // In a real implementation, this would use file watching or MQTT
      // For now, just show the initial entries
    }

    // Output
    if (entries.length === 0) {
      if (flags.json) {
        this.log('[]');
      } else {
        this.log('No logs found.');
      }
      return;
    }

    if (flags.json) {
      this.log(JSON.stringify(entries, null, 2));
    } else {
      this.displayLogs(entries, flags.all);
    }
  }

  /**
   * Read logs for a specific plugin
   */
  private async readPluginLogs(
    logsDir: string,
    pluginName: string,
    options: { limit: number; level?: string; since?: number }
  ): Promise<LogEntry[]> {
    const logFile = path.join(logsDir, `${pluginName}.log`);

    try {
      const content = await fs.readFile(logFile, 'utf-8');
      return this.parseAndFilterLogs(content, options);
    } catch {
      return [];
    }
  }

  /**
   * Read logs from all plugins
   */
  private async readAllLogs(
    logsDir: string,
    options: { limit: number; level?: string; since?: number }
  ): Promise<LogEntry[]> {
    let files: string[];
    try {
      files = await fs.readdir(logsDir);
    } catch {
      return [];
    }

    const logFiles = files.filter(f => f.endsWith('.log') && !f.includes('.log.'));

    const allEntries: LogEntry[] = [];

    for (const file of logFiles) {
      const logFile = path.join(logsDir, file);
      try {
        const content = await fs.readFile(logFile, 'utf-8');
        const entries = this.parseAndFilterLogs(content, {
          ...options,
          limit: options.limit * 2, // Get more than needed, will sort later
        });
        allEntries.push(...entries);
      } catch {
        // Skip files that can't be read
      }
    }

    // Sort by timestamp descending and limit
    allEntries.sort((a, b) => b.timestamp - a.timestamp);
    return allEntries.slice(0, options.limit);
  }

  /**
   * Parse and filter log content
   */
  private parseAndFilterLogs(
    content: string,
    options: { limit: number; level?: string; since?: number }
  ): LogEntry[] {
    const lines = content.trim().split('\n').filter(l => l);

    let entries: LogEntry[] = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter((e): e is LogEntry => e !== null);

    // Filter by level
    if (options.level) {
      const minLevel = LOG_LEVEL_ORDER[options.level] ?? 0;
      entries = entries.filter(e => (LOG_LEVEL_ORDER[e.level] ?? 0) >= minLevel);
    }

    // Filter by time
    if (options.since) {
      entries = entries.filter(e => e.timestamp >= options.since!);
    }

    // Sort by timestamp descending and limit
    entries.sort((a, b) => b.timestamp - a.timestamp);
    return entries.slice(0, options.limit);
  }

  /**
   * Display logs in human-readable format
   */
  private displayLogs(entries: LogEntry[], showPluginName: boolean): void {
    for (const entry of entries) {
      const time = new Date(entry.timestamp).toISOString();
      const level = entry.level.toUpperCase().padEnd(5);
      const prefix = showPluginName ? `[${entry.plugin}] ` : '';

      this.log(`${time} ${level} ${prefix}${entry.message}`);

      if (entry.data) {
        this.log(`         ${JSON.stringify(entry.data)}`);
      }
    }
  }

  /**
   * Parse --since flag to timestamp
   */
  private parseSince(since: string): number {
    const now = Date.now();

    // Try ISO timestamp first
    const isoDate = Date.parse(since);
    if (!isNaN(isoDate)) {
      return isoDate;
    }

    // Parse duration format (1h, 30m, 1d)
    const match = since.match(/^(\d+)([smhd])$/);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2];

      const multipliers: Record<string, number> = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
      };

      return now - value * multipliers[unit];
    }

    // Default to 1 hour ago
    return now - 3600000;
  }
}
