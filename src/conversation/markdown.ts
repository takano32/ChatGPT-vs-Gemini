// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// 経過(会話 1 件ぶんの発言列)を gist 形式の Markdown 文字列に組み立てる純粋関数。
// Electron や DB に触らないので、node:test から dist/conversation/markdown.js を読み込んでそのまま検査できる
// (test/markdown.test.mjs)。クリップボードへ書くのは呼び出し側(Application)の仕事。
//
// 出力の形(各発言を引用ブロックにし、水平線で区切る):
//
//   # 議論のタイトル
//
//   🟢 **ChatGPT** (1/10)
//
//   > 発言本文の 1 行目
//   > 2 行目
//
//   * * *
//
//   🔵 **Gemini** (2/10)
//   ...

import { SPEAKER_LABELS, type MessageRecord, type Speaker } from '../shared/types';

/** 話者の目印。ChatGPT は緑、Gemini は青(経過表示の話者チップと同じ色分け) */
const SPEAKER_EMOJI: Record<Speaker, string> = { chatgpt: '🟢', gemini: '🔵' };

/** タイトルが空のときに使う見出し */
const DEFAULT_TITLE = '議論';

/**
 * 経過を Markdown 文字列にする。
 *
 * @param title    会話のタイトル。空文字なら「議論」にする
 * @param messages 発言(古い順)。空なら見出しだけを返す(コピーするかどうかは呼び出し側で判断する)
 * @param maxTurns その会話の最大ターン数。各発言の「(n/maxTurns)」の分母になる
 */
export function transcriptToMarkdown(title: string, messages: MessageRecord[], maxTurns: number): string {
  const parts: string[] = [];
  parts.push(`# ${title === '' ? DEFAULT_TITLE : title}`);
  parts.push('');
  messages.forEach((m, i) => {
    parts.push(`${SPEAKER_EMOJI[m.speaker]} **${SPEAKER_LABELS[m.speaker]}** (${i + 1}/${maxTurns})`);
    parts.push('');
    // 本文は行ごとに「> 」を付けて引用にする。空行も「> 」だけの行にする(空行をそのまま出すと引用がそこで切れる)
    for (const line of m.content.split('\n')) parts.push(`> ${line}`);
    parts.push('');
    parts.push('* * *');
    parts.push('');
  });
  return parts.join('\n');
}
