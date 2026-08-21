// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// 2 サイトの DOM 知識はこのファイルに集約する。
// 以下のセレクタは 2026-08-21 にログイン済みの実 UI を CDP で実測して確定した値。
// 構造が変わったらここだけ直す。

export interface SiteSelectors {
  url: string;
  partition: string;
  input: string; // contenteditable な入力欄
  sendButton: string;
  stopButton: string; // ストリーミング中のみ存在/表示
  assistantMessages: string; // AI 応答メッセージ要素(全件)
  // 応答要素の中で本文だけを持つ要素(省略時は応答要素全体の innerText)。読み上げ用ラベルや
  // 操作ボタンの文言が本文に混ざるサイト/変種で指定する。
  messageContent?: string;
  // ゲスト(未ログイン)利用中にサイトが出すログイン要求ダイアログを閉じるボタンの文言(部分一致、大小無視)。
  // 両サイトともログインなしで使える(2026-08-21 実測)。ダイアログは実測では出なかったが備えておく。
  dismissPatterns: string[];
  // ゲスト(未ログイン)利用中にサイトが出す勧誘要素のうち、隠してよいものの文言(部分一致、大小無視)。
  // 文言を含む最小のカード/トーストを display:none にする。ログインの入口(ヘッダーのボタン)は対象にしない。
  hidePatterns: string[];
  rateLimitPatterns: string[]; // 本文に現れる制限文言(ja/en 両方)
  // 応答の代わりにエラー吹き出しが応答要素として描画されたときの文言(ja/en)。
  // 実測: ChatGPT は会話リクエストが失敗すると assistant ロールの要素に
  // 「Something went wrong. … Retry」を描画する。これを回答として中継しないための判定に使う。
  errorPatterns: string[];
  // ログイン状態の表示用セッション Cookie(ログインは任意。判定が DOM より安定)。
  authCookiePrefix: string;
  authCookieDomain: string;
}

// ChatGPT は data-testid が言語非依存で安定。実測で確認済み。
// 注意: 送信ボタンと停止ボタンは同一要素(#composer-submit-button)の
// data-testid が send-button ⇄ stop-button とトグルする。ストリーミングが
// 綺麗に閉じないと stop-button が残ることがあるため、完了検知はテキスト安定を
// 主指標にする(Chat.ts 参照)。
// 2026-08-21 実測: 未ログインの一部セッションには別の DOM 変種(data-testid="desktop-app-shell"、
// textarea#mobile-composer-prompt、li[data-message-role]、ボタンは aria-label のみ)が配信される。
// 各セレクタは CSS のリストで両変種を受ける(querySelector は最初に見つかった方を使う)。
export const CHATGPT_SELECTORS: SiteSelectors = {
  url: 'https://chatgpt.com/',
  partition: 'persist:chatgpt',
  input: '#prompt-textarea, #mobile-composer-prompt', // div.ProseMirror[contenteditable] / 変種は textarea
  // 変種側は aria-label(英語)にしか手掛かりが無い。匿名 UI は日本語環境でも英語で配信される(実測)。
  sendButton: 'button[data-testid="send-button"], button[aria-label="Send message"]',
  stopButton: 'button[data-testid="stop-button"], button[aria-label="Stop generating"]',
  assistantMessages: '[data-message-author-role="assistant"], li[data-message-role="assistant"]',
  messageContent: '.markdown, [data-assistant-markdown]', // 変種の li は読み上げ用「ChatGPT said:」を含むため本文だけ取る
  dismissPatterns: ['Stay logged out', 'ログアウトしたまま', 'ログインせずに'],
  // 実測(2026-08-21): 一時的に出るトースト「You'll get smarter responses…」だけを隠す。
  // サイドバーのカード「Get responses tailored to you」とヘッダーの「Log in」「Sign up for free」は残す
  // (サイドバーを触るとレイアウトが崩れる。ログインの入口でもある)
  hidePatterns: ['smarter responses'],
  rateLimitPatterns: [
    'You have reached',
    'You’ve reached',
    '上限に達しました',
    'Too many requests',
    'unusual activity',
    // ゲストの送信上限(2026-08-21 実測): 「Message limit reached / You have reached the anonymous message limit.」
    // 入力欄が disabled になり、応答要素は空のまま残る
    'anonymous message limit',
    'Message limit reached',
  ],
  errorPatterns: ['Something went wrong', '問題が発生しました', 'エラーが発生しました'],
  authCookiePrefix: '__Secure-next-auth.session-token', // 実測: @.chatgpt.com
  authCookieDomain: 'chatgpt.com',
};

// Gemini は Angular Material。data-testid が無いため aria-label を主に、
// 言語非依存の mat-icon[fonticon] をフォールバックにする(:has() は Chromium 対応済み)。
// aria-label は UI ロケール依存(この環境は日本語)。他ロケールでは fonticon 側が効く。
export const GEMINI_SELECTORS: SiteSelectors = {
  url: 'https://gemini.google.com/app',
  partition: 'persist:gemini',
  input: 'rich-textarea .ql-editor', // Quill エディタ
  sendButton: 'button[aria-label="プロンプトを送信"], button:has(mat-icon[fonticon="arrow_upward"])',
  stopButton: 'button[aria-label="回答を停止"], button:has(mat-icon[fonticon="stop"])',
  assistantMessages: 'message-content', // 応答のみ(ユーザ発言は別要素)
  dismissPatterns: ['Not now', '後で', 'ログインせずに', 'Continue without'],
  hidePatterns: [], // 実測では常設の勧誘はヘッダーの「Sign in」のみ(残す)
  rateLimitPatterns: ['しばらくしてからもう一度', 'try again later', '上限に達しました'],
  errorPatterns: ['問題が発生しました', 'Something went wrong', 'もう一度お試しください'],
  authCookiePrefix: '__Secure-1PSID', // 実測: @.google.com(Google セッション)
  authCookieDomain: 'google.com',
};
