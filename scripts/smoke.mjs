// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// パッケージ済み(unpacked)アプリの認証なしスモークテスト。CI で各 OS ごとに実行する。
// アプリは CVG_SMOKE_TEST=1 で起動すると初期化直後に自己診断して終了する(src/Application.ts)。
// 使い方: npx electron-builder --<os> dir && node scripts/smoke.mjs   (Linux は xvfb-run -a を前置)
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const { productName, name } = JSON.parse(readFileSync('package.json', 'utf8'));
const candidates = {
  linux: [`release/linux-unpacked/${name}`, `release/linux-arm64-unpacked/${name}`],
  darwin: [
    `release/mac-arm64/${productName}.app/Contents/MacOS/${productName}`,
    `release/mac/${productName}.app/Contents/MacOS/${productName}`,
  ],
  win32: [`release/win-unpacked/${productName}.exe`, `release/win-arm64-unpacked/${productName}.exe`],
};
const bin = (candidates[process.platform] ?? []).find((p) => existsSync(p));
if (!bin) {
  console.error(`smoke: unpacked app not found (looked for ${(candidates[process.platform] ?? []).join(', ')})`);
  process.exit(1);
}
// CI の Linux ランナーは chrome-sandbox に SUID が無く userns も制限されるため sandbox を切る
const args = process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : [];
console.log(`smoke: launching ${bin} ${args.join(' ')}`);
const child = spawn(bin, args, {
  env: { ...process.env, CVG_SMOKE_TEST: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
const timer = setTimeout(() => {
  console.error('smoke: timeout (120s)');
  child.kill('SIGKILL');
  process.exit(1);
}, 120_000);
child.stdout.on('data', (d) => {
  out += d;
  process.stdout.write(d);
});
child.stderr.on('data', (d) => process.stderr.write(d));
child.on('error', (err) => {
  console.error(`smoke: failed to start: ${err.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  clearTimeout(timer);
  const ok = code === 0 && out.includes('CVG_SMOKE_OK');
  console.log(`smoke: exit=${code ?? signal} -> ${ok ? 'OK' : 'FAIL'}`);
  process.exit(ok ? 0 : 1);
});
