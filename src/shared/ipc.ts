// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// IPC チャンネル名と preload が renderer に公開する API の契約。
// チャンネル名を知るのは main と preload だけ。renderer は window.api 経由でのみ通信する。

import type {
  ChatStatusMap,
  ConversationRecord,
  LogEntry,
  MessageRecord,
  Mode,
  RunnerStatus,
  SearchHit,
  SettingsData,
  Speaker,
  TranscriptPayload,
} from './types';

export const IPC = {
  // renderer -> main (invoke)
  runnerStart: 'runner:start',
  runnerStop: 'runner:stop',
  runnerPause: 'runner:pause',
  runnerResume: 'runner:resume',
  // 管理ペイン下端のつまみでペイン比をドラッグ(renderer -> main: send)。
  // 終了はチャットペインの preload(chat-preload.js)からも届く(ポインタをチャット側で離したとき)
  layoutDragStart: 'layout:drag-start',
  layoutDragEnd: 'layout:drag-end',
  // ドラッグ中だけ各ペインが pointermove の clientY を main に送る(main -> 各ペイン: active の on/off)。
  // Wayland では screen.getCursorScreenPoint() が使えないため、ポインタ位置はペイン側から受け取る
  layoutDragMove: 'layout:drag-move',
  evLayoutDragActive: 'layout:ev-drag-active',
  // 設定が変わった(main -> 管理ペイン・経過表示)。言語切替で両方の画面文言を差し替えるのに使う
  evSettingsChanged: 'settings:ev-changed',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  search: 'repository:search',
  listConversations: 'repository:conversations',
  getMessages: 'repository:messages',
  deleteConversation: 'repository:delete-conversation',
  renameConversation: 'repository:rename-conversation',
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
  /** 会話を発言ごと消す(確認なし)。議論中の会話なら false */
  deleteConversation(conversationId: number): Promise<boolean>;
  /** 会話の名前を変える。空なら false */
  renameConversation(conversationId: number, title: string): Promise<boolean>;
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
