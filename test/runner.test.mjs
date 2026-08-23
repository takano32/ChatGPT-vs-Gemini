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
import { setMainLang } from '../dist/shared/i18n.js';

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
function setup(t, { debate = {}, chatgpt, gemini, cooldownMs = 10 } = {}) {
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
  const runner = new Runner({ chats, repository, settings, cooldownMs });
  const logs = [];
  const statuses = [];
  runner.on('log', (e) => logs.push(e));
  runner.on('status', (s) => statuses.push(s.state));
  return { runner, repository, chats, logs, statuses };
}

/** プロンプトから進行役の先頭行を除いた本文 */
function body(prompt) {
  return prompt.split('\n\n').slice(1).join('\n\n');
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
  const [opening, relay] = chats.chatgpt.prompts.map(body);
  const [counter] = chats.gemini.prompts.map(body);
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
  assert.ok(body(chats.gemini.prompts[0]).includes('(ChatGPT)'), '先攻の開始プロンプトは相手名が ChatGPT');
  assert.ok(body(chats.chatgpt.prompts[0]).includes('Gemini の発言 1'), '後攻の反論プロンプトに先攻の発言が入る');
  const conv = repository.listConversations()[0];
  assert.equal(conv.maxTurns, 2);
  assert.deepEqual(
    repository.getMessages(conv.id).map((m) => m.speaker),
    ['gemini', 'chatgpt'],
  );
});

test('先攻の上書き: start の第 3 引数があれば設定の先攻より優先する(そのランだけ)', async (t) => {
  const { runner, repository, chats } = setup(t, { debate: { firstSpeaker: 'chatgpt' } });
  await runner.start('上書き', 2, 'gemini');
  assert.deepEqual(
    repository.getMessages(repository.listConversations()[0].id).map((m) => m.speaker),
    ['gemini', 'chatgpt'],
  );
  assert.ok(chats.gemini.prompts[0].includes('(ChatGPT)'), '先攻 Gemini の開始プロンプトは相手名が ChatGPT');
});

test('モード: 上書きがあればそのモードのテンプレートを使い、3 ターン目以降は先攻 / 後攻で中継文が分かれる。会話に mode が残る', async (t) => {
  const { runner, repository, chats } = setup(t);
  await runner.start('レビュー対象', 6, undefined, 'review');
  const conv = repository.listConversations()[0];
  assert.equal(conv.mode, 'review');
  const [opening, relayFirst] = chats.chatgpt.prompts.map(body);
  const [counter, relaySecond] = chats.gemini.prompts.map(body);
  assert.ok(opening.includes('あなたは作者') && opening.includes('「レビュー対象」'), opening);
  assert.ok(counter.includes('あなたはレビュアー') && counter.includes('ChatGPT の発言 1'), counter);
  assert.ok(relayFirst.startsWith('レビュアー(Gemini)の指摘:') && relayFirst.includes('Gemini の発言 1'), relayFirst);
  assert.ok(relaySecond.startsWith('作者(ChatGPT)の修正版:') && relaySecond.includes('ChatGPT の発言 2'), relaySecond);

  // 上書きが無ければ設定の既定モード(対立)で、中継は先攻・後攻とも同じ文
  const second = setup(t);
  await second.runner.start('既定', 6);
  assert.equal(second.repository.listConversations()[0].mode, 'debate');
  const r1 = body(second.chats.chatgpt.prompts[1]);
  const r2 = body(second.chats.gemini.prompts[1]);
  assert.ok(r1.startsWith('相手(Gemini)の発言:') && r2.startsWith('相手(ChatGPT)の発言:'));
});

