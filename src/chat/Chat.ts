// サイト非依存のチャット自動操作アルゴリズム。
// 制約: main プロセスには DOM 型が無い。ページ操作は全て自己完結 IIFE 文字列を
// executeJavaScript に渡す形で行い、セレクタや本文は JSON.stringify で埋め込む。

import { WebContentsView } from 'electron';
import { Speaker, SPEAKER_LABELS, SettingsData } from '../shared/types';
import { SiteSelectors } from './selectors';

export type ChatErrorCode =
  | 'not-ready'
  | 'rate-limited'
  | 'timeout'
  | 'selector'
  | 'send-failed'
  | 'stopped';

export class ChatError extends Error {
  constructor(readonly code: ChatErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ChatError';
  }
}

// 送信ボタン待ち・送信開始確認用の短周期ポーリング間隔
const SHORT_POLL_MS = 100;

// 送信の試行回数。クリックが効かない・リクエストが失敗して応答が現れない等の
// 取りこぼしを自己修復し、議論を止めないための上限。
const SEND_ATTEMPTS = 3;
// 送信ボタンが押せる状態になるのを待つ時間。過ぎたら Enter キーに切り替える
const SEND_BUTTON_MS = 5000;
// 送信クリック後、生成指標(停止ボタン or 応答数の増加)が現れるのを待つ時間
const SEND_START_MS = 10000;
// Enter キーフォールバック後の待ち時間
const ENTER_START_MS = 5000;
// 停止ボタンが指標にならず応答要素の出現だけを待つときの窓。応答要素は送信から
// 数秒(実測 1.5〜3 秒、思考モードではそれ以上)遅れて現れるため、停止ボタン向けより長く取る
const SLOW_START_MS = 15000;
// 再送前の小休止
const RETRY_DELAY_MS = 1000;
// 残っていた停止ボタンを押してから、UI が送信状態に戻るのを待つ時間
const STOP_RELEASE_MS = 1000;
// 生成指標が無いまま応答要素が現れない状態がこの時間続いたら、送信が失われたとみなす
const LOST_SEND_MS = 8000;
// 停止ボタンは出ているのに応答要素が一向に現れない状態の上限。リクエスト失敗で
// ボタンだけが固着したとみなし、以降は停止ボタンを指標にしない
const STOP_WITHOUT_RESPONSE_MS = 45000;
// エラー吹き出しとみなす本文長の上限。正規の回答が文中でエラー文言を引用しても誤検知しないため
const ERROR_TEXT_MAX = 400;
// ページ状態の取得(executeJavaScript)が失敗し続ける上限。遷移中の一瞬の失敗は許容し、
// レンダラのクラッシュ等で取得できないままなら timeoutMs まで黙らずエラーにする
const PROBE_FAILURE_MS = 20000;

// 新規チャットの準備待ちの上限と、準備ができないときに遷移をやり直す間隔
const NEW_CHAT_TIMEOUT_MS = 45000;
const NEW_CHAT_RENAV_MS = 10000;

// 完了の多重確認。「応答あり・生成指標なし・本文が前回ポーリングから不変」を
// 連続でこの回数観測したら完了とする。確認中はポーリングを速める。
const COMPLETION_CONFIRMATIONS = 2;
const CONFIRM_POLL_MS = 500;
// 確認間隔の下限。pollMs を極端に小さくしても確認窓(間隔×回数)が潰れないようにする
const CONFIRM_POLL_MIN_MS = 150;

interface ProbeResult {
  count: number;
  lastKey: string | null; // 最後の応答要素の識別子(data-message-id / id)。無いサイトでは null
  keys: string[]; // いま DOM にある応答要素の識別子(仮想化で古いものは消えている)
  lastText: string;
  streaming: boolean;
  limited: boolean;
  failed: boolean; // 最後の応答要素がエラー吹き出し(短い本文にエラー文言)
  follower: boolean; // ページ側のスクロール追従が仕込まれているか(遷移で消える)
}

