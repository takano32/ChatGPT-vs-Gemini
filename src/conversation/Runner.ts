// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// 議論エンジン。2 つの Chat を交互に叩き、応答を中継しながら Repository に記録する。
// 制約: start() は同時に 1 本のみ。pause 中の stop() は resume より優先される。

import { EventEmitter } from 'events';
import {
  SPEAKER_LABELS,
  opponentOf,
  type DebateTemplates,
  type LogEntry,
  type MessageRecord,
  type Mode,
  type RunnerState,
  type RunnerStatus,
  type SettingsData,
  type Speaker,
  type Timekeeper,
} from '../shared/types';
import { Conversation } from './Conversation';
import { tm } from '../shared/i18n';
import type { Repository } from './Repository';
import { ChatError, type Chat } from '../chat/Chat';
import type { Settings } from '../manager/Settings';

type DebateConfig = SettingsData['debate'];

interface RunnerDeps {
  chats: Record<Speaker, Chat>;
  repository: Repository;
  settings: Settings;
  /** レート制限の待ち時間(既定 COOLDOWN_MS。テストで短くする) */
  cooldownMs?: number;
}

// レート制限(ゲストの送信上限など)に当たったときの自動クールダウン: この時間待って同じターンを再試行し、
// 連続 COOLDOWN_ATTEMPTS 回とも制限のままなら一時停止して利用者の「再開」を待つ。
// 2026-08-21 実測では解除までの時間は未観察なので 60 秒は仮置き(設定には出さない)
const COOLDOWN_MS = 60_000;
const COOLDOWN_ATTEMPTS = 3;

export class Runner extends EventEmitter {
  private readonly chats: Record<Speaker, Chat>;
  private readonly repository: Repository;
  private readonly settings: Settings;
  private readonly cooldownMs: number;

  private state: RunnerState = 'idle';
  private conversation: Conversation | null = null;
  private debate: DebateConfig | null = null;
  private lastError: string | undefined;
  private cooldown: RunnerStatus['cooldown'];
  private rateLimitStreak = 0;

  // 世代トークン。stop 直後に start された場合、旧ループの残骸を無効化する
  private runId = 0;
  private stopRequested = false;
  private pauseRequested = false;

  private currentSpeaker: Speaker | null = null;
  // 進行状況の表示用(誰のターン・段階)。currentSpeaker は ask 中の追跡用なので分ける
  private currentTurn: { speaker: Speaker; step: TurnStep } | null = null;
  private askInFlight = false;
  // stop 直後の再 start が Chat の単一実行ガードに衝突しないよう、前回の ask の決着を待つ
  private inFlightAsk: Promise<string> | null = null;

  private resumeWaiter: (() => void) | null = null;
  private sleepWaiter: (() => void) | null = null;

  constructor(deps: RunnerDeps) {
    super();
    this.chats = deps.chats;
    this.repository = deps.repository;
    this.settings = deps.settings;
    this.cooldownMs = deps.cooldownMs ?? COOLDOWN_MS;
    // Chat 内部の自己修復(送信の再試行など)もログフィードに流す
    for (const chat of Object.values(this.chats)) {
      chat.notice = (message) => this.log('warn', message);
    }
  }

  get status(): RunnerStatus {
    const status: RunnerStatus = {
      state: this.state,
      conversationId: this.conversation ? this.conversation.id : null,
      turn: this.conversation ? this.conversation.turnCount : 0,
      maxTurns: this.debate ? this.debate.maxTurns : this.settings.get().debate.maxTurns,
    };
    if (this.lastError !== undefined) {
      status.error = this.lastError;
    }
    if (this.cooldown) status.cooldown = this.cooldown;
    if ((this.state === 'running' || this.state === 'paused') && this.currentTurn) {
      status.progress = { speaker: this.currentTurn.speaker, phase: this.currentTurn.step.phase };
    }
    return status;
  }

