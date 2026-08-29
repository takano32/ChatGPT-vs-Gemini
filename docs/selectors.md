# セレクタ調整手順 — ChatGPT / Gemini の画面が変わって動かなくなったとき

このアプリは公式 API を使わず、ChatGPT / Gemini の Web 画面を DOM 操作で動かしている。サイト側が画面構成を変えると、入力欄が見つからない・送信が始まらない・応答を拾えない、といった形で壊れる。**直す場所は `src/chat/selectors.ts` の 1 ファイル**で、この文書はそのための手順書。

最終実測: 2026-08-21(`selectors.ts` 先頭のコメントと合わせて、再実測したら日付を更新する)。

## 0. まず切り分ける(セレクタ以外の原因)

セレクタを疑う前に、管理ペイン(上段)のログと下段のペインを見る。

| 見えているもの | 原因 | 対処 |
|---|---|---|
| ペインが白い / ブラウザのエラーページ | ネットワーク(起動直後の `ERR_NETWORK_CHANGED` など) | 自動で再読込する。長く続くなら再起動 |
| ペインがログイン画面や別サイト(`accounts.google.com` 等) | ログイン操作の途中 | 完了を待つ。両サイトともログインは必須ではない |
| WARN「… がレート制限中のため一時停止しました」 | 利用制限(ゲストの送信上限を含む。§3) | 時間を置いて「再開」、ログイン、または別プロファイル |
| 毎ターン同じ WARN / ERROR が出る、ペインでは応答が見えているのに議論が進まない | **セレクタ** | この文書の手順へ |

## 1. 仕組みの要点

- main プロセスには DOM が無い。`src/chat/Chat.ts` が小さな JS(ページ側スクリプト)を `webContents.executeJavaScript` に渡し、`selectors.ts` の値を `JSON.stringify` で埋め込んで実行する。`Chat.ts` はサイト非依存のアルゴリズムで、サイト固有の知識は `selectors.ts` に集約してある。
- 1 ターンの流れ(`Chat.askInner` → `sendAndAwait` → `submit` → `waitForCompletion`):
  1. `input` がある(= `ready`)ことを確認。無ければ `not-ready`
  2. 画面末尾の文言に `rateLimitPatterns` があれば `rate-limited`(一時停止)
  3. 入力欄を空にして本文を挿入 → `sendButton` をクリック(5 秒押せなければ Enter キー)
  4. 送信開始の確認 = `stopButton` が見える、または新しい応答要素(`assistantMessages`)が現れた
  5. 完了 = `stopButton` が消え、本文(`messageContent`)が 2 回続けて変わらない
  6. 本文を相手へ中継
- 送信の取りこぼし・エラー吹き出し・空応答は最大 3 回まで自動で再送する。その経過は管理ペインのログに WARN で出る。3 回とも駄目なら ERROR で議論が止まる。
- ゲスト UI の片付け(`ensureTidy`)はページに常駐し、`hidePatterns` の要素を隠し、`dismissPatterns` のログイン要求ダイアログを出た瞬間に閉じる。

## 2. `selectors.ts` の各フィールドと、壊れたときの症状

`SiteSelectors` の各フィールド。「壊れたとき」は、その値が何にも一致しなくなった場合の典型的な症状。

