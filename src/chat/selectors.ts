// 2 サイトの DOM 知識はこのファイルに集約する。
// セレクタは全て現行 UI へのベストエフォート。構造が変わったらここだけ直す。

export interface SiteSelectors {
  url: string;
  partition: string;
  input: string; // contenteditable な入力欄
  sendButton: string;
  stopButton: string; // ストリーミング中のみ存在/表示
  assistantMessages: string; // AI 応答メッセージ要素(全件)
  loggedInProbe: string; // ログイン済みのときだけ存在
  loggedOutProbe: string; // 未ログインのときだけ存在
  rateLimitPatterns: string[]; // 本文に現れる制限文言(ja/en 両方)
}

export const CHATGPT_SELECTORS: SiteSelectors = {
  url: 'https://chatgpt.com/',
  partition: 'persist:chatgpt',
  input: '#prompt-textarea', // 要実機調整
  sendButton: 'button[data-testid="send-button"]', // 要実機調整
  stopButton: 'button[data-testid="stop-button"]', // 要実機調整
  assistantMessages: '[data-message-author-role="assistant"]', // 要実機調整
  loggedInProbe: '#prompt-textarea', // 要実機調整
  loggedOutProbe: '[data-testid="login-button"]', // 要実機調整
  rateLimitPatterns: [
    'You have reached',
    '上限に達しました',
    'Too many requests',
    'unusual activity',
  ],
};

export const GEMINI_SELECTORS: SiteSelectors = {
  url: 'https://gemini.google.com/app',
  partition: 'persist:gemini',
  input: 'rich-textarea .ql-editor', // Quill エディタ。要実機調整
  sendButton: 'button.send-button', // 要実機調整
  stopButton: 'button.send-button.stop', // 送信ボタンが stop に変化する。要実機調整
  assistantMessages: 'message-content', // 要実機調整
  loggedInProbe: 'rich-textarea', // 要実機調整
  loggedOutProbe: 'a[href*="ServiceLogin"]', // 要実機調整
  rateLimitPatterns: ['しばらくしてからもう一度', 'try again later', '上限'],
};
