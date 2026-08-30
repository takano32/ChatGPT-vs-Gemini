# ChatGPT vs Gemini
[English](README.en.md)

ChatGPT と Gemini をブラウザ画面のまま並べて表示し、AI 同士で議論させるデスクトップアプリ。

- Electron + TypeScript(バンドラなし、tsc のみ)
- 画面: 上 50% が管理ペイン、下 50% が ChatGPT / Gemini(50% / 50%)。上下の比率は管理ペイン下端のドラッグで変えられる(起動中のみ。既定は設定で変更可)。チャットペインのズーム(既定 75%)も設定で変更可
- 会話ログは SQLite に保存(FTS5 trigram による日本語全文検索付き)
- API は使わず、無料 Web UI を DOM 操作で駆動する。**ログインなし(ゲスト)でそのまま使える**。ログインは任意

## インストール

[配布サイト](https://takano32.github.io/ChatGPT-vs-Gemini/)で OS に合ったものを選ぶ([Releases](https://github.com/takano32/ChatGPT-vs-Gemini/releases) には全形式がある)。アカウントは不要。

- **macOS**: `.dmg` を開き、`ChatGPT vs Gemini` を Applications にドラッグ。Apple シリコン用(arm64)と Intel 用(x64)がある。いまは**未署名**なので初回は「開発元を確認できない」または「壊れている」と言われる。システム設定 → プライバシーとセキュリティ → 「このまま開く」で起動できる(ターミナルなら `xattr -d com.apple.quarantine "/Applications/ChatGPT vs Gemini.app"`)。
- **Windows**: `ChatGPT-vs-Gemini-Setup-<版>.exe` を実行(ユーザー単位にインストール、管理者権限不要)。SmartScreen の「Windows によって PC が保護されました」は「詳細情報」→「実行」で進む。インストールしない portable 版、zip、msi もある。
- **Linux**: deb(Ubuntu / Debian)、rpm(Fedora)、pacman(Arch)のパッケージを推奨。AppImage は `chmod +x` して実行する(Chromium のサンドボックスは無効で動く)。tar.gz は展開して `chatgpt-vs-gemini` を実行。

## 使い方

1. 起動するとそのまま使える(既定はゲスト利用)。ChatGPT / Gemini のペインでログインしてもよく、ログインすると会話がサイト側の履歴に残り、利用制限が緩くなることがある。セッションは保存され、次回以降は不要。
2. 議論テーマを入力し(Enter で改行、Ctrl+Enter / ⌘+Enter でも開始できる)、モード(対立 / 協調 / ブレスト / 弁証法 / リレー創作 / 批評 / 対談 / 師弟 / 悪魔の代弁者 / クイズ / ロールプレイ。括弧は先攻 / 後攻の役割。起動時は常に「対立」。ロールプレイを選ぶとテーマ欄の下に 2 つの役割欄が出るので、それぞれの AI が演じる役を書く。例: テーマ「取調室」、ChatGPT = 刑事、Gemini = 容疑者)、先攻(どちらの AI から話すか)、▲▼ で最大ターン数(1 AI 発言 = 1 ターン)を決めて「開始」。「一時停止」「再開」「停止」で進行を制御する。ショートカット: Ctrl+Enter(⌘+Enter)= 開始、Space = 一時停止 ⇄ 再開、Ctrl+B(⌘B)= サイドパネル、`/` = 検索(いずれも上半分の管理ペインにフォーカスがあるとき。入力欄では効かない)。ヘッダの TURN の左に、いま誰のターンで進行役のどの段階(序盤 / 中盤 / 終盤 / まとめ)かが出る。
3. 議論中はチャットペインの操作がロックされる(スクロールは可)。待機中はペインを自由に操作でき、ログインや手動のチャットもできる。回答は入力欄の直上に追従表示される。
4. 右上の「日本語 / English」で言語を切り替える(画面文言・経過表示・プロンプトのテンプレートが切り替わる。進行中の議論はそのまま)。「経過」ボタンでライブ表示と経過表示を切り替える。経過表示は発言を話者チップ付きの対話形式で並べ、Markdown としてコピーできる。コピーは見出し・箇条書き・表・コードの形を保つ(0.8.0 から本文の Markdown 版も保存している。取れなかった発言は文章のまま)。
5. 左上のサイドパネル(設定 / 履歴 / 検索)
   - 設定: ターン数・先攻・ターン間待機・検知パラメータ(ポーリング/安定判定/タイムアウト)・レイアウト比率・ズーム・5 種のプロンプトテンプレート(言語 × モードごとに保存)と進行役の文。「既定に戻す」は入力欄を既定値で埋めるだけで、「保存」を押すまで保存されない
   - 履歴: 過去の議論の一覧と本文。各発言の「この発言へのプロンプト」で実際に送った文(進行役の行込み)を確認できる。題名をクリックで改名、✕ で削除(確認なし。5 秒間は「取り消す」で戻せる。議論中の会話は消せない)、Markdown をコピー。「もう一度」でいまの題名を議題に、同じモード・ターン数のまま先後を入れ替えて新しい議論を始める。停止・エラーで止まった会話には「続きから」が出て、保存済みの発言の次のターンから同じ会話に続ける
   - 検索: 全発言の全文検索と議題(タイトル)の部分一致(3 文字未満は LIKE に切り替え)。結果をクリックすると履歴のその発言へジャンプ

## 注意事項

- OpenAI / Google とは無関係の非公式ツール。
- Web UI を自動操作する(ゲスト利用・ログイン利用のどちらでも)。各サービスの利用規約は自分で確認すること。自動操作によって一時的な利用制限などアカウントへの影響が出る可能性があり、利用は自己責任で。
- チャットペインは User-Agent を Firefox として送る(Electron のままでは Google のログインが完了しないため)。
- ChatGPT / Gemini の画面構成が変わると動かなくなる。直す場所は `src/chat/selectors.ts`、手順は [docs/selectors.md](docs/selectors.md)。
- 会話の本文はローカルの SQLite に平文で保存され、ログインした場合はそのセッションも端末に残る(消し方は「トラブルシューティング」)。

## 対応 OS と検証状況

| OS | 配布形式 | 確認状況 |
|---|---|---|
| Linux(x64 / arm64) | AppImage, deb, rpm, pacman, tar.gz | arm64(ChromeOS Crostini)で実機確認。両アーキとも CI の起動テスト |
| macOS(Apple シリコン / Intel) | dmg, zip | CI の起動テストのみ。未署名 |
| Windows(x64 / arm64) | インストーラ・portable(両アーキ入りの 1 ファイル), zip(アーキ別), msi(x64 のみ) | CI の起動テストのみ。未署名 |

CI の起動テストは 6 ターゲットすべてをネイティブのランナーで行い、ログインなしで「パッケージが起動し、DB と全文検索が動く」ところまで確認する。実際の議論は Linux arm64 でのみ確認している。

## 動作の仕組み

- 議論ごとに両サイトで新規チャットを開き、前の議論の文脈を持ち越さない。
- モードは「プロンプトテンプレート一式」。先攻の 1 ターン目は開始、後攻の 2 ターン目は反論、3 ターン目以降は先攻 / 後攻それぞれの中継テンプレートで相手の発言を渡す(`{topic}` `{opponent}` `{message}` を展開)。
- 進行役(タイムキーパー): 毎ターンの先頭に「n/N ターン目(残り M)」と段階の指示(序盤: 論点を出し切る / 中盤: 絞って深める / 終盤: 新しい論点を出さず収束)を付け、最後の 2 ターンは両者が 1 回ずつ「まとめ」テンプレートで結論を出す(2 人目には相手のまとめではなく相手の最後の通常発言を渡し、同じ材料で独立にまとめる)。4 ターン未満はまとめ無し。
- 応答の完了は「停止ボタンが消え、本文が変化しない」ことを 2 回続けて確認して判定する。
- 送信の取りこぼし・エラー吹き出し・ペインの読込失敗は自動で再試行し、その旨を管理ペインのログに WARN で出す。
- レート制限の文言を検知すると 60 秒待って同じターンを自動で再試行する(3 回待っても解除されなければ一時停止し、「再開」で同じターンをやり直す)。応答が時間内に来なければページを読み込み直して 1 回だけ送り直す。
- チャットペインは Google ログインを通すため User-Agent を Firefox に統一している。

## データの保存先

Electron の userData(Linux: `~/.config/ChatGPT vs Gemini`、macOS: `~/Library/Application Support/ChatGPT vs Gemini`、Windows: `%APPDATA%\ChatGPT vs Gemini`)に置く。

- `settings.json` — 設定(サイドパネル → 設定 で編集したもの)
- `data.db` — 会話ログ(SQLite、WAL)
- ログインセッション — `persist:chatgpt` / `persist:gemini` パーティション

管理ペインに出るログは `logs/main.log`(Linux / Windows は userData の下、macOS は `~/Library/Logs/ChatGPT vs Gemini`)にも残る。不具合を報告するときに添えると原因を追いやすい。1 MB を超えると起動時に `main.log.1` へ退避する。

## トラブルシューティング

- **日本語が □ になる(Linux)**: CJK フォントと絵文字フォント(例: `noto-fonts-cjk`、`noto-fonts-emoji`)を入れてアプリを再起動する。
- **起動直後にペインが白い / 読み込めない**: ネットワーク切替直後に起きやすい。自動で再読込するので少し待つ。長く続くなら一度終了して起動し直す。
- **「ページを読み込めていません」と出る**: そのペインが ChatGPT / Gemini の画面になっていない。少し待つか、一度終了して起動し直す。ログインは必須ではない。
- **議論が途中で止まる**: レート制限が続くと一時停止になるので、時間を置いて「再開」(同じターンをやり直す)。応答が長すぎてタイムアウトする場合は サイドパネル → 設定 の「1 応答の上限」を伸ばす。
- **設定がおかしくなった**: `settings.json` を削除すると既定値に戻る。
- **初期化したい(別アカウントでログインし直す・履歴を消す)**: アプリを終了し、「データの保存先」のうち必要なものだけ削除する。`Partitions/` がログインセッション、`data.db`(と `-wal` / `-shm`)が履歴、`settings.json` が設定。

## 開発

```sh
npm install
npm start        # ビルドして起動
npm run build    # tsc + アセットコピー
npm run typecheck
npm test         # ページ側スクリプトの構文検査と Repository / 設定 / Markdown 書き出しのテスト(ビルド後に実行)
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
├── FileLog.ts            # 管理ペインのログを logs/main.log にも残す
├── manager/              # アプリケーションインフラ
│   ├── Manager.ts
│   ├── Window.ts         # BaseWindow 管理
│   ├── Layout.ts         # 4 ビュー配置(管理・ChatGPT・Gemini・経過表示)、UA 固定、読込失敗/クラッシュ/ハングの再読込
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
├── shared/               # main / preload / renderer 共有の型・IPC 定義・モード・main 側文言(Node 非依存。tsconfig.shared.json の composite プロジェクト)
└── renderer/
    ├── index.html / style.css / renderer.ts          # 管理ペイン
    ├── transcript.html / transcript.css / transcript.ts  # 経過表示
    └── api.d.ts          # window.api の宣言(型は shared/ipc.ts を参照)
scripts/
├── copy-assets.mjs       # HTML/CSS・chat-preload.js・アイコンを dist/ へコピー
├── check-page-scripts.mjs # ページ側スクリプトの構文検査(npm test)
└── smoke.mjs             # パッケージ済みアプリの認証なし起動テスト(CI 用)
test/                     # 自動テスト(node:test。dist/ を対象にするのでビルド後に npm test)
├── repository.test.mjs   # Repository(SQLite / FTS5 / マイグレーション)
├── runner.test.mjs       # Runner(ターン進行・モード・進行役・レート制限)
├── settings.test.mjs     # settings.json の正規化
└── markdown.test.mjs     # 経過の Markdown 書き出し
.github/workflows/
├── build.yml             # 共通: ランナー × アーキ × 形式のジョブでパッケージ化と起動テスト(ネイティブランナー)
├── ci.yml                # push/PR: build.yml を呼ぶ(main への push は全形式を Artifacts に)
├── release.yml           # v* タグ: build.yml → 最終ジョブが全成果物を draft Release に添付
└── pages.yml             # docs/ を GitHub Pages へ
electron-builder.yml      # 配布物の設定(形式・対象アーキ・識別子)
build/                    # アイコンなどのビルド資材(配布物には含まれない)
```

## ライセンス

MPL-2.0