| フィールド | 意味・使われ方 | 壊れたときの症状 |
|---|---|---|
| `url` | サイトのベース URL。新規チャットの遷移先で、`isReady` の origin 比較と「空チャットにいる」判定(pathname 一致)にも使う | サイトがドメインや新規チャットのパスを変えると、LED が灰色になり「ChatGPT / Gemini の画面になっていません」。議論開始時に 45 秒待って ERROR「新規チャットの準備に失敗しました」 |
| `partition` | Cookie とログインセッションの保存先(`persist:chatgpt` / `persist:gemini`) | 変えると別パーティションになり、ログインが消えた状態になる。通常触らない |
| `input` | 入力欄。存在が `ready`(開始ボタン有効・LED 点灯)の条件。フォーカス、クリア(`execCommand`)、挿入後の文字数確認(`textarea` は `value`、contenteditable は `innerText`)、スクロール追従の基準位置にも使う | LED 灰色・バナー「ChatGPT が ChatGPT / Gemini の画面になっていません」・開始ボタン無効。議論中なら ERROR「… の入力欄が見つかりません」(`not-ready`)。別の入力欄に一致すると「input did not accept text」や「送信が開始しません」 |
| `sendButton` | 送信ボタン。`disabled` / `aria-disabled="true"` でなければ `click()`。5 秒押せなければ Enter キーに切り替える | **Enter で送れてしまうので気づきにくい**。ターンごとに約 5 秒遅くなるのが唯一の兆候。Enter も効かないサイトなら WARN「送信を再試行します」→ ERROR「送信が開始しません」 |
| `stopButton` | 生成中に表示される停止ボタン。見えている(`getClientRects().length > 0`)= 生成中。送信開始の主指標、完了判定(消えた+本文不変 ×2)、送信前に残っていた生成状態の解除に使う | 一致しないと「本文が約 150ms 間隔で 2 回変わらない」だけで完了になり、**生成の小休止で途中確定 → 切れた本文が相手に渡る**(経過表示の本文が途切れる)。逆に常に見える要素に一致すると毎ターン WARN「停止ボタンが消えません。応答の有無だけで判定します」が出て、完了が `stabilityMs`(既定 6 秒)待ちになる |
| `assistantMessages` | AI の応答要素(全件)。件数、識別子(`data-message-id` 属性または `id`)、最後の要素の本文を取る。スクロール追従の目標でもある | 応答が「現れない」扱い。停止ボタンが見えていれば 45 秒、見えなければ 8 秒で WARN「応答が現れません。送信をやり直します」→ 3 回再送(サイトには同じ質問が 3 通届く)→ ERROR「送信が 3 回とも応答に至りませんでした」。利用者発言にも一致すると、自分の発言を回答として相手に渡す |
| `messageContent`(任意) | 応答要素の中で本文だけを持つ要素。指定時は該当要素の `innerText` を `\n\n` で連結(該当要素が入れ子なら最内側だけ。ChatGPT の writing block は外側にヘッダの Edit ボタンを含むため)、省略時は応答要素全体の `innerText`。指定があるのに中に無ければ本文は空 | 本文が空のまま → WARN「応答が空でした。送信をやり直します」×3 → ERROR。逆に必要なのに省略すると読み上げ用ラベル(「ChatGPT said:」)や操作ボタンの文言が本文に混ざり、初トークン前に完了と誤認しうる |
| `excludeInContent`(任意) | 本文の中にあるが本文ではない要素(Gemini の選択肢ボタン `<elicitations>` など)。本文を読むときだけ display:none にして innerText から外す | 除外漏れ → サイトが差し込んだ文言(「次の展開を選択してください」+ 選択肢)が本文として保存され、相手にも渡る |
| `dismissPatterns` | ゲスト利用中に出るログイン要求ダイアログを閉じるボタンの文言(小文字化して部分一致)。対象は可視の `[role="dialog"]` / `dialog` / `mat-dialog-container` のうち本文に log in / sign in / ログイン を含むもの。常駐の `ensureTidy` が即時に、送信前・再試行前にも閉じる | ペインにモーダルが出たまま送信が塞がれ、WARN「送信を再試行します」→ ERROR。Gemini の「Log in to access more features」が典型(§3) |
| `hidePatterns` | ゲスト向け勧誘のうち隠してよいものの文言(小文字化して部分一致)。文言を含む見えているテキストから、本文 300 文字未満・子孫 40 以下・ランドマーク(`main` `header` `nav` `aside` `footer` `form`)以外の範囲で一番外側の要素を `display:none` にする | 見た目だけ(トーストが残る)。議論は止まらない。広すぎても保護規則で入力欄・応答一覧・ランドマークは隠れない |
| `rateLimitPatterns` | 利用制限の文言。`document.body.innerText` の末尾(送信前は 4000 文字、応答待ち中は 2000 文字)に**大小区別の部分一致**。送信前に当たれば `rate-limited`、応答待ち中は新しい応答が無いときだけ | 漏れると ChatGPT のゲスト上限(入力欄が `disabled`)が ERROR「input did not accept text」に化ける(正解は一時停止)。広すぎると通常画面の文言に当たり、LED が黄色「レート制限中」で毎回一時停止 |
| `errorPatterns` | 応答の代わりに描画されるエラー吹き出しの文言(大小区別の部分一致)。最後の応答要素の全文が 400 文字以下かつ文言を含めばエラーとみなし、再送する | 漏れると「Something went wrong … Retry」がそのまま相手に中継される。広すぎると 400 文字以下の正当な短い回答が捨てられ再送される |
| `authCookiePrefix` / `authCookieDomain` | ログイン表示用。`session.cookies.get({ domain })` の中に名前が prefix で始まる Cookie があれば「ログイン済み」。**表示専用**(LED のツールチップ、「ゲスト」タグ、案内バナー)で送信可否には関係しない | ログイン済みなのに「ゲスト」表示と案内バナー。動作への影響なし |

