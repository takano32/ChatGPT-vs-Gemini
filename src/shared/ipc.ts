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
  TranscriptPayload,
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
  transcriptToggle: 'transcript:toggle', // 管理ペイン -> main。ライブ⇄経過の表示切替
  transcriptShowConversation: 'transcript:show-conversation', // 履歴から経過表示
  transcriptCopyMarkdown: 'transcript:copy-md', // 経過を gist 形式 Markdown でクリップボードへ

  // main -> renderer (send)
  evLog: 'event:log',
  evRunnerStatus: 'event:runner-status',
  evMessage: 'event:message',
  evChatStatus: 'event:chat-status',
  evTranscript: 'event:transcript', // main -> transcript ビュー。全文を渡して再描画
  evTranscriptVisible: 'event:transcript-visible', // main -> admin。トグルボタンの状態同期
} as const;

/** preload が contextBridge で `window.api` に公開する形。 */
export interface RendererApi {
  /** maxTurns はそのラン用の上書き(省略時は設定の既定を使う)。保存はしない。 */
  startDebate(topic: string, maxTurns?: number): Promise<void>;
  stopDebate(): Promise<void>;
  pauseDebate(): Promise<void>;
  resumeDebate(): Promise<void>;

  getSettings(): Promise<SettingsData>;
  setSettings(settings: SettingsData): Promise<void>;

  search(query: string): Promise<SearchHit[]>;
  listConversations(): Promise<ConversationRecord[]>;
  getMessages(conversationId: number): Promise<MessageRecord[]>;
  getChatStatus(): Promise<ChatStatusMap>;
  toggleTranscript(): Promise<void>;
  showConversationTranscript(conversationId: number): Promise<void>;
  /** 経過を gist 形式 Markdown にしてクリップボードへコピー。成功すれば true */
  copyTranscriptMarkdown(conversationId: number): Promise<boolean>;

  // 購読系。戻り値は購読解除関数
  onLog(cb: (entry: LogEntry) => void): () => void;
  onRunnerStatus(cb: (status: RunnerStatus) => void): () => void;
  onMessage(cb: (message: MessageRecord) => void): () => void;
  onChatStatus(cb: (status: ChatStatusMap) => void): () => void;
  onTranscript(cb: (payload: TranscriptPayload) => void): () => void;
  onTranscriptVisible(cb: (visible: boolean) => void): () => void;
}
