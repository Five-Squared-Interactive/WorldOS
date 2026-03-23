/**
 * Log Aggregator Tests
 *
 * Story 6.2: Log Aggregation
 *
 * Collects and stores logs from all plugins.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { LogAggregator, LogEntry, LogLevel } from './log-aggregator.js';

describe('LogAggregator', () => {
  let tempDir: string;
  let logsDir: string;
  let aggregator: LogAggregator;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'log-aggregator-test-'));
    logsDir = path.join(tempDir, 'logs');
    await fs.mkdir(logsDir, { recursive: true });
    aggregator = new LogAggregator(logsDir);
  });

  afterEach(async () => {
    await aggregator.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('writeLog', () => {
    it('should write log entry to plugin log file', async () => {
      await aggregator.writeLog('test-plugin', {
        level: 'info',
        message: 'Hello world',
        timestamp: Date.now(),
      });

      const content = await fs.readFile(path.join(logsDir, 'test-plugin.log'), 'utf-8');
      expect(content).toContain('Hello world');
    });

    it('should write JSON formatted log entries', async () => {
      const timestamp = Date.now();
      await aggregator.writeLog('test-plugin', {
        level: 'info',
        message: 'Test message',
        timestamp,
        data: { key: 'value' },
      });

      const content = await fs.readFile(path.join(logsDir, 'test-plugin.log'), 'utf-8');
      const entry = JSON.parse(content.trim());

      expect(entry.level).toBe('info');
      expect(entry.message).toBe('Test message');
      expect(entry.timestamp).toBe(timestamp);
      expect(entry.data).toEqual({ key: 'value' });
    });

    it('should append multiple log entries', async () => {
      await aggregator.writeLog('test-plugin', {
        level: 'info',
        message: 'First',
        timestamp: Date.now(),
      });
      await aggregator.writeLog('test-plugin', {
        level: 'info',
        message: 'Second',
        timestamp: Date.now(),
      });

      const content = await fs.readFile(path.join(logsDir, 'test-plugin.log'), 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).message).toBe('First');
      expect(JSON.parse(lines[1]).message).toBe('Second');
    });

    it('should include plugin name in log entry', async () => {
      await aggregator.writeLog('my-plugin', {
        level: 'info',
        message: 'Test',
        timestamp: Date.now(),
      });

      const content = await fs.readFile(path.join(logsDir, 'my-plugin.log'), 'utf-8');
      const entry = JSON.parse(content.trim());

      expect(entry.plugin).toBe('my-plugin');
    });
  });

  describe('parseStdout', () => {
    it('should parse JSON formatted log line', () => {
      const line = JSON.stringify({
        level: 'info',
        message: 'Test message',
        timestamp: 1234567890,
      });

      const entry = aggregator.parseLogLine(line);

      expect(entry.level).toBe('info');
      expect(entry.message).toBe('Test message');
      expect(entry.timestamp).toBe(1234567890);
    });

    it('should handle plain text as info log', () => {
      const line = 'Plain text message';

      const entry = aggregator.parseLogLine(line);

      expect(entry.level).toBe('info');
      expect(entry.message).toBe('Plain text message');
      expect(entry.timestamp).toBeDefined();
    });

    it('should detect error keywords in plain text', () => {
      const line = 'Error: Something went wrong';

      const entry = aggregator.parseLogLine(line);

      expect(entry.level).toBe('error');
    });

    it('should detect warning keywords in plain text', () => {
      const line = 'Warning: Deprecated API';

      const entry = aggregator.parseLogLine(line);

      expect(entry.level).toBe('warn');
    });

    it('should handle malformed JSON gracefully', () => {
      const line = '{ invalid json';

      const entry = aggregator.parseLogLine(line);

      expect(entry.level).toBe('info');
      expect(entry.message).toBe('{ invalid json');
    });
  });

  describe('readLogs', () => {
    it('should read recent log entries', async () => {
      // Write some logs
      for (let i = 0; i < 5; i++) {
        await aggregator.writeLog('test-plugin', {
          level: 'info',
          message: `Message ${i}`,
          timestamp: Date.now() + i,
        });
      }

      const entries = await aggregator.readLogs('test-plugin', { limit: 3 });

      expect(entries).toHaveLength(3);
      // Should return most recent
      expect(entries[0].message).toBe('Message 4');
      expect(entries[2].message).toBe('Message 2');
    });

    it('should filter by log level', async () => {
      await aggregator.writeLog('test-plugin', {
        level: 'info',
        message: 'Info message',
        timestamp: Date.now(),
      });
      await aggregator.writeLog('test-plugin', {
        level: 'error',
        message: 'Error message',
        timestamp: Date.now() + 1,
      });
      await aggregator.writeLog('test-plugin', {
        level: 'warn',
        message: 'Warning message',
        timestamp: Date.now() + 2,
      });

      const entries = await aggregator.readLogs('test-plugin', { level: 'error' });

      // Should include error and above (error only in this case)
      expect(entries).toHaveLength(1);
      expect(entries[0].message).toBe('Error message');
    });

    it('should filter by time range', async () => {
      const now = Date.now();
      const oneHourAgo = now - 3600000;
      const twoHoursAgo = now - 7200000;

      await aggregator.writeLog('test-plugin', {
        level: 'info',
        message: 'Old message',
        timestamp: twoHoursAgo,
      });
      await aggregator.writeLog('test-plugin', {
        level: 'info',
        message: 'Recent message',
        timestamp: now,
      });

      const entries = await aggregator.readLogs('test-plugin', { since: oneHourAgo });

      expect(entries).toHaveLength(1);
      expect(entries[0].message).toBe('Recent message');
    });

    it('should return empty array for non-existent plugin', async () => {
      const entries = await aggregator.readLogs('non-existent');

      expect(entries).toEqual([]);
    });
  });

  describe('log rotation', () => {
    it('should rotate log file when it exceeds max size', async () => {
      // Create aggregator with small max size for testing
      const smallAggregator = new LogAggregator(logsDir, { maxFileSize: 100 });

      // Write enough data to trigger rotation
      for (let i = 0; i < 10; i++) {
        await smallAggregator.writeLog('test-plugin', {
          level: 'info',
          message: 'A'.repeat(50), // 50+ bytes per entry
          timestamp: Date.now(),
        });
      }

      await smallAggregator.close();

      // Check for rotated file
      const files = await fs.readdir(logsDir);
      const rotatedFiles = files.filter(f => f.startsWith('test-plugin.log'));

      expect(rotatedFiles.length).toBeGreaterThan(1);
    });

    it('should delete old rotations beyond retention limit', async () => {
      const smallAggregator = new LogAggregator(logsDir, {
        maxFileSize: 100,
        maxRotations: 2,
      });

      // Write lots of data to trigger multiple rotations
      for (let i = 0; i < 50; i++) {
        await smallAggregator.writeLog('test-plugin', {
          level: 'info',
          message: 'B'.repeat(50),
          timestamp: Date.now(),
        });
      }

      await smallAggregator.close();

      const files = await fs.readdir(logsDir);
      const rotatedFiles = files.filter(f => f.startsWith('test-plugin.log'));

      // Should have at most maxRotations + 1 (current file)
      expect(rotatedFiles.length).toBeLessThanOrEqual(3);
    });
  });

  describe('readAllLogs', () => {
    it('should read logs from all plugins', async () => {
      await aggregator.writeLog('plugin-a', {
        level: 'info',
        message: 'From A',
        timestamp: Date.now(),
      });
      await aggregator.writeLog('plugin-b', {
        level: 'info',
        message: 'From B',
        timestamp: Date.now() + 1,
      });

      const entries = await aggregator.readAllLogs({ limit: 10 });

      expect(entries).toHaveLength(2);
      expect(entries.map(e => e.plugin)).toContain('plugin-a');
      expect(entries.map(e => e.plugin)).toContain('plugin-b');
    });

    it('should interleave logs by timestamp', async () => {
      const t1 = Date.now();
      const t2 = t1 + 100;
      const t3 = t1 + 200;

      await aggregator.writeLog('plugin-a', {
        level: 'info',
        message: 'A1',
        timestamp: t1,
      });
      await aggregator.writeLog('plugin-b', {
        level: 'info',
        message: 'B1',
        timestamp: t2,
      });
      await aggregator.writeLog('plugin-a', {
        level: 'info',
        message: 'A2',
        timestamp: t3,
      });

      const entries = await aggregator.readAllLogs({ limit: 10 });

      // Should be sorted by timestamp descending (most recent first)
      expect(entries[0].message).toBe('A2');
      expect(entries[1].message).toBe('B1');
      expect(entries[2].message).toBe('A1');
    });
  });

  describe('streamLogs', () => {
    it('should emit new log entries', async () => {
      const entries: LogEntry[] = [];
      const unsubscribe = aggregator.streamLogs('test-plugin', entry => {
        entries.push(entry);
      });

      await aggregator.writeLog('test-plugin', {
        level: 'info',
        message: 'Streamed message',
        timestamp: Date.now(),
      });

      // Give time for event to propagate
      await new Promise(resolve => setTimeout(resolve, 50));

      unsubscribe();

      expect(entries).toHaveLength(1);
      expect(entries[0].message).toBe('Streamed message');
    });

    it('should filter streamed logs by level', async () => {
      const entries: LogEntry[] = [];
      const unsubscribe = aggregator.streamLogs('test-plugin', entry => {
        entries.push(entry);
      }, { level: 'error' });

      await aggregator.writeLog('test-plugin', {
        level: 'info',
        message: 'Info message',
        timestamp: Date.now(),
      });
      await aggregator.writeLog('test-plugin', {
        level: 'error',
        message: 'Error message',
        timestamp: Date.now(),
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      unsubscribe();

      expect(entries).toHaveLength(1);
      expect(entries[0].message).toBe('Error message');
    });

    it('should stop streaming after unsubscribe', async () => {
      const entries: LogEntry[] = [];
      const unsubscribe = aggregator.streamLogs('test-plugin', entry => {
        entries.push(entry);
      });

      await aggregator.writeLog('test-plugin', {
        level: 'info',
        message: 'Before unsubscribe',
        timestamp: Date.now(),
      });

      await new Promise(resolve => setTimeout(resolve, 50));
      unsubscribe();

      await aggregator.writeLog('test-plugin', {
        level: 'info',
        message: 'After unsubscribe',
        timestamp: Date.now(),
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(entries).toHaveLength(1);
      expect(entries[0].message).toBe('Before unsubscribe');
    });
  });

  describe('crash logging', () => {
    it('should capture stderr as error logs', async () => {
      await aggregator.writeStderr('test-plugin', 'Error: Process crashed');

      const entries = await aggregator.readLogs('test-plugin');

      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe('error');
      expect(entries[0].message).toBe('Error: Process crashed');
    });

    it('should tag crash logs', async () => {
      await aggregator.writeStderr('test-plugin', 'Fatal error', { crash: true });

      const entries = await aggregator.readLogs('test-plugin');

      expect(entries[0].crash).toBe(true);
    });
  });
});
