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

  private async askInner(text: string): Promise<string> {
    const s = this.selectors;

    if (!(await this.isLoggedIn())) {
      throw new ChatError('not-logged-in', this.displayName);
    }

    const baseline =
      (await this.js<number>(
        `document.querySelectorAll(${JSON.stringify(s.assistantMessages)}).length`,
      )) ?? 0;

    if (!(await this.focusInput())) {
      throw new ChatError('selector', s.input);
    }

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

  private async sendStarted(baseline: number): Promise<boolean> {
    const s = this.selectors;
    const r = await this.js<boolean>(
      `(() => {
        const input = document.querySelector(${JSON.stringify(s.input)});
        const emptied = !!input && ((input.innerText || '').trim().length === 0);
        const stop = !!document.querySelector(${JSON.stringify(s.stopButton)});
        const count = document.querySelectorAll(${JSON.stringify(s.assistantMessages)}).length;
        return emptied || stop || count > ${baseline};
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
        if (snap.lastText !== lastText) {
          lastText = snap.lastText;
          lastChangedAt = now;
        }
        if (
          snap.count > baseline &&
          !snap.streaming &&
          lastText.length > 0 &&
          now - lastChangedAt >= stabilityMs
        ) {
          return lastText;
        }
      }
      if (now - start >= timeoutMs) throw new ChatError('timeout', this.displayName);
      await sleep(pollMs);
    }
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
