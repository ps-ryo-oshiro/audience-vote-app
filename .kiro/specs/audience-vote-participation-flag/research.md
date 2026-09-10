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

---

# Gap Analysis（2026-09-10 20:00 時点のコード）

## 分析の前提
- 対象のコード: HEAD `04dce0f`（投票画面のデザイン刷新）に、別セッションで作業中の未コミット差分（`app.js` の `safeVideoUrl`）を加えた状態
- 投票画面（`index.html`・`app.js`・新規 `vote.css`）は、デザイン刷新のために別セッションが並行して編集中。管理画面（`admin.js`・`admin.html`）と `worker.js` は、コミット `fb06b4a` 以降変更されていない
- steering（`.kiro/steering/`）は未作成。本分析はコードと spec だけを根拠にしている

## Current State
| 領域 | ファイル | 現状 |
|------|----------|------|
| 投票画面 | `app.js`（451行）、`index.html`、`vote.css`（新規・708行） | テーマ切替・送信演出・完了オーバーレイ付きの新デザイン。データ層（Firebase/localStorage 切替、`/api/vote`、409判定）は旧実装を踏襲。`escapeHtml` あり。動画URLは `safeVideoUrl` で http(s) 以外を `#` にする（リンク自体は常に出す）。表示判定は `participating === true` だけ。票を読み込んでいる。接続は張ったまま。Google Fonts を外部から読み込む |
| 管理画面 | `admin.js`（388行）、`admin.html`、`style.css` | CSV/Excel取込（`mergeTeams`・`validateRows`・xlsx.js）、匿名認証、参加チェックボックス（全チーム対象）が残っている。チーム名はエスケープしていない |
| 投票API | `worker.js`（78行） | チームの検証と票の保存は実装済み。`FIREBASE_DB_URL` 未設定時は検証・保存をスキップして200、KV未設定時はメモリ上の Map。表示判定は `participating !== true` で403 |
| 設定 | `wrangler.jsonc` | `assets.directory: "./"`、`not_found_handling: "single-page-application"`。KV binding なし |
| 設定 | `firebase-config.js`（git管理下）、`firebase.rules.json`（匿名認証前提のハイブリッド案） | どちらも設計どおりの形になっていない |
| 登録手段 | なし | judge-app からの変換・登録の仕組みはない |

## Requirement-to-Asset Map

| 要件 | 対応する資産 | ギャップ |
|------|--------------|----------|
| 1.1 項目の保持 | チームデータ | **Missing**: `entryNo`・`finalist` がない |
| 1.2 本戦は常に表示 | `app.js` `readTeams`、`worker.js`、`admin.js` | **Missing**: 3か所とも `participating` だけで判定している |
| 1.3, 1.4 初期値・未設定 | `app.js` のフィルタ（`=== true`） | 1.4 は充足。1.3 は登録スクリプトがないため **Missing** |
| 2.1〜2.5 事前一括登録 | なし | **Missing**: 登録スクリプト全体 |
| 2.6 取込機能を置かない | `admin.js`・`admin.html` の取込 | **Missing**（削除が必要） |
| 3.1〜3.6 候補の表示切替 | `admin.js` のチェックボックス（全チーム） | **Missing**: 本戦と候補の区別、表示中の数、失敗時のメッセージ。即時反映（3.4）・保存（3.5）・失敗時にチェックを戻す処理は既存 |
| 4.1〜4.3 表示の絞り込み | `app.js` | 充足（ただし 1.2 の判定変更が必要） |
| 4.4 動画URLがなければリンクを出さない | `app.js` `safeVideoUrl` | **Missing**: URLがなくても VIDEO リンクを `#` で出す |
| 4.5 ログインなし | `app.js`・`worker.js` | 充足 |
| 4.6, 4.7 No表示・No順 | `app.js` `renderTeams` | **Missing** |
| 5.1, 5.2 集計 | `admin.js` | 充足 |
| 6.1〜6.4 検証と保存 | `worker.js` | 充足。ただし設定漏れ時に黙って成功する（11.4 の **Constraint**） |
| 7.1, 7.2 二重投票 | `worker.js` | **Missing**: KV binding がなく、メモリ上の Map に落ちる |
| 8.1, 8.2 認証なしの管理操作 | `admin.js`、`firebase.rules.json` | **Missing**: 匿名認証と、それを前提としたルールが残っている |
| 8.3 受付停止時の無効化 | `app.js` `isLocked` | 充足 |
| 9.1, 9.2 入室ID | `admin.js`、`firebase-config.js` | 9.2 は充足。9.1 は保留中（ユーザー指示） |
| 10.1, 10.5 専用DBとルール | `firebase.rules.json` | **Missing**: 専用DBのルールを未反映（ロックモードのまま） |
| 10.2 配布物に judge-app の所在を含めない | `wrangler.jsonc` | **Constraint**: リポジトリ直下を全部配信している。SPAの設定のため、除外したパスも404ではなく `index.html` を返す |
| 10.3, 10.4 judge-app を変えない | 運用 | 手順書がない |
| 11.1〜11.3 接続値の管理 | `firebase-config.js` | **Missing**: git管理下にある。ひな形がない。Worker の secret が未設定 |
| 11.4 Worker と同じDB | `worker.js` | **Constraint**: 設定漏れ時に黙って成功する |
| 11.5 設定がなければデモモード | `isFirebaseConfigured` | 充足（`wrangler dev` では、SPAの設定のため `firebase-config.js` が `index.html` として返り、コンソールにエラーが出る） |
| 12.1〜12.4 追記・修正 | なし | **Missing** |
| 13.1, 13.2 常時接続を持たない | `app.js` | **Missing**: 票を読み込み、接続も張ったまま |
| 13.3 読み込み失敗時の案内 | `app.js` 起動時の `catch` | **Missing**: 例外メッセージをそのまま出す（再読み込みの案内がない） |

