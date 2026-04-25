# GitHub Actions CI トラブルシューティング KB

> **目的**: CI Agent が参照・追記する「生きたナレッジベース」。
> 新規エントリは末尾に追加し、エントリ ID は連番（TA-NNN）で採番する。
>
> **Grep 検索のヒント**: エラーメッセージ文字列をそのまま grep すると該当エントリが見つかる。
>
> **追記ルール**:
> 1. `## TA-NNN` セクションを末尾にコピーして連番を振る
> 2. 各フィールドを埋める（未知の場合は `不明` と記入）
> 3. 解決後に `status` を `resolved` に更新する

---

## エントリテンプレート

```markdown
## TA-NNN — <タイトル>

| フィールド | 値 |
|-----------|-----|
| **発生日** | YYYY-MM-DD |
| **PR 番号** | #NNNN |
| **ワークフロー** | CI / Labeler / pr-quality-gate / lp-metrics 等 |
| **ジョブ名** | lp-sync-check / biome / svelte-check 等 |
| **ステップ名** | Run check / Install dependencies 等 |
| **ステータス** | resolved / ongoing |

### エラーメッセージ（原文）

\```
<ここにエラーログをそのまま貼る — Grep で引っかかるよう原文必須>
\```

### 根本原因

<なぜ起きたか>

### 解決手順

\```bash
<再現可能なコマンド>
\```

### 再発防止策

<どうすれば再発を防げるか>
```

---

## TA-001 — generate-lp-labels.mjs 変更後に site/shared-labels.js の再生成漏れ

| フィールド | 値 |
|-----------|-----|
| **発生日** | 2026-04-25 |
| **PR 番号** | #1490 |
| **ワークフロー** | CI |
| **ジョブ名** | lp-sync-check |
| **ステップ名** | Check LP labels sync |
| **ステータス** | resolved |

### エラーメッセージ（原文）

```
✗ site/shared-labels.js が labels.ts と同期されていません。
node scripts/generate-lp-labels.mjs を実行して再生成してください。
```

### 根本原因

`scripts/generate-lp-labels.mjs` を修正（biome `noUnusedVariables` 対応で変数参照を調整）した際、
`site/shared-labels.js`（同スクリプトが生成する成果物）を再生成しないままコミット・プッシュしたため。

CI の `lp-sync-check` ジョブが `--check` フラグ付きで同スクリプトを実行し、
生成物とソースの差分を検知してエラーを返す仕組みになっている。

**失敗した CI run**: `24922966286`（2026-04-25T04:51:35Z）

### 解決手順

```bash
# 1. 同期状態を確認
node scripts/generate-lp-labels.mjs --check

# 2. 同期されていない場合は再生成
node scripts/generate-lp-labels.mjs

# 3. 生成物をコミット
git add site/shared-labels.js
git commit -m "chore: site/shared-labels.js を再生成（generate-lp-labels.mjs 修正後）"
git push

# 4. CI が再トリガーされるか確認（pull_request イベントの CI が走ること）
gh run list --branch <ブランチ名> --workflow ci.yml --limit 3
```

### 再発防止策

- `scripts/generate-lp-labels.mjs` を変更した PR では、**必ず** `node scripts/generate-lp-labels.mjs` を実行して `site/shared-labels.js` をコミットに含める
- コミット前チェックとして `node scripts/generate-lp-labels.mjs --check` を実行する習慣をつける
- `CLAUDE.md` の「新規 label 追加時」注記（§必ず守ること §デザインシステム）に「`generate-lp-labels.mjs` 自体を変更した場合も再生成必須」と明記済み（#1490 対応）

### 解決確認

- `node scripts/generate-lp-labels.mjs --check` → `✓ site/shared-labels.js は最新です`
- `workflow_dispatch` CI run `24927283408`（2026-04-25T08:59:26Z）で全 14 ジョブ通過
- `pull_request` イベントの CI は docs のみ変更のため paths-filter でスキップ（正常動作。TA-002 参照）

---

## TA-002 — docs のみ変更時に pull_request CI がスキップされる（正常動作）

| フィールド | 値 |
|-----------|-----|
| **発生日** | 2026-04-25 |
| **PR 番号** | #1490 |
| **ワークフロー** | CI |
| **ジョブ名** | changes（paths-filter） |
| **ステップ名** | dorny/paths-filter |
| **ステータス** | resolved（正常動作の確認）|

### エラーメッセージ（原文）

```
（エラーなし。CI の pull_request run が開始されず、gh pr checks の出力に
 label ワークフローしか表示されない）
```

### 根本原因

`ci.yml` の `changes` ジョブは `dorny/paths-filter@v4` で変更ファイルを分類し、
`app / deps / stories` に該当するファイルが変更されていない場合は `lint-and-test` / `e2e-test` 等の
重いジョブをスキップする（intentional design）。

`docs/**` は paths-filter の対象外のため、docs のみを変更したコミットを push しても
`lint-and-test` 以降のジョブは実行されない。`gh pr checks` には `Labeler` ワークフローだけが表示される。

### 解決手順

```bash
# docs のみ変更の PR でフルCIを強制実行したい場合は workflow_dispatch を使う
gh workflow run ci.yml --ref <ブランチ名>

# またはアプリコードに実質的な変更がある commit を追加してから push する
# （空コミットだけでは docs のみ変更と同じ扱いになる）
```

### 再発防止策

- `gh pr checks` の結果が `label` のみの場合でも、docs のみ変更の PR では**正常**。慌てて空コミットを重ねない
- アプリコード変更を含む PR（`src/**` / `scripts/**` / `site/**` 等）では必ず `pull_request` CI が走るため、通常の開発では問題にならない
- docs のみ変更の PR で CI 全通過を確認したい場合は `gh workflow run ci.yml --ref <ブランチ名>` で手動実行する