// 「新しい応答が現れたか」の判定材料。
// 実測: ChatGPT はスレッド描画を仮想化しており、DOM には直近 5 ターン程度しか無い
// (古い要素は外される)。応答要素の件数は 4 通目以降増えないため、件数だけで判定すると
// 本当は返ってきている回答を「応答なし」と誤判定する(turn 7 の沈黙の正体)。
// そこで応答要素の識別子(ChatGPT: data-message-id / Gemini: id)を使い、
// 「最後の応答要素の識別子が未見」を新しい応答の条件にする。識別子が無いサイトでは件数に退避。
interface ResponseBaseline {
  count: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export abstract class Chat {
  private busy = false;
  private abortRequested = false;
  private readonly origin: string;
  // 議論中の操作ロック(スクロール以外の実ユーザ操作を遮断)。
  // 望ましいロック状態。入力フェーズ中は一時的に window.__cvgLock を外す。
  private lockDesired = false;
  private inputPhase = false;
  // 送信の再試行など、議論は止めないが利用者に見せたい出来事の通知先(Runner が設定)
  notice: ((message: string) => void) | null = null;
  // この会話でこれまでに見た応答要素の識別子。newChat で空にする。
  // 利用者が上へスクロールして古い要素が最後尾に見えても、新しい応答と取り違えないために使う。
  private seenKeys = new Set<string>();

  constructor(
    readonly name: Speaker,
    protected readonly view: WebContentsView,
    protected readonly selectors: SiteSelectors,
    protected readonly getDetection: () => SettingsData['detection'],
  ) {
    this.origin = new URL(selectors.url).origin;
  }

  get displayName(): string {
    return SPEAKER_LABELS[this.name];
  }

  // ナビゲーション中・CSP 例外などは全て null に潰す
  protected async js<T>(script: string): Promise<T | null> {
    try {
      return (await this.view.webContents.executeJavaScript(script, true)) as T;
    } catch {
      return null;
    }
  }

  // ログイン状態はセッション Cookie の有無で見る(DOM と違い遷移でブレない)。表示専用。
  // 両サイトともログインなしで使えるので、送信可否の判定には使わない(isReady を使う)。
  async isAuthenticated(): Promise<boolean> {
    try {
      const cookies = await this.view.webContents.session.cookies.get({
        domain: this.selectors.authCookieDomain,
      });
      return cookies.some((c) => c.name.startsWith(this.selectors.authCookiePrefix));
    } catch {
      return false;
    }
  }

  // 送信できる状態か: サイトの origin にいて入力欄が実在する。ログインの有無は問わない。
  async isReady(): Promise<boolean> {
    const url = this.view.webContents.getURL();
    // startsWith だと類似ドメイン(例: chatgpt.com.evil.io)をすり抜けるため origin 厳密比較
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      return false;
    }
    if (origin !== this.origin) return false;
    const ok = await this.js<boolean>(
      `!!document.querySelector(${JSON.stringify(this.selectors.input)})`,
    );
    return ok === true;
  }

  // ゲスト UI の片付け(ページ常駐)。hidePatterns の文言を含む最小のカード/トーストを隠す。
  // 入力欄・応答一覧・header/nav/main を含む要素は隠さない(ログインの入口も残る)。
  // MutationObserver で変化のたびに(300ms に 1 回まで)適用する。状態は window.__cvgTidy(遷移で消える)。
  async ensureTidy(): Promise<void> {
    const s = this.selectors;
    if (s.hidePatterns.length === 0) return;
    await this.js(
      `(() => {
        if (window.__cvgTidy) return true;
        const HIDE = ${JSON.stringify(s.hidePatterns.map((p) => p.toLowerCase()))};
        const INPUT = ${JSON.stringify(s.input)};
        const MSG = ${JSON.stringify(s.assistantMessages)};
        const st = { timer: 0 };
        window.__cvgTidy = st;
        const textOf = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
        const isProtected = (e) =>
          e === document.body || e === document.documentElement ||
          e.matches('main, header, nav, form') || e.querySelector(INPUT) || e.querySelector(MSG);
        const hideNags = () => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = walker.nextNode())) {
            const t = n.textContent.toLowerCase();
            if (!HIDE.some((p) => t.includes(p))) continue;
            let el = n.parentElement;
            if (!el || el.style.display === 'none') continue;
            // カードの境界まで上る: 親の本文が短い(300 文字未満)あいだは同じカードとみなす
            while (el.parentElement && !isProtected(el.parentElement) && textOf(el.parentElement).length < 300) {
              el = el.parentElement;
            }
            if (isProtected(el)) continue;
            el.style.setProperty('display', 'none', 'important');
          }
        };
        const run = () => { st.timer = 0; try { hideNags(); } catch (e) {} };
        const schedule = () => { if (!st.timer) st.timer = setTimeout(run, 300); };
        new MutationObserver(schedule).observe(document.documentElement, {
          childList: true, subtree: true, characterData: true,
        });
        schedule();
        return true;
      })()`,
    );
  }

  // ゲスト利用中にサイトが出すログイン要求ダイアログを閉じる。閉じたら true。
  private async dismissLoginNag(): Promise<boolean> {
    const patterns = this.selectors.dismissPatterns.map((p) => p.toLowerCase());
    if (patterns.length === 0) return false;
    const clicked = await this.js<boolean>(
      `(() => {
        // position:fixed のモーダルは offsetParent が null になるので getClientRects で可視判定する
        const dialogs = [...document.querySelectorAll('[role="dialog"], dialog, mat-dialog-container')]
          .filter((d) => d.open || d.getClientRects().length > 0)
          .filter((d) => /log ?in|sign ?in|ログイン/i.test(d.innerText || ''));
        const patterns = ${JSON.stringify(patterns)};
        for (const d of dialogs) {
          for (const b of d.querySelectorAll('a, button')) {
            const t = (b.textContent || '').trim().toLowerCase();
            if (t && patterns.some((p) => t.includes(p))) { b.click(); return true; }
          }
        }
        return false;
      })()`,
    );
    if (clicked === true) this.notify(`${this.displayName} のログイン要求ダイアログを閉じました(ログインなしで続行)`);
    return clicked === true;
  }

  isPageLoading(): boolean {
    const wc = this.view.webContents;
    return wc.isDestroyed() || wc.isLoading();
  }

  async isRateLimited(): Promise<boolean> {
    const hit = await this.js<boolean>(
      `(() => {
        const tail = ((document.body && document.body.innerText) || '').slice(-4000);
        return ${JSON.stringify(this.selectors.rateLimitPatterns)}.some((p) => tail.includes(p));
      })()`,
    );
    return hit === true;
  }

