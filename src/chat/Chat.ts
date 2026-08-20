// サイト非依存のチャット自動操作アルゴリズム。
// 制約: main プロセスには DOM 型が無い。ページ操作は全て自己完結 IIFE 文字列を
// executeJavaScript に渡す形で行い、セレクタや本文は JSON.stringify で埋め込む。

import { WebContentsView } from 'electron';
import { Speaker, SPEAKER_LABELS, SettingsData } from '../shared/types';
import { SiteSelectors } from './selectors';

export type ChatErrorCode =
  | 'not-logged-in'
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
const SHORT_POLL_MS = 250;

// 停止ボタンが消えたあと、完了と確定するまでの短い確認時間
const POST_STREAM_CONFIRM_MS = 1000;

interface ProbeResult {
  count: number;
  lastText: string;
  streaming: boolean;
  limited: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export abstract class Chat {
  private busy = false;
  private abortRequested = false;
  private readonly origin: string;
  // ログイン後の操作ロック(スクロール以外の実ユーザ操作を遮断)。
  // 望ましいロック状態。入力フェーズ中は一時的に window.__cvgLock を外す。
  private lockDesired = false;
  private inputPhase = false;

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

  // 認証判定はセッション Cookie の有無で行う(DOM と違い遷移でブレない)。
  // ロック・状態表示(LED/バナー/開始ボタン)の「ログイン済み/未ログイン」はこれを使う。
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

  // DOM ベースの準備判定。送信直前に「入力欄が実在するか」を見るために使う。
  async isLoggedIn(): Promise<boolean> {
    const url = this.view.webContents.getURL();
    // startsWith だと類似ドメイン(例: chatgpt.com.evil.io)をすり抜けるため origin 厳密比較
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      return false;
    }
    if (origin !== this.origin) return false;
    const s = this.selectors;
    const ok = await this.js<boolean>(
      `(() => !!document.querySelector(${JSON.stringify(s.loggedInProbe)}) && !document.querySelector(${JSON.stringify(s.loggedOutProbe)}))()`,
    );
    return ok === true;
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
    void this.js(
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
  async newChat(): Promise<void> {
    const wc = this.view.webContents;
    // 進行中のリダイレクトで reject し得るため握りつぶす
    await wc.loadURL(this.selectors.url).catch(() => {});
    const deadline = Date.now() + 30000;
    for (;;) {
      if (await this.isLoggedIn()) {
        const ready = await this.js<boolean>(
          `!!document.querySelector(${JSON.stringify(this.selectors.input)})`,
        );
        if (ready === true) {
          // 遷移で剥がれたブロッカ/バッジを再注入し、望ましいロック状態を反映
          await this.setPageLock(this.lockDesired);
          return;
        }
      }
      if (Date.now() >= deadline) {
        throw new ChatError('selector', `新規チャットの準備ができません: ${this.displayName}`);
      }
      await sleep(500);
    }
  }

  // ログイン後の操作ロックの ON/OFF。スクロール(ホイール/スクロールキー)以外の
  // 実ユーザ操作を遮断し、議論中に状態を壊されたり入力を改変されたりするのを防ぐ。
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

    if (!(await this.isLoggedIn())) {
      throw new ChatError('not-logged-in', this.displayName);
    }

    const baseline =
      (await this.js<number>(
        `document.querySelectorAll(${JSON.stringify(s.assistantMessages)}).length`,
      )) ?? 0;

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

  private async sendAndAwait(text: string, baseline: number): Promise<string> {
    const s = this.selectors;

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

    if (!(await this.pollShort(5000, () => this.clickSend()))) {
      throw new ChatError('selector', s.sendButton);
    }

    // 送信が実際に始まったことを確認。だめなら Enter キーでフォールバック
    let started = await this.pollShort(10000, () => this.sendStarted(baseline));
    if (!started) {
      await this.focusInput();
      this.pressEnter();
      started = await this.pollShort(5000, () => this.sendStarted(baseline));
      if (!started) {
        throw new ChatError('send-failed', 'send did not start');
      }
    }

    return this.waitForCompletion(baseline);
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
        return ((el.innerText != null ? el.innerText : el.textContent) || '').trim().length;
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
  private async sendStarted(baseline: number): Promise<boolean> {
    const s = this.selectors;
    const r = await this.js<boolean>(
      `(() => {
        const stop = !!document.querySelector(${JSON.stringify(s.stopButton)});
        const count = document.querySelectorAll(${JSON.stringify(s.assistantMessages)}).length;
        return stop || count > ${baseline};
      })()`,
    );
    return r === true;
  }

  private pressEnter(): void {
    const wc = this.view.webContents;
    wc.focus();
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    wc.sendInputEvent({ type: 'char', keyCode: 'Return' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  }

  // 応答完了待ち。1 tick = js() 1 往復で状態スナップショットを取る
  private async waitForCompletion(baseline: number): Promise<string> {
    const { pollMs, stabilityMs, timeoutMs } = this.getDetection();
    const start = Date.now();
    let lastText = '';
    let lastChangedAt = Date.now();
    let responseSeenAt = 0; // 応答要素が現れた時刻(空応答の早期検知用)

    for (;;) {
      this.throwIfAborted();
      const snap = await this.probe();
      const now = Date.now();
      if (snap) {
        // 応答本文に制限文言が含まれるだけの誤検知を避けるため、
        // 新しい応答が現れていない(count <= baseline)ときのみ制限とみなす
        if (snap.limited && snap.count <= baseline) {
          throw new ChatError('rate-limited', this.displayName);
        }
        if (snap.count > baseline && responseSeenAt === 0) {
          responseSeenAt = now;
        }
        // 生成が終わった(停止ボタンが消えた)のに本文が空のまま stabilityMs 続いたら
        // 失敗した空応答とみなし、5 分待たずに早期にエラーにする。
        if (
          snap.count > baseline &&
          !snap.streaming &&
          lastText.length === 0 &&
          responseSeenAt > 0 &&
          now - responseSeenAt >= stabilityMs
        ) {
          throw new ChatError('send-failed', `${this.displayName} が空の応答を返しました`);
        }
        if (snap.lastText !== lastText) {
          lastText = snap.lastText;
          lastChangedAt = now;
        }
        // 完了検知(実測: 停止ボタンは生成終了で確実に消える。テキスト安定はその後)。
        // 通常: 停止ボタンが消えたら短い確認(POST_STREAM_CONFIRM_MS)だけで即完了。
        //       stabilityMs をまるごと待たないので、ターン間の無駄な間が生じない。
        // 固着時: 停止ボタンが残ったままでも、本文が stabilityMs 変化しなければ完了とみなす。
        if (snap.count > baseline && lastText.length > 0) {
          const stableFor = now - lastChangedAt;
          if (!snap.streaming && stableFor >= POST_STREAM_CONFIRM_MS) {
            return this.finalizeText(lastText);
          }
          if (stableFor >= stabilityMs) {
            return this.finalizeText(lastText);
          }
        }
      }
      // 生成中はペインを常に最下部へスクロールして最新の出力を追う
      this.scrollToBottom();
      if (now - start >= timeoutMs) throw new ChatError('timeout', this.displayName);
      await sleep(pollMs);
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

  // 最後の応答要素から祖先を辿って「実際に縦スクロールしているコンテナ」を見つけ、
  // 最下部へ追従する。ただしユーザが自分で上へスクロールして履歴を読んでいるときは
  // 強制移動しない(最下部付近にいるときだけ追従)。新しい応答が現れた瞬間だけは
  // 一度だけ最下部へジャンプする。
  private scrollToBottom(): void {
    void this.js(
      `(() => {
        const findContainer = (el) => {
          for (let n = el; n; n = n.parentElement) {
            if (n.scrollHeight > n.clientHeight + 4) {
              const oy = getComputedStyle(n).overflowY;
              if (oy === 'auto' || oy === 'scroll') return n;
            }
          }
          return null;
        };
        const msgs = document.querySelectorAll(${JSON.stringify(this.selectors.assistantMessages)});
        const last = msgs[msgs.length - 1];
        if (!last) return true;
        const cont = findContainer(last);
        if (!cont) return true;
        // 「貼り付き(stick)」方式。距離スナップショットだと本文が 1 秒に閾値以上
        // 伸びたとき追従をやめてしまうため、フラグで管理する。
        //  - 前回こちらが送った位置(lastTop)より明確に上へ動いていたら=ユーザが上へ
        //    スクロールした → 貼り付き解除
        //  - 最下部付近に戻ったら再び貼り付き
        //  - 新しい応答が出たら貼り付きに戻す
        // 貼り付き中は現在距離に関係なく毎回最下部へ送る(縦に伸び続けても追従)。
        const st = window.__cvgScroll || (window.__cvgScroll = { count: 0, stick: true, lastTop: -1 });
        if (st.lastTop >= 0 && cont.scrollTop < st.lastTop - 40) {
          st.stick = false;
        }
        const dist = cont.scrollHeight - cont.scrollTop - cont.clientHeight;
        if (dist <= 80) st.stick = true;
        if (msgs.length > st.count) { st.stick = true; st.count = msgs.length; }
        if (st.stick) cont.scrollTop = cont.scrollHeight;
        st.lastTop = cont.scrollTop;
        return true;
      })()`,
    );
  }

  private async probe(): Promise<ProbeResult | null> {
    const s = this.selectors;
    return this.js<ProbeResult>(
      `(() => {
        const msgs = document.querySelectorAll(${JSON.stringify(s.assistantMessages)});
        const count = msgs.length;
        const last = count > 0 ? msgs[count - 1] : null;
        const lastText = last ? ((last.innerText || '').trim()) : '';
        const stop = document.querySelector(${JSON.stringify(s.stopButton)});
        const streaming = !!stop && stop.offsetParent !== null;
        const tail = ((document.body && document.body.innerText) || '').slice(-2000);
        const limited = ${JSON.stringify(s.rateLimitPatterns)}.some((p) => tail.includes(p));
        return { count: count, lastText: lastText, streaming: streaming, limited: limited };
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
}
