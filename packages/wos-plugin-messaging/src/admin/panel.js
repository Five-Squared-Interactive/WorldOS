// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.
// Messaging admin panel — channel list and message stats.

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function render(container, data) {
  const channels = data?.channels ?? [];
  const channelRows = channels.map(
    (ch) => `<tr><td>${esc(ch.name)}</td><td>${esc(ch.channelId)}</td><td>${esc(ch.createdBy)}</td></tr>`
  ).join('');

  container.innerHTML = `
    <div class="messaging-panel">
      <h2>Messaging</h2>
      <section>
        <h3>Channels</h3>
        <table>
          <thead><tr><th>Name</th><th>ID</th><th>Created By</th></tr></thead>
          <tbody>${channelRows || '<tr><td colspan="3">No channels</td></tr>'}</tbody>
        </table>
      </section>
      <section>
        <h3>Stats</h3>
        <p>Total Messages: ${Number(data?.totalMessages ?? 0)}</p>
        <p>Total Channels: ${Number(data?.totalChannels ?? 0)}</p>
        <p>DM Conversations: ${Number(data?.dmConversationCount ?? 0)}</p>
      </section>
    </div>
  `;
}
