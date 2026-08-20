// 議論エンジン。2 つの Chat を交互に叩き、応答を中継しながら Repository に記録する。
// 制約: start() は同時に 1 本のみ。pause 中の stop() は resume より優先される。

import { EventEmitter } from 'events';
import {
  SPEAKER_LABELS,
  opponentOf,
  type LogEntry,
  type MessageRecord,
  type RunnerState,
  type RunnerStatus,
  type SettingsData,
  type Speaker,
} from '../shared/types';
import { Conversation } from './Conversation';
import type { Repository } from './Repository';
import { ChatError, type Chat } from '../chat/Chat';
import type { Settings } from '../manager/Settings';

type DebateConfig = SettingsData['debate'];

interface RunnerDeps {
  chats: Record<Speaker, Chat>;
  repository: Repository;
  settings: Settings;
}

export class Runner extends EventEmitter {
  private readonly chats: Record<Speaker, Chat>;
  private readonly repository: Repository;
  private readonly settings: Settings;

  private state: RunnerState = 'idle';
  private conversation: Conversation | null = null;
  private debate: DebateConfig | null = null;
  private lastError: string | undefined;

  // 世代トークン。stop 直後に start された場合、旧ループの残骸を無効化する
  private runId = 0;
  private stopRequested = false;
  private pauseRequested = false;

