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
  'runner.start': { ja: '議論を開始します: 「{topic}」(最大 {max} ターン)', en: 'Starting the debate: "{topic}" (up to {max} turns)' },
  'runner.preparing': { ja: '新しいチャットを準備しています(ChatGPT / Gemini)', en: 'Opening new chats (ChatGPT / Gemini)' },
  'runner.prepareFailed': { ja: '新規チャットの準備に失敗しました: {error}', en: 'Failed to open new chats: {error}' },
  'runner.send': { ja: '送信 → {name}', en: 'Sending → {name}' },
  'runner.rateLimited': {
    ja: '{name} がレート制限中のため一時停止しました。再開すると同じターンを再試行します',
    en: '{name} is rate limited; paused. Resume to retry the same turn',
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
  'chat.stopCleared': { ja: '{name} に残っていた生成状態を解除しました', en: 'Cleared a stale generating state on {name}' },
  'chat.retrySend': { ja: '{name} への送信を再試行します({attempt}/{max} 回目)', en: 'Retrying send to {name} ({attempt}/{max})' },
  'chat.sendNotStarted': { ja: '{name} への送信が開始しません', en: 'Sending to {name} did not start' },
  'chat.resend': { ja: '{name} の{why}。送信をやり直します', en: '{name}: {why}. Sending again' },
  'chat.noResponseAfterRetries': {
    ja: '{name} への送信が {max} 回とも応答に至りませんでした',
    en: 'Sending to {name} got no response in {max} attempts',
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
