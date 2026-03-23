/**
 * Log Aggregator
 *
 * Story 6.2: Log Aggregation
 *
 * Collects and stores logs from all plugins.
 * Supports log rotation, filtering, and streaming.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { EventEmitter } from 'events';

/**
 * Log levels in order of severity
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Log entry structure
 */
export interface LogEntry {
  plugin: string;
  level: LogLevel;
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
  crash?: boolean;
}

/**
 * Options for reading logs
 */
export interface ReadLogsOptions {
  limit?: number;
  level?: LogLevel;
  since?: number;
}

/**
 * Options for streaming logs
 */
export interface StreamLogsOptions {
  level?: LogLevel;
}

/**
 * Log aggregator configuration
 */
export interface LogAggregatorConfig {
  maxFileSize?: number;  // bytes, default 10MB
  maxRotations?: number; // default 5
}

/**
 * Aggregates logs from all plugins
 */
export class LogAggregator extends EventEmitter {
  private logsDir: string;
  private maxFileSize: number;
  private maxRotations: number;
  private fileHandles: Map<string, fs.FileHandle> = new Map();
  private fileSizes: Map<string, number> = new Map();

  constructor(logsDir?: string, config: LogAggregatorConfig = {}) {
    super();
    this.logsDir = logsDir ?? '';
    this.maxFileSize = config.maxFileSize ?? 10 * 1024 * 1024; // 10MB
    this.maxRotations = config.maxRotations ?? 5;
  }

  /**
   * Set the logs directory (deferred initialization)
   */
  setLogsDir(logsDir: string): void {
    this.logsDir = logsDir;
  }

  /**
   * Convenience method to log a message for a plugin
   */
  log(pluginName: string, level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = {
      plugin: pluginName,
      level,
      message,
      timestamp: Date.now(),
      data,
    };

    // Emit for streaming
    this.emit(`log:${pluginName}`, entry);
    this.emit('log', entry);

    // Write to file if logsDir is configured (bypass writeLog to avoid double-emit)
    if (this.logsDir) {
      this.appendToFile(pluginName, entry).catch(() => {
        // Ignore file write errors in convenience method
      });
    }
  }

  /**
   * Write a log entry for a plugin
   */
  async writeLog(
    pluginName: string,
    entry: Omit<LogEntry, 'plugin'>
  ): Promise<void> {
    const fullEntry: LogEntry = {
      ...entry,
      plugin: pluginName,
    };

    await this.appendToFile(pluginName, fullEntry);

    // Emit for streaming
    this.emit(`log:${pluginName}`, fullEntry);
    this.emit('log', fullEntry);
  }

  /**
   * Append a log entry to the plugin's log file (no event emission)
   */
  private async appendToFile(pluginName: string, entry: LogEntry): Promise<void> {
    const line = JSON.stringify(entry) + '\n';
    const logFile = this.getLogFilePath(pluginName);

    // Check for rotation
    await this.checkRotation(pluginName);

    // Append to log file
    await fs.appendFile(logFile, line);

    // Update file size tracking
    const currentSize = this.fileSizes.get(pluginName) ?? 0;
    this.fileSizes.set(pluginName, currentSize + Buffer.byteLength(line));
  }

  /**
   * Write stderr output as error log
   */
  async writeStderr(
    pluginName: string,
    message: string,
    options: { crash?: boolean } = {}
  ): Promise<void> {
    await this.writeLog(pluginName, {
      level: 'error',
      message,
      timestamp: Date.now(),
      crash: options.crash,
    });
  }

  /**
   * Parse a log line (from plugin stdout)
   */
  parseLogLine(line: string): Omit<LogEntry, 'plugin'> {
    // Try to parse as JSON
    try {
      const parsed = JSON.parse(line);
      if (parsed.level && parsed.message) {
        return {
          level: this.normalizeLevel(parsed.level),
          message: parsed.message,
          timestamp: parsed.timestamp ?? Date.now(),
          data: parsed.data,
        };
      }
    } catch {
      // Not JSON, handle as plain text
    }

    // Plain text - detect level from content
    const level = this.detectLevel(line);

    return {
      level,
      message: line,
      timestamp: Date.now(),
    };
  }

  /**
   * Read log entries for a plugin
   */
  async readLogs(
    pluginName: string,
    options: ReadLogsOptions = {}
  ): Promise<LogEntry[]> {
    const { limit = 100, level, since } = options;
    const logFile = this.getLogFilePath(pluginName);

    try {
      const content = await fs.readFile(logFile, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l);

      let entries: LogEntry[] = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter((e): e is LogEntry => e !== null);

      // Filter by level
      if (level) {
        const minLevel = LOG_LEVEL_ORDER[level];
        entries = entries.filter(e => LOG_LEVEL_ORDER[e.level] >= minLevel);
      }

      // Filter by time
      if (since) {
        entries = entries.filter(e => e.timestamp >= since);
      }

      // Sort by timestamp descending and limit
      entries.sort((a, b) => b.timestamp - a.timestamp);
      return entries.slice(0, limit);
    } catch {
      return [];
    }
  }

