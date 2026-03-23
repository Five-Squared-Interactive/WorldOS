/** Identity Plugin — Admin Panel */
import { request, connect } from '/wos-mqtt.js';

let interval;
let state = { stats: null, users: null, error: null, registering: false };

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
    // Skip re-render if user is interacting with a form
    if (container.querySelector(':focus')) return;
    render(container);
  }, 5000);
}

export function unmount() {
  if (interval) { clearInterval(interval); interval = undefined; }
}

async function fetchData() {
  const [stats, users] = await Promise.all([
    request('wos/identity/admin/stats', 'wos/identity/admin/stats/response'),
    request('wos/identity/admin/users', 'wos/identity/admin/users/response'),
  ]);
  if (stats) state.stats = stats;
  if (users) state.users = users.users;
  state.error = (!stats && !users) ? 'Plugin not responding' : null;
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function fmtDate(iso) {
  if (!iso) return '--';
  return new Date(iso).toLocaleString();
}

function render(container) {
  const s = state.stats;
  const users = state.users || [];

  const byRoleHtml = s?.byRole
    ? Object.entries(s.byRole).map(([role, count]) =>
      `<span class="badge badge-running" style="margin-right:4px">${esc(role)}: ${count}</span>`
    ).join('')
    : '--';

  const userRows = users.map(u => `
    <tr>
      <td>${esc(u.username)}</td>
      <td>${esc(u.displayName)}</td>
      <td>${esc(u.email)}</td>
      <td><span class="badge badge-${u.role === 'admin' ? 'running' : 'stopped'}">${esc(u.role)}</span></td>
      <td style="font-size:0.85em;color:var(--text-muted)">${fmtDate(u.createdAt)}</td>
      <td style="font-size:0.85em;color:var(--text-muted)">${fmtDate(u.lastLoginAt)}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div style="padding:16px;display:flex;flex-direction:column;gap:16px">
      ${state.error ? `<div style="padding:12px;background:var(--danger-bg,#3a1a1a);border:1px solid var(--danger-border,#ff4444);border-radius:8px;color:#ff6b6b">${esc(state.error)}</div>` : ''}

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">
        <div class="stat-card">
          <span class="stat-label">Total Users</span>
          <span class="stat-value accent">${s?.totalUsers ?? '--'}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Active Sessions</span>
          <span class="stat-value green">${s?.activeSessions ?? '--'}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">By Role</span>
          <span class="stat-value" style="font-size:0.9em">${byRoleHtml}</span>
        </div>
      </div>

      <div class="section">
        <div class="section-header" style="display:flex;justify-content:space-between;align-items:center">
          <span class="section-title">Registered Users</span>
          <button class="btn btn-accent" onclick="document.getElementById('identityRegForm').style.display = document.getElementById('identityRegForm').style.display === 'none' ? 'flex' : 'none'">+ Register User</button>
        </div>

        <form id="identityRegForm" style="display:none;gap:8px;align-items:flex-end;flex-wrap:wrap;padding:12px 0" onsubmit="return false;">
          <input name="username" placeholder="Username" required style="padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);min-width:120px">
          <input name="email" placeholder="Email" type="email" required style="padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);min-width:160px">
          <input name="password" placeholder="Password" type="password" required minlength="8" style="padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);min-width:120px">
          <select name="role" style="padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text)">
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          <button class="btn btn-accent" id="identityRegBtn" type="submit">Create</button>
          <span id="identityRegMsg" style="color:var(--text-muted);font-size:0.85em"></span>
        </form>

        ${users.length ? `
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:0.9em">
              <thead>
                <tr style="border-bottom:1px solid var(--border);text-align:left">
                  <th style="padding:8px;color:var(--text-muted);font-weight:500">Username</th>
                  <th style="padding:8px;color:var(--text-muted);font-weight:500">Display Name</th>
                  <th style="padding:8px;color:var(--text-muted);font-weight:500">Email</th>
                  <th style="padding:8px;color:var(--text-muted);font-weight:500">Role</th>
                  <th style="padding:8px;color:var(--text-muted);font-weight:500">Created</th>
                  <th style="padding:8px;color:var(--text-muted);font-weight:500">Last Login</th>
                </tr>
              </thead>
              <tbody>${userRows}</tbody>
            </table>
          </div>
        ` : '<div style="padding:24px;text-align:center;color:var(--text-muted)">No users registered yet</div>'}
      </div>

      <div class="settings-card">
        <h3 style="margin-top:0">Configuration</h3>
        <div class="setting-row"><span class="setting-key">MQTT Topics</span><span class="setting-val">wos/identity/*</span></div>
        <div class="setting-row"><span class="setting-key">Auth</span><span class="setting-val">JWT (access + refresh tokens)</span></div>
        <div class="setting-row"><span class="setting-key">Storage</span><span class="setting-val">SQLite (identity.db)</span></div>
      </div>
    </div>
  `;

  // Wire up registration form
  const form = container.querySelector('#identityRegForm');
  const btn = container.querySelector('#identityRegBtn');
  const msgEl = container.querySelector('#identityRegMsg');
  if (form && btn) {
    btn.onclick = async () => {
      const fd = new FormData(form);
      const username = fd.get('username');
      const email = fd.get('email');
      const password = fd.get('password');
      if (!username || !email || !password) return;
      btn.disabled = true;
      msgEl.textContent = 'Registering...';
      const result = await request('wos/identity/auth/register', 'wos/identity/auth/register/response', {
        username, email, password, displayName: username,
      });
      btn.disabled = false;
      if (result?.error) {
        msgEl.textContent = result.error;
        msgEl.style.color = '#ff6b6b';
      } else if (result?.user) {
        msgEl.textContent = `Created user: ${result.user.username}`;
        msgEl.style.color = 'var(--accent)';
        form.reset();
        await fetchData();
        render(container);
      } else {
        msgEl.textContent = 'No response from plugin';
        msgEl.style.color = '#ff6b6b';
      }
    };
  }
}