test('進行役: 毎ターン先頭に「n/max ターン目」と段階の指示が付き、最後の 2 ターンは両者がまとめる。2 人目のまとめには相手の最後の通常発言を渡す', async (t) => {
  const { runner, chats } = setup(t);
  await runner.start('まとめ', 8);
  // 送信順に並べ直す(先攻 ChatGPT: 1,3,5,7 / Gemini: 2,4,6,8)
  const prompts = [];
  for (let i = 0; i < 4; i++) prompts.push(chats.chatgpt.prompts[i], chats.gemini.prompts[i]);
  const leads = prompts.map((p) => p.split('\n\n')[0]);
  assert.equal(leads[0], '【進行役】1/8 ターン目(残り 7 ターン)。いまは序盤です。論点を出し切り、立場を明確にしてください。');
  assert.ok(leads[1].includes('2/8') && leads[1].includes('序盤'));
  assert.ok(leads[2].includes('3/8') && leads[2].includes('中盤'), leads[2]);
  assert.ok(leads[3].includes('4/8') && leads[3].includes('中盤'), leads[3]);
  assert.ok(leads[4].includes('5/8') && leads[4].includes('終盤'), leads[4]);
  assert.ok(leads[5].includes('6/8') && leads[5].includes('終盤'), leads[5]);
  assert.equal(leads[6], '【進行役】7/8 ターン目(残り 1 ターン)。', 'まとめのターンは段階の指示なし');
  assert.equal(leads[7], '【進行役】8/8 ターン目(残り 0 ターン)。');

  const closing1 = body(prompts[6]);
  const closing2 = body(prompts[7]);
  assert.ok(closing1.startsWith('相手(Gemini)の最後の発言:') && closing1.includes('議論はここまでです'), closing1);
  assert.ok(closing1.includes('Gemini の発言 3'), '1 人目のまとめは相手(Gemini)の最後の通常発言(6 ターン目)を材料にする');
  assert.ok(closing2.includes('ChatGPT の発言 3') && !closing2.includes('ChatGPT の発言 4'), '2 人目のまとめは相手のまとめ(7 ターン目)ではなく最後の通常発言(5 ターン目)を材料にする');

  // 4 ターン未満はまとめ無し
  const short = setup(t);
  await short.runner.start('短い', 3);
  const all = [short.chats.chatgpt.prompts[0], short.chats.gemini.prompts[0], short.chats.chatgpt.prompts[1]];
  assert.ok(all.every((p) => !p.includes('議論はここまでです')));
  assert.ok(all[2].split('\n\n')[0].includes('終盤'));
});

test('レート制限: クールダウン後に同じターンを自動で再送し、一時停止せず完走する', async (t) => {
  let failures = 2;
  const gemini = new FakeChat('Gemini', (_p, n) => {
    if (failures > 0) {
      failures -= 1;
      return new ChatError('rate-limited', 'Gemini');
    }
    return `Gemini の発言 ${n}`;
  });
  const { runner, repository, chats, logs, statuses } = setup(t, { gemini });
  const cooldowns = [];
  runner.on('status', (s) => {
    if (s.cooldown) cooldowns.push(s.cooldown);
  });
  await runner.start('制限', 2);

  assert.equal(runner.status.state, 'done');
  assert.equal(chats.gemini.prompts.length, 3, '制限 2 回のあと 3 回目で通る');
  assert.ok(chats.gemini.prompts.every((p) => p === chats.gemini.prompts[0]), '再送のプロンプトは同一');
  assert.deepEqual(
    cooldowns.map((c) => [c.speaker, c.attempt, c.max]),
    [['gemini', 1, 3], ['gemini', 2, 3]],
    'クールダウンの状態が回数つきで通知される',
  );
  assert.equal(runner.status.cooldown, undefined, '終わったら消える');
  assert.equal(logs.filter((e) => e.level === 'warn' && e.message.includes('秒待って')).length, 2);
  assert.ok(!statuses.includes('paused'), '自動再試行で通るなら一時停止しない');
  assert.equal(repository.getMessages(repository.listConversations()[0].id).length, 2, '失敗したターンは保存されない');
});

