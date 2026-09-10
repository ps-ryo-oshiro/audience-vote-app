# Requirements Document

## Project Description (Input)
社内AIコンテスト「AI爆速アプリコンテスト」本審査（2026/9/12土）のオーディエンス投票アプリに、本戦確定12チームに加えて当日会場参加の予選落選チーム（敗者復活枠）を投票対象へ追加できる仕組みを導入する。事前に全チームをCSV登録しておき、当日は管理画面のチェックボックスで参加フラグをON/OFFする運用とし、投票画面・集計上は本戦チームと敗者復活枠チームを区別しない。あわせて、既存実装で判明した投票データ未保存・Firebase Auth不整合・二重投票防止未実効・管理者パスワード公開という本番稼働の必須修正も併せて対応する。

## Introduction
本仕様は、audience-vote-appにおいて「チームを投票対象に含めるかどうか」を運営担当者が制御できるようにする参加フラグ機能と、その機能が実運用で正しく機能するために必要な既存バグ修正（投票データ永続化、Firebase Auth整合性、二重投票防止、管理者認証）を対象とする。

## Boundary Context (Optional)
- **In scope**: チームの参加確定フラグの追加・管理、CSV一括登録のupsert化、管理画面での参加フラグ切替UI、投票画面での参加確定チームのみの表示、オーディエンス賞集計への参加確定チームの反映、投票データのサーバー側永続化とteamId/参加フラグ検証、二重投票防止の実効化、Firebase書き込み権限の整合性、管理者認証情報の安全性
- **Out of scope**: 本戦確定チームと敗者復活枠チームの見た目上の区別表示、部門賞・総合グランプリなどオーディエンス賞以外の審査ロジック、投票結果のリアルタイム反映（ライブ更新）、独自ドメイン設定、CI/CD自動化
- **Adjacent expectations**: 既存のCSV列（`section`, `title`, `video_url`）はそのまま維持し、`participating`列を任意追加できること。既存のFirebase Realtime Database構成（`audienceApp/teams`, `audienceApp/votes`, `audienceApp/settings`）を維持すること

## Requirements

### Requirement 1: チーム参加状態の管理
**Objective:** As a 運営担当者, I want 各チームに「投票対象へ参加させるかどうか」の状態を持たせたい, so that 本戦確定チームと当日追加する敗者復活枠チームを同じ仕組みで管理できる

#### Acceptance Criteria
1. The Team Management Service shall 各チームに参加状態（参加する/参加しない）を保持する
2. When 新しいチームが登録される, the Team Management Service shall 参加状態を「参加しない」で初期化する
3. If チームの参加状態が未設定である, then the Team Management Service shall そのチームを「参加しない」として扱う

### Requirement 2: チームデータの一括登録（CSV/Excel取込）
**Objective:** As a 運営担当者, I want 本戦確定チームと落選候補チームをまとめて事前登録したい, so that 当日は参加フラグの切替操作だけで済ませられる

#### Acceptance Criteria
1. When 運営担当者がCSV/Excelファイルをアップロードする, the Team Management Service shall ファイル内の各行を既存チーム一覧と照合し、一致するチームは情報を更新し、一致しないチームは新規追加する
2. When 取り込まれた行が参加状態の指定を含まない, the Team Management Service shall 新規追加チームの参加状態を「参加しない」のまま保持し、既存チームの参加状態を変更しない
3. If 取り込みファイルが必須列（部門・アプリ名・動画URL）を欠く, then the Team Management Service shall 取り込みを行わずエラーを運営担当者に提示する
4. While 同一のアップロード処理が実行中である, the Team Management Service shall 既存チームの登録済みデータを削除しない

### Requirement 3: 参加状態の当日切替
**Objective:** As a 運営担当者, I want 管理画面から個々のチームの参加状態をワンクリックで切り替えたい, so that 当日会場での本戦確定・敗者復活の確定作業を迅速に行える

