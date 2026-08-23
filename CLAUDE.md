# CLAUDE.md

ChatGPT と Gemini の無料 Web 画面を DOM 操作で議論させる Electron アプリ(対象は初心者)。全体像は README.md、画面変更時のセレクタ調整は docs/selectors.md。会話・コメント・ログ文言・文書は日本語。

## 開発コマンド

- 非対話シェルでは先に `source /usr/share/nvm/init-nvm.sh`(開発機の Node は nvm 経由。`engines` は >=22.12)
- `npm run typecheck` / `npm run build` — `tsc -b`(shared → main / renderer の 3 プロジェクト。buildinfo は `dist/.tsbuildinfo/`)。build はさらに `scripts/copy-assets.mjs`(HTML/CSS・chat-preload.js・アイコンを dist/ へ)。おかしくなったら `rm -rf dist` でやり直す
- `npm test` — `scripts/check-page-scripts.mjs`(ページ側スクリプトの構文検査)に加え、`test/*.test.mjs`(node:test、依存なし)があればそれも。どちらも dist/ を読むので build の後に走らせる
- `npm start` — build して起動。`npm run pack` — release/*-unpacked/ だけ。`npm run dist` — 実行中 OS の配布物
- 空の userData で起動(Linux): `XDG_CONFIG_HOME=/tmp/cvg-probe npx electron . --remote-debugging-port=9666`。ゲスト状態の再現と CDP 調査に使う(手順は docs/selectors.md §5)

## 変えない方針(利用者の決定)

- 公式 API は使わない。両サイトの Web 画面を DOM 操作で動かす
- ゲスト(ログインなし)が既定。開始・送信の条件は `ready`(入力欄がある)だけ。ログインは任意で、効能は「〜ことがあります」と断定しない
- ログアウト / セッション消去の機能は作らない(初期化は userData の削除を案内する)
- 慣習・既定値を優先し、最適化目的の設定や回避策は入れない。設定は「既定と違う理由を一言で言えるもの」だけ残す
- 新しい依存を足さない(実行時依存は better-sqlite3 のみ。バンドラなし、UI フレームワークなし)
- mac の署名・公証は当面しない。`mac.identity: "-"`(ad-hoc)と `hardenedRuntime: false` は Apple シリコンで起動させるために必須なので外さない
- CI のランナーは `ubuntu-latest` / `macos-latest` / `windows-latest` のみ。もう片方のアーキはクロスビルドし、起動スモークはアーキが一致するジョブだけ。Windows は 1 ジョブで両アーキ(NSIS / portable が両アーキ入りの 1 ファイルのため)。actions はメジャータグ、Node は `lts/*`
- エラー文言は「次に何をするか」を示す。検知パラメータのような細かい設定は詳細設定に畳む
- ネイティブ UI(dialog.showMessageBox / showSaveDialog 等の OS ダイアログ)は当面使わない(2026-08-23 利用者決定。起動エラーの showErrorBox だけ例外)。確認は出さず、結果は管理ペインのログに出す。ファイル書き出しの代わりにクリップボードへコピー

## 構造ルール

- DOM 知識は `src/chat/` に閉じる。セレクタと文言パターンは `src/chat/selectors.ts` だけに書き、`Chat.ts` はサイト非依存のアルゴリズムに保つ
- モードとその既定テンプレート・進行役の文は `src/shared/modes.ts`。Runner の進行(ターンの種類と段階)は `planTurns()`(Runner.ts)
- SQL は `src/conversation/Repository.ts` だけ。既存 DB の変更(列追加など)は `MIGRATIONS` に冪等な関数を追記し、`SCHEMA_SQL` も最終形に更新する(`PRAGMA user_version` で未適用分だけ当たる)
- `src/shared/` は main / preload / renderer の共有(TypeScript Project References: `tsconfig.shared.json` が composite、main と renderer が参照)。renderer からは `import type` だけで使う(実行時の import は増やさない)。`src/shared` に Node 依存のコードを置かない(`node:fs` 等は `src/` 直下か `manager/` へ)。`src/renderer/api.d.ts` は `window.api` の宣言だけ
- 画面文言は日本語と英語の 2 言語だけ(他の言語は対応しない)。renderer 側の文言は `src/renderer/i18n.ts`(静的文言は HTML の `data-i18n*` 属性、動的文言は `t()`)、main 側(ログ・通知・エラー)は `src/shared/i18n.ts` の `tm()`。新しい文言を足したら両言語を書く
- main プロセスに DOM 型は無い。ページ操作は `executeJavaScript` に渡す自己完結の IIFE 文字列で、値は `JSON.stringify` で埋め込む
- ページ側スクリプト(`Chat.ts` のテンプレートリテラル)の落とし穴: 中の `'\n'` は TS が実改行に展開して無言で壊れるので必ず `'\\n'`。テンプレート内にエスケープや改行を含むコメントを書かない。`js()` は例外を握りつぶすため症状は「送信喪失 → 再送 → ERROR」に化ける。触ったら `npm run build && npm test`
- 素の JS は `src/chat-preload.js` だけ(document_start で走る操作ロック。tsc を通さない)
- IPC チャンネル名は `src/shared/ipc.ts`。renderer は `window.api` 経由でしか通信しない
- 実測に基づく値・セレクタには「2026-08-21 実測」のように日付と根拠をコメントに残す

## 検証の流儀

- 配布物の検証は CI に任せる(push / PR で全形式を作る)。ローカルでフルビルドしない(両アーキ × 多形式でマシンが停止した実績がある)
- ローカルで electron-builder を回すなら 1 形式 1 アーキに限り、`~/.local/bin/guard -- npx electron-builder --linux AppImage:arm64` のように guard 経由(メモリ・負荷・時間で当該ジョブだけ kill する)
- electron-builder、Electron の起動、圧縮などの重い処理は guard 経由。始める前に `free -m` で空きを見る
- 動作確認は空の userData で数ターン議論し、管理ペインのログに WARN / ERROR が無いこと。ChatGPT は DOM 変種が 2 つあるので両方で見る
- 長い検証スクリプトは背景で丸ごと起動してログを読む。`pkill -f <パターン>` は自分のシェルも殺すので `pgrep` で PID を取ってから kill する。Electron を多重起動しない
- git の commit / push は利用者の指示があるときだけ。コミットは main に直接

## リリース手順

1. `npm version patch|minor`(package.json の更新・コミット・`vX.Y.Z` タグまで行う)
2. `git push --follow-tags`
3. `release.yml` が全形式をビルドし、最終ジョブが draft Release に添付する(`gh release create --draft --generate-notes`)
4. draft ができたら Claude が日本語のリリースノート(前回の Release と同じ構成)を `gh release edit vX.Y.Z --notes-file` で書き込み、URL を渡す。利用者は「公開」を押すだけ。配布サイト(docs/、GitHub Pages)は Releases API で最新版を表示するので更新不要。ノートは「冒頭 1 段落の要約 → `## 変更点` の箇条書き → `## ダウンロード` → `## 注意`」の構成を守る(配布サイトが `body_html` から冒頭段落と「変更点」の箇条書きを切り出して表示する)
