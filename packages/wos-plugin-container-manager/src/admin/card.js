// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.
// Container Manager Dashboard Card (browser-served)

export function render(container) {
  container.innerHTML = `
    <div class="container-card">
      <div class="card-title">Container Status</div>
      <div id="container-card-content">Loading...</div>
    </div>
  `;
}

export async function init(api) {
  // Placeholder — will show running instance count, service count
}
