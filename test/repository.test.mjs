// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Repository(SQLite + FTS5)の自動テスト。node:test だけで動く(依存追加なし)。
// テスト対象はコンパイル済みの dist/conversation/Repository.js なので、`npm run build` のあとに `npm test` で走る。
// テストごとに os.tmpdir() 配下へ新しい DB を作り、終了時に消す(互いに独立)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { Repository } from '../dist/conversation/Repository.js';

// Repository.ts の MIGRATIONS の要素数。移行を足したらここも上げる
const SCHEMA_VERSION = 3;

// max_turns 列を足す前(user_version 0)のスキーマ。旧 DB からの移行テスト用
const LEGACY_SCHEMA_SQL = `
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  speaker TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
INSERT INTO conversations (title, status, created_at, updated_at)
  VALUES ('旧い会話', 'done', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
`;

// テスト 1 件ぶんの作業場。一時ディレクトリと、そこに開いた Repository を終了時にまとめて片付ける
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'chatgpt-vs-gemini-test-'));
  // init() が親ディレクトリを作ることも確かめるため 1 段深くする
  const dbPath = join(dir, 'userData', 'data.db');
  const repos = [];
  t.after(() => {
    for (const repo of repos) repo.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    dbPath,
    open() {
      const repo = new Repository(dbPath);
      repo.init();
      repos.push(repo);
      return repo;
    },
    // Repository を通さず SQLite を直接見る(スキーマの確認・旧 DB の手作り用)
    raw(fn) {
      mkdirSync(dirname(dbPath), { recursive: true });
      const db = new Database(dbPath);
      try {
        return fn(db);
      } finally {
        db.close();
      }
    },
  };
}

function userVersion(db) {
  return Number(db.pragma('user_version', { simple: true }));
}

function columnNames(db, table) {
  return db.pragma(`table_info(${table})`).map((c) => c.name);
}

test('新規 DB: init で user_version が MIGRATIONS 数になり、conversations に max_turns / mode 列がある', (t) => {
  const { dbPath, open, raw } = setup(t);
  assert.equal(existsSync(dbPath), false);

  open();

  assert.equal(existsSync(dbPath), true, 'init が親ディレクトリごと DB ファイルを作る');
  raw((db) => {
    assert.equal(userVersion(db), SCHEMA_VERSION);
    assert.ok(columnNames(db, 'conversations').includes('max_turns'));
    assert.ok(columnNames(db, 'conversations').includes('mode'));
    assert.ok(columnNames(db, 'conversations').includes('config'));
    assert.ok(columnNames(db, 'messages').includes('content_md'));
    assert.ok(columnNames(db, 'messages').includes('prompt'));
    const fts = db.prepare("SELECT name FROM sqlite_master WHERE name = 'messages_fts'").get();
    assert.ok(fts, '全文検索テーブル messages_fts が作られる');
  });
});

test('旧スキーマの DB: init で max_turns / mode 列が追加され版が上がる。再 init は冪等', (t) => {
  const { open, raw } = setup(t);
  raw((db) => {
    db.exec(LEGACY_SCHEMA_SQL);
    assert.equal(userVersion(db), 0);
    assert.ok(!columnNames(db, 'conversations').includes('max_turns'));
  });

  open();
  const columnsAfterFirst = raw((db) => {
    assert.equal(userVersion(db), SCHEMA_VERSION);
    const cols = columnNames(db, 'conversations');
    assert.ok(cols.includes('max_turns'));
    assert.ok(cols.includes('mode'));
    assert.ok(cols.includes('config'));
    assert.ok(columnNames(db, 'messages').includes('content_md'));
    assert.ok(columnNames(db, 'messages').includes('prompt'));
    const legacy = db.prepare('SELECT title, max_turns, mode FROM conversations').get();
    assert.deepEqual(legacy, { title: '旧い会話', max_turns: null, mode: null }, '既存の行は残り max_turns / mode は NULL');
    return cols;
  });

  // もう一度 init しても失敗せず、版も列も変わらない
  const repo = open();
  raw((db) => {
    assert.equal(userVersion(db), SCHEMA_VERSION);
    assert.deepEqual(columnNames(db, 'conversations'), columnsAfterFirst);
  });
  assert.equal(repo.listConversations().length, 1);
});

