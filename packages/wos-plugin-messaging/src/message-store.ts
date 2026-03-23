// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import type Database from 'better-sqlite3';
import type { MessageRecord, MessageListResult } from './types.js';

const DDL = `
CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);
`;

export class MessageStore {
  private db: Database.Database;
  private stmtInsert;
  private stmtCountByConversation;
  private stmtListByConversation;
  private stmtDeleteByConversation;
  private stmtEnforceRetention;

  constructor(db: Database.Database) {
    this.db = db;

    db.pragma('journal_mode = WAL');
    db.exec(DDL);

    this.stmtInsert = db.prepare(`
      INSERT INTO messages (message_id, conversation_id, sender_id, content, created_at)
      VALUES (@messageId, @conversationId, @senderId, @content, @createdAt)
    `);
    this.stmtCountByConversation = db.prepare('SELECT COUNT(*) AS cnt FROM messages WHERE conversation_id = ?');
    this.stmtListByConversation = db.prepare(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    );
    this.stmtDeleteByConversation = db.prepare('DELETE FROM messages WHERE conversation_id = ?');
    this.stmtEnforceRetention = db.prepare(`
      DELETE FROM messages WHERE message_id IN (
        SELECT message_id FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?
      )
    `);
  }

  createMessage(record: MessageRecord): MessageRecord {
    this.stmtInsert.run(record);
    return record;
  }

  listMessages(conversationId: string, options: { limit?: number; offset?: number }): MessageListResult {
    const limit = Math.min(Math.max(1, options.limit ?? 50), 200);
    const offset = Math.max(0, options.offset ?? 0);

    const countRow = this.stmtCountByConversation.get(conversationId) as { cnt: number };
    const rows = this.stmtListByConversation.all(conversationId, limit, offset) as any[];

    return {
      messages: rows.map(r => this.rowToRecord(r)),
      total: countRow.cnt,
      limit,
      offset,
    };
  }

  getMessageCount(conversationId: string): number {
    const row = this.stmtCountByConversation.get(conversationId) as { cnt: number };
    return row.cnt;
  }

  enforceRetention(conversationId: string, limit: number): void {
    const count = this.getMessageCount(conversationId);
    if (count > limit) {
      this.stmtEnforceRetention.run(conversationId, count - limit);
    }
  }

  deleteMessagesByConversation(conversationId: string): void {
    this.stmtDeleteByConversation.run(conversationId);
  }

  getStats(): { totalMessages: number; dmConversationCount: number } {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS totalMessages,
             COUNT(DISTINCT CASE WHEN conversation_id LIKE 'dm:%' THEN conversation_id END) AS dmConversationCount
      FROM messages
    `).get() as any;
    return {
      totalMessages: row.totalMessages,
      dmConversationCount: row.dmConversationCount,
    };
  }

  private rowToRecord(row: any): MessageRecord {
    return {
      messageId: row.message_id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      content: row.content,
      createdAt: row.created_at,
    };
  }
}
