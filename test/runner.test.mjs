// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Runner(ターン進行の中核)の自動テスト。node:test だけで動く(依存追加なし)。
// テスト対象はコンパイル済みの dist/conversation/Runner.js なので、`npm run build` のあとに `npm test` で走る。
// Chat はサイトに触るので偽物(FakeChat)に差し替え、Repository は本物を一時ディレクトリの DB で使う。
// 見るのは「誰に・どのプロンプトを・どの順で送り、何を保存し、どの状態で終わるか」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runner } from '../dist/conversation/Runner.js';
import { Repository } from '../dist/conversation/Repository.js';
import { ChatError } from '../dist/chat/Chat.js';
import { DEFAULT_SETTINGS } from '../dist/shared/types.js';

/**
 * Chat の偽物。ask() はプロンプトを記録し、reply(prompt, n) の戻り値(文字列または Error)で応答する。
 * hold を true にすると ask() を保留し、release() / stop() で決着させる(停止の試験用)。
 */
class FakeChat {
  constructor(displayName, reply) {
    this.displayName = displayName;
    this.reply = reply;
    this.notice = null;
    this.prompts = [];
    this.newChatCalls = 0;
    this.stopCalls = 0;
    this.hold = false;
    this.pending = null;
  }
  async newChat() {
    this.newChatCalls += 1;
  }
  ask(prompt) {
    this.prompts.push(prompt);
    const result = this.reply(prompt, this.prompts.length);
    if (!this.hold) return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    return new Promise((resolve, reject) => {
      this.pending = { resolve: () => resolve(result), reject };
    });
  }
  stop() {
    this.stopCalls += 1;
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      p.reject(new ChatError('stopped', this.displayName));
    }
  }
}

