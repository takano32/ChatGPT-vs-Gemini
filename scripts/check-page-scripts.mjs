// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// src/chat/Chat.ts がページ側(executeJavaScript)へ渡すスクリプトの構文検査。
// テンプレートリテラルの中は TS/Electron では検査されず、エスケープや改行の扱いを誤ると
// 実行時に無言で失敗する(js() は例外を握りつぶす)。dist/chat/Chat.js から該当テンプレートを取り出し、
// 実行時と同じ展開(${...} はダミー値)で評価してから new Function に通す。`npm test` で走る。
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'dist/chat/Chat.js';
const src = readFileSync(file, 'utf8');
const templates = [...src.matchAll(/`([\s\S]*?)`/g)].map((m) => m[1]).filter((t) => t.includes('=>') && t.length > 200);
let bad = 0;
for (const t of templates) {
  let js;
  try {
    js = (0, eval)('`' + t.replace(/\$\{[^}]*\}/g, '(0)') + '`');
  } catch (e) {
    bad++;
    console.error(`TEMPLATE ERROR: ${e.message}`);
    continue;
  }
  try {
    new Function(js);
  } catch (e) {
    bad++;
    console.error(`SYNTAX ERROR in page script: ${e.message}\n--- script head ---\n${js.slice(0, 200)}\n---`);
  }
}
console.log(`page scripts checked: ${templates.length}, bad: ${bad}`);
process.exit(bad ? 1 : 0);
