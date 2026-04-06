/** Sync Manager Plugin — Admin Panel */
import { request, connect } from '/wos-mqtt.js';

let interval;
let state = { data: null, error: null, expandedSession: null };

export async function mount(container) {
  try {
    await connect();
  } catch {
    state.error = 'MQTT bridge not available';
  }
  await fetchData();
  render(container);
  interval = setInterval(async () => {
    await fetchData();
    if (container.querySelector(':focus')) return;
    render(container);
  }, 5000);
}

export function unmount() {
  if (interval) { clearInterval(interval); interval = undefined; }
}

async function fetchData() {
  const data = await request(
    'wos/sync-manager/admin/stats',
    'wos/sync-manager/admin/stats/response',
  );
  if (data) state.data = data;
  state.error = !data ? 'Plugin not responding' : null;
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function fmtDate(ts) {
  if (!ts) return '--';
  return new Date(ts).toLocaleString();
}

// ── Styles ──

const btnSmall = 'padding:4px 10px;border-radius:4px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);cursor:pointer;font-size:0.85em';

// ── Render ──

function render(container) {
  const d = state.data;
  const sessions = d?.sessions || [];
  const totalClients = sessions.reduce((sum, s) => sum + (s.clientCount || 0), 0);
  const totalEntities = sessions.reduce((sum, s) => sum + (s.entityCount || 0), 0);

  container.innerHTML = `
    <div style="padding:16px;display:flex;flex-direction:column;gap:16px">
      ${state.error ? `<div style="padding:12px;background:var(--danger-bg,#3a1a1a);border:1px solid var(--danger-border,#ff4444);border-radius:8px;color:#ff6b6b">${esc(state.error)}</div>` : ''}

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">
        <div class="stat-card">
          <span class="stat-label">Active Sessions</span>
          <span class="stat-value accent">${d ? sessions.length : '--'}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Connected Clients</span>
          <span class="stat-value green">${d ? totalClients : '--'}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Total Entities</span>
          <span class="stat-value">${d ? totalEntities : '--'}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Broker</span>
          <span class="stat-value" style="font-size:0.9em">
            ${d ? `<span class="badge badge-${d.brokerRunning ? 'running' : 'stopped'}">${d.brokerRunning ? 'Running' : 'Stopped'}</span>` : '--'}
          </span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Health</span>
          <span class="stat-value" style="font-size:0.9em">
            <span class="badge badge-${d?.health === 'ok' ? 'running' : d?.health === 'degraded' ? 'warning' : 'stopped'}">${esc(d?.health) || '--'}</span>
          </span>
        </div>
      </div>

      <!-- Sessions Section -->
      <div class="section">
        <span class="section-title">Sessions</span>

        ${sessions.length ? `
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:0.9em">
              <thead>
                <tr style="border-bottom:1px solid var(--border);text-align:left">
                  <th style="padding:8px;color:var(--text-muted);font-weight:500">Session ID</th>
                  <th style="padding:8px;color:var(--text-muted);font-weight:500">Tag</th>
                  <th style="padding:8px;color:var(--text-muted);font-weight:500">Clients</th>
                  <th style="padding:8px;color:var(--text-muted);font-weight:500">Entities</th>
                  <th style="padding:8px;color:var(--text-muted);font-weight:500">Region</th>
                  <th style="padding:8px;color:var(--text-muted);font-weight:500">Created</th>
                  <th style="padding:8px;color:var(--text-muted);font-weight:500;width:80px"></th>
                </tr>
              </thead>
              <tbody>
                ${sessions.map(s => {
                  const isExpanded = state.expandedSession === s.sessionId;
                  const regionText = s.regionCoords ? `(${s.regionCoords.x}, ${s.regionCoords.y})` : '--';
                  let rows = `
                    <tr style="border-bottom:1px solid var(--border)">
                      <td style="padding:8px;font-family:monospace;font-size:0.85em">${esc(s.sessionId)}</td>
                      <td style="padding:8px">${esc(s.tag)}</td>
                      <td style="padding:8px;text-align:center">${s.clientCount}</td>
                      <td style="padding:8px;text-align:center">${s.entityCount}</td>
                      <td style="padding:8px;font-family:monospace;font-size:0.85em">${regionText}</td>
                      <td style="padding:8px;font-size:0.85em;color:var(--text-muted)">${fmtDate(s.createdAt)}</td>
                      <td style="padding:8px">
                        <button class="btn" data-action="toggle-session" data-id="${esc(s.sessionId)}" style="${btnSmall}">${isExpanded ? 'Hide' : 'Details'}</button>
                      </td>
                    </tr>
                  `;

                  if (isExpanded && s.clients) {
                    rows += `
                    <tr style="border-bottom:1px solid var(--border);background:var(--bg-secondary)">
                      <td colspan="7" style="padding:12px">
                        <div style="font-size:0.85em;color:var(--text-muted);margin-bottom:8px">Connected Clients:</div>
                        ${s.clients.length ? s.clients.map(c => `
                          <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-bottom:1px solid var(--border)">
                            <span style="font-family:monospace;font-size:0.85em">${esc(c)}</span>
                            <button class="btn" data-action="kick-client" data-session="${esc(s.sessionId)}" data-client="${esc(c)}" style="${btnSmall};color:#ff6b6b">Kick</button>
                          </div>
                        `).join('') : '<div style="color:var(--text-muted);padding:4px 8px">No clients connected</div>'}
                      </td>
                    </tr>`;
                  }

                  return rows;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : '<div style="padding:24px;text-align:center;color:var(--text-muted)">No active sessions</div>'}
      </div>

      <div class="settings-card">
        <h3 style="margin-top:0">Configuration</h3>
        <div class="setting-row"><span class="setting-key">MQTT Topics</span><span class="setting-val">wos/sync-manager/*</span></div>
        <div class="setting-row"><span class="setting-key">Sync Broker</span><span class="setting-val">Mosquitto (WorldSync 2.0)</span></div>
        <div class="setting-row"><span class="setting-key">Auth</span><span class="setting-val">Token validation via identity plugin</span></div>
      </div>
    </div>
  `;

  // Wire up event handlers
  if (container._smClickHandler) {
    container.removeEventListener('click', container._smClickHandler);
  }
  wireHandlers(container);
}

function wireHandlers(container) {
  const handler = async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;

    switch (action) {
      case 'toggle-session': {
        const id = btn.dataset.id;
        state.expandedSession = state.expandedSession === id ? null : id;
        // Fetch detailed session info when expanding
        if (state.expandedSession) {
          const info = await request(
            'wos/sync-manager/session/get',
            'wos/sync-manager/session/get/response',
            { sessionId: id },
          );
          if (info && state.data) {
            const idx = state.data.sessions.findIndex(s => s.sessionId === id);
            if (idx >= 0) state.data.sessions[idx] = { ...state.data.sessions[idx], ...info };
          }
        }
        render(container);
        break;
      }
      case 'kick-client': {
        const sessionId = btn.dataset.session;
        const clientId = btn.dataset.client;
        if (!confirm(`Kick client "${clientId}" from session "${sessionId}"?`)) return;
        await request(
          'wos/sync-manager/admin/kick',
          'wos/sync-manager/admin/kick/response',
          { sessionId, clientId },
        );
        await fetchData();
        render(container);
        break;
      }
    }
  };
  container._smClickHandler = handler;
  container.addEventListener('click', handler);
}
