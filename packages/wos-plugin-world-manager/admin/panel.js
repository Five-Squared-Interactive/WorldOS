/** World Manager Plugin — Admin Panel */
import { request, connect } from '/wos-mqtt.js';

let interval;
let state = { data: null, error: null, editingEntity: null, editingTemplate: null, msg: null };

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
    'wos/world-manager/admin/stats',
    'wos/world-manager/admin/stats/response',
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

function fmtPos(pos) {
  if (!pos) return '--';
  if (typeof pos === 'string') {
    try { pos = JSON.parse(pos); } catch { return esc(pos); }
  }
  if (pos.x !== undefined) return `${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`;
  return esc(JSON.stringify(pos));
}

function parseProps(str) {
  if (!str || !str.trim()) return {};
  try { return JSON.parse(str); } catch { return null; }
}

function propsToStr(obj) {
  if (!obj || typeof obj !== 'object') return '';
  if (typeof obj === 'string') return obj;
  return JSON.stringify(obj, null, 2);
}

// ── MQTT Actions ──

async function createEntity(container, form) {
  const fd = new FormData(form);
  const name = fd.get('name')?.trim();
  const type = fd.get('type')?.trim() || 'object';
  const props = parseProps(fd.get('properties'));
  if (props === null) { showMsg(container, 'Invalid JSON in properties', true); return; }

  const payload = {
    type,
    properties: { name, ...props },
    position: {
      x: parseFloat(fd.get('px')) || 0,
      y: parseFloat(fd.get('py')) || 0,
      z: parseFloat(fd.get('pz')) || 0,
    },
    owner: fd.get('owner')?.trim() || undefined,
  };
  const result = await request('wos/world-manager/entity/create', 'wos/world-manager/entity/create/response', payload);
  if (result?.error) { showMsg(container, result.error, true); return; }
  showMsg(container, `Entity created: ${result?.id?.slice(0, 8)}...`);
  form.reset();
  await fetchData();
  render(container);
}

async function updateEntity(container, form, id) {
  const fd = new FormData(form);
  const props = parseProps(fd.get('properties'));
  if (props === null) { showMsg(container, 'Invalid JSON in properties', true); return; }

  const payload = {
    id,
    properties: props,
    position: {
      x: parseFloat(fd.get('px')) || 0,
      y: parseFloat(fd.get('py')) || 0,
      z: parseFloat(fd.get('pz')) || 0,
    },
    owner: fd.get('owner')?.trim() || undefined,
  };
  const result = await request('wos/world-manager/entity/update', 'wos/world-manager/entity/update/response', payload);
  if (result?.error) { showMsg(container, result.error, true); return; }
  showMsg(container, `Entity updated`);
  state.editingEntity = null;
  await fetchData();
  render(container);
}

async function deleteEntity(container, id, name) {
  if (!confirm(`Delete entity "${name || id}"?`)) return;
  const result = await request('wos/world-manager/entity/delete', 'wos/world-manager/entity/delete/response', { id });
  if (result?.error) { showMsg(container, result.error, true); return; }
  showMsg(container, 'Entity deleted');
  await fetchData();
  render(container);
}

async function createTemplate(container, form) {
  const fd = new FormData(form);
  const name = fd.get('name')?.trim();
  if (!name) { showMsg(container, 'Name is required', true); return; }
  const type = fd.get('type')?.trim() || 'object';
  const props = parseProps(fd.get('properties'));
  if (props === null) { showMsg(container, 'Invalid JSON in properties', true); return; }

  const payload = {
    name, type,
    properties: Object.keys(props).length ? props : undefined,
    defaultPosition: {
      x: parseFloat(fd.get('px')) || 0,
      y: parseFloat(fd.get('py')) || 0,
      z: parseFloat(fd.get('pz')) || 0,
    },
  };
  const result = await request('wos/world-manager/template/create', 'wos/world-manager/template/create/response', payload);
  if (result?.error) { showMsg(container, result.error, true); return; }
  showMsg(container, `Template created: ${result?.name}`);
  form.reset();
  await fetchData();
  render(container);
}

async function deleteTemplate(container, id, name) {
  if (!confirm(`Delete template "${name || id}"?`)) return;
  const result = await request('wos/world-manager/template/delete', 'wos/world-manager/template/delete/response', { id });
  if (result?.error) { showMsg(container, result.error, true); return; }
  showMsg(container, 'Template deleted');
  await fetchData();
  render(container);
}

