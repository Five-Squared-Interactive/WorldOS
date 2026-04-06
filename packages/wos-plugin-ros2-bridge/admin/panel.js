/**
 * ROS2 Bridge Admin Panel
 *
 * Renders connected robots, topic flow, and service call history.
 * Loaded by the WOS admin framework via the manifest entrypoint.
 */

/** Escape HTML entities to prevent XSS */
function esc(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

export function render(container, api) {
  container.innerHTML = `
    <div class="ros2-bridge-panel">
      <h2>ROS2 Bridge</h2>
      <div id="ros2-status-loading">Loading...</div>
      <div id="ros2-robots" style="display:none"></div>
      <div id="ros2-topics" style="display:none"></div>
      <div id="ros2-services" style="display:none"></div>
    </div>
  `;

  refresh(container, api);
  // Auto-refresh every 5 seconds
  const interval = setInterval(() => refresh(container, api), 5000);

  return {
    destroy() {
      clearInterval(interval);
    },
  };
}

async function refresh(container, api) {
  try {
    const data = await api.getPluginStatus('ros2-bridge');
    const loading = container.querySelector('#ros2-status-loading');
    if (loading) loading.style.display = 'none';

    renderRobots(container, data.robots || []);
    renderTopics(container, data.robots || []);
    renderServices(container, data.robots || []);
  } catch (err) {
    const loading = container.querySelector('#ros2-status-loading');
    if (loading) loading.textContent = 'Failed to load status: ' + err.message;
  }
}

function renderRobots(container, robots) {
  const el = container.querySelector('#ros2-robots');
  el.style.display = 'block';

  const rows = robots
    .map(
      (r) => `
    <tr>
      <td>${esc(r.name || r.robotName)}</td>
      <td>${esc(r.url || 'N/A')}</td>
      <td class="state-${esc(r.state)}">${esc(r.state)}</td>
      <td>${r.latencyMs != null ? esc(r.latencyMs) + 'ms' : 'N/A'}</td>
    </tr>
  `,
    )
    .join('');

  el.innerHTML = `
    <h3>Connected Robots</h3>
    <table>
      <thead><tr><th>Name</th><th>URL</th><th>State</th><th>Latency</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">No robots</td></tr>'}</tbody>
    </table>
  `;
}

function renderTopics(container, robots) {
  const el = container.querySelector('#ros2-topics');
  el.style.display = 'block';

  const allTopics = robots.flatMap((r) =>
    (r.topics || []).map((t) => ({ robot: r.name || r.robotName, ...t })),
  );

  const rows = allTopics
    .map(
      (t) => `
    <tr>
      <td>${esc(t.robot)}</td>
      <td>${esc(t.name)}</td>
      <td>${t.direction === 'ros-to-mqtt' ? 'ROS→MQTT' : 'MQTT→ROS'}</td>
      <td>${esc(t.messageCount)}</td>
      <td>${t.lastMessageAt ? esc(new Date(t.lastMessageAt).toLocaleTimeString()) : 'never'}</td>
    </tr>
  `,
    )
    .join('');

  el.innerHTML = `
    <h3>Topic Flow</h3>
    <table>
      <thead><tr><th>Robot</th><th>Topic</th><th>Direction</th><th>Messages</th><th>Last</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">No topics</td></tr>'}</tbody>
    </table>
  `;
}

function renderServices(container, robots) {
  const el = container.querySelector('#ros2-services');
  el.style.display = 'block';

  const rows = robots
    .map(
      (r) => `
    <tr>
      <td>${esc(r.name || r.robotName)}</td>
      <td>${esc(r.serviceCallCount || 0)}</td>
      <td>${esc(r.serviceErrorCount || 0)}</td>
    </tr>
  `,
    )
    .join('');

  el.innerHTML = `
    <h3>Service Calls</h3>
    <table>
      <thead><tr><th>Robot</th><th>Total Calls</th><th>Errors</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3">No service calls</td></tr>'}</tbody>
    </table>
  `;
}
