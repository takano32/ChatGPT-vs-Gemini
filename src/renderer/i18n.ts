// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// 管理ペイン・経過表示の画面文言(日本語 / 英語の 2 言語だけ。他の言語は対応しない。2026-08-23 利用者の決定)。
// main 側の文言表(src/shared/i18n.ts)とは別に持つ(main と renderer で文言の用途が違うため)。
// 静的な文言は HTML の data-i18n / data-i18n-title / data-i18n-placeholder / data-i18n-aria 属性にキーを書き、
// applyI18n() で差し替える。動的な文言は t(key, vars) で取る。

import type { Lang } from '../shared/types';
export type { Lang };

type Table = Record<string, { ja: string; en: string }>;

const STRINGS: Table = {
  // ---- ヘッダ ----
  'menu': { ja: 'サイドパネル(設定 / 履歴 / 検索)(Ctrl+B)', en: 'Side panel (settings / history / search) (Ctrl+B)' },
  'btn.pause.title': { ja: '一時停止(Space)', en: 'Pause (Space)' },
  'btn.resume.title': { ja: '再開(Space)', en: 'Resume (Space)' },
  'guest': { ja: 'ゲスト', en: 'guest' },
  'guest.title': { ja: 'ログインなしで利用中', en: 'Using without login' },
  'view.transcript': { ja: '経過', en: 'Transcript' },
  'view.live': { ja: 'ライブ', en: 'Live' },
  'view.toggle.title': { ja: 'ライブ表示と経過表示を切り替え', en: 'Switch between live and transcript views' },
  'lang.title': { ja: '言語(画面・ログ・プロンプト)', en: 'Language (UI, log and prompts)' },

  // ---- 操作バー ----
  'topic.placeholder': {
    ja: '議論テーマを入力…(複数行可。Ctrl+Enter で開始)',
    en: 'Enter a debate topic… (multi-line; Ctrl+Enter to start)',
  },
  'mode.label': { ja: 'モード', en: 'Mode' },
  'mode.title': {
    ja: '議論の進め方(この議論だけ。起動時は常に「対立」)。括弧は先攻 / 後攻の役割',
    en: 'How the two AIs interact (this debate only; starts as Debate on every launch). Parentheses: roles of first / second speaker',
  },
  'mode.debate': { ja: '対立', en: 'Debate' },
  'mode.collab': { ja: '協調', en: 'Collaboration' },
  'mode.brainstorm': { ja: 'ブレスト', en: 'Brainstorm' },
  'mode.dialectic': { ja: '弁証法', en: 'Dialectic' },
  'mode.relay': { ja: 'リレー創作', en: 'Story relay' },
  'mode.review': { ja: '批評(作者 / 評者)', en: 'Review (author / reviewer)' },
  'mode.interview': { ja: '対談(聞き手 / 語り手)', en: 'Interview (interviewer / guest)' },
  'mode.socratic': { ja: '師弟(先生 / 生徒)', en: 'Socratic (teacher / student)' },
  'mode.devil': { ja: '悪魔の代弁者(主張 / 反対)', en: "Devil's advocate (claim / oppose)" },
  'mode.quiz': { ja: 'クイズ(解答 / 出題)', en: 'Quiz (contestant / quizmaster)' },
  'mode.roleplay': { ja: 'ロールプレイ', en: 'Roleplay' },
  'mode.roleplay.option': { ja: 'ロールプレイ(役割を入力)', en: 'Roleplay (enter the roles)' }, // 選択肢だけ説明付き(経過表示では素の名前)
  'role.chatgpt.ph': { ja: 'ChatGPT の役割(例: 刑事)', en: "ChatGPT's role (e.g. detective)" },
  'role.gemini.ph': { ja: 'Gemini の役割(例: 容疑者)', en: "Gemini's role (e.g. suspect)" },
  'log.rolesRequired': { ja: 'ロールプレイでは両方の役割を入力してください', en: 'Roleplay needs a role for both AIs' },
  'first.label': { ja: '先攻', en: 'First' },
  'first.title': {
    ja: '先に発言する AI(この議論だけ。既定は設定の「先攻」)',
    en: 'Which AI speaks first (this debate only; the default is in Settings)',
  },
  'turns.label': { ja: 'ターン', en: 'Turns' },
  'turns.title': { ja: '最大ターン数(▲▼で変更)', en: 'Maximum turns (change with ▲▼)' },
  'turns.aria': { ja: '最大ターン数', en: 'Maximum turns' },
  'turns.up': { ja: 'ターン数を増やす', en: 'More turns' },
  'turns.down': { ja: 'ターン数を減らす', en: 'Fewer turns' },
  'btn.start': { ja: '開始', en: 'Start' },
  'btn.start.title': { ja: '議論を開始(Ctrl+Enter)', en: 'Start the debate (Ctrl+Enter)' },
  'btn.pause': { ja: '一時停止', en: 'Pause' },
  'btn.resume': { ja: '再開', en: 'Resume' },
  'btn.stop': { ja: '停止', en: 'Stop' },
  'close': { ja: '閉じる', en: 'Close' },
  'divider.title': {
    ja: 'ドラッグで管理ペインとチャットペインの比率を変える',
    en: 'Drag to resize the control pane and the chat panes',
  },

  // ---- LED のツールチップ・バナー ----
  'led.loading': { ja: '読み込み中', en: 'Loading' },
  'led.notChat': { ja: 'ChatGPT / Gemini の画面になっていません', en: 'Not showing the ChatGPT / Gemini chat screen' },
  'led.rateLimited': { ja: 'レート制限中', en: 'Rate limited' },
  'led.loggedIn': { ja: 'ログイン済み', en: 'Logged in' },
  'led.guest': { ja: 'ゲスト(ログインなしで利用中)', en: 'Guest (using without login)' },
  'banner.stuck': { ja: '{names} が ChatGPT / Gemini の画面になっていません', en: '{names}: not showing the chat screen' },
  'banner.stuck.hint': {
    ja: 'ログイン中なら完了後に戻ります。戻らなければ下のパネルで確認してください',
    en: 'If you are logging in, it returns when done. Otherwise check the pane below',
  },
  'banner.noInput': { ja: '{names} の画面に入力欄が見つかりません', en: '{names}: no input box on the page' },
  'banner.noInput.hint': {
    ja: '下のパネルに同意や確認の画面が出ていればそれに従ってください。何も出ていなければサイトの画面が変わった可能性があります(再読込しても直らなければ GitHub の Issue で報告してください)',
    en: 'If the pane below shows a consent or verification screen, follow it. Otherwise the site layout may have changed (if reloading does not help, please report it in a GitHub issue)',
  },
  'banner.guest': { ja: '{names} はログインなしで使えます', en: '{names} can be used without logging in' },
  'banner.guest.hint': {
    ja: 'ログインすると、会話がサイト側の履歴に残り、利用制限が緩くなることがあります',
    en: 'Logging in may keep the chats in the site history and relax usage limits',
  },
  'banner.guest.hint.locked': { ja: '(停止後に下のパネルでログインできます)', en: ' (log in from the pane below after stopping)' },
  'banner.guest.hint.idle': { ja: '(下のパネルでログイン)', en: ' (log in from the pane below)' },
  'names.join': { ja: ' と ', en: ' and ' },

  // ---- ローカルログ ----
  'log.started': { ja: '管理パネル起動', en: 'Control panel started' },
  'log.topicRequired': { ja: 'テーマを入力してください', en: 'Enter a topic' },
  'log.startFailed': { ja: '開始失敗: {error}', en: 'Failed to start: {error}' },
  'log.pauseFailed': { ja: '一時停止失敗: {error}', en: 'Failed to pause: {error}' },
  'log.resumeFailed': { ja: '再開失敗: {error}', en: 'Failed to resume: {error}' },
  'log.stopFailed': { ja: '停止失敗: {error}', en: 'Failed to stop: {error}' },
  'log.toggleFailed': { ja: '表示切替失敗: {error}', en: 'Failed to switch views: {error}' },
  'log.settingsLoadFailed': { ja: '設定読込失敗: {error}', en: 'Failed to load settings: {error}' },
  'log.settingsSaveFailed': { ja: '設定保存失敗: {error}', en: 'Failed to save settings: {error}' },
  'log.initFailed': { ja: '初期化失敗: {error}', en: 'Initialization failed: {error}' },
  'log.langFailed': { ja: '言語の切替に失敗しました: {error}', en: 'Failed to switch language: {error}' },

  // ---- ドロワー ----
  'drawer.aria': { ja: '管理メニュー', en: 'Control menu' },
  'tab.settings': { ja: '設定', en: 'Settings' },
  'tab.history': { ja: '履歴', en: 'History' },
  'tab.search': { ja: '検索', en: 'Search' },
  'set.maxTurns': { ja: '最大ターン数', en: 'Max turns' },
  'set.firstSpeaker': { ja: '先攻', en: 'First speaker' },
  'set.mode': { ja: '編集するモード', en: 'Mode to edit' },
  'set.betweenTurns': { ja: 'ターン間隔 (ms)', en: 'Gap between turns (ms)' },
  'set.poll': { ja: 'ポーリング (ms)', en: 'Polling (ms)' },
  'set.stability': { ja: '安定判定 (ms)', en: 'Stability (ms)' },
  'set.timeout': { ja: 'タイムアウト (ms)', en: 'Timeout (ms)' },
  'set.adminRatio': { ja: '管理ペイン比 (0-1)', en: 'Control pane ratio (0-1)' },
  'set.chatSplit': { ja: 'ChatGPT 幅比 (0-1)', en: 'ChatGPT width ratio (0-1)' },
  'set.chatZoom': { ja: 'チャット表示倍率 (0.25-3)', en: 'Chat zoom (0.25-3)' },
  'set.opening': { ja: '開始テンプレート {topic} {opponent}', en: 'Opening template {topic} {opponent}' },
  'set.counter': { ja: '反論テンプレート {topic} {opponent} {message}', en: 'Counter template {topic} {opponent} {message}' },
  'set.relayFirst': { ja: '先攻の中継テンプレート {topic} {opponent} {message}', en: 'Relay template for the first speaker {topic} {opponent} {message}' },
  'set.relaySecond': { ja: '後攻の中継テンプレート {topic} {opponent} {message}', en: 'Relay template for the second speaker {topic} {opponent} {message}' },
  'set.closing': { ja: 'まとめテンプレート(最後の 2 ターン) {topic} {opponent} {message}', en: 'Closing template (last two turns) {topic} {opponent} {message}' },
  'set.timekeeperNote': {
    ja: '進行役: 毎ターンの先頭に付く一文。段階は序盤(〜1/3)・中盤(〜2/3)・終盤。言語ごとに保存',
    en: 'Timekeeper: a line prepended to every turn. Phases: early (to 1/3), middle (to 2/3), late. Stored per language',
  },
  'set.tkTemplate': { ja: '進行役の文 {turn} {max} {remaining} {phase}', en: 'Timekeeper line {turn} {max} {remaining} {phase}' },
  'set.tkEarly': { ja: '序盤の指示', en: 'Early-phase instruction' },
  'set.tkMiddle': { ja: '中盤の指示', en: 'Middle-phase instruction' },
  'set.tkLate': { ja: '終盤の指示', en: 'Late-phase instruction' },
  'set.templatesNote': {
    ja: 'テンプレートは言語 × モードごとに保存されます(いま表示しているのは {lang} / {mode})。上の「モード」を変えると切り替わります',
    en: 'Templates are stored per language and mode (showing {lang} / {mode}). Change "Mode" above to edit another set',
  },
  'set.save': { ja: '保存', en: 'Save' },
  'set.reset': { ja: '既定に戻す', en: 'Reset to defaults' },
  'set.reset.hint': {
    ja: '入力欄を既定値に戻す(「保存」を押すまで保存されない)',
    en: 'Fill the fields with the defaults (nothing is saved until you press Save)',
  },
  'set.resetFlash': { ja: '既定値を入れました(まだ保存していません)', en: 'Defaults filled in (not saved yet)' },
  'set.resetFailed': { ja: '既定値の取得に失敗しました: {error}', en: 'Failed to load the defaults: {error}' },
  'history.promptToggle': { ja: 'この発言へのプロンプト', en: 'Prompt for this message' },
  'set.saved': { ja: '保存しました', en: 'Saved' },
  'lang.ja': { ja: '日本語', en: 'Japanese' },
  'lang.en': { ja: '英語', en: 'English' },
  'history.back': { ja: '← 一覧', en: '← List' },
  'history.rename.hint': { ja: 'クリックで名前を変更', en: 'Click to rename' },
  'history.copy': { ja: 'コピー', en: 'Copy' },
  'history.resume': { ja: '続きから', en: 'Resume' },
  'history.resume.hint': { ja: '保存済みの発言の次のターンから、同じ会話に続けて再開', en: 'Continue this conversation from the turn after the last saved message' },
  'history.rematch': { ja: 'もう一度', en: 'Rematch' },
  'history.rematch.hint': { ja: 'いまの題名を議題に、同じモード・ターン数で先後を入れ替えて新しい議論を始める', en: 'Start a new debate with the current title as the topic, the same mode and turns, and the speaking order swapped' },
  'history.cannotStart': {
    ja: 'いまは開始できません(議論の実行中か、ChatGPT / Gemini の準備待ちです)',
    en: 'Cannot start now (a debate is running, or ChatGPT / Gemini is not ready yet)',
  },
  'history.resumeFailed': { ja: '続きから再開できませんでした', en: 'Could not resume' },
  'progress.turn': { ja: '{name} のターン', en: "{name}'s turn" },
  'progress.sep': { ja: ' ・ ', en: ' — ' },
  'progress.early': { ja: '序盤', en: 'early' },
  'progress.middle': { ja: '中盤', en: 'middle' },
  'progress.late': { ja: '終盤', en: 'late' },
  'progress.closing': { ja: 'まとめ', en: 'closing' },
  'history.copy.hint': { ja: 'Markdown をコピー', en: 'Copy as Markdown' },
  'history.copyFailed': { ja: 'コピーする発言がありません', en: 'No messages to copy' },
  'history.copied': { ja: 'Markdown をコピーしました', en: 'Copied as Markdown' },
  'history.delete': { ja: '削除', en: 'Delete' },
  'history.delete.hint': { ja: 'この会話を削除', en: 'Delete this conversation' },
  'history.gone': { ja: 'この会話は見つかりません(削除された可能性があります)', en: 'This conversation no longer exists (it may have been deleted)' },
  'history.deleted': { ja: '「{title}」を削除しました', en: 'Deleted "{title}"' },
  'history.undo': { ja: '取り消す', en: 'Undo' },
  'history.undone': { ja: '削除を取り消しました', en: 'Delete undone' },
  'history.undoFailed': { ja: '取り消せませんでした(猶予を過ぎています)', en: 'Could not undo (the grace period has passed)' },
  'history.deleteFailed': { ja: '削除できませんでした(議論中の会話は消せません)', en: 'Could not delete (a conversation in progress cannot be deleted)' },
  'history.renameFailed': { ja: '名前を変更できませんでした', en: 'Could not rename' },
  'history.loading': { ja: '読み込み中…', en: 'Loading…' },
  'history.empty': { ja: '履歴はまだありません', en: 'No history yet' },
  'history.loadFailed': { ja: '履歴読込失敗: {error}', en: 'Failed to load history: {error}' },
  'history.noMessages': { ja: 'メッセージがありません', en: 'No messages' },
  'history.messagesFailed': { ja: '読込失敗: {error}', en: 'Failed to load: {error}' },
  'search.placeholder': { ja: '全文検索…', en: 'Full-text search…' },
  'search.searching': { ja: '検索中…', en: 'Searching…' },
  'search.none': { ja: '該当なし', en: 'No matches' },
  'search.failed': { ja: '検索失敗: {error}', en: 'Search failed: {error}' },

  // ---- 経過表示 ----
  'tr.title': { ja: '議論の経過', en: 'Debate transcript' },
  'tr.status.title': { ja: '会話のステータス', en: 'Conversation status' },
  'tr.copy': { ja: 'Markdown をコピー', en: 'Copy as Markdown' },
  'tr.copied': { ja: 'コピーしました', en: 'Copied' },
  'tr.back': { ja: '← チャットに戻る', en: '← Back to chats' },
  'tr.back.title': { ja: 'ライブのチャット表示に戻る', en: 'Back to the live chat view' },
  'tr.placeholder': { ja: '議論が完了するとここに経過が表示されます。', en: 'The transcript appears here when a debate finishes.' },
  'tr.untitled': { ja: '(無題の議論)', en: '(untitled debate)' },
  'tr.empty': { ja: '発言はまだありません。', en: 'No messages yet.' },
  'cooldown.label': { ja: '制限待ち {seconds}s', en: 'cooldown {seconds}s' },
  'cooldown.title': { ja: '{name} がレート制限中。待ってから同じターンを再試行します({attempt}/{max} 回目)', en: '{name} is rate limited; retrying the same turn after the wait ({attempt}/{max})' },
  'status.running': { ja: '進行中', en: 'Running' },
  'status.paused': { ja: '一時停止', en: 'Paused' },
  'status.stopped': { ja: '停止', en: 'Stopped' },
  'status.error': { ja: 'エラー', en: 'Error' },
  'status.done': { ja: '完了', en: 'Done' },
};

let current: Lang = 'ja';

export function currentLang(): Lang {
  return current;
}

/** 言語を変えて、渡したルート以下の data-i18n 系属性を持つ要素を差し替える */
export function setLang(lang: Lang, root: ParentNode = document): void {
  current = lang;
  document.documentElement.lang = lang;
  applyI18n(root);
}

/** 文言を取る。{name} は vars で置換。キーが無ければキーをそのまま返す(取りこぼしが画面で分かる) */
export function t(key: string, vars?: Record<string, string | number>): string {
  const entry = STRINGS[key];
  let text = entry ? entry[current] : key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

/** data-i18n(textContent)/ data-i18n-title / data-i18n-placeholder / data-i18n-aria(aria-label)を現在の言語にする */
export function applyI18n(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n ?? '');
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle ?? '');
  for (const el of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-i18n-placeholder]')) {
    el.placeholder = t(el.dataset.i18nPlaceholder ?? '');
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAria ?? ''));
  }
}
