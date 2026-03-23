/** Messaging Plugin — Admin Panel */
import { request, connect, subscribe } from '/wos-mqtt.js';

let interval;
let state = { data: null, error: null, liveMessages: [], msg: null };
const MAX_LIVE = 50;

export async function mount(container) {
  try {
    await connect();
    subscribe('wos/messaging/deliver/channel/#', (msg) => {
      state.liveMessages.unshift({ ...msg, _ts: Date.now() });
      if (state.liveMessages.length > MAX_LIVE) state.liveMessages.length = MAX_LIVE;
      renderLiveFeed(container);
    });
    subscribe('wos/messaging/deliver/dm/#', (msg) => {
      state.liveMessages.unshift({ ...msg, _ts: Date.now(), _dm: true });
      if (state.liveMessages.length > MAX_LIVE) state.liveMessages.length = MAX_LIVE;
      renderLiveFeed(container);
    });
  } catch {
    state.error = 'MQTT bridge not available';
  }
  await fetchData();
  // Seed live feed from recent messages in DB
  if (state.data?.recentMessages?.length && !state.liveMessages.length) {
    state.liveMessages = state.data.recentMessages.map(m => ({
      senderId: m.sender_id,
      content: m.content,
      conversationId: m.conversation_id,
      _ts: new Date(m.created_at).getTime(),
      _dm: m.conversation_id?.startsWith('dm:'),
    })).reverse();
  }
  render(container);
  interval = setInterval(async () => {
    await fetchData();
    if (container.querySelector(':focus')) return;
    render(container);
  }, 5000);
}

export function unmount() {
  if (interval) { clearInterval(interval); interval = undefined; }
  state.liveMessages = [];
}

