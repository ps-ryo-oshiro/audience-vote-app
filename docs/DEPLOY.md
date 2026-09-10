# デプロイ手順書（Cloudflare Workers）

audience-vote-app を Cloudflare Workers に公開するための手順書。

- **対象読者**: Cloudflare を触ったことがない社内メンバー
- **前提知識**: ターミナルでコマンドをコピペ実行できること。それ以外の前提は不要
- **所要時間**: デプロイだけなら約10分。「[3. 本番公開前の必須設定](#3-本番公開前の必須設定必読)」まで含めると約1〜2時間

> [!WARNING]
> **現在公開中のURLは、そのままではコンテストに使えません。**
> 投票データが集計されない状態です。理由と対処は「3. 本番公開前の必須設定」を参照。

---

## 1. 現行のホスティング構成

このアプリは **Cloudflare Workers（Workers Static Assets）** 1本でホスティングしている。Webサーバーの構築もビルドも不要で、リポジトリのファイルがそのまま世界中のエッジから配信される。

### 現行の公開URL

```
https://audience-vote-app.ry-oshiro.workers.dev/
         └─ Worker名 ─┘  └─ アカウントの ─┘
                          サブドメイン
```

| 項目 | 値 |
|---|---|
| Worker名 | `audience-vote-app`（`wrangler.jsonc` の `name`） |
| デプロイ先アカウント | `Ry-oshiro@pdc.proto-g.co.jp's Account` |
| 独自ドメイン | 未設定（`workers.dev` の無料サブドメインを使用） |
| CI/CD | なし（各自のPCから手動デプロイ） |

> [!NOTE]
> **属人化の注意**: 現在は特定の個人アカウントにデプロイされている。その人が退職・異動するとURLごと消える。
> 継続運用するなら「[5. 別アカウントへデプロイする（引き継ぎ）](#5-別アカウントへデプロイする引き継ぎ)」で共用アカウントに移すこと。

### リクエストの流れ

```
ブラウザ
  │
  ├─ GET /              ─▶ Worker (worker.js) ─▶ env.ASSETS ─▶ index.html などの静的ファイル
  ├─ GET /style.css     ─▶ 同上
  │
  └─ POST /api/vote     ─▶ Worker (worker.js) ─▶ KV (AUDIENCE_VOTES) に投票トークンを記録
                                                  二重投票なら 409 を返す
```

`wrangler.jsonc` の `assets.directory: "./"` により、**リポジトリ直下の全ファイルがそのまま公開される**。`worker.js` は `/api/vote` (POST) だけを処理し、それ以外は静的ファイル配信にフォールバックする。

> [!CAUTION]
> リポジトリ直下に置いたファイルは **URL を直接叩けば誰でも読める**。
> 例: `https://<公開URL>/firebase-config.js` はブラウザで開ける。
> APIキーやパスワードを含むファイルを直下に置かないこと。

---

## 2. デプロイ手順

### 2-1. 事前準備

#### (1) Node.js をインストールする

ターミナルで確認する。

```bash
node -v
npm -v
```

`v20` 以上が表示されればOK（動作確認時は `v24.15.0` / npm `11.12.1`）。
コマンドが見つからない場合は [Node.js公式サイト](https://nodejs.org/) から LTS 版をインストールする。

#### (2) Cloudflare アカウントを用意する

[Cloudflare](https://dash.cloudflare.com/sign-up) で無料アカウントを作成する。クレジットカード登録は不要。
Workers の無料枠は **1日10万リクエスト**。社内コンテスト規模なら十分。

#### (3) リポジトリを取得する

```bash
git clone <このリポジトリのURL>
cd audience-vote-app
```

#### (4) Cloudflare にログインする

```bash
npx wrangler login
```

- 初回は `wrangler` のインストール確認が出るので `y` で進める
- ブラウザが自動で開き、Cloudflare の認可画面が表示される → **Allow** をクリック
- ターミナルに `Successfully logged in.` が出れば成功

ログインしているアカウントを確認する。

```bash
npx wrangler whoami
```

**成功時の見え方**: アカウント名と Account ID がテーブル表示される。ここが意図したアカウントであることを必ず確認する。

### 2-2. ローカルで動作確認する

Cloudflare にデプロイする前に、手元で Worker を動かして確認する。

```bash
npx wrangler dev
```

**成功時の見え方**: `Ready on http://localhost:8787` と表示される。ブラウザでそのURLを開き、投票画面が表示されればOK。`Ctrl + C` で停止。

> 静的ファイルの見た目だけ確認したい場合は `npm start`（`http://localhost:8000`）でも可。ただしこちらは `/api/vote` が動かない。

### 2-3. デプロイする

```bash
npx wrangler deploy
```

**成功時の見え方**:

```
Total Upload: xx KiB / gzip: xx KiB
Uploaded audience-vote-app (x.xx sec)
Deployed audience-vote-app triggers (x.xx sec)
  https://audience-vote-app.<あなたのサブドメイン>.workers.dev
Current Version ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

表示されたURLをブラウザで開き、投票画面が表示されればデプロイ完了。

> [!TIP]
> 初回デプロイ時のみ「`workers.dev` サブドメインを登録しますか？」と聞かれることがある。任意の名前（英数字）を入力すると、それが `https://<Worker名>.<入力した名前>.workers.dev` の中央部分になる。**後から変更するとURLが変わる**ので慎重に決めること。

### 2-4. 更新をデプロイする

コードを直したら、同じコマンドを実行するだけ。

```bash
npx wrangler deploy
```

数秒で世界中のエッジに反映される。ビルド作業は不要。

---

## 3. 本番公開前の必須設定（必読）

現在のコードは **デモ・動作確認用の設定のまま**。以下の4点を対応しないと、コンテスト本番で投票結果が出ない・管理画面が乗っ取られる、といった事故になる。

### 3-1.【最重要】投票データがどこにも保存されない

**現象**: 投票しても管理画面の集計が0件のまま。

**原因**: `app.js` の投票処理は、Firebase 設定済みの場合 `/api/vote` に POST するだけで、**投票先（teamId）を `audienceApp/votes` に書き込んでいない**。`worker.js` 側も KV に「この端末は投票済み」というフラグを立てるだけで、誰がどのアプリに投票したかは保存していない。結果、票が集計対象としてどこにも残らない。

**対応**: 以下のどちらかの方針でコードを修正する。

- **方針A（推奨）**: `worker.js` の `/api/vote` で、二重投票チェックを通過した後に Firebase REST API 経由で `audienceApp/votes` に書き込む。投票データがクライアント任せにならず改ざんに強い
- **方針B（簡易）**: `app.js` で `/api/vote` が成功した後に、クライアントから `db.ref('audienceApp/votes').push({...})` する。実装は早いが、ブラウザから直接DBを書き換えられる余地が残る

> [!IMPORTANT]
> これは設定ではなく **コード修正が必要な不具合**。デプロイ手順だけ実施しても解消しない。

### 3-2. Firebase Realtime Database が未接続

**現象**: `firebase-config.js` がプレースホルダー（`YOUR_API_KEY`）のままのため、`app.js:67` の判定で Firebase 未設定と見なされ、**全データが各端末の localStorage に保存される**フォールバックモードで動作する。参加者の票はその人のブラウザにしか残らず、管理画面の集計は「管理者自身の端末の票」しか見えない。

**対応手順**:

1. [Firebase Console](https://console.firebase.google.com/) でプロジェクトを作成する
2. 「構築」→「Realtime Database」→「データベースを作成」でRTDBを有効化する
3. 「プロジェクトの設定」→「マイアプリ」→ ウェブアプリを追加し、表示された設定値を控える
4. `firebase-config.js` のプレースホルダーを実際の値に置き換える

   ```js
   window.firebaseConfig = {
     apiKey: "実際の値",
     authDomain: "実際の値",
     databaseURL: "https://<プロジェクト名>-default-rtdb.firebaseio.com",
     projectId: "実際の値",
     storageBucket: "実際の値",
     messagingSenderId: "実際の値",
     appId: "実際の値"
   };
   ```

5. Firebase Console の Realtime Database →「ルール」タブに `firebase.rules.json` の内容を貼り付けて公開する

> [!NOTE]
> **`firebase.rules.json` のルールは現状のままでは機能しない。**
> `audienceApp/votes` の `.read` が `"auth != null"` になっているが、管理画面は Firebase Auth を使っていない（3-3参照）ため、管理者が票を読み出せない。
> 3-3 で Firebase Auth を導入するか、ルール側を用途に合わせて調整すること。

> [!TIP]
> Firebase の `apiKey` はブラウザに配布される前提の公開情報であり、秘匿しても意味がない。
> **アクセス制御はセキュリティルールで行う**のが正しい設計。ルール設定を省略しないこと。

### 3-3. 管理者ID/パスワードが公開されている

**現象**: `firebase-config.js` に `admin` / `admin123` が平文で入っており、`https://<公開URL>/firebase-config.js` を開けば誰でも読める。しかも認証はクライアントJSの単純比較のみで、サーバー側チェックが存在しない。実質的に管理画面は無防備。

**対応**（上から順に望ましい）:

1. **Firebase Auth に置き換える**（推奨）。メール/パスワード認証を有効化し、管理者アカウントを1つ作る。セキュリティルールの `auth != null` も正しく機能するようになる
2. **Cloudflare Access を被せる**。`/admin.html` へのアクセスに社内SSO（Google Workspace等）を要求する。コード修正なしで守れる
3. 最低限の暫定対応として、当日限りの推測困難なパスワードに変更し、コンテスト終了後にデプロイを削除する

> [!CAUTION]
> `admin` / `admin123` のまま本番公開しないこと。管理画面からは投票の受付停止・エントリーデータの上書きができる。

### 3-4. 二重投票防止が効いていない

**現象**: 同じ端末から何度でも投票できてしまう。

**原因**: `wrangler.jsonc` に KV バインディング `AUDIENCE_VOTES` の定義がない。そのため `worker.js` はインメモリの `Map` にフォールバックし、Workers のisolateが入れ替わるたびに記録が消える。

**対応手順**:

1. KV namespace を作成する

   ```bash
   npx wrangler kv namespace create AUDIENCE_VOTES
   ```

   > wrangler のバージョンによっては `npx wrangler kv:namespace create AUDIENCE_VOTES`（コロン区切り）。エラーが出たら書式を切り替える。

   **成功時の見え方**: 設定に追記すべき内容が `id` 付きで表示される。

2. 表示された `id` を `wrangler.jsonc` に追記する

   ```jsonc
   {
     "$schema": "node_modules/wrangler/config-schema.json",
     "name": "audience-vote-app",
     "compatibility_date": "2026-09-09",
     "main": "worker.js",
     "assets": {
       "directory": "./",
       "not_found_handling": "single-page-application"
     },
     "kv_namespaces": [
       { "binding": "AUDIENCE_VOTES", "id": "ここに表示されたidを貼る" }
     ]
   }
   ```

3. 再デプロイする

   ```bash
   npx wrangler deploy
   ```

4. 確認する。投票後に同じ端末から再投票を試み、「この端末ではすでに投票済みです。」と表示されればOK

> [!NOTE]
> この仕組みは端末（ブラウザ）単位の抑止であり、シークレットウィンドウや別端末からの投票は防げない。厳密な1人1票が必要なら、社内SSOによる本人確認が必要。

---

## 4. 公開前チェックリスト

コンテスト当日の前に、以下を上から順に確認する。

- [ ] `npx wrangler whoami` で意図したアカウントにログインしている
- [ ] `firebase-config.js` が実際の値に置き換わっている（3-2）
- [ ] Firebase Console にセキュリティルールを反映した（3-2）
- [ ] 投票データが `audienceApp/votes` に保存されるようコードを修正した（3-1）
- [ ] `wrangler.jsonc` に `kv_namespaces` を追記した（3-4）
- [ ] 管理者ID/パスワードを変更、または認証方式を置き換えた（3-3）
- [ ] `npx wrangler deploy` を実行した
- [ ] **実機テスト**: スマホA で投票 → スマホB で投票 → 管理画面で2票集計されている
- [ ] **二重投票テスト**: スマホA から再投票 → ブロックされる
- [ ] **受付ON/OFFテスト**: 管理画面で受付停止 → 投票画面が「停止中」になり投票できない
- [ ] 当日の回線（会場Wi-Fi / モバイル回線）で公開URLが開けることを確認した

---

## 5. 別アカウントへデプロイする（引き継ぎ）

現在は個人アカウントにデプロイされているため、共用アカウントへ移す場合の手順。

### 5-1. アカウントを切り替える

```bash
npx wrangler logout
npx wrangler login
```

ブラウザで**移行先のアカウント**にログインした状態で認可する。切り替わったことを確認する。

```bash
npx wrangler whoami
```

複数アカウントに所属している場合は、デプロイ先を明示できる。

```bash
CLOUDFLARE_ACCOUNT_ID=<移行先のAccount ID> npx wrangler deploy
```

### 5-2. デプロイして新URLを確認する

```bash
npx wrangler deploy
```

> [!IMPORTANT]
> **URLが変わる。** `workers.dev` のサブドメイン部分はアカウントごとに異なるため、
> `https://audience-vote-app.<新しいサブドメイン>.workers.dev` になる。
> 配布済みのQRコードや案内メールがある場合は差し替えが必要。
> URLを固定したいなら「6. 独自ドメインを割り当てる」を先に実施すること。

### 5-3. 移行後にやること

- KV namespace は**アカウント単位**なので、移行先で作り直す（3-4を再実施）
- 旧アカウント側の Worker を削除する（誤って古いURLが使われるのを防ぐ）

  ```bash
  npx wrangler delete
  ```

  > 旧アカウントにログインした状態で実行すること。実行前に `npx wrangler whoami` で必ず確認する。

---

## 6. 独自ドメインを割り当てる（オプション）

社内コンテスト用途なら `workers.dev` のままで十分。URLを固定したい・社内ドメインで見せたい場合のみ実施する。

**前提**: 対象ドメインが Cloudflare でDNS管理されていること（ネームサーバーがCloudflareを向いている）。

1. [Cloudflare ダッシュボード](https://dash.cloudflare.com/) を開く
2. 「Compute (Workers)」→ `audience-vote-app` を選択
3. 「Settings」→「Domains & Routes」→「Add」→「Custom domain」
4. 使いたいホスト名（例: `vote.example.co.jp`）を入力して追加
5. DNSレコードとTLS証明書は自動で発行される。数分待って `https://vote.example.co.jp` が開けば完了

> [!NOTE]
> 独自ドメインを追加しても `workers.dev` のURLは有効なまま残る。
> 旧URLを塞ぎたい場合は、Worker の Settings で `workers.dev` のルートを無効化する。

---

## 7. ロールバックとトラブルシュート

### 7-1. 直前のバージョンに戻す

デプロイ履歴を確認する。

```bash
npx wrangler deployments list
```

戻したいバージョンIDを指定してロールバックする。

```bash
npx wrangler rollback <Version ID>
```

**成功時の見え方**: 確認プロンプトの後、指定バージョンが現在の本番として再適用される。

> [!TIP]
> 当日トラブルが起きたら、原因調査より先にロールバックして復旧させる。調査はその後でよい。

### 7-2. リアルタイムでログを見る

```bash
npx wrangler tail
```

本番Workerのログとエラーが流れる。`/api/vote` が失敗している場合はここに出る。`Ctrl + C` で停止。

### 7-3. よくある症状と対処

| 症状 | 原因 | 対処 |
|---|---|---|
| デプロイしたのに古い画面が出る | ブラウザキャッシュ | スーパーリロード（Mac: `Cmd + Shift + R`）。または別端末・シークレットウィンドウで確認 |
| 投票しても集計が0件 | Firebase未設定 or 投票データ未保存 | 3-1 / 3-2 を実施 |
| 何度でも投票できてしまう | KV未バインド | 3-4 を実施 |
| 管理画面にログインできない | `firebase-config.js` の `audienceDemoAdmin` の値と不一致 | 該当ファイルの値を確認。変更後は再デプロイが必要 |
| `wrangler deploy` で権限エラー | ログイン中のアカウントが違う | `npx wrangler whoami` で確認し、`logout` → `login` でやり直す |
| ページが404になる | `wrangler.jsonc` の `assets.directory` の指定ミス | `"./"` のままか確認する |
| `wrangler` コマンドが見つからない | Node.js未インストール | 2-1(1) を実施 |

### 7-4. 動いているコードを確認する

デプロイされている実物を直接取得して確認できる。

```bash
curl -sSI https://audience-vote-app.ry-oshiro.workers.dev/
curl -sS  https://audience-vote-app.ry-oshiro.workers.dev/firebase-config.js
```

レスポンスヘッダに `server: cloudflare` が出れば Cloudflare Workers から配信されている。

---

## 8. 将来の選択肢: GitHub Actions での自動デプロイ

現状は手動 `npx wrangler deploy` 運用。このプロジェクトの規模とデプロイ頻度なら手動で十分であり、当面は変更不要。

将来 `main` ブランチへのマージで自動公開したくなった場合は、Cloudflare の API トークンを GitHub の Secrets に登録し、`cloudflare/wrangler-action` を使うワークフローを追加する構成になる。導入時は「誰でもマージすれば本番に出る」状態になるため、ブランチ保護とレビュー必須化をセットで検討すること。

---

## 参考リンク

- [Cloudflare Workers ドキュメント](https://developers.cloudflare.com/workers/)
- [Wrangler コマンドリファレンス](https://developers.cloudflare.com/workers/wrangler/commands/)
- [Workers KV](https://developers.cloudflare.com/kv/)
- [Firebase Realtime Database セキュリティルール](https://firebase.google.com/docs/database/security)
