/**
 * Hello Logger — Admin Panel
 *
 * Sample plugin panel that shows recent log output and plugin status.
 * Demonstrates the mount/unmount contract for WorldOS admin panels.
 */

let interval = null;
let container = null;
let ctx = null;

export function mount(el, context) {
  container = el;
  ctx = context;

  el.innerHTML = `
    <div style="padding:16px">
      <h2 style="margin-bottom:12px;color:var(--text)">Hello Logger</h2>
      <p style="color:var(--text-dim);margin-bottom:16px">This panel shows live status for the hello-logger plugin.</p>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
        <div style="background:var(--bg-card);padding:16px;border-radius:var(--radius);border:1px solid var(--border)">
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Status</div>
          <div id="hl-status" style="font-size:18px;font-weight:600;color:var(--green)">Checking...</div>
        </div>
        <div style="background:var(--bg-card);padding:16px;border-radius:var(--radius);border:1px solid var(--border)">
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Messages Logged</div>
          <div id="hl-count" style="font-size:18px;font-weight:600;color:var(--accent)">--</div>
        </div>
      </div>

      <div style="background:var(--bg-card);padding:16px;border-radius:var(--radius);border:1px solid var(--border)">
        <h3 style="margin-bottom:8px;font-size:14px;color:var(--text-dim)">Recent Logs</h3>
        <div id="hl-logs" style="font-family:var(--mono);font-size:12px;max-height:300px;overflow-y:auto;color:var(--text)">
          <div style="color:var(--text-muted)">Loading...</div>
        </div>
      </div>
    </div>
  `;

  refresh();
  interval = setInterval(refresh, 3000);
}

export function unmount() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  container = null;
  ctx = null;
}

async function refresh() {
  if (!container) return;

  try {
    // Fetch plugin status
    const pluginsRes = await fetch('/api/plugins');
    if (pluginsRes.ok) {
      const data = await pluginsRes.json();
      const plugin = data.plugins?.find(p => p.name === 'hello-logger');
      const statusEl = container.querySelector('#hl-status');
      if (statusEl && plugin) {
        const state = plugin.state || 'unknown';
        statusEl.textContent = state.charAt(0).toUpperCase() + state.slice(1);
        statusEl.style.color = state === 'running' ? 'var(--green)' : 'var(--yellow)';
      }
    }

    // Fetch recent logs
    const logsRes = await fetch('/api/logs?limit=20');
    if (logsRes.ok) {
      const data = await logsRes.json();
      const myLogs = data.logs?.filter(l => l.plugin === 'hello-logger') || [];
      const countEl = container.querySelector('#hl-count');
      if (countEl) countEl.textContent = String(myLogs.length);

      const logsEl = container.querySelector('#hl-logs');
      if (logsEl) {
        if (myLogs.length === 0) {
          logsEl.innerHTML = '<div style="color:var(--text-muted)">No log entries yet.</div>';
        } else {
          logsEl.innerHTML = myLogs
            .sort((a, b) => b.timestamp - a.timestamp)
            .map(l => {
              const t = new Date(l.timestamp).toLocaleTimeString('en-US', { hour12: false });
              const color = l.level === 'error' ? 'var(--red)' : l.level === 'warn' ? 'var(--yellow)' : 'var(--text)';
              return `<div style="padding:2px 0;color:${color}"><span style="color:var(--text-muted)">${t}</span> ${l.message}</div>`;
            })
            .join('');
        }
      }
    }
  } catch {
    // Silently fail on network errors
  }
}
