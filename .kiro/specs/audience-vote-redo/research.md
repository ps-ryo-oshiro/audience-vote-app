# Research & Design Decisions

## Summary

- **Feature**: `audience-vote-redo`
- **Discovery Scope**: Extension（既存システムへの機能追加。Light Discovery を適用）
- **Key Findings**:
  - 票の保存先である Firebase Realtime Database は `firebase.rules.json` により `votes/$voteId` が「新規追加のみ可・削除と上書き不可」に固定されている。認証を使わない設計における唯一の整合性の防御線であり、緩めると `votes` が全員読み取り可であるため第三者による票の改ざんが成立する。したがって「前の票を消す」方式は採用できない。
  - 二重投票防止は Cloudflare Workers KV の `voter:{voterToken}` に値 `'1'` を書き込み、存在すれば 409 を返す実装（`worker.js`）。値が固定文字列のため、**値を送信回数に置き換えるだけで回数制限に拡張できる**。既存の `'1'` は「1回送信済み」と自然に解釈でき、本番KVに残っている既存レコードとの後方互換が保てる。
  - `worker.js` は現在 `audienceApp/settings` を一切参照していない。受付停止の判定は投票画面のクライアント側だけで行われており、サーバー側の防御がない。やり直し解禁にあたってはここを塞ぐ必要がある。
  - `admin.js` の votes 購読は `Object.values(snapshot.val())` でありプッシュキーを捨てている。同一時刻の票の順序決定にプッシュキー（時系列単調増加）を使えるようにするため、`Object.entries()` へ変更する必要がある。
  - `app.js` は起動時に `settings` を1回だけ読み `db.goOffline()` する設計（常時接続を持たない方針）。受付状態のリアルタイム反映は既存仕様上も行われていないため、締め切り直後のやり直しはサーバー側で拒否する設計が必須。

## Research Log

### 票の保存先の書き込み制約

- **Context**: 「前回の投票情報は削除される」という当初の要望が実現可能か。
- **Sources Consulted**: `firebase.rules.json`、`docs/DEPLOY.md`（2-2 の IMPORTANT 注記）、`.kiro/specs/audience-vote-participation-flag/design.md`
- **Findings**:
  - ルールは `"$voteId": { ".write": "!data.exists() && newData.exists()" }`。既存ノードへの書き込みと削除の双方が拒否される。
  - `votes` は `.read: true`（管理画面が認証なしで集計するため必須）。
  - 手順書に「動作確認中でも緩めない」と明記されている。
- **Implications**: 物理削除・物理上書きの両方が設計候補から外れる。票の無効化は集計側の判定で表現するしかない。

### KV の値の拡張余地と整合性モデル

- **Context**: やり直し回数（3回）をどこで数えるか。
- **Sources Consulted**: `worker.js`、`wrangler.jsonc`、Cloudflare Workers KV の整合性モデル
- **Findings**:
  - 現状の値は固定文字列 `'1'`、TTL 30日。
  - KV は結果整合であり、アトミックなインクリメント操作を持たない。読み取り→加算→書き込みの間に競合が起こりうる。
  - 一方、投票画面は送信中に `phase = SENDING` で送信ボタンをロックしており、同一端末からの並行送信は実質的に起こりにくい。
- **Implications**: 値を送信回数に拡張する方式を採用。競合による上限超過（最大でも数件）は本イベント規模では許容し、既知のリスクとして記録する。厳密な排他が必要になった場合は Durable Objects への移行が選択肢になるが、現時点では過剰。

### 受付状態のサーバー側検証

- **Context**: 受付停止後にやり直しができてしまう経路を塞ぐ必要がある。
- **Sources Consulted**: `worker.js`、`app.js`（起動処理と `goOffline()`）、`admin.js`（`settings` の書き込み）
- **Findings**:
  - `settings` は `{ isOpen: boolean }` のみ。REST（`{DB_URL}/audienceApp/settings/isOpen.json`）で単一の真偽値として取得できる。
  - 投票画面は受付状態を起動時に1回しか読まないため、画面を開いたまま締め切られた場合はクライアント側では検知できない。
- **Implications**: `/api/vote` で毎回 `isOpen` を検証する。やり直しに限らず初回投票にも適用することで、分岐を増やさずに防御を強化できる（Simplification）。1投票あたりの外部読み取りは 2 回（settings と team）になるが、想定規模（来場者200名程度）では問題にならない。

### 有効票の決定順序