### `selectors.ts` の外にある DOM 知識

原則は「DOM 知識は `src/chat/` に閉じる」。`selectors.ts` で表現できないものは `Chat.ts` にあり、サイトの変更次第ではこちらも触る。

- `probe()` の `keyOf`: 応答要素の識別子は `data-message-id` 属性、無ければ `id`。**識別子が無い要素を `assistantMessages` に選ぶと件数判定に退避し、ChatGPT はスレッド描画を仮想化している(DOM には直近 5 ターン程度しか無い)ため 4 通目以降で「応答なし」と誤判定する**。識別子の属性名が変わったらここを直す
- `dismissLoginNag()` / `ensureTidy()`: ダイアログ容器のセレクタと、本文の判定正規表現 `/log ?in|sign ?in|ログイン/i`
- `submit()`: 入力欄のクリア(`execCommand('selectAll')` → `delete`)、`insertText` → だめなら `execCommand('insertText')`、Enter キーのフォールバック
- `ensureFollower()`: スクロール容器の探し方(応答要素の祖先で `overflow-y` が auto/scroll、無ければページ全体)
- `src/manager/Layout.ts`: User-Agent を Firefox に固定、ログイン用ポップアップの許可ホスト

## 3. エラーコードとログ文言の対応

`Chat.ts` の `ChatError.code` と、`Runner.ts` が管理ペインのログに出す文言。`<名前>` は ChatGPT / Gemini。

| コード | 投げる場所 | 管理ペインのログ / 状態 | 疑うフィールド |
|---|---|---|---|
| `not-ready` | `askInner`: 送信前に `input` が無い | ERROR「エラーで中断しました: <名前> の入力欄が見つかりません。下のパネルでページの状態を確認してください」→ 状態 `error` | `input`、`url`(別 origin にいる) |
| `selector` | `newChat`: 45 秒たっても `input` が出ない / `submit`: 入力欄にフォーカスできない(メッセージはセレクタ文字列そのもの)/ `waitForCompletion`: ページ状態の取得が 20 秒失敗し続けた | ERROR「新規チャットの準備に失敗しました: 新規チャットの準備ができません: <名前>」/「エラーで中断しました: #prompt-textarea, #mobile-composer-prompt」/「エラーで中断しました: <名前> のページ状態を取得できません」 | `input`、`url`。「ページ状態を取得できません」はページ側スクリプトの構文エラー(§6)かレンダラのクラッシュ |
| `send-failed` | `submit`: 挿入後も入力欄が空(「input did not accept text」)/ `sendAndAwait`: 3 回送っても始まらない、または 3 回とも応答に至らない / `ask`: 多重呼び出し(「busy」) | ERROR「エラーで中断しました: <名前> への送信が開始しません」/「… への送信が 3 回とも応答に至りませんでした」/「… input did not accept text」 | `sendButton`、`assistantMessages`、`messageContent`、`dismissPatterns`、`rateLimitPatterns` の漏れ(入力欄が `disabled` のとき) |
| `rate-limited` | `askInner`: 送信前 / `waitForCompletion`: 新しい応答が無く文言が出た | WARN「<名前> がレート制限中のため一時停止しました。再開すると同じターンを再試行します」→ 状態 `paused`。LED は黄色「レート制限中」 | `rateLimitPatterns`(出ない = 漏れ、出すぎ = 広すぎ) |
| `timeout` | `waitForCompletion`: `timeoutMs`(既定 300 秒)を超えた。本文が得られていれば ERROR にせず続行 | ERROR「エラーで中断しました: <名前>」/ 続行時は WARN「<名前> の応答が閉じないため、得られた本文で続行します」 | `stopButton` が常に見えていて本文も動き続ける(まれ)。多くはネットワーク断やスリープ復帰 |
| `stopped` | 利用者の「停止」 | INFO「議論を停止しました」 | 正常系 |

