// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.
// Container Manager Admin Panel (browser-served)

export function render(container) {
  container.innerHTML = `
    <div class="container-manager-panel">
      <h2>Container Manager</h2>
      <div id="services-section">
        <h3>Services</h3>
        <div id="services-list">Loading...</div>
      </div>
      <div id="instances-section">
        <h3>Instances</h3>
        <table id="instance-table">
          <thead>
            <tr><th>Service</th><th>Instance</th><th>Status</th><th>Ports</th><th>Actions</th></tr>
          </thead>
          <tbody id="instance-list"></tbody>
        </table>
      </div>
    </div>
  `;
}

export async function init(api) {
  // Placeholder — will fetch service/instance status via admin API
}