test('レート制限: 3 回待っても解除されなければ paused になり、resume で同じターンを再送して続きが進む', async (t) => {
  let failures = 4;
  const gemini = new FakeChat('Gemini', (_p, n) => {
    if (failures > 0) {
      failures -= 1;
      return new ChatError('rate-limited', 'Gemini');
    }
    return `Gemini の発言 ${n}`;
  });
  const { runner, repository, chats, logs, statuses } = setup(t, { gemini });
  const run = runner.start('制限', 2);
  await until(() => runner.status.state === 'paused');

  assert.equal(chats.gemini.prompts.length, 4, '3 回待って再試行し、4 回目も制限なら止まる');
  assert.ok(logs.some((e) => e.level === 'warn' && e.message.includes('一時停止')));
  assert.equal(repository.listConversations()[0].status, 'paused');

  runner.resume();
  await run;
  assert.equal(runner.status.state, 'done');
  assert.equal(chats.gemini.prompts.length, 5, '再開で同じターンをもう一度送る');
  assert.equal(chats.gemini.prompts[0], chats.gemini.prompts[4], '再送のプロンプトは同一');
  assert.equal(repository.getMessages(repository.listConversations()[0].id).length, 2, '失敗したターンは保存されない');
  assert.deepEqual(statuses.filter((s) => s === 'paused').length, 1);
});

test('レート制限: 成功すれば連続回数はリセットされる(後で再び制限されても待ち直せる)', async (t) => {
  const pattern = ['x', 'x', 'ok', 'x', 'x', 'ok'];
  const gemini = new FakeChat('Gemini', (_p, n) => (pattern[n - 1] === 'x' ? new ChatError('rate-limited', 'Gemini') : `Gemini ${n}`));
  const { runner, statuses } = setup(t, { gemini });
  await runner.start('制限', 4);
  assert.equal(runner.status.state, 'done');
  assert.ok(!statuses.includes('paused'));
});

test('レート制限: クールダウン中の一時停止は待機を打ち切り、再開で同じターンを送る。停止も即効く', async (t) => {
  const make = () =>
    new FakeChat('Gemini', (_p, n) => (n === 1 ? new ChatError('rate-limited', 'Gemini') : `Gemini の発言 ${n}`));
  {
    const gemini = make();
    const { runner, chats } = setup(t, { gemini, cooldownMs: 60_000 });
    const run = runner.start('制限', 2);
    await until(() => runner.status.cooldown !== undefined);
    runner.pause();
    assert.equal(runner.status.state, 'paused');
    assert.equal(runner.status.cooldown, undefined);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(chats.gemini.prompts.length, 1, '一時停止中は送らない');
    runner.resume();
    await run;
    assert.equal(runner.status.state, 'done');
    assert.equal(chats.gemini.prompts.length, 2);
  }
  {
    const gemini = make();
    const { runner, chats } = setup(t, { gemini, cooldownMs: 60_000 });
    const run = runner.start('制限', 2);
    await until(() => runner.status.cooldown !== undefined);
    runner.stop();
    await run;
    assert.equal(runner.status.state, 'stopped');
    assert.equal(chats.gemini.prompts.length, 1);
  }
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

test('言語が英語のとき main のログ文言も英語になる(既定の日本語は変わらない)', async (t) => {
  setMainLang('en');
  t.after(() => setMainLang('ja'));
  const { runner, logs } = setup(t);
  await runner.start('Cats vs dogs', 2);
  const messages = logs.map((e) => e.message);
  assert.ok(messages.some((m) => m === 'Starting the debate: "Cats vs dogs" (Debate, up to 2 turns)'), messages.join(' | '));
  assert.ok(messages.some((m) => m === 'Sending → ChatGPT'));
  assert.ok(messages.some((m) => m === 'Debate finished (2 turns)'));
  assert.ok(!messages.some((m) => /[ぁ-んァ-ン一-龥]/.test(m)), '日本語が混ざらない');
});
