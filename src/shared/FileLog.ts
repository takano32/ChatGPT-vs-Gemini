// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// 管理ペインに流すログ(議論の進行・自己修復・ペインの復旧)をファイルにも残す。
// 置き場所は Electron の慣習どおり app.getPath('logs')(Linux: userData/logs、macOS: ~/Library/Logs/<productName>、
// Windows: %APPDATA%\<productName>\logs)。管理ペインのログは 400 行で流れるので、不具合報告のために取っておく。
// 起動時に 1 MB を超えていれば 1 世代だけ退避する(main.log → main.log.1)。書き込み失敗は黙って捨てる。

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LogEntry } from './types';

const MAX_BYTES = 1024 * 1024;

export class FileLog {
  private readonly file: string;
  private failed = false;

  constructor(dir: string) {
    this.file = path.join(dir, 'main.log');
    try {
      fs.mkdirSync(dir, { recursive: true });
      const st = fs.statSync(this.file, { throwIfNoEntry: false });
      if (st && st.size > MAX_BYTES) fs.renameSync(this.file, `${this.file}.1`);
    } catch {
      this.failed = true;
    }
  }

  get path(): string {
    return this.file;
  }

  write(entry: LogEntry): void {
    if (this.failed) return;
    const line = `${entry.ts} ${entry.level.toUpperCase().padEnd(5)} ${entry.message.replace(/\r?\n/g, ' ')}\n`;
    fs.appendFile(this.file, line, (err) => {
      if (err) this.failed = true;
    });
  }
}
