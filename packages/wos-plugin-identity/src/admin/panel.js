// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

/**
 * Identity Admin Panel
 *
 * User management page: list users, create user form, edit role, delete user.
 * Communicates with identity plugin via MQTT through the admin server's API proxy.
 */

export default {
  name: 'identity-panel',

  template: `
    <div class="identity-panel">
      <h2>User Identity Management</h2>

      <div class="panel-actions">
        <button onclick="identityPanel.refresh()">Refresh</button>
        <button onclick="identityPanel.showCreateForm()">Create User</button>
      </div>

      <div id="identity-create-form" style="display:none;">
        <h3>Create User</h3>
        <form onsubmit="return identityPanel.createUser(event)">
          <label>Username: <input name="username" required minlength="3" maxlength="32" /></label>
          <label>Email: <input name="email" type="email" required /></label>
          <label>Password: <input name="password" type="password" required minlength="8" /></label>
          <label>Display Name: <input name="displayName" required /></label>
          <label>Role:
            <select name="role">
              <option value="user">User</option>
              <option value="admin">Admin</option>
              <option value="guest">Guest</option>
            </select>
          </label>
          <button type="submit">Create</button>
          <button type="button" onclick="identityPanel.hideCreateForm()">Cancel</button>
        </form>
      </div>

      <table id="identity-users-table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Email</th>
            <th>Display Name</th>
            <th>Role</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="identity-users-body"></tbody>
      </table>
    </div>
  `,

  init() {
    this.refresh();
  },

  async refresh() {
    // Placeholder — actual implementation communicates via admin API proxy
  },

  showCreateForm() {
    document.getElementById('identity-create-form').style.display = 'block';
  },

  hideCreateForm() {
    document.getElementById('identity-create-form').style.display = 'none';
  },

  async createUser(event) {
    event.preventDefault();
    // Placeholder — actual implementation sends MQTT request via admin API proxy
  },
};
