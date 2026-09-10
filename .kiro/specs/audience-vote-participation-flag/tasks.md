# Implementation Plan

- [x] 1. データモデル基盤整備
- [x] 1.1 チームデータへの参加フラグ追加とデフォルトデータ更新
  - `admin.js`と`app.js`の`DEFAULT_TEAMS`に`participating: true`を追加する
  - 観測可能な完了条件: `npm start`起動時、デモチームが投票画面・管理画面の双方に表示される
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. チーム登録・参加管理（管理画面）
- [x] 2.1 (P) CSV/Excel取込のupsert化
  - `section`+`title`キーで既存チームと照合し、一致するチームは情報更新、一致しないチームは`participating: false`で新規追加する`mergeTeams`関数を実装する
  - CSV側で`participating`列の明示指定がない限り、既存チームの参加状態を上書きしない
  - `validateRows`を拡張し、`participating`列（`true`/`1`/`on`/`yes`）を任意でパースする
  - Firebase使用時は全置換の`.set()`ではなく、マージ結果をキー単位の`update()`で書き込む
  - 観測可能な完了条件: 同じチームを含むCSVを2回アップロードしても重複登録されず、既存チームの参加フラグが変化しない
  - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - _Boundary: Team Management Service (admin.js)_

- [x] 2.2 (P) 参加フラグ切替UIの追加
  - 全体集計テーブル（`renderGlobalResults`）に参加フラグのチェックボックス列を追加する
  - チェックボックス変更時に該当チームの参加状態のみをFirebase/localStorageへ即時反映し、テーブル全体は再描画しない
  - 観測可能な完了条件: チェックボックス操作で管理画面上のチーム参加状態が即座に切り替わり、ページ再読み込み後も状態が保持される
  - _Requirements: 3.1, 3.2, 3.3_
  - _Boundary: Admin Dashboard (admin.js, admin.html)_
  - _Depends: 1.1_

- [x] 3. 投票画面のフィルタリング
- [x] 3.1 (P) 参加確定チームのみの表示
  - `app.js`の`readTeams()`に、`participating === true`のチームのみを`appState.teams`へ残すフィルタを追加する
  - 観測可能な完了条件: 参加フラグOFFのチームが投票画面の一覧に表示されない
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: Voting Page (app.js)_
  - _Depends: 1.1_

- [ ] 4. Firebase接続基盤の整合性確保
- [ ] 4.1 Firebaseセキュリティルールのハイブリッド化
  - `firebase.rules.json`の`teams`/`settings`の`.write`を`true`に緩和し、`votes`の`.read`は`auth != null`のまま維持する
  - 観測可能な完了条件: ルールファイルの内容がハイブリッド案（teams/settings書き込み自由、votes読み取りのみ認証必須）どおりになっている
  - _Requirements: 8.1_

- [ ] 4.2 管理画面への匿名認証追加
  - `admin.html`に`firebase-auth-compat.js`のscriptタグを追加する
  - `admin.js`のログイン処理（Firebase使用時）に`firebase.auth().signInAnonymously()`を追加し、失敗時はエラーメッセージを表示する
  - 観測可能な完了条件: Firebase接続時に管理者ログインが成功し、`votes`の読み取り（集計表示）が可能になる
  - _Requirements: 8.1_
  - _Depends: 4.1_

- [ ] 5. 投票API（Worker）の検証・永続化強化
- [ ] 5.1 (P) チーム実在・参加状態の検証
  - `worker.js`に`getTeam(env, teamId)`関数を新設し、teamIdの文字種チェック・Firebase RTDBからの実在確認を行う
  - `/api/vote`ハンドラに、二重投票チェック通過後の位置でteamId不在時400・参加状態OFF時403を返す分岐を追加する
  - 観測可能な完了条件: 存在しないteamIdへのPOSTが400 `invalid_team`、参加フラグOFFのチームへのPOSTが403 `team_not_participating`を返す
  - _Requirements: 6.1, 6.2, 6.3_
  - _Boundary: Voting API (worker.js)_

