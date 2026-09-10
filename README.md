# audience-vote-app

社内コンテスト用の「オーディエンス投票」Webアプリ。参加者はエントリーアプリに1人1票を投票し、管理者は投票の受付ON/OFFと集計結果をダッシュボードで確認できる。

フレームワーク・ビルドツールは使わず、素のHTML/CSS/JavaScriptのみで構成している。

## 機能

- **投票画面**（`index.html`）: 部門別（ライフ / ワーク / ローカル）にエントリーアプリを表示し、1人1票のラジオ選択で投票
- **管理画面**（`admin.html`）: ログイン後に投票受付のON/OFF切替、部門別・全体の得票集計、優勝アプリの表示
- **エントリー登録**: 管理画面からCSV/Excelファイルをアップロードしてエントリーアプリを一括登録
- **二重投票防止**: 端末ごとに発行するvoterトークンで、同一端末からの再投票をブロック

## アーキテクチャ

```
[ブラウザ]
  index.html / app.js   … 投票画面
  admin.html / admin.js … 管理画面（ログイン・集計・CSV取込）
        │
        ├─ Firebase Realtime Database（設定済みの場合）
        │    audienceApp/teams    … エントリーアプリ一覧
        │    audienceApp/votes    … 投票データ
        │    audienceApp/settings … 投票受付フラグ(isOpen)
        │
        └─ /api/vote (POST) ─▶ Cloudflare Workers (worker.js)
                                  投票トークンをKV(AUDIENCE_VOTES)に記録し
                                  二重投票を判定
```

- 静的ファイル配信・APIホスティングは **Cloudflare Workers**（`wrangler.jsonc`）。`worker.js`は`/api/vote`のみを処理し、それ以外のリクエストはAssetsバインディング経由で静的ファイルを返す
- データストアは **Firebase Realtime Database**。`firebase-config.js`が未設定（プレースホルダーのまま）の間は、自動的に **ブラウザのlocalStorage** に読み書きするフォールバックモードで動作する（ローカル動作確認用）
- 管理者ログインはFirebase Authを使わず、`firebase-config.js`内の平文ID/パスワードとJS上で比較するだけの簡易実装

## ディレクトリ構成

```
audience-vote-app/
├── index.html          投票画面
├── app.js              投票画面のロジック
├── admin.html          管理画面
├── admin.js            管理画面のロジック（ログイン・集計・CSV取込）
├── style.css           共通スタイル
├── worker.js           Cloudflare Workers本体（/api/vote）
├── wrangler.jsonc       Cloudflare Workers設定
├── firebase-config.js  Firebase接続設定・デモ管理者ID/PW（要編集）
├── firebase.rules.json Firebase Realtime Databaseのセキュリティルール
├── package.json
└── docs/
    └── DEPLOY.md       デプロイ手順書（Cloudflare Workers）
```

## セットアップ

### 1. Firebaseプロジェクトを用意する（本番運用する場合）

1. [Firebase Console](https://console.firebase.google.com/)でプロジェクトを作成し、Realtime Databaseを有効化する
2. `firebase-config.js`のプレースホルダーを実際の値に置き換える

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
   ```

3. `firebase.rules.json`の内容をFirebase Consoleの「ルール」タブに反映する

> `firebase-config.js`を未編集のままにすると、Firebaseに接続せずlocalStorageのみで動作する（動作確認・デモ用途向け）。

### 2. 管理者ログイン情報を変更する

`firebase-config.js`の`window.audienceDemoAdmin`にデモ用のID/パスワード（`admin` / `admin123`）が平文で入っている。**本番投入前に必ず変更すること**。認証はサーバー側チェックのないクライアントJSの単純比較のため、本格運用するならFirebase Authなど別の認証方式への置き換えを検討する。

## ローカルでの動作確認

```bash
npm start
# => python3 -m http.server 8000 が起動 (http://localhost:8000)
```

Cloudflare Workers込みで動作確認する場合は [Wrangler](https://developers.cloudflare.com/workers/wrangler/) を使う。

```bash
npx wrangler dev
```

## デプロイ

```bash
npx wrangler deploy
```

`wrangler.jsonc`の設定に従い、Cloudflare Workersに静的アセット + `/api/vote`をまとめてデプロイする。

初回セットアップ・アカウント引き継ぎ・本番公開前の必須設定・トラブルシュートは **[docs/DEPLOY.md](docs/DEPLOY.md)** を参照。

> **注意**: 現在の公開URL（`https://audience-vote-app.ry-oshiro.workers.dev/`）は`firebase-config.js`が未設定のままデプロイされており、投票が集計されない状態。本番運用前に[docs/DEPLOY.md の「本番公開前の必須設定」](docs/DEPLOY.md#3-本番公開前の必須設定必読)を必ず実施すること。

## CSV/Excel取込フォーマット

管理画面の「アプリデータ登録」でアップロードするファイルは、以下の列を含む必要がある。

| 列名 | 内容 |
|---|---|
| `section` | 部門（`life` / `work` / `local`） |
| `title` | アプリ名 |
| `video_url` | 紹介動画のURL |

## 開発フロー（Claude Code / Kiro Spec-Driven Development）

このプロジェクトは [cc-sdd](https://www.npmjs.com/package/cc-sdd) によるSpec駆動開発（要件定義→設計→タスク分解→実装）に対応している。Claude Codeで以下のSkillコマンドが使える。

- `.kiro/steering/` … プロジェクト全体のルール・技術方針（`product.md` / `tech.md` / `structure.md`）。未着手の場合は `/kiro-steering` で生成
- `.kiro/specs/` … 機能ごとの仕様（要件・設計・タスク）。`/kiro-discovery "作りたいもの"` から始めるか、`/kiro-spec-init` で直接作成
- 進捗確認: `/kiro-spec-status {feature}`

詳細な運用ルールはプロジェクト直下の `CLAUDE.md` を参照。
