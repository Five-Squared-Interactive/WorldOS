// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

/**
 * Identity Dashboard Card
 *
 * Shows total users count and active sessions count on the admin dashboard.
 */

export default {
  name: 'identity-card',

  template: `
    <div class="identity-card">
      <h3>Users & Sessions</h3>
      <div class="card-metrics">
        <div class="metric">
          <span class="metric-value" id="identity-total-users">-</span>
          <span class="metric-label">Total Users</span>
        </div>
        <div class="metric">
          <span class="metric-value" id="identity-active-sessions">-</span>
          <span class="metric-label">Active Sessions</span>
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
