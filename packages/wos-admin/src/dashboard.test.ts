/**
 * Dashboard Tests
 *
 * Story 7.4: Plugin Status Dashboard
 *
 * Tests for server status dashboard that provides
 * aggregated health information for the web admin UI.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Dashboard, DashboardOptions, DashboardData } from './dashboard.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('Dashboard', () => {
  let tmpDir: string;
  let dashboard: Dashboard;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-dashboard-test-'));
  });

  afterEach(async () => {
    if (dashboard) {
      dashboard.stop();
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('initialization', () => {
    it('should create dashboard with default options', () => {
      dashboard = new Dashboard({ serverDir: tmpDir });
      expect(dashboard).toBeDefined();
    });

    it('should accept custom refresh interval', () => {
      dashboard = new Dashboard({ serverDir: tmpDir, refreshInterval: 5000 });
      expect(dashboard).toBeDefined();
    });
  });

  describe('server status', () => {
    it('should return stopped when no PID file exists', async () => {
      dashboard = new Dashboard({ serverDir: tmpDir });
      const data = await dashboard.getData();

      expect(data.server.status).toBe('stopped');
      expect(data.server.pid).toBeUndefined();
    });

    it('should return stopped when PID file has stale PID', async () => {
      // Write a PID that doesn't exist (very high number)
      await fs.writeFile(
        path.join(tmpDir, '.wos.pid'),
        JSON.stringify({ pid: 999999999, startTime: Date.now() - 60000 })
      );

      dashboard = new Dashboard({ serverDir: tmpDir });
      const data = await dashboard.getData();

      expect(data.server.status).toBe('stopped');
    });

    it('should calculate uptime when server is running', async () => {
      // Write PID file with current process PID (which is running)
      const startTime = Date.now() - 60000; // Started 60 seconds ago
      await fs.writeFile(
        path.join(tmpDir, '.wos.pid'),
        JSON.stringify({ pid: process.pid, startTime })
      );

      dashboard = new Dashboard({ serverDir: tmpDir });
      const data = await dashboard.getData();

      expect(data.server.status).toBe('running');
      expect(data.server.pid).toBe(process.pid);
      expect(data.server.uptime).toBeGreaterThanOrEqual(60000);
      expect(data.server.startedAt).toBe(new Date(startTime).toISOString());
    });
  });

  describe('plugin summary', () => {
    it('should return zero counts when no plugins exist', async () => {
      // Create empty wos.yaml
      await fs.writeFile(path.join(tmpDir, 'wos.yaml'), 'server:\n  port: 8080\n');

      dashboard = new Dashboard({ serverDir: tmpDir });
      const data = await dashboard.getData();

      expect(data.plugins.total).toBe(0);
      expect(data.plugins.running).toBe(0);
      expect(data.plugins.stopped).toBe(0);
      expect(data.plugins.failed).toBe(0);
      expect(data.plugins.disabled).toBe(0);
    });

    it('should count enabled plugins as stopped when server is stopped', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'wos.yaml'),
        `plugins:
  plugin-a:
    enabled: true
    version: "1.0.0"
  plugin-b:
    enabled: true
    version: "1.0.0"
  plugin-c:
    enabled: false
    version: "1.0.0"
`
      );

      dashboard = new Dashboard({ serverDir: tmpDir });
      const data = await dashboard.getData();

      expect(data.plugins.total).toBe(3);
      expect(data.plugins.running).toBe(0);
      expect(data.plugins.stopped).toBe(2);
      expect(data.plugins.disabled).toBe(1);
    });

    it('should count enabled plugins as running when server is running', async () => {
      await fs.writeFile(
        path.join(tmpDir, '.wos.pid'),
        JSON.stringify({ pid: process.pid, startTime: Date.now() - 10000 })
      );
      await fs.writeFile(
        path.join(tmpDir, 'wos.yaml'),
        `plugins:
  plugin-a:
    enabled: true
    version: "1.0.0"
  plugin-b:
    enabled: true
    version: "1.0.0"
  plugin-c:
    enabled: false
    version: "1.0.0"
`
      );

      dashboard = new Dashboard({ serverDir: tmpDir });
      const data = await dashboard.getData();

      expect(data.plugins.total).toBe(3);
      expect(data.plugins.running).toBe(2);
      expect(data.plugins.stopped).toBe(0);
      expect(data.plugins.disabled).toBe(1);
    });

    it('should include plugin list with details', async () => {
      await fs.writeFile(
        path.join(tmpDir, '.wos.pid'),
        JSON.stringify({ pid: process.pid, startTime: Date.now() })
      );
      await fs.writeFile(
        path.join(tmpDir, 'wos.yaml'),
        `plugins:
  my-plugin:
    enabled: true
    version: "1.2.3"
    description: "Test plugin"
`
      );

      dashboard = new Dashboard({ serverDir: tmpDir });
      const data = await dashboard.getData();

      expect(data.plugins.list).toBeDefined();
      expect(data.plugins.list).toHaveLength(1);
      expect(data.plugins.list[0]).toEqual({
        name: 'my-plugin',
        version: '1.2.3',
        enabled: true,
        status: 'running',
        description: 'Test plugin',
      });
    });
  });

  describe('configuration', () => {
    it('should include server configuration', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'wos.yaml'),
        `server:
  host: "127.0.0.1"
admin:
  port: 9000
mqtt:
  port: 1884
  embedded: false
`
      );

      dashboard = new Dashboard({ serverDir: tmpDir });
      const data = await dashboard.getData();

      expect(data.config.port).toBe(9000);
      expect(data.config.host).toBe('127.0.0.1');
      expect(data.config.mqttPort).toBe(1884);
      expect(data.config.mqttEmbedded).toBe(false);
    });

    it('should use defaults when config is missing', async () => {
      await fs.writeFile(path.join(tmpDir, 'wos.yaml'), '# empty config\n');

      dashboard = new Dashboard({ serverDir: tmpDir });
      const data = await dashboard.getData();

      expect(data.config.port).toBe(3000);
      expect(data.config.host).toBe('0.0.0.0');
      expect(data.config.mqttPort).toBe(1883);
      expect(data.config.mqttEmbedded).toBe(true);
    });
  });

  describe('timestamps', () => {
    it('should include current timestamp', async () => {
      await fs.writeFile(path.join(tmpDir, 'wos.yaml'), '');

      dashboard = new Dashboard({ serverDir: tmpDir });
      const before = Date.now();
      const data = await dashboard.getData();
      const after = Date.now();

      expect(data.timestamp).toBeGreaterThanOrEqual(before);
      expect(data.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('event emission', () => {
    it('should emit update events when started', async () => {
      await fs.writeFile(path.join(tmpDir, 'wos.yaml'), '');

      dashboard = new Dashboard({ serverDir: tmpDir, refreshInterval: 100 });

      const updates: DashboardData[] = [];
      dashboard.on('update', (data: DashboardData) => {
        updates.push(data);
      });

      dashboard.start();

      // Wait for a couple updates
      await new Promise(resolve => setTimeout(resolve, 250));

      dashboard.stop();

      expect(updates.length).toBeGreaterThanOrEqual(2);
    });

    it('should stop emitting events when stopped', async () => {
      await fs.writeFile(path.join(tmpDir, 'wos.yaml'), '');

      dashboard = new Dashboard({ serverDir: tmpDir, refreshInterval: 50 });

      let updateCount = 0;
      dashboard.on('update', () => {
        updateCount++;
      });

      dashboard.start();
      await new Promise(resolve => setTimeout(resolve, 100));
      const countBeforeStop = updateCount;

      dashboard.stop();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should not have increased significantly after stop
      expect(updateCount).toBe(countBeforeStop);
    });
  });

  describe('error handling', () => {
    it('should handle missing wos.yaml gracefully', async () => {
      dashboard = new Dashboard({ serverDir: tmpDir });
      const data = await dashboard.getData();

      expect(data.server.status).toBe('stopped');
      expect(data.plugins.total).toBe(0);
      expect(data.error).toBeUndefined();
    });

    it('should handle invalid YAML gracefully', async () => {
      await fs.writeFile(path.join(tmpDir, 'wos.yaml'), 'invalid: yaml: content: [');

      dashboard = new Dashboard({ serverDir: tmpDir });
      const data = await dashboard.getData();

      // Should still return valid data structure
      expect(data.server).toBeDefined();
      expect(data.plugins).toBeDefined();
    });
  });

  describe('directory info', () => {
    it('should include server directory in data', async () => {
      await fs.writeFile(path.join(tmpDir, 'wos.yaml'), '');

      dashboard = new Dashboard({ serverDir: tmpDir });
      const data = await dashboard.getData();

      expect(data.directory).toBe(tmpDir);
    });
  });
});
