// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

export interface MessageRecord {
  messageId: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: string;
}

export interface ChannelRecord {
  channelId: string;
  name: string;
  worldId: string;
  createdBy: string;
  createdAt: string;
  description: string;
}

export interface MessageListResult {
  messages: MessageRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface ChannelListResult {
  channels: ChannelRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface MessagingStats {
  totalMessages: number;
  totalChannels: number;
  worldCount: number;
  dmConversationCount: number;
}

export type ConversationType = 'channel' | 'dm';
