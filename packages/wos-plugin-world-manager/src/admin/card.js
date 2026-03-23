// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.
// World Manager Dashboard Card (browser-served)

export function render(container) {
  container.innerHTML = `
    <div class="world-card">
      <div class="card-title">World Status</div>
      <div id="world-card-content">Loading...</div>
    </div>
  `;
}

export async function init(api) {
  // Placeholder — will show world name, type, entity count
}
