import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import type {
  ConversationRecord,
  ConversationStatus,
  MessageRecord,
  SearchHit,
  Speaker,
} from '../shared/types';

interface ConversationRow {
  id: number;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: number;
  conversation_id: number;
  speaker: string;
  content: string;
  created_at: string;
}

interface SearchRow extends MessageRow {
  title: string;
  snip: string | null;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  speaker TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
`;

// FTS5 external content パターン(trigram で日本語 3 文字以上の部分一致に対応)
const FTS_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='id',
  tokenize='trigram'
);
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
`;

export class Repository {
  private db!: Database.Database;

  private stmtInsertConversation!: Database.Statement;
  private stmtUpdateStatus!: Database.Statement;
  private stmtTouchConversation!: Database.Statement;
  private stmtInsertMessage!: Database.Statement;
  private stmtListConversations!: Database.Statement;
  private stmtGetMessages!: Database.Statement;
  private stmtSearchFts!: Database.Statement;
  private stmtSearchLike!: Database.Statement;

  private txAddMessage!: (
    conversationId: number,
    speaker: Speaker,
    content: string,
    now: string,
  ) => MessageRecord;

  constructor(private dbPath: string) {}

  init(): void {
    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.db.exec(SCHEMA_SQL);
    try {
      this.db.exec(FTS_SQL);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `messages_fts の作成に失敗しました。同梱の SQLite が FTS5 / trigram トークナイザに対応していない可能性があります: ${detail}`,
      );
    }

    // 前回クラッシュ等で残った実行中状態を復旧(v1 は再起動後の再開を保証しない)
    this.db
      .prepare("UPDATE conversations SET status = 'stopped' WHERE status IN ('running', 'paused')")
      .run();

    this.stmtInsertConversation = this.db.prepare(
      'INSERT INTO conversations (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)',
    );
    this.stmtUpdateStatus = this.db.prepare(
      'UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?',
    );
    this.stmtTouchConversation = this.db.prepare(
      'UPDATE conversations SET updated_at = ? WHERE id = ?',
    );
    this.stmtInsertMessage = this.db.prepare(
      'INSERT INTO messages (conversation_id, speaker, content, created_at) VALUES (?, ?, ?, ?)',
    );
    this.stmtListConversations = this.db.prepare(
      'SELECT id, title, status, created_at, updated_at FROM conversations ORDER BY updated_at DESC',
    );
    this.stmtGetMessages = this.db.prepare(
      'SELECT id, conversation_id, speaker, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC',
    );
    this.stmtSearchFts = this.db.prepare(
      `SELECT m.id, m.conversation_id, m.speaker, m.content, m.created_at, c.title,
              snippet(messages_fts, 0, '【', '】', '…', 24) AS snip
       FROM messages_fts
       JOIN messages m ON m.id = messages_fts.rowid
       JOIN conversations c ON c.id = m.conversation_id
       WHERE messages_fts MATCH ?
       ORDER BY rank
       LIMIT 100`,
    );
    this.stmtSearchLike = this.db.prepare(
      `SELECT m.id, m.conversation_id, m.speaker, m.content, m.created_at, c.title, NULL AS snip
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.content LIKE ? ESCAPE '\\' OR c.title LIKE ? ESCAPE '\\'
       ORDER BY m.id DESC
       LIMIT 100`,
    );

    this.txAddMessage = this.db.transaction(
      (conversationId: number, speaker: Speaker, content: string, now: string): MessageRecord => {
        const info = this.stmtInsertMessage.run(conversationId, speaker, content, now);
        this.stmtTouchConversation.run(now, conversationId);
        return {
          id: Number(info.lastInsertRowid),
          conversationId,
          speaker,
          content,
          createdAt: now,
        };
      },
    );
  }

  createConversation(title: string): ConversationRecord {
    const now = new Date().toISOString();
    const info = this.stmtInsertConversation.run(title, 'running', now, now);
    return {
      id: Number(info.lastInsertRowid),
      title,
      status: 'running',
      createdAt: now,
      updatedAt: now,
    };
  }

  setConversationStatus(id: number, status: ConversationStatus): void {
    this.stmtUpdateStatus.run(status, new Date().toISOString(), id);
  }

  addMessage(conversationId: number, speaker: Speaker, content: string): MessageRecord {
    return this.txAddMessage(conversationId, speaker, content, new Date().toISOString());
  }

  listConversations(): ConversationRecord[] {
    const rows = this.stmtListConversations.all() as ConversationRow[];
    return rows.map((row) => this.toConversationRecord(row));
  }

  getMessages(conversationId: number): MessageRecord[] {
    const rows = this.stmtGetMessages.all(conversationId) as MessageRow[];
    return rows.map((row) => this.toMessageRecord(row));
  }

  search(query: string): SearchHit[] {
    const trimmed = query.trim();
    if (trimmed === '') return [];

    // trigram は 3 文字未満をマッチできないため LIKE にフォールバック(コードポイント数で判定)
    if (Array.from(trimmed).length >= 3) {
      const phrase = '"' + trimmed.replace(/"/g, '""') + '"';
      const rows = this.stmtSearchFts.all(phrase) as SearchRow[];
      return rows.map((row) => this.toSearchHit(row, row.snip ?? ''));
    }

    const escaped = trimmed.replace(/[\\%_]/g, (ch) => '\\' + ch);
    const pattern = '%' + escaped + '%';
    const rows = this.stmtSearchLike.all(pattern, pattern) as SearchRow[];
    return rows.map((row) => this.toSearchHit(row, this.buildSnippet(row.content, trimmed)));
  }

  close(): void {
    if (this.db) this.db.close();
  }

  private buildSnippet(content: string, query: string): string {
    const idx = content.toLowerCase().indexOf(query.toLowerCase());
    if (idx < 0) {
      // タイトル側ヒットなど本文に一致がない場合は先頭を返す
      const head = content.slice(0, 24);
      return content.length > 24 ? head + '…' : head;
    }
    const hitEnd = idx + query.length;
    const start = Math.max(0, idx - 12);
    const end = Math.min(content.length, hitEnd + 12);
    return (
      (start > 0 ? '…' : '') +
      content.slice(start, idx) +
      '【' +
      content.slice(idx, hitEnd) +
      '】' +
      content.slice(hitEnd, end) +
      (end < content.length ? '…' : '')
    );
  }

  private toConversationRecord(row: ConversationRow): ConversationRecord {
    return {
      id: row.id,
      title: row.title,
      status: row.status as ConversationStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toMessageRecord(row: MessageRow): MessageRecord {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      speaker: row.speaker as Speaker,
      content: row.content,
      createdAt: row.created_at,
    };
  }

  private toSearchHit(row: SearchRow, snippet: string): SearchHit {
    return {
      message: this.toMessageRecord(row),
      conversationTitle: row.title,
      snippet,
    };
  }
}