test('createConversation の戻り値と listConversations の maxTurns / mode(旧行は null)', (t) => {
  const { open, raw } = setup(t);
  raw((db) => db.exec(LEGACY_SCHEMA_SQL));
  const repo = open();

  const created = repo.createConversation('新しい会話', 10, 'collab');
  assert.equal(typeof created.id, 'number');
  assert.ok(created.id > 0);
  assert.equal(created.title, '新しい会話');
  assert.equal(created.status, 'running');
  assert.equal(created.maxTurns, 10);
  assert.equal(created.mode, 'collab');
  assert.equal(created.createdAt, created.updatedAt);
  assert.equal(new Date(created.createdAt).toISOString(), created.createdAt, 'createdAt は ISO 8601');

  const list = repo.listConversations();
  assert.equal(list.length, 2);
  const fresh = list.find((c) => c.id === created.id);
  assert.deepEqual(fresh, created, 'listConversations は createConversation の戻り値と同じ内容を返す');
  const legacy = list.find((c) => c.id !== created.id);
  assert.equal(legacy.title, '旧い会話');
  assert.equal(legacy.status, 'done');
  assert.equal(legacy.maxTurns, null, '列追加前に作られた会話の maxTurns は null');
  assert.equal(legacy.mode, null, '列追加前に作られた会話の mode は null');
});

test('addMessage → getMessages: 追加した順に返り、speaker / content が保存される', (t) => {
  const { open } = setup(t);
  const repo = open();
  const a = repo.createConversation('会話 A', 4, 'debate');
  const b = repo.createConversation('会話 B', 4, 'debate');

  const m1 = repo.addMessage(a.id, 'chatgpt', 'こんにちは、Gemini。');
  const m2 = repo.addMessage(a.id, 'gemini', 'こんにちは、ChatGPT。');
  const m3 = repo.addMessage(b.id, 'chatgpt', '別の会話の発言');
  assert.ok(m1.id < m2.id && m2.id < m3.id, 'id は追加順に増える');
  assert.equal(m1.conversationId, a.id);
  assert.equal(new Date(m1.createdAt).toISOString(), m1.createdAt, 'createdAt は ISO 8601');

  const messagesA = repo.getMessages(a.id);
  assert.deepEqual(messagesA, [m1, m2], '追加順に、addMessage の戻り値と同じ内容で返る');
  assert.deepEqual(
    messagesA.map((m) => [m.speaker, m.content]),
    [
      ['chatgpt', 'こんにちは、Gemini。'],
      ['gemini', 'こんにちは、ChatGPT。'],
    ],
  );
  assert.deepEqual(repo.getMessages(b.id), [m3], '他の会話の発言は混ざらない');
  assert.deepEqual(repo.getMessages(b.id + 1000), [], '存在しない会話は空配列');
});

test('v3: config / prompt / contentMd が往復し、旧行と壊れた JSON は null になる', (t) => {
  const { open, raw } = setup(t);
  const repo = open();
  const config = { firstSpeaker: 'gemini', language: 'ja', app: '0.8.0' };
  const conv = repo.createConversation('記録の質', 4, 'debate', config);
  assert.deepEqual(conv.config, config);
  const msg = repo.addMessage(conv.id, 'chatgpt', 'プレーン本文', { contentMd: '## 見出し\n\n- 箇条書き', prompt: '【進行役】1/4。プロンプト全文' });
  assert.equal(msg.contentMd, '## 見出し\n\n- 箇条書き');
  assert.equal(msg.prompt, '【進行役】1/4。プロンプト全文');

  assert.deepEqual(repo.listConversations()[0].config, config, '読み直しでも config が返る');
  const stored = repo.getMessages(conv.id)[0];
  assert.equal(stored.contentMd, '## 見出し\n\n- 箇条書き');
  assert.equal(stored.prompt, '【進行役】1/4。プロンプト全文');
  assert.equal(repo.search('プレーン本文')[0].message.contentMd, '## 見出し\n\n- 箇条書き', '検索結果にも載る');

  // extras 省略・config 省略は null(旧呼び出しと互換)
  const plain = repo.createConversation('省略', 2, 'debate');
  assert.equal(plain.config, null);
  const m2 = repo.addMessage(plain.id, 'gemini', '本文だけ');
  assert.equal(m2.contentMd, null);
  assert.equal(m2.prompt, null);

  // 壊れた JSON は null に潰す(会話自体は読める)
  raw((db) => db.prepare('UPDATE conversations SET config = ? WHERE id = ?').run('{broken', conv.id));
  const rows = open().listConversations();
  const reread = rows.find((c) => c.id === conv.id);
  assert.equal(reread.config, null);
  assert.equal(reread.title, '記録の質');
});