  // 同時実行は 1 件のみ
  async ask(text: string): Promise<string> {
    if (this.busy) throw new ChatError('send-failed', 'busy');
    this.busy = true;
    this.abortRequested = false;
    try {
      return await this.askInner(text);
    } finally {
      this.busy = false;
    }
  }

  stop(): void {
    this.abortRequested = true;
    // ページ側の停止ボタンは投げっぱなしでクリック
    void this.clickStop();
  }

  private async clickStop(): Promise<void> {
    await this.js(
      `(() => {
        const el = document.querySelector(${JSON.stringify(this.selectors.stopButton)});
        if (el) el.click();
        return true;
      })()`,
    );
  }

  // 新規チャットを開始する。ベース URL へ遷移すると空の新しい会話になる
  // (chatgpt.com/ も gemini.google.com/app も常に新規チャット。既存会話は /c/ /app/<id>)。
  // 遷移後、入力欄が使える状態になるまで待つ。議論ごとに前の文脈を持ち越さないために使う。
  // ネットワーク切替等で遷移が失敗してエラーページに落ちることがある(実測: ERR_NETWORK_CHANGED)。
  // 1 回の遷移に賭けて待ち続けず、エラーページを検知したら即、そうでなくても一定時間
  // 準備ができなければ遷移をやり直す。
  async newChat(): Promise<void> {
    const wc = this.view.webContents;
    this.seenKeys.clear();
    // 既にベース URL の空チャットにいる(起動直後など)なら再読込しない。議論開始が 3〜4 秒速くなる
    if (await this.isFreshChat()) {
      await this.setPageLock(this.lockDesired);
      return;
    }
    const deadline = Date.now() + NEW_CHAT_TIMEOUT_MS;
    let navigatedAt = 0;
    const navigate = async (): Promise<void> => {
      navigatedAt = Date.now();
      // 進行中のリダイレクトで reject し得るため握りつぶす
      await wc.loadURL(this.selectors.url).catch(() => {});
    };
    await navigate();
    for (;;) {
      if (await this.isReady()) {
        // 遷移で剥がれたブロッカ/バッジを再注入し、望ましいロック状態を反映
        await this.setPageLock(this.lockDesired);
        return;
      }
      if (Date.now() >= deadline) {
        throw new ChatError('selector', `新規チャットの準備ができません: ${this.displayName}`);
      }
      const onErrorPage = wc.getURL().startsWith('chrome-error://');
      const stale = Date.now() - navigatedAt >= NEW_CHAT_RENAV_MS;
      if ((onErrorPage && Date.now() - navigatedAt >= 1000) || stale) {
        await navigate();
      }
      await sleep(500);
    }
  }

  // ベース URL にいて、応答も生成中表示も無く、入力欄が使える = 新規チャットとして使える状態
  private async isFreshChat(): Promise<boolean> {
    if (!(await this.isReady())) return false;
    let path: string;
    try {
      path = new URL(this.view.webContents.getURL()).pathname.replace(/\/+$/, '');
    } catch {
      return false;
    }
    const basePath = new URL(this.selectors.url).pathname.replace(/\/+$/, '');
    if (path !== basePath) return false;
    const snap = await this.probe({ count: 0 });
    return !!snap && snap.count === 0 && !snap.streaming;
  }

  // 議論中の操作ロックの ON/OFF。スクロール(ホイール/スクロールキー)以外の
  // 実ユーザ操作を遮断し、議論中に状態を壊されたり入力を改変されたりするのを防ぐ。
  // 待機中は解除され、ログインや手動のチャットが自由にできる。
  async setInteractionLock(locked: boolean): Promise<void> {
    this.lockDesired = locked;
    if (this.inputPhase) return; // 入力中は askInner の finally が lockDesired を反映する
    await this.setPageLock(locked);
  }

  // ロック状態は localStorage に持たせる(chat-preload.js が document_start で読み、
  // 遷移をまたいで隙間なくロックを維持する)。__cvgLock=遮断 / __cvgLockUi=バッジ表示。
  // 入力フェーズでは遮断だけ外し、バッジ表示は lockDesired のまま維持してちらつきを防ぐ。
  private async setPageLock(blockLocked: boolean, uiLocked?: boolean): Promise<void> {
    const ui = uiLocked === undefined ? blockLocked : uiLocked;
    await this.js(
      `(() => { try {` +
        ` localStorage.setItem('__cvgLock', ${blockLocked ? "'1'" : "'0'"});` +
        ` localStorage.setItem('__cvgLockUi', ${ui ? "'1'" : "'0'"});` +
        ` } catch (e) {} return true; })()`,
    );
  }

  private async askInner(text: string): Promise<string> {
    const s = this.selectors;

    await this.dismissLoginNag();
    if (!(await this.isReady())) {
      throw new ChatError(
        'not-ready',
        `${this.displayName} の入力欄が見つかりません。下のパネルでページの状態を確認してください`,
      );
    }

    const baseline = await this.captureBaseline();

    // 入力フェーズ開始。insertText / Enter は実入力経路(isTrusted=true)を通り
    // 操作ロックに弾かれるため、この間だけ遮断を外す(el.click は isTrusted=false で通る)。
    // バッジは lockDesired のまま維持してちらつかせない。
    this.inputPhase = true;
    await this.setPageLock(false, this.lockDesired);
    try {
      return await this.sendAndAwait(text, baseline);
    } finally {
      this.inputPhase = false;
      await this.setPageLock(this.lockDesired);
    }
  }

