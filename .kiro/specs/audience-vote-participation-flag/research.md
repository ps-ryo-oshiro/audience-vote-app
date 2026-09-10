# Research & Design Decisions

## Summary
- **Feature**: `audience-vote-participation-flag`
- **Discovery Scope**: Extension（既存のバニラJS + Cloudflare Worker + Firebase RTDB構成の拡張。ライト調査）
- **Key Findings**:
  - 本番の公開URLは、リポジトリ直下がそのまま静的配信されている（`wrangler.jsonc` の `assets.directory: "./"`）。`/README.md`・`/worker.js`・`/wrangler.jsonc`・`/firebase.rules.json`・`/package.json` が200で取得できることを確認した。次回デプロイで `docs/`・`.kiro/`・`CLAUDE.md` なども公開される
  - Worker は `FIREBASE_DB_URL` や KV が未設定だと、検証と保存をスキップしたうえで「成功」を返す（票が消える）。本番の設定漏れが無音の欠票になる
  - 投票画面は、使っていない全投票データを読み込み、接続も張ったままにしている（同時接続100の上限を圧迫する）
  - 投票画面・管理画面は、チーム名を HTML エスケープせずに `innerHTML` へ埋め込んでいる。認証なしで誰でも書き込める構成なので、チーム名に仕込んだスクリプトが来場者全員の端末で動く

## Research Log

### 静的配信の範囲
- **Context**: 要件10.2（配布物に審査アプリの所在を含めない）と要件11.1（接続値をリポジトリに含めない）を検証するため
- **Sources Consulted**: 本番URLへのGET（読み取りのみ）、Cloudflare Workers Static Assets のドキュメント
- **Findings**:
  - `assets.directory: "./"` のため、リポジトリ直下のファイルがすべて配信対象になる
  - `.assetsignore`（assetsディレクトリの直下に置く）に `.gitignore` と同じ書式で書けば、配信対象から外せる
- **Implications**: 配信する6ファイルだけを許可する方式（allowlist）の `.assetsignore` を追加する。`public/` へのファイル移動の方が構造としては正しいが、本番2日前に全ファイルのパスを変えるリスクを避けて見送る。反映後は `wrangler dev` と本番で、非公開ファイルが404になることをcurlで確認する

### Firebase RTDB（新規プロジェクト）
- **Context**: 投票アプリ専用のプロジェクト `audience-vote-2026` を新規作成した（無料プラン、Webアプリ登録済み）。Realtime Database はリージョン `asia-southeast1` で作成する
- **Findings**:
  - 無料プランの同時接続上限は100。投票画面が接続を張ったままにすると、来場者の数だけ接続を消費する
  - REST API（Worker から使用）はリクエスト中だけ接続として数えられる
  - ルールは `.write` を `$voteId` の単位で `!data.exists()` にすれば、「新しく追加するだけ」を許可し、既存の票の変更・削除を拒否できる
  - `firebase.json` の `database.rules` を指定しておけば、`firebase deploy --only database --project audience-vote-2026` でルールを反映できる
- **Implications**: 投票画面は読み込みが終わったら `goOffline()` する。投票データは読み込まない。ルールは `votes` を「追加のみ」にする

### 審査アプリ（judge-app）のチームデータ
- **Context**: 要件12（48チームの流用）
- **Findings**: `/config/teams` に48件あり、項目は `no`・`name`・`department`・`order`。部門は `"ライフ部門"` のような日本語表記。紹介動画のURLはない
- **Implications**: 部門名の対応表（ライフ部門→life、ワーク部門→work、ローカル部門→local）で投票アプリ用に変換するスクリプトを用意する。入力は `firebase-tools database:get` の出力（読み取りのみ）とする。審査アプリのプロジェクトID・URL・接続値はリポジトリに書かない（ルールが全開放のため、IDが分かればDBの場所が分かる）

### Firebase RTDB の multi-path 更新
- **Context**: 登録・追記のとき、他の項目（当日の切替状態など）を消さずに、必要な項目だけを書きたい
- **Findings**: RTDB の REST API の PATCH は、キーにパス（`entry-01/videoUrl` など）を含む multi-path 更新に対応している。`firebase database:update` は PATCH を使う
- **Implications**: パッチはすべて multi-path の形で作る。CLI 経由での挙動は、実装時に空のDBで最初に確認する（design の Risks に記載）

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 現行踏襲（ブラウザからDB直結 + 投票だけWorker経由） | teams/settings は管理画面が直接書き、votes は Worker が書く | 変更が最小。実装済みの部分をそのまま活かせる | 認証なしのため、DBへの直接書き込みを防げない | 採用。リスクは requirements の「既知のリスク」で許容済み |
| 全書き込みをWorker経由にし、DBは閉じる | Worker だけがDB用の秘密鍵を持つ | 直接の改ざんを防げる | 管理画面の書き込み経路を全部作り直す。サービスアカウントの鍵管理が必要 | 本番2日前には過剰なので見送り（本審査後の別仕様の候補） |

## Design Decisions

### Decision: 投票アプリ専用のFirebaseプロジェクト
- **Context**: judge-app に同居すると、審査データを守るためにルートの全開放を外す必要があり、審査サイトが閲覧・評価変更できなくなる
- **Alternatives Considered**:
  1. judge-app に同居してルールを締める — 審査サイトが止まる
  2. judge-app に同居し、ルールは変えない — 審査データを来場者が読み書き・削除できる状態になる
  3. 両アプリに Firebase Authentication を入れる — 他人のアプリの改修が必要で、当日は使わないアプリのために2日前に作業することになる
