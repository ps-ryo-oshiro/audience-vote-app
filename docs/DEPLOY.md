# デプロイ手順書（Cloudflare Workers）

audience-vote-app を Cloudflare Workers に公開するための手順書。

- **対象読者**: Cloudflare を触ったことがない社内メンバー
- **前提知識**: ターミナルでコマンドをコピペ実行できること。それ以外の前提は不要
- **所要時間**: ローカル確認までで約15分。チーム登録・本番デプロイまで含めると約1時間

> [!NOTE]
> 現在の進捗（何が完了・未完了か）は `.kiro/specs/audience-vote-participation-flag/tasks.md` が正。
> 本番デプロイ（本手順書の「4. 本番デプロイ」）は、本戦12チームのエントリーNo一覧の受領（タスク4.3）と
> デプロイ先Cloudflareアカウントの確定（タスク5.1）が前提のため、現時点では未実施。

---

## 1. 現行のホスティング構成

このアプリは **Cloudflare Workers（Workers Static Assets）** 1本でホスティングしている。Webサーバーの構築もビルドも不要で、リポジトリのファイルがそのまま世界中のエッジから配信される。

### データストア

投票アプリは **judge-app（審査アプリ）とは完全に別の専用Firebaseプロジェクト**を使う。審査アプリのDBには一切書き込まない（読み取りのみ、チーム登録時だけ）。管理画面・投票画面とも**認証は一切使わない**（設計上の決定事項）。整合性は「票の変更・削除の禁止」をFirebase Realtime Databaseのルールで担保する。

### リクエストの流れ

```
ブラウザ
  │
  ├─ GET /              ─▶ Worker (worker.js) ─▶ env.ASSETS ─▶ index.html などの静的ファイル
  ├─ GET /style.css     ─▶ 同上（`.assetsignore` の許可リストにあるファイルのみ配信、それ以外は404）
  │
  └─ POST /api/vote     ─▶ Worker (worker.js) ─▶ 表示対象チームか検証
                                                  ─▶ Firebase (audienceApp/votes) に投票データを書き込み
                                                  ─▶ KV (AUDIENCE_VOTES) に投票トークンを記録し二重投票を判定
```

`wrangler.jsonc` の `assets.directory: "./"` により、リポジトリ直下のファイルが対象になるが、**`.assetsignore` で配信を7ファイル（`index.html`・`admin.html`・`app.js`・`admin.js`・`style.css`・`vote.css`・`firebase-config.js`）だけに絞っている**（既定は全拒否、明示的に許可したものだけ配信）。クライアント側ルーティングは使わないため、`assets.not_found_handling`（SPAフォールバック）の設定は入れていない。

> [!CAUTION]
> `.assetsignore` で許可したファイルは **URL を直接叩けば誰でも読める**。
> 例: `https://<公開URL>/firebase-config.js` はブラウザで開ける。
> `firebase-config.js` の `apiKey` は公開前提の値なので問題ないが、新しいファイルを許可リストに足すときは中身に秘密情報を含めないこと。

---

## 2. 初回セットアップ

### 2-1. 事前準備

#### (1) Node.js をインストールする

```bash
node -v
npm -v
```