- **Context**: 同一投票者の「最後の票」をどう一意に決めるか。
- **Sources Consulted**: `worker.js`（`votedAt` の生成箇所）、Firebase push ID の仕様
- **Findings**:
  - `votedAt` は Worker 側で `Date.now()` により付与される。クライアントの時刻に依存しないため信頼できる。
  - ただしミリ秒単位の同値は起こりうる。Firebase の push ID は生成時刻を先頭に持つ辞書順ソート可能なキーであり、同一ミリ秒でも順序が決まる。
- **Implications**: 有効票の決定は `votedAt` の降順を第1キー、プッシュキーの降順を第2キーとする。`admin.js` の votes 購読を `Object.entries()` に変更してキーを保持する。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A. 物理削除 | やり直し時に前の票を Worker 経由で削除する | 集計ロジックが現状のまま | ルールの緩和が必須。`votes` は全員読み取り可のため、トークンを収集した第三者が任意の票を削除・改変できる | **不採用** |
| B. 投票者キーで1レコード | `votes/{voterTokenHash}` に上書き保存 | 集計が自然に1人1票。DB肥大なし | ルールで上書き許可が必要。監査証跡が残らない。A と同じ改ざんリスク | **不採用** |
| C. 追記 + 最新票のみ有効（採用） | 票は追記し続け、集計側で同一投票者の最新1件だけを数える | ルール無変更。監査証跡が残る。改ざん経路を増やさない | 集計側に重複排除ロジックが必要。レコードが投票者あたり最大4件に増える | **採用** |
| D. 取り消しイベントの追記 | 「取り消し」レコードを追記して打ち消す | 意図が明示的 | C と同じ結果をより多いレコード数と複雑な集計で実現するだけ | **不採用**（Simplification） |

## Design Decisions

### Decision: 票の無効化を「物理削除」ではなく「集計時の最新票選択」で表現する

- **Context**: Requirement 4（集計での有効票の決定）と Requirement 5（投票記録の保全）を、既存のセキュリティルールを変えずに満たす必要がある。
- **Alternatives Considered**:
  1. 物理削除（Option A）— ルール緩和が必要
  2. 投票者キーでの上書き（Option B）— ルール緩和が必要、証跡が消える
  3. 追記 + 最新票のみ有効（Option C）
- **Selected Approach**: 票は常に追記する。管理画面の集計時に `voterToken` でグルーピングし、`votedAt` とプッシュキーで最後の1件を有効票として選び、それ以外を「やり直しにより無効」として件数のみ提示する。
- **Rationale**: 認証を使わない前提での唯一の整合性担保であるルールを維持できる。投票者から見た挙動は物理削除と区別がつかない。過去の票が残るため、集計に疑義が出たときに経緯を追える。
- **Trade-offs**: 集計側に重複排除が入り、これを誤ると票が二重計上される。投票レコードは投票者あたり最大4件になる（来場者200名で最大800件、RTDB の規模としては無視できる）。
- **Follow-up**: `computeVoteCounts` に渡る前に必ず有効票へ絞り込まれていることを、部門別集計・全体集計・オーディエンス賞判定の3経路すべてで確認する。

### Decision: KV の値を「送信回数の10進文字列」にする

- **Context**: Requirement 2.5（端末の状態に依存しない回数判定）を満たす必要がある。
- **Alternatives Considered**:
  1. JSON オブジェクト（`{ n, t }`）— 拡張性は高いが現時点で不要な情報を持つ
  2. 送信回数の10進文字列（`'1'`, `'2'`, ...）
  3. Durable Objects でアトミックカウンタ — 厳密だが本件には過剰
- **Selected Approach**: `voter:{voterToken}` の値を送信回数の10進文字列とする。上限は4（初回1回 + やり直し3回）。
- **Rationale**: 既存値 `'1'` がそのまま「1回送信済み」と解釈でき、本番KVに残っている既存レコードの移行作業が不要になる。パースも `Number.parseInt` 1行で済む。
- **Trade-offs**: KV に原子的な加算がないため、極端な並行送信で上限を1〜2回超える可能性がある。送信中のUIロックで実用上は防げる。
- **Follow-up**: TTL（30日）は現行どおり維持し、上書き時にも毎回付け直す。

### Decision: `/api/vote` で受付状態をサーバー側検証する

- **Context**: Requirement 3.2 / 3.4。投票画面は受付状態を起動時に1回しか読まない。
- **Alternatives Considered**:
  1. 投票画面で `settings` を購読して即時反映する — 既存の「常時接続を持たない」方針（`goOffline()`）に反する
  2. Worker で毎回 `isOpen` を検証する