  // 送信〜応答完了。送信の取りこぼしは最大 SEND_ATTEMPTS 回まで自己修復する。
  // 二重送信を避けるため、再送の前には必ず「前回の送信が遅れて始まっていないか」を確認する。
  private async sendAndAwait(text: string, initialBaseline: ResponseBaseline): Promise<string> {
    // 送信前から停止ボタンが残っている = 前回の生成が閉じずに UI が「生成中」のまま固まっている
    // (実測: ストリーム切断時に起きる。送信ボタンが出ないので次が送れない)。
    // まず押して生成状態を解除する。それでも消えなければ固着として生成指標から外す。
    let ignoreStop = false;
    if (await this.stopVisible()) {
      await this.clickStop();
      await sleep(STOP_RELEASE_MS);
      ignoreStop = await this.stopVisible();
      this.notify(
        ignoreStop
          ? `${this.displayName} の停止ボタンが消えません。応答の有無だけで判定します`
          : `${this.displayName} に残っていた生成状態を解除しました`,
      );
    }
    // 応答の代わりにエラー吹き出しが追加された場合、それは履歴に残るので基準件数を進める
    let baseline = initialBaseline;

    for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt++) {
      this.throwIfAborted();

      let started: boolean;
      if (attempt > 1 && (await this.sendStarted(baseline, ignoreStop))) {
        // 前回の送信が遅れて始まっていた。再送せずそのまま完了待ちに入る
        started = true;
      } else {
        if (attempt > 1) {
          this.throwIfAborted(); // 停止後に「再試行します」と出さない
          this.notify(`${this.displayName} への送信を再試行します(${attempt}/${SEND_ATTEMPTS} 回目)`);
          // ゲスト利用では送信しようとした瞬間にログイン要求ダイアログが出て送信が塞がれる
          // (実測: Gemini は 4 回答えた後)。再試行の前に閉じる
          await this.dismissLoginNag();
        }
        try {
          started = await this.submit(text, baseline, ignoreStop);
        } catch (err) {
          if (attempt === SEND_ATTEMPTS) throw err;
          if (err instanceof ChatError && err.code === 'stopped') throw err;
          started = false;
        }
      }

      if (!started) {
        if (attempt === SEND_ATTEMPTS) {
          throw new ChatError('send-failed', `${this.displayName} への送信が開始しません`);
        }
        this.throwIfAborted();
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      const outcome = await this.waitForCompletion(baseline, ignoreStop);
      if (outcome.reply !== null) return outcome.reply;
      // 正規の応答が来ないまま終わった(応答要素が現れない / エラー吹き出し / 空応答)。再送へ。
      // 停止ボタンだけが出続けていたなら固着とみなし、以降は指標から外す
      if (outcome.stuckStop) {
        await this.clickStop(); // 固着した生成状態を解除してから送り直す
        await sleep(STOP_RELEASE_MS);
        ignoreStop = await this.stopVisible();
      }
      baseline = outcome.baseline;
      if (attempt === SEND_ATTEMPTS) break;
      this.throwIfAborted(); // 停止後に「やり直します」と出さない
      this.notify(`${this.displayName} の${outcome.why}。送信をやり直します`);
      await sleep(RETRY_DELAY_MS);
    }
    throw new ChatError(
      'send-failed',
      `${this.displayName} への送信が ${SEND_ATTEMPTS} 回とも応答に至りませんでした`,
    );
  }

  // 1 回分の送信操作: 入力欄をクリア → 本文を挿入 → 送信クリック → 生成開始の確認。
  // 送信ボタンが押せない/開始が確認できなければ Enter キーでフォールバックし、
  // それでも始まらなければ false(呼び出し側が再試行する)。
  private async submit(text: string, baseline: ResponseBaseline, ignoreStop: boolean): Promise<boolean> {
    const s = this.selectors;

    this.throwIfAborted(); // 停止後に入力欄へ本文を残さない
    if (!(await this.focusInput())) {
      throw new ChatError('selector', s.input);
    }

    // 送信前に入力欄を空にする。ChatGPT は下書きを復元するため(実測)、
    // クリアしないと insertText が既存文へ追記してプロンプトが壊れる。
    await this.js(
      `(() => {
        const el = document.querySelector(${JSON.stringify(s.input)});
        if (!el) return false;
        el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        return true;
      })()`,
    );

    // insertText は Chromium の実入力経路を通るため ProseMirror/Quill も受理する
    const wc = this.view.webContents;
    wc.focus();
    await wc.insertText(text);
    let len = await this.inputTextLength();
    if (len <= 0) {
      await this.js<boolean>(
        `(() => {
          const el = document.querySelector(${JSON.stringify(s.input)});
          if (!el) return false;
          el.focus();
          return document.execCommand('insertText', false, ${JSON.stringify(text)});
        })()`,
      );
      len = await this.inputTextLength();
      if (len <= 0) {
        throw new ChatError('send-failed', 'input did not accept text');
      }
    }

    // 送信ボタンをクリックし、送信が実際に始まったことを確認する。
    // ボタンが押せない(固着で stop 表示のまま等)場合や始まらない場合は Enter キーで送る。
    // 停止ボタンが指標にならないときは応答要素の出現を待つしかなく、それは数秒遅れるため窓を長く取る。
    const startWindow = ignoreStop ? SLOW_START_MS : SEND_START_MS;
    const enterWindow = ignoreStop ? SLOW_START_MS : ENTER_START_MS;
    const clicked = await this.pollShort(SEND_BUTTON_MS, () => this.clickSend());
    if (clicked && (await this.pollShort(startWindow, () => this.sendStarted(baseline, ignoreStop)))) {
      return true;
    }
    this.throwIfAborted(); // 停止直後に Enter で送ってしまわない
    // ボタン待ちの間に始まっていたら Enter を押さない(二重送信防止)
    if (await this.sendStarted(baseline, ignoreStop)) return true;
    await this.focusInput();
    this.pressEnter();
    return this.pollShort(enterWindow, () => this.sendStarted(baseline, ignoreStop));
  }

