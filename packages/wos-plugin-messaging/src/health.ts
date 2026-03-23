// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import type { MessageStore } from './message-store.js';
import type { ChannelStore } from './channel-store.js';
import type { MessagingStats } from './types.js';

interface HealthResult {
  status: 'ok' | 'degraded' | 'unhealthy';
  details: MessagingStats & { error?: string };
}

export function collectHealthStatus(messageStore: MessageStore, channelStore: ChannelStore): HealthResult {
  try {
    const messageStats = messageStore.getStats();
    const channelMetrics = channelStore.getHealthMetrics();

    return {
      status: 'ok',
      details: {
        totalMessages: messageStats.totalMessages,
        dmConversationCount: messageStats.dmConversationCount,
        totalChannels: channelMetrics.totalChannels,
        worldCount: channelMetrics.worldCount,
      },
    };
  } catch {
    return {
      status: 'unhealthy',
      details: {
        totalMessages: 0,
        totalChannels: 0,
        worldCount: 0,
        dmConversationCount: 0,
        error: 'Database query failed',
      },
    };
  }
}
