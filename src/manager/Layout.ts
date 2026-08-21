import { WebContentsView, shell } from 'electron';
import type { WebContents } from 'electron';
import { SPEAKER_LABELS } from '../shared/types';
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
/** 自動復旧(再読込)の対象になるチャットペイン */
export type ChatPaneName = 'chatgpt' | 'gemini';

// 読込失敗の自動再読込の上限回数。間隔は 2, 4, 8, 16, 30, 30, ... 秒なので約 3.5 分は粘る。
// それでも駄目なら(ネットワークが長く切れている等)通知してやめる
const LOAD_RETRY_MAX = 10;
// 描画プロセスが落ちたらこの時間のあとに読み込み直す
const CRASH_RELOAD_DELAY_MS = 1000;
// 読み込むたびに落ちるページで無限ループしないよう、この時間内に上限を超えて落ちたら再読込をやめる
const CRASH_WINDOW_MS = 60000;
const CRASH_RELOAD_MAX = 3;
// 'unresponsive' のあと、この時間応答が戻らなければ('responsive' で解除)読み込み直す
const HANG_RELOAD_AFTER_MS = 30000;

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
  /**
   * チャットペインの自動復旧(読込失敗・異常終了・ハングの再読込、証明書エラー)の通知先。
   * message は利用者向けの日本語 1 行。Application が管理ペインのログに WARN で流す
   */
  onPaneNotice: ((pane: ChatPaneName, message: string) => void) | null = null;

  constructor(window: Window, settings: Settings) {
    this.window = window;
    this.settings = settings;
  }

  private notify(pane: ChatPaneName, message: string): void {
    try {
      if (this.onPaneNotice) this.onPaneNotice(pane, message);
    } catch {
      // 通知先の失敗でペインの復旧を止めない
    }
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
      'chatgpt',
      config.chatgpt.url,
      config.chatgpt.partition,
      config.chatPreload,
    );
    this.views.gemini = this.createChatView(
      'gemini',
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

  private createChatView(
    pane: ChatPaneName,
    url: string,
    partition: string,
    preload: string,
  ): WebContentsView {
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
    this.hardenChatContents(wc, pane);
    // 遷移でズームがリセットされ得るため、読み込み完了ごとに再適用
    wc.on('did-finish-load', () => {
      const z = Math.min(3, Math.max(0.25, this.settings.get().layout.chatZoom || 1));
      if (!wc.isDestroyed()) wc.setZoomFactor(z);
    });
    // ログイン画面へのリダイレクト等で reject し得るため握りつぶす
    void wc.loadURL(url).catch(() => {});
    // 自動復旧。いずれも何が起きて次に何をするかを onPaneNotice で知らせる
    this.reloadOnLoadFailure(wc, pane, url);
    this.reloadOnCrashOrHang(wc, pane);
    this.noticeCertificateError(wc, pane);
    return view;
  }

  // メインフレームの読み込みが失敗したら(起動直後のネットワーク切替等、実測: ERR_NETWORK_CHANGED)
  // エラーページのまま放置せず、指数バックオフで再読込する。成功したら回数を戻す。
  // 上限まで再読込しても駄目なら、それ以上は試さずに通知だけ出す(起動し直しを案内)
  private reloadOnLoadFailure(wc: WebContents, pane: ChatPaneName, url: string): void {
    const name = SPEAKER_LABELS[pane];
    let failures = 0;
    let timer: NodeJS.Timeout | null = null;
    wc.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
      if (!isMainFrame || code === -3 /* ABORTED はリダイレクトで頻発する正常系 */) return;
      failures += 1;
      const reason = desc || String(code); // desc は ERR_NETWORK_CHANGED のような名前
      if (failures > LOAD_RETRY_MAX) {
        this.notify(
          pane,
          `${name} のページを ${LOAD_RETRY_MAX} 回再読込しても読み込めませんでした(${reason})。` +
            '自動の再読込をやめます。ネットワークを確認し、アプリを終了して起動し直してください',
        );
        return;
      }
      const delay = Math.min(30000, 2000 * 2 ** Math.min(failures - 1, 4));
      this.notify(
        pane,
        `${name} のページを読み込めませんでした(${reason})。` +
          `${delay / 1000} 秒後に再読込します(${failures}/${LOAD_RETRY_MAX} 回目)`,
      );
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        // 既に別の経路(newChat 等)で復帰していれば何もしない
        if (wc.isDestroyed() || !wc.getURL().startsWith('chrome-error://')) return;
        void wc.loadURL(url).catch(() => {});
      }, delay);
    });
    wc.on('did-finish-load', () => {
      if (!wc.getURL().startsWith('chrome-error://')) failures = 0;
    });
    wc.on('destroyed', () => {
      if (timer) clearTimeout(timer);
    });
  }

  // 描画プロセスが落ちたら少し待って読み込み直す。ハングが一定時間続いたらプロセスを止めて読み込み直す。
  // 読み込むたびに落ちるページで無限ループしないよう、短時間に繰り返したら再読込をやめて通知する
  private reloadOnCrashOrHang(wc: WebContents, pane: ChatPaneName): void {
    const name = SPEAKER_LABELS[pane];
    let recentCrashes: number[] = []; // 直近 CRASH_WINDOW_MS 内に落ちた時刻
    let reloadTimer: NodeJS.Timeout | null = null;
    let hangTimer: NodeJS.Timeout | null = null;
    // ハング解消のためにこちらから止めた終了は、異常終了として数えない(reload も自分で呼ぶ)
    let killedForHang = false;

    const cancelHangTimer = (): void => {
      if (hangTimer) clearTimeout(hangTimer);
      hangTimer = null;
    };

    wc.on('render-process-gone', (_e, details) => {
      cancelHangTimer(); // 落ちたプロセスのハング計測は無意味(新しいプロセスを誤って止めない)
      if (details.reason === 'clean-exit') return;
      if (killedForHang) {
        killedForHang = false;
        return;
      }
      const now = Date.now();
      recentCrashes = recentCrashes.filter((t) => now - t <= CRASH_WINDOW_MS);
      recentCrashes.push(now);
      if (recentCrashes.length > CRASH_RELOAD_MAX) {
        this.notify(
          pane,
          `${name} の画面が ${CRASH_WINDOW_MS / 1000} 秒間に ${recentCrashes.length} 回止まりました(${details.reason})。` +
            'しばらく再読込を見合わせます。続くようならアプリを終了して起動し直してください',
        );
        return;
      }
      this.notify(
        pane,
        `${name} の画面が予期せず終了しました(${details.reason})。` +
          `${CRASH_RELOAD_DELAY_MS / 1000} 秒後に読み込み直します`,
      );
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        if (!wc.isDestroyed()) wc.reload();
      }, CRASH_RELOAD_DELAY_MS);
    });

    wc.on('unresponsive', () => {
      if (hangTimer) return; // 計測中
      hangTimer = setTimeout(() => {
        hangTimer = null;
        // 既に落ちていれば render-process-gone 側で読み込み直す
        if (wc.isDestroyed() || wc.isCrashed()) return;
        this.notify(
          pane,
          `${name} の画面が ${HANG_RELOAD_AFTER_MS / 1000} 秒以上応答しないため、読み込み直します`,
        );
        // ハングした描画プロセスは reload に応じられないので、Electron のドキュメントにある
        // unresponsive からの回復手順どおり、プロセスを止めてから reload する(新しいプロセスで読み込まれる)
        killedForHang = true;
        wc.forcefullyCrashRenderer();
        wc.reload();
      }, HANG_RELOAD_AFTER_MS);
    });
    wc.on('responsive', cancelHangTimer);
    wc.on('did-finish-load', () => {
      // 読み込みを終えられた = 応答している。こちらから止めた終了の印もここで消す
      cancelHangTimer();
      killedForHang = false;
    });
    wc.on('destroyed', () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      cancelHangTimer();
    });
  }

  // 証明書エラーは Electron の既定どおり拒否する(callback を呼ばなければ拒否)。黙って失敗させず通知だけ出す。
  // 続けて did-fail-load(ERR_CERT_*)が来るので、再読込は reloadOnLoadFailure に任せる
  private noticeCertificateError(wc: WebContents, pane: ChatPaneName): void {
    wc.on('certificate-error', (_e, _url, error, _cert, _callback, isMainFrame) => {
      if (!isMainFrame) return;
      this.notify(
        pane,
        `${SPEAKER_LABELS[pane]} の証明書エラー(${error})のため、このページの表示を中止しました。` +
          'パソコンの日時や Wi-Fi の利用登録を確認してください',
      );
    });
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