  async start(
    topic: string,
    maxTurnsOverride?: number,
    firstSpeakerOverride?: Speaker,
    modeOverride?: Mode,
  ): Promise<void> {
    const myRun = await this.beginRun();
    if (myRun === null) return;

    // 設定は開始時に 1 回だけ読む(途中変更は次回から反映)。
    // maxTurns / firstSpeaker はそのラン用の上書きがあれば優先(操作バーの一時値。保存はしない)。
    const all = this.settings.get();
    const base = all.debate;
    const debate: DebateConfig = {
      ...base,
      maxTurns:
        typeof maxTurnsOverride === 'number' && maxTurnsOverride >= 1 ? Math.floor(maxTurnsOverride) : base.maxTurns,
      firstSpeaker: firstSpeakerOverride ?? base.firstSpeaker,
      mode: modeOverride ?? base.mode,
    };
    // テンプレートは開始時の言語・モードのもの(途中で切り替えても進行中の議論には影響しない)
    const tpl = base.templates[all.language][debate.mode];
    const timekeeper = base.timekeeper[all.language];
    this.debate = debate;

    this.state = 'running';
    let conversation: Conversation;
    try {
      conversation = new Conversation(this.repository.createConversation(topic, debate.maxTurns, debate.mode));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.state = 'error';
      this.lastError = message;
      this.emitStatus();
      this.log('error', tm('runner.createFailed', { error: message }));
      return;
    }
    this.conversation = conversation;
    this.emitStatus();
    this.log(
      'info',
      tm('runner.start', { topic: topic.replace(/\s*\n\s*/g, ' / '), max: debate.maxTurns, mode: tm(`mode.${debate.mode}`) }),
    );
    await this.run(myRun, conversation, topic, debate, tpl, timekeeper, [], 1);
  }

  /**
   * 止まった会話(停止 / エラー)を、保存済みの発言の次のターンから同じ会話に追記して再開する。
   * 議題・モード・上限は会話の保存値、先攻は 1 発言目の話者。両サイトは新規チャットになるが、
   * テンプレートが渡すのは相手の直前の発言だけなので、そのまま続けられる。再開できなければ false
   */
  async resumeConversation(conversationId: number): Promise<boolean> {
    const record = this.repository.listConversations().find((c) => c.id === conversationId);
    const messages = record ? this.repository.getMessages(conversationId) : [];
    const maxTurns = record?.maxTurns ?? this.settings.get().debate.maxTurns;
    // 0 発言は対象外: 先攻が保存されておらず(1 発言目の話者から復元する)、設定の既定にすり替わってしまう。「もう一度」で足りる
    if (!record || (record.status !== 'stopped' && record.status !== 'error') || messages.length === 0 || messages.length >= maxTurns) {
      this.log('warn', tm('runner.cannotResume'));
      return false;
    }
    const myRun = await this.beginRun();
    if (myRun === null) return false;

    const all = this.settings.get();
    const base = all.debate;
    const debate: DebateConfig = {
      ...base,
      maxTurns,
      firstSpeaker: messages[0]?.speaker ?? base.firstSpeaker,
      mode: record.mode ?? 'debate',
    };
    const tpl = base.templates[all.language][debate.mode];
    const timekeeper = base.timekeeper[all.language];
    this.debate = debate;

    this.state = 'running';
    const conversation = new Conversation(record);
    for (const m of messages) conversation.addMessage(m);
    this.conversation = conversation;
    this.setConversationStatus('running');
    this.emitStatus();
    this.log(
      'info',
      tm('runner.resumeFrom', {
        topic: record.title.replace(/\s*\n\s*/g, ' / '),
        turn: messages.length + 1,
        max: debate.maxTurns,
        mode: tm(`mode.${debate.mode}`),
      }),
    );
    await this.run(myRun, conversation, record.title, debate, tpl, timekeeper, messages.map((m) => m.content), messages.length + 1);
    return true;
  }

