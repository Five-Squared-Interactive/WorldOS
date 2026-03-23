// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.
// Messaging dashboard card — renders total messages and channels.

export function render(container, data) {
  container.innerHTML = `
    <div class="messaging-card">
      <h3>Messaging</h3>
      <p>Messages: ${data?.totalMessages ?? 0}</p>
      <p>Channels: ${data?.totalChannels ?? 0}</p>
    </div>
  `;
}
