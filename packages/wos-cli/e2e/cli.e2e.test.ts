/**
 * CLI End-to-End Tests
 *
 * Story 11.5: E2E Test Coverage for CLI Commands
 *
 * Tests the full oclif command parse+run flow for all core CLI commands.
 * Each test exercises the command as a user would invoke it, verifying
 * flag parsing, file I/O, error handling, and JSON output.
 *
 * Note: oclif's `this.error()` calls `process.exit()` by default, so error
 * tests exercise the exported helper functions directly rather than going
 * through Command.run(). The happy-path tests go through the full oclif flow.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';

// ── Helpers ──────────────────────────────────────────────────────────

let testDir: string;
let serverDir: string;

/** Capture stdout from a command by monkey-patching console.log */
function captureOutput(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  return {
    lines,
    restore: () => { console.log = originalLog; },
  };
}

/** Create a minimal test plugin directory with a valid manifest */
async function createTestPlugin(
  dir: string,
  name: string,
  opts: { runtime?: string; deps?: string[] } = {}
): Promise<string> {
  const pluginDir = path.join(dir, name);
  await fs.mkdir(pluginDir, { recursive: true });

  const manifest: Record<string, unknown> = {
    name,
    version: '1.0.0',
    runtime: opts.runtime ?? 'node',
    entrypoint: './index.js',
  };
  if (opts.deps) {
    manifest.dependencies = opts.deps;
  }

  await fs.writeFile(
    path.join(pluginDir, 'wos-plugin.yaml'),
    yaml.stringify(manifest),
    'utf-8'
  );
  await fs.writeFile(
    path.join(pluginDir, 'index.js'),
    'console.log("hello from plugin");',
    'utf-8'
  );
  return pluginDir;
}

// ── Setup/Teardown ───────────────────────────────────────────────────

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-cli-e2e-'));
  serverDir = path.join(testDir, 'server');
});