---

## TA-003 — cognito-dev ビルドで `/sitemap.xml` がプリレンダエラーになる

| フィールド | 値 |
|-----------|-----|
| **発生日** | 2026-04-25 |
| **PR 番号** | #1499 |
| **ワークフロー** | CI |
| **ジョブ名** | e2e-cognito-dev |
| **ステップ名** | Build (cognito-dev mode) |
| **ステータス** | resolved |

### エラーメッセージ（原文）

```
302 /sitemap.xml -> /auth/login

Error: The following routes were marked as prerenderable, but were not prerendered because they were not found while crawling your app:
  - /sitemap.xml

See the `handleUnseenRoutes` option in https://svelte.dev/docs/kit/configuration#prerender for more info.
```

### 根本原因

`src/routes/sitemap.xml/+server.ts` は `export const prerender = true` が設定されており、
`svelte.config.js` の `prerender.entries` にも `'/sitemap.xml'` が明示登録されている（#832 で対応済み）。

しかし `AUTH_MODE=cognito COGNITO_DEV_MODE=true` のビルド時に、プリレンダクローラが `/sitemap.xml`
を取得しようとすると `src/lib/server/auth/authorization.ts` の `isPublicRoute()` が
`/sitemap.xml` を公開ルートとして認識せず、未認証扱いで `/auth/login` に 302 リダイレクトしてしまう。

`local` モードでは `hooks.server.ts` の 429 行目に `path !== '/sitemap.xml'` の明示除外があるが
（コメントに #832 と記載）、`cognito` モードの認可チェックには同等の除外が漏れていた。

### 解決手順

`src/lib/server/auth/authorization.ts` の `isPublicRoute()` 関数に `/sitemap.xml` と `/robots.txt`
を追加:

```typescript
function isPublicRoute(path: string): boolean {
  return (
    path === '/' ||
    // #832: SEO エンドポイントはプリレンダ対象。未認証でもクローラ・ビルドがアクセスできるよう公開する。
    path === '/sitemap.xml' ||
    path === '/robots.txt' ||
    path.startsWith('/auth') ||
    // ...
  );
}
```

### 再発防止策

- 新しい公開 SEO ルート（`sitemap.xml`, `robots.txt` 等）を追加する際は、`isPublicRoute()` への追加も忘れずに行う
- `local` モード向けの除外（`hooks.server.ts`）と `cognito` モード向けの除外（`authorization.ts`）は**両方**更新する必要がある（並行実装ペア）

---

## TA-004 — cognito-dev 専用テストが標準 e2e に混入してタイムアウト

| フィールド | 値 |
|-----------|-----|
| **発生日** | 2026-04-25 |
| **PR 番号** | #1499 |
| **ワークフロー** | CI |
| **ジョブ名** | e2e-test (shard X) |
| **ステップ名** | Run E2E tests |
| **ステータス** | resolved |

### エラーメッセージ（原文）

```
Error: locator.waitFor: Test timeout of 90000ms exceeded.
  await page.goto('/auth/login', { waitUntil: 'commit', timeout: 180_000 });
> await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 180_000 });
```

### 根本原因

`playwright.config.ts` の `BASE_TEST_IGNORE` に cognito-dev 専用の `*.spec.ts` を追加し忘れたため、
標準 e2e テスト (`AUTH_MODE=local`, port 5173) でも当該 spec が実行された。
`local` モードでは `/auth/login` が 302 redirect されてログインフォームが描画されないため、
`loginAsPlan()` が 180s 待ちでタイムアウトし CI がハングした。

### 解決手順

`playwright.config.ts` の `BASE_TEST_IGNORE` 配列に対象 spec のパターンを追加:

```typescript
// #1497: Stripe Checkout インターセプト E2E は cognito-dev モード専用（loginAsPlan を使用）
'**/upgrade-checkout.spec.ts',
```

### 再発防止策

**判定ルール**: 以下のいずれかを使う spec はすべて cognito-dev 専用 → `BASE_TEST_IGNORE` 必須:

- `loginAsPlan()` を呼ぶ
- `auth.setup.ts` / `storageState` を使う
- `/auth/login` のフォーム入力が必要

新しい cognito-dev 専用 spec を追加する際は、`playwright.config.ts` の `BASE_TEST_IGNORE` への追加を忘れずに行うこと。

**参考**: PR #1499, Issue #1497

---

## TA-005 — e2e-cognito-dev が timeout-minutes: 20 で cancelled

| フィールド | 値 |
|-----------|-----|
| **発生日** | 2026-04-25 |
| **PR 番号** | #1499 |
| **ワークフロー** | CI |
| **ジョブ名** | e2e-cognito-dev |
| **ステップ名** | （ジョブ全体）|
| **ステータス** | resolved |

### エラーメッセージ（原文）

```
The job running on runner GitHub Actions XX has exceeded the maximum execution time of 20 minutes.
```

### 根本原因

`e2e-cognito-dev` ジョブの `timeout-minutes: 20` 設定に対して、
npm ci + playwright install + build (cognito mode) + 全 cognito-dev spec 実行が 20 分を超過した。
CI run 24929009610 で cancelled (20m35s) が確認された。

### 解決手順

`.github/workflows/ci.yml` の `e2e-cognito-dev` ジョブの `timeout-minutes` を 20 → 30 に延長:

```yaml
  e2e-cognito-dev:
    ...
    timeout-minutes: 30
```

### 再発防止策

- cognito-dev spec が増える場合は、実行時間を計測して `timeout-minutes` を再評価すること
- spec を追加する際は CI run の実績時間を確認し、余裕を持った timeout 値を設定すること

**参考**: PR #1499, Issue #1497, CI run 24929009610

---