- [ ] 5.2 (P) 投票データの永続化
  - `worker.js`に`recordVote(env, teamId, voterToken)`関数を新設し、検証を通過した投票をFirebase RTDB REST API経由で`audienceApp/votes`へPOSTする
  - KVへの投票済みフラグ書き込みは、この永続化が成功した後に行う
  - 観測可能な完了条件: 有効な投票後、`audienceApp/votes`に新しいレコード（teamId, voterToken, votedAt）が作成される
  - _Requirements: 6.4_
  - _Boundary: Voting API (worker.js)_
  - _Depends: 5.1_

- [ ] 6. インフラ設定の反映
- [ ] 6.1 Worker環境変数とKVバインドの追加
  - `npx wrangler kv namespace create AUDIENCE_VOTES`でKV namespaceを作成する
  - `wrangler.jsonc`に`vars.FIREBASE_DB_URL`と`kv_namespaces`（`AUDIENCE_VOTES`）を追加する
  - 観測可能な完了条件: `wrangler dev`起動時にKVバインドと`FIREBASE_DB_URL`が有効になっている
  - _Requirements: 7.1, 7.2_
  - _Depends: 5.2_

- [ ] 6.2 Firebase実プロジェクトへの接続情報投入
  - Firebase Consoleでプロジェクト作成・Realtime Database有効化を行い、`firebase-config.js`のプレースホルダーを実際の値に置換する
  - Firebase Consoleのルールタブに更新済み`firebase.rules.json`の内容を反映する
  - 観測可能な完了条件: `isFirebaseConfigured()`が`true`を返し、localStorageフォールバックではなくFirebase経由でチーム・投票データが読み書きされる
  - _Requirements: 8.1_
  - _Depends: 4.1, 4.2_

- [ ] 6.3 管理者パスワードの変更
  - `firebase-config.js`の`audienceDemoAdmin`の値を、当日限りの推測困難な値に変更する
  - 観測可能な完了条件: 旧デモパスワード（`admin`/`admin123`）でのログインが拒否される
  - _Requirements: 9.1, 9.2_

- [x] 7. 結合検証
- [x] 7.1 ローカル結合確認
  - `npm start`（localStorageモード）で、管理画面の参加フラグ切替が別タブの投票画面に反映されることを確認する
  - 観測可能な完了条件: チェックボックスON/OFFの結果が投票画面の再読み込み後に反映される
  - 確認結果: 管理画面で「ライフサポートアプリ」の参加フラグをOFFにしたところ、投票画面のライフ部門から即座に除外された（健康管理アプリのみ表示）。健康管理アプリに投票→送信完了→管理画面の得票数が1に増加し、優勝アプリ表示も「健康管理アプリ」に更新されることを確認
  - _Requirements: 3.2, 4.1, 4.2, 4.3_
  - _Depends: 2.2, 3.1_

- [ ] 7.2 Firebase接続後のWorker結合確認
  - `wrangler dev`で、teamId検証・参加状態検証・投票永続化・二重投票防止の一連の流れを確認する
  - 観測可能な完了条件: 不正・未参加チームへの投票が拒否され、有効な投票が`audienceApp/votes`に記録され、同一端末からの再投票がブロックされる
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.1, 7.2_
  - _Depends: 5.2, 6.1, 6.2_

- [ ] 7.3 本番デプロイと実機テスト
  - `npx wrangler deploy`を実行し、複数端末での投票・二重投票ブロック・投票受付ON/OFF・CSV再アップロードの冪等性・オーディエンス賞候補判定を確認する
  - 観測可能な完了条件: 公開URLで複数端末からの投票が管理画面に正しく集計され、同一端末からの再投票がブロックされ、優勝候補（最多得票チーム）が正しく表示される
  - _Requirements: 5.1, 5.2, 6.4, 7.1, 8.2, 9.1_
  - _Depends: 6.3, 7.2_

## Implementation Notes
- タスク2.2の動作確認中、`admin.js`の`renderSummaryTable`が未定義の`SECTION_LABELS`を参照し`ReferenceError`で集計表示全体が停止する既存バグ（本specのスコープ外）を発見。`admin.js`冒頭に`SECTION_LABELS`定数を追加して修正済み。