議論を止めない自己修復の WARN(`Chat.notify` → Runner が WARN で転記):

| WARN 文言 | 意味 | 毎ターン出るなら疑うフィールド |
|---|---|---|
| 「<名前> への送信を再試行します(n/3 回目)」 | 前回の送信が始まらなかった | `sendButton`、`dismissPatterns` |
| 「<名前> の応答が現れません。送信をやり直します」 | 送信後 8 秒(停止ボタンありなら 45 秒)応答要素が現れない | `assistantMessages` |
| 「<名前> の応答がエラーでした。送信をやり直します」 | エラー吹き出しを検知 | 正常な自己修復。毎回なら `errorPatterns` が広すぎ |
| 「<名前> の応答が空でした。送信をやり直します」 | 応答要素はあるが本文が空 | `messageContent` |
| 「<名前> の停止ボタンが消えません。応答の有無だけで判定します」 | 送信前から停止ボタンが見えていて、押しても消えない | `stopButton` が常時見える要素に一致 |
| 「<名前> に残っていた生成状態を解除しました」 | 前回のストリームが閉じずに残っていた停止ボタンを押した | 正常な自己修復 |
| 「<名前> のログイン要求ダイアログを閉じました(ログインなしで続行)」 | 送信時にダイアログを閉じた(常駐側で閉じた分は出ない) | 正常。出なくなったのにモーダルが残るなら `dismissPatterns` |

管理ペインの LED とバナー(`renderer.ts`)は `ready` / `loading` / `loggedIn` / `rateLimited` の 4 値で決まる。「読み込み中」はページ遷移中、「ChatGPT / Gemini の画面になっていません」は `input` 不在または別 origin。

## 4. 2026-08-21 時点の実測

### ChatGPT(`https://chatgpt.com/`)

DOM の変種が 2 つあり、`selectors.ts` は CSS のセレクタリストで両方を受けている(`querySelector` は文書順で最初に一致した要素を返す)。どちらが配信されるかはプロファイル(Cookie)ごとの A/B で、ログイン済みは従来 DOM、ゲストは両方あり得る。

| 要素 | 従来 DOM | 新変種(ゲストの一部セッション) |
|---|---|---|
| 判別 | — | `[data-testid="desktop-app-shell"]` がある |
| 入力欄 | `#prompt-textarea`(`div.ProseMirror[contenteditable]`) | `textarea#mobile-composer-prompt` |
| 送信 | `button[data-testid="send-button"]` | `button[aria-label="Send message"]` |
| 停止 | `button[data-testid="stop-button"]`。送信ボタンと同一要素(`#composer-submit-button`)の `data-testid` がトグルする | `button[aria-label="Stop generating"]` |
| 応答要素 | `[data-message-author-role="assistant"]`(識別子は `data-message-id`) | `li[data-message-role="assistant"]`(`id` が UUID) |
| 本文 | `.markdown` | `[data-assistant-markdown]`。`li` 全体には読み上げ用の「ChatGPT said:」が含まれる |
| 言語 | UI ロケール依存だが `data-testid` は非依存 | 匿名 UI は日本語環境でも英語で配信される。`aria-label` にしか手掛かりが無い |

挙動のメモ: スレッド描画は仮想化されていて DOM に残るのは直近 5 ターン程度(件数は増えない)。下書きを復元するので送信前に入力欄を空にする。ストリームが切れると停止ボタンが残ったまま固まることがある。会話リクエストが失敗すると assistant ロールの要素に「Something went wrong. … Retry」を描画する。

ゲストのログイン催促:

