// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.
// World Manager Admin Panel (browser-served)

export function render(container) {
  container.innerHTML = `
    <div class="world-manager-panel">
      <h2>World Manager</h2>
      <div id="world-info">
        <h3>World Info</h3>
        <div id="world-details">Loading...</div>
      </div>
      <div id="entity-browser">
        <h3>Entities</h3>
        <table id="entity-table">
          <thead>
            <tr><th>ID</th><th>Type</th><th>Position</th><th>Owner</th></tr>
          </thead>
          <tbody id="entity-list"></tbody>
        </table>
      </div>
      <div id="template-list">
        <h3>Entity Templates</h3>
        <ul id="templates"></ul>
      </div>
    </div>
  `;
}

export async function init(api) {
  // Placeholder — will fetch world info via admin API
}
