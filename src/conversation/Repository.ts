// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import {
  isMode,
  type ConversationRecord,
  type ConversationStatus,
  type MessageRecord,
  type Mode,
  type SearchHit,
  type Speaker,
} from '../shared/types';

interface ConversationRow {
  id: number;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  max_turns: number | null;
  mode: string | null;
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
  updated_at TEXT NOT NULL,
  max_turns INTEGER,
  mode TEXT
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

// スキーマの版管理。既存 DB への変更(列追加など)はここに追記し、init() が PRAGMA user_version を見て
// 未適用のものだけ順に当てる。新規 DB は SCHEMA_SQL で最終形を作るので、各移行は冪等に書く。
type Db = InstanceType<typeof Database>;
function hasColumn(db: Db, table: string, column: string): boolean {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}
const MIGRATIONS: Array<(db: Db) => void> = [
  // v1: 会話ごとの最大ターン数(経過ビュー・Markdown の (n/N) を、その会話で使った値にする)
  (db) => {
    if (!hasColumn(db, 'conversations', 'max_turns')) {
      db.exec('ALTER TABLE conversations ADD COLUMN max_turns INTEGER');
    }
  },
  // v2: 会話ごとのモード(対立 / 協調 / …)。列追加前の会話は null(= 対立として表示)
  (db) => {
    if (!hasColumn(db, 'conversations', 'mode')) {
      db.exec('ALTER TABLE conversations ADD COLUMN mode TEXT');
    }
  },
];

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
  private stmtRenameConversation!: Database.Statement;
  private stmtDeleteConversation!: Database.Statement;
  private stmtDeleteMessagesOf!: Database.Statement;
  private stmtInsertMessage!: Database.Statement;
  private stmtListConversations!: Database.Statement;
  private stmtGetMessages!: Database.Statement;
  private stmtSearchFts!: Database.Statement;
  private stmtSearchTitle!: Database.Statement;
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

    const version = Number(this.db.pragma('user_version', { simple: true }));
    if (version < MIGRATIONS.length) {
      const db = this.db;
      db.transaction(() => {
        for (let v = version; v < MIGRATIONS.length; v++) MIGRATIONS[v]!(db);
        db.pragma(`user_version = ${MIGRATIONS.length}`);
      })();
    }

    // 前回クラッシュ等で残った実行中状態を復旧(v1 は再起動後の再開を保証しない)
    this.db
      .prepare("UPDATE conversations SET status = 'stopped' WHERE status IN ('running', 'paused')")
      .run();

    this.stmtInsertConversation = this.db.prepare(
      'INSERT INTO conversations (title, status, created_at, updated_at, max_turns, mode) VALUES (?, ?, ?, ?, ?, ?)',
    );
    this.stmtUpdateStatus = this.db.prepare(
      'UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?',
    );
    this.stmtTouchConversation = this.db.prepare(
      'UPDATE conversations SET updated_at = ? WHERE id = ?',
    );
    this.stmtRenameConversation = this.db.prepare('UPDATE conversations SET title = ? WHERE id = ?');
    // 発言は CASCADE に頼らず明示的に消す(FTS の削除トリガが確実に行ごとに動くように)
    this.stmtDeleteMessagesOf = this.db.prepare('DELETE FROM messages WHERE conversation_id = ?');
    this.stmtDeleteConversation = this.db.prepare('DELETE FROM conversations WHERE id = ?');
    this.stmtInsertMessage = this.db.prepare(
      'INSERT INTO messages (conversation_id, speaker, content, created_at) VALUES (?, ?, ?, ?)',
    );
    this.stmtListConversations = this.db.prepare(
      'SELECT id, title, status, created_at, updated_at, max_turns, mode FROM conversations ORDER BY updated_at DESC',
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
    // タイトル一致(FTS はメッセージ本文だけを索引するので、3 文字以上の検索でもタイトルはこちらで見る)
    this.stmtSearchTitle = this.db.prepare(
      `SELECT m.id, m.conversation_id, m.speaker, m.content, m.created_at, c.title, NULL AS snip
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.title LIKE ? ESCAPE '\\'
       ORDER BY m.id DESC
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

  createConversation(title: string, maxTurns: number, mode: Mode): ConversationRecord {
    const now = new Date().toISOString();
    const info = this.stmtInsertConversation.run(title, 'running', now, now, maxTurns, mode);
    return {
      id: Number(info.lastInsertRowid),
      title,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      maxTurns,
      mode,
    };
  }

  /** 会話の名前を変える(updated_at は触らない: 並び順は議論した日時のまま)。空なら何もしない */
  renameConversation(id: number, title: string): boolean {
    const trimmed = title.trim();
    if (trimmed === '') return false;
    return this.stmtRenameConversation.run(trimmed, id).changes > 0;
  }

  /** 会話と発言を消す。戻り値は消えたか(無い id なら false) */
  deleteConversation(id: number): boolean {
    const tx = this.db.transaction((cid: number): boolean => {
      this.stmtDeleteMessagesOf.run(cid);
      return this.stmtDeleteConversation.run(cid).changes > 0;
    });
    return tx(id);
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

    const escaped = trimmed.replace(/[\\%_]/g, (ch) => '\\' + ch);
    const pattern = '%' + escaped + '%';

    // trigram は 3 文字未満をマッチできないため LIKE にフォールバック(コードポイント数で判定)
    if (Array.from(trimmed).length >= 3) {
      const phrase = '"' + trimmed.replace(/"/g, '""') + '"';
      const rows = this.stmtSearchFts.all(phrase) as SearchRow[];
      const hits = rows.map((row) => this.toSearchHit(row, row.snip ?? ''));
      // タイトルだけが一致した会話の発言も(本文一致と重複しないものを)後ろに足す
      const seen = new Set(hits.map((h) => h.message.id));
      const byTitle = this.stmtSearchTitle.all(pattern) as SearchRow[];
      for (const row of byTitle) {
        if (hits.length >= 100) break;
        if (seen.has(row.id)) continue;
        hits.push(this.toSearchHit(row, this.buildSnippet(row.content, trimmed)));
      }
      return hits;
    }

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
      maxTurns: row.max_turns ?? null,
      mode: isMode(row.mode) ? row.mode : null,
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
