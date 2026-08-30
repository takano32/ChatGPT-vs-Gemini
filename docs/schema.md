# データベーススキーマの契約

`data.db`(SQLite、WAL)の構造と、それを**将来にわたって壊さないための約束**。SQL を書く場所は
`src/conversation/Repository.ts` だけ(CLAUDE.md の構造ルール)。この文書は「列の意味」と
「変えてよいこと・いけないこと」を記録する。スキーマに触る前に必ず読むこと。

## 原則(0.8.0 で確定。以後の変更はこの範囲で)

1. **既存列の意味は変えない・転用しない**。変更はすべて「nullable な列の追加」だけ。
   `MIGRATIONS` に冪等な関数を 1 つ追記し、`SCHEMA_SQL` も最終形に更新する(`PRAGMA user_version`)。
2. **`messages.content` はプレーンテキストで固定**。常に存在し、全文検索(FTS)・経過表示・
   相手への中継はこれを使う。忠実な記録は `content_md`(別列)が持つ。この使い分けを崩さない。
3. **会話の実行条件は `conversations.config`(JSON 1 列)に吸収**する。モードの追加などで
   条件が増えても列は増やさない(例: ロールプレイの役割は `config.roles` に入れる)。
   `mode` / `max_turns` は既存列が真実で、config に重複させない。
4. 使う当てのないデータは入れない。「決定的」とは全部盛りではなく「作り直しが要らない」こと。

## テーブル(user_version 3)

### conversations

| 列 | 型 | 意味 |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | 会話 ID(再利用されない) |
| title | TEXT NOT NULL | 議題。複数行あり(テーマ欄の Enter は改行)。改名で書き換わる |
| status | TEXT NOT NULL | running / paused / stopped / error / done |
| created_at / updated_at | TEXT NOT NULL | ISO 8601。updated_at は発言追加・状態変更で進む(改名では進めない) |
| max_turns | INTEGER (v1) | 開始時の最大ターン数。旧会話は null(表示側が発言数で代用) |
| mode | TEXT (v2) | モード名(`src/shared/modes.ts` の Mode)。旧会話は null = 対立 |
| config | TEXT (v3) | 実行条件のスナップショット(JSON)。下記 |

`config` の JSON(`ConversationConfig`、全フィールド任意。壊れた JSON は読み手が null に潰す):

```json
{ "firstSpeaker": "gemini", "language": "ja", "app": "0.8.0" }
```

- `firstSpeaker`: 先攻。1 発言目の話者からも復元できるが、0 発言で止まった会話はこれが唯一の記録
- `language`: 議論を走らせた言語(ja / en)
- `app`: 書き込んだアプリの版(データの由来を推理する保険)
- `roles`: ロールプレイの役割(0.9.0 から。`{ "chatgpt": "刑事", "gemini": "容疑者" }`)。他のモードでは書かない
- 将来もここに入るのは「その 1 回の実行条件」だけ。設定の既定値や端末の状態は入れない

### messages

| 列 | 型 | 意味 |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | 発言 ID |
| conversation_id | INTEGER NOT NULL → conversations | 属する会話 |
| speaker | TEXT NOT NULL | chatgpt / gemini。将来「司会介入」を作るときは 'user' を追加してよい(列は増やさない) |
| content | TEXT NOT NULL | 本文のプレーンテキスト(innerText 由来)。**意味を変えない**(原則 2) |
| content_md | TEXT (v3) | 本文の Markdown 版(見出し・コード等を保つ)。直列化できなかった発言・旧行は null。読み手は `contentMd ?? content` |
| prompt | TEXT (v3) | この発言を引き出した送信文の全文(進行役の行込み)。旧行と(将来の)人間の発言は null |
| created_at | TEXT NOT NULL | ISO 8601 |

### messages_fts(FTS5 external content, trigram)

`messages.content` だけを索引する。**content_md や title を索引に足さない**(title は検索側が LIKE で見る。
検索スニペットに Markdown 記号を混ぜないための決定)。同期はトリガ(insert / delete / update)。
削除は CASCADE に頼らず行ごとに DELETE する(トリガを確実に通すため。Repository.deleteConversation)。

## 互換性のふるまい

- 旧 DB を新アプリで開く → 未適用のマイグレーションだけが当たる。旧行の新列は null で、
  読み手はすべてフォールバックを持つ(コピーは content、先攻は 1 発言目の話者、など)
- 新 DB を旧アプリで開く → user_version が既知より大きければ何も適用せず、知らない列は無視される。
  **これを保つために「列の削除・改名・NOT NULL 化・意味変更」を禁じている**(原則 1)

## 入れないと決めたもの(2026-08-30 時点)

- モデル名(確実に取れる根拠がない。必要になったら nullable 列を足す)
- 終了時刻(updated_at で足りる)
- プロンプトの別テーブル(発言 1 : プロンプト 1 なので列で足りる)
- 送信に失敗した試行の記録(成功した発言だけが行になる)