  /** 実行中でなければ世代を進めて状態を初期化し、前回の ask の決着を待つ。実行中なら null */
  private async beginRun(): Promise<number | null> {
    if (this.state === 'running' || this.state === 'paused') {
      this.log('warn', tm('runner.alreadyRunning'));
      return null;
    }
    const myRun = ++this.runId;
    this.stopRequested = false;
    this.pauseRequested = false;
    this.lastError = undefined;
    this.cooldown = undefined;
    this.rateLimitStreak = 0;
    this.currentTurn = null;
    this.resumeWaiter = null;
    this.sleepWaiter = null;

    // 前回 stop した ask が未決着なら決着を待つ(Chat の busy ガード対策)
    if (this.inFlightAsk) {
      await this.inFlightAsk.catch(() => {});
      this.inFlightAsk = null;
      if (this.runId !== myRun) return null;
    }
    return myRun;
  }

  // ターンの進行本体。startTurn から maxTurns まで回す(再開時は保存済みの返答を replies に入れて途中から)
  private async run(
    myRun: number,
    conversation: Conversation,
    topic: string,
    debate: DebateConfig,
    tpl: DebateTemplates,
    timekeeper: Timekeeper,
    replies: string[],
    startTurn: number,
  ): Promise<void> {
    // 議論ごとに両サイトで新規チャットを開き、前の議論の文脈を持ち越さない
    this.log('info', tm('runner.preparing'));
    try {
      await Promise.all([this.chats.chatgpt.newChat(), this.chats.gemini.newChat()]);
    } catch (err) {
      if (this.runId !== myRun || this.stopRequested) return;
      const message = err instanceof Error ? err.message : String(err);
      this.state = 'error';
      this.lastError = message;
      this.setConversationStatus('error');
      this.emitStatus();
      this.log('error', tm('runner.prepareFailed', { error: message }));
      return;
    }
    if (this.runId !== myRun || this.stopRequested) return;

    // replies: 各ターンの返答(添字 = ターン番号 - 1)。まとめの 2 人目には相手の「最後の通常発言」を渡すために保持する
    const plan = planTurns(debate.maxTurns);

    for (let turn = startTurn; turn <= debate.maxTurns; turn++) {
      const speaker: Speaker = turn % 2 === 1 ? debate.firstSpeaker : opponentOf(debate.firstSpeaker);
      const opponentLabel = SPEAKER_LABELS[opponentOf(speaker)];
      const step = plan[turn - 1]!;
      // 進行状況の表示用(誰のターン・段階)。ターンが決まった時点で出す
      this.currentTurn = { speaker, step };
      this.emitStatus();
      // 1: 開始(先攻)/ 2: 反論(後攻)/ 奇数: 先攻の中継 / 偶数: 後攻の中継 / 最後の 2 ターン: まとめ
      const template =
        step.kind === 'closing'
          ? tpl.closingTemplate
          : turn === 1
            ? tpl.openingTemplate
            : turn === 2
              ? tpl.counterTemplate
              : turn % 2 === 1
                ? tpl.relayFirstTemplate
                : tpl.relaySecondTemplate;
      // 相手の発言: 通常は直前の返答。まとめの 2 人目だけは相手のまとめではなく相手の最後の通常発言
      // (同じ材料でまとめさせ、片方だけが相手のまとめを見て有利にならないようにする)
      const message = replies[step.messageTurn - 1] ?? '';
      const phase = step.phase === 'early' ? timekeeper.early : step.phase === 'middle' ? timekeeper.middle : step.phase === 'late' ? timekeeper.late : '';
      const lead = this.render(timekeeper.template, {
        turn: String(turn),
        max: String(debate.maxTurns),
        remaining: String(debate.maxTurns - turn),
        phase,
      });
      const prompt = lead.trim() + '\n\n' + this.render(template, { topic, opponent: opponentLabel, message });

      let sent = false;
      while (!sent) {
        if (this.runId !== myRun) return;
        if (this.stopRequested) return; // 終了処理は stop() 側で済んでいる
        if (this.pauseRequested) {
          await this.waitForResume();
          continue; // 再開後に stop を再チェック
        }

        const chat = this.chats[speaker];
        this.log('info', tm('runner.send', { name: chat.displayName }));
        this.currentSpeaker = speaker;
        this.askInFlight = true;
        let reply: string;
        try {
          const askPromise = chat.ask(prompt);
          this.inFlightAsk = askPromise;
          reply = await askPromise;
        } catch (err) {
          this.askInFlight = false;
          this.inFlightAsk = null;
          this.currentSpeaker = null;
          if (this.runId !== myRun) return;
          // stop() が先に完了処理を済ませている。ask() が stopped 以外の
          // エラー(rate-limited / timeout 等)で抜けてきても stopped を上書きしない
          if (this.stopRequested) return;

          if (err instanceof ChatError && err.code === 'rate-limited') {
            this.rateLimitStreak += 1;
            if (this.rateLimitStreak <= COOLDOWN_ATTEMPTS) {
              // 自動クールダウン: 待ってから同じターンを再試行。待機中も停止・一時停止は効く(sleep を起こす)
              const attempt = this.rateLimitStreak;
              this.cooldown = { speaker, until: Date.now() + this.cooldownMs, attempt, max: COOLDOWN_ATTEMPTS };
              this.emitStatus();
              this.log(
                'warn',
                tm('runner.cooldown', {
                  name: chat.displayName,
                  seconds: Math.round(this.cooldownMs / 1000),
                  attempt,
                  max: COOLDOWN_ATTEMPTS,
                }),
              );
              await this.sleep(this.cooldownMs);
              this.cooldown = undefined;
              if (this.runId !== myRun) return;
              this.emitStatus();
              continue; // 同一ターンを再試行(ターンは進めない)
            }
            this.rateLimitStreak = 0;
            this.state = 'paused';
            this.setConversationStatus('paused');
            this.emitStatus();
            this.log('warn', tm('runner.rateLimited', { name: chat.displayName, max: COOLDOWN_ATTEMPTS }));
            await this.waitForResume();
            continue; // 同一ターンを再試行(ターンは進めない)
          }
          if (err instanceof ChatError && err.code === 'stopped') {
            // stop() が state を並行に書き換えるため、直接比較すると TS が過剰に絞り込む
            if (!this.isInState('stopped')) {
              this.state = 'stopped';
              this.setConversationStatus('stopped');
              this.emitStatus();
              this.log('info', tm('runner.stopped'));
            }
            return;
          }
          const message = err instanceof Error ? err.message : String(err);
          this.state = 'error';
          this.lastError = message;
          this.setConversationStatus('error');
          this.emitStatus();
          this.log('error', tm('runner.aborted', { error: message }));
          return;
        }
        this.askInFlight = false;
        this.inFlightAsk = null;
        this.currentSpeaker = null;
        this.rateLimitStreak = 0;
        if (this.runId !== myRun) return;
        if (this.stopRequested) return;

        let record: MessageRecord;
        try {
          record = this.repository.addMessage(conversation.id, speaker, reply);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.state = 'error';
          this.lastError = message;
          this.setConversationStatus('error');
          this.emitStatus();
          this.log('error', tm('runner.saveFailed', { error: message }));
          return;
        }
        conversation.addMessage(record);
        this.emit('message', record);
        this.emitStatus();
        replies.push(reply);
        sent = true;
      }

      if (turn < debate.maxTurns) {
        await this.sleep(debate.betweenTurnsMs);
        if (this.runId !== myRun) return;
      }
    }

    if (this.runId !== myRun || this.stopRequested) return;
    this.currentTurn = null;
    this.state = 'done';
    this.setConversationStatus('done');
    this.emitStatus();
    this.log('info', tm('runner.done', { turns: conversation.turnCount }));
  }

