// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// main / preload / renderer で共有するドメイン型。
// renderer は直接 import せず、src/renderer/api.d.ts にミラーを持つ(ビルド単純化のため)。

export type Speaker = 'chatgpt' | 'gemini';

export const SPEAKER_LABELS: Record<Speaker, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
};

export function opponentOf(speaker: Speaker): Speaker {
  return speaker === 'chatgpt' ? 'gemini' : 'chatgpt';
}

export type RunnerState = 'idle' | 'running' | 'paused' | 'stopped' | 'error' | 'done';

export type ConversationStatus = 'running' | 'paused' | 'stopped' | 'error' | 'done';

export interface ConversationRecord {
  id: number;
  title: string;
  status: ConversationStatus;
  createdAt: string; // ISO 8601
  updatedAt: string;
  /** 開始時の最大ターン数。列追加前に作られた会話は null */
  maxTurns: number | null;
}

export interface MessageRecord {
  id: number;
  conversationId: number;
  speaker: Speaker;
  content: string;
  createdAt: string;
}

export interface SearchHit {
  message: MessageRecord;
  conversationTitle: string;
  snippet: string;
}

export interface TranscriptPayload {
  conversationId: number;
  title: string;
  status: ConversationStatus | null;
  maxTurns: number;
  messages: MessageRecord[];
}

export interface ChatStatus {
  /** ページ読込中(起動直後・新規チャットへの遷移中・ログイン操作中など)。ready の判定は保留 */
  loading: boolean;
  /** サイトの画面にいて入力欄がある = 送信できる。ログインは不要(両サイトともゲスト利用可) */
  ready: boolean;
  /** セッション Cookie がある。表示専用(ログインすると利用制限が緩くなる) */
  loggedIn: boolean;
  rateLimited: boolean;
}

export interface ChatStatusMap {
  chatgpt: ChatStatus;
  gemini: ChatStatus;
}

export interface RunnerStatus {
  state: RunnerState;
  conversationId: number | null;
  turn: number; // 送信済みメッセージ数(1 AI 発言 = 1 ターン)
  maxTurns: number;
  error?: string;
}

export interface LogEntry {
  level: 'info' | 'warn' | 'error';
  message: string;
  ts: string;
}

export interface SettingsData {
  layout: {
    /** 管理ペインの高さ比(0-1) */
    adminRatio: number;
    /** 下段のうち ChatGPT の幅比(0-1) */
    chatSplit: number;
    /** チャットペインのズーム率(1=100%。0.75 で縮小表示して情報量を増やす) */
    chatZoom: number;
  };
  debate: {
    maxTurns: number;
    firstSpeaker: Speaker;
    /** 先攻への最初の指示。{topic} {opponent} を展開 */
    openingTemplate: string;
    /** 後攻への最初の指示。{topic} {opponent} {message} を展開 */
    counterTemplate: string;
    /** 3ターン目以降の中継。{opponent} {message} を展開 */
    relayTemplate: string;
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

export const DEFAULT_SETTINGS: SettingsData = {
  layout: {
    adminRatio: 0.5,
    chatSplit: 0.5,
    chatZoom: 0.75,
  },
  debate: {
    maxTurns: 10,
    firstSpeaker: 'chatgpt',
    openingTemplate:
      'あなたはこれから別のAI({opponent})と議論します。テーマ: 「{topic}」。' +
      'まず、このテーマについてあなたの立場と根拠を400字以内で述べてください。',
    counterTemplate:
      'あなたはこれから別のAI({opponent})と議論します。テーマ: 「{topic}」。' +
      '相手の最初の主張は以下のとおりです。400字以内で反論または深掘りしてください。\n\n{message}',
    relayTemplate:
      '相手({opponent})の発言:\n\n{message}\n\nこれに対して400字以内で応答し、議論を続けてください。',
    betweenTurnsMs: 0,
  },
  detection: {
    pollMs: 150,
    stabilityMs: 6000,
    timeoutMs: 300000,
  },
  window: {
    width: 1280,
    height: 860,
  },
};