async function fetchData() {
  const data = await request(
    'wos/messaging/admin/stats',
    'wos/messaging/admin/stats/response',
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

function fmtDate(iso) {
  if (!iso) return '--';
  return new Date(iso).toLocaleString();
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function showMsg(container, text, isError) {
  state.msg = { text, isError, ts: Date.now() };
  const el = container.querySelector('#msgStatus');
  if (el) {
    el.textContent = text;
    el.style.color = isError ? '#ff6b6b' : 'var(--accent)';
  }
}

// ── Actions ──

async function createChannel(container, form) {
  const fd = new FormData(form);
  const name = fd.get('name')?.trim();
  const worldId = fd.get('worldId')?.trim() || 'default';
  const description = fd.get('description')?.trim() || '';
  if (!name) { showMsg(container, 'Channel name is required', true); return; }

  const result = await request('wos/messaging/admin/channel/create', 'wos/messaging/admin/channel/create/response', {
    worldId, name, description,
  });
  if (result?.error) { showMsg(container, `Error: ${result.error}`, true); return; }
  showMsg(container, `Channel #${name} created`);
  form.reset();
  await fetchData();
  render(container);
}

async function sendMessage(container, form) {
  const fd = new FormData(form);
  const conversationId = fd.get('channel')?.trim();
  const content = fd.get('content')?.trim();
  if (!conversationId) { showMsg(container, 'Select a channel', true); return; }
  if (!content) { showMsg(container, 'Message cannot be empty', true); return; }

  const result = await request('wos/messaging/admin/message/send', 'wos/messaging/admin/message/send/response', {
    conversationId, content,
  });
  if (result?.error) { showMsg(container, `Error: ${result.error}`, true); return; }
  // Clear just the content, keep channel selected
  const contentInput = form.querySelector('[name="content"]');
  if (contentInput) contentInput.value = '';
}

async function deleteChannel(container, channelId, name) {
  if (!confirm(`Delete channel #${name || channelId}? All messages will be lost.`)) return;

  const result = await request('wos/messaging/admin/channel/delete', 'wos/messaging/admin/channel/delete/response', {
    channelId,
  });
  if (result?.error) { showMsg(container, `Error: ${result.error}`, true); return; }
  showMsg(container, `Channel deleted`);
  await fetchData();
  render(container);
}

// ── Styles ──

const inputStyle = 'padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);width:100%';
const btnSmall = 'padding:4px 10px;border-radius:4px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);cursor:pointer;font-size:0.85em';

// ── Render ──

function renderLiveFeed(container) {
  const feed = container.querySelector('#msgLiveFeed');
  if (!feed) return;
  feed.innerHTML = state.liveMessages.length
    ? state.liveMessages.map(m => `
      <div style="padding:6px 10px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:baseline;font-size:0.9em">
        <span style="color:var(--text-muted);font-family:monospace;font-size:0.85em;flex-shrink:0">${fmtTime(m._ts)}</span>
        ${m._dm ? '<span class="badge badge-stopped" style="font-size:0.75em">DM</span>' : ''}
        <span style="color:var(--accent);font-weight:500">${esc(m.senderId)}</span>
        <span style="color:var(--text)">${esc(m.content)}</span>
      </div>
    `).join('')
    : '<div style="padding:24px;text-align:center;color:var(--text-muted)">No messages yet. Messages appear here in real-time.</div>';
}

function render(container) {
  const d = state.data;
  const channels = d?.channels || [];
  const recent = d?.recentMessages || [];
  const msgHtml = state.msg && (Date.now() - state.msg.ts < 8000)
    ? `<span id="msgStatus" style="color:${state.msg.isError ? '#ff6b6b' : 'var(--accent)'};font-size:0.85em">${esc(state.msg.text)}</span>`
    : '<span id="msgStatus"></span>';

  const channelOptions = channels.map(ch =>
    `<option value="${esc(ch.channel_id)}">#${esc(ch.name)}</option>`
  ).join('');

  container.innerHTML = `
    <div style="padding:16px;display:flex;flex-direction:column;gap:16px">
      ${state.error ? `<div style="padding:12px;background:var(--danger-bg,#3a1a1a);border:1px solid var(--danger-border,#ff4444);border-radius:8px;color:#ff6b6b">${esc(state.error)}</div>` : ''}

      <div style="display:flex;justify-content:space-between;align-items:center">
        ${msgHtml}
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">
        <div class="stat-card">
          <span class="stat-label">Channels</span>
          <span class="stat-value accent">${d?.totalChannels ?? '--'}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Total Messages</span>
          <span class="stat-value green">${d?.totalMessages ?? '--'}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">DM Threads</span>
          <span class="stat-value">${d?.dmConversationCount ?? '--'}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Worlds</span>
          <span class="stat-value">${d?.worldCount ?? '--'}</span>
        </div>
      </div>

      <!-- Send Message -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">Send Message</span>
        </div>
        <form id="msgSendForm" onsubmit="return false;" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;padding:4px 0">
          <select name="channel" style="${inputStyle};max-width:200px" ${!channels.length ? 'disabled' : ''}>
            ${channels.length ? channelOptions : '<option value="">No channels</option>'}
          </select>
          <input name="content" placeholder="Type a message..." style="${inputStyle};flex:1;min-width:200px" ${!channels.length ? 'disabled' : ''}>
          <button class="btn btn-accent" id="msgSendBtn" type="submit" ${!channels.length ? 'disabled' : ''}>Send</button>
        </form>
      </div>

      <!-- Live Feed -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">Live Message Feed</span>
          <span style="color:var(--text-muted);font-size:0.85em">Real-time via MQTT</span>
        </div>
        <div id="msgLiveFeed" style="max-height:240px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;background:var(--bg-secondary)">
          <div style="padding:24px;text-align:center;color:var(--text-muted)">No messages yet. Messages appear here in real-time.</div>
        </div>
      </div>

      <!-- Channels -->
      <div class="section">
        <div class="section-header" style="display:flex;justify-content:space-between;align-items:center">
          <span class="section-title">Channels</span>
          <button class="btn btn-accent" id="msgToggleChannelForm" style="${btnSmall}">+ New Channel</button>
        </div>

        <form id="msgChannelForm" style="display:none;gap:8px;padding:12px 0;flex-wrap:wrap;align-items:flex-end" onsubmit="return false;">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;width:100%">
            <input name="name" placeholder="Channel name" required style="${inputStyle}">
            <input name="worldId" placeholder="World ID (default)" value="default" style="${inputStyle}">
            <input name="description" placeholder="Description (optional)" style="${inputStyle}">
          </div>
          <div style="margin-top:8px"><button class="btn btn-accent" id="msgCreateChannelBtn" type="submit">Create Channel</button></div>
        </form>

        ${channels.length ? `
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px">
            ${channels.map(ch => `
              <div class="plugin-card" style="padding:12px">
                <div class="plugin-card-header" style="margin-bottom:4px">
                  <span class="plugin-name">#${esc(ch.name)}</span>
                  <span class="badge badge-running">${ch.message_count ?? 0} msgs</span>
                </div>
                <div style="font-size:0.85em;color:var(--text-muted)">
                  ${ch.description ? esc(ch.description) : 'No description'}
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
                  <span style="font-size:0.8em;color:var(--text-muted)">
                    ${esc(ch.created_by)} · ${fmtDate(ch.created_at)}
                  </span>
                  <button class="btn" data-action="delete-channel" data-id="${esc(ch.channel_id)}" data-name="${esc(ch.name)}" style="${btnSmall};color:#ff6b6b">Delete</button>
                </div>
              </div>
            `).join('')}
          </div>
        ` : '<div style="padding:24px;text-align:center;color:var(--text-muted)">No channels created</div>'}
      </div>

      <!-- Recent Messages -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">Recent Messages</span>
        </div>
        ${recent.length ? `
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:0.9em">
              <thead>
                <tr style="border-bottom:1px solid var(--border);text-align:left">
                  <th style="padding:8px;color:var(--text-muted);font-weight:500">Time</th>
                  <th style="padding:8px;color:var(--text-muted);font-weight:500">Channel</th>
                  <th style="padding:8px;color:var(--text-muted);font-weight:500">Sender</th>
                  <th style="padding:8px;color:var(--text-muted);font-weight:500">Content</th>
                </tr>
              </thead>
              <tbody>
                ${recent.map(m => `
                  <tr style="border-bottom:1px solid var(--border)">
                    <td style="padding:8px;color:var(--text-muted);font-size:0.85em;white-space:nowrap">${fmtDate(m.created_at)}</td>
                    <td style="padding:8px">${m.channel_name ? '#' + esc(m.channel_name) : (m.conversation_id?.startsWith('dm:') ? '<span class="badge badge-stopped">DM</span>' : esc(m.conversation_id))}</td>
                    <td style="padding:8px;color:var(--accent)">${esc(m.sender_id)}</td>
                    <td style="padding:8px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.content)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<div style="padding:24px;text-align:center;color:var(--text-muted)">No messages in database</div>'}
      </div>

      <div class="settings-card">
        <h3 style="margin-top:0">Configuration</h3>
        <div class="setting-row"><span class="setting-key">MQTT Topics</span><span class="setting-val">wos/messaging/*</span></div>
        <div class="setting-row"><span class="setting-key">Retention Limit</span><span class="setting-val">1000 messages per channel</span></div>
        <div class="setting-row"><span class="setting-key">Max Content Length</span><span class="setting-val">4000 chars</span></div>
        <div class="setting-row"><span class="setting-key">Storage</span><span class="setting-val">SQLite (messaging.db)</span></div>
      </div>
    </div>
  `;

  renderLiveFeed(container);

  // Wire handlers (remove old first to prevent stacking)
  if (container._msgClickHandler) {
    container.removeEventListener('click', container._msgClickHandler);
  }
  wireHandlers(container);
}

function wireHandlers(container) {
  // Toggle channel form
  const toggleBtn = container.querySelector('#msgToggleChannelForm');
  const channelForm = container.querySelector('#msgChannelForm');
  if (toggleBtn && channelForm) {
    toggleBtn.onclick = () => {
      channelForm.style.display = channelForm.style.display === 'none' ? 'flex' : 'none';
    };
  }

  // Create channel
  const createBtn = container.querySelector('#msgCreateChannelBtn');
  if (createBtn && channelForm) {
    createBtn.onclick = () => createChannel(container, channelForm);
  }

  // Send message
  const sendForm = container.querySelector('#msgSendForm');
  const sendBtn = container.querySelector('#msgSendBtn');
  if (sendBtn && sendForm) {
    sendBtn.onclick = () => sendMessage(container, sendForm);
    // Also send on Enter in the content input
    const contentInput = sendForm.querySelector('[name="content"]');
    if (contentInput) {
      contentInput.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage(container, sendForm);
        }
      };
    }
  }

  // Delegated click handler
  const handler = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'delete-channel') {
      deleteChannel(container, btn.dataset.id, btn.dataset.name);
    }
  };
  container._msgClickHandler = handler;
  container.addEventListener('click', handler);
}