test('deleteConversation: 会話と発言が消え、全文検索の索引からも消える。無い id は false', (t) => {
  const { open } = setup(t);
  const repo = open();
  const conv = repo.createConversation('消す会話', 4, 'debate');
  repo.addMessage(conv.id, 'chatgpt', '吾輩は猫である。');
  repo.addMessage(conv.id, 'gemini', '走れメロス。');
  const keep = repo.createConversation('残す会話', 4, 'debate');
  repo.addMessage(keep.id, 'chatgpt', '猫である、と彼も言った。');
  assert.equal(repo.search('猫である').length, 2);

  assert.equal(repo.deleteConversation(conv.id), true);
  assert.deepEqual(repo.listConversations().map((c) => c.id), [keep.id]);
  assert.equal(repo.getMessages(conv.id).length, 0);
  assert.equal(repo.search('猫である').length, 1, 'FTS の索引からも消える(3 文字以上 = trigram 経路)');
  assert.equal(repo.search('メロス').length, 0);
  assert.equal(repo.deleteConversation(conv.id), false, '二度目は false');
  assert.equal(repo.deleteConversation(99999), false);
});

test('renameConversation: 名前が変わり、空白だけなら変えない。updated_at は動かさない', (t) => {
  const { open } = setup(t);
  const repo = open();
  const conv = repo.createConversation('元の名前', 4, 'debate');
  repo.addMessage(conv.id, 'chatgpt', '本文');
  const before = repo.listConversations()[0];

  assert.equal(repo.renameConversation(conv.id, '  新しい名前  '), true);
  const after = repo.listConversations()[0];
  assert.equal(after.title, '新しい名前', '前後の空白は落とす');
  assert.equal(after.updatedAt, before.updatedAt);
  assert.equal(repo.search('新しい名前')[0].conversationTitle, '新しい名前', '検索結果のタイトルにも反映');

  assert.equal(repo.renameConversation(conv.id, '   '), false);
  assert.equal(repo.listConversations()[0].title, '新しい名前');
  assert.equal(repo.renameConversation(99999, 'x'), false);
});

test('search: 3 文字以上は FTS(trigram)で部分一致し、スニペットに【】が付く', (t) => {
  const { open } = setup(t);
  const repo = open();
  const conv = repo.createConversation('文学談義', 6, 'debate');
  const hitMessage = repo.addMessage(conv.id, 'chatgpt', '吾輩は猫である。名前はまだ無い。');
  repo.addMessage(conv.id, 'gemini', '走れメロス。メロスは激怒した。');

  const hits = repo.search('猫である');
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].message, hitMessage);
  assert.equal(hits[0].conversationTitle, '文学談義');
  assert.ok(hits[0].snippet.includes('【猫である】'), `snippet: ${hits[0].snippet}`);

  assert.equal(repo.search('メロス').length, 1, '単語の途中からでも一致する');
  assert.equal(repo.search('犬である').length, 0);
  assert.equal(repo.search('  猫である  ').length, 1, '前後の空白は無視する');
});

test('search: 3 文字以上でもタイトルに一致した会話の発言が返り、本文一致と重複しない', (t) => {
  const { open } = setup(t);
  const repo = open();
  const conv = repo.createConversation('紙の本と電子書籍', 6, 'debate');
  const m1 = repo.addMessage(conv.id, 'chatgpt', '電子書籍は持ち運びに便利だ。');
  const m2 = repo.addMessage(conv.id, 'gemini', '紙の手触りは代えがたい。');
  const other = repo.createConversation('週末の過ごし方', 6, 'debate');
  repo.addMessage(other.id, 'chatgpt', '外出が良い。');

  const hits = repo.search('電子書籍');
  assert.deepEqual(
    hits.map((h) => h.message.id).sort(),
    [m1.id, m2.id].sort(),
    '本文一致(m1)に加え、タイトル一致の会話の残りの発言(m2)も返る。m1 は重複しない',
  );
  const byContent = hits.find((h) => h.message.id === m1.id);
  const byTitle = hits.find((h) => h.message.id === m2.id);
  assert.ok(byContent.snippet.includes('【電子書籍】'), '本文一致は【】付き');
  assert.ok(!byTitle.snippet.includes('【'), 'タイトルだけの一致は本文の先頭');
  assert.equal(hits[0].message.id, m1.id, '本文一致が先');
  assert.equal(repo.search('過ごし方').length, 1, '別の会話はタイトル一致だけで返る');
});