  private currentSpeaker: Speaker | null = null;
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
    return status;
  }

  async start(topic: string, maxTurnsOverride?: number): Promise<void> {
    if (this.state === 'running' || this.state === 'paused') {
      this.log('warn', '議論は既に実行中です');
      return;
    }

    const myRun = ++this.runId;
    this.stopRequested = false;
    this.pauseRequested = false;
    this.lastError = undefined;
    this.resumeWaiter = null;
    this.sleepWaiter = null;

    // 前回 stop した ask が未決着なら決着を待つ(Chat の busy ガード対策)
    if (this.inFlightAsk) {
      await this.inFlightAsk.catch(() => {});
      this.inFlightAsk = null;
      if (this.runId !== myRun) return;
    }

    // 設定は開始時に 1 回だけ読む(途中変更は次回から反映)。
    // maxTurns はそのラン用の上書きがあれば優先(操作バーの一時値。保存はしない)。
    const base = this.settings.get().debate;
    const debate: DebateConfig =
      typeof maxTurnsOverride === 'number' && maxTurnsOverride >= 1
        ? { ...base, maxTurns: Math.floor(maxTurnsOverride) }
        : base;
    this.debate = debate;

    this.state = 'running';
    let conversation: Conversation;
    try {
      conversation = new Conversation(this.repository.createConversation(topic));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.state = 'error';
      this.lastError = message;
      this.emitStatus();
      this.log('error', `会話の作成に失敗しました: ${message}`);
      return;
    }
    this.conversation = conversation;
    this.emitStatus();
    this.log('info', `議論を開始します: 「${topic}」(最大 ${debate.maxTurns} ターン)`);

    // 議論ごとに両サイトで新規チャットを開き、前の議論の文脈を持ち越さない
    this.log('info', '新しいチャットを準備しています(ChatGPT / Gemini)');
    try {
      await Promise.all([this.chats.chatgpt.newChat(), this.chats.gemini.newChat()]);
    } catch (err) {
      if (this.runId !== myRun || this.stopRequested) return;
      const message = err instanceof Error ? err.message : String(err);
      this.state = 'error';
      this.lastError = message;
      this.setConversationStatus('error');
      this.emitStatus();
      this.log('error', `新規チャットの準備に失敗しました: ${message}`);
      return;
    }
    if (this.runId !== myRun || this.stopRequested) return;

    let prevReply = '';

    for (let turn = 1; turn <= debate.maxTurns; turn++) {
      const speaker: Speaker = turn % 2 === 1 ? debate.firstSpeaker : opponentOf(debate.firstSpeaker);
      const opponentLabel = SPEAKER_LABELS[opponentOf(speaker)];
      let prompt: string;
      if (turn === 1) {
        prompt = this.render(debate.openingTemplate, { topic, opponent: opponentLabel });
      } else if (turn === 2) {
        prompt = this.render(debate.counterTemplate, { topic, opponent: opponentLabel, message: prevReply });
      } else {
        prompt = this.render(debate.relayTemplate, { opponent: opponentLabel, message: prevReply });
      }

      let sent = false;
      while (!sent) {
        if (this.runId !== myRun) return;
        if (this.stopRequested) return; // 終了処理は stop() 側で済んでいる
        if (this.pauseRequested) {
          await this.waitForResume();
          continue; // 再開後に stop を再チェック
        }

        const chat = this.chats[speaker];
        this.log('info', '送信 → ' + chat.displayName);
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
            this.state = 'paused';
            this.setConversationStatus('paused');
            this.emitStatus();
            this.log('warn', `${chat.displayName} がレート制限中のため一時停止しました。再開すると同じターンを再試行します`);
            await this.waitForResume();
            continue; // 同一ターンを再試行(ターンは進めない)
          }
          if (err instanceof ChatError && err.code === 'stopped') {
            // stop() が state を並行に書き換えるため、直接比較すると TS が過剰に絞り込む
            if (!this.isInState('stopped')) {
              this.state = 'stopped';
              this.setConversationStatus('stopped');
              this.emitStatus();
              this.log('info', '議論を停止しました');
            }
            return;
          }
          const message = err instanceof Error ? err.message : String(err);
          this.state = 'error';
          this.lastError = message;
          this.setConversationStatus('error');
          this.emitStatus();
          this.log('error', `エラーで中断しました: ${message}`);
          return;
        }
        this.askInFlight = false;
        this.inFlightAsk = null;
        this.currentSpeaker = null;
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
          this.log('error', `会話の保存に失敗しました: ${message}`);
          return;
        }
        conversation.addMessage(record);
        this.emit('message', record);
        this.emitStatus();
        prevReply = reply;
        sent = true;
      }

      if (turn < debate.maxTurns) {
        await this.sleep(debate.betweenTurnsMs);
        if (this.runId !== myRun) return;
      }
    }

    if (this.runId !== myRun || this.stopRequested) return;
    this.state = 'done';
    this.setConversationStatus('done');
    this.emitStatus();
    this.log('info', `議論が完了しました(全 ${conversation.turnCount} ターン)`);
  }

  stop(): void {
    if (this.state !== 'running' && this.state !== 'paused') return;
    this.stopRequested = true;
    this.pauseRequested = false;
    const inFlightSpeaker = this.askInFlight ? this.currentSpeaker : null;

    this.state = 'stopped';
    this.setConversationStatus('stopped');
    this.emitStatus();
    this.log('info', '議論を停止しました');

    this.wakeAll();
    if (inFlightSpeaker) {
      this.chats[inFlightSpeaker].stop();
    }
  }

  pause(): void {
    if (this.state !== 'running') return;
    this.pauseRequested = true;
    this.state = 'paused';
    this.setConversationStatus('paused');
    this.emitStatus();
    this.log('info', '一時停止しました(実行中のターンは完了まで継続します)');
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.pauseRequested = false;
    this.state = 'running';
    this.setConversationStatus('running');
    this.emitStatus();
    this.log('info', '議論を再開しました');
    const waiter = this.resumeWaiter;
    this.resumeWaiter = null;
    if (waiter) waiter();
  }

  private render(
    template: string,
    vars: { topic?: string; opponent?: string; message?: string },
  ): string {
    return template
      .replaceAll('{topic}', vars.topic ?? '')
      .replaceAll('{opponent}', vars.opponent ?? '')
      .replaceAll('{message}', vars.message ?? '');
  }

  private setConversationStatus(status: Conversation['status']): void {
    if (!this.conversation) return;
    this.conversation.status = status;
    try {
      this.repository.setConversationStatus(this.conversation.id, status);
    } catch (err) {
      // 状態遷移自体は続行し、永続化失敗のみ通知する
      this.log('warn', `会話状態の保存に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
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
