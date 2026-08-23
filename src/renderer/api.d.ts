// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// src/shared と手動同期(types.ts / ipc.ts のミラー)。
// renderer ビルドは ../shared を import できないため、純粋な ambient 宣言として持つ。
// src/shared 側を変更したら必ずここも追従させること。

type Speaker = 'chatgpt' | 'gemini';

type RunnerState = 'idle' | 'running' | 'paused' | 'stopped' | 'error' | 'done';

type ConversationStatus = 'running' | 'paused' | 'stopped' | 'error' | 'done';

interface ConversationRecord {
  id: number;
  title: string;
  status: ConversationStatus;
  createdAt: string; // ISO 8601
  updatedAt: string;
  maxTurns: number | null;
  mode: Mode | null;
}

interface MessageRecord {
  id: number;
  conversationId: number;
  speaker: Speaker;
  content: string;
  createdAt: string;
}

interface SearchHit {
  message: MessageRecord;
  conversationTitle: string;
  snippet: string;
}

interface TranscriptPayload {
  conversationId: number;
  title: string;
  status: ConversationStatus | null;
  maxTurns: number;
  mode: Mode | null;
  messages: MessageRecord[];
}

interface ChatStatus {
  loading: boolean;
  ready: boolean;
  loggedIn: boolean;
  rateLimited: boolean;
}

interface ChatStatusMap {
  chatgpt: ChatStatus;
  gemini: ChatStatus;
}

interface RunnerStatus {
  state: RunnerState;
  conversationId: number | null;
  turn: number; // 送信済みメッセージ数(1 AI 発言 = 1 ターン)
  maxTurns: number;
  error?: string;
  // レート制限の自動クールダウン中(until は epoch ms。待ち終えると同じターンを再試行する)
  cooldown?: { speaker: Speaker; until: number; attempt: number; max: number };
}

interface LogEntry {
  level: 'info' | 'warn' | 'error';
  message: string;
  ts: string;
}

type Lang = 'ja' | 'en';

type Mode =
  | 'debate'
  | 'collab'
  | 'brainstorm'
  | 'dialectic'
  | 'relay'
  | 'review'
  | 'interview'
  | 'socratic'
  | 'devil'
  | 'quiz';

interface DebateTemplates {
  openingTemplate: string;
  counterTemplate: string;
  relayFirstTemplate: string;
  relaySecondTemplate: string;
  closingTemplate: string;
}

interface Timekeeper {
  template: string;
  early: string;
  middle: string;
  late: string;
}

interface SettingsData {
  /** 画面文言・ログ・プロンプトの言語 */
  language: Lang;
  layout: {
    /** 管理ペインの高さ比(0-1) */
    adminRatio: number;
    /** 下段のうち ChatGPT の幅比(0-1) */
    chatSplit: number;
    /** チャットペインのズーム率(1=100%) */
    chatZoom: number;
  };
  debate: {
    maxTurns: number;
    firstSpeaker: Speaker;
    /** 既定のモード(操作バーで議論ごとに上書きできる) */
    mode: Mode;
    /** 言語 × モードごとのプロンプトテンプレート */
    templates: Record<Lang, Record<Mode, DebateTemplates>>;
    /** 進行役の一文(言語ごと) */
    timekeeper: Record<Lang, Timekeeper>;
    /** ターン間の待機 ms(レート制限対策) */
    betweenTurnsMs: number;
  };
  detection: {
    /** 応答監視のポーリング間隔 ms */
    pollMs: number;
    /** 本文がこの時間変化しなければ完了とみなす ms */
    stabilityMs: number;
    /** 1 応答の上限 ms。超えたらタイムアウト */
    timeoutMs: number;
  };
  window: {
    width: number;
    height: number;
  };
}

/** preload が contextBridge で `window.api` に公開する形。 */
interface RendererApi {
  startDebate(topic: string, maxTurns?: number, firstSpeaker?: Speaker, mode?: Mode): Promise<void>;
  stopDebate(): Promise<void>;
  pauseDebate(): Promise<void>;
  resumeDebate(): Promise<void>;

  getSettings(): Promise<SettingsData>;
  setSettings(settings: SettingsData): Promise<void>;
  /** 管理ペインとチャットペインの境界ドラッグの開始 / 終了(main がポインタ位置を追って比率を変える) */
  beginPaneDrag(): void;
  endPaneDrag(): void;
  /** ドラッグ中のポインタ縦位置(このペインの clientY)を main に送る */
  reportPaneDragY(clientY: number): void;
  /** main からの「ドラッグ中かどうか」。true の間だけ pointermove を報告する */
  onPaneDragActive(cb: (active: boolean) => void): () => void;
  /** 設定が保存されたとき(言語切替など)。正規化済みの設定全体が届く */
  onSettingsChanged(cb: (settings: SettingsData) => void): () => void;

  search(query: string): Promise<SearchHit[]>;
  listConversations(): Promise<ConversationRecord[]>;
  getMessages(conversationId: number): Promise<MessageRecord[]>;
  getChatStatus(): Promise<ChatStatusMap>;
  toggleTranscript(): Promise<void>;
  showConversationTranscript(conversationId: number): Promise<void>;
  copyTranscriptMarkdown(conversationId: number): Promise<boolean>;

  // 購読系。戻り値は購読解除関数
  onLog(cb: (entry: LogEntry) => void): () => void;
  onRunnerStatus(cb: (status: RunnerStatus) => void): () => void;
  onMessage(cb: (message: MessageRecord) => void): () => void;
  onChatStatus(cb: (status: ChatStatusMap) => void): () => void;
  onTranscript(cb: (payload: TranscriptPayload) => void): () => void;
  onTranscriptVisible(cb: (visible: boolean) => void): () => void;
}

interface Window {
  api: RendererApi;
}
