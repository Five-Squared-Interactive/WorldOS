// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.
// Asset Manager Dashboard Card (browser-served)

export function render(container) {
  container.innerHTML = `
    <div class="asset-card">
      <div class="card-title">Asset Storage</div>
      <div id="asset-card-content">Loading...</div>
    </div>
  `;
}

export async function init(api) {
  // Placeholder — will show asset count, storage usage
}
