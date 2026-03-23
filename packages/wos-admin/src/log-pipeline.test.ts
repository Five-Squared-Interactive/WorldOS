/**
 * Log Pipeline Tests
 *
 * Tests the FULL log data flow:
 *   LogAggregator emits → server buffer captures → /api/logs returns → app.js renders
 *
 * Covers: buffer overflow, deduplication, since/level/limit filters,
 * concurrent plugin streams, incremental polling, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAdminServer } from './server.js';
import { AuthManager } from './auth.js';
import type { FastifyInstance } from 'fastify';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// ── Faithful LogAggregator reproduction ──────────────────────────────

class TestLogAggregator extends EventEmitter {
  private logsDir: string;

  constructor(logsDir: string) {
    super();
    this.logsDir = logsDir;
  }

  log(pluginName: string, level: string, message: string) {
    const entry = { plugin: pluginName, level, message, timestamp: Date.now() };
    this.emit('log', entry);
    this.emit(`log:${pluginName}`, entry);
  }

  logWithTimestamp(pluginName: string, level: string, message: string, timestamp: number) {
    const entry = { plugin: pluginName, level, message, timestamp };
    this.emit('log', entry);
    this.emit(`log:${pluginName}`, entry);
  }

  async readAllLogs(options: { limit?: number; level?: string; since?: number } = {}) {
    const { limit = 100, level, since } = options;
    let allEntries: { plugin: string; level: string; message: string; timestamp: number }[] = [];

    try {
      const files = await fs.readdir(this.logsDir);
      for (const file of files.filter(f => f.endsWith('.log'))) {
        const content = await fs.readFile(path.join(this.logsDir, file), 'utf-8');
        const entries = content.trim().split('\n').filter(Boolean).map(l => {
          try { return JSON.parse(l); } catch { return null; }
        }).filter(Boolean);
        allEntries.push(...entries);
      }
    } catch { /* no logs dir */ }

    if (level) allEntries = allEntries.filter(e => e.level === level);
    if (since) allEntries = allEntries.filter(e => e.timestamp >= since);
    allEntries.sort((a, b) => b.timestamp - a.timestamp);
    return allEntries.slice(0, limit);
  }

  streamAllLogs(callback: (entry: any) => void) {
    this.on('log', callback);
    return () => this.off('log', callback);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

async function createTmpDir() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-log-test-'));
  await fs.mkdir(path.join(tmpDir, 'logs'), { recursive: true });
  return tmpDir;
}

async function writeLogFile(logsDir: string, pluginName: string, entries: any[]) {
  await fs.writeFile(
    path.join(logsDir, `${pluginName}.log`),
    entries.map(e => JSON.stringify(e)).join('\n') + '\n'
  );
}

async function createLogServer(opts: {
  tmpDir: string;
  logAggregator: TestLogAggregator;
}) {
  const server = await createAdminServer({
    port: 0,
    authManager: new AuthManager(),
    serverDir: opts.tmpDir,
    logAggregator: opts.logAggregator as any,
  });
  await server.ready();
  return server;
}

