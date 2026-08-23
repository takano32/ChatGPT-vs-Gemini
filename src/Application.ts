// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Composition Root。各コンポーネントの組み立てと IPC の仲介だけを行い、ロジックは持たない。

import { app, clipboard, dialog, ipcMain } from 'electron';
import * as path from 'node:path';
import { Manager } from './manager/Manager';
import { Repository } from './conversation/Repository';
import { Runner } from './conversation/Runner';
import { transcriptToMarkdown } from './conversation/markdown';
import { Chat } from './chat/Chat';
import { ChatGPT } from './chat/ChatGPT';
import { Gemini } from './chat/Gemini';
import { CHATGPT_SELECTORS, GEMINI_SELECTORS } from './chat/selectors';
import { IPC } from './shared/ipc';
import type {
  ChatStatus,
  ChatStatusMap,
  LogEntry,
  MessageRecord,
  RunnerStatus,
  SettingsData,
  TranscriptPayload,
} from './shared/types';

const CHAT_STATUS_POLL_MS = 5000;
const CHAT_STATUS_FAST_POLL_MS = 1000;
// CI の認証なしスモークテスト用。設定時は初期化直後に自己診断して終了する(scripts/smoke.mjs 参照)
const SMOKE_TEST_ENV = 'CVG_SMOKE_TEST';
const SMOKE_TIMEOUT_MS = 60000;

export class Application {
  private manager!: Manager;
  private repository!: Repository;
  private runner!: Runner;
  private chatGPT!: ChatGPT;
  private gemini!: Gemini;
  private statusTimer: NodeJS.Timeout | null = null;
  private transcriptVisible = false;

