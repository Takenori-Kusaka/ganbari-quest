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

## TA-006 — PR ブランチで noUncheckedIndexedAccess に違反した配列添字アクセス

| フィールド | 値 |
|-----------|-----|
| **発生日** | 2026-04-25 |
| **PR 番号** | #1505 |
| **ワークフロー** | CI |
| **ジョブ名** | lint-and-test |
| **ステップ名** | Svelte check (#1432 — warning=error) |
| **ステータス** | ongoing |

### エラーメッセージ（原文）

```
tests/unit/infra/health-check-lambda.test.ts:350:31
Error: Object is possibly 'undefined'. 
			const written = JSON.parse(ssmStore.putCalls[0].Value);
```

4 箇所（行 350, 376, 418, 462）で同様のエラーが発生。

### 根本原因

テストファイルで `ssmStore.putCalls[0].Value` を直接使用しており、TypeScript strict の
`noUncheckedIndexedAccess` オプションが有効なため、添字アクセスの戻り値が `T | undefined`
となり `.Value` への直接アクセスが型エラーになる。

ローカルには修正コミット（`putCalls[0]!` 非 null アサーション追加）が存在したが、
リモートの PR ブランチに push されていなかった。

### 解決手順

```typescript
// Before (NG)
const written = JSON.parse(ssmStore.putCalls[0].Value);

// After (OK — 非 null アサーション)
const written = JSON.parse(ssmStore.putCalls[0]!.Value);

// After (推奨 — find() パターン)
const put = ssmStore.putCalls.find(c => c.Name === WEEKLY_STATS_KEY);
expect(put).toBeDefined();
const written = JSON.parse(put!.Value);
```

修正後、ブランチを push して CI を再実行する。

### 再発防止策

- テストコードでも `noUncheckedIndexedAccess` は有効。配列の添字アクセスには `!` アサーションか `find()` パターンを使う
- `expect(array).toHaveLength(N)` の直後でも TS は型ガードを認識しないため `!` が必要

---

## TA-007 — docker-build で lightningcss.linux-x64-musl.node が見つからない

| フィールド | 値 |
|-----------|-----|
| **発生日** | 2026-04-25 |
| **PR 番号** | #1505 |
| **ワークフロー** | CI |
| **ジョブ名** | docker-build |
| **ステップ名** | Build Docker image (NUC) |
| **ステータス** | ongoing |

### エラーメッセージ（原文）

```
Error: Cannot find module '../lightningcss.linux-x64-musl.node'
Require stack:
- /app/node_modules/lightningcss/node/index.js
```

### 根本原因

Docker ビルド（Alpine/musl ベース）で `lightningcss` のネイティブバイナリ
（`lightningcss.linux-x64-musl.node`）が見つからないエラー。
PR ブランチで `package-lock.json` が更新された（`@aws-sdk/client-ssm` 追加）際に、
musl ターゲット向けバイナリが `optionalDependencies` に正しく含まれていない可能性がある。

同一ブランチの以前の CI run（24923677509, 2026-04-25T05:32:24Z）は成功しており、
main ブランチ（24931922154, 2026-04-25T13:24:56Z）では docker-build が成功している。
このため、PRブランチのコード変更または package-lock.json の状態が原因と考えられる。

### 解決手順

```bash
# 1. package-lock.json を最新状態に再生成
npm install  # または npm ci で lockfile との整合性確認

# 2. lightningcss の optional deps が正しく含まれているか確認
cat node_modules/lightningcss/package.json | grep -A 20 optionalDependencies

# 3. main ブランチの package-lock.json と比較して差分を確認
git diff origin/main -- package-lock.json | grep lightningcss
```

または、rebase で main の最新を取り込むことで解消する可能性がある。

### 再発防止策

- `package-lock.json` を変更する PR では、Docker ビルドが通るまで CI で確認する
- `lightningcss` のような native addon は OS/libc の種類（glibc vs musl）によってバイナリが異なるため、Alpine ベースのビルドでは `optionalDependencies` が正しく解決されているか確認する

---

## TA-008 — screenshot-check / design-doc-check / Verify AC map の同時失敗パターン

| フィールド | 値 |
|-----------|-----|
| **発生日** | 2026-04-26 |
| **PR 番号** | #1534 |
| **ワークフロー** | pr-quality-gate |
| **ジョブ名** | screenshot-check / design-doc-check / Verify AC map in PR body |
| **ステータス** | resolved |

### エラーメッセージ（原文）

```
screenshot-check:
❌ UI変更PRにはスクリーンショットの添付が必須です。

design-doc-check:
❌ src/routes/ に変更がありますが、docs/design/ の更新がありません。
設計書の同期更新が必要な場合は同一PR内で更新してください（ADR-0003）。

Verify AC map in PR body:
PR 本文に「AC 検証マップ」セクションが見つかりません (ADR-0038)
```

### 根本原因

1. **screenshot-check**: PR body に `![...](...)` または `<img` 形式の画像が一切なかった（「TODO: 撮影予定」のまま Ready for Review になっていた）
2. **design-doc-check**: `src/routes/` に新規ファイルを追加したが、`docs/design/` を一切変更していなかった
3. **Verify AC map**: PR body の AC セクションが `## AC 対応状況` というチェックボックス形式だった。CI が検索するキーワードは **「AC 検証マップ」** であり、`## AC 検証マップ` ヘッダー + 4列テーブル形式が必須（ADR-0038）

### 解決手順

```bash
# 1. design-doc-check — 設計書を更新してコミット
# docs/design/06-UI設計書.md の該当セクションにページ/機能を追記し
# 更新履歴テーブルに新バージョン行を追加する
git add docs/design/06-UI設計書.md
git commit -m "docs: 設計書に新機能仕様を追記"

# 2. screenshot-check — スクリーンショットを撮影して PR body に追加
# Playwright で各年齢モードのページを撮影
# ※ Windows では checkPort が 127.0.0.1 を使うため dev server が ::1 でリスンしていると
#   capture.mjs が起動失敗することがある。その場合は Playwright を直接使用する:
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addCookies([{ name: 'selectedChildId', value: '1', domain: 'localhost', path: '/' }]);
  const page = await ctx.newPage();
  await page.goto('http://localhost:5173/preschool/shop', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'docs/screenshots/pr-NNN/shop-preschool-mobile.png' });
  await browser.close();
})();
"

# 3. Verify AC map — PR body の AC セクション見出しを「AC 検証マップ」に変更し
# チェックボックス形式から 4列テーブル形式に変換する
# 必須形式:
# ## AC 検証マップ
# | AC番号 | AC内容 | 検証手段 | 結果/エビデンス |
# |--------|--------|---------|----------------|
# | AC1 | ... | ... | ✅ ... |
gh pr edit NNN --body "$(cat pr-body.md)"
```

### 再発防止策

- `src/routes/` を変更する PR では必ず `docs/design/` の対応する設計書を同一 PR で更新する（`docs/CLAUDE.md` の更新ルール表を参照）
- PR body の AC セクションは `## AC 検証マップ` (ADR-0038) で統一し、4列テーブル形式を使う。チェックボックス形式 `- [x]` は CI が認識しない
- Windows 環境で `capture.mjs` が `サーバーが 40 秒以内に起動しませんでした` でタイムアウトする場合、dev server が `::1` でリスンしているが `checkPort` が `127.0.0.1` を見ているため。PowerShell で dev server を起動し、Playwright スクリプトを直接実行する回避策を使う
- スクリーンショットは `docs/screenshots/pr-NNN/` にコミットして `raw.githubusercontent.com` 経由で PR body から参照する

---

## TA-009 — loginAsPlan() 未移行で storageState 導入後も e2e-cognito-dev が 30m+ timeout

| フィールド | 値 |
|-----------|-----|
| **発生日** | 2026-04-26 |
| **PR 番号** | #1514 |
| **ワークフロー** | CI |
| **ジョブ名** | e2e-cognito-dev |
| **ステップ名** | Run cognito-dev E2E tests |
| **ステータス** | ongoing |

### エラーメッセージ（原文）

```
The job has exceeded the maximum execution time of 30m0s
Running 720 tests using 1 worker
```

### 根本原因

Issue #1500 では storageState を使って認証を高速化することが AC3 として定義されていた（`loginAsPlan()` の呼び出しが 0 回）。
しかし PR #1514 では `playwright.cognito-dev.config.ts` に 6 プロジェクトを追加したものの、
既存 spec 側の `loginAsPlan()` 呼び出し（104 箇所）は「段階的移行」として先送りされた。

storageState を設定しても、spec 内で `loginAsPlan()` を呼べば storageState は無視されて再ログインが発生する。
結果として 6 プロジェクト × 14 spec = `workers: 1` で 720 tests が直列実行され、
フルログイン（約 25 秒 × 104 回）で合計 30 分を大幅に超過した。

これは timeout 値の問題ではなく **spec 側の実装未移行（AC3 未達）が根本原因**。

### 解決手順

AC3（`loginAsPlan()` 0 回化）を完了させる必要がある:

```bash
# loginAsPlan() の使用箇所を確認
grep -rn "loginAsPlan" tests/e2e/ | grep -v ".json"

# 各 spec を storageState ベースに移行:
# 1. spec の各 test の冒頭の loginAsPlan(page, 'free') を削除
# 2. page.goto('/admin') から開始（storageState で既にログイン済み）
# 3. playwright.cognito-dev.config.ts で対応するプロジェクト（as-free 等）を割り当て

# 移行後の動作確認
npx playwright test --config playwright.cognito-dev.config.ts
```

また `upgrade-checkout.spec.ts` の適切な置き場所への移動（AC2）も必要。

### 再発防止策

- storageState プロジェクトを追加しても spec 側が `loginAsPlan()` を呼んでいると意味がない
- `auth.setup.ts` / storageState プロジェクト追加 PR では、同一 PR 内で spec の `loginAsPlan()` 呼び出しを 0 件にすること（「段階的移行」の先送りは AC 未達と同義）
- CI 実行で `Running N tests using 1 worker` が表示されたら、N と timeout-minutes の比を確認する（720 tests × 平均 2.5 分/test = 30 分超）

**参考**: PR #1514, Issue #1500, CI run 24933566368

---

## TA-010 — workers: 2 並列実行による point_ledger 汚染でショップ disabled テストが失敗

| フィールド | 値 |
|-----------|-----|
| **発生日** | 2026-04-26 |
| **PR 番号** | #1534 |
| **ワークフロー** | CI |
| **ジョブ名** | e2e-test (shard 1/3) |
| **ステップ名** | Run E2E tests (shard 1/3) |
| **ステータス** | resolved |

### エラーメッセージ（原文）

```
Error: expect(locator).toBeDisabled() failed

Locator:  locator('[data-testid^="reward-card-"]').filter({ hasText: 'E2Eテスト用ごほうび（交換不可）' }).locator('button[data-testid^="exchange-btn-"]')
Expected: disabled
Received: enabled
Timeout:  5000ms
```

### 根本原因

`child-shop-exchange.spec.ts` の「ポイント不足のごほうびは交換ボタンが disabled」テストは
たろうくんのポイント残高が 200pt 未満（100pt）であることを前提にしていた。

しかし `workers: 2` の並列実行環境では、`features.spec.ts` 等の別テストが
`selectKinderChild()` → 活動記録 → `point_ledger` への書き込み を行うため、
ショップテストが実行される頃にはたろうくんの残高が 390P / 465P に積み上がっていた。

`global-setup.ts` の残高調整は setup 実行時点では正しく 100pt にするが、
**並列ワーカー内の他テストが後からポイントを追加するため**、実行順序によって失敗する。

### 解決手順

`child-shop-exchange.spec.ts` に `test.beforeAll` を追加し、テスト実行直前に
better-sqlite3 で `point_ledger` を直接操作して残高を 100pt に再調整する:

```typescript
test.beforeAll(async () => {
  // DB 直接操作で点数を 100pt にリセット（global-setup.ts と同じパターン）
  const DB_PATH = path.resolve('data/ganbari-quest.db');
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(DB_PATH);
  // shop_test_seed エントリを削除 → 現在残高を計算 → 差分エントリを挿入
  ...
});
```

### 再発防止策

- `point_ledger` を直接操作するテスト（`selectKinderChild()` → 活動記録系）と
  残高に依存するテストが同一ワーカーで並列実行されると汚染が発生する
- 残高の絶対値に依存するテストは必ず `beforeAll` で DB 状態を確認・リセットすること
- `global-setup.ts` の `shop_test_seed` 調整だけでは workers 並列実行には対応できない

**参考**: PR #1534, Issue #1335, CI run 24945001950
