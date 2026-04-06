// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

/**
 * Sync Manager Dashboard Card
 *
 * Shows active sessions, connected clients, and total entities on the admin dashboard.
 */

export default {
  name: 'sync-manager-card',

  template: `
    <div class="sync-manager-card">
      <h3>Sync Sessions</h3>
      <div class="card-metrics">
        <div class="metric">
          <span class="metric-value" id="sync-active-sessions">-</span>
          <span class="metric-label">Active Sessions</span>
        </div>
        <div class="metric">
          <span class="metric-value" id="sync-connected-clients">-</span>
          <span class="metric-label">Connected Clients</span>
        </div>
        <div class="metric">
          <span class="metric-value" id="sync-total-entities">-</span>
          <span class="metric-label">Total Entities</span>
        </div>
      </div>
    </div>
  `,

  init() {
    this.refresh();
  },

  async refresh() {
    // Placeholder — actual implementation fetches metrics via admin API proxy
  },
};