  stop(): void {
    if (this.state !== 'running' && this.state !== 'paused') return;
    this.stopRequested = true;
    this.pauseRequested = false;
    this.cooldown = undefined;
    this.currentTurn = null;
    const inFlightSpeaker = this.askInFlight ? this.currentSpeaker : null;

    this.state = 'stopped';
    this.setConversationStatus('stopped');
    this.emitStatus();
    this.log('info', tm('runner.stopped'));

    this.wakeAll();
    if (inFlightSpeaker) {
      this.chats[inFlightSpeaker].stop();
    }
  }

  pause(): void {
    if (this.state !== 'running') return;
    this.pauseRequested = true;
    this.state = 'paused';
    this.cooldown = undefined;
    this.setConversationStatus('paused');
    this.emitStatus();
    this.log('info', tm('runner.paused'));
    // クールダウンやターン間の待機中なら起こして、ループ先頭の一時停止判定に進ませる
    const sleep = this.sleepWaiter;
    if (sleep) sleep();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.pauseRequested = false;
    this.state = 'running';
    this.setConversationStatus('running');
    this.emitStatus();
    this.log('info', tm('runner.resumed'));
    const waiter = this.resumeWaiter;
    this.resumeWaiter = null;
    if (waiter) waiter();
  }

  private render(template: string, vars: Record<string, string>): string {
    let out = template;
    for (const [name, value] of Object.entries(vars)) out = out.replaceAll(`{${name}}`, value);
    return out;
  }

