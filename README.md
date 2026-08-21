# ChatGPT vs Gemini

ChatGPT と Gemini をブラウザ画面のまま並べて表示し、AI 同士で議論させるデスクトップアプリ。

- Electron + TypeScript(バンドラなし、tsc のみ)
- 画面: 上 50% が管理ペイン、下 50% が ChatGPT / Gemini(50% / 50%)。比率とチャットペインのズーム(既定 75%)は設定で変更可
- 会話ログは SQLite に保存(FTS5 trigram による日本語全文検索付き)
- API は使わず、ログイン済みの無料 Web UI を DOM 操作で駆動する

## 使い方

1. 初回起動時は ChatGPT / Gemini それぞれのペインで手動ログインする。セッションは保存され、次回以降は不要。未ログインのあいだは管理ペインにバナーが出る。
2. 議論テーマを入力し、▲▼ で最大ターン数(1 AI 発言 = 1 ターン)を決めて「開始」。「一時停止」「再開」「停止」で進行を制御する。
3. 議論中はチャットペインの操作がロックされる(スクロールは可)。回答は入力欄の直上に追従表示される。
4. 「経過」ボタンでライブ表示と経過表示を切り替える。経過表示は発言を話者チップ付きの対話形式で並べ、Markdown としてコピーできる。
5. ☰ メニュー
   - 設定: ターン数・先攻・ターン間待機・検知パラメータ(ポーリング/安定判定/タイムアウト)・レイアウト比率・ズーム・3 種のプロンプトテンプレート
   - 履歴: 過去の議論の一覧と本文
   - 検索: 全発言の全文検索(3 文字未満は LIKE に切り替え)

## 動作の仕組み

- 議論ごとに両サイトで新規チャットを開き、前の議論の文脈を持ち越さない。
- 先攻には `openingTemplate`、後攻には `counterTemplate`、3 ターン目以降は `relayTemplate` で相手の発言を中継する(`{topic}` `{opponent}` `{message}` を展開)。
- 応答の完了は「停止ボタンが消え、本文が変化しない」ことを 2 回続けて確認して判定する。
- 送信の取りこぼし・エラー吹き出し・ペインの読込失敗は自動で再試行し、その旨を管理ペインのログに WARN で出す。
- レート制限の文言を検知すると一時停止し、「再開」で同じターンをやり直す。
- チャットペインは Google ログインを通すため User-Agent を Firefox に統一している。

## データの保存先

Electron の userData(Linux: `~/.config/ChatGPT vs Gemini`、macOS: `~/Library/Application Support/ChatGPT vs Gemini`、Windows: `%APPDATA%\ChatGPT vs Gemini`)に置く。

- `settings.json` — 設定(☰ → 設定 で編集したもの)
- `data.db` — 会話ログ(SQLite、WAL)
- ログインセッション — `persist:chatgpt` / `persist:gemini` パーティション

## 開発

```sh
npm install
npm start        # ビルドして起動
npm run build    # tsc + アセットコピー
npm run typecheck
npm run pack     # 配布物の中身(release/*-unpacked/)だけ作る
npm run dist     # 実行中の OS 向けの配布物を release/ に作る
```

配布物は [electron-builder](https://www.electron.build/) で作る(設定は `electron-builder.yml`)。Linux で deb / rpm / pacman を作るには `rpmbuild` と `bsdtar` が必要(Debian/Ubuntu: `apt install rpm libarchive-tools`、Arch: `pacman -S rpm-tools libxcrypt-compat`)。

## 構成

```
src/
├── main.ts               # エントリポイント
├── Application.ts        # Composition Root(IPC 登録・イベント転送)
├── chat-preload.js       # チャットペイン用 preload(操作ロック。素の JS で tsc を通さない)
├── preload.ts            # 管理ペイン / 経過表示用 preload
├── manager/              # アプリケーションインフラ
│   ├── Manager.ts
│   ├── Window.ts         # BaseWindow 管理
│   ├── Layout.ts         # 4 ビュー配置(管理・ChatGPT・Gemini・経過表示)、UA 固定、読込失敗の再読込
│   └── Settings.ts       # settings.json
├── conversation/         # ドメイン
│   ├── Conversation.ts
│   ├── Runner.ts         # 交互対話エンジン
│   └── Repository.ts     # SQLite + FTS5
├── chat/                 # AI 接続(DOM 操作はここに封じ込め)
│   ├── Chat.ts           # 送信・完了検知・自己修復・スクロール追従
│   ├── selectors.ts      # サイト別セレクタ(要調整箇所はここに集約)
│   ├── ChatGPT.ts
│   └── Gemini.ts
├── shared/               # main/preload 共有の型と IPC 定義
└── renderer/
    ├── index.html / style.css / renderer.ts          # 管理ペイン
    ├── transcript.html / transcript.css / transcript.ts  # 経過表示
    └── api.d.ts          # shared/types のミラー(renderer ビルド用)
scripts/
└── copy-assets.mjs       # HTML/CSS と chat-preload.js を dist/ へコピー
electron-builder.yml      # 配布物の設定(形式・対象アーキ・識別子)
build/                    # アイコンなどのビルド資材(配布物には含まれない)
```

## ライセンス

MPL-2.0