test('search: 2 文字以下は LIKE にフォールバックし、本文とタイトルの両方に部分一致する', (t) => {
  const { open } = setup(t);
  const repo = open();
  const conv = repo.createConversation('第1回', 6, 'debate');
  const hitMessage = repo.addMessage(conv.id, 'chatgpt', '吾輩は猫である。名前はまだ無い。');
  const other = repo.createConversation('第2回', 6, 'debate');
  repo.addMessage(other.id, 'gemini', '走れメロス。メロスは激怒した。');

  const byContent = repo.search('猫で');
  assert.equal(byContent.length, 1);
  assert.deepEqual(byContent[0].message, hitMessage);
  assert.equal(byContent[0].conversationTitle, '第1回');
  assert.ok(byContent[0].snippet.includes('【猫で】'), `snippet: ${byContent[0].snippet}`);

  assert.equal(repo.search('猫').length, 1, '1 文字でも一致する');

  const byTitle = repo.search('第1');
  assert.equal(byTitle.length, 1, 'タイトルに一致した会話の発言が返る');
  assert.equal(byTitle[0].conversationTitle, '第1回');
  assert.ok(!byTitle[0].snippet.includes('【'), '本文に一致がなければ【】は付けず先頭を返す');

  assert.equal(repo.search('').length, 0);
  assert.equal(repo.search('   ').length, 0, '空白だけなら空配列');
});

test('search: % _ " を含むクエリが例外にならず、記号も文字どおりに一致する', (t) => {
  const { open } = setup(t);
  const repo = open();
  const conv = repo.createConversation('記号テスト', 6, 'debate');
  const contents = ['A%B', 'AXB', 'A_C', 'ABC', 'これは"引用"です', '進捗は100%達成した', 'snake_case_name'];
  for (const content of contents) repo.addMessage(conv.id, 'chatgpt', content);
  const found = (query) => repo.search(query).map((h) => h.message.content).sort();

  // 2 文字以下(LIKE): % と _ はワイルドカードではなく文字として扱う
  assert.deepEqual(found('%B'), ['A%B']);
  assert.deepEqual(found('A_'), ['A_C']);
  assert.deepEqual(found('"'), ['これは"引用"です']);

  // 3 文字以上(FTS): " は句の区切りとして解釈されず、% _ も文字のまま
  assert.deepEqual(found('"引用"'), ['これは"引用"です']);
  assert.ok(repo.search('"引用"')[0].snippet.includes('【"引用"】'));
  assert.deepEqual(found('0%達'), ['進捗は100%達成した']);
  assert.deepEqual(found('e_c'), ['snake_case_name']);

  // 記号だけのクエリも例外にならない
  for (const query of ['%%%', '___', '"""', '%_"', '%', '_']) {
    assert.ok(Array.isArray(repo.search(query)), `search(${JSON.stringify(query)})`);
  }
});

test('init 時に running / paused の会話が stopped に復旧する(他の状態はそのまま)', (t) => {
  const { open } = setup(t);
  const first = open();
  const running = first.createConversation('実行中だった会話', 6, 'debate');
  const paused = first.createConversation('一時停止中だった会話', 6, 'debate');
  const done = first.createConversation('終わった会話', 6, 'debate');
  const error = first.createConversation('失敗した会話', 6, 'debate');
  first.setConversationStatus(paused.id, 'paused');
  first.setConversationStatus(done.id, 'done');
  first.setConversationStatus(error.id, 'error');
  first.close(); // クラッシュ後の再起動に見立てて開き直す

  const second = open();
  const statusOf = new Map(second.listConversations().map((c) => [c.id, c.status]));
  assert.equal(statusOf.get(running.id), 'stopped');
  assert.equal(statusOf.get(paused.id), 'stopped');
  assert.equal(statusOf.get(done.id), 'done');
  assert.equal(statusOf.get(error.id), 'error');
});

test('setConversationStatus で状態と updatedAt が更新される', async (t) => {
  const { open } = setup(t);
  const repo = open();
  const conv = repo.createConversation('状態遷移', 6, 'debate');
  const untouched = repo.createConversation('触らない会話', 6, 'debate');

  await sleep(10); // updatedAt(ミリ秒)が進んだことを見分けるため
  repo.setConversationStatus(conv.id, 'paused');
  let record = repo.listConversations().find((c) => c.id === conv.id);
  assert.equal(record.status, 'paused');
  assert.ok(record.updatedAt > record.createdAt, 'updatedAt が進む');
  assert.equal(record.createdAt, conv.createdAt, 'createdAt は変わらない');

  repo.setConversationStatus(conv.id, 'done');
  record = repo.listConversations().find((c) => c.id === conv.id);
  assert.equal(record.status, 'done');

  assert.deepEqual(
    repo.listConversations().find((c) => c.id === untouched.id),
    untouched,
    '他の会話には影響しない',
  );
  assert.doesNotThrow(() => repo.setConversationStatus(untouched.id + 1000, 'done'), '存在しない id は何もしない');
});