  private async focusInput(): Promise<boolean> {
    const r = await this.js<boolean>(
      `(() => {
        const el = document.querySelector(${JSON.stringify(this.selectors.input)});
        if (!el) return false;
        el.focus();
        return true;
      })()`,
    );
    return r === true;
  }

  private async inputTextLength(): Promise<number> {
    const r = await this.js<number>(
      `(() => {
        const el = document.querySelector(${JSON.stringify(this.selectors.input)});
        if (!el) return 0;
        // textarea は value、contenteditable は innerText
        const v = typeof el.value === 'string' ? el.value : (el.innerText != null ? el.innerText : el.textContent);
        return (v || '').trim().length;
      })()`,
    );
    return r ?? 0;
  }

  private async clickSend(): Promise<boolean> {
    const r = await this.js<boolean>(
      `(() => {
        const el = document.querySelector(${JSON.stringify(this.selectors.sendButton)});
        if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
        el.click();
        return true;
      })()`,
    );
    return r === true;
  }

  // 送信が「実際に生成を開始した」ことの確認。
  // 注意: 入力欄が空になっただけ(emptied)を成功と見なすと、送信が取りこぼされて
  // 生成が始まらない場合でも成功と誤判定し、waitForCompletion が新応答を最大 timeout
  // まで待ってハングする(turn 7 の沈黙の原因、実測)。実際の生成指標である
  // 「停止ボタン出現」か「応答数が増えた」ことだけを成功条件にする。
  // ignoreStop: 送信前から停止ボタンが固着していて指標にならないとき true。
  private async sendStarted(baseline: ResponseBaseline, ignoreStop: boolean): Promise<boolean> {
    const snap = await this.probe(baseline);
    if (!snap) return false;
    return (snap.streaming && !ignoreStop) || this.isFresh(snap, baseline);
  }

  // 新しい応答要素が現れたか(ResponseBaseline の説明を参照)
  private isFresh(snap: ProbeResult, baseline: ResponseBaseline): boolean {
    if (snap.lastKey !== null) return !this.seenKeys.has(snap.lastKey);
    return snap.count > baseline.count;
  }

  // 送信前の状態を記録する。いま DOM にある応答要素の識別子は全て「見た」ことにする
  private async captureBaseline(): Promise<ResponseBaseline> {
    const snap = await this.probe({ count: 0 });
    if (!snap) return { count: 0 };
    for (const k of snap.keys) this.seenKeys.add(k);
    return { count: snap.count };
  }

  // 受理した(あるいは失敗として片付けた)応答の識別子を「見た」ことにし、次の基準を返す
  private acceptResponse(snap: ProbeResult): ResponseBaseline {
    for (const k of snap.keys) this.seenKeys.add(k);
    return { count: snap.count };
  }

  private async stopVisible(): Promise<boolean> {
    const r = await this.js<boolean>(`(() => ${this.stopVisibleExpr()})()`);
    return r === true;
  }

  // 停止ボタンが「表示されている」ことを判定する式。offsetParent は position:fixed の
  // 祖先配下で null になり見えているのに非表示扱いするため、getClientRects で判定する。
  private stopVisibleExpr(): string {
    return (
      `((el) => !!el && el.getClientRects().length > 0)` +
      `(document.querySelector(${JSON.stringify(this.selectors.stopButton)}))`
    );
  }

