// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// 経過(会話 1 件ぶんの発言列)を gist 形式の Markdown 文字列に組み立てる純粋関数。
// Electron や DB に触らないので、node:test から dist/conversation/markdown.js を読み込んでそのまま検査できる
// (test/markdown.test.mjs)。クリップボードへ書くのは呼び出し側(Application)の仕事。
//
// 出力の形(話者行を見出しにし、本文はそのまま段落で置く。見出しで境目が分かるので区切り線は入れない):
//
//   # 議論のタイトル
//
//   ### 🟢 ChatGPT (1/10)
//
//   発言本文の段落
//
//   次の段落
//
//   ### 🔵 Gemini (2/10)
//   ...
//
// 本文を引用ブロック(> )にしない理由: GitHub は引用を灰色で薄く描くので、gist に貼ると本文全体が読みにくくなる
// (2026-08-23 利用者の指摘)。話者行は「###」にして、タイトルの「#」や本文と見分けがつくようにする。
// 区切り線(---)も同日に利用者の判断で廃止(見出しがあれば不要)。

import { SPEAKER_LABELS, type MessageRecord, type Speaker } from '../shared/types';
import { tm } from '../shared/i18n';

/** 話者の目印。ChatGPT は緑、Gemini は青(経過表示の話者チップと同じ色分け) */
const SPEAKER_EMOJI: Record<Speaker, string> = { chatgpt: '🟢', gemini: '🔵' };


/**
 * 経過を Markdown 文字列にする。
 *
 * @param title    会話のタイトル(= 議論テーマ)。空文字なら「議論」にする。複数行なら 1 行目を見出しにし、残りを段落として続ける
 * @param messages 発言(古い順)。空なら見出しだけを返す(コピーするかどうかは呼び出し側で判断する)
 * @param maxTurns その会話の最大ターン数。各発言の「(n/maxTurns)」の分母になる
 */
export function transcriptToMarkdown(title: string, messages: MessageRecord[], maxTurns: number): string {
  const parts: string[] = [];
  const [head = '', ...rest] = title.split('\n');
  parts.push(`# ${head.trim() === '' ? tm('md.untitled') : head.trim()}`);
  parts.push('');
  const body = rest.join('\n').trim();
  if (body !== '') {
    parts.push(body);
    parts.push('');
  }
  messages.forEach((m, i) => {
    parts.push(`### ${SPEAKER_EMOJI[m.speaker]} ${SPEAKER_LABELS[m.speaker]} (${i + 1}/${maxTurns})`);
    parts.push('');
    // 本文は Markdown 版があればそれを、無ければ(旧データ・直列化に失敗した発言)プレーン文をそのまま置く。
    // 末尾の改行だけ落として、次の要素との間が空行 1 つになるようにする
    parts.push((m.contentMd ?? m.content).replace(/\n+$/, ''));
    parts.push('');
  });
  return parts.join('\n');
}