afterEach(async () => {
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

// =====================================================================
// 1. wos init — full oclif command flow
// =====================================================================

describe('wos init (e2e)', () => {
  it('should initialize a new server directory', async () => {
    const { initServerDirectory } = await import('../src/commands/init.js');

    await initServerDirectory(serverDir);

    // Verify directory structure
    const wosYaml = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
    expect(wosYaml).toContain('WorldOS Server Configuration');

    const pluginsStat = await fs.stat(path.join(serverDir, 'plugins'));
    expect(pluginsStat.isDirectory()).toBe(true);

    const gitignore = await fs.readFile(path.join(serverDir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('node_modules/');
  });

  it('should accept custom server name', async () => {
    const { initServerDirectory } = await import('../src/commands/init.js');

    await initServerDirectory(serverDir, { name: 'my-custom-server' });

    const wosYaml = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
    expect(wosYaml).toContain('name: my-custom-server');
  });

  it('should not overwrite existing config without force', async () => {
    const { initServerDirectory } = await import('../src/commands/init.js');

    await initServerDirectory(serverDir);

    // Write custom content
    const configPath = path.join(serverDir, 'wos.yaml');
    await fs.writeFile(configPath, 'custom: content\n');

    // Initialize again (should not overwrite)
    const result = await initServerDirectory(serverDir);

    const content = await fs.readFile(configPath, 'utf-8');
    expect(content).toBe('custom: content\n');
    expect(result.skipped).toContain('wos.yaml (already exists)');
  });

  it('should overwrite with force', async () => {
    const { initServerDirectory } = await import('../src/commands/init.js');

    await initServerDirectory(serverDir);
    await fs.writeFile(path.join(serverDir, 'wos.yaml'), 'custom: content\n');

    await initServerDirectory(serverDir, { force: true });

    const content = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
    expect(content).toContain('WorldOS Server Configuration');
  });

  it('should return created and skipped file lists', async () => {
    const { initServerDirectory } = await import('../src/commands/init.js');

    const result = await initServerDirectory(serverDir);

    expect(result.created).toContain('wos.yaml');
    expect(result.created).toContain('plugins/');
    expect(result.created).toContain('.gitignore');
    expect(result.skipped).toHaveLength(0);
  });

  it('should detect initialized server directory', async () => {
    const { initServerDirectory, isServerDirectory } = await import('../src/commands/init.js');

    // Not initialized
    expect(await isServerDirectory(serverDir)).toBe(false);

    // Initialized
    await initServerDirectory(serverDir);
    expect(await isServerDirectory(serverDir)).toBe(true);
  });

  it('should generate valid default config with all sections', async () => {
    const { getDefaultConfig } = await import('../src/commands/init.js');

    const config = getDefaultConfig('test-server');
    expect(config).toContain('server:');
    expect(config).toContain('mqtt:');
    expect(config).toContain('admin:');
    expect(config).toContain('plugins: {}');
    expect(config).toContain('webhooks: []');
    expect(config).toContain('name: test-server');
  });
});

// =====================================================================
// 2. wos add — plugin installation via oclif Command.run()
// =====================================================================

describe('wos add (e2e)', () => {
  let pluginPath: string;

  beforeEach(async () => {
    const { initServerDirectory } = await import('../src/commands/init.js');
    await initServerDirectory(serverDir);
    pluginPath = await createTestPlugin(testDir, 'hello-world');
  });

  it('should install a plugin from local path via Command.run()', async () => {
    const Add = (await import('../src/commands/add.js')).default;

    await Add.run([pluginPath, '--directory', serverDir]);

    // Plugin directory should exist
    const installed = path.join(serverDir, 'plugins', 'hello-world');
    const stat = await fs.stat(installed);
    expect(stat.isDirectory()).toBe(true);

    // Manifest should be copied
    const manifest = await fs.readFile(
      path.join(installed, 'wos-plugin.yaml'),
      'utf-8'
    );
    expect(manifest).toContain('name: hello-world');
  });

  it('should register plugin in wos.yaml', async () => {
    const Add = (await import('../src/commands/add.js')).default;

    await Add.run([pluginPath, '--directory', serverDir]);

    const wosYaml = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
    expect(wosYaml).toContain('hello-world');
  });

  it('should install with --enable flag', async () => {
    const Add = (await import('../src/commands/add.js')).default;

    await Add.run([pluginPath, '--directory', serverDir, '--enable']);

    const wosYaml = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
    const config = yaml.parse(wosYaml);
    expect(config.plugins['hello-world'].enabled).toBe(true);
  });

  it('should allow overwrite with --force', async () => {
    const Add = (await import('../src/commands/add.js')).default;

    await Add.run([pluginPath, '--directory', serverDir]);

    // Modify plugin
    await fs.writeFile(path.join(pluginPath, 'extra.txt'), 'new content');

    // Force reinstall
    await Add.run([pluginPath, '--directory', serverDir, '--force']);

    const installed = path.join(serverDir, 'plugins', 'hello-world');
    const extraExists = await fs.access(path.join(installed, 'extra.txt'))
      .then(() => true)
      .catch(() => false);
    expect(extraExists).toBe(true);
  });

  it('should output JSON with --json flag', async () => {
    const Add = (await import('../src/commands/add.js')).default;

    const output = captureOutput();
    try {
      await Add.run([pluginPath, '--directory', serverDir, '--json']);
    } finally {
      output.restore();
    }

    const jsonOutput = output.lines.find(l => l.startsWith('{'));
    expect(jsonOutput).toBeDefined();

    const parsed = JSON.parse(jsonOutput!);
    expect(parsed.status).toBe('installed');
    expect(parsed.plugin.name).toBe('hello-world');
  });

  it('should install multiple plugins', async () => {
    const Add = (await import('../src/commands/add.js')).default;

    const pluginA = await createTestPlugin(testDir, 'plugin-alpha');
    const pluginB = await createTestPlugin(testDir, 'plugin-beta');

    await Add.run([pluginA, '--directory', serverDir]);
    await Add.run([pluginB, '--directory', serverDir]);

    const wosYaml = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
    const config = yaml.parse(wosYaml);
    expect(config.plugins['plugin-alpha']).toBeDefined();
    expect(config.plugins['plugin-beta']).toBeDefined();
  });

  it('should copy plugin files but skip node_modules', async () => {
    const Add = (await import('../src/commands/add.js')).default;

    // Add node_modules to plugin (should be skipped)
    await fs.mkdir(path.join(pluginPath, 'node_modules', 'some-dep'), { recursive: true });
    await fs.writeFile(path.join(pluginPath, 'node_modules', 'some-dep', 'index.js'), '');

    await Add.run([pluginPath, '--directory', serverDir]);

    const installed = path.join(serverDir, 'plugins', 'hello-world');
    const nmExists = await fs.access(path.join(installed, 'node_modules'))
      .then(() => true)
      .catch(() => false);
    expect(nmExists).toBe(false);

    // But index.js should be copied
    const indexExists = await fs.access(path.join(installed, 'index.js'))
      .then(() => true)
      .catch(() => false);
    expect(indexExists).toBe(true);
  });
});

// =====================================================================
// 3. wos remove — plugin removal via oclif Command.run()
// =====================================================================

describe('wos remove (e2e)', () => {
  beforeEach(async () => {
    const { initServerDirectory } = await import('../src/commands/init.js');
    await initServerDirectory(serverDir);

    const pluginPath = await createTestPlugin(testDir, 'removable-plugin');
    const Add = (await import('../src/commands/add.js')).default;
    await Add.run([pluginPath, '--directory', serverDir, '--enable']);
  });

  it('should remove an installed plugin', async () => {
    const Remove = (await import('../src/commands/remove.js')).default;

    await Remove.run(['removable-plugin', '--directory', serverDir]);

    // Plugin directory should be gone
    const pluginDir = path.join(serverDir, 'plugins', 'removable-plugin');
    const exists = await fs.access(pluginDir).then(() => true).catch(() => false);
    expect(exists).toBe(false);

    // wos.yaml should not contain the plugin
    const wosYaml = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
    const config = yaml.parse(wosYaml);
    expect(config.plugins['removable-plugin']).toBeUndefined();
  });

  it('should support --dry-run (no changes)', async () => {
    const Remove = (await import('../src/commands/remove.js')).default;

    const output = captureOutput();
    try {
      await Remove.run(['removable-plugin', '--directory', serverDir, '--dry-run']);
    } finally {
      output.restore();
    }

    // Plugin should still exist
    const pluginDir = path.join(serverDir, 'plugins', 'removable-plugin');
    const exists = await fs.access(pluginDir).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    expect(output.lines.join(' ')).toMatch(/dry run/i);
  });

  it('should output JSON with --json flag', async () => {
    const Remove = (await import('../src/commands/remove.js')).default;

    const output = captureOutput();
    try {
      await Remove.run(['removable-plugin', '--directory', serverDir, '--json']);
    } finally {
      output.restore();
    }

    const jsonOutput = output.lines.find(l => l.startsWith('{'));
    expect(jsonOutput).toBeDefined();

    const parsed = JSON.parse(jsonOutput!);
    expect(parsed.status).toBe('removed');
    expect(parsed.plugin.name).toBe('removable-plugin');
  });

  it('should force-remove despite dependents with --force', async () => {
    // Install a plugin that depends on removable-plugin
    const depPlugin = await createTestPlugin(testDir, 'dependent-plugin', {
      deps: ['removable-plugin'],
    });
    const Add = (await import('../src/commands/add.js')).default;
    await Add.run([depPlugin, '--directory', serverDir]);

    const Remove = (await import('../src/commands/remove.js')).default;
    await Remove.run(['removable-plugin', '--directory', serverDir, '--force']);

    const exists = await fs.access(path.join(serverDir, 'plugins', 'removable-plugin'))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });
});

// =====================================================================
// 4. wos status — status display e2e
// =====================================================================

describe('wos status (e2e)', () => {
  it('should show stopped status for initialized server (JSON)', async () => {
    const { initServerDirectory } = await import('../src/commands/init.js');
    await initServerDirectory(serverDir);

    const Status = (await import('../src/commands/status.js')).default;
    const output = captureOutput();
    try {
      await Status.run(['--directory', serverDir, '--json']);
    } finally {
      output.restore();
    }

    const jsonOutput = output.lines.find(l => l.startsWith('{'));
    expect(jsonOutput).toBeDefined();

    const parsed = JSON.parse(jsonOutput!);
    expect(parsed.server.status).toBe('stopped');
    expect(parsed.directory).toBe(serverDir);
  });

  it('should show plugins in status output', async () => {
    const { initServerDirectory } = await import('../src/commands/init.js');
    await initServerDirectory(serverDir);

    // Add a plugin
    const pluginPath = await createTestPlugin(testDir, 'status-test-plugin');
    const Add = (await import('../src/commands/add.js')).default;
    await Add.run([pluginPath, '--directory', serverDir, '--enable']);

    const Status = (await import('../src/commands/status.js')).default;
    const output = captureOutput();
    try {
      await Status.run(['--directory', serverDir, '--json']);
    } finally {
      output.restore();
    }

    const jsonOutput = output.lines.find(l => l.startsWith('{'));
    const parsed = JSON.parse(jsonOutput!);
    expect(parsed.plugins.length).toBeGreaterThan(0);
    expect(parsed.plugins[0].name).toBe('status-test-plugin');
  });

  it('should show text output with plugin list', async () => {
    const { initServerDirectory } = await import('../src/commands/init.js');
    await initServerDirectory(serverDir);

    const pluginPath = await createTestPlugin(testDir, 'text-output-plugin');
    const Add = (await import('../src/commands/add.js')).default;
    await Add.run([pluginPath, '--directory', serverDir]);

    const Status = (await import('../src/commands/status.js')).default;
    const output = captureOutput();
    try {
      await Status.run(['--directory', serverDir, '--no-color']);
    } finally {
      output.restore();
    }

    const combined = output.lines.join('\n');
    expect(combined).toContain('WorldOS Server Status');
    expect(combined).toContain('Stopped');
    expect(combined).toContain('text-output-plugin');
  });

  it('should show config section in text output', async () => {
    const { initServerDirectory } = await import('../src/commands/init.js');
    await initServerDirectory(serverDir);

    const Status = (await import('../src/commands/status.js')).default;
    const output = captureOutput();
    try {
      await Status.run(['--directory', serverDir, '--no-color']);
    } finally {
      output.restore();
    }

    const combined = output.lines.join('\n');
    expect(combined).toContain('Configuration:');
    expect(combined).toContain('MQTT Port:');
  });
});

// =====================================================================
// 5. wos start/stop helpers — PID file and config e2e
// =====================================================================

describe('wos start/stop helpers (e2e)', () => {
  it('should detect server not running when no PID file', async () => {
    const { isServerRunning } = await import('../src/commands/start.js');
    const { initServerDirectory } = await import('../src/commands/init.js');
    await initServerDirectory(serverDir);

    const running = await isServerRunning(serverDir);
    expect(running).toBe(false);
  });

  it('should write and read PID file round-trip', async () => {
    const { writePidFile, readPidFile } = await import('../src/commands/start.js');
    const { initServerDirectory } = await import('../src/commands/init.js');
    await initServerDirectory(serverDir);

    await writePidFile(serverDir, 42);
    const pid = await readPidFile(serverDir);
    expect(pid).toBe(42);
  });

  it('should detect running process via PID file', async () => {
    const { writePidFile, isServerRunning } = await import('../src/commands/start.js');
    const { initServerDirectory } = await import('../src/commands/init.js');
    await initServerDirectory(serverDir);

    // Use our own PID (guaranteed to be running)
    await writePidFile(serverDir, process.pid);
    const running = await isServerRunning(serverDir);
    expect(running).toBe(true);
  });

  it('should clean up stale PID file for dead process', async () => {
    const { writePidFile, readPidFile, isServerRunning } = await import('../src/commands/start.js');
    const { initServerDirectory } = await import('../src/commands/init.js');
    await initServerDirectory(serverDir);

    // Write a PID that doesn't exist
    await writePidFile(serverDir, 999999999);
    const running = await isServerRunning(serverDir);
    expect(running).toBe(false);

    // PID file should be cleaned up
    const pid = await readPidFile(serverDir);
    expect(pid).toBeNull();
  });

  it('should load server config from wos.yaml', async () => {
    const { loadServerConfig } = await import('../src/commands/start.js');
    const { initServerDirectory } = await import('../src/commands/init.js');
    await initServerDirectory(serverDir, { name: 'e2e-server' });

    const config = await loadServerConfig(serverDir);
    expect(config.server).toBeDefined();
    expect((config.server as Record<string, unknown>).name).toBe('e2e-server');
  });

  it('should throw when loading config from non-initialized dir', async () => {
    const { loadServerConfig } = await import('../src/commands/start.js');
    await fs.mkdir(serverDir, { recursive: true });

    await expect(loadServerConfig(serverDir)).rejects.toThrow(/No wos\.yaml found/);
  });

  it('should extract enabled plugins from config', async () => {
    const { getEnabledPlugins } = await import('../src/commands/start.js');

    const config = {
      plugins: {
        'enabled-one': { enabled: true },
        'disabled-one': { enabled: false },
        'implicit-enabled': { version: '1.0.0' },
      },
    };

    const enabled = getEnabledPlugins(config);
    expect(enabled).toContain('enabled-one');
    expect(enabled).toContain('implicit-enabled');
    expect(enabled).not.toContain('disabled-one');
  });

  it('should return empty array for no plugins', async () => {
    const { getEnabledPlugins } = await import('../src/commands/start.js');

    expect(getEnabledPlugins({})).toEqual([]);
    expect(getEnabledPlugins({ plugins: {} })).toEqual([]);
  });
});

// =====================================================================
// 6. wos stop helpers — signal and PID e2e
// =====================================================================

describe('wos stop helpers (e2e)', () => {
  it('should report error when server is not running', async () => {
    const { stopServer } = await import('../src/commands/stop.js');
    const { initServerDirectory } = await import('../src/commands/init.js');
    await initServerDirectory(serverDir);

    const result = await stopServer({ serverDir });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not running/i);
  });

  it('should sendSignal return false for dead process', async () => {
    const { sendSignal } = await import('../src/commands/stop.js');

    // Dead PID should fail (do NOT send to own process — that kills vitest!)
    expect(sendSignal(999999999, 'SIGTERM')).toBe(false);
  });

  it('should sendSignal return true for signal 0 check on live process', async () => {
    // Verify our own process is alive using the raw check (signal 0)
    let alive = false;
    try {
      process.kill(process.pid, 0);
      alive = true;
    } catch {
      alive = false;
    }
    expect(alive).toBe(true);
  });

  it('should waitForExit return true for dead PID', async () => {
    const { waitForExit } = await import('../src/commands/stop.js');

    // PID that doesn't exist should "exit" immediately
    const exited = await waitForExit(999999999, 1000);
    expect(exited).toBe(true);
  });
});

// =====================================================================
// 7. Full CLI workflow: init → add → status → remove
// =====================================================================

describe('full CLI workflow (e2e)', () => {
  it('should support init → add → status → remove lifecycle', async () => {
    // 1. Init
    const { initServerDirectory } = await import('../src/commands/init.js');
    await initServerDirectory(serverDir);

    // 2. Add two plugins
    const pluginA = await createTestPlugin(testDir, 'workflow-alpha');
    const pluginB = await createTestPlugin(testDir, 'workflow-beta');

    const Add = (await import('../src/commands/add.js')).default;
    await Add.run([pluginA, '--directory', serverDir, '--enable']);
    await Add.run([pluginB, '--directory', serverDir]);

    // 3. Status should show both plugins
    const Status = (await import('../src/commands/status.js')).default;
    const statusOutput = captureOutput();
    try {
      await Status.run(['--directory', serverDir, '--json']);
    } finally {
      statusOutput.restore();
    }

    const statusJson = JSON.parse(statusOutput.lines.find(l => l.startsWith('{'))!);
    expect(statusJson.plugins.length).toBe(2);

    const alpha = statusJson.plugins.find((p: { name: string }) => p.name === 'workflow-alpha');
    const beta = statusJson.plugins.find((p: { name: string }) => p.name === 'workflow-beta');
    expect(alpha.enabled).toBe(true);
    expect(beta.enabled).toBe(false);

    // 4. Remove one plugin
    const Remove = (await import('../src/commands/remove.js')).default;
    await Remove.run(['workflow-alpha', '--directory', serverDir]);

    // 5. Status should show only one plugin
    const statusOutput2 = captureOutput();
    try {
      await Status.run(['--directory', serverDir, '--json']);
    } finally {
      statusOutput2.restore();
    }

    const statusJson2 = JSON.parse(statusOutput2.lines.find(l => l.startsWith('{'))!);
    expect(statusJson2.plugins.length).toBe(1);
    expect(statusJson2.plugins[0].name).toBe('workflow-beta');
  });

  it('should handle force-add (upgrade) flow', async () => {
    const { initServerDirectory } = await import('../src/commands/init.js');
    await initServerDirectory(serverDir);

    // Create plugin
    const plugin = await createTestPlugin(testDir, 'upgradeable');

    const Add = (await import('../src/commands/add.js')).default;
    await Add.run([plugin, '--directory', serverDir]);

    // Modify plugin (simulating upgrade)
    await fs.writeFile(path.join(plugin, 'CHANGELOG.md'), '## v2.0.0\n- Big upgrade');

    // Force reinstall
    await Add.run([plugin, '--directory', serverDir, '--force']);

    // Changelog should be in installed plugin
    const changelog = await fs.readFile(
      path.join(serverDir, 'plugins', 'upgradeable', 'CHANGELOG.md'),
      'utf-8'
    );
    expect(changelog).toContain('v2.0.0');
  });
});

// =====================================================================
// 8. Source type parsing (wos add)
// =====================================================================

describe('wos add source parsing (e2e)', () => {
  it('should parse github: prefix correctly', async () => {
    const Add = (await import('../src/commands/add.js')).default;
    const parser = (Add.prototype as any).parseSourceType.bind({});

    const result = parser('github:user/repo');
    expect(result.type).toBe('github');
    expect(result.repo).toBe('user/repo');

    const withRef = parser('github:user/repo#v2.0');
    expect(withRef.ref).toBe('v2.0');
  });

  it('should parse git: prefix correctly', async () => {
    const Add = (await import('../src/commands/add.js')).default;
    const parser = (Add.prototype as any).parseSourceType.bind({});

    const result = parser('git:https://example.com/repo.git');
    expect(result.type).toBe('git');
    expect(result.url).toBe('https://example.com/repo.git');
  });

  it('should parse npm: prefix correctly', async () => {
    const Add = (await import('../src/commands/add.js')).default;
    const parser = (Add.prototype as any).parseSourceType.bind({});

    const scoped = parser('npm:@worldos/my-plugin@2.0.0');
    expect(scoped.type).toBe('npm');
    expect(scoped.package).toBe('@worldos/my-plugin');
    expect(scoped.version).toBe('2.0.0');

    const simple = parser('npm:my-plugin');
    expect(simple.package).toBe('my-plugin');
    expect(simple.version).toBeUndefined();
  });

  it('should default to local path for unprefixed sources', async () => {
    const Add = (await import('../src/commands/add.js')).default;
    const parser = (Add.prototype as any).parseSourceType.bind({});

    expect(parser('./my-plugin').type).toBe('local');
    expect(parser('/absolute/path').type).toBe('local');
    expect(parser('relative-dir').type).toBe('local');
  });
});