async function instantiateTemplate(container, templateId) {
  const result = await request('wos/world-manager/template/instantiate', 'wos/world-manager/template/instantiate/response', { templateId });
  if (result?.error) { showMsg(container, result.error, true); return; }
  showMsg(container, `Entity spawned from template: ${result?.id?.slice(0, 8)}...`);
  await fetchData();
  render(container);
}

function showMsg(container, text, isError) {
  state.msg = { text, isError, ts: Date.now() };
  const el = container.querySelector('#wmMsg');
  if (el) {
    el.textContent = text;
    el.style.color = isError ? '#ff6b6b' : 'var(--accent)';
  }
}

// ── Styles ──

const inputStyle = 'padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);width:100%';
const smallInputStyle = 'padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);width:70px;text-align:center';
const btnSmall = 'padding:4px 10px;border-radius:4px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text);cursor:pointer;font-size:0.85em';

// ── Render ──

function render(container) {
  const d = state.data;
  const world = d?.world;
  const entities = d?.entities || [];
  const templates = d?.templates || [];
  const msgHtml = state.msg && (Date.now() - state.msg.ts < 8000)
    ? `<span id="wmMsg" style="color:${state.msg.isError ? '#ff6b6b' : 'var(--accent)'};font-size:0.85em">${esc(state.msg.text)}</span>`
    : '<span id="wmMsg"></span>';

  container.innerHTML = `
    <div style="padding:16px;display:flex;flex-direction:column;gap:16px">
      ${state.error ? `<div style="padding:12px;background:var(--danger-bg,#3a1a1a);border:1px solid var(--danger-border,#ff4444);border-radius:8px;color:#ff6b6b">${esc(state.error)}</div>` : ''}

      <div style="display:flex;justify-content:space-between;align-items:center">
        ${msgHtml}
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">
        <div class="stat-card">
          <span class="stat-label">World</span>
          <span class="stat-value accent">${esc(world?.name) || '--'}</span>
          <span class="stat-sub">${esc(world?.type) || ''} ${world?.owner ? '/ ' + esc(world.owner) : ''}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Entities</span>
          <span class="stat-value green">${d?.entityCount ?? '--'}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Templates</span>
          <span class="stat-value">${d?.templateCount ?? '--'}</span>
        </div>
      </div>

      <!-- Templates Section -->
      <div class="section">
        <div class="section-header" style="display:flex;justify-content:space-between;align-items:center">
          <span class="section-title">Templates</span>
          <button class="btn btn-accent" id="wmToggleTemplateForm" style="${btnSmall}">+ New Template</button>
        </div>

        <form id="wmTemplateForm" style="display:none;gap:8px;padding:12px 0;flex-wrap:wrap;align-items:flex-end" onsubmit="return false;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%">
            <input name="name" placeholder="Template name" required style="${inputStyle}">
            <input name="type" placeholder="Type (default: object)" style="${inputStyle}">
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
            <span style="color:var(--text-muted);font-size:0.85em;white-space:nowrap">Default pos:</span>
            <input name="px" placeholder="X" type="number" step="any" value="0" style="${smallInputStyle}">
            <input name="py" placeholder="Y" type="number" step="any" value="0" style="${smallInputStyle}">
            <input name="pz" placeholder="Z" type="number" step="any" value="0" style="${smallInputStyle}">
          </div>
          <textarea name="properties" placeholder='Properties JSON (e.g. {"health": 100})' rows="2" style="${inputStyle};margin-top:8px;font-family:monospace;font-size:0.85em;resize:vertical"></textarea>
          <div style="margin-top:8px"><button class="btn btn-accent" id="wmCreateTemplateBtn" type="submit">Create Template</button></div>
        </form>

        ${templates.length ? `
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px">
            ${templates.map(t => {
              const props = t.properties ? (typeof t.properties === 'string' ? JSON.parse(t.properties) : t.properties) : {};
              const propKeys = Object.keys(props);
              return `
              <div class="plugin-card" style="padding:12px">
                <div class="plugin-card-header" style="margin-bottom:6px">
                  <span class="plugin-name">${esc(t.name)}</span>
                  <span class="badge badge-running">${esc(t.type || 'object')}</span>
                </div>
                <div style="font-size:0.85em;color:var(--text-muted)">
                  ${propKeys.length ? propKeys.length + ' properties' : 'no properties'}
                </div>
                ${propKeys.length ? `<div style="font-size:0.8em;color:var(--text-muted);margin-top:4px;font-family:monospace;max-height:60px;overflow:auto">${esc(JSON.stringify(props))}</div>` : ''}
                <div style="margin-top:8px;display:flex;gap:6px">
                  <button class="btn btn-accent" data-action="instantiate-template" data-id="${esc(t.id)}" style="${btnSmall}">Spawn Entity</button>
                  <button class="btn" data-action="delete-template" data-id="${esc(t.id)}" data-name="${esc(t.name)}" style="${btnSmall};color:#ff6b6b">Delete</button>
                </div>
              </div>
            `;}).join('')}
          </div>
        ` : '<div style="padding:24px;text-align:center;color:var(--text-muted)">No templates defined</div>'}
      </div>

      <!-- Entities Section -->
      <div class="section">
        <div class="section-header" style="display:flex;justify-content:space-between;align-items:center">
          <span class="section-title">Entities</span>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="color:var(--text-muted);font-size:0.85em">${entities.length < (d?.entityCount || 0) ? `showing ${entities.length} of ${d.entityCount}` : ''}</span>
            <button class="btn btn-accent" id="wmToggleEntityForm" style="${btnSmall}">+ New Entity</button>
          </div>
        </div>

        <form id="wmEntityForm" style="display:none;gap:8px;padding:12px 0;flex-wrap:wrap;align-items:flex-end" onsubmit="return false;">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;width:100%">
            <input name="name" placeholder="Entity name" required style="${inputStyle}">
            <input name="type" placeholder="Type (default: object)" style="${inputStyle}">
            <input name="owner" placeholder="Owner (optional)" style="${inputStyle}">
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
            <span style="color:var(--text-muted);font-size:0.85em;white-space:nowrap">Position:</span>
            <input name="px" placeholder="X" type="number" step="any" value="0" style="${smallInputStyle}">
            <input name="py" placeholder="Y" type="number" step="any" value="0" style="${smallInputStyle}">
            <input name="pz" placeholder="Z" type="number" step="any" value="0" style="${smallInputStyle}">
          </div>
          <textarea name="properties" placeholder='Properties JSON (e.g. {"health": 100, "speed": 5})' rows="2" style="${inputStyle};margin-top:8px;font-family:monospace;font-size:0.85em;resize:vertical"></textarea>
          <div style="margin-top:8px"><button class="btn btn-accent" id="wmCreateEntityBtn" type="submit">Create Entity</button></div>
        </form>

        ${entities.length ? `
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:0.9em">
              <thead>
                <tr style="border-bottom:1px solid var(--border);text-align:left">
                  <th style="padding:8px;color:var(--text-muted);font-weight:500">Name</th>
                  <th style="padding:8px;color:var(--text-muted);font-weight:500">Type</th>
                  <th style="padding:8px;color:var(--text-muted);font-weight:500">Position</th>
                  <th style="padding:8px;color:var(--text-muted);font-weight:500">Properties</th>
                  <th style="padding:8px;color:var(--text-muted);font-weight:500;width:140px">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${entities.map(e => {
                  const props = typeof e.properties === 'string' ? JSON.parse(e.properties || '{}') : (e.properties || {});
                  const name = props.name || e.name || e.id?.slice(0, 8);
                  const isEditing = state.editingEntity === e.id;
                  const pos = typeof e.position === 'string' ? JSON.parse(e.position) : (e.position || {});

                  if (isEditing) {
                    return `
                    <tr style="border-bottom:1px solid var(--border);background:var(--bg-secondary)" data-edit-row="${esc(e.id)}">
                      <td colspan="5" style="padding:8px">
                        <form id="wmEditEntityForm" onsubmit="return false;" style="display:flex;flex-direction:column;gap:8px">
                          <div style="display:flex;gap:8px;align-items:center">
                            <span style="color:var(--text-muted);font-size:0.85em;white-space:nowrap">Position:</span>
                            <input name="px" type="number" step="any" value="${pos.x ?? 0}" style="${smallInputStyle}">
                            <input name="py" type="number" step="any" value="${pos.y ?? 0}" style="${smallInputStyle}">
                            <input name="pz" type="number" step="any" value="${pos.z ?? 0}" style="${smallInputStyle}">
                            <input name="owner" placeholder="Owner" value="${esc(e.owner || '')}" style="${inputStyle};max-width:150px">
                          </div>
                          <textarea name="properties" rows="3" style="${inputStyle};font-family:monospace;font-size:0.85em;resize:vertical">${esc(propsToStr(props))}</textarea>
                          <div style="display:flex;gap:6px">
                            <button class="btn btn-accent" data-action="save-entity" data-id="${esc(e.id)}" style="${btnSmall}">Save</button>
                            <button class="btn" data-action="cancel-edit" style="${btnSmall}">Cancel</button>
                          </div>
                        </form>
                      </td>
                    </tr>`;
                  }

                  return `
                    <tr style="border-bottom:1px solid var(--border)">
                      <td style="padding:8px">${esc(name)}</td>
                      <td style="padding:8px"><span class="badge badge-running">${esc(e.type || 'object')}</span></td>
                      <td style="padding:8px;font-family:monospace;font-size:0.85em">${fmtPos(e.position)}</td>
                      <td style="padding:8px;font-size:0.85em;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted);font-family:monospace" title="${esc(JSON.stringify(props))}">${esc(JSON.stringify(props))}</td>
                      <td style="padding:8px">
                        <div style="display:flex;gap:4px">
                          <button class="btn" data-action="edit-entity" data-id="${esc(e.id)}" style="${btnSmall}">Edit</button>
                          <button class="btn" data-action="delete-entity" data-id="${esc(e.id)}" data-name="${esc(name)}" style="${btnSmall};color:#ff6b6b">Delete</button>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : '<div style="padding:24px;text-align:center;color:var(--text-muted)">No entities in world</div>'}
      </div>

      <div class="settings-card">
        <h3 style="margin-top:0">Configuration</h3>
        <div class="setting-row"><span class="setting-key">MQTT Topics</span><span class="setting-val">wos/world-manager/*</span></div>
        <div class="setting-row"><span class="setting-key">World</span><span class="setting-val">${esc(world?.name)} (${esc(world?.type)})</span></div>
        <div class="setting-row"><span class="setting-key">Storage</span><span class="setting-val">SQLite (world.db)</span></div>
      </div>
    </div>
  `;

  // Wire up event handlers (remove old listener first to prevent stacking)
  if (container._wmClickHandler) {
    container.removeEventListener('click', container._wmClickHandler);
  }
  wireHandlers(container);
}

function wireHandlers(container) {
  // Toggle forms
  const toggleEntity = container.querySelector('#wmToggleEntityForm');
  const entityForm = container.querySelector('#wmEntityForm');
  if (toggleEntity && entityForm) {
    toggleEntity.onclick = () => {
      entityForm.style.display = entityForm.style.display === 'none' ? 'flex' : 'none';
    };
  }

  const toggleTemplate = container.querySelector('#wmToggleTemplateForm');
  const templateForm = container.querySelector('#wmTemplateForm');
  if (toggleTemplate && templateForm) {
    toggleTemplate.onclick = () => {
      templateForm.style.display = templateForm.style.display === 'none' ? 'flex' : 'none';
    };
  }

  // Create entity
  const createEntityBtn = container.querySelector('#wmCreateEntityBtn');
  if (createEntityBtn && entityForm) {
    createEntityBtn.onclick = () => createEntity(container, entityForm);
  }

  // Create template
  const createTemplateBtn = container.querySelector('#wmCreateTemplateBtn');
  if (createTemplateBtn && templateForm) {
    createTemplateBtn.onclick = () => createTemplate(container, templateForm);
  }

  // Delegated click handler for action buttons (stored to allow removal)
  const handler = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const name = btn.dataset.name;

    switch (action) {
      case 'edit-entity':
        state.editingEntity = id;
        render(container);
        break;
      case 'cancel-edit':
        state.editingEntity = null;
        render(container);
        break;
      case 'save-entity': {
        const form = container.querySelector('#wmEditEntityForm');
        if (form) updateEntity(container, form, id);
        break;
      }
      case 'delete-entity':
        deleteEntity(container, id, name);
        break;
      case 'delete-template':
        deleteTemplate(container, id, name);
        break;
      case 'instantiate-template':
        instantiateTemplate(container, id);
        break;
    }
  };
  container._wmClickHandler = handler;
  container.addEventListener('click', handler);
}
