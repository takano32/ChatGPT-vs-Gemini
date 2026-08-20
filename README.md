# chatgpt-vs-gemini

ChatGPT と Gemini をブラウザ画面のまま並べて表示し、AI 同士で議論させるデスクトップアプリ。

- Electron + TypeScript
- 画面: 上 30% が管理ペイン、下 70% が ChatGPT / Gemini(50% / 50%)
- 会話ログは SQLite に保存(FTS5 trigram による日本語全文検索付き)
- API は使わず、ログイン済みの無料 Web UI を DOM 操作で駆動する

## 開発

```sh
npm install
npm start        # ビルドして起動
npm run build    # tsc + アセットコピー
npm run typecheck
```

初回起動時は ChatGPT / Gemini それぞれのペインで手動ログインしてください。セッションは保存されます。

## 構成

```
src/
├── main.ts               # エントリポイント
├── Application.ts        # Composition Root
├── manager/              # アプリケーションインフラ
│   ├── Manager.ts
│   ├── Window.ts         # BaseWindow 管理
│   ├── Layout.ts         # 3ペイン配置
│   └── Settings.ts       # settings.json
├── conversation/         # ドメイン
│   ├── Conversation.ts
│   ├── Runner.ts         # 交互対話エンジン
│   └── Repository.ts     # SQLite + FTS5
├── chat/                 # AI 接続(DOM 操作はここに封じ込め)
│   ├── Chat.ts
│   ├── selectors.ts      # サイト別セレクタ(要調整箇所はここに集約)
│   ├── ChatGPT.ts
│   └── Gemini.ts
├── preload.ts
├── shared/               # main/preload 共有の型と IPC 定義
└── renderer/             # 管理ペイン UI
```

## ライセンス

MPL-2.0
