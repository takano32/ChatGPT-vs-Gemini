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
  loggedInProbe: string; // ログイン済みのときだけ存在(DOM。送信準備の判定に使う)
  loggedOutProbe: string; // 未ログインのときだけ存在
  rateLimitPatterns: string[]; // 本文に現れる制限文言(ja/en 両方)
  // 応答の代わりにエラー吹き出しが応答要素として描画されたときの文言(ja/en)。
  // 実測: ChatGPT は会話リクエストが失敗すると assistant ロールの要素に
  // 「Something went wrong. … Retry」を描画する。これを回答として中継しないための判定に使う。
  errorPatterns: string[];
  // 認証判定用のセッション Cookie。DOM は遷移中に一瞬消えてブレるため、
  // ロックや状態表示の「ログイン済み」判定にはこの Cookie の有無を使う(安定)。
  authCookiePrefix: string;
  authCookieDomain: string;
}

// ChatGPT は data-testid が言語非依存で安定。実測で確認済み。
// 注意: 送信ボタンと停止ボタンは同一要素(#composer-submit-button)の
// data-testid が send-button ⇄ stop-button とトグルする。ストリーミングが
// 綺麗に閉じないと stop-button が残ることがあるため、完了検知はテキスト安定を
// 主指標にする(Chat.ts 参照)。
export const CHATGPT_SELECTORS: SiteSelectors = {
  url: 'https://chatgpt.com/',
  partition: 'persist:chatgpt',
  input: '#prompt-textarea', // div.ProseMirror[contenteditable]
  sendButton: 'button[data-testid="send-button"]',
  stopButton: 'button[data-testid="stop-button"]',
  assistantMessages: '[data-message-author-role="assistant"]',
  loggedInProbe: '#prompt-textarea',
  loggedOutProbe: '[data-testid="login-button"]', // 要実機調整(未ログイン時のみ検証未)
  rateLimitPatterns: [
    'You have reached',
    'You’ve reached',
    '上限に達しました',
    'Too many requests',
    'unusual activity',
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
  loggedInProbe: 'rich-textarea',
  loggedOutProbe: 'a[href*="ServiceLogin"]',
  rateLimitPatterns: ['しばらくしてからもう一度', 'try again later', '上限に達しました'],
  errorPatterns: ['問題が発生しました', 'Something went wrong', 'もう一度お試しください'],
  authCookiePrefix: '__Secure-1PSID', // 実測: @.google.com(Google セッション)
  authCookieDomain: 'google.com',
};
