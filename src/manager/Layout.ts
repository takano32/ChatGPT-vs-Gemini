import { WebContentsView, shell } from 'electron';
import type { WebContents } from 'electron';
import { Settings } from './Settings';
import { Window } from './Window';

export interface LayoutMountConfig {
  admin: { file: string; preload: string };
  chatgpt: { url: string; partition: string };
  gemini: { url: string; partition: string };
}

export type PaneName = 'admin' | 'chatgpt' | 'gemini';

// SSO ログインのポップアップをアプリ内(同一 partition)で許可するホスト。
// 完全一致またはドットサフィックス一致。
// 注意: 'google.com' や 'auth0.com' のような裸ドメインをサフィックス許可すると
// sites.google.com 等の攻撃者制御ホストまで通してしまうため、具体ホストのみ列挙する
const POPUP_ALLOWED_HOSTS: readonly string[] = [
  'accounts.google.com',
  'accounts.youtube.com',
  'gemini.google.com',
  'chatgpt.com',
  'openai.com',
  'auth.openai.com',
  'auth0.openai.com',
  'appleid.apple.com',
  'login.live.com',
  'login.microsoftonline.com',
  'github.com',
];

function isPopupAllowed(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  return POPUP_ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith('.' + h));
}

/** 3 ペイン (admin / chatgpt / gemini) の WebContentsView 管理と矩形計算 */
export class Layout {
  private readonly window: Window;
  private readonly settings: Settings;
  private views: Partial<Record<PaneName, WebContentsView>> = {};

  constructor(window: Window, settings: Settings) {
    this.window = window;
    this.settings = settings;
  }

  mount(config: LayoutMountConfig): void {
    // 管理ペイン。preload が dist/shared/ipc.js を require するため sandbox は false 必須
    const admin = new WebContentsView({
      webPreferences: {
        preload: config.admin.preload,
        contextIsolation: true,
        sandbox: false,
        nodeIntegration: false,
      },
    });
    admin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // 管理ペインが外部ページへ遷移すると preload の window.api が
    // リモートページに渡ってしまうため、一切のナビゲーションを禁止する
    // (loadFile 自体には will-navigate は発火しない)
    admin.webContents.on('will-navigate', (e) => e.preventDefault());
    void admin.webContents.loadFile(config.admin.file);
    this.views.admin = admin;

    this.views.chatgpt = this.createChatView(config.chatgpt.url, config.chatgpt.partition);
    this.views.gemini = this.createChatView(config.gemini.url, config.gemini.partition);

    const content = this.window.base.contentView;
    content.addChildView(admin);
    content.addChildView(this.views.chatgpt);
    content.addChildView(this.views.gemini);
    this.apply();

    this.window.on('resize', () => this.apply());
    this.settings.on('change', () => this.apply());
  }

  private createChatView(url: string, partition: string): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        partition,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const wc = view.webContents;
    this.hardenChatContents(wc);
    // ログイン画面へのリダイレクト等で reject し得るため握りつぶす
    void wc.loadURL(url).catch(() => {});
    return view;
  }

  private hardenChatContents(wc: WebContents): void {
    // Electron/アプリ名トークンを UA から除去(Google ログイン拒否対策)
    const cleaned = wc
      .getUserAgent()
      .replace(/ chatgpt-vs-gemini\/[^ ]+/, '')
      .replace(/ Electron\/[^ ]+/, '');
    wc.setUserAgent(cleaned);

    // SSO ポップアップは partition 共有のためアプリ内で許可、それ以外は外部ブラウザへ
    wc.setWindowOpenHandler((details) => {
      if (isPopupAllowed(details.url)) {
        return { action: 'allow' };
      }
      if (/^https?:/i.test(details.url)) {
        void shell.openExternal(details.url);
      }
      return { action: 'deny' };
    });

    // 通知・位置情報・メディア等の許可要求はすべて拒否
    wc.session.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));

    // 許可した SSO ポップアップの子ウィンドウにも同じ強化を再帰適用する
    wc.on('did-create-window', (win) => this.hardenChatContents(win.webContents));

    // will-navigate はブロックしない(ログインはドメインをまたいで遷移する)
  }

  apply(): void {
    const admin = this.views.admin;
    const chatgpt = this.views.chatgpt;
    const gemini = this.views.gemini;
    if (!admin || !chatgpt || !gemini) return;

    const [w, h] = this.window.base.getContentSize();
    const { adminRatio, chatSplit } = this.settings.get().layout;
    // 設定ファイルの手編集等で 0 や 1 が入ってもペインが潰れないよう防衛的にクランプ
    const clampRatio = (n: number): number => Math.min(0.95, Math.max(0.05, n));
    const ah = Math.round(h * clampRatio(adminRatio));
    const cw = Math.round(w * clampRatio(chatSplit));

    admin.setBounds({ x: 0, y: 0, width: w, height: ah });
    chatgpt.setBounds({ x: 0, y: ah, width: cw, height: h - ah });
    gemini.setBounds({ x: cw, y: ah, width: w - cw, height: h - ah });
  }

  view(name: PaneName): WebContentsView {
    const v = this.views[name];
    if (!v) {
      throw new Error(`Layout: pane "${name}" is not mounted`);
    }
    return v;
  }
}
