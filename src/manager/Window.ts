// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { BaseWindow, app, screen } from 'electron';
import * as path from 'path';
import { EventEmitter } from 'events';
import { Settings } from './Settings';

/** BaseWindow の生成とサイズ永続化。emit: 'resize' / 'closed' */
export class Window extends EventEmitter {
  private readonly settings: Settings;
  private win: BaseWindow | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(settings: Settings) {
    super();
    this.settings = settings;
  }

  create(): void {
    const { width, height, x, y } = this.settings.get().window;
    // 前回の位置を復元する。モニタ構成が変わって画面外になっていたら OS に任せる
    // (Wayland では位置の指定が効かないことがあるが、指定しても害はない)
    const onSomeDisplay =
      x !== null &&
      y !== null &&
      screen
        .getAllDisplays()
        .some(
          ({ workArea }) =>
            x >= workArea.x - 8 &&
            y >= workArea.y - 8 &&
            x < workArea.x + workArea.width &&
            y < workArea.y + workArea.height,
        );
    const win = new BaseWindow({
      ...(onSomeDisplay ? { x, y } : {}),
      width,
      height,
      minWidth: 1000,
      minHeight: 700,
      title: 'ChatGPT vs Gemini',
      // macOS はバンドルのアイコンが使われる。Linux/Windows はウィンドウに明示する
      ...(process.platform === 'darwin' ? {} : { icon: path.join(app.getAppPath(), 'dist/icon.png') }),
    });
    this.win = win;

    // 500ms デバウンスでウィンドウの大きさと位置をまとめて保存
    const scheduleSave = (): void => {
      if (this.resizeTimer !== null) clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this.resizeTimer = null;
        if (win.isDestroyed()) return;
        const b = win.getBounds();
        this.settings.update({ window: { width: b.width, height: b.height, x: b.x, y: b.y } });
      }, 500);
    };
    win.on('resize', () => {
      this.emit('resize');
      scheduleSave();
    });
    win.on('move', scheduleSave);

    win.on('closed', () => {
      if (this.resizeTimer !== null) {
        clearTimeout(this.resizeTimer);
        this.resizeTimer = null;
      }
      this.win = null;
      this.emit('closed');
    });
  }

  get base(): BaseWindow {
    if (this.win === null) {
      throw new Error('Window.create() has not been called');
    }
    return this.win;
  }
}
