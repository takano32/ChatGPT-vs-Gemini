import { BaseWindow } from 'electron';
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
    const { width, height } = this.settings.get().window;
    const win = new BaseWindow({
      width,
      height,
      minWidth: 1000,
      minHeight: 700,
      title: 'ChatGPT vs Gemini',
    });
    this.win = win;

    win.on('resize', () => {
      this.emit('resize');
      // 500ms デバウンスでウィンドウサイズを保存
      if (this.resizeTimer !== null) clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this.resizeTimer = null;
        if (win.isDestroyed()) return;
        const bounds = win.getBounds();
        this.settings.update({ window: { width: bounds.width, height: bounds.height } });
      }, 500);
    });

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
