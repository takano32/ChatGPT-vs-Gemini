// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// main プロセスが出す文言(ログ・通知・エラー・ダイアログ)の日本語 / 英語表。2 言語だけ(他は対応しない)。
// 現在の言語はモジュール変数で持ち、Application が設定の読込時と変更時に setMainLang() で合わせる。
// renderer 側の文言は別表(src/renderer/i18n.ts。renderer ビルドは shared を import できないため)。

import type { Lang } from './types';

type Table = Record<string, { ja: string; en: string }>;

const STRINGS: Table = {
  // ---- Runner ----
  'runner.alreadyRunning': { ja: '議論は既に実行中です', en: 'A debate is already running' },
  'runner.createFailed': { ja: '会話の作成に失敗しました: {error}', en: 'Failed to create the conversation: {error}' },
  'runner.start': { ja: '議論を開始します: 「{topic}」({mode}、最大 {max} ターン)', en: 'Starting the debate: "{topic}" ({mode}, up to {max} turns)' },
  'runner.resumeFrom': {
    ja: '議論を続きから再開します: 「{topic}」({mode}、{turn} ターン目から、最大 {max} ターン)',
    en: 'Resuming the debate: "{topic}" ({mode}, from turn {turn}, up to {max} turns)',
  },
  'runner.cannotResume': {
    ja: '続きから再開できません(停止またはエラーで止まった、上限に達していない会話だけ再開できます)',
    en: 'Cannot resume (only a conversation that stopped or errored before reaching its turn limit can be resumed)',
  },
  'runner.preparing': { ja: '新しいチャットを準備しています(ChatGPT / Gemini)', en: 'Opening new chats (ChatGPT / Gemini)' },
  'runner.prepareFailed': { ja: '新規チャットの準備に失敗しました: {error}', en: 'Failed to open new chats: {error}' },
  'runner.send': { ja: '送信 → {name}', en: 'Sending → {name}' },
  'runner.cooldown': {
    ja: '{name} がレート制限中です。{seconds} 秒待って同じターンを再試行します({attempt}/{max} 回目)',
    en: '{name} is rate limited. Waiting {seconds} s, then retrying the same turn ({attempt}/{max})',
  },
  'runner.rateLimited': {
    ja: '{name} のレート制限が {max} 回待っても解除されないため一時停止しました。しばらくしてから「再開」を押すと同じターンを再試行します',
    en: '{name} stayed rate limited after {max} waits; paused. Press Resume later to retry the same turn',
  },
  'runner.stopped': { ja: '議論を停止しました', en: 'Debate stopped' },
  'runner.aborted': { ja: 'エラーで中断しました: {error}', en: 'Aborted on error: {error}' },
  'runner.saveFailed': { ja: '会話の保存に失敗しました: {error}', en: 'Failed to save the message: {error}' },
  'runner.done': { ja: '議論が完了しました(全 {turns} ターン)', en: 'Debate finished ({turns} turns)' },
  'runner.paused': {
    ja: '一時停止しました(実行中のターンは完了まで継続します)',
    en: 'Paused (the current turn runs to completion)',
  },
  'runner.resumed': { ja: '議論を再開しました', en: 'Debate resumed' },
  'runner.statusSaveFailed': { ja: '会話状態の保存に失敗しました: {error}', en: 'Failed to save the conversation status: {error}' },

  // ---- Chat(自己修復の通知とエラー) ----
  'chat.dismissedLogin': {
    ja: '{name} のログイン要求ダイアログを閉じました(ログインなしで続行)',
    en: 'Closed the login prompt on {name} (continuing without login)',
  },
  'chat.newChatFailed': { ja: '新規チャットの準備ができません: {name}', en: 'Cannot open a new chat: {name}' },
  'chat.noInput': {
    ja: '{name} の入力欄が見つかりません。下のパネルでページの状態を確認してください',
    en: 'No input box found on {name}. Check the page in the pane below',
  },
  'chat.stopStuck': {
    ja: '{name} の停止ボタンが消えません。応答の有無だけで判定します',
    en: "{name}'s stop button will not go away; judging by the response alone",
  },
  'chat.stopStuckReload': {
    ja: '{name} の停止ボタンが消えないため、ページを読み込み直してから送ります',
    en: "{name}'s stop button will not go away; reloading the page before sending",
  },
  'chat.timeoutReload': {
    ja: '{name} の応答が時間内に来ないため、ページを読み込み直してから同じ内容を送り直します',
    en: "{name}'s response did not arrive in time; reloading the page and sending again",
  },
  'chat.stopCleared': { ja: '{name} に残っていた生成状態を解除しました', en: 'Cleared a stale generating state on {name}' },
  'chat.retrySend': { ja: '{name} への送信を再試行します({attempt}/{max} 回目)', en: 'Retrying send to {name} ({attempt}/{max})' },
  'chat.sendNotStarted': {
    ja: '{name} への送信が開始しません。{hint}',
    en: 'Sending to {name} did not start. {hint}',
  },
  'chat.resend': { ja: '{name} の{why}。送信をやり直します', en: '{name}: {why}. Sending again' },
  'chat.noResponseAfterRetries': {
    ja: '{name} への送信が {max} 回とも応答に至りませんでした。{hint}',
    en: 'Sending to {name} got no response in {max} attempts. {hint}',
  },
  'chat.selectorHint': {
    ja: '下のパネルで {name} の画面を確認してください。何度も続くならサイトの画面が変わった可能性があります(GitHub の Issue で報告してください)',
    en: "Check {name}'s page in the pane below. If it keeps happening, the site layout may have changed (please report it in a GitHub issue)",
  },
  'chat.why.noResponse': { ja: '応答が現れません', en: 'no response appeared' },
  'chat.why.errorResponse': { ja: '応答がエラーでした', en: 'the response was an error' },
  'chat.why.emptyResponse': { ja: '応答が空でした', en: 'the response was empty' },
  'chat.noPageState': { ja: '{name} のページ状態を取得できません', en: 'Cannot read the page state of {name}' },
  'chat.responseNotClosed': {
    ja: '{name} の応答が閉じないため、得られた本文で続行します',
    en: "{name}'s response did not finish; continuing with the text obtained",
  },

  // ---- Layout(読込失敗・クラッシュ・ハング・証明書) ----
  'layout.loadGaveUp': {
    ja: '{name} のページを {max} 回再読込しても読み込めませんでした({reason})。自動の再読込をやめます。ネットワークを確認し、アプリを終了して起動し直してください',
    en: '{name} still failed to load after {max} reloads ({reason}). Giving up automatic reloads. Check the network, then quit and restart the app',
  },
  'layout.loadRetry': {
    ja: '{name} のページを読み込めませんでした({reason})。{delay} 秒後に再読込します({n}/{max} 回目)',
    en: '{name} failed to load ({reason}). Reloading in {delay} s ({n}/{max})',
  },
  'layout.crashLoop': {
    ja: '{name} の画面が {window} 秒間に {count} 回止まりました({reason})。しばらく再読込を見合わせます。続くようならアプリを終了して起動し直してください',
    en: '{name} crashed {count} times within {window} s ({reason}). Holding off reloads for a while. If it keeps happening, quit and restart the app',
  },
  'layout.crashReload': {
    ja: '{name} の画面が予期せず終了しました({reason})。{delay} 秒後に読み込み直します',
    en: '{name} crashed unexpectedly ({reason}). Reloading in {delay} s',
  },
  'layout.hangReload': {
    ja: '{name} の画面が {seconds} 秒以上応答しないため、読み込み直します',
    en: '{name} has not responded for {seconds} s; reloading',
  },
  'layout.certError': {
    ja: '{name} の証明書エラー({error})のため、このページの表示を中止しました。パソコンの日時や Wi-Fi の利用登録を確認してください',
    en: 'Stopped loading {name} because of a certificate error ({error}). Check the computer clock and any Wi-Fi sign-in page',
  },

  // ---- モード名(shared/modes.ts の Mode と同じキー。renderer 側は src/renderer/i18n.ts に別表) ----
  'mode.debate': { ja: '対立', en: 'Debate' },
  'mode.collab': { ja: '協調', en: 'Collaboration' },
  'mode.brainstorm': { ja: 'ブレスト', en: 'Brainstorm' },
  'mode.dialectic': { ja: '弁証法', en: 'Dialectic' },
  'mode.relay': { ja: 'リレー創作', en: 'Story relay' },
  'mode.review': { ja: '批評', en: 'Review' },
  'mode.interview': { ja: '対談', en: 'Interview' },
  'mode.socratic': { ja: '師弟', en: 'Socratic' },
  'mode.devil': { ja: '悪魔の代弁者', en: "Devil's advocate" },
  'mode.quiz': { ja: 'クイズ', en: 'Quiz' },
  'mode.roleplay': { ja: 'ロールプレイ', en: 'Roleplay' },

  // ---- その他 ----
  'app.startupError': { ja: '起動エラー', en: 'Startup error' },
  'md.untitled': { ja: '議論', en: 'Debate' },
};

let current: Lang = 'ja';

export function mainLang(): Lang {
  return current;
}

export function setMainLang(lang: Lang): void {
  current = lang;
}

/** 現在の言語で文言を取る。{name} は vars で置換。キーが無ければキーをそのまま返す */
export function tm(key: string, vars?: Record<string, string | number>): string {
  const entry = STRINGS[key];
  let text = entry ? entry[current] : key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}
