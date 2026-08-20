import { WebContentsView, shell } from 'electron';
import type { WebContents } from 'electron';
import { Settings } from './Settings';
import { Window } from './Window';

export interface LayoutMountConfig {
  admin: { file: string; preload: string };
  chatgpt: { url: string; partition: string };
  gemini: { url: string; partition: string };
  transcript: { file: string; preload: string };
  /** チャットビュー用 preload(操作ロックを document_start で仕込む) */
  chatPreload: string;
}

export type PaneName = 'admin' | 'chatgpt' | 'gemini' | 'transcript';

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

// Google は「Chrome を名乗る埋め込みブラウザ」を Client Hints 等の不整合や
// WebView 検出で弾く(This browser or app may not be secure)。Firefox には
// その検査経路がなく Client Hints も送らないため、パーティション全体を一貫して
// Firefox として振る舞わせることでログインを通す。
const FIREFOX_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';

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

    this.views.chatgpt = this.createChatView(
      config.chatgpt.url,
      config.chatgpt.partition,
      config.chatPreload,
    );
    this.views.gemini = this.createChatView(
      config.gemini.url,
      config.gemini.partition,
      config.chatPreload,
    );

    // 議論経過(Markdown 対話)ビュー。チャット2枚分の領域に重ねる。
    // 完了時に前面表示。既定は非表示。ローカルページなので admin と同じ扱い。
    const transcript = new WebContentsView({
      webPreferences: {
        preload: config.transcript.preload,
        contextIsolation: true,
        sandbox: false,
        nodeIntegration: false,
      },
    });
    transcript.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    transcript.webContents.on('will-navigate', (e) => e.preventDefault());
    void transcript.webContents.loadFile(config.transcript.file);
    transcript.setVisible(false);
    this.views.transcript = transcript;

    const content = this.window.base.contentView;
    content.addChildView(admin);
    content.addChildView(this.views.chatgpt);
    content.addChildView(this.views.gemini);
    content.addChildView(transcript); // 最後 = 最前面(チャットの上に重ねる)
    this.apply();
    this.applyChatZoom();

    this.window.on('resize', () => this.apply());
    this.settings.on('change', () => {
      this.apply();
      this.applyChatZoom();
    });
  }

  /** チャットペインのズーム率を設定値に合わせる。遷移でリセットされ得るので都度呼ぶ。 */
  applyChatZoom(): void {
    const zoom = this.settings.get().layout.chatZoom;
    const z = Math.min(3, Math.max(0.25, zoom || 1));
    for (const name of ['chatgpt', 'gemini'] as const) {
      const v = this.views[name];
      if (v && !v.webContents.isDestroyed()) v.webContents.setZoomFactor(z);
    }
  }

  /** 経過ビューの表示/非表示。表示中はチャット2枚を覆う。 */
  setTranscriptVisible(show: boolean): void {
    this.views.transcript?.setVisible(show);
  }

  isTranscriptVisible(): boolean {
    const t = this.views.transcript;
    return t ? t.getVisible() : false;
  }

  private createChatView(url: string, partition: string, preload: string): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        partition,
        preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const wc = view.webContents;
    this.hardenChatContents(wc, partition.replace('persist:', ''));
    // 遷移でズームがリセットされ得るため、読み込み完了ごとに再適用
    wc.on('did-finish-load', () => {
      const z = Math.min(3, Math.max(0.25, this.settings.get().layout.chatZoom || 1));
      if (!wc.isDestroyed()) wc.setZoomFactor(z);
    });
    // ログイン画面へのリダイレクト等で reject し得るため握りつぶす
    void wc.loadURL(url).catch(() => {});
    return view;
  }

  private hardenChatContents(wc: WebContents, label: string): void {
    // 白画面・ハング調査用の診断ログ(stderr)
    wc.on('render-process-gone', (_e, details) => {
      console.error(`[pane:${label}] renderer gone: ${details.reason} (exit ${details.exitCode})`);
    });
    wc.on('unresponsive', () => console.error(`[pane:${label}] unresponsive`));
    wc.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
      if (isMainFrame && code !== -3 /* ABORTED はリダイレクトで頻発する正常系 */) {
        console.error(`[pane:${label}] load failed ${code} ${desc}`);
      }
    });
    // パーティション全体を一貫して Firefox として振る舞わせる。
    // 部分的な UA 偽装(ログインホストだけ Firefox)は navigator.userAgent と
    // Chromium が自動送出する Sec-CH-UA の不整合を生み、Google がセッション確立を
    // 拒否する(=ログインが完了しない)。UA を一貫させ、Firefox が送らない
    // Client Hints を全リクエストで除去することで矛盾をなくす。
    wc.setUserAgent(FIREFOX_UA);
    wc.session.setUserAgent(FIREFOX_UA);
    console.error(`[ua:${label}] firefox (consistent)`);

    // 全リクエストで UA を Firefox に固定し、Sec-CH-UA 系と X-Requested-With を除去。
    // (session 単位の登録。同一 session への再登録は前回リスナーの置換になるだけ)
    wc.session.webRequest.onBeforeSendHeaders((details, callback) => {
      try {
        const headers = details.requestHeaders;
        headers['User-Agent'] = FIREFOX_UA;
        for (const key of Object.keys(headers)) {
          const lower = key.toLowerCase();
          if (lower.startsWith('sec-ch-ua') || lower === 'x-requested-with') {
            delete headers[key];
          }
        }
      } catch {
        // ヘッダ加工に失敗しても必ず callback は呼ぶ(呼ばないとリクエストが永久に止まる)
      }
      callback({ requestHeaders: details.requestHeaders });
    });

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
    wc.on('did-create-window', (win) => this.hardenChatContents(win.webContents, `${label}:popup`));

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
    // 経過ビューはチャット2枚分(下段全体)に重ねる
    this.views.transcript?.setBounds({ x: 0, y: ah, width: w, height: h - ah });
  }

  view(name: PaneName): WebContentsView {
    const v = this.views[name];
    if (!v) {
      throw new Error(`Layout: pane "${name}" is not mounted`);
    }
    return v;
  }
}