- **Selected Approach**: `/api/vote` の先頭で `audienceApp/settings/isOpen` を読み、`false` なら 403 `voting_closed` を返す。やり直しに限らず全ての投票送信に適用する。
- **Rationale**: 分岐を増やさずに既存の穴（受付停止後もAPIが通る）も同時に塞げる。クライアントの常時接続方針を変えずに済む。
- **Trade-offs**: 1投票あたりの外部読み取りが1回増える。
- **Follow-up**: `isOpen` が未設定（`null`）の場合は「受付中」と解釈する（既存のデフォルト挙動と揃える）。

### Decision: 共有判定ロジックはファイルをまたいで複製する

- **Context**: `app.js`・`admin.js`・`worker.js` はバンドラを使わない素のスクリプトで、モジュール共有の仕組みがない。既存の `isVisibleTeam` は3ファイルに同一コード＋「3か所で揃える」コメントで複製されている。
- **Selected Approach**: 同じ方式を踏襲する。新たに複製するのは投票回数の上限定数のみ（`app.js` と `worker.js`）。有効票の選定は管理画面でしか使わないため `admin.js` のみに置く。
- **Rationale**: 既存の慣習と一致し、ビルド工程を導入しない。複製範囲は最小に抑える。
- **Trade-offs**: 定数の同期漏れのリスク。既存と同じコメント規約で明示する。

### Decision: やり直し回数に上限を設けない

- **Context**: 当初は上限3回（送信最大4回）で設計したが、「1日しか使わないシステムなので、受付中は納得するまで選び直せるようにしたい」との判断があった。
- **Alternatives Considered**:
  1. 上限3回のまま
  2. 上限を10回程度に緩める（体感は無制限、保険は維持）
  3. 完全に無制限
- **Selected Approach**: 3。Worker の上限判定を削除し、409 `redo_limit_reached` を廃止する。`remainingRedo` の返却とクライアントの残り回数表示も廃止する。KV の送信回数は記録としてのみ書き続ける。
- **Rationale**: 負荷面のリスクは小さい。やり直しは Worker 経由であり、投票者のブラウザは Firebase に接続しない（起動直後に `goOffline()`）ため、**やり直しが増えても同時接続数は増えない**。100人×20回でもリクエストは2,000件で、無料枠（1日10万）に十分収まる。票レコードは1件約120バイトで、数千件になっても容量上の問題はない。
- **Trade-offs**:
  - 失われる保険1: 他人の票を書き換える攻撃（`votes` から生の `voterToken` を収集できる）の被害上限がなくなる。受付中は何度でも書き換えられる
  - 失われる保険2: 集計の重複排除にバグがあった場合、票数の水増しに上限がなくなる
  - 管理画面の再描画コストが総票数に比例して増える（通信量は差分同期のため増えない）
- **Follow-up**: リスクを緩和したくなった場合は、`voterToken` の salt 付きハッシュ化を別仕様で検討する。KV に送信回数を記録し続けているため、当日澫用が見つかった場合は定数を戻すだけで上限を再導入できる。

## Risks & Mitigations

- **集計の二重計上** — 重複排除を通さない集計経路が1つでも残ると票数が水増しされる。しかもやり直し回数に上限がないため、水増しの規模にも上限がない。`renderAggregates` の入口で1度だけ有効票に絞り、以降の関数はすべてその結果を受け取る構造にする。
- **`voterToken` が `votes` から読める** — 第三者がトークンを収集し、他人の票を受付中に**何度でも**書き換えうる。本仕様ではハッシュ化も回数上限も対象外としたため、**受容するリスクとして明記する**。緩和したい場合は Worker 側で salt 付きハッシュを保存する別仕様が必要。
- **管理画面の再描画負荷** — 票が1件入るたびに全票を走査して48チーム分の表を作り直す。票が数千件まで膚らみ、かつ投票終盤に更新が集中するともたつく可能性がある。当日問題になる場合は管理画面を一旦閉じて必要なときだけ開く。
- **投票完了画面をリロードするとやり直せなくなる** — リロード後は「投票済み」としてロックされ、やり直し操作は提示されない。直前の票は有効なままなので結果は壊れないが、投票者の意図と食い違う可能性がある。既知の制約として Non-Goals に記載する。
- **やり直し後に再投票せず離脱** — 前の票が有効なまま残る。仕様どおりの挙動であり、集計上の不整合は生じない。

## References

- `firebase.rules.json` — `votes` の追記のみ許可ルール
- `docs/DEPLOY.md` 2-2 — ルールを緩めない旨の運用上の指示
- `.kiro/specs/audience-vote-participation-flag/design.md` — 既存の投票フローと二重投票防止の設計
- [Firebase Realtime Database セキュリティルール](https://firebase.google.com/docs/database/security) — 書き込みルールの評価規則
- [Workers KV](https://developers.cloudflare.com/kv/) — 結果整合モデルとアトミック操作の非対応
