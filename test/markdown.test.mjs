// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// 経過の Markdown 書き出し(transcriptToMarkdown)の自動テスト。node:test だけで動く(依存追加なし)。
// テスト対象はコンパイル済みの dist/conversation/markdown.js なので、`npm run build` のあとに `npm test` で走る。
// 純粋関数なので DB も Electron も要らず、入力(タイトル・発言・最大ターン数)に対する文字列をそのまま比べる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcriptToMarkdown } from '../dist/conversation/markdown.js';
import { setMainLang } from '../dist/shared/i18n.js';

// MessageRecord を手早く作る。id / conversationId / createdAt は出力に関係しないので固定値でよい
function message(speaker, content, id = 1) {
  return { id, conversationId: 100, speaker, content, createdAt: '2026-08-21T00:00:00.000Z' };
}

test('1 件: 見出し・話者見出し・本文の形が gist 形式になる(区切り線は無い)', () => {
  const md = transcriptToMarkdown('猫と犬はどちらが賢いか', [message('chatgpt', '猫派です。')], 4);
  assert.equal(
    md,
    [
      '# 猫と犬はどちらが賢いか',
      '',
      '### 🟢 ChatGPT (1/4)',
      '',
      '猫派です。',
      '',
    ].join('\n'),
  );
  assert.ok(md.endsWith('猫派です。\n') && !md.includes('---'), '区切り線は入れない');
  assert.ok(!md.includes('2026-08-21'), '日時や id は出力に含めない');
});

test('複数件: 発言順に並び、話者ごとの絵文字とラベルが付き、番号が 1 から増える', () => {
  const messages = [
    message('chatgpt', '最初の主張', 1),
    message('gemini', '反論', 2),
    message('chatgpt', '再反論', 3),
  ];
  assert.equal(
    transcriptToMarkdown('三往復', messages, 3),
    [
      '# 三往復',
      '',
      '### 🟢 ChatGPT (1/3)',
      '',
      '最初の主張',
      '',
      '### 🔵 Gemini (2/3)',
      '',
      '反論',
      '',
      '### 🟢 ChatGPT (3/3)',
      '',
      '再反論',
      '',
    ].join('\n'),
  );
});

test('本文の改行・空行・"> ": 本文はそのまま置き(引用にしない)、末尾の改行だけ落とす', () => {
  const content = '1 行目\n\n> 相手の言葉の引用\n最後の行';
  const md = transcriptToMarkdown('引用の扱い', [message('gemini', content)], 2);
  assert.equal(
    md,
    [
      '# 引用の扱い',
      '',
      '### 🔵 Gemini (1/2)',
      '',
      '1 行目',
      '',
      '> 相手の言葉の引用',
      '最後の行',
      '',
    ].join('\n'),
  );

  // 本文が改行で終わっても区切り線との間は空行 1 つ(gist で本文が薄い引用にならないよう、"> " は付けない)
  const trailing = transcriptToMarkdown('末尾改行', [message('chatgpt', '本文\n\n')], 1);
  assert.ok(trailing.endsWith('\n\n本文\n'), trailing);
  assert.ok(!trailing.includes('> '), '引用ブロックは使わない');
});

test('複数行のタイトル: 1 行目を見出しに、残りは段落として見出しの下に置く', () => {
  const md = transcriptToMarkdown('AI は意識を持てるか\n前提: 現在の LLM に限る\n', [message('chatgpt', '持てません。')], 1);
  assert.equal(
    md,
    [
      '# AI は意識を持てるか',
      '',
      '前提: 現在の LLM に限る',
      '',
      '### 🟢 ChatGPT (1/1)',
      '',
      '持てません。',
      '',
    ].join('\n'),
  );
  assert.equal(transcriptToMarkdown('一行だけ\n\n', [], 1), '# 一行だけ\n', '2 行目以降が空白だけなら見出しのみ');
});

test('空の messages: 見出しだけになる(コピーしないと判断するのは呼び出し側)', () => {
  assert.equal(transcriptToMarkdown('まだ発言がない会話', [], 5), '# まだ発言がない会話\n');
});

test('maxTurns の表記: 分母は発言数ではなく渡した maxTurns、分子は発言の通し番号', () => {
  const messages = [message('chatgpt', 'a', 1), message('gemini', 'b', 2)];
  const md = transcriptToMarkdown('上限 10', messages, 10);
  const counters = [...md.matchAll(/\((\d+)\/(\d+)\)/g)].map((m) => `${m[1]}/${m[2]}`);
  assert.deepEqual(counters, ['1/10', '2/10']);

  // 旧データ向けに Application 側が「発言数」を maxTurns として渡す場合は n/n になる
  assert.deepEqual(
    [...transcriptToMarkdown('旧データ', messages, messages.length).matchAll(/\((\d+\/\d+)\)/g)].map((m) => m[1]),
    ['1/2', '2/2'],
  );
});

test('contentMd がある発言は Markdown 版を使い、無ければ content を使う', () => {
  const messages = [
    { speaker: 'chatgpt', content: '見出し 箇条書き', contentMd: '## 見出し\n\n- 箇条書き\n\n' },
    { speaker: 'gemini', content: 'プレーンのまま\n\n' },
  ];
  const md = transcriptToMarkdown('質', messages, 2);
  assert.ok(md.includes('## 見出し\n\n- 箇条書き'), 'Markdown 版が優先される');
  assert.ok(!md.includes('見出し 箇条書き'), 'プレーン版は使わない');
  assert.ok(md.includes('プレーンのまま'), '無い発言は content にフォールバック');
  assert.ok(!md.includes('\n\n\n'), '末尾の改行は詰める');
});

test('タイトルが空のときは「議論」を見出しにする。空でなければそのまま使う', () => {
  const messages = [message('chatgpt', 'こんにちは')];
  assert.ok(transcriptToMarkdown('', messages, 1).startsWith('# 議論\n\n'));
  assert.ok(transcriptToMarkdown('AI の未来', messages, 1).startsWith('# AI の未来\n\n'));
  assert.equal(transcriptToMarkdown('', [], 1), '# 議論\n', '発言が無くても既定の見出しになる');
});

test('タイトルが空のときの既定見出しは言語に従う(en なら Debate)', (t) => {
  setMainLang('en');
  t.after(() => setMainLang('ja'));
  assert.equal(transcriptToMarkdown('', [], 1), '# Debate\n');
});