  private pressEnter(): void {
    const wc = this.view.webContents;
    wc.focus();
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    wc.sendInputEvent({ type: 'char', keyCode: 'Return' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  }

  // 応答完了待ち。1 tick = js() 1 往復で状態スナップショットを取る。
  // reply=null は「正規の応答が来ないまま終わった」ことを表し、呼び出し側(sendAndAwait)が
  // 再送する。timeoutMs まで黙って待たない。
  //  - stuckStop: 停止ボタンだけが出続けて応答が来なかった(ボタンの固着)
  //  - baseline: 次の試行で使う基準件数(エラー吹き出し等が応答要素として残った場合は進める)
  //  - why: 通知用の理由
  private async waitForCompletion(
    baseline: ResponseBaseline,
    ignoreStop: boolean,
  ): Promise<
    { reply: string } | { reply: null; stuckStop: boolean; baseline: ResponseBaseline; why: string }
  > {
    const { pollMs, stabilityMs, timeoutMs } = this.getDetection();
    const confirmPollMs = Math.max(CONFIRM_POLL_MIN_MS, Math.min(pollMs, CONFIRM_POLL_MS));
    const start = Date.now();
    let lastText = '';
    let lastChangedAt = start;
    let lastProbeOkAt = start; // 最後にページ状態を取得できた時刻
    let responseSeenAt = 0; // 応答要素が現れた時刻(空応答の早期検知用)
    let idleSince = 0; // 応答要素も生成指標も無い状態の起点(送信喪失の検知用)
    let stopOnlySince = 0; // 停止ボタンだけが出て応答要素が無い状態の起点(固着の検知用)
    let confirmations = 0; // 完了条件を連続で満たした回数

    // 本文の流れに追従するスクロールをページ側に仕込む(ページ内で自律的に動く)
    await this.ensureFollower();

    for (;;) {
      this.throwIfAborted();
      const snap = await this.probe(baseline);
      const now = Date.now();
      let confirming = false;
      if (snap) {
        lastProbeOkAt = now;
        if (!snap.follower) void this.ensureFollower(); // 遷移で剥がれたら入れ直す
        // 停止ボタンが固着しているときは「生成中」の証拠にならない
        const generating = snap.streaming && !ignoreStop;
        const fresh = this.isFresh(snap, baseline);
        // 応答本文に制限文言が含まれるだけの誤検知を避けるため、
        // 新しい応答が現れていないときのみ制限とみなす
        if (snap.limited && !fresh) {
          throw new ChatError('rate-limited', this.displayName);
        }
        if (!fresh) {
          // 応答要素がまだ無い。生成指標も無い状態が LOST_SEND_MS 続いたら送信が失われている
          // (クリック直後に停止ボタンが出てもリクエスト失敗で消える等)。
          // 停止ボタンだけが STOP_WITHOUT_RESPONSE_MS 出続けるならボタンの固着とみなす。
          if (generating) {
            idleSince = 0;
            if (stopOnlySince === 0) stopOnlySince = now;
            else if (now - stopOnlySince >= STOP_WITHOUT_RESPONSE_MS) {
              return { reply: null, stuckStop: true, baseline, why: '応答が現れません' };
            }
          } else {
            stopOnlySince = 0;
            if (idleSince === 0) idleSince = now;
            else if (now - idleSince >= LOST_SEND_MS) {
              return { reply: null, stuckStop: false, baseline, why: '応答が現れません' };
            }
          }
        } else {
          idleSince = 0;
          stopOnlySince = 0;
          if (responseSeenAt === 0) responseSeenAt = now;
          const changed = snap.lastText !== lastText;
          if (changed) {
            lastText = snap.lastText;
            lastChangedAt = now;
          }
          // 応答の代わりにエラー吹き出し(実測: ChatGPT「Something went wrong … Retry」)が
          // 応答要素として描画された。回答として中継せず、基準件数を進めて再送する。
          if (snap.failed && !generating) {
            return { reply: null, stuckStop: false, baseline: this.acceptResponse(snap), why: '応答がエラーでした' };
          }
          if (lastText.length === 0) {
            // 生成が終わった(停止ボタンが消えた)のに本文が空のまま stabilityMs 続いたら
            // 失敗した空応答とみなし、timeoutMs まで待たずに再送する。
            if (!generating && now - responseSeenAt >= stabilityMs) {
              return { reply: null, stuckStop: false, baseline: this.acceptResponse(snap), why: '応答が空でした' };
            }
          } else if (!snap.streaming) {
            // 完了の多重確認(実測: 停止ボタンは生成終了で確実に消える。テキスト安定はその後)。
            // 「停止ボタンなし・本文が前回から不変」を連続 COMPLETION_CONFIRMATIONS 回観測したら完了。
            // 本文が動いたり停止ボタンが戻ったりしたら数え直す。確認中は短い間隔でポーリングし、
            // stabilityMs をまるごと待たないのでターン間に無駄な間が生じない。
            confirmations = changed ? 0 : confirmations + 1;
            if (confirmations >= COMPLETION_CONFIRMATIONS) {
              this.acceptResponse(snap);
              return { reply: this.finalizeText(lastText) };
            }
            confirming = true;
          } else {
            // 停止ボタンが見えている(固着を含む)間は、本文が stabilityMs 変化しなければ完了とみなす。
            // 固着時でも生成中の短い間(ポーズ)で切らないよう、こちらは多重確認で短縮しない。
            confirmations = 0;
            if (now - lastChangedAt >= stabilityMs) {
              this.acceptResponse(snap);
              return { reply: this.finalizeText(lastText) };
            }
          }
        }
      } else if (now - lastProbeOkAt >= PROBE_FAILURE_MS) {
        throw new ChatError('selector', `${this.displayName} のページ状態を取得できません`);
      }
      if (now - start >= timeoutMs) {
        // 上限まで待っても閉じなかった(実測: マシンのスリープ復帰後にストリームが切れたまま残る)。
        // 本文が得られていればエラーにせず、それを応答として採用して議論を止めない。
        if (snap && this.isFresh(snap, baseline) && lastText.length > 0) {
          this.notify(`${this.displayName} の応答が閉じないため、得られた本文で続行します`);
          this.acceptResponse(snap);
          return { reply: this.finalizeText(lastText) };
        }
        throw new ChatError('timeout', this.displayName);
      }
      await sleep(confirming ? confirmPollMs : pollMs);
    }
  }

  // ChatGPT はストリーミング中に見出し等を一時的に二重描画し、数秒後に整理する。
  // その「二重かつ一見安定」な状態を取得してしまうことがあるため、隣接する
  // 同一の非空行を 1 行に畳んで正規化する(散文でこの重複はまず起きない)。
  private finalizeText(text: string): string {
    const lines = text.split('\n');
    const out: string[] = [];
    for (const line of lines) {
      if (out.length > 0 && out[out.length - 1] === line && line.trim() !== '') continue;
      out.push(line);
    }
    return out.join('\n');
  }

  // 本文の流れに追従するスクロールをページ側に常駐させる(冪等)。
  // main 側のポーリング周期で位置を送るのではなく、ページ内の MutationObserver /
  // ResizeObserver で「本文が伸びた・描き直された」瞬間に requestAnimationFrame で
  // 位置を合わせる。目標は「最後の回答の下端を、下端に浮く入力欄(コンポーザー)の少し上」。
  // 利用者が上へスクロールして読み返している間は追従せず(貼り付き解除)、最下部付近へ
  // 戻る/新しい応答が始まると再び追従する。状態は window.__cvgFollow(遷移で消える)。
  private async ensureFollower(): Promise<void> {
    const s = this.selectors;
    await this.js(
      `(() => {
        if (window.__cvgFollow) return true;
        const MSG = ${JSON.stringify(s.assistantMessages)};
        const INPUT = ${JSON.stringify(s.input)};
        const st = { stick: true, lastTop: -1, count: 0, raf: 0, cont: null, last: null, ro: null,
          intentAt: -Infinity, down: false, realigns: [] };
        window.__cvgFollow = st;
        // 利用者のスクロール意思(ホイール上・スクロールキー・タッチ・ドラッグ)の最終時刻と押下状態。
        // サイト自身もスクロール位置を動かす(ChatGPT は応答確定時や新しい発言の表示時に上へ戻す)ため、
        // 位置の変化だけで「利用者が上へ戻した」と判断すると追従が外れてしまう。
        // 操作ロック中は pointerdown 等が chat-preload.js で遮断されるので、preload が <html> の
        // data-cvg-intent / data-cvg-down に書いた値も見る(ワールドをまたぐ唯一の経路)。
        const html = document.documentElement;
        const markIntent = () => { st.intentAt = performance.now(); };
        const userIntent = () =>
          st.down || html.dataset.cvgDown === '1' ||
          performance.now() - st.intentAt < 1500 ||
          Date.now() - Number(html.dataset.cvgIntent || 0) < 1500;
        // スクロール容器: 応答要素の祖先で overflow-y が auto/scroll のもの。無ければページ全体
        // (document.scrollingElement。ChatGPT の新変種 DOM はスレッドがページごとスクロールする)。
        const docEl = () => document.scrollingElement || document.documentElement;
        const isDoc = (c) => c === document.scrollingElement || c === document.documentElement;
        const findContainer = (el) => {
          for (let n = el; n; n = n.parentElement) {
            // html が overflow:visible のとき body の overflow はビューポートへ伝播する(body 自体は動かない)
            if (n === document.body && getComputedStyle(document.documentElement).overflowY === 'visible') continue;
            if (n.scrollHeight > n.clientHeight + 4) {
              const oy = getComputedStyle(n).overflowY;
              if (oy === 'auto' || oy === 'scroll') return n;
            }
          }
          const se = docEl();
          return se.scrollHeight > se.clientHeight + 4 ? se : null;
        };
        // ページ全体が容器のときは矩形はビューポート、イベントは window で受ける
        const rectOf = (c) => (isDoc(c) ? { top: 0, bottom: window.innerHeight } : c.getBoundingClientRect());
        const eventTarget = (c) => (isDoc(c) ? window : c);
        const nearBottom = (c) => c.scrollHeight - c.clientHeight - c.scrollTop <= 120;
        // こちらが最後に送った位置(lastTop)より明確に上へ動いたとき、利用者の意思が直前にあれば解除、
        // 無ければサイト由来の移動とみなして次フレームで整列し直す。最下部付近へ戻ったら再び追従。
        const onScroll = () => {
          const c = st.cont;
          if (!c) return;
          if (st.lastTop >= 0 && c.scrollTop < st.lastTop - 40) {
            if (userIntent()) {
              st.stick = false;
            } else if (st.stick) {
              // サイト由来の移動。ただし毎フレーム戻してくる UI と永久に押し合わないよう、短時間に何度も続くなら諦める
              const now = performance.now();
              st.realigns = st.realigns.filter((t) => now - t < 500);
              st.realigns.push(now);
              if (st.realigns.length > 3) st.stick = false;
              else schedule();
            }
          } else if (!st.stick && nearBottom(c)) {
            st.stick = true;
          }
        };
        const onWheel = (e) => {
          if (e.deltaY < 0) { markIntent(); st.stick = false; }
          else if (e.deltaY > 0 && st.cont && nearBottom(st.cont)) st.stick = true;
        };
        const onKey = (e) => {
          // 入力欄にフォーカスがあるときの矢印キーはキャレット移動でスクロールしないので無視
          const t = e.target;
          if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
          if (e.key === 'PageUp' || e.key === 'ArrowUp' || e.key === 'Home' || (e.key === ' ' && e.shiftKey)) {
            markIntent(); st.stick = false;
          } else if (e.key === 'End') {
            st.stick = true;
          }
        };
        window.addEventListener('keydown', onKey, { passive: true });
        window.addEventListener('pointerdown', () => { markIntent(); st.down = true; }, { passive: true, capture: true });
        window.addEventListener('pointerup', () => { st.down = false; }, { passive: true, capture: true });
        window.addEventListener('pointercancel', () => { st.down = false; }, { passive: true, capture: true });
        window.addEventListener('touchmove', markIntent, { passive: true, capture: true });
        const schedule = () => { if (!st.raf) st.raf = requestAnimationFrame(align); };
        const align = () => {
          st.raf = 0;
          const msgs = document.querySelectorAll(MSG);
          const last = msgs[msgs.length - 1];
          if (!last) return;
          if (msgs.length > st.count) { st.stick = true; st.count = msgs.length; } // 新しい応答
          if (last !== st.last) {
            st.last = last;
            if (st.ro) st.ro.disconnect();
            st.ro = new ResizeObserver(schedule); // 画像・コードブロック等の遅延レイアウト
            st.ro.observe(last);
          }
          const cont = findContainer(last);
          if (!cont) return;
          if (cont !== st.cont) {
            if (st.cont) {
              eventTarget(st.cont).removeEventListener('scroll', onScroll);
              eventTarget(st.cont).removeEventListener('wheel', onWheel);
            }
            st.cont = cont;
            st.lastTop = -1;
            eventTarget(cont).addEventListener('scroll', onScroll, { passive: true });
            eventTarget(cont).addEventListener('wheel', onWheel, { passive: true });
          }
          if (!st.stick) return;
          const contRect = rectOf(cont);
          const lastRect = last.getBoundingClientRect();
          const inputEl = document.querySelector(INPUT);
          const inputTop = inputEl ? inputEl.getBoundingClientRect().top : contRect.bottom;
          const bottomLimit = Math.min(contRect.bottom, inputTop) - 12; // 余白
          const maxTop = Math.max(0, cont.scrollHeight - cont.clientHeight);
          let desired = cont.scrollTop + (lastRect.bottom - bottomLimit);
          desired = Math.min(maxTop, Math.max(0, desired));
          if (Math.abs(cont.scrollTop - desired) >= 1) cont.scrollTop = desired;
          st.lastTop = cont.scrollTop;
        };
        new MutationObserver(schedule).observe(document.documentElement, {
          childList: true, subtree: true, characterData: true,
        });
        window.addEventListener('resize', schedule);
        schedule();
        return true;
      })()`,
    );
  }

  // 制限文言の判定は新しい応答が無いときにしか使わないので、そのときだけ body 全文を読む
  // (高頻度ポーリングで毎回 body.innerText を取らない)。ページ側では識別子の既知/未知を
  // 判定できないため、「件数が増えていない」を暫定条件にする(多少余計に読むだけで害はない)。
  // 注意: 以下のテンプレートリテラルはページ側で実行される JS。中に書いたコメントもページ側に渡るので、
  // エスケープ(\\n など)や改行を含む注釈は書かない(実改行に展開されて構文エラーになる)。
  // 本文要素(messageContent)を指定しているサイトでは、本文要素が無い(未描画)間は空として扱う。
  // 要素全体へ退避すると読み上げ用ラベル等が本文になり、初トークン前に「完了」と誤認しうる。
  private async probe(baseline: ResponseBaseline): Promise<ProbeResult | null> {
    const s = this.selectors;
    return this.js<ProbeResult>(
      `(() => {
        const msgs = document.querySelectorAll(${JSON.stringify(s.assistantMessages)});
        const count = msgs.length;
        const keyOf = (el) => el.getAttribute('data-message-id') || el.id || null;
        const keys = [];
        for (const m of msgs) { const k = keyOf(m); if (k) keys.push(k); }
        const last = count > 0 ? msgs[count - 1] : null;
        const lastKey = last ? keyOf(last) : null;
        const contentSel = ${JSON.stringify(s.messageContent ?? '')};
        const textOf = (el) => {
          if (!contentSel) return (el.innerText || '').trim();
          return [...el.querySelectorAll(contentSel)].map((c) => (c.innerText || '').trim()).filter(Boolean).join('\\n\\n');
        };
        const lastText = last ? textOf(last) : '';
        const lastWhole = last ? ((last.innerText || '').trim()) : '';
        const streaming = ${this.stopVisibleExpr()};
        let limited = false;
        if (count <= ${baseline.count}) {
          const tail = ((document.body && document.body.innerText) || '').slice(-2000);
          limited = ${JSON.stringify(s.rateLimitPatterns)}.some((p) => tail.includes(p));
        }
        const failed = lastWhole.length > 0 && lastWhole.length <= ${ERROR_TEXT_MAX} &&
          ${JSON.stringify(s.errorPatterns)}.some((p) => lastWhole.includes(p));
        return { count: count, lastKey: lastKey, keys: keys, lastText: lastText, streaming: streaming,
          limited: limited, failed: failed, follower: !!window.__cvgFollow };
      })()`,
    );
  }

  private async pollShort(totalMs: number, tick: () => Promise<boolean>): Promise<boolean> {
    const deadline = Date.now() + totalMs;
    for (;;) {
      this.throwIfAborted();
      if (await tick()) return true;
      if (Date.now() >= deadline) return false;
      await sleep(SHORT_POLL_MS);
    }
  }

  private throwIfAborted(): void {
    if (this.abortRequested) throw new ChatError('stopped');
  }

  private notify(message: string): void {
    try {
      if (this.notice) this.notice(message);
    } catch {
      // 通知先の失敗で議論を止めない
    }
  }
}