/** 1 テストぶんの部品一式。終了時に DB と一時ディレクトリを片付ける */
function setup(t, { debate = {}, chatgpt, gemini } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'chatgpt-vs-gemini-runner-'));
  const repository = new Repository(join(dir, 'data.db'));
  repository.init();
  t.after(() => {
    repository.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const chats = {
    chatgpt: chatgpt ?? new FakeChat('ChatGPT', (_p, n) => `ChatGPT の発言 ${n}`),
    gemini: gemini ?? new FakeChat('Gemini', (_p, n) => `Gemini の発言 ${n}`),
  };
  const settings = {
    get: () => ({ ...DEFAULT_SETTINGS, debate: { ...DEFAULT_SETTINGS.debate, betweenTurnsMs: 0, ...debate } }),
  };
  const runner = new Runner({ chats, repository, settings });
  const logs = [];
  const statuses = [];
  runner.on('log', (e) => logs.push(e));
  runner.on('status', (s) => statuses.push(s.state));
  return { runner, repository, chats, logs, statuses };
}

/** 条件が満たされるまで待つ(最大 2 秒)。Runner の非同期ループと同期を取る用 */
async function until(cond) {
  for (let i = 0; i < 200; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('時間内に条件が満たされなかった');
}

test('3 ターン: 先攻から交互に送り、開始/反論/中継テンプレートを順に使い、発言を保存して done で終わる', async (t) => {
  const { runner, repository, chats, logs } = setup(t);
  await runner.start('猫と犬', 3);

  assert.equal(runner.status.state, 'done');
  assert.equal(chats.chatgpt.newChatCalls, 1, '議論ごとに新規チャットを開く');
  assert.equal(chats.gemini.newChatCalls, 1);

  // 先攻 ChatGPT(1, 3 ターン目)、後攻 Gemini(2 ターン目)
  assert.equal(chats.chatgpt.prompts.length, 2);
  assert.equal(chats.gemini.prompts.length, 1);
  const [opening, relay] = chats.chatgpt.prompts;
  const [counter] = chats.gemini.prompts;
  assert.ok(opening.includes('「猫と犬」') && opening.includes('(Gemini)'), `開始: ${opening}`);
  assert.ok(counter.includes('「猫と犬」') && counter.includes('ChatGPT の発言 1'), `反論: ${counter}`);
  assert.ok(relay.includes('Gemini の発言 1') && !relay.includes('猫と犬'), `中継: ${relay}`);

  // 保存内容
  const conv = repository.listConversations()[0];
  assert.equal(conv.title, '猫と犬');
  assert.equal(conv.status, 'done');
  assert.equal(conv.maxTurns, 3, '操作バーの一時値が会話の max_turns になる');
  const messages = repository.getMessages(conv.id);
  assert.deepEqual(
    messages.map((m) => [m.speaker, m.content]),
    [
      ['chatgpt', 'ChatGPT の発言 1'],
      ['gemini', 'Gemini の発言 1'],
      ['chatgpt', 'ChatGPT の発言 2'],
    ],
  );
  assert.equal(runner.status.turn, 3);
  assert.ok(logs.some((e) => e.level === 'info' && e.message.includes('全 3 ターン')));
  assert.ok(!logs.some((e) => e.level === 'warn' || e.level === 'error'), '警告・エラーは出ない');
});

test('先攻を Gemini にすると順序が入れ替わり、maxTurns の上書きが無ければ設定値を使う', async (t) => {
  const { runner, repository, chats } = setup(t, { debate: { firstSpeaker: 'gemini', maxTurns: 2 } });
  await runner.start('テーマ');
  assert.equal(chats.gemini.prompts.length, 1);
  assert.equal(chats.chatgpt.prompts.length, 1);
  assert.ok(chats.gemini.prompts[0].includes('(ChatGPT)'), '先攻の開始プロンプトは相手名が ChatGPT');
  assert.ok(chats.chatgpt.prompts[0].includes('Gemini の発言 1'), '後攻の反論プロンプトに先攻の発言が入る');
  const conv = repository.listConversations()[0];
  assert.equal(conv.maxTurns, 2);
  assert.deepEqual(
    repository.getMessages(conv.id).map((m) => m.speaker),
    ['gemini', 'chatgpt'],
  );
});

test('レート制限: paused になり、resume で同じターンを再送して続きが進む', async (t) => {
  let failOnce = true;
  const gemini = new FakeChat('Gemini', (_p, n) => {
    if (failOnce) {
      failOnce = false;
      return new ChatError('rate-limited', 'Gemini');
    }
    return `Gemini の発言 ${n}`;
  });
  const { runner, repository, chats, logs, statuses } = setup(t, { gemini });
  const run = runner.start('制限', 2);
  await until(() => runner.status.state === 'paused');

  assert.equal(chats.gemini.prompts.length, 1);
  assert.ok(logs.some((e) => e.level === 'warn' && e.message.includes('レート制限')));
  assert.equal(repository.listConversations()[0].status, 'paused');

  runner.resume();
  await run;
  assert.equal(runner.status.state, 'done');
  assert.equal(chats.gemini.prompts.length, 2, '同じターンをもう一度送る');
  assert.equal(chats.gemini.prompts[0], chats.gemini.prompts[1], '再送のプロンプトは同一');
  assert.equal(repository.getMessages(repository.listConversations()[0].id).length, 2, '失敗したターンは保存されない');
  assert.deepEqual(statuses.filter((s) => s === 'paused').length, 1);
});

test('pause: 実行中のターンは完了まで続き、次のターンの前で止まる。resume で続行', async (t) => {
  const chatgpt = new FakeChat('ChatGPT', (_p, n) => `ChatGPT の発言 ${n}`);
  chatgpt.hold = true;
  const { runner, chats } = setup(t, { chatgpt });
  const run = runner.start('一時停止', 3);
  await until(() => chatgpt.pending !== null);

  runner.pause();
  assert.equal(runner.status.state, 'paused');
  chatgpt.pending.resolve(); // 実行中の 1 ターン目は完了する
  await until(() => runner.status.turn === 1);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(chats.gemini.prompts.length, 0, '一時停止中は次のターンを送らない');

  chatgpt.hold = false;
  runner.resume();
  await run;
  assert.equal(runner.status.state, 'done');
  assert.equal(runner.status.turn, 3);
});

test('stop: 送信中の Chat を止め、stopped で終わる。以後は送らない', async (t) => {
  const chatgpt = new FakeChat('ChatGPT', (_p, n) => `ChatGPT の発言 ${n}`);
  chatgpt.hold = true;
  const { runner, repository, chats, logs } = setup(t, { chatgpt });
  const run = runner.start('停止', 5);
  await until(() => chatgpt.pending !== null);

  runner.stop();
  await run;
  assert.equal(runner.status.state, 'stopped');
  assert.equal(chatgpt.stopCalls, 1, '送信中の Chat に stop() を伝える');
  assert.equal(chats.gemini.prompts.length, 0);
  assert.equal(repository.listConversations()[0].status, 'stopped');
  assert.equal(logs.filter((e) => e.message === '議論を停止しました').length, 1, '停止ログは 1 回だけ');
  assert.equal(repository.getMessages(repository.listConversations()[0].id).length, 0);
});

test('その他のエラー(タイムアウト等): error で終わり、理由が status と会話に残る', async (t) => {
  const gemini = new FakeChat('Gemini', () => new ChatError('timeout', 'Gemini の応答がありません'));
  const { runner, repository, logs } = setup(t, { gemini });
  await runner.start('失敗', 4);
  assert.equal(runner.status.state, 'error');
  assert.equal(runner.status.error, 'Gemini の応答がありません');
  assert.equal(repository.listConversations()[0].status, 'error');
  assert.equal(repository.getMessages(repository.listConversations()[0].id).length, 1, '成功した 1 ターン目は残る');
  assert.ok(logs.some((e) => e.level === 'error' && e.message.includes('Gemini の応答がありません')));
});

test('新規チャットの準備に失敗したら送信せずに error', async (t) => {
  const gemini = new FakeChat('Gemini', (_p, n) => `Gemini の発言 ${n}`);
  gemini.newChat = async () => {
    throw new ChatError('selector', '新規チャットの準備ができません: Gemini');
  };
  const { runner, chats } = setup(t, { gemini });
  await runner.start('準備失敗', 2);
  assert.equal(runner.status.state, 'error');
  assert.equal(chats.chatgpt.prompts.length, 0);
  assert.equal(chats.gemini.prompts.length, 0);
});

test('Chat の自己修復の通知(notice)は WARN ログとして流れる', async (t) => {
  const { runner, chats, logs } = setup(t);
  chats.chatgpt.notice('送信をやり直します');
  assert.deepEqual(
    logs.map((e) => [e.level, e.message]),
    [['warn', '送信をやり直します']],
  );
  assert.equal(runner.status.state, 'idle');
});

test('実行中に start を呼んでも二重に始まらない', async (t) => {
  const chatgpt = new FakeChat('ChatGPT', (_p, n) => `ChatGPT の発言 ${n}`);
  chatgpt.hold = true;
  const { runner, repository, logs } = setup(t, { chatgpt });
  const run = runner.start('一度目', 1);
  await until(() => chatgpt.pending !== null);
  await runner.start('二度目', 1);
  assert.equal(repository.listConversations().length, 1, '会話は 1 件しか作られない');
  assert.ok(logs.some((e) => e.level === 'warn' && e.message.includes('既に実行中')));
  chatgpt.pending.resolve();
  await run;
  assert.equal(runner.status.state, 'done');
});
