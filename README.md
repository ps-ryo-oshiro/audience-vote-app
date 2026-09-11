# audience-vote-app

社内コンテスト用の「オーディエンス投票」Webアプリ。参加者はエントリーアプリに1人1票を投票し、管理者は投票の受付ON/OFFと集計結果をダッシュボードで確認できる。

フレームワーク・ビルドツールは使わず、素のHTML/CSS/JavaScriptのみで構成している。

## 機能

- **投票画面**（`index.html`）: 本戦確定チーム（常時表示）と、当日表示ONにした敗者復活候補を、部門別（ライフ / ワーク / ローカル）にNo順で表示し、1人1票のカード選択で投票。ライト/ダークのテーマ切替と、送信後の投票完了演出に対応
- **管理画面**（`admin.html`）: ログイン後に投票受付のON/OFF切替、部門別・全体の得票集計（順位・同票判定）、敗者復活候補の表示切替
- **チームの事前登録**: CLIスクリプト（`scripts/team-patch.mjs`）で、審査アプリ（judge-app）のエントリー一覧から投票アプリ専用DBへチームを一括登録・追記・修正する（管理画面からのファイルアップロードは廃止）
- **二重投票防止**: 端末ごとに発行するvoterトークンをCloudflare Workers KVに記録し、同一端末からの再投票をブロック

## アーキテクチャ

```
[ブラウザ]
  index.html / app.js / vote.css … 投票画面
  admin.html / admin.js / style.css … 管理画面（ログイン・表示切替・集計）
        │
        ├─ Firebase Realtime Database（投票アプリ専用プロジェクト。judge-appとは別プロジェクトで完全分離）
        │    audienceApp/teams    … エントリーアプリ一覧（本戦/候補・表示状態）
        │    audienceApp/votes    … 投票データ
        │    audienceApp/settings … 投票受付フラグ(isOpen)
        │
        └─ /api/vote (POST) ─▶ Cloudflare Workers (worker.js)
                                  表示対象チームか検証し、audienceApp/votes に書き込んだうえで
                                  KV(AUDIENCE_VOTES)に投票トークンを記録して二重投票を判定
```

- 静的ファイル配信・APIホスティングは **Cloudflare Workers**（`wrangler.jsonc`）。`worker.js`は`/api/vote`のみを処理し、それ以外のリクエストはAssetsバインディング経由で静的ファイルを返す。配信対象は`.assetsignore`の許可リストで7ファイルに限定している
- データストアは **Firebase Realtime Database**（投票アプリ専用プロジェクト）。`firebase-config.js`が未設定（プレースホルダーのまま）の間は、自動的に **ブラウザのlocalStorage** に読み書きするフォールバックモードで動作する（ローカル動作確認用）
- 管理者ログインはFirebase Authを使わず、`firebase-config.js`内の平文ID/パスワードとJS上で比較するだけの簡易実装。来場者・管理者とも認証は一切使わない設計（詳細は仕様の設計書を参照）

## ディレクトリ構成

```
audience-vote-app/
├── index.html          投票画面
├── app.js              投票画面のロジック
├── vote.css            投票画面のスタイル（ライト/ダーク・アニメーション）
├── admin.html          管理画面
├── admin.js            管理画面のロジック（ログイン・集計・表示切替）
├── style.css           管理画面のスタイル
├── worker.js           Cloudflare Workers本体（/api/vote）
├── wrangler.jsonc       Cloudflare Workers設定
├── firebase-config.js  Firebase接続設定・デモ管理者ID/PW（git管理外・要編集）
├── firebase-config.example.js  接続設定のひな形（プレースホルダーのみ）
├── firebase.rules.json Firebase Realtime Databaseのセキュリティルール
├── .assetsignore       配信ファイルの許可リスト（既定は全拒否、7ファイルのみ許可）
├── .dev.vars           ローカル用のWorker環境変数（git管理外）
├── package.json
├── scripts/
│   └── team-patch.mjs  チームの登録・動画URL追記・名称修正パッチを生成するCLI
└── docs/
    └── DEPLOY.md       デプロイ手順書（Cloudflare Workers）
```

## セットアップ

### 1. 接続設定を用意する

`firebase-config.js`・`.dev.vars`はgit管理外（ひな形は`firebase-config.example.js`）。初回はひな形をコピーして値を埋める。

```bash
cp firebase-config.example.js firebase-config.js
```

```js
window.firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  databaseURL: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};

window.audienceDemoAdmin = {
  username: "admin",
  password: "admin123"
};
```

`.dev.vars`にはWorkerのローカル環境変数を書く。

```
FIREBASE_DB_URL=https://<プロジェクト名>-default-rtdb.<リージョン>.firebasedatabase.app
```

`firebase-config.js`を未編集のままにすると、Firebaseに接続せずlocalStorageのみで動作する（動作確認・デモ用途向け）。ルールは`firebase.rules.json`をFirebase Consoleまたは`firebase deploy --only database`で反映する。

### 2. 管理者ログイン情報を変更する

`firebase-config.js`の`window.audienceDemoAdmin`にデモ用のID/パスワード（`admin` / `admin123`）が平文で入っている。認証はサーバー側チェックのないクライアントJSの単純比較のみで、来場者・管理者とも認証は一切使わない設計上の決定事項。**本番公開の直前に必ず変更すること**（詳細は`docs/DEPLOY.md`）。

### 3. チームを登録する

エントリー一覧は管理画面からのアップロードではなく、CLIスクリプトで登録する。手順は **[docs/DEPLOY.md](docs/DEPLOY.md)** を参照。

## ローカルでの動作確認

```bash
npm start
# => python3 -m http.server 8000 が起動 (http://localhost:8000)
```

Cloudflare Workers込みで動作確認する場合は [Wrangler](https://developers.cloudflare.com/workers/wrangler/)（`devDependencies`に導入済み）を使う。

```bash
npx wrangler dev --persist-to /tmp/audience-vote-wrangler-state
```

> KVのローカル永続化先はプロジェクト外のパスを指定すること。プロジェクト内（既定の`.wrangler/state`）だとファイル監視が自身の書き込みを検知して無限リロードループに陥る。

## デプロイ

```bash
npx wrangler deploy
```

`wrangler.jsonc`の設定に従い、Cloudflare Workersに静的アセット + `/api/vote`をまとめてデプロイする。配信対象は`.assetsignore`の許可リストで絞られている。

初回セットアップ・チーム登録・アカウント引き継ぎ・本番公開前の必須設定・トラブルシュートは **[docs/DEPLOY.md](docs/DEPLOY.md)** を参照。仕様の進捗（何が未完了か）は`.kiro/specs/audience-vote-participation-flag/tasks.md`を参照。

## 開発フロー（Claude Code / Kiro Spec-Driven Development）

このプロジェクトは [cc-sdd](https://www.npmjs.com/package/cc-sdd) によるSpec駆動開発（要件定義→設計→タスク分解→実装）に対応している。Claude Codeで以下のSkillコマンドが使える。

- `.kiro/steering/` … プロジェクト全体のルール・技術方針（`product.md` / `tech.md` / `structure.md`）。未着手の場合は `/kiro-steering` で生成
- `.kiro/specs/` … 機能ごとの仕様（要件・設計・タスク）。`/kiro-discovery "作りたいもの"` から始めるか、`/kiro-spec-init` で直接作成
- 進捗確認: `/kiro-spec-status {feature}`

詳細な運用ルールはプロジェクト直下の `CLAUDE.md` を参照。