  private setConversationStatus(status: Conversation['status']): void {
    if (!this.conversation) return;
    this.conversation.status = status;
    try {
      this.repository.setConversationStatus(this.conversation.id, status);
    } catch (err) {
      // 状態遷移自体は続行し、永続化失敗のみ通知する
      this.log('warn', tm('runner.statusSaveFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
  }

  private waitForResume(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.resumeWaiter = resolve;
    });
  }

  /** stop() で即時に起きられるスリープ */
  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.sleepWaiter = null;
        resolve();
      }, ms);
      this.sleepWaiter = () => {
        clearTimeout(timer);
        this.sleepWaiter = null;
        resolve();
      };
    });
  }

  private wakeAll(): void {
    const resume = this.resumeWaiter;
    this.resumeWaiter = null;
    if (resume) resume();
    const sleep = this.sleepWaiter;
    if (sleep) sleep();
  }

  /** await 越しに並行更新される state の比較を、TS の制御フロー絞り込みから隔離する */
  private isInState(state: RunnerState): boolean {
    return this.state === state;
  }

  private emitStatus(): void {
    this.emit('status', this.status);
  }

  private log(level: LogEntry['level'], message: string): void {
    const entry: LogEntry = { level, message, ts: new Date().toISOString() };
    this.emit('log', entry);
  }
}

/** 1 ターンの種類: 通常 / まとめ(最後の 2 ターン)。phase は進行役の段階、messageTurn は {message} に使う相手の返答のターン */
export interface TurnStep {
  kind: 'normal' | 'closing';
  phase: 'early' | 'middle' | 'late' | 'closing';
  /** {message} に使う返答のターン番号(1 始まり)。1 ターン目は 0(無し) */
  messageTurn: number;
}

/**
 * 進行役の計画。まとめは最後の 2 ターン(両者 1 回ずつ)で、4 ターン未満なら無し。
 * 通常ターンは進み具合で 序盤(〜1/3)/ 中盤(〜2/3)/ 終盤 に分ける(まとめがある場合、終盤はまとめの直前まで)。
 * まとめの 2 人目の {message} は相手のまとめではなく、相手の最後の通常発言(= 2 ターン前… ではなく 3 ターン前)
 */
export function planTurns(maxTurns: number): TurnStep[] {
  const closingTurns = maxTurns >= 4 ? 2 : 0;
  const normalTurns = maxTurns - closingTurns;
  const steps: TurnStep[] = [];
  for (let turn = 1; turn <= maxTurns; turn++) {
    if (turn > normalTurns) {
      const first = turn === normalTurns + 1;
      // 1 人目: 直前(相手の最後の通常発言)。2 人目: 相手の最後の通常発言 = 3 ターン前
      steps.push({ kind: 'closing', phase: 'closing', messageTurn: first ? turn - 1 : turn - 3 });
      continue;
    }
    const progress = turn / normalTurns;
    const phase = progress <= 1 / 3 ? 'early' : progress <= 2 / 3 ? 'middle' : 'late';
    steps.push({ kind: 'normal', phase, messageTurn: turn - 1 });
  }
  return steps;
}