  start(): void {
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }
    app.on('window-all-closed', () => app.quit());
    app.on('will-quit', () => this.dispose());
    void app
      .whenReady()
      .then(() => this.init())
      .catch((err: unknown) => {
        dialog.showErrorBox(
          '起動エラー',
          err instanceof Error ? (err.stack ?? err.message) : String(err),
        );
        app.quit();
      });
  }

  private init(): void {
    const userData = app.getPath('userData');

    this.manager = new Manager(userData);
    this.manager.init({
      admin: {
        file: path.join(app.getAppPath(), 'dist/renderer/index.html'),
        preload: path.join(app.getAppPath(), 'dist/preload.js'),
      },
      chatgpt: { url: CHATGPT_SELECTORS.url, partition: CHATGPT_SELECTORS.partition },
      gemini: { url: GEMINI_SELECTORS.url, partition: GEMINI_SELECTORS.partition },
      transcript: {
        file: path.join(app.getAppPath(), 'dist/renderer/transcript.html'),
        preload: path.join(app.getAppPath(), 'dist/preload.js'),
      },
      chatPreload: path.join(app.getAppPath(), 'dist/chat-preload.js'),
    });

    this.repository = new Repository(path.join(userData, 'data.db'));
    this.repository.init();

    const detection = (): SettingsData['detection'] => this.manager.settings.get().detection;
    this.chatGPT = new ChatGPT(this.manager.layout.view('chatgpt'), detection);
    this.gemini = new Gemini(this.manager.layout.view('gemini'), detection);

    this.runner = new Runner({
      chats: { chatgpt: this.chatGPT, gemini: this.gemini },
      repository: this.repository,
      settings: this.manager.settings,
    });

    this.registerIpc();
    this.forwardEvents();
    this.startChatStatusPolling();

    if (process.env[SMOKE_TEST_ENV]) void this.runSmokeTest();
  }

  // ログイン不要で確認できる範囲だけを見る: asar からの読込、ネイティブモジュール
  // (better-sqlite3)と FTS5 trigram、管理ペインの描画。結果を 1 行で stdout に出して終了する。
  private async runSmokeTest(): Promise<void> {
    const fail = (reason: string): void => {
      console.error(`CVG_SMOKE_FAIL ${reason}`);
      app.exit(1);
    };
    const timer = setTimeout(() => fail('timeout'), SMOKE_TIMEOUT_MS);
    try {
      const admin = this.manager.layout.view('admin').webContents;
      if (admin.isLoading()) {
        await new Promise<void>((resolve) => admin.once('did-finish-load', () => resolve()));
      }
      const title = (await admin.executeJavaScript('document.title')) as string;
      const searchHits = this.repository.search('スモークテスト').length; // 3 文字以上 → FTS5 経路
      const conversations = this.repository.listConversations().length;
      const result = {
        title,
        userData: app.getPath('userData'),
        conversations,
        searchHits,
        electron: process.versions.electron,
        platform: process.platform,
        arch: process.arch,
      };
      clearTimeout(timer);
      console.log(`CVG_SMOKE_OK ${JSON.stringify(result)}`);
      app.exit(0);
    } catch (err) {
      clearTimeout(timer);
      fail(err instanceof Error ? err.message : String(err));
    }
  }

  private registerIpc(): void {
    ipcMain.handle(IPC.runnerStart, (_e, topic: string, maxTurns?: number, firstSpeaker?: unknown) => {
      // 議論全体を await すると invoke が完走まで返らないため fire-and-forget。
      // エラーは Runner が status/log イベントで通知する。
      const override = typeof maxTurns === 'number' ? maxTurns : undefined;
      const first = firstSpeaker === 'chatgpt' || firstSpeaker === 'gemini' ? firstSpeaker : undefined;
      void this.runner.start(String(topic), override, first).catch(() => {});
    });
    ipcMain.handle(IPC.runnerStop, () => this.runner.stop());
    ipcMain.handle(IPC.runnerPause, () => this.runner.pause());
    ipcMain.handle(IPC.runnerResume, () => this.runner.resume());

    ipcMain.handle(IPC.settingsGet, () => this.manager.settings.get());
    ipcMain.handle(IPC.settingsSet, (_e, settings: SettingsData) =>
      this.manager.settings.set(settings)
    );

    ipcMain.handle(IPC.search, (_e, query: string) => this.repository.search(String(query)));
    ipcMain.handle(IPC.listConversations, () => this.repository.listConversations());
    ipcMain.handle(IPC.getMessages, (_e, conversationId: number) =>
      this.repository.getMessages(Number(conversationId))
    );
    ipcMain.handle(IPC.chatStatus, () => this.collectChatStatus());
    ipcMain.handle(IPC.transcriptToggle, () => this.setTranscriptVisible(!this.transcriptVisible));
    ipcMain.handle(IPC.transcriptShowConversation, (_e, conversationId: number) => {
      this.renderTranscript(Number(conversationId));
      this.setTranscriptVisible(true);
    });
    ipcMain.handle(IPC.transcriptCopyMarkdown, (_e, conversationId: number) =>
      this.copyTranscriptMarkdown(Number(conversationId))
    );
  }

  // 経過を gist 形式 Markdown にしてクリップボードへ。派生データなので DB には保存しない。
  private copyTranscriptMarkdown(conversationId: number): boolean {
    try {
      const conv = this.repository.listConversations().find((c) => c.id === conversationId);
      const messages = this.repository.getMessages(conversationId);
      if (messages.length === 0) return false;
      const maxTurns = conv?.maxTurns ?? Math.max(messages.length, 1); // 旧データは n/n
      // タイトルが空なら関数側で「議論」になる(UI は空テーマで開始できないので通常は到達しない)
      clipboard.writeText(transcriptToMarkdown(conv ? conv.title : '', messages, maxTurns));
      return true;
    } catch {
      return false;
    }
  }

  private forwardEvents(): void {
    this.runner.on('status', (s: RunnerStatus) => {
      this.sendToAdmin(IPC.evRunnerStatus, s);
      // 議論中だけチャットペインの操作をロックする(待機中はログインや手動チャットができるように)
      this.applyInteractionLock(s.state);
      // 議論開始でライブ表示に戻し、完了/停止/エラーで経過を前面に出す
      if (s.state === 'running') {
        this.setTranscriptVisible(false);
      } else if (s.state === 'done' || s.state === 'stopped' || s.state === 'error') {
        if (s.conversationId !== null) this.renderTranscript(s.conversationId);
        this.setTranscriptVisible(true);
      }
    });
    this.runner.on('message', (m: MessageRecord) => {
      this.sendToAdmin(IPC.evMessage, m);
      // 経過ビューを毎メッセージ更新(表示・非表示に関わらず最新を保持)
      this.renderTranscript(m.conversationId);
    });
    this.runner.on('log', (l: LogEntry) => this.sendToAdmin(IPC.evLog, l));
    // チャットペインの自動復旧(読込失敗・異常終了・ハングの再読込、証明書エラー)の通知。
    // 議論の進行とは別の話なので Runner の log は通さず、そのまま管理ペインのログに WARN で出す
    // 管理ペインが購読を始める前(起動直後のオフライン等)に来た通知は捨てずに溜め、読込完了後に流す
    const admin = this.manager.layout.view('admin').webContents;
    const pending: LogEntry[] = [];
    admin.once('did-finish-load', () => {
      for (const e of pending) this.sendToAdmin(IPC.evLog, e);
      pending.length = 0;
    });
    this.manager.layout.onPaneNotice = (_pane, message) => {
      const entry: LogEntry = { level: 'warn', message, ts: new Date().toISOString() };
      if (admin.isLoading()) pending.push(entry);
      else this.sendToAdmin(IPC.evLog, entry);
    };
  }

  private renderTranscript(conversationId: number): void {
    try {
      const conv = this.repository
        .listConversations()
        .find((c) => c.id === conversationId);
      const messages = this.repository.getMessages(conversationId);
      const payload: TranscriptPayload = {
        conversationId,
        title: conv ? conv.title : '',
        status: conv ? conv.status : null,
        // その会話で使った上限。列追加前の会話は発言数を上限として表示する
        maxTurns: conv?.maxTurns ?? Math.max(messages.length, 1),
        messages,
      };
      this.manager.layout.view('transcript').webContents.send(IPC.evTranscript, payload);
    } catch {
      // ウィンドウ破棄後等は無視
    }
  }

  private setTranscriptVisible(show: boolean): void {
    this.transcriptVisible = show;
    this.manager.layout.setTranscriptVisible(show);
    this.sendToAdmin(IPC.evTranscriptVisible, show);
  }

  private sendToAdmin(channel: string, payload: unknown): void {
    try {
      this.manager.layout.view('admin').webContents.send(channel, payload);
    } catch {
      // ウィンドウ破棄後のイベントは捨てる
    }
  }

  private applyInteractionLock(state: RunnerStatus['state']): void {
    const locked = state === 'running' || state === 'paused';
    void this.chatGPT.setInteractionLock(locked);
    void this.gemini.setInteractionLock(locked);
  }

  // 起動直後は開始ボタンを早く有効にしたいので即時に 1 回、両方が送信できる状態になるまでは
  // 短い間隔で、その後は通常間隔で状態を取る
  private startChatStatusPolling(): void {
    const tick = async (): Promise<void> => {
      const status = await this.collectChatStatus();
      this.sendToAdmin(IPC.evChatStatus, status);
      const ready = status.chatgpt.ready && status.gemini.ready;
      this.statusTimer = setTimeout(() => void tick(), ready ? CHAT_STATUS_POLL_MS : CHAT_STATUS_FAST_POLL_MS);
    };
    void tick();
  }

  private async collectChatStatus(): Promise<ChatStatusMap> {
    // ready(入力欄がある = 送信できる)が開始条件。ログインは任意で、Cookie の有無は表示にだけ使う。
    const probe = async (chat: Chat): Promise<ChatStatus> => {
      try {
        // 読込中のページへの executeJavaScript は読込完了まで返らないので、読込中は DOM 判定を飛ばす
        const loading = chat.isPageLoading();
        const [ready, loggedIn, rateLimited] = await Promise.all([
          loading ? Promise.resolve(false) : chat.isReady(),
          chat.isAuthenticated(),
          loading ? Promise.resolve(false) : chat.isRateLimited(),
        ]);
        return { loading, ready, loggedIn, rateLimited };
      } catch {
        return { loading: false, ready: false, loggedIn: false, rateLimited: false };
      }
    };
    const [chatgpt, gemini] = await Promise.all([probe(this.chatGPT), probe(this.gemini)]);
    // 遷移や再読込でページ側のロック状態が剥がれることがあるので、現在の議論状態を定期的に再適用する
    this.applyInteractionLock(this.runner.status.state);
    // ゲスト UI の片付け(勧誘要素を隠す)。遷移で消えるので ready のたびに入れ直す(入っていれば何もしない)
    if (chatgpt.ready) void this.chatGPT.ensureTidy();
    if (gemini.ready) void this.gemini.ensureTidy();
    return { chatgpt, gemini };
  }

  private dispose(): void {
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
    this.runner?.stop();
    this.repository?.close();
  }
}
