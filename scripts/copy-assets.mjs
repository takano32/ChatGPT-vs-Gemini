import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist/renderer', { recursive: true });
for (const f of ['index.html', 'style.css', 'transcript.html', 'transcript.css']) {
  cpSync(`src/renderer/${f}`, `dist/renderer/${f}`);
}
// チャット用 preload は DOM を使う素の JS。tsc を通さずそのまま配置する。
cpSync('src/chat-preload.js', 'dist/chat-preload.js');
// ウィンドウ用アイコン(Linux/Windows)。build/ は配布物に含まれないため dist/ へ複製する。
cpSync('build/icon.png', 'dist/icon.png');
