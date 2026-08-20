// Composition Root。各コンポーネントの組み立てと IPC の仲介だけを行い、ロジックは持たない。

import { app, ipcMain } from 'electron';
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
} from './shared/types';

const CHAT_STATUS_POLL_MS = 5000;

export class Application {
  private manager!: Manager;
  private repository!: Repository;
  private runner!: Runner;
  private chatGPT!: ChatGPT;
  private gemini!: Gemini;
  private statusTimer: NodeJS.Timeout | null = null;

  start(): void {
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }
    app.on('window-all-closed', () => app.quit());
    app.on('will-quit', () => this.dispose());
    void app.whenReady().then(() => this.init());
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
    ipcMain.handle(IPC.runnerStart, (_e, topic: string) => {
      // 議論全体を await すると invoke が完走まで返らないため fire-and-forget。
      // エラーは Runner が status/log イベントで通知する。
      void this.runner.start(String(topic)).catch(() => {});
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
  }

  private forwardEvents(): void {
    this.runner.on('status', (s: RunnerStatus) => this.sendToAdmin(IPC.evRunnerStatus, s));
    this.runner.on('message', (m: MessageRecord) => this.sendToAdmin(IPC.evMessage, m));
    this.runner.on('log', (l: LogEntry) => this.sendToAdmin(IPC.evLog, l));
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
    const probe = async (chat: Chat): Promise<ChatStatus> => {
      try {
        const [loggedIn, rateLimited] = await Promise.all([
          chat.isLoggedIn(),
          chat.isRateLimited(),
        ]);
        return { loggedIn, rateLimited };
      } catch {
        return { loggedIn: false, rateLimited: false };
      }
    };
    const [chatgpt, gemini] = await Promise.all([probe(this.chatGPT), probe(this.gemini)]);
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