## 設計（design.md）に反映が必要な差分
1. **配信の許可リストに `vote.css` がない**: デザイン刷新で追加された。許可リストが6ファイルのままだと、本番で投票画面のスタイルが消える
2. **`not_found_handling: "single-page-application"`**: 除外したパスや存在しない `firebase-config.js` が `index.html`（200）として返る。この画面はクライアント側のルーティングを使っていないので、設定を外して404を返すのが素直
3. **本戦から外れたチームの扱い**: `seed` を再実行して本戦から外したチームは、`finalist: false` だけが書かれ、`participating: true` が残って表示され続ける。外すときは `participating: false` も書く必要がある
4. **動画リンクの扱い**: 刷新後の画面は `safeVideoUrl` で `#` を返してリンクを常に出す。要件4.4に合わせて、URLがなければリンク自体を出さないようにする必要がある
5. **投票画面のファイル構成**: design の File Structure Plan に `vote.css` を加え、`style.css` は管理画面だけのスタイルになったことを記す

## Implementation Approach Options

### Option A: 既存ファイルの拡張だけで対応する
- 登録もスクリプトを作らず、手でJSONを書いて `database:update` する
- ✅ 新規ファイルが最少
- ❌ 48件の手作業による転記ミス（要件2の目的に反する）。本戦から外したときの状態の直し漏れが起きやすい

### Option B: 登録・配信・設定の仕組みを新規ファイルで分ける（design の現行方針）
- 画面と API は既存ファイルを直し、登録スクリプト・`.assetsignore`・ひな形・`firebase.json` を追加する
- ✅ 役割が分かれ、登録の再実行や追記を安全に行える
- ❌ 追加ファイルが5つ（うち1つは手順書）

### Option C: 投票画面を刷新セッションの完了後にまとめて直す（B の実施順序の変形）
- 管理画面・Worker・設定・登録スクリプトを先に進め、投票画面（`app.js`）の改修は、デザイン刷新のセッションが終わってから行う
- ✅ 同じファイルを2つのセッションが同時に編集して衝突するのを避けられる
- ❌ 投票画面の改修（1.2・4.4・4.6・4.7・13）が後ろにずれ、結合確認がその分遅れる

## Effort / Risk
- **Effort: S（1〜3日）** — 既存パターンの延長で、新しい外部依存はない。変更は画面2つ・Worker・設定・小さなスクリプト
- **Risk: Medium** — 技術的には既知の範囲だが、(1) 期限が2日後、(2) 投票画面を別セッションが同時に編集中、(3) 本戦No一覧と Cloudflare アカウントという外部の前提が未解決

## Recommendations
- 方針は Option B（design の現行方針）のまま。実施順序は Option C を取り、`app.js`・`index.html`・`vote.css` には、デザイン刷新のセッションが作業を終えてから触る
- 上の「設計に反映が必要な差分」1〜5を design.md に反映してから、タスク表を確定する
- **Research Needed**:
  - `firebase database:update` での multi-path パッチの挙動（空のDBで最初に確認する）
  - `.assetsignore` の否定パターン（`!file`）が Wrangler で期待どおり効くか（`wrangler dev` で確認する）
  - `not_found_handling` を外したときに、`/` が `index.html` を返すこと（Static Assets の既定の挙動）
