// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// main / preload / renderer で共有するドメイン型。
// renderer は直接 import せず、src/renderer/api.d.ts にミラーを持つ(ビルド単純化のため)。
import { DEFAULT_TEMPLATES, TIMEKEEPER, type DebateTemplates, type Mode, type Timekeeper } from './modes';
export { DEFAULT_TEMPLATES, TIMEKEEPER, MODES, ASYMMETRIC_MODES, isMode, type DebateTemplates, type Mode, type Timekeeper } from './modes';

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

/**
 * 会話の実行条件のスナップショット(conversations.config、JSON で 1 列)。
 * 将来の条件(ロールプレイの役割など)は列を増やさずここへ足す(docs/schema.md)。全フィールド任意
 */
export interface ConversationConfig {
  /** 先攻(1 発言目の話者からも復元できるが、0 発言で止まった会話はこれが唯一の記録) */
  firstSpeaker?: Speaker;
  /** 議論を走らせた言語 */
  language?: Lang;
  /** 書き込んだアプリの版 */
  app?: string;
  /** ロールプレイの役割(0.9.0)。他のモードでは書かない */
  roles?: { chatgpt: string; gemini: string };
}

export interface ConversationRecord {
  id: number;
  title: string;
  status: ConversationStatus;
  createdAt: string; // ISO 8601
  updatedAt: string;
  /** 開始時の最大ターン数。列追加前に作られた会話は null */
  maxTurns: number | null;
  /** 議論のモード。列追加前に作られた会話は null(= 対立) */
  mode: Mode | null;
  /** 実行条件のスナップショット。列追加前の会話・壊れた JSON は null */
  config: ConversationConfig | null;
}

export interface MessageRecord {
  id: number;
  conversationId: number;
  speaker: Speaker;
  /** 本文のプレーンテキスト。常に存在し、全文検索・経過表示・相手への中継はこれを使う(意味は今後も変えない) */
  content: string;
  /** 本文の Markdown 版(見出し・コード等を保った記録)。直列化できなかった発言・列追加前は null */
  contentMd: string | null;
  /** この発言を引き出した送信文(進行役の行込み)。列追加前は null */
  prompt: string | null;
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
  /** ロールプレイの役割(会話の config から)。無ければ null */
  roles: { chatgpt: string; gemini: string } | null;
  status: ConversationStatus | null;
  maxTurns: number;
  mode: Mode | null;
  messages: MessageRecord[];
}

export interface ChatStatus {
  /** ページ読込中(起動直後・新規チャットへの遷移中・ログイン操作中など)。ready の判定は保留 */
  loading: boolean;
  /** サイトの origin にいる(ログインで別サイトへ出ている間は false)。ready でないときの案内の切り分け用 */
  onSite: boolean;
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
  // レート制限の自動クールダウン中(until は epoch ms。待ち終えると同じターンを再試行する)
  cooldown?: { speaker: Speaker; until: number; attempt: number; max: number };
  // 実行中・一時停止中: いま誰のターンで、進行役のどの段階か(序盤 / 中盤 / 終盤 / まとめ)
  progress?: { speaker: Speaker; phase: 'early' | 'middle' | 'late' | 'closing' };
}

export interface LogEntry {
  level: 'info' | 'warn' | 'error';
  message: string;
  ts: string;
}

/** 対応言語は日本語と英語の 2 つだけ(他は対応しない。2026-08-23 利用者の決定) */
export type Lang = 'ja' | 'en';

export interface SettingsData {
  /** 画面文言・ログ・プロンプトの言語(ヘッダ右上で切替) */
  language: Lang;
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
    /** 既定のモード(操作バーで議論ごとに上書きできる) */
    mode: Mode; // 設定画面でテンプレートを編集しているモード(0.6.5 以降、操作バーの既定には使わない: 操作バーは常に対立で始まる)
    /** 言語 × モードごとのプロンプトテンプレート(定義は shared/modes.ts) */
    templates: Record<Lang, Record<Mode, DebateTemplates>>;
    /** 進行役の一文(言語ごと。定義は shared/modes.ts) */
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
    /** 前回のウィンドウ位置。null = 記録なし(OS に任せる)。マルチモニタで負の座標もあるため丸めるだけで範囲は絞らない */
    x: number | null;
    y: number | null;
  };
}

export const DEFAULT_SETTINGS: SettingsData = {
  language: 'ja',
  layout: {
    adminRatio: 0.5,
    chatSplit: 0.5,
    chatZoom: 0.75,
  },
  debate: {
    maxTurns: 10,
    firstSpeaker: 'chatgpt',
    mode: 'debate',
    templates: DEFAULT_TEMPLATES,
    timekeeper: TIMEKEEPER,
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
    x: null,
    y: null,
  },
};
