# Brief: audience-vote-participation-flag

## Problem

社内AIコンテスト「AI爆速アプリコンテスト」本審査（2026/9/12(土)10:00〜、既に本番デプロイ済みのCloudflare Workersアプリで運用予定）で、来場者投票により「オーディエンス賞」を決定する。本戦進出12チーム（確定済み）に加え、当日会場に観覧参加した予選落選チームも投票対象に追加したい（いわゆる敗者復活枠）が、現状のチームデータ構造・管理画面・投票画面には「投票対象に含めるかどうか」を制御する仕組みが一切存在しない。運営担当者（管理画面の利用者）がこの追加作業をできず、当日の運用が回らない。

## Current State

- チームデータは `{id, title, section, videoUrl}` のみで、参加確定/非確定の状態を持たない
- 管理画面(`admin.js`)のCSVアップロードは、Firebase使用時は既存チームを**全置換**、localStorage使用時は**無条件追加**という非対称な挙動で、事前登録→当日追加という運用に耐えない
- 投票画面(`app.js`)はteams一覧を無条件表示するため、追加した全チームがそのまま投票対象になってしまう
- Cloudflare Worker(`worker.js`)の`/api/vote`は、Firebase使用時でも投票データ(`audienceApp/votes`)を一切永続化していない重大バグがあり、集計が常に0件になる
- `firebase-config.js`は未設定（プレースホルダー）で、Firebase未接続のlocalStorageフォールバックモードで稼働中
- `firebase.rules.json`は`teams`/`settings`書き込みに`auth != null`を要求するが、`admin.js`はFirebase Authを一切使っておらず、本番接続時に書き込みが失敗しうる
- KV namespace(`AUDIENCE_VOTES`)が未バインドで二重投票防止がインメモリMapにフォールバックしている
- 管理者ログインID/パスワードが`firebase-config.js`に平文で入っており、公開URLから誰でも閲覧可能

## Desired Outcome

- 運営担当者が、本戦12チーム＋落選候補チームを**事前に全件CSV登録**しておき、当日は管理画面のチェックボックス操作だけで各チームを「投票対象に含める(参加確定)」状態にできる
- 投票画面には「参加確定」状態のチームのみが表示され、本戦チームと敗者復活枠チームは**見た目上まったく区別されない**
- オーディエンス賞の集計（優勝判定・全体集計）は、参加確定した全チームを**同列**に扱う
- 投票データが実際にFirebaseへ保存され、複数端末からの投票が正しく集計される
- 二重投票防止が実際に機能し、管理者パスワードが安全な値に変更されている
- 2026/9/12(土)の本審査開始までに本番環境で確実に動作する

## Approach

既存のシンプルなバニラJS構成（フレームワーク・ビルドなし）を維持し、新規モジュールは作らず既存ファイル内の関数追加・修正のみで対応する。

1. チームオブジェクトに `participating: boolean`（デフォルト`false`）を追加
2. `admin.js`のCSV取込を、`section`+`title`をキーにした upsert（既存更新・新規追加、`participating`はCSV指定時のみ上書き）に修正し、Firebase版の全置換バグを解消
3. `admin.js`の全体集計テーブルに参加フラグON/OFFチェックボックスを追加
4. `app.js`の`readTeams()`で`participating === true`のみ表示するフィルタを追加
5. `worker.js`の`/api/vote`に、Firebase RTDB REST API（Admin SDK・サービスアカウントなし、公開REST APIをfetchするのみ）経由でのteamId実在検証・participating検証・投票データ永続化を追加（votes未保存バグも同時修正）
6. `firebase.rules.json`をハイブリッド案（teams/settings書き込みを`true`に緩和、votes読み取りのみ`auth != null`維持）に変更し、`admin.js`に`signInAnonymously()`を追加してauth不整合を解消
7. Firebase実プロジェクト接続、KV namespaceバインド、管理者パスワード変更などの本番インフラ設定

## Scope

- **In**: チームの参加確定フラグ管理（データモデル・管理画面UI・投票画面フィルタ）、CSV取込のupsert化、Worker側のteamId/参加フラグ検証と投票データ永続化バグ修正、Firebase Auth不整合解消、二重投票防止のKVバインド、管理者パスワード変更
- **Out**: 部門賞・実用性評価など投票システム外の審査プロセス、投票のリアルタイム反映（ライブ更新）、独自ドメイン設定、CI/CD自動化、テスト基盤の新設、本戦確定チームと敗者復活枠チームを区別する表示（見た目UI）

## Boundary Candidates

- データモデル+管理画面（CSV upsert、参加フラグUI）
- 投票画面（表示フィルタ）
- Worker/API（teamId検証、votes永続化）
- Firebase設定・インフラ（ルール変更、認証、KV、実プロジェクト接続）

## Out of Boundary

- 本戦確定チームと敗者復活枠チームの見た目上の区別（表示ラベル・バッジ等）は明示的に不要（同列表示の方針）
- 部門賞・総合グランプリなど、オーディエンス賞以外の審査ロジック
- 投票のライブ更新（`.on('value')`化）
- 独自ドメイン設定、GitHub Actions等のCI/CD自動化

## Upstream / Downstream

- **Upstream**: 既存のCloudflare Workers本番デプロイ環境、既存のFirebase RTDB構成案（`firebase.rules.json`）、`docs/DEPLOY.md`に記載済みの本番公開前チェックリスト
- **Downstream**: 本審査当日（2026/9/12）の運営オペレーション（受付時のチーム参加ON操作、オーディエンス賞の発表）

## Existing Spec Touchpoints

- **Extends**: なし（既存specは未作成、本specが最初のspec）
- **Adjacent**: `docs/DEPLOY.md`のデプロイ手順・公開前チェックリストと内容が重複しないよう、実装完了時にはこのdocも整合させる

## Constraints

- 本審査当日は2026年9月12日(土)10:00〜、実質2日弱で本番投入まで完了させる必要がある（最短ルート優先、フルレビューゲートは省略可）
- 新規モジュール・新規ファイル構成は作らず、既存ファイル（`admin.js`, `app.js`, `worker.js`, `firebase.rules.json`, `wrangler.jsonc`, `firebase-config.js`）内の関数追加・修正に留める
- Firebase Admin SDK・サービスアカウントは導入しない。Worker側からのFirebase読み書きは公開REST API（fetch）のみで行う
- テスト基盤（Jest等）の新設は行わない。動作確認は`npm start`（localStorageモード）と`wrangler dev`（Firebase接続後）、実機テストで行う
- フレームワーク・ビルドツールは導入しない（現状のバニラJS構成を維持）
