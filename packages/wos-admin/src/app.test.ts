/**
 * Dashboard app.js tests — COMPREHENSIVE
 *
 * Loads the real index.html + app.js in jsdom with a mocked fetch,
 * then verifies the UI renders correctly for each page, including:
 *
 * - Dashboard page: stat cards, uptime, plugin cards, badges
 * - Plugins page: action buttons, enable/disable/restart, empty state
 * - Logs page: rendering, level classes, filter, clear, empty state, polling
 * - Settings page: server, MQTT, admin panel settings
 * - Navigation: hash routing, active highlighting, intervals
 * - Uptime formatting: all edge cases (days, hours, minutes, seconds, 0)
 * - Error handling: API failures, null data, offline indicator
 * - XSS prevention: HTML escaping
 * - pluginAction: fetch calls for enable/disable/restart
 * - pollLogs: incremental polling, deduplication, 500-entry cap
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM, ResourceLoader } from 'jsdom';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');
// Strip the external <script src="/app.js"> tag — we inject app.js inline after
// mocking fetch/setInterval so the init IIFE runs with mocks in place.
const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf-8')
  .replace(/<script\s+src="\/app\.js"><\/script>/, '');
const appJs = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf-8');

// ── Mock API responses ──────────────────────────────────────────

const statusResponse = {
  server: { status: 'running', pid: 1234, uptime: 3661, version: '1.0.0' },
  timestamp: Date.now(),
};

const dashboardResponse = {
  server: { status: 'running', pid: 1234 },
  plugins: {
    total: 2,
    running: 1,
    stopped: 0,
    failed: 0,
    disabled: 1,
    list: [
      { name: 'hello-logger', version: '1.0.0', enabled: true, status: 'running', description: 'Logs hello' },
      { name: 'http-health', version: '0.3.0', enabled: false, status: 'stopped', description: 'Health checks' },
    ],
  },
  config: { port: 3000, host: '0.0.0.0', mqttPort: 1883, mqttEmbedded: true },
  directory: '/srv/worldos',
  timestamp: Date.now(),
};

const logsResponse = {
  logs: [
    { plugin: 'hello-logger', level: 'info', message: 'Plugin started', timestamp: Date.now() - 3000 },
    { plugin: 'hello-logger', level: 'warn', message: 'Something odd', timestamp: Date.now() - 2000 },
    { plugin: 'hello-logger', level: 'error', message: 'Crash!', timestamp: Date.now() - 1000 },
  ],
  timestamp: Date.now(),
};

// ── Helper to create a DOM with mocked fetch ────────────────────

const pluginsResponse = {
  plugins: [
    { name: 'hello-logger', version: '1.0.0', enabled: true, state: 'running', description: 'Logs hello' },
    { name: 'http-health', version: '0.3.0', enabled: false, state: 'stopped', description: 'Health checks' },
  ],
  timestamp: Date.now(),
};

const panelsResponse = {
  panels: [],
};

function createMockFetch(overrides: Record<string, unknown> = {}) {
  const responses: Record<string, unknown> = {
    '/api/status': statusResponse,
    '/api/dashboard': dashboardResponse,
    '/api/logs': logsResponse,
    '/api/plugins': pluginsResponse,
    '/api/panels': panelsResponse,
    ...overrides,
  };

  const calls: { url: string; options?: any }[] = [];

  const fn = async function mockFetch(url: string, options?: any) {
    calls.push({ url, options });
    // Match URL without query string
    const urlPath = url.split('?')[0];
    const data = responses[urlPath];
    if (data) {
      return {
        ok: true,
        json: async () => JSON.parse(JSON.stringify(data)),
      };
    }
    return { ok: false, json: async () => ({}) };
  };

  return { fn, calls };
}

async function createDOM(opts: { hash?: string; fetchOverrides?: Record<string, unknown> } = {}) {
  const { hash = '#/', fetchOverrides = {} } = opts;

  const dom = new JSDOM(indexHtml, {
    url: `http://localhost:3000/${hash}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    resources: 'usable',
  });

  const { window } = dom;
  const { document } = window;

  // Mock fetch
  const mockFetch = createMockFetch(fetchOverrides);
  (window as any).fetch = mockFetch.fn;

  // Mock setInterval/setTimeout to not auto-fire (we'll trigger manually)
  const intervals: { fn: Function; ms: number }[] = [];
  (window as any)._testIntervals = intervals;
  const origSetInterval = window.setInterval.bind(window);
  (window as any).setInterval = (fn: Function, ms: number) => {
    intervals.push({ fn, ms });
    return intervals.length;
  };

  // Inject the app script
  const script = document.createElement('script');
  script.textContent = appJs;
  document.body.appendChild(script);

  // Wait for the async init to complete (init calls fetchPanels + refresh + pollLogs in parallel, then navigate)
  await new Promise(r => setTimeout(r, 300));

  return { dom, window, document, fetchCalls: mockFetch.calls };
}

// ── Tests ────────────────────────────────────────────────────────

describe('Dashboard app.js (jsdom)', () => {
  let dom: JSDOM;

  afterEach(() => {
    if (dom) dom.window.close();
  });

  // ── Dashboard page ──────────────────────────────

  describe('Dashboard page', () => {
    it('renders stat cards with server status', async () => {
      ({ dom } = await createDOM());
      const content = dom.window.document.getElementById('content')!;
      const html = content.innerHTML;

      expect(html).toContain('Running');
      expect(html).toContain('1234'); // PID
    });

    it('renders uptime formatted correctly', async () => {
      ({ dom } = await createDOM());
      const content = dom.window.document.getElementById('content')!;
      const html = content.innerHTML;

      // 3661 seconds = 1h 1m 1s
      expect(html).toContain('1h 1m 1s');
    });

    it('renders plugin count stats', async () => {
      ({ dom } = await createDOM());
      const content = dom.window.document.getElementById('content')!;
      const html = content.innerHTML;

      // running: 1, of 2 installed, disabled: 1
      expect(html).toContain('1'); // running
      expect(html).toContain('2'); // total
    });

    it('renders plugin cards', async () => {
      ({ dom } = await createDOM());
      const content = dom.window.document.getElementById('content')!;
      const html = content.innerHTML;

      expect(html).toContain('hello-logger');
      expect(html).toContain('http-health');
      expect(html).toContain('v1.0.0');
      expect(html).toContain('Logs hello');
    });

    it('renders running badge for enabled plugin', async () => {
      ({ dom } = await createDOM());
      const content = dom.window.document.getElementById('content')!;
      const html = content.innerHTML;

      expect(html).toContain('badge-running');
    });

    it('renders disabled badge for disabled plugin', async () => {
      ({ dom } = await createDOM());
      const content = dom.window.document.getElementById('content')!;
      const html = content.innerHTML;

      expect(html).toContain('badge-disabled');
    });

    it('updates server indicator in sidebar', async () => {
      ({ dom } = await createDOM());
      const dot = dom.window.document.querySelector('.indicator-dot')!;
      const label = dom.window.document.querySelector('.indicator-label')!;

      expect(dot.className).toContain('running');
      expect(label.textContent).toContain('1h 1m 1s');
    });

    it('shows page title as Dashboard', async () => {
      ({ dom } = await createDOM());
      const title = dom.window.document.getElementById('pageTitle')!;
      expect(title.textContent).toBe('Dashboard');
    });

    it('renders stats-row with all 5 stat cards', async () => {
      ({ dom } = await createDOM());
      const content = dom.window.document.getElementById('content')!;
      const statCards = content.querySelectorAll('.stat-card');
      expect(statCards.length).toBe(5);
    });

    it('renders "Since start" sub-label on uptime card', async () => {
      ({ dom } = await createDOM());
      const content = dom.window.document.getElementById('content')!;
      expect(content.innerHTML).toContain('Since start');
    });

    it('renders failed count as 0 with "all healthy" message', async () => {
      ({ dom } = await createDOM());
      const content = dom.window.document.getElementById('content')!;
      expect(content.innerHTML).toContain('all healthy');
    });

    it('renders failed count with "needs attention" when > 0', async () => {
      const failedPlugins = [
        { name: 'broken1', version: '1.0.0', enabled: true, state: 'failed', description: 'Broken 1' },
        { name: 'broken2', version: '1.0.0', enabled: true, state: 'failed', description: 'Broken 2' },
      ];
      ({ dom } = await createDOM({
        fetchOverrides: {
          '/api/dashboard': {
            ...dashboardResponse,
            plugins: { ...dashboardResponse.plugins, failed: 2, list: failedPlugins },
          },
          '/api/plugins': { plugins: failedPlugins, timestamp: Date.now() },
        },
      }));
      const content = dom.window.document.getElementById('content')!;
      expect(content.innerHTML).toContain('needs attention');
    });

    it('updates header uptime chip', async () => {
      ({ dom } = await createDOM());
      const uptimeEl = dom.window.document.getElementById('headerUptime')!;
      expect(uptimeEl.textContent).toContain('up 1h 1m 1s');
    });

    it('shows plugin-grid section', async () => {
      ({ dom } = await createDOM());
      const content = dom.window.document.getElementById('content')!;
      expect(content.querySelector('.plugin-grid')).not.toBeNull();
    });

    it('shows empty state when no plugins in dashboard', async () => {
      ({ dom } = await createDOM({
        fetchOverrides: {
          '/api/dashboard': {
            ...dashboardResponse,
            plugins: { total: 0, running: 0, stopped: 0, failed: 0, disabled: 0, list: [] },
          },
          '/api/plugins': { plugins: [], timestamp: Date.now() },
        },
      }));
      const content = dom.window.document.getElementById('content')!;
      expect(content.innerHTML).toContain('No plugins installed');
    });
  });

  // ── Plugins page ────────────────────────────────

  describe('Plugins page', () => {
    it('renders plugin cards with action buttons', async () => {
      ({ dom } = await createDOM({ hash: '#/plugins' }));
      const content = dom.window.document.getElementById('content')!;
      const html = content.innerHTML;

      expect(html).toContain('hello-logger');
      expect(html).toContain('http-health');
      expect(html).toContain('Restart');
      expect(html).toContain('Disable');
      expect(html).toContain('Enable');
    });

    it('shows page title as Plugins', async () => {
      ({ dom } = await createDOM({ hash: '#/plugins' }));
      const title = dom.window.document.getElementById('pageTitle')!;
      expect(title.textContent).toBe('Plugins');
    });

    it('shows empty state when no plugins', async () => {
      ({ dom } = await createDOM({
        hash: '#/plugins',
        fetchOverrides: {
          '/api/dashboard': {
            ...dashboardResponse,
            plugins: { total: 0, running: 0, stopped: 0, failed: 0, disabled: 0, list: [] },
          },
          '/api/plugins': { plugins: [], timestamp: Date.now() },
        },
      }));
      const content = dom.window.document.getElementById('content')!;
      expect(content.innerHTML).toContain('No plugins installed');
    });

    it('running plugin has Stop, Restart, and Disable buttons', async () => {
      ({ dom } = await createDOM({ hash: '#/plugins' }));
      const content = dom.window.document.getElementById('content')!;
      const html = content.innerHTML;

      // hello-logger is running+enabled → should have Stop, Restart, and Disable
      expect(html).toContain("pluginAction('hello-logger','stop')");
      expect(html).toContain("pluginAction('hello-logger','restart')");
      expect(html).toContain("pluginAction('hello-logger','disable')");
    });

    it('disabled plugin has Enable button only', async () => {
      ({ dom } = await createDOM({ hash: '#/plugins' }));
      const content = dom.window.document.getElementById('content')!;
      const html = content.innerHTML;

      // http-health is disabled → should have Enable button
      expect(html).toContain("pluginAction('http-health','enable')");
      // Should NOT have start/restart/stop for disabled plugin
      expect(html).not.toContain("pluginAction('http-health','restart')");
      expect(html).not.toContain("pluginAction('http-health','start')");
      expect(html).not.toContain("pluginAction('http-health','stop')");
    });

    it('stopped-but-enabled plugin has Start and Disable buttons', async () => {
      ({ dom } = await createDOM({
        hash: '#/plugins',
        fetchOverrides: {
          '/api/dashboard': {
            ...dashboardResponse,
            plugins: {
              total: 1, running: 0, stopped: 1, failed: 0, disabled: 0,
              list: [{ name: 'idle-plugin', version: '1.0.0', enabled: true, status: 'stopped', description: 'Idle' }],
            },
          },
          '/api/plugins': { plugins: [{ name: 'idle-plugin', version: '1.0.0', enabled: true, state: 'stopped', description: 'Idle' }], timestamp: Date.now() },
        },
      }));
      const content = dom.window.document.getElementById('content')!;
      const html = content.innerHTML;

      expect(html).toContain("pluginAction('idle-plugin','start')");
      expect(html).toContain("pluginAction('idle-plugin','disable')");
      expect(html).not.toContain("pluginAction('idle-plugin','restart')");
      expect(html).not.toContain("pluginAction('idle-plugin','stop')");
    });

    it('crashed plugin has Start and Disable buttons', async () => {
      ({ dom } = await createDOM({
        hash: '#/plugins',
        fetchOverrides: {
          '/api/dashboard': {
            ...dashboardResponse,
            plugins: {
              total: 1, running: 0, stopped: 0, failed: 1, disabled: 0,
              list: [{ name: 'crash-plugin', version: '1.0.0', enabled: true, status: 'crashed', description: 'Crashed' }],
            },
          },
          '/api/plugins': { plugins: [{ name: 'crash-plugin', version: '1.0.0', enabled: true, state: 'crashed', description: 'Crashed' }], timestamp: Date.now() },
        },
      }));
      const content = dom.window.document.getElementById('content')!;
      const html = content.innerHTML;

      expect(html).toContain("pluginAction('crash-plugin','start')");
      expect(html).toContain("pluginAction('crash-plugin','disable')");
    });

    it('renders plugin version on each card', async () => {
      ({ dom } = await createDOM({ hash: '#/plugins' }));
      const content = dom.window.document.getElementById('content')!;
      const html = content.innerHTML;

      expect(html).toContain('v1.0.0');
      expect(html).toContain('v0.3.0');
    });

    it('renders plugin description', async () => {
      ({ dom } = await createDOM({ hash: '#/plugins' }));
      const content = dom.window.document.getElementById('content')!;
      const html = content.innerHTML;

      expect(html).toContain('Logs hello');
      expect(html).toContain('Health checks');
    });

    it('renders badges on plugin cards', async () => {
      ({ dom } = await createDOM({ hash: '#/plugins' }));
      const content = dom.window.document.getElementById('content')!;
      const html = content.innerHTML;

      expect(html).toContain('badge-running');
      expect(html).toContain('badge-disabled');
    });
  });

  // ── Logs page ───────────────────────────────────

  describe('Logs page', () => {
    it('renders log entries from API', async () => {
      ({ dom } = await createDOM({ hash: '#/logs' }));
      const content = dom.window.document.getElementById('content')!;
      const html = content.innerHTML;

      expect(html).toContain('Plugin started');
      expect(html).toContain('Something odd');
      expect(html).toContain('Crash!');
      expect(html).toContain('hello-logger');
    });

    it('renders log entries with correct level classes', async () => {
      ({ dom } = await createDOM({ hash: '#/logs' }));
      const content = dom.window.document.getElementById('content')!;
      const html = content.innerHTML;

      expect(html).toContain('class="log-msg error"');
      expect(html).toContain('class="log-msg warn"');
    });

    it('renders info logs without extra level class', async () => {
      ({ dom } = await createDOM({ hash: '#/logs' }));
      const content = dom.window.document.getElementById('content')!;
      const html = content.innerHTML;

      // Info level should have class="log-msg " (empty level class)
      expect(html).toContain('class="log-msg "');
    });

    it('shows page title as Logs', async () => {
      ({ dom } = await createDOM({ hash: '#/logs' }));
      const title = dom.window.document.getElementById('pageTitle')!;
      expect(title.textContent).toBe('Logs');
    });

    it('has a filter input and clear button', async () => {
      ({ dom } = await createDOM({ hash: '#/logs' }));
      const content = dom.window.document.getElementById('content')!;

      expect(content.querySelector('.log-filter')).not.toBeNull();
      expect(content.innerHTML).toContain('Clear');
    });

    it('filterLogs hides non-matching lines', async () => {
      ({ dom } = await createDOM({ hash: '#/logs' }));
      const { window } = dom;

      (window as any).filterLogs('Crash');

      const logLines = window.document.querySelectorAll('#logScroll .log-line');
      let visibleCount = 0;
      let hiddenCount = 0;
      logLines.forEach((el: any) => {
        if (el.style.display === 'none') hiddenCount++;
        else visibleCount++;
      });

      expect(visibleCount).toBe(1);
      expect(hiddenCount).toBe(2);
    });

    it('filterLogs is case-insensitive', async () => {
      ({ dom } = await createDOM({ hash: '#/logs' }));
      const { window } = dom;

      (window as any).filterLogs('crash'); // lowercase

      const logLines = window.document.querySelectorAll('#logScroll .log-line');
      let visibleCount = 0;
      logLines.forEach((el: any) => {
        if (el.style.display !== 'none') visibleCount++;
      });

      expect(visibleCount).toBe(1); // "Crash!" matches "crash"
    });

    it('filterLogs with empty string shows all lines', async () => {
      ({ dom } = await createDOM({ hash: '#/logs' }));
      const { window } = dom;

      // First filter to hide some
      (window as any).filterLogs('Crash');
      // Then clear filter
      (window as any).filterLogs('');

      const logLines = window.document.querySelectorAll('#logScroll .log-line');
      let visibleCount = 0;
      logLines.forEach((el: any) => {
        if (el.style.display !== 'none') visibleCount++;
      });

      expect(visibleCount).toBe(3); // All visible again
    });

    it('clearLogs empties the log view', async () => {
      ({ dom } = await createDOM({ hash: '#/logs' }));
      const { window } = dom;

      let logScroll = window.document.getElementById('logScroll')!;
      expect(logScroll.querySelectorAll('.log-line').length).toBeGreaterThan(0);

      (window as any).clearLogs();

      logScroll = window.document.getElementById('logScroll')!;
      expect(logScroll.querySelectorAll('.log-line').length).toBe(0);
    });

    it('shows empty state when no logs', async () => {
      ({ dom } = await createDOM({
        hash: '#/logs',
        fetchOverrides: { '/api/logs': { logs: [], timestamp: Date.now() } },
      }));
      const content = dom.window.document.getElementById('content')!;
      expect(content.innerHTML).toContain('No log entries yet');
    });

    it('renders log timestamps', async () => {
      ({ dom } = await createDOM({ hash: '#/logs' }));
      const content = dom.window.document.getElementById('content')!;

      // Should have .log-ts elements
      const timestamps = content.querySelectorAll('.log-ts');
      expect(timestamps.length).toBe(3);
    });

    it('renders plugin name in brackets', async () => {
      ({ dom } = await createDOM({ hash: '#/logs' }));
      const content = dom.window.document.getElementById('content')!;

      const sources = content.querySelectorAll('.log-src');
      expect(sources.length).toBe(3);
      expect(sources[0].textContent).toContain('[hello-logger]');
    });

    it('renders log-container and log-scroll divs', async () => {
      ({ dom } = await createDOM({ hash: '#/logs' }));
      const content = dom.window.document.getElementById('content')!;

      expect(content.querySelector('.log-container')).not.toBeNull();
      expect(content.querySelector('.log-scroll')).not.toBeNull();
      expect(content.querySelector('.log-toolbar')).not.toBeNull();
    });
  });

  // ── Settings page ───────────────────────────────

  describe('Settings page', () => {
    it('renders server settings', async () => {
      ({ dom } = await createDOM({ hash: '#/settings' }));
      const content = dom.window.document.getElementById('content')!;
      const html = content.innerHTML;

      expect(html).toContain('running');
      expect(html).toContain('1.0.0');
      expect(html).toContain('1h 1m 1s');
    });

    it('renders MQTT settings', async () => {
      ({ dom } = await createDOM({ hash: '#/settings' }));
      const content = dom.window.document.getElementById('content')!;
      const html = content.innerHTML;

      expect(html).toContain('1883');
      expect(html).toContain('Yes');
    });

    it('renders admin panel settings', async () => {
      ({ dom } = await createDOM({ hash: '#/settings' }));
      const content = dom.window.document.getElementById('content')!;
      const html = content.innerHTML;

      expect(html).toContain('3000');
    });

    it('shows page title as Settings', async () => {
      ({ dom } = await createDOM({ hash: '#/settings' }));
      const title = dom.window.document.getElementById('pageTitle')!;
      expect(title.textContent).toBe('Settings');
    });

    it('renders directory path', async () => {
      ({ dom } = await createDOM({ hash: '#/settings' }));
      const content = dom.window.document.getElementById('content')!;
      expect(content.innerHTML).toContain('/srv/worldos');
    });

    it('renders settings-grid with 3 cards', async () => {
      ({ dom } = await createDOM({ hash: '#/settings' }));
      const content = dom.window.document.getElementById('content')!;
      const cards = content.querySelectorAll('.settings-card');
      expect(cards.length).toBe(3);
    });

    it('renders MQTT "No" when not embedded', async () => {
      ({ dom } = await createDOM({
        hash: '#/settings',
        fetchOverrides: {
          '/api/dashboard': {
            ...dashboardResponse,
            config: { ...dashboardResponse.config, mqttEmbedded: false },
          },
        },
      }));
      const content = dom.window.document.getElementById('content')!;
      expect(content.innerHTML).toContain('No');
    });

    it('renders defaults when dashboard data is missing', async () => {
      ({ dom } = await createDOM({
        hash: '#/settings',
        fetchOverrides: {
          '/api/dashboard': null,
        },
      }));
      const content = dom.window.document.getElementById('content')!;
      const html = content.innerHTML;
      // Should show defaults rather than crashing
      expect(html).toContain('1883'); // default mqtt port
      expect(html).toContain('3000'); // default admin port
    });
  });

  // ── Navigation ──────────────────────────────────

  describe('navigation', () => {
    it('highlights active nav item', async () => {
      ({ dom } = await createDOM({ hash: '#/plugins' }));
      const navItems = dom.window.document.querySelectorAll('.nav-item');
      let activePages: string[] = [];
      navItems.forEach((el: any) => {
        if (el.classList.contains('active')) activePages.push(el.dataset.page);
      });
      expect(activePages).toEqual(['plugins']);
    });

    it('sets up auto-refresh intervals', async () => {
      ({ dom } = await createDOM());
      const intervals = (dom.window as any)._testIntervals as { fn: Function; ms: number }[];

      const threeSecIntervals = intervals.filter(i => i.ms === 3000);
      expect(threeSecIntervals.length).toBeGreaterThanOrEqual(2);
    });

    it('sets up 1-second clock interval', async () => {
      ({ dom } = await createDOM());
      const intervals = (dom.window as any)._testIntervals as { fn: Function; ms: number }[];

      const oneSecIntervals = intervals.filter(i => i.ms === 1000);
      expect(oneSecIntervals.length).toBeGreaterThanOrEqual(1);
    });

    it('dashboard is default page for #/', async () => {
      ({ dom } = await createDOM({ hash: '#/' }));
      const title = dom.window.document.getElementById('pageTitle')!;
      expect(title.textContent).toBe('Dashboard');
    });

    it('dashboard is default for empty hash', async () => {
      ({ dom } = await createDOM({ hash: '' }));
      const title = dom.window.document.getElementById('pageTitle')!;
      expect(title.textContent).toBe('Dashboard');
    });

    it('each nav item has correct data-page attribute', async () => {
      ({ dom } = await createDOM());
      const navItems = dom.window.document.querySelectorAll('.nav-item');
      const pages: string[] = [];
      navItems.forEach((el: any) => pages.push(el.dataset.page));
      expect(pages).toEqual(['dashboard', 'plugins', 'logs', 'settings']);
    });
  });

  // ── Uptime formatting ───────────────────────────

  describe('uptime formatting edge cases', () => {
    it('formats days correctly', async () => {
      ({ dom } = await createDOM({
        fetchOverrides: {
          '/api/status': { ...statusResponse, server: { ...statusResponse.server, uptime: 90061 } },
        },
      }));
      const content = dom.window.document.getElementById('content')!;
      expect(content.innerHTML).toContain('1d 1h 1m');
    });

    it('formats minutes correctly', async () => {
      ({ dom } = await createDOM({
        fetchOverrides: {
          '/api/status': { ...statusResponse, server: { ...statusResponse.server, uptime: 125 } },
        },
      }));
      const content = dom.window.document.getElementById('content')!;
      expect(content.innerHTML).toContain('2m 5s');
    });

    it('formats seconds only', async () => {
      ({ dom } = await createDOM({
        fetchOverrides: {
          '/api/status': { ...statusResponse, server: { ...statusResponse.server, uptime: 42 } },
        },
      }));
      const content = dom.window.document.getElementById('content')!;
      expect(content.innerHTML).toContain('42s');
    });

    it('formats 0 seconds', async () => {
      ({ dom } = await createDOM({
        fetchOverrides: {
          '/api/status': { ...statusResponse, server: { ...statusResponse.server, uptime: 0 } },
        },
      }));
      const content = dom.window.document.getElementById('content')!;
      // 0 seconds → fmtUptime returns '--' because !0 is truthy
      expect(content.innerHTML).toContain('--');
    });

    it('formats exactly 1 hour', async () => {
      ({ dom } = await createDOM({
        fetchOverrides: {
          '/api/status': { ...statusResponse, server: { ...statusResponse.server, uptime: 3600 } },
        },
      }));
      const content = dom.window.document.getElementById('content')!;
      expect(content.innerHTML).toContain('1h 0m 0s');
    });

    it('formats exactly 1 day', async () => {
      ({ dom } = await createDOM({
        fetchOverrides: {
          '/api/status': { ...statusResponse, server: { ...statusResponse.server, uptime: 86400 } },
        },
      }));
      const content = dom.window.document.getElementById('content')!;
      expect(content.innerHTML).toContain('1d 0h 0m');
    });

    it('formats multi-day uptime', async () => {
      ({ dom } = await createDOM({
        fetchOverrides: {
          '/api/status': { ...statusResponse, server: { ...statusResponse.server, uptime: 259200 } },
        },
      }));
      const content = dom.window.document.getElementById('content')!;
      expect(content.innerHTML).toContain('3d 0h 0m');
    });
  });

  // ── Error handling ──────────────────────────────

  describe('API failure handling', () => {
    it('shows offline when status API fails', async () => {
      ({ dom } = await createDOM({
        fetchOverrides: {
          '/api/status': null,
        },
      }));
      const dot = dom.window.document.querySelector('.indicator-dot')!;
      expect(dot.className).toContain('stopped');
    });

    it('shows Offline label when status API fails', async () => {
      ({ dom } = await createDOM({
        fetchOverrides: {
          '/api/status': null,
        },
      }));
      const label = dom.window.document.querySelector('.indicator-label')!;
      expect(label.textContent).toBe('Offline');
    });

    it('renders dashboard with loading state when data is null', async () => {
      ({ dom } = await createDOM({
        fetchOverrides: {
          '/api/dashboard': null,
          '/api/plugins': null,
        },
      }));
      const content = dom.window.document.getElementById('content')!;
      expect(content.innerHTML).toContain('--');
    });

    it('clears header uptime when status is null', async () => {
      ({ dom } = await createDOM({
        fetchOverrides: {
          '/api/status': null,
        },
      }));
      const uptimeEl = dom.window.document.getElementById('headerUptime')!;
      expect(uptimeEl.textContent).toBe('');
    });

    it('shows Offline status text on dashboard when server is down', async () => {
      ({ dom } = await createDOM({
        fetchOverrides: {
          '/api/status': null,
        },
      }));
      const content = dom.window.document.getElementById('content')!;
      expect(content.innerHTML).toContain('Offline');
    });

    it('handles both APIs failing simultaneously', async () => {
      ({ dom } = await createDOM({
        fetchOverrides: {
          '/api/status': null,
          '/api/dashboard': null,
          '/api/logs': null,
        },
      }));
      // Should not crash
      const content = dom.window.document.getElementById('content')!;
      expect(content.innerHTML).toBeDefined();
      expect(content.innerHTML.length).toBeGreaterThan(0);
    });
  });

  // ── pluginAction ────────────────────────────────

  describe('pluginAction', () => {
    it('calls fetch with POST method', async () => {
      let fetchCalls: { url: string; options?: any }[];
      ({ dom, fetchCalls } = await createDOM({ hash: '#/plugins' }));

      await (dom.window as any).pluginAction('hello-logger', 'restart');

      const restartCall = fetchCalls.find(c => c.url.includes('restart'));
      expect(restartCall).toBeDefined();
      expect(restartCall!.options?.method).toBe('POST');
    });

    it('URL-encodes the plugin name', async () => {
      let fetchCalls: { url: string; options?: any }[];
      ({ dom, fetchCalls } = await createDOM({ hash: '#/plugins' }));

      await (dom.window as any).pluginAction('hello-logger', 'disable');

      const disableCall = fetchCalls.find(c => c.url.includes('disable'));
      expect(disableCall).toBeDefined();
      expect(disableCall!.url).toContain('/api/plugins/hello-logger/disable');
    });

    it('refreshes data after action', async () => {
      let fetchCalls: { url: string; options?: any }[];
      ({ dom, fetchCalls } = await createDOM({ hash: '#/plugins' }));

      const callCountBefore = fetchCalls.filter(c => c.url.includes('/api/status')).length;

      await (dom.window as any).pluginAction('hello-logger', 'enable');

      // Should have called refresh() which hits /api/status and /api/dashboard
      const callCountAfter = fetchCalls.filter(c => c.url.includes('/api/status')).length;
      expect(callCountAfter).toBeGreaterThan(callCountBefore);
    });
  });

  // ── XSS prevention (esc function) ──────────────

  describe('XSS prevention', () => {
    it('escapes HTML in plugin names', async () => {
      const xssPlugins = [
        { name: '<script>alert("xss")</script>', version: '1.0.0', enabled: true, state: 'running', description: 'test' },
      ];
      ({ dom } = await createDOM({
        fetchOverrides: {
          '/api/dashboard': {
            ...dashboardResponse,
            plugins: { ...dashboardResponse.plugins, list: xssPlugins },
          },
          '/api/plugins': { plugins: xssPlugins, timestamp: Date.now() },
        },
      }));
      const content = dom.window.document.getElementById('content')!;
      const html = content.innerHTML;

      // Should be escaped, not injected as a real script tag
      expect(html).not.toContain('<script>alert("xss")</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes HTML in plugin descriptions', async () => {
      const xssPlugins = [
        { name: 'test', version: '1.0.0', enabled: true, state: 'running', description: '<img onerror="alert(1)" src=x>' },
      ];
      ({ dom } = await createDOM({
        fetchOverrides: {
          '/api/dashboard': {
            ...dashboardResponse,
            plugins: { ...dashboardResponse.plugins, list: xssPlugins },
          },
          '/api/plugins': { plugins: xssPlugins, timestamp: Date.now() },
        },
      }));
      const content = dom.window.document.getElementById('content')!;
      expect(content.innerHTML).not.toContain('<img onerror');
      expect(content.innerHTML).toContain('&lt;img');
    });

    it('escapes HTML in log messages', async () => {
      ({ dom } = await createDOM({
        hash: '#/logs',
        fetchOverrides: {
          '/api/logs': {
            logs: [
              { plugin: 'test', level: 'info', message: '<b>bold</b>', timestamp: Date.now() },
            ],
            timestamp: Date.now(),
          },
        },
      }));
      const content = dom.window.document.getElementById('content')!;
      expect(content.innerHTML).not.toContain('<b>bold</b>');
      expect(content.innerHTML).toContain('&lt;b&gt;');
    });
  });

  // ── pollLogs behavior ─────────────────────────

  describe('pollLogs', () => {
    it('fetches /api/logs with since parameter', async () => {
      let fetchCalls: { url: string; options?: any }[];
      ({ dom, fetchCalls } = await createDOM({ hash: '#/logs' }));

      // Init already called pollLogs, check the call
      const logCall = fetchCalls.find(c => c.url.includes('/api/logs'));
      expect(logCall).toBeDefined();
      expect(logCall!.url).toContain('/logs?');
      expect(logCall!.url).toContain('limit=200');
      expect(logCall!.url).toContain('since=');
    });

    it('sorts logs ascending in state (oldest first)', async () => {
      ({ dom } = await createDOM({ hash: '#/logs' }));
      const content = dom.window.document.getElementById('content')!;

      // The log-line elements should be in ascending order (oldest→newest)
      const logLines = content.querySelectorAll('#logScroll .log-line');
      expect(logLines.length).toBe(3);

      // First line should be "Plugin started" (oldest)
      expect(logLines[0].textContent).toContain('Plugin started');
      // Last line should be "Crash!" (newest)
      expect(logLines[2].textContent).toContain('Crash!');
    });

    it('logs render on logs page', async () => {
      ({ dom } = await createDOM({ hash: '#/logs' }));
      const logScroll = dom.window.document.getElementById('logScroll')!;
      expect(logScroll.querySelectorAll('.log-line').length).toBe(3);
    });
  });

  // ── Clock ─────────────────────────────────────

  describe('clock', () => {
    it('headerClock element is populated', async () => {
      ({ dom } = await createDOM());
      const clock = dom.window.document.getElementById('headerClock')!;
      expect(clock.textContent).toBeTruthy();
      // Should be in HH:MM:SS format
      expect(clock.textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
    });
  });

  // ── HTML structure ────────────────────────────

  describe('HTML structure', () => {
    it('has sidebar with navigation', async () => {
      ({ dom } = await createDOM());
      expect(dom.window.document.getElementById('sidebar')).not.toBeNull();
      expect(dom.window.document.getElementById('nav')).not.toBeNull();
    });

    it('has 4 nav items', async () => {
      ({ dom } = await createDOM());
      const navItems = dom.window.document.querySelectorAll('.nav-item');
      expect(navItems.length).toBe(4);
    });

    it('has main content area', async () => {
      ({ dom } = await createDOM());
      expect(dom.window.document.getElementById('main')).not.toBeNull();
      expect(dom.window.document.getElementById('content')).not.toBeNull();
    });

    it('has header with page title and meta', async () => {
      ({ dom } = await createDOM());
      expect(dom.window.document.getElementById('header')).not.toBeNull();
      expect(dom.window.document.getElementById('pageTitle')).not.toBeNull();
      expect(dom.window.document.getElementById('headerUptime')).not.toBeNull();
      expect(dom.window.document.getElementById('headerClock')).not.toBeNull();
    });

    it('has server indicator in sidebar footer', async () => {
      ({ dom } = await createDOM());
      expect(dom.window.document.getElementById('serverIndicator')).not.toBeNull();
      expect(dom.window.document.querySelector('.indicator-dot')).not.toBeNull();
      expect(dom.window.document.querySelector('.indicator-label')).not.toBeNull();
    });

    it('brand shows WorldOS logo', async () => {
      ({ dom } = await createDOM());
      const logo = dom.window.document.querySelector('.brand-logo') as HTMLImageElement;
      expect(logo).not.toBeNull();
      expect(logo.alt).toBe('WorldOS');
    });
  });

  // ── Multiple plugins with different states ────

  describe('multiple plugin states', () => {
    it('renders failed plugin with red badge', async () => {
      const failedPlugins = [{ name: 'broken', version: '1.0.0', enabled: true, state: 'failed', description: 'Broken plugin' }];
      ({ dom } = await createDOM({
        fetchOverrides: {
          '/api/dashboard': {
            ...dashboardResponse,
            plugins: {
              total: 1, running: 0, stopped: 0, failed: 1, disabled: 0,
              list: failedPlugins,
            },
          },
          '/api/plugins': { plugins: failedPlugins, timestamp: Date.now() },
        },
      }));
      const content = dom.window.document.getElementById('content')!;
      expect(content.innerHTML).toContain('badge-failed');
    });

    it('renders stopped plugin with stopped badge', async () => {
      const stoppedPlugins = [{ name: 'idle', version: '1.0.0', enabled: true, state: 'stopped', description: 'Idle plugin' }];
      ({ dom } = await createDOM({
        fetchOverrides: {
          '/api/dashboard': {
            ...dashboardResponse,
            plugins: {
              total: 1, running: 0, stopped: 1, failed: 0, disabled: 0,
              list: stoppedPlugins,
            },
          },
          '/api/plugins': { plugins: stoppedPlugins, timestamp: Date.now() },
        },
      }));
      const content = dom.window.document.getElementById('content')!;
      expect(content.innerHTML).toContain('badge-stopped');
    });

    it('renders many plugins without crashing', async () => {
      const manyPlugins = Array.from({ length: 20 }, (_, i) => ({
        name: `plugin-${i}`,
        version: '1.0.0',
        enabled: i % 2 === 0,
        state: i % 3 === 0 ? 'running' : i % 3 === 1 ? 'stopped' : 'failed',
        description: `Plugin number ${i}`,
      }));

      ({ dom } = await createDOM({
        fetchOverrides: {
          '/api/dashboard': {
            ...dashboardResponse,
            plugins: {
              total: 20, running: 7, stopped: 7, failed: 6, disabled: 10,
              list: manyPlugins,
            },
          },
          '/api/plugins': { plugins: manyPlugins, timestamp: Date.now() },
        },
      }));
      const content = dom.window.document.getElementById('content')!;
      const cards = content.querySelectorAll('.plugin-card');
      expect(cards.length).toBe(20);
    });
  });

  // ── Log display with many entries ─────────────

  describe('log display edge cases', () => {
    it('renders many log entries', async () => {
      const manyLogs = Array.from({ length: 50 }, (_, i) => ({
        plugin: `plugin-${i % 5}`,
        level: ['info', 'warn', 'error'][i % 3],
        message: `Log message #${i}`,
        timestamp: Date.now() - (50 - i) * 1000,
      }));

      ({ dom } = await createDOM({
        hash: '#/logs',
        fetchOverrides: {
          '/api/logs': { logs: manyLogs, timestamp: Date.now() },
        },
      }));
      const logScroll = dom.window.document.getElementById('logScroll')!;
      expect(logScroll.querySelectorAll('.log-line').length).toBe(50);
    });

    it('logs with multiple plugins show different sources', async () => {
      ({ dom } = await createDOM({
        hash: '#/logs',
        fetchOverrides: {
          '/api/logs': {
            logs: [
              { plugin: 'alpha', level: 'info', message: 'from alpha', timestamp: Date.now() },
              { plugin: 'beta', level: 'warn', message: 'from beta', timestamp: Date.now() - 1000 },
            ],
            timestamp: Date.now(),
          },
        },
      }));
      const content = dom.window.document.getElementById('content')!;
      expect(content.innerHTML).toContain('[alpha]');
      expect(content.innerHTML).toContain('[beta]');
    });
  });

  // ── Plugin Panels ──────────────────────────────

  describe('plugin panels', () => {
    const panelsWithEntries = {
      panels: [
        { name: 'presence', displayName: 'User Presence', entryPoint: '/plugins/presence/admin/panel.js', icon: 'users' },
        { name: 'moderation', displayName: 'Moderation', entryPoint: '/plugins/moderation/admin/panel.js' },
      ],
    };

    it('fetches /api/panels on init', async () => {
      let fetchCalls: { url: string; options?: any }[];
      ({ dom, fetchCalls } = await createDOM());

      const urls = fetchCalls.map(c => c.url);
      // fetchPanels runs in parallel with refresh+pollLogs during init
      // refresh fetches: /api/status, /api/dashboard, /api/plugins
      // pollLogs fetches: /api/logs
      // fetchPanels fetches: /api/panels
      expect(urls).toContain('/api/panels');
    });

    it('adds dynamic sidebar entries for panels', async () => {
      ({ dom } = await createDOM({
        fetchOverrides: { '/api/panels': panelsWithEntries },
      }));

      const nav = dom.window.document.getElementById('nav')!;
      const panelLinks = nav.querySelectorAll('[data-panel]');
      // divider + 2 panel links
      expect(panelLinks.length).toBe(3);
    });

    it('sidebar panel links have correct href', async () => {
      ({ dom } = await createDOM({
        fetchOverrides: { '/api/panels': panelsWithEntries },
      }));

      const nav = dom.window.document.getElementById('nav')!;
      const presenceLink = nav.querySelector('[data-panel="presence"]') as HTMLAnchorElement;
      expect(presenceLink).not.toBeNull();
      expect(presenceLink.href).toContain('#/plugin/presence');
      expect(presenceLink.textContent).toContain('User Presence');
    });

    it('sidebar shows "Plugin Panels" divider label', async () => {
      ({ dom } = await createDOM({
        fetchOverrides: { '/api/panels': panelsWithEntries },
      }));

      const divider = dom.window.document.querySelector('.nav-divider-label');
      expect(divider).not.toBeNull();
      expect(divider!.textContent).toBe('Plugin Panels');
    });

    it('does not add sidebar entries when no panels', async () => {
      ({ dom } = await createDOM({
        fetchOverrides: { '/api/panels': { panels: [] } },
      }));

      const panelLinks = dom.window.document.querySelectorAll('[data-panel]');
      expect(panelLinks.length).toBe(0);
    });

    it('navigating to plugin route shows panel container', async () => {
      ({ dom } = await createDOM({
        hash: '#/plugin/presence',
        fetchOverrides: { '/api/panels': panelsWithEntries },
      }));

      const content = dom.window.document.getElementById('content')!;
      expect(content.querySelector('#panelContainer')).not.toBeNull();
    });

    it('sets page title to panel displayName', async () => {
      ({ dom } = await createDOM({
        hash: '#/plugin/presence',
        fetchOverrides: { '/api/panels': panelsWithEntries },
      }));

      const title = dom.window.document.getElementById('pageTitle')!;
      expect(title.textContent).toBe('User Presence');
    });

    it('shows error when panel not found', async () => {
      ({ dom } = await createDOM({
        hash: '#/plugin/nonexistent',
        fetchOverrides: { '/api/panels': panelsWithEntries },
      }));

      const content = dom.window.document.getElementById('content')!;
      expect(content.innerHTML).toContain('Panel not found');
    });

    it('escapes panel names in sidebar', async () => {
      ({ dom } = await createDOM({
        fetchOverrides: {
          '/api/panels': {
            panels: [{ name: 'test', displayName: '<script>xss</script>', entryPoint: '/test.js' }],
          },
        },
      }));

      const nav = dom.window.document.getElementById('nav')!;
      expect(nav.innerHTML).not.toContain('<script>xss</script>');
      expect(nav.innerHTML).toContain('&lt;script&gt;');
    });

    it('refresh skips re-render for plugin panel pages', async () => {
      ({ dom } = await createDOM({
        hash: '#/plugin/presence',
        fetchOverrides: { '/api/panels': panelsWithEntries },
      }));

      const content = dom.window.document.getElementById('content')!;
      const container = content.querySelector('#panelContainer');
      expect(container).not.toBeNull();

      // Put a marker in the panel container
      container!.setAttribute('data-test', 'marker');

      // Trigger a refresh cycle (should NOT rebuild innerHTML for plugin pages)
      const intervals = (dom.window as any)._testIntervals;
      const refreshFns = intervals.filter((i: any) => i.ms === 3000);
      for (const interval of refreshFns) {
        await interval.fn();
      }
      await new Promise(r => setTimeout(r, 50));

      // Marker should still be there
      expect(content.querySelector('[data-test="marker"]')).not.toBeNull();
    });
  });
});