  /**
   * Read logs from all plugins
   */
  async readAllLogs(options: ReadLogsOptions = {}): Promise<LogEntry[]> {
    const { limit = 100, level, since } = options;

    // Get all plugin log files
    let files: string[];
    try {
      files = await fs.readdir(this.logsDir);
    } catch {
      return [];
    }

    const logFiles = files.filter(f => f.endsWith('.log') && !f.includes('.log.'));

    // Read logs from each plugin
    const allEntries: LogEntry[] = [];

    for (const file of logFiles) {
      const pluginName = file.replace('.log', '');
      const entries = await this.readLogs(pluginName, { limit: limit * 2, level, since });
      allEntries.push(...entries);
    }

    // Sort by timestamp descending and limit
    allEntries.sort((a, b) => b.timestamp - a.timestamp);
    return allEntries.slice(0, limit);
  }

  /**
   * Stream logs for a plugin
   */
  streamLogs(
    pluginName: string,
    callback: (entry: LogEntry) => void,
    options: StreamLogsOptions = {}
  ): () => void {
    const { level } = options;

    const handler = (entry: LogEntry) => {
      // Filter by level
      if (level && LOG_LEVEL_ORDER[entry.level] < LOG_LEVEL_ORDER[level]) {
        return;
      }
      callback(entry);
    };

    this.on(`log:${pluginName}`, handler);

    // Return unsubscribe function
    return () => {
      this.off(`log:${pluginName}`, handler);
    };
  }

  /**
   * Stream logs from all plugins
   */
  streamAllLogs(
    callback: (entry: LogEntry) => void,
    options: StreamLogsOptions = {}
  ): () => void {
    const { level } = options;

    const handler = (entry: LogEntry) => {
      if (level && LOG_LEVEL_ORDER[entry.level] < LOG_LEVEL_ORDER[level]) {
        return;
      }
      callback(entry);
    };

    this.on('log', handler);

    return () => {
      this.off('log', handler);
    };
  }

  /**
   * Close all file handles
   */
  async close(): Promise<void> {
    for (const handle of this.fileHandles.values()) {
      await handle.close();
    }
    this.fileHandles.clear();
    this.fileSizes.clear();
    this.removeAllListeners();
  }

  /**
   * Get log file path for a plugin
   */
  private getLogFilePath(pluginName: string): string {
    return path.join(this.logsDir, `${pluginName}.log`);
  }

  /**
   * Check and perform log rotation if needed
   */
  private async checkRotation(pluginName: string): Promise<void> {
    const logFile = this.getLogFilePath(pluginName);

    // Get current file size
    let fileSize = this.fileSizes.get(pluginName);
    if (fileSize === undefined) {
      try {
        const stats = await fs.stat(logFile);
        fileSize = stats.size;
        this.fileSizes.set(pluginName, fileSize);
      } catch {
        fileSize = 0;
        this.fileSizes.set(pluginName, 0);
      }
    }

    // Check if rotation needed
    if (fileSize < this.maxFileSize) {
      return;
    }

    // Perform rotation
    await this.rotateLog(pluginName);
  }

  /**
   * Rotate log files
   */
  private async rotateLog(pluginName: string): Promise<void> {
    const logFile = this.getLogFilePath(pluginName);

    // Shift existing rotations
    for (let i = this.maxRotations; i >= 1; i--) {
      const oldPath = `${logFile}.${i}`;
      const newPath = `${logFile}.${i + 1}`;

      try {
        if (i === this.maxRotations) {
          // Delete oldest rotation
          await fs.unlink(oldPath);
        } else {
          // Rename to next number
          await fs.rename(oldPath, newPath);
        }
      } catch {
        // File doesn't exist, skip
      }
    }

    // Rotate current file
    try {
      await fs.rename(logFile, `${logFile}.1`);
      this.fileSizes.set(pluginName, 0);
    } catch {
      // File doesn't exist
    }
  }

  /**
   * Normalize log level string
   */
  private normalizeLevel(level: string): LogLevel {
    const lower = level.toLowerCase();
    if (lower === 'debug' || lower === 'trace') return 'debug';
    if (lower === 'info') return 'info';
    if (lower === 'warn' || lower === 'warning') return 'warn';
    if (lower === 'error' || lower === 'fatal' || lower === 'critical') return 'error';
    return 'info';
  }

  /**
   * Detect log level from plain text content
   */
  private detectLevel(text: string): LogLevel {
    const lower = text.toLowerCase();
    if (lower.includes('error') || lower.includes('exception') || lower.includes('fatal')) {
      return 'error';
    }
    if (lower.includes('warn') || lower.includes('warning')) {
      return 'warn';
    }
    if (lower.includes('debug') || lower.includes('trace')) {
      return 'debug';
    }
    return 'info';
  }
}