`v20` 以上が表示されればOK（動作確認時は `v24` 系）。無ければ [Node.js公式サイト](https://nodejs.org/) から LTS 版をインストールする。

#### (2) Cloudflare アカウントを用意する

[Cloudflare](https://dash.cloudflare.com/sign-up) で無料アカウントを作成する。クレジットカード登録は不要。Workers の無料枠は **1日10万リクエスト**。社内コンテスト規模なら十分。

#### (3) リポジトリを取得し、依存関係を入れる

```bash
git clone <このリポジトリのURL>
cd audience-vote-app
npm install
```

#### (4) Cloudflare にログインする

```bash
npx wrangler login
```

- ブラウザが自動で開き、Cloudflare の認可画面が表示される → **Allow** をクリック
- ターミナルに `Successfully logged in.` が出れば成功

```bash
npx wrangler whoami
```

**成功時の見え方**: アカウント名と Account ID がテーブル表示される。ここが意図したアカウントであることを必ず確認する。

### 2-2. 接続設定を用意する

`firebase-config.js`・`.dev.vars` はgit管理外（`.gitignore`参照）。ひな形からコピーして値を入れる。

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
  password: "admin123"   // 本番公開の直前に必ず変更する（4-3参照）
};
```

`.dev.vars`（Workerのローカル環境変数）:

```
FIREBASE_DB_URL=https://<プロジェクト名>-default-rtdb.<リージョン>.firebasedatabase.app
```

セキュリティルールは `firebase.rules.json` の内容を、Firebase Console の「Realtime Database」→「ルール」タブに貼り付けるか、以下で反映する。

```bash
npx firebase-tools deploy --only database --project <投票アプリのプロジェクトID>
```

> [!IMPORTANT]
> ルールは `audienceApp/teams`・`audienceApp/settings` が読み書き可、`audienceApp/votes` が読み取り可・新規追加のみ可（削除・上書き不可）になっている。認証なしでも整合性が壊れないための唯一の防御線なので、動作確認中でも緩めない。

### 2-3. KV namespace と Worker の secret を用意する（二重投票防止）

```bash
npx wrangler kv namespace create AUDIENCE_VOTES
```

表示された `id` を `wrangler.jsonc` の `kv_namespaces` に追記する（ローカル確認用のプレースホルダーIDから、本番用のIDに差し替える）。

```jsonc
{
  "kv_namespaces": [
    { "binding": "AUDIENCE_VOTES", "id": "ここに表示されたidを貼る" }
  ]
}
```

Worker本体（本番環境）の `FIREBASE_DB_URL` は `.dev.vars` ではなく secret で渡す。

```bash
npx wrangler secret put FIREBASE_DB_URL
# プロンプトが出たら databaseURL と同じ値を貼り付ける
```

### 2-4. ローカルで動作確認する

```bash
npx wrangler dev --persist-to /tmp/audience-vote-wrangler-state
```

**成功時の見え方**: `Ready on http://localhost:8787`（ポートは環境により変わる）と表示される。ブラウザでそのURLを開き、投票画面が表示されればOK。`Ctrl + C` で停止。

> [!WARNING]
> `--persist-to` に **リポジトリ外のパス**を指定すること。プロジェクト内（既定の `.wrangler/state`）のままだと、ファイル監視が自身の状態書き込みを検知して無限リロードループに陥り、リクエストがほぼ通らなくなる。

> 静的ファイルの見た目だけ確認したい場合は `npm start`（`http://localhost:8000`）でも可。ただしこちらは `/api/vote` が動かず、Firebase設定済みでも常にlocalStorageフォールバックになる。

---

## 3. チームを登録する（`scripts/team-patch.mjs`）

管理画面からのファイルアップロードは廃止した。チームのエントリーNo・アプリ名・部門は審査アプリ（judge-app）側で既に確定しているため、CLIスクリプトで審査アプリのデータを読み取り専用で取り込み、投票アプリ専用DBへ反映する。

> [!CAUTION]
> judge-app のプロジェクトID・URLは、このリポジトリのどのファイルにも書かない（judge-app はルールが全開放のため、プロジェクトIDが漏れるとDBが丸見えになる）。実行時に環境変数で渡し、コマンド履歴以外に残さない。

### 3-1. 審査アプリのチーム一覧を読み取り専用で取得する

```bash
npx firebase-tools database:get /config/teams --project "$JUDGE_PROJECT_ID" > /tmp/judge-teams.json
```

（`JUDGE_PROJECT_ID` は運営から共有された審査アプリのプロジェクトID。シェル変数として渡し、ファイルには書かない）

### 3-2. 本戦12チームを登録する（初回・本戦確定時）

```bash
node scripts/team-patch.mjs seed \
  --judge /tmp/judge-teams.json \
  --finalists <本戦12チームのエントリーNoをカンマ区切りで> \
  > /tmp/patch-seed.json

npx firebase-tools database:update /audienceApp/teams /tmp/patch-seed.json --project <投票アプリのプロジェクトID> -f
```

既存チームがある状態（当日の候補入れ替え後の再登録など）で使う場合は `--current` に現在の `/audienceApp/teams`（`database:get` の出力）を渡す。指定していない項目（動画URL・名称など）は消えない。

### 3-3. 動画URLを追記する

```bash
node scripts/team-patch.mjs videos --file <no,url または title,url のCSV> --current <現在のteams JSON> > /tmp/patch-videos.json
npx firebase-tools database:update /audienceApp/teams /tmp/patch-videos.json --project <投票アプリのプロジェクトID> -f
```

### 3-4. 名称を修正する

```bash
node scripts/team-patch.mjs rename --no <エントリーNo> --title <新しい名称> --current <現在のteams JSON> > /tmp/patch-rename.json
npx firebase-tools database:update /audienceApp/teams /tmp/patch-rename.json --project <投票アプリのプロジェクトID> -f
```

### 3-5. 適用後に確認する

```bash
npx firebase-tools database:get /audienceApp/teams --project <投票アプリのプロジェクトID>
```

本戦12チームが `finalist: true`、それ以外が `finalist: false` になっていること、既存チームの動画URL・名称が消えていないことを確認する。

---

## 4. 本番デプロイ

### 4-1. デプロイする

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

初回デプロイ時のみ「`workers.dev` サブドメインを登録しますか？」と聞かれることがある。任意の名前（英数字）を入力すると、それが `https://audience-vote-app.<入力した名前>.workers.dev` の中央部分になる。**後から変更するとURLが変わる**ので慎重に決めること。

### 4-2. 公開後の確認項目

- [ ] 公開URLで配信対象の7ファイル（`.assetsignore`参照）が取得でき、それ以外（`README.md`・`worker.js`・`docs/`・`firebase.rules.json`・`scripts/team-patch.mjs`・`.kiro/`等）が404になる
- [ ] 配信されるファイルのどこにも judge-app のプロジェクトID・URL・文字列が含まれない
- [ ] `firebase-config.js` の `databaseURL` が、実際に投票を書き込んでいるプロジェクトのURLと一致している（複数プロジェクトを行き来していると食い違うことがある）
- [ ] judge-app 側のルールが変わっていないことを、読み取りのみで確認する（`database:get / --project "$JUDGE_PROJECT_ID"` がエラーにならない＝ルールが全開放のまま）
- [ ] 別々の端末2台で投票 → 管理画面の集計が2票になる。同じ端末の2回目は拒否される
- [ ] 投票受付を停止すると投票画面のフォームが無効になる
- [ ] 投票画面を開いた後、Firebase Console の「使用状況」で接続数が戻ることを確認する（`goOffline()` が効いているか）

### 4-3. 管理者ID/パスワードを変更する

`firebase-config.js` の `window.audienceDemoAdmin` が `admin` / `admin123` のままだと、`https://<公開URL>/firebase-config.js` を開けば誰でも読める。認証はクライアントJSの単純比較のみでサーバー側チェックはないため、**本番公開の直前に**推測されにくい値へ変更し、再デプロイする。

### 4-4. 更新をデプロイする

コードを直したら、同じコマンドを実行するだけ。

```bash
npx wrangler deploy
```

数秒で世界中のエッジに反映される。ビルド作業は不要。

---

## 5. 当日のログの見方

```bash
npx wrangler tail
```

本番Workerのログとエラーがリアルタイムで流れる。`/api/vote` が失敗している場合はここに出る（`server_misconfigured` が出た場合は secret か KV binding の設定漏れ）。`Ctrl + C` で停止。

---

## 6. 別アカウントへデプロイする（引き継ぎ・アカウント未確定の場合）

現在の公開URL（`https://audience-vote-app.ry-oshiro.workers.dev/`）は大城さんの個人アカウント。別アカウントに移す場合の手順。

### 6-1. アカウントを切り替える

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

### 6-2. デプロイして新URLを確認する

```bash
npx wrangler deploy
```

> [!IMPORTANT]
> **URLが変わる。** `workers.dev` のサブドメイン部分はアカウントごとに異なるため、
> `https://audience-vote-app.<新しいサブドメイン>.workers.dev` になる。
> 配布済みのQRコードがある場合は差し替えが必要。

### 6-3. 移行後にやること

- KV namespace は**アカウント単位**なので、移行先で作り直す（2-3を再実施）
- 旧アカウント側の Worker を削除する（誤って古いURLが使われるのを防ぐ）

  ```bash
  npx wrangler delete
  ```

  > 旧アカウントにログインした状態で実行すること。実行前に `npx wrangler whoami` で必ず確認する。

---

## 7. 独自ドメインを割り当てる（オプション）

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

## 8. ロールバックとトラブルシュート

### 8-1. 直前のバージョンに戻す

```bash
npx wrangler deployments list
npx wrangler rollback <Version ID>
```

**成功時の見え方**: 確認プロンプトの後、指定バージョンが現在の本番として再適用される。

> [!TIP]
> 当日トラブルが起きたら、原因調査より先にロールバックして復旧させる。調査はその後でよい。

### 8-2. よくある症状と対処

| 症状 | 原因 | 対処 |
|---|---|---|
| デプロイしたのに古い画面が出る | ブラウザキャッシュ | スーパーリロード（Mac: `Cmd + Shift + R`）。または別端末・シークレットウィンドウで確認 |
| 何度でも投票できてしまう | KV未バインド、または本番用IDに差し替え忘れ | 2-3を実施、`wrangler.jsonc` の `kv_namespaces` を確認 |
| 投票が500 `server_misconfigured` | `FIREBASE_DB_URL` の secret 未設定、または KV binding 名の誤り | `npx wrangler secret list` で確認し、2-3をやり直す |
| 管理画面にログインできない | `firebase-config.js` の `audienceDemoAdmin` の値と不一致 | 該当ファイルの値を確認。変更後は再デプロイが必要 |
| `wrangler deploy` で権限エラー | ログイン中のアカウントが違う | `npx wrangler whoami` で確認し、`logout` → `login` でやり直す |
| ローカルで無限リロードになる | `wrangler dev` のKV永続化先がプロジェクト内 | `--persist-to` にプロジェクト外のパスを指定する（2-4参照） |
| `/index.html`・`/admin.html` が直接200を返さず307になる | Cloudflare Workers Assets の既定の `html_handling`（`.html`を外した正規URLへリダイレクト） | 実害なし。ブラウザは自動で追従して200になる。直接200を期待するcurl確認では `-L` を付ける |
| `wrangler` コマンドが見つからない | `npm install` 未実施 | 2-1(3) を実施 |

### 8-3. 動いているコードを確認する

```bash
curl -sSI https://<公開URL>/
curl -sS  https://<公開URL>/firebase-config.js
```

レスポンスヘッダに `server: cloudflare` が出れば Cloudflare Workers から配信されている。

---

## 9. 将来の選択肢: GitHub Actions での自動デプロイ

現状は手動 `npx wrangler deploy` 運用。このプロジェクトの規模とデプロイ頻度なら手動で十分であり、当面は変更不要。

将来 `main` ブランチへのマージで自動公開したくなった場合は、Cloudflare の API トークンを GitHub の Secrets に登録し、`cloudflare/wrangler-action` を使うワークフローを追加する構成になる。導入時は「誰でもマージすれば本番に出る」状態になるため、ブランチ保護とレビュー必須化をセットで検討すること。

---

## 参考リンク

- [Cloudflare Workers ドキュメント](https://developers.cloudflare.com/workers/)
- [Wrangler コマンドリファレンス](https://developers.cloudflare.com/workers/wrangler/commands/)
- [Workers KV](https://developers.cloudflare.com/kv/)
- [Firebase Realtime Database セキュリティルール](https://firebase.google.com/docs/database/security)