#### Acceptance Criteria
1. The Admin Dashboard shall 登録済みの全チームについて、参加状態を切り替える操作を提供する
2. When 運営担当者がチームの参加状態を切り替える, the Admin Dashboard shall 変更を即座に反映し、画面上の全体再読み込みなしで状態を確認できるようにする
3. When 参加状態の切替操作が行われる, the Team Management Service shall 変更後の状態を永続化する

### Requirement 4: 投票画面での表示対象の絞り込み
**Objective:** As a 来場者（投票者）, I want 参加が確定しているチームだけを見て投票したい, so that 参加していないチームに誤って投票してしまうことがない

#### Acceptance Criteria
1. The Voting Page shall 参加状態が「参加する」であるチームのみを一覧表示する
2. If チームの参加状態が「参加しない」または未設定である, then the Voting Page shall そのチームを一覧に表示しない
3. The Voting Page shall 本戦確定チームと敗者復活枠チームを同一の一覧内で区別なく表示する

### Requirement 5: オーディエンス賞集計への反映
**Objective:** As a 運営担当者, I want 参加が確定している全チームの得票を同列に集計したい, so that 敗者復活枠チームも公平にオーディエンス賞の対象になる

#### Acceptance Criteria
1. The Admin Dashboard shall 参加状態にかかわらず、登録済みの全チームの得票数を部門別・全体集計に表示する
2. The Admin Dashboard shall 得票数が最多のチームを、本戦確定チームと敗者復活枠チームの区別なくオーディエンス賞候補として提示する

### Requirement 6: 投票データの受付と検証
**Objective:** As a 運営担当者, I want 投票時に不正・無効な投票を排除して正しく集計したい, so that オーディエンス賞の結果に信頼性を持たせられる

#### Acceptance Criteria
1. When 投票リクエストを受け付ける, the Voting API shall 送信されたチームIDが登録済みチームとして実在するか検証する
2. If 送信されたチームIDが実在しない, then the Voting API shall 投票を拒否し、エラーを返す
3. If 送信されたチームIDの参加状態が「参加しない」である, then the Voting API shall 投票を拒否し、エラーを返す
4. When 有効な投票を受け付ける, the Voting API shall 投票内容（対象チーム）を集計対象データとして永続化する

### Requirement 7: 二重投票の防止
**Objective:** As a 運営担当者, I want 同じ端末からの重複投票を防ぎたい, so that 1人1票の原則を守り集計の公平性を保てる

#### Acceptance Criteria
1. When 同一の投票者トークンから2回目の投票リクエストが送信される, the Voting API shall 投票を拒否する
2. The Voting API shall 投票者トークンごとの投票済み状態を、アプリケーションの実行環境の再起動をまたいで保持する

### Requirement 8: 管理操作の書き込み整合性
**Objective:** As a 運営担当者, I want 管理画面からのチーム登録・参加状態変更・投票受付ON/OFFが確実に反映されてほしい, so that 当日の運用操作が失敗しない

#### Acceptance Criteria
1. When 運営担当者がログイン済みの状態で管理操作（チーム登録・参加状態変更・投票受付切替）を行う, the Team Management Service shall その操作をデータストアへの書き込み権限エラーなく完了させる
2. The Voting Page shall 投票受付が停止中である場合、投票フォームへの入力を無効化する

### Requirement 9: 管理者認証情報の保護
**Objective:** As a 運営担当者, I want 本番公開前に管理者の認証情報を安全な値に変更したい, so that 第三者が管理画面を不正操作できないようにする

#### Acceptance Criteria
1. The Admin Dashboard shall 本番公開時点で、初期状態のデモ用ID・パスワード（`admin`/`admin123`）以外の値でログイン認証を行う
2. If ログイン時のID・パスワードの組み合わせが一致しない, then the Admin Dashboard shall ログインを拒否しエラーメッセージを表示する