- **Selected Approach**: 新規プロジェクト `audience-vote-2026`（無料プラン）。judge-app からは読み取りのみでチーム一覧をコピーする
- **Trade-offs**: 管理するプロジェクトが1つ増え、オーナーは1人（照屋さん）になる

### Decision: 管理画面のCSV/Excel取込を廃止し、登録スクリプト + CLI にする（改訂2）
- **Context**: エントリーチームとアプリ名は事前に分かっている（judge-app の48チーム）。紹介動画URLは後から寺司さんが提供する
- **Alternatives Considered**:
  1. 管理画面のCSV取込を残す（実装済みの照合更新を活かす）— 画面を通すための変換・検証・再取込時の状態保護が必要になり、パスワードを知っている人なら誰でもチームを追加できる状態も残る
  2. 開発担当者が CLI で直接登録・追記する
- **Selected Approach**: 2。`scripts/team-patch.mjs` が multi-path パッチを作り、`database:update` で必要な項目だけを書く。チームIDはエントリーNoから `entry-NN` と決め、No で確実に更新できるようにする
- **Rationale**: 取込まわりのコード（照合・検証・Excel読み込み）を丸ごと削れる。登録の操作者はDBのオーナー（照屋さん）だけなので、運用とも合う
- **Trade-offs**: 登録・修正が開発担当者に依存する（requirements の既知のリスク5）。実装済みの取込改修（旧タスク2.1）は使わなくなる

### Decision: 本戦確定チームは判定規則で常に表示する（改訂2）
- **Context**: 本戦12チームは常に表示し、管理画面の切替対象は敗者復活候補だけにする
- **Alternatives Considered**:
  1. 本戦も `participating: true` で登録し、管理画面でチェックボックスを出さないだけにする — DBの値が何かの理由で `false` になると、本戦チームが消える
  2. `finalist` を持たせ、表示判定を `finalist || participating` にする
- **Selected Approach**: 2。投票画面・Worker・管理画面の3か所で同じ判定関数を使う
- **Trade-offs**: 同じ関数を3ファイルに重複して置く（ビルドがなく共有モジュールを持てないため）。Revalidation Triggers に「3か所で揃える」ことを明記した

### Decision: 登録の再実行で当日の状態を壊さない
- **Context**: 本戦のNo一覧の訂正などで `seed` を再実行することがありうる
- **Selected Approach**: `--current` で現在のチーム一覧を渡し、既存チームには `finalist`（と本戦の `participating: true`）だけを書く。動画URLの追記は `videoUrl` だけ、名称の修正は `title` だけを書く
- **Rationale**: 要件2.3・12.2を仕組みで満たし、当日ONにした候補チームが戻る事故を防ぐ

### Decision: 設定漏れを「成功」扱いにしない
- **Context**: Worker は `FIREBASE_DB_URL` が未設定だと検証・保存をスキップし、KV がないとメモリ上の Map を使う
- **Selected Approach**: どちらかが欠けていれば500 `server_misconfigured` を返す。ブラウザは Firebase の設定があるときだけ Worker を呼ぶので、Worker が呼ばれたのに設定がないのは、常に本番の設定漏れである。`wrangler dev` では、設定ファイルにKVが定義されていればローカルのKVが使われるため、フォールバックは不要
- **Trade-offs**: 設定漏れのままでは投票できなくなる。ただし票が静かに消えるより、すぐ気づける

### Decision: 接続値の置き場所
- **Selected Approach**:
  - ブラウザ用: `firebase-config.js` を git の管理から外し、ひな形 `firebase-config.example.js` を置く。デプロイ時は手元のファイルが配信される
  - Worker用: `FIREBASE_DB_URL` は `wrangler secret put` で本番に設定し、ローカルでは `.dev.vars`（git管理外・配信対象外）に書く
  - KV の namespace ID は秘密情報ではないので、`wrangler.jsonc` に書く

### Decision: 表示時のHTMLエスケープ
- **Context**: 認証なしで `teams` に誰でも書き込めるため、チーム名に仕込まれたスクリプトが来場者の端末で動くおそれがある（既知のリスク1の影響が、改ざんからスクリプト実行にまで広がる）
- **Selected Approach**: 投票画面・管理画面でチーム名・URLを差し込む箇所をエスケープする。動画URLは `http(s)://` で始まる場合だけリンクにする
- **Rationale**: 数行の追加で、既知のリスクの影響を「表示の改ざん」までに抑えられる

### Synthesis
- **Generalization**: 「設定がないときの挙動」は、ブラウザ（デモモードに切り替える）と Worker（エラーにする）で方針を分けた。ブラウザのデモモードは開発用で、Worker は本番でしか呼ばれないため
- **Build vs Adopt**: ルールの反映は Firebase CLI を使う。配信対象の制御は Wrangler の `.assetsignore` を使う。独自の仕組みは作らない
- **Simplification**: 投票画面の投票データ読み込みと、Worker のメモリ上のフォールバックを削除する

## Risks & Mitigations
- Cloudflare のデプロイ先アカウントが未確定（現行は大城さんのアカウント）— 実装前に確定する。アカウントを変えると公開URLも変わるため、QRコードは新しいURLで作る
- 本戦12チームの一覧が未入手 — 登録スクリプトの実行時に、エントリーNoの一覧として受け取る
- `.assetsignore` の書き方の誤りで必要なファイルまで配信されなくなる — `wrangler dev` と本番の両方で、公開ファイルが200・非公開ファイルが404になることを確認する
- 同時接続の実数は当日まで検証できない — 設計上、投票画面の接続は読み込み中の数秒だけにする

## References
- [Cloudflare Workers Static Assets — .assetsignore](https://developers.cloudflare.com/workers/static-assets/binding/) — 配信対象から外すファイルの指定方法
