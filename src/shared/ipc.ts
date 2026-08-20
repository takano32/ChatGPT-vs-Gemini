// IPC チャンネル名と preload が renderer に公開する API の契約。
// チャンネル名を知るのは main と preload だけ。renderer は window.api 経由でのみ通信する。

import type {
  ChatStatusMap,
  ConversationRecord,
  LogEntry,
  MessageRecord,
  RunnerStatus,
  SearchHit,
  SettingsData,
} from './types';

export const IPC = {
  // renderer -> main (invoke)
  runnerStart: 'runner:start',
  runnerStop: 'runner:stop',
  runnerPause: 'runner:pause',
  runnerResume: 'runner:resume',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  search: 'repository:search',
  listConversations: 'repository:conversations',
  getMessages: 'repository:messages',
  chatStatus: 'chat:status',

  // main -> renderer (send)
  evLog: 'event:log',
  evRunnerStatus: 'event:runner-status',
  evMessage: 'event:message',
  evChatStatus: 'event:chat-status',
} as const;

/** preload が contextBridge で `window.api` に公開する形。 */
export interface RendererApi {
  startDebate(topic: string): Promise<void>;
  stopDebate(): Promise<void>;
  pauseDebate(): Promise<void>;
  resumeDebate(): Promise<void>;

  getSettings(): Promise<SettingsData>;
  setSettings(settings: SettingsData): Promise<void>;

  search(query: string): Promise<SearchHit[]>;
  listConversations(): Promise<ConversationRecord[]>;
  getMessages(conversationId: number): Promise<MessageRecord[]>;
  getChatStatus(): Promise<ChatStatusMap>;

  // 購読系。戻り値は購読解除関数
  onLog(cb: (entry: LogEntry) => void): () => void;
  onRunnerStatus(cb: (status: RunnerStatus) => void): () => void;
  onMessage(cb: (message: MessageRecord) => void): () => void;
  onChatStatus(cb: (status: ChatStatusMap) => void): () => void;
}
