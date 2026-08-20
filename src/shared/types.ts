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

export interface ChatStatus {
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
    adminRatio: 0.3,
    chatSplit: 0.5,
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
    betweenTurnsMs: 5000,
  },
  detection: {
    pollMs: 1000,
    stabilityMs: 6000,
    timeoutMs: 300000,
  },
  window: {
    width: 1280,
    height: 860,
  },
};