- ヘッダーの「Log in」「Sign up for free」とサイドバーのカード「Get responses tailored to you」は**残す**(ログインの入口。サイドバーを隠すとレイアウトが崩れた)
- 一時的なトースト「You'll get smarter responses …」だけ `hidePatterns: ['smarter responses']` で隠す
- 送信上限: 「Message limit reached / You have reached the anonymous message limit.」+ ボタン「New chat」「Continue on ChatGPT」。入力欄が `disabled` になり、応答要素は「ChatGPT said:」だけの空で残る。プロファイル(端末の Cookie)単位で**約 100 通**。解除までの時間は未観察。新しいプロファイルは直後から使える。`rateLimitPatterns` で一時停止にしている
- 「Stay logged out」のダイアログは `dismissPatterns` に備えてあるが、実測では出ていない

### Gemini(`https://gemini.google.com/app`)

Angular Material 製で `data-testid` が無い。`aria-label` は UI ロケール依存(開発機は日本語)なので、言語非依存の `mat-icon[fonticon]` をフォールバックにしている(`:has()` は Chromium 対応済み)。

| 要素 | セレクタ |
|---|---|
| 入力欄 | `rich-textarea .ql-editor`(Quill) |
| 送信 | `button[aria-label="プロンプトを送信"]`、予備 `button:has(mat-icon[fonticon="arrow_upward"])` |
| 停止 | `button[aria-label="回答を停止"]`、予備 `button:has(mat-icon[fonticon="stop"])` |
| 応答要素 | `message-content`(`id="message-content-id-r_…"`)。利用者発言は別要素なので本文指定は不要 |

ゲストのログイン催促:

- ヘッダーの「Sign in」は常設で**残す**
- 4 通目以降に「Log in to access more features」[Not now] [Log in] のモーダルが出て送信を塞ぐ。発火はプロファイル累計(新しいプロファイルでは 5 通でも出ないことがある)。常駐の `ensureTidy` が「Not now」で即閉じる
- ゲストのモデル表示は「Gemini 3.5 Flash-Lite」

## 5. 調べ方

### 5.1 空の userData で起動する

普段のプロファイルを汚さず、ゲストの状態を再現できる。Linux では `XDG_CONFIG_HOME` で userData(`$XDG_CONFIG_HOME/ChatGPT vs Gemini`)を切り替えられる。

```sh
source /usr/share/nvm/init-nvm.sh      # 開発機(nvm)の場合
cd ~/GitHub/ChatGPT-vs-Gemini
npm run build
XDG_CONFIG_HOME=/tmp/cvg-probe npx electron . --remote-debugging-port=9666
```

- 二重起動防止は userData 単位なので、普段使いのアプリと同時に動かせる
- ChatGPT の DOM 変種を引き当てたいときは `/tmp/cvg-probe2` のようにディレクトリを変えて起動し直し、`!!document.querySelector('[data-testid="desktop-app-shell"]')` で判別する
- ログイン済みの状態を調べるときは `XDG_CONFIG_HOME` を付けずに起動する(普段の userData。起動中なら先に終了)
- macOS / Windows には同等の環境変数が無いので、userData フォルダ(README「データの保存先」)を一時的に退避する
- 議論していない間はペインの操作ロックが外れている。ペインに直接打って送信し、生成中の DOM を観察できる

### 5.2 DevTools の画面で見る

アプリ自体には DevTools を開くメニューやショートカットが無い。上の `--remote-debugging-port` を付けて起動し、別の Chrome で `chrome://inspect/#devices` → 「Configure…」に `127.0.0.1:9666` を追加すると、Remote Target に 4 ページ(管理ペイン `index.html`、`chatgpt.com`、`gemini.google.com`、`transcript.html`)が並び、「inspect」で通常の DevTools(Elements パネル)が使える。Elements の「Copy selector」はクラス名ベースの壊れやすいセレクタになるので使わず、`data-testid` / `aria-label` / `id` を見て自分で書く。ChromeOS Crostini のように Chrome が別 VM にある環境ではポート転送が要るので、次のスクリプト方式のほうが手軽。

### 5.3 スクリプトで `Runtime.evaluate` する

Node 22 以降の組み込み `fetch` / `WebSocket` だけで書ける(追加の依存なし)。`probe.mjs` として保存する。

