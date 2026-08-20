// Composition Root。各コンポーネントの組み立てと IPC の仲介だけを行い、ロジックは持たない。

import { app, clipboard, dialog, ipcMain } from 'electron';
import * as path from 'node:path';
import { Manager } from './manager/Manager';
import { Repository } from './conversation/Repository';
import { Runner } from './conversation/Runner';
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
  }

  private registerIpc(): void {
    ipcMain.handle(IPC.runnerStart, (_e, topic: string, maxTurns?: number) => {
      // 議論全体を await すると invoke が完走まで返らないため fire-and-forget。
      // エラーは Runner が status/log イベントで通知する。
      const override = typeof maxTurns === 'number' ? maxTurns : undefined;
      void this.runner.start(String(topic), override).catch(() => {});
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
      const maxTurns = this.manager.settings.get().debate.maxTurns;
      const emoji: Record<string, string> = { chatgpt: '🟢', gemini: '🔵' };
      const label: Record<string, string> = { chatgpt: 'ChatGPT', gemini: 'Gemini' };
      const parts: string[] = [];
      parts.push(`# ${conv ? conv.title : '議論'}`);
      parts.push('');
      messages.forEach((m, i) => {
        parts.push(`${emoji[m.speaker]} **${label[m.speaker]}** (${i + 1}/${maxTurns})`);
        parts.push('');
        for (const line of m.content.split('\n')) parts.push(`> ${line}`);
        parts.push('');
        parts.push('* * *');
        parts.push('');
      });
      clipboard.writeText(parts.join('\n'));
      return true;
    } catch {
      return false;
    }
  }

  private forwardEvents(): void {
    this.runner.on('status', (s: RunnerStatus) => {
      this.sendToAdmin(IPC.evRunnerStatus, s);
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
        maxTurns: this.manager.settings.get().debate.maxTurns,
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

  private startChatStatusPolling(): void {
    this.statusTimer = setInterval(() => {
      void this.collectChatStatus().then((status) => this.sendToAdmin(IPC.evChatStatus, status));
    }, CHAT_STATUS_POLL_MS);
  }

  private async collectChatStatus(): Promise<ChatStatusMap> {
    // ログイン判定はセッション Cookie(認証状態)で行う。DOM 判定は遷移中に
    // 一瞬ブレてロックのちらつき等を招くため使わない。
    const probe = async (chat: Chat): Promise<ChatStatus> => {
      try {
        const [loggedIn, rateLimited] = await Promise.all([
          chat.isAuthenticated(),
          chat.isRateLimited(),
        ]);
        return { loggedIn, rateLimited };
      } catch {
        return { loggedIn: false, rateLimited: false };
      }
    };
    const [chatgpt, gemini] = await Promise.all([probe(this.chatGPT), probe(this.gemini)]);
    // 認証済みならチャットペインをロック(スクロール以外の操作を遮断)、
    // 未認証なら解除(ログイン操作ができるように)。両ペインとも同方式。
    void this.chatGPT.setInteractionLock(chatgpt.loggedIn);
    void this.gemini.setInteractionLock(gemini.loggedIn);
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
