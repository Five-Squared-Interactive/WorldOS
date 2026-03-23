/* ── WorldOS Admin Dashboard ──────────────────────────────── */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ── State ────────────────────────────────────────────────── */
const state = {
  status: null,
  dashboard: null,
  pluginList: null,     // from /api/plugins (has runtime state)
  logs: [],
  page: 'dashboard',
  renderedLogCount: 0,
  // Plugin panels from /api/panels
  panels: [],           // { name, displayName, entryPoint, icon, route }
  panelModules: {},     // cached: name → { mount, unmount }
  currentPanelModule: null, // currently mounted panel module
  // Fingerprints to detect actual data changes (avoid needless re-renders)
  _fp: { status: '', dashboard: '', plugins: '' },
};

/* ── API ──────────────────────────────────────────────────── */
async function api(path) {
  try {
    const r = await fetch(`/api${path}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/* ── Formatters ───────────────────────────────────────────── */
function fmtUptime(seconds) {
  if (!seconds || seconds < 0) return '--';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtTime(date) {
  const d = date || new Date();
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtTimestamp(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
}

/* ── Icons (inline SVG) ───────────────────────────────────── */
const icons = {
  restart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  package: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>',
  clear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>',
};

/* ── Badge helper ─────────────────────────────────────────── */
function badge(status) {
  const s = status || 'stopped';
  const label = s.charAt(0).toUpperCase() + s.slice(1);
  return `<span class="badge badge-${s}"><span class="badge-dot"></span>${label}</span>`;
}

/* ── Page: Dashboard ──────────────────────────────────────── */
function renderDashboard() {
  const d = state.dashboard;
  const s = state.status;
  const loading = !d;

  const uptime = s?.server?.uptime != null ? fmtUptime(s.server.uptime) : '--';

  // Use runtime plugin list if available (has real running/stopped state)
  // Fall back to static dashboard data
  const plugins = state.pluginList ?? d?.plugins?.list ?? [];
  let running = 0, stopped = 0, failed = 0;
  for (const p of plugins) {
    const st = p.state || p.status || 'stopped';
    const enabled = p.enabled !== false;
    if (!enabled) { stopped++; }
    else if (st === 'running') { running++; }
    else if (st === 'failed' || st === 'crashed') { failed++; }
    else { stopped++; }
  }
  const total = plugins.length;

  let pluginCards = '';
  if (plugins.length) {
    pluginCards = plugins.map(p => {
      const st = p.state || p.status || 'stopped';
      const enabled = p.enabled !== false;
      const displayStatus = enabled ? st : 'disabled';
      return `
      <div class="plugin-card">
        <div class="plugin-card-header">
          <span class="plugin-name">${esc(p.name)}</span>
          ${badge(displayStatus)}
        </div>
        <div class="plugin-card-body">
          <span class="plugin-description">${esc(p.description || 'No description')}</span>
          <span class="plugin-version">v${esc(p.version)}</span>
        </div>
      </div>
    `;
    }).join('');
  } else {
    pluginCards = `
      <div class="empty-state" style="grid-column: 1/-1">
        ${icons.package}
        <h3>No plugins installed</h3>
        <p>Add plugins with <code style="color:var(--accent)">wos add &lt;source&gt;</code> to get started.</p>
      </div>
    `;
  }

  return `
    <div class="fade-in ${loading ? 'loading' : ''}">
      <div class="stats-row">
        <div class="stat-card">
          <span class="stat-label">Status</span>
          <span class="stat-value green">${s?.server?.status === 'running' ? 'Running' : 'Offline'}</span>
          <span class="stat-sub">PID ${s?.server?.pid ?? '--'}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Uptime</span>
          <span class="stat-value accent">${uptime}</span>
          <span class="stat-sub">Since start</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Plugins Running</span>
          <span class="stat-value green">${running}</span>
          <span class="stat-sub">of ${total} installed</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Stopped</span>
          <span class="stat-value ${stopped > 0 ? 'yellow' : ''}">${stopped}</span>
          <span class="stat-sub">disabled or idle</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Failed</span>
          <span class="stat-value ${failed > 0 ? 'red' : ''}">${failed}</span>
          <span class="stat-sub">${failed > 0 ? 'needs attention' : 'all healthy'}</span>
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <span class="section-title">Plugins</span>
        </div>
        <div class="plugin-grid">
          ${pluginCards}
        </div>
      </div>
    </div>
  `;
}

/* ── Page: Plugins ────────────────────────────────────────── */
function renderPlugins() {
  // Use pluginList from /api/plugins (has runtime state: running/stopped/etc.)
  // Fall back to dashboard list if /api/plugins hasn't loaded yet
  const plugins = state.pluginList ?? state.dashboard?.plugins?.list ?? [];

  if (!plugins.length) {
    return `
      <div class="fade-in">
        <div class="empty-state">
          ${icons.package}
          <h3>No plugins installed</h3>
          <p>Install plugins with <code style="color:var(--accent)">wos add &lt;source&gt;</code> to see them here.</p>
        </div>
      </div>
    `;
  }

  const cards = plugins.map(p => {
    // /api/plugins returns { state, enabled, ... } — map state to status for badge
    const pluginState = p.state || p.status || 'stopped';
    const isEnabled = p.enabled !== false;
    const displayStatus = isEnabled ? pluginState : 'disabled';
    const isRunning = pluginState === 'running';
    const isStopped = pluginState === 'stopped' || pluginState === 'crashed' || pluginState === 'failed' || pluginState === 'killed';
    const isDisabled = !isEnabled;

    let actions = '';

    if (isRunning) {
      actions += `<button class="btn" onclick="pluginAction('${esc(p.name)}','stop')">${icons.power} Stop</button>`;
      actions += `<button class="btn" onclick="pluginAction('${esc(p.name)}','restart')">${icons.restart} Restart</button>`;
      actions += `<button class="btn" onclick="pluginAction('${esc(p.name)}','disable')">${icons.stop} Disable</button>`;
    } else if (isDisabled) {
      actions += `<button class="btn btn-accent" onclick="pluginAction('${esc(p.name)}','enable')">${icons.play} Enable</button>`;
    } else if (isStopped && isEnabled) {
      actions += `<button class="btn btn-accent" onclick="pluginAction('${esc(p.name)}','start')">${icons.play} Start</button>`;
      actions += `<button class="btn" onclick="pluginAction('${esc(p.name)}','disable')">${icons.stop} Disable</button>`;
    } else {
      if (isEnabled) {
        actions += `<button class="btn btn-accent" onclick="pluginAction('${esc(p.name)}','start')">${icons.play} Start</button>`;
        actions += `<button class="btn" onclick="pluginAction('${esc(p.name)}','disable')">${icons.stop} Disable</button>`;
      } else {
        actions += `<button class="btn btn-accent" onclick="pluginAction('${esc(p.name)}','enable')">${icons.play} Enable</button>`;
      }
    }

    return `
      <div class="plugin-card">
        <div class="plugin-card-header">
          <div>
            <span class="plugin-name">${esc(p.name)}</span>
            <span class="plugin-version" style="margin-left:8px">v${esc(p.version)}</span>
          </div>
          ${badge(displayStatus)}
        </div>
        <div class="plugin-description" style="min-height:20px">${esc(p.description || 'No description provided')}</div>
        <div class="plugin-card-body">
          <div class="plugin-actions">
            ${actions}
          </div>
        </div>
      </div>
    `;
  }).join('');

  return `<div class="fade-in"><div class="plugin-grid">${cards}</div></div>`;
}

/* ── Page: Logs ───────────────────────────────────────────── */
function renderLogs() {
  const lines = state.logs.map(l => makeLogLineHtml(l)).join('');
  state.renderedLogCount = state.logs.length;

  return `
    <div class="fade-in">
      <div class="log-container">
        <div class="log-toolbar">
          <input class="log-filter" id="logFilter" placeholder="Filter logs..." oninput="filterLogs(this.value)">
          <button class="btn" onclick="clearLogs()">${icons.clear} Clear</button>
        </div>
        <div class="log-scroll" id="logScroll">
          ${lines || '<div class="log-empty" style="padding:40px;text-align:center;color:var(--text-muted)">No log entries yet. Logs appear here in real-time when plugins are running.</div>'}
        </div>
      </div>
    </div>
  `;
}

function makeLogLineHtml(l) {
  const levelClass = l.level === 'error' ? 'error' : l.level === 'warn' ? 'warn' : '';
  return `<div class="log-line"><span class="log-ts">${fmtTimestamp(l.timestamp)}</span><span class="log-src">[${esc(l.plugin)}]</span><span class="log-msg ${levelClass}">${esc(l.message)}</span></div>`;
}

function appendNewLogLines() {
  const logScroll = $('#logScroll');
  if (!logScroll) return;

  const newCount = state.logs.length;
  const rendered = state.renderedLogCount;
  if (newCount <= rendered) return;

  const empty = logScroll.querySelector('.log-empty');
  if (empty) empty.remove();

  const wasAtBottom = logScroll.scrollHeight - logScroll.scrollTop - logScroll.clientHeight < 40;

  const filterInput = $('#logFilter');
  const filterQuery = filterInput ? filterInput.value.toLowerCase() : '';

  const newEntries = state.logs.slice(rendered);
  for (const entry of newEntries) {
    const div = document.createElement('div');
    div.innerHTML = makeLogLineHtml(entry);
    const lineEl = div.firstElementChild;
    if (filterQuery && !lineEl.textContent.toLowerCase().includes(filterQuery)) {
      lineEl.style.display = 'none';
    }
    logScroll.appendChild(lineEl);
  }

  state.renderedLogCount = newCount;

  if (wasAtBottom) {
    logScroll.scrollTop = logScroll.scrollHeight;
  }
}

/* ── Page: Settings ───────────────────────────────────────── */
function renderSettings() {
  const d = state.dashboard;
  const c = d?.config || {};
  const s = state.status?.server || {};

  return `
    <div class="fade-in">
      <div class="settings-grid">
        <div class="settings-card">
          <h3>Server</h3>
          <div class="setting-row"><span class="setting-key">Status</span><span class="setting-val">${s.status || 'unknown'}</span></div>
          <div class="setting-row"><span class="setting-key">Version</span><span class="setting-val">${s.version || '--'}</span></div>
          <div class="setting-row"><span class="setting-key">Uptime</span><span class="setting-val">${fmtUptime(s.uptime)}</span></div>
          <div class="setting-row"><span class="setting-key">Directory</span><span class="setting-val">${esc(d?.directory || '--')}</span></div>
        </div>
        <div class="settings-card">
          <h3>MQTT Broker</h3>
          <div class="setting-row"><span class="setting-key">Embedded</span><span class="setting-val">${c.mqttEmbedded ? 'Yes' : 'No'}</span></div>
          <div class="setting-row"><span class="setting-key">Port</span><span class="setting-val">${c.mqttPort || 1883}</span></div>
          <div class="setting-row"><span class="setting-key">Host</span><span class="setting-val">${esc(c.host || 'localhost')}</span></div>
        </div>
        <div class="settings-card">
          <h3>Admin Panel</h3>
          <div class="setting-row"><span class="setting-key">Port</span><span class="setting-val">${c.port || 3000}</span></div>
          <div class="setting-row"><span class="setting-key">Host</span><span class="setting-val">${esc(c.host || '0.0.0.0')}</span></div>
        </div>
      </div>
    </div>
  `;
}

/* ── Page: Plugin Panel (dynamic) ─────────────────────────── */
function renderPluginPanel() {
  // Returns a mount container; actual content loaded via dynamic import
  return `<div class="fade-in"><div id="panelContainer" class="panel-container"></div></div>`;
}

async function mountPluginPanel(panelName) {
  const panel = state.panels.find(p => p.name === panelName);
  if (!panel) {
    $('#content').innerHTML = `<div class="fade-in"><div class="empty-state"><h3>Panel not found</h3><p>Plugin panel "${esc(panelName)}" is not available.</p></div></div>`;
    return;
  }

  const container = $('#panelContainer');
  if (!container) return;

  // Load module (cached after first load)
  let mod = state.panelModules[panelName];
  if (!mod) {
    try {
      mod = await import(panel.entryPoint);
      state.panelModules[panelName] = mod;
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><h3>Failed to load panel</h3><p>${esc(String(err))}</p></div>`;
      return;
    }
  }

  // Build context for the panel
  const context = {
    mqtt: {
      subscribe: () => {},
      unsubscribe: () => {},
      publish: () => {},
    },
    api: {
      get: (url) => fetch(url).then(r => r.json()),
      post: (url, data) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
      put: (url, data) => fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
      delete: (url) => fetch(url, { method: 'DELETE' }).then(r => r.json()),
    },
    config: {},
  };

  try {
    await mod.mount(container, context);
    state.currentPanelModule = mod;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Panel mount error</h3><p>${esc(String(err))}</p></div>`;
  }
}

async function unmountCurrentPanel() {
  if (state.currentPanelModule?.unmount) {
    try { await state.currentPanelModule.unmount(); } catch {}
  }
  state.currentPanelModule = null;
}

/* ── Rendering ────────────────────────────────────────────── */
const pages = {
  dashboard: { title: 'Dashboard',  render: renderDashboard },
  plugins:   { title: 'Plugins',    render: renderPlugins },
  logs:      { title: 'Logs',       render: renderLogs },
  settings:  { title: 'Settings',   render: renderSettings },
};

function render() {
  const page = pages[state.page] || pages.dashboard;
  $('#pageTitle').textContent = page.title;
  $('#content').innerHTML = page.render();
}

/* ── Router ───────────────────────────────────────────────── */
async function navigate(page) {
  // Unmount any active plugin panel before switching
  await unmountCurrentPanel();

  state.page = page;
  $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  state.renderedLogCount = 0;

  // Check if this is a plugin panel route (e.g. "plugin/presence")
  if (page.startsWith('plugin/')) {
    const panelName = page.slice('plugin/'.length);
    const panel = state.panels.find(p => p.name === panelName);
    $('#pageTitle').textContent = panel?.displayName || panelName;
    $('#content').innerHTML = renderPluginPanel();
    await mountPluginPanel(panelName);
    return;
  }

  render();
}

window.addEventListener('hashchange', () => {
  const hash = location.hash.slice(2) || 'dashboard';
  navigate(hash);
});

/* ── Actions ──────────────────────────────────────────────── */
window.pluginAction = async function(name, action) {
  await fetch(`/api/plugins/${encodeURIComponent(name)}/${action}`, { method: 'POST' });
  // Force immediate re-fetch so the UI reflects the change
  await refresh(true);
};

window.clearLogs = function() {
  state.logs = [];
  state.renderedLogCount = 0;
  render();
};

window.filterLogs = function(query) {
  const q = query.toLowerCase();
  $$('#logScroll .log-line').forEach(el => {
    el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
};

/* ── Data Fetching ────────────────────────────────────────── */

/** Compute a simple fingerprint for change detection, stripping volatile fields */
function fingerprint(obj, excludeKeys) {
  if (!obj) return '';
  if (!excludeKeys) return JSON.stringify(obj);
  return JSON.stringify(obj, (key, val) => excludeKeys.includes(key) ? undefined : val);
}

/**
 * Fetch latest data from APIs.
 * Only re-renders content when data actually changed, preventing flicker.
 * @param {boolean} force - if true, always re-render (e.g. after a user action)
 */
async function refresh(force) {
  const [status, dashboard, pluginsData] = await Promise.all([
    api('/status'),
    api('/dashboard'),
    api('/plugins'),
  ]);

  state.status = status;
  state.dashboard = dashboard;
  if (pluginsData?.plugins) {
    state.pluginList = pluginsData.plugins;
  }

  // ── Always update sidebar & header in-place (no re-render needed) ──
  const dot = $('.indicator-dot');
  const label = $('.indicator-label');
  if (status?.server?.status === 'running') {
    dot.className = 'indicator-dot running';
    label.textContent = `Running - ${fmtUptime(status.server.uptime)}`;
  } else {
    dot.className = 'indicator-dot stopped';
    label.textContent = 'Offline';
  }

  const uptimeEl = $('#headerUptime');
  if (status?.server?.uptime != null) {
    uptimeEl.textContent = `up ${fmtUptime(status.server.uptime)}`;
  } else {
    uptimeEl.textContent = '';
  }

  // ── In-place updates for volatile data (uptime) on dashboard ──
  if (state.page === 'dashboard') {
    const uptimeStatEl = document.querySelector('.stat-card .stat-value.accent');
    if (uptimeStatEl && status?.server?.uptime != null) {
      uptimeStatEl.textContent = fmtUptime(status.server.uptime);
    }
  }

  // ── Content re-render only when data changed ──
  // Logs page is handled incrementally by pollLogs; plugin panels manage their own content
  if (state.page === 'logs' || state.page.startsWith('plugin/')) return;

  // Exclude volatile fields from fingerprint so ticking uptime/timestamps don't cause re-renders
  const volatileKeys = ['uptime', 'timestamp'];
  const fpStatus = fingerprint(status, volatileKeys);
  const fpDash = fingerprint(dashboard, volatileKeys);
  const fpPlugins = fingerprint(pluginsData, volatileKeys);

  const changed = force
    || fpStatus !== state._fp.status
    || fpDash !== state._fp.dashboard
    || fpPlugins !== state._fp.plugins;

  if (changed) {
    state._fp.status = fpStatus;
    state._fp.dashboard = fpDash;
    state._fp.plugins = fpPlugins;
    render();
  }
}

/* ── Clock ────────────────────────────────────────────────── */
setInterval(() => {
  $('#headerClock').textContent = fmtTime();
}, 1000);
$('#headerClock').textContent = fmtTime();

/* ── Log Polling ─────────────────────────────────────────── */
let lastLogTimestamp = 0;

async function pollLogs() {
  const since = lastLogTimestamp || 0;
  const data = await api(`/logs?limit=200&since=${since}`);
  if (data?.logs?.length) {
    const existingTs = new Set(state.logs.map(l => `${l.timestamp}-${l.plugin}-${l.message}`));
    for (const entry of data.logs) {
      const key = `${entry.timestamp}-${entry.plugin}-${entry.message}`;
      if (!existingTs.has(key)) {
        state.logs.push(entry);
      }
    }
    state.logs.sort((a, b) => a.timestamp - b.timestamp);
    if (state.logs.length > 500) {
      state.logs = state.logs.slice(-500);
    }
    lastLogTimestamp = Math.max(...state.logs.map(l => l.timestamp)) + 1;

    if (state.page === 'logs') {
      appendNewLogLines();
    }
  }
}

/* ── Escape HTML ──────────────────────────────────────────── */
function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

/* ── Plugin Panel Sidebar ─────────────────────────────────── */
const panelIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';

function updateSidebarPanels(panels) {
  // Remove existing dynamic panel entries
  $$('.nav-item[data-panel]').forEach(el => el.remove());

  if (!panels || !panels.length) return;

  const nav = $('#nav');
  // Insert a divider + panel links after the Settings link
  const divider = document.createElement('div');
  divider.className = 'nav-divider';
  divider.setAttribute('data-panel', 'divider');
  divider.innerHTML = '<span class="nav-divider-label">Plugin Panels</span>';
  nav.appendChild(divider);

  for (const p of panels) {
    const a = document.createElement('a');
    a.href = `#/plugin/${p.name}`;
    a.className = 'nav-item';
    a.dataset.page = `plugin/${p.name}`;
    a.dataset.panel = p.name;
    a.innerHTML = `${panelIcon} ${esc(p.displayName)}`;
    nav.appendChild(a);
  }
}

async function fetchPanels() {
  const data = await api('/panels');
  if (data?.panels?.length) {
    state.panels = data.panels;
    updateSidebarPanels(data.panels);
  }
}

/* ── Init ─────────────────────────────────────────────────── */
(async function init() {
  const hash = location.hash.slice(2) || 'dashboard';

  // Fetch panels and main data in parallel
  const [, ,] = await Promise.all([
    fetchPanels(),
    refresh(true),
    pollLogs(),
  ]);

  // Navigate after data is loaded (panels needed for plugin routes)
  await navigate(hash);

  setInterval(refresh, 3000);
  setInterval(pollLogs, 3000);
})();