```js
// 使い方: node probe.mjs <port> <URL の一部> <式>
//   例:   node probe.mjs 9666 chatgpt.com '!!document.querySelector("#prompt-textarea")'
// 式の戻り値は JSON にできる値にする(DOM 要素をそのまま返すと {} になる)。
const [port, urlPart, expression] = process.argv.slice(2);
setTimeout(() => { console.error('timeout'); process.exit(2); }, 15000); // エラーページ等で固まらない
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find((t) => t.type === 'page' && t.url.includes(urlPart));
if (!target) {
  console.error('対象ページが見つかりません。いまあるページ:');
  for (const t of targets) console.error(`  ${t.type}  ${t.url}`);
  process.exit(1);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
ws.send(JSON.stringify({
  id: 1,
  method: 'Runtime.evaluate',
  params: { expression, returnByValue: true, awaitPromise: true },
}));
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id !== 1) return;
  const { result, exceptionDetails } = msg.result;
  if (exceptionDetails) console.error('例外:', exceptionDetails.exception?.description ?? exceptionDetails.text);
  else console.log(typeof result.value === 'string' ? result.value : JSON.stringify(result.value, null, 2));
  ws.close();
  process.exit(exceptionDetails ? 1 : 0);
};
```

式が長いときはファイルに書いて `node probe.mjs 9666 gemini.google "$(cat expr.js)"` のように渡すと、シェルの引用符で悩まない。複数文を書くときは IIFE(`(() => { … })()`)で包む(トップレベルの `const` はページに残り、2 回目で「already been declared」になる)。

### 5.4 よく使う式

いまの `selectors.ts` の値が全部効くか(数が 0 のフィールドが壊れている。`S` の中身は `dist/chat/selectors.js` から貼る):

```js
(() => {
  const S = {
    input: '#prompt-textarea, #mobile-composer-prompt',
    sendButton: 'button[data-testid="send-button"], button[aria-label="Send message"]',
    stopButton: 'button[data-testid="stop-button"], button[aria-label="Stop generating"]',
    assistantMessages: '[data-message-author-role="assistant"], li[data-message-role="assistant"]',
  };
  return Object.fromEntries(Object.entries(S).map(([k, sel]) => [k, document.querySelectorAll(sel).length]));
})()
```

入力欄の候補:

```js
[...document.querySelectorAll('textarea, [contenteditable="true"]')]
  .map((e) => `${e.tagName.toLowerCase()}#${e.id} testid=${e.getAttribute('data-testid')} aria=${e.getAttribute('aria-label')}`)
```

見えているボタンの手掛かり(`data-testid` / `aria-label` / `mat-icon` の `fonticon` / 文言):

```js
[...document.querySelectorAll('button')]
  .filter((b) => b.getClientRects().length > 0)
  .map((b) => [b.getAttribute('data-testid'), b.getAttribute('aria-label'),
    b.querySelector('mat-icon')?.getAttribute('fonticon'), b.textContent.trim().slice(0, 20)].filter(Boolean).join(' | '))
```

応答要素の候補と識別子(ペインで 1 通送ってから。生成中と完了後の両方で見る):

```js
[...document.querySelectorAll('[data-message-author-role], [data-message-role], message-content, article')]
  .map((e) => e.tagName.toLowerCase() + ' ' + [...e.attributes]
    .filter((a) => /^(id|data-|role)/.test(a.name)).map((a) => `${a.name}="${a.value.slice(0, 40)}"`).join(' '))
```

見えているダイアログとそのボタン(`dismissPatterns` の材料):

```js
[...document.querySelectorAll('[role="dialog"], dialog, mat-dialog-container')]
  .filter((d) => d.open || d.getClientRects().length > 0)
  .map((d) => ({ text: d.innerText.replace(/\s+/g, ' ').slice(0, 200),
    buttons: [...d.querySelectorAll('a, button')].map((b) => b.textContent.trim()) }))
```

画面末尾の文言(`rateLimitPatterns` / `errorPatterns` の材料):

```js
document.body.innerText.slice(-800)
```

アプリがページに仕込んだ状態(遷移で消える。`dismissed` は常駐側が閉じたダイアログの数):

```js
({ tidy: window.__cvgTidy ? window.__cvgTidy.dismissed : null, follower: !!window.__cvgFollow,
   lock: localStorage.getItem('__cvgLock') })