async function getLogs(server: FastifyInstance, query = '') {
  const r = await server.inject({ method: 'GET', url: `/api/logs${query}` });
  expect(r.statusCode).toBe(200);
  return JSON.parse(r.body);
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Log Pipeline', () => {
  let server: FastifyInstance;
  let tmpDir: string;

  afterEach(async () => {
    if (server) await server.close();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Disk-based logs ────────────────────────────────────────────

  describe('disk-based logs (readAllLogs)', () => {
    it('reads logs from multiple plugin log files', async () => {
      tmpDir = await createTmpDir();
      const logsDir = path.join(tmpDir, 'logs');
      const now = Date.now();

      await writeLogFile(logsDir, 'plugin-a', [
        { plugin: 'plugin-a', level: 'info', message: 'A started', timestamp: now - 2000 },
        { plugin: 'plugin-a', level: 'error', message: 'A crashed', timestamp: now - 1000 },
      ]);
      await writeLogFile(logsDir, 'plugin-b', [
        { plugin: 'plugin-b', level: 'warn', message: 'B warning', timestamp: now - 500 },
      ]);

      const logAgg = new TestLogAggregator(logsDir);
      server = await createLogServer({ tmpDir, logAggregator: logAgg });

      const body = await getLogs(server);
      expect(body.logs).toHaveLength(3);
      // Sorted descending by timestamp
      expect(body.logs[0].message).toBe('B warning');
      expect(body.logs[1].message).toBe('A crashed');
      expect(body.logs[2].message).toBe('A started');
    });

    it('returns empty array when no log files exist', async () => {
      tmpDir = await createTmpDir();
      const logsDir = path.join(tmpDir, 'logs');
      const logAgg = new TestLogAggregator(logsDir);
      server = await createLogServer({ tmpDir, logAggregator: logAgg });

      const body = await getLogs(server);
      expect(body.logs).toEqual([]);
    });

    it('handles malformed JSON lines gracefully', async () => {
      tmpDir = await createTmpDir();
      const logsDir = path.join(tmpDir, 'logs');
      const now = Date.now();

      await fs.writeFile(
        path.join(logsDir, 'bad-plugin.log'),
        `{"plugin":"bad","level":"info","message":"good line","timestamp":${now}}\nNOT JSON\n{"plugin":"bad","level":"error","message":"also good","timestamp":${now + 1}}\n`
      );

      const logAgg = new TestLogAggregator(logsDir);
      server = await createLogServer({ tmpDir, logAggregator: logAgg });

      const body = await getLogs(server);
      expect(body.logs).toHaveLength(2);
    });
  });

  // ── In-memory buffer (event-emitted logs) ─────────────────────

  describe('in-memory buffer (emitted logs)', () => {
    it('captures logs emitted after server creation', async () => {
      tmpDir = await createTmpDir();
      const logAgg = new TestLogAggregator(path.join(tmpDir, 'logs'));
      server = await createLogServer({ tmpDir, logAggregator: logAgg });

      // Emit logs after server is ready
      logAgg.log('my-plugin', 'info', 'Hello from plugin');
      logAgg.log('my-plugin', 'warn', 'Something is off');

      const body = await getLogs(server);
      expect(body.logs).toHaveLength(2);
      expect(body.logs.some((l: any) => l.message === 'Hello from plugin')).toBe(true);
      expect(body.logs.some((l: any) => l.message === 'Something is off')).toBe(true);
    });

    it('captures logs from multiple plugins', async () => {
      tmpDir = await createTmpDir();
      const logAgg = new TestLogAggregator(path.join(tmpDir, 'logs'));
      server = await createLogServer({ tmpDir, logAggregator: logAgg });

      logAgg.log('plugin-a', 'info', 'A says hi');
      logAgg.log('plugin-b', 'info', 'B says hi');
      logAgg.log('plugin-c', 'error', 'C exploded');

      const body = await getLogs(server);
      expect(body.logs).toHaveLength(3);
      const plugins = body.logs.map((l: any) => l.plugin);
      expect(plugins).toContain('plugin-a');
      expect(plugins).toContain('plugin-b');
      expect(plugins).toContain('plugin-c');
    });

    it('enforces buffer limit of 500 entries', async () => {
      tmpDir = await createTmpDir();
      const logAgg = new TestLogAggregator(path.join(tmpDir, 'logs'));
      server = await createLogServer({ tmpDir, logAggregator: logAgg });

      // Emit 600 logs
      for (let i = 0; i < 600; i++) {
        logAgg.logWithTimestamp('test', 'info', `msg-${i}`, Date.now() + i);
      }

      // The buffer trims to 500, so the first 100 should be gone
      const body = await getLogs(server, '?limit=600');
      // Should have at most 500 (the buffer limit)
      expect(body.logs.length).toBeLessThanOrEqual(500);
      // First emitted entries (msg-0 through msg-99) should be gone
      const messages = body.logs.map((l: any) => l.message);
      expect(messages).not.toContain('msg-0');
      expect(messages).toContain('msg-599');
    });
  });

  // ── Deduplication ─────────────────────────────────────────────

  describe('deduplication (disk + memory)', () => {
    it('deduplicates entries that appear in both disk and memory', async () => {
      tmpDir = await createTmpDir();
      const logsDir = path.join(tmpDir, 'logs');
      const now = Date.now();

      // Write a log to disk
      await writeLogFile(logsDir, 'dup-plugin', [
        { plugin: 'dup-plugin', level: 'info', message: 'Same message', timestamp: now },
      ]);

      const logAgg = new TestLogAggregator(logsDir);
      server = await createLogServer({ tmpDir, logAggregator: logAgg });

      // Emit the same log to memory buffer
      logAgg.logWithTimestamp('dup-plugin', 'info', 'Same message', now);

      const body = await getLogs(server);
      // Should only appear once despite being in both disk and memory
      const matching = body.logs.filter((l: any) => l.message === 'Same message');
      expect(matching).toHaveLength(1);
    });

    it('keeps distinct entries from disk and memory', async () => {
      tmpDir = await createTmpDir();
      const logsDir = path.join(tmpDir, 'logs');
      const now = Date.now();

      await writeLogFile(logsDir, 'plugin', [
        { plugin: 'plugin', level: 'info', message: 'Disk only', timestamp: now - 1000 },
      ]);

      const logAgg = new TestLogAggregator(logsDir);
      server = await createLogServer({ tmpDir, logAggregator: logAgg });

      logAgg.logWithTimestamp('plugin', 'info', 'Memory only', now);

      const body = await getLogs(server);
      expect(body.logs).toHaveLength(2);
      expect(body.logs.some((l: any) => l.message === 'Disk only')).toBe(true);
      expect(body.logs.some((l: any) => l.message === 'Memory only')).toBe(true);
    });
  });

  // ── Query filters ─────────────────────────────────────────────

  describe('query filters', () => {
    it('filters by level=error', async () => {
      tmpDir = await createTmpDir();
      const logAgg = new TestLogAggregator(path.join(tmpDir, 'logs'));
      server = await createLogServer({ tmpDir, logAggregator: logAgg });

      logAgg.log('p', 'info', 'info msg');
      logAgg.log('p', 'warn', 'warn msg');
      logAgg.log('p', 'error', 'error msg');

      const body = await getLogs(server, '?level=error');
      expect(body.logs).toHaveLength(1);
      expect(body.logs[0].level).toBe('error');
      expect(body.logs[0].message).toBe('error msg');
    });

    it('filters by level=warn', async () => {
      tmpDir = await createTmpDir();
      const logAgg = new TestLogAggregator(path.join(tmpDir, 'logs'));
      server = await createLogServer({ tmpDir, logAggregator: logAgg });

      logAgg.log('p', 'info', 'info');
      logAgg.log('p', 'warn', 'warn');
      logAgg.log('p', 'error', 'error');

      const body = await getLogs(server, '?level=warn');
      expect(body.logs).toHaveLength(1);
      expect(body.logs[0].level).toBe('warn');
    });

    it('filters by since timestamp', async () => {
      tmpDir = await createTmpDir();
      const logAgg = new TestLogAggregator(path.join(tmpDir, 'logs'));
      server = await createLogServer({ tmpDir, logAggregator: logAgg });

      const base = Date.now();
      logAgg.logWithTimestamp('p', 'info', 'old', base - 10000);
      logAgg.logWithTimestamp('p', 'info', 'recent', base - 100);
      logAgg.logWithTimestamp('p', 'info', 'newest', base);

      const body = await getLogs(server, `?since=${base - 500}`);
      expect(body.logs).toHaveLength(2);
      expect(body.logs.every((l: any) => l.timestamp >= base - 500)).toBe(true);
    });

    it('applies limit parameter', async () => {
      tmpDir = await createTmpDir();
      const logAgg = new TestLogAggregator(path.join(tmpDir, 'logs'));
      server = await createLogServer({ tmpDir, logAggregator: logAgg });

      for (let i = 0; i < 20; i++) {
        logAgg.logWithTimestamp('p', 'info', `msg-${i}`, Date.now() + i);
      }

      const body = await getLogs(server, '?limit=5');
      expect(body.logs).toHaveLength(5);
    });

    it('combines since + level filters', async () => {
      tmpDir = await createTmpDir();
      const logAgg = new TestLogAggregator(path.join(tmpDir, 'logs'));
      server = await createLogServer({ tmpDir, logAggregator: logAgg });

      const base = Date.now();
      logAgg.logWithTimestamp('p', 'info', 'old info', base - 10000);
      logAgg.logWithTimestamp('p', 'error', 'old error', base - 10000);
      logAgg.logWithTimestamp('p', 'info', 'new info', base);
      logAgg.logWithTimestamp('p', 'error', 'new error', base);

      const body = await getLogs(server, `?level=error&since=${base - 500}`);
      expect(body.logs).toHaveLength(1);
      expect(body.logs[0].message).toBe('new error');
    });

    it('combines limit + level filters', async () => {
      tmpDir = await createTmpDir();
      const logAgg = new TestLogAggregator(path.join(tmpDir, 'logs'));
      server = await createLogServer({ tmpDir, logAggregator: logAgg });

      for (let i = 0; i < 10; i++) {
        logAgg.logWithTimestamp('p', 'error', `err-${i}`, Date.now() + i);
      }
      logAgg.log('p', 'info', 'not an error');

      const body = await getLogs(server, '?level=error&limit=3');
      expect(body.logs).toHaveLength(3);
      expect(body.logs.every((l: any) => l.level === 'error')).toBe(true);
    });

    it('default limit is 200', async () => {
      tmpDir = await createTmpDir();
      const logAgg = new TestLogAggregator(path.join(tmpDir, 'logs'));
      server = await createLogServer({ tmpDir, logAggregator: logAgg });

      for (let i = 0; i < 300; i++) {
        logAgg.logWithTimestamp('p', 'info', `msg-${i}`, Date.now() + i);
      }

      const body = await getLogs(server);
      expect(body.logs).toHaveLength(200);
    });
  });

  // ── Sort order ────────────────────────────────────────────────

  describe('sort order', () => {
    it('returns logs sorted descending by timestamp (newest first)', async () => {
      tmpDir = await createTmpDir();
      const logAgg = new TestLogAggregator(path.join(tmpDir, 'logs'));
      server = await createLogServer({ tmpDir, logAggregator: logAgg });

      const base = Date.now();
      logAgg.logWithTimestamp('p', 'info', 'first', base - 2000);
      logAgg.logWithTimestamp('p', 'info', 'second', base - 1000);
      logAgg.logWithTimestamp('p', 'info', 'third', base);

      const body = await getLogs(server);
      expect(body.logs[0].message).toBe('third');
      expect(body.logs[1].message).toBe('second');
      expect(body.logs[2].message).toBe('first');
    });
  });

  // ── Response shape ────────────────────────────────────────────

  describe('response shape', () => {
    it('returns { logs: [...], timestamp: number }', async () => {
      tmpDir = await createTmpDir();
      const logAgg = new TestLogAggregator(path.join(tmpDir, 'logs'));
      server = await createLogServer({ tmpDir, logAggregator: logAgg });

      logAgg.log('p', 'info', 'test');

      const body = await getLogs(server);
      expect(body).toHaveProperty('logs');
      expect(body).toHaveProperty('timestamp');
      expect(Array.isArray(body.logs)).toBe(true);
      expect(body.timestamp).toBeTypeOf('number');
    });

    it('each log entry has plugin, level, message, timestamp', async () => {
      tmpDir = await createTmpDir();
      const logAgg = new TestLogAggregator(path.join(tmpDir, 'logs'));
      server = await createLogServer({ tmpDir, logAggregator: logAgg });

      logAgg.log('my-plug', 'warn', 'test msg');

      const body = await getLogs(server);
      const entry = body.logs[0];
      expect(entry.plugin).toBe('my-plug');
      expect(entry.level).toBe('warn');
      expect(entry.message).toBe('test msg');
      expect(entry.timestamp).toBeTypeOf('number');
    });
  });

  // ── No logAggregator ──────────────────────────────────────────

  describe('no logAggregator configured', () => {
    it('returns empty logs array', async () => {
      tmpDir = await createTmpDir();
      const server2 = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
        // NO logAggregator
      });
      await server2.ready();

      const r = await server2.inject({ method: 'GET', url: '/api/logs' });
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body).logs).toEqual([]);

      await server2.close();
    });
  });

  // ── Auth on logs endpoint ─────────────────────────────────────

  describe('auth on logs endpoint', () => {
    it('requires auth when credentials are configured', async () => {
      tmpDir = await createTmpDir();
      const authManager = new AuthManager();
      await authManager.setCredentials('admin', 'secret');

      const server2 = await createAdminServer({
        port: 0,
        authManager,
        serverDir: tmpDir,
      });
      await server2.ready();

      const r = await server2.inject({ method: 'GET', url: '/api/logs' });
      expect(r.statusCode).toBe(401);

      await server2.close();
    });

    it('allows access with valid token', async () => {
      tmpDir = await createTmpDir();
      const authManager = new AuthManager();
      await authManager.setCredentials('admin', 'secret');

      const server2 = await createAdminServer({
        port: 0,
        authManager,
        serverDir: tmpDir,
      });
      await server2.ready();

      // Login
      const loginRes = await server2.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: 'secret' },
      });
      const { token } = JSON.parse(loginRes.body);

      const r = await server2.inject({
        method: 'GET',
        url: '/api/logs',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(r.statusCode).toBe(200);

      await server2.close();
    });
  });

  // ── Incremental polling simulation ────────────────────────────

  describe('incremental polling (simulating app.js pollLogs)', () => {
    it('since filter enables incremental log fetching', async () => {
      tmpDir = await createTmpDir();
      const logAgg = new TestLogAggregator(path.join(tmpDir, 'logs'));
      server = await createLogServer({ tmpDir, logAggregator: logAgg });

      const base = Date.now();

      // First batch of logs
      logAgg.logWithTimestamp('p', 'info', 'batch-1-a', base);
      logAgg.logWithTimestamp('p', 'info', 'batch-1-b', base + 1);

      // First poll (no since)
      const poll1 = await getLogs(server);
      expect(poll1.logs).toHaveLength(2);

      // Track highest timestamp
      const maxTs = Math.max(...poll1.logs.map((l: any) => l.timestamp));

      // Second batch of logs
      logAgg.logWithTimestamp('p', 'info', 'batch-2-a', base + 100);
      logAgg.logWithTimestamp('p', 'info', 'batch-2-b', base + 101);

      // Second poll (since = maxTs + 1)
      const poll2 = await getLogs(server, `?since=${maxTs + 1}`);
      expect(poll2.logs).toHaveLength(2);
      expect(poll2.logs.every((l: any) => l.message.startsWith('batch-2'))).toBe(true);
    });
  });

  // ── Concurrent plugin streams ─────────────────────────────────

  describe('concurrent plugin streams', () => {
    it('interleaves logs from multiple plugins correctly', async () => {
      tmpDir = await createTmpDir();
      const logAgg = new TestLogAggregator(path.join(tmpDir, 'logs'));
      server = await createLogServer({ tmpDir, logAggregator: logAgg });

      const base = Date.now();
      // Interleave logs from 3 plugins
      logAgg.logWithTimestamp('alpha', 'info', 'alpha-1', base);
      logAgg.logWithTimestamp('beta', 'info', 'beta-1', base + 1);
      logAgg.logWithTimestamp('gamma', 'info', 'gamma-1', base + 2);
      logAgg.logWithTimestamp('alpha', 'warn', 'alpha-2', base + 3);
      logAgg.logWithTimestamp('beta', 'error', 'beta-2', base + 4);

      const body = await getLogs(server);
      expect(body.logs).toHaveLength(5);
      // Should be sorted by timestamp descending
      expect(body.logs[0].message).toBe('beta-2');
      expect(body.logs[4].message).toBe('alpha-1');
    });
  });

  // ── Log entry data integrity ──────────────────────────────────

  describe('log entry data integrity', () => {
    it('preserves special characters in messages', async () => {
      tmpDir = await createTmpDir();
      const logAgg = new TestLogAggregator(path.join(tmpDir, 'logs'));
      server = await createLogServer({ tmpDir, logAggregator: logAgg });

      logAgg.log('p', 'info', 'Message with "quotes" and <html> and & symbols');

      const body = await getLogs(server);
      expect(body.logs[0].message).toBe('Message with "quotes" and <html> and & symbols');
    });

    it('preserves unicode in plugin names and messages', async () => {
      tmpDir = await createTmpDir();
      const logAgg = new TestLogAggregator(path.join(tmpDir, 'logs'));
      server = await createLogServer({ tmpDir, logAggregator: logAgg });

      logAgg.log('test-plugin', 'info', 'Unicode: \u2603 \u2764 \u2728');

      const body = await getLogs(server);
      expect(body.logs[0].message).toContain('\u2603');
    });
  });
});