```

## 6. 直し方のルール

- **変種は CSS のセレクタリストで併記する**(`'古い, 新しい'`)。古いほうを消すのは、ログイン済み・ゲスト・両変種のどれでも出ないことを確かめてから
- 手掛かりの優先順: `data-testid` > `aria-label` > 言語非依存の構造(`mat-icon[fonticon]`、要素名、`data-*` 属性)> それ以外。**クラス名は使わない**(ハッシュ化・ユーティリティクラスで毎リリース変わる)
- `aria-label` は UI ロケールで変わる。ChatGPT のゲスト UI は日本語環境でも英語、Gemini のログイン済みは日本語、といった混在があるので、言語依存のセレクタには必ず言語非依存の予備を並べる
- `assistantMessages` に選ぶ要素は、メッセージごとに固有の `data-message-id` か `id` を持つこと(§2「`selectors.ts` の外にある DOM 知識」)
- `stopButton` は「生成中だけ存在または表示される」要素にする。常に DOM にあって `display:none` で隠れるだけの要素は、可視判定(`getClientRects`)で扱えるので可
- 文言パターンの一致ルールは 2 種類: `dismissPatterns` / `hidePatterns` は小文字化して部分一致、`rateLimitPatterns` / `errorPatterns` は大小区別の部分一致。英語と日本語の両方を入れる。短すぎる語(「limit」だけ等)は誤検知する
- セレクタや文言は `selectors.ts` にだけ書き、`Chat.ts` に直書きしない(`JSON.stringify` で埋め込まれるので引用符のエスケープも不要)
- 実測に基づく値には「2026-08-21 実測」のように日付と根拠をコメントに残す

### `Chat.ts` のページ側スクリプトに触るとき

テンプレートリテラルの中身はページで実行される JS で、TypeScript も Electron も構文を検査しない。`js()` は例外を握りつぶすので、壊れても無言で `null` が返り、症状は「送信喪失 → 再送 → ERROR」や「ページ状態を取得できません」に化ける。

- 文字列に改行を入れるなら `'\\n'` と書く(`'\n'` は TS が実改行に展開し、生成された JS の文字列リテラルが割れる)
- テンプレートの中にエスケープや改行を含むコメントを書かない(コメントもページに渡る)
- 変更したら `npm run build && npm test`。`npm test`(`scripts/check-page-scripts.mjs`)は `dist/chat/Chat.js` から長いテンプレートを取り出し、`${…}` をダミーに置換して `new Function` に通す構文検査。CI でも走る

## 7. 変更後の確認

1. `npm run typecheck && npm run build && npm test`
2. 空の userData(§5.1)で起動し、3 ターンほど議論して管理ペインのログに WARN / ERROR が無いこと。経過表示の本文が途中で切れていないこと
3. ChatGPT は両変種で確認する(プロファイルを変えて起動し直す)。ログイン済みのプロファイルでも 1 回は通す
4. ゲストの催促を確認する: Gemini は 4 通目以降のモーダルが自動で閉じること(`window.__cvgTidy.dismissed` が増える)、ChatGPT はトーストが消えヘッダーの Log in が残ること
5. `selectors.ts` 先頭とこの文書の実測日を更新し、push して CI(全形式のビルドと起動スモーク)が通ることを見る。実際の議論は CI では確認できない

## Markdown 直列化(captureLastMarkdown)

0.8.0 から、応答の確定後に最後の応答要素を Markdown へ直列化して `messages.content_md` に保存する
(`Chat.ts` の `captureLastMarkdown()`。プレーン文の `content` とは別。docs/schema.md)。
新しいセレクタは使わず `messageContent` / `excludeInContent` に相乗りしているので、
**サイトの画面変更でこれらを調整したときは、直列化も一緒に確認する**:
数ターン議論(見出し・箇条書き・表・コードを出させる議題)→ DB の `content_md` を見る。
壊れていても議論は止まらず null が入るだけ(コピーはプレーン文にフォールバック)。

