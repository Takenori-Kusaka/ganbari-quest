# tests/ — テスト品質ルール

**SSOT**: ADR-0005（テスト品質 ratchet）/ ADR-0006（assertion 弱体化禁止）

テスト品質劣化は許容しない。カバレッジ閾値引き下げ・テスト回避は CI 自動拒否。

## テスト環境セットアップ (#2476)

新規 contributor / AI 補佐は **必ず以下 2 ステップを実行** してからテストを起動する。**`npm ci` 単独では `tests/unit/infra/` と `tests/unit/marketplace/` 系テストが Cannot find module で fail する**:

```bash
npm ci                  # root 依存 install
cd infra && npm ci      # infra 配下も install (必須)
cd ..
```

`prepare` script (root `package.json`) が 2 ステップ目を自動実行するが、`prepare` の各ステップは `||` 経由で warning を出すだけで silent fail する設計のため、**手動確認推奨**:

```bash
ls node_modules/valibot/                    # marketplace schemas で必要
ls infra/node_modules/aws-cdk-lib/          # tests/unit/infra/ で必要
ls node_modules/canvas-confetti/            # tests/unit/features/reward-celebration で必要
```

### 「Cannot find module 'XXX'」が出たら

| エラー | 原因 | 対処 |
|---|---|---|
| `Cannot find module 'valibot'` (`tests/unit/marketplace/schemas/*`) | root `node_modules/` 不整合 | `npm ci` または `rm -rf node_modules && npm install` |
| `Cannot find module 'aws-cdk-lib'` (`tests/unit/infra/multi-lambda-cdk.test.ts`) | `infra/node_modules/` 未 install | `cd infra && npm ci` を手動実行 |
| `Cannot find module 'canvas-confetti'` (`tests/unit/features/reward-celebration.test.ts`) | root `node_modules/` 不整合 | `npm ci` または `rm -rf node_modules && npm install` |

### `prepare` script の挙動 (#2476)

`package.json` `prepare` script は 3 ステップ実行する: `svelte-kit sync` / `husky` / `cd infra && npm ci`。各ステップ失敗時は `[prepare] ... FAILED — ...` の warning が標準出力に出るため、`npm install` / `npm ci` の出力末尾を確認する習慣をつける。

CI ログでも同 warning が出るため、PR の CI fail 調査時にまず確認する箇所。

## テスト分類（#1500）

| 分類 | 置き場所 | 特徴 |
|------|---------|------|
| **Unit** | `tests/unit/` | モック可、単一関数/モジュール |
| **Integration** | `tests/unit/` or `tests/integration/` | `page.route()` / DB in-memory。実サーバー不要 |
| **E2E** | `tests/e2e/` | モックなし、実アプリ全体 (`npm run dev` / `preview` 必要) |
| **Demo Lambda E2E** | `tests/e2e/demo-lambda/` | demo Lambda 環境専用 (#2205、`playwright.demo.config.ts`) |

判断: 実サーバー必要 → E2E / 不要 + モックで完結 → Integration / それ以外 → Unit。
`tests/e2e/integration/upgrade-checkout.spec.ts` は `page.route()` で Stripe モック (Integration 相当) だが cognito-dev 認証必要のため `playwright.cognito-dev.config.ts` 管理。

## demo Lambda E2E (`tests/e2e/demo-lambda/`、#2205)

ADR-0048 Multi-Lambda Demo Deployment で導入された demo Lambda (`demo.ganbari-quest.com`、
`AUTH_MODE=anonymous + DATA_SOURCE=demo`) 固有の動作 (匿名認証 / Bug 4 `/switch` クリック動作 /
marketplace seed 等) を検証する専用 spec 群。本番 cognito E2E では再現不可なため別 config で分離。

- **ローカル実行** (preview server 自動起動、port 5180):
  ```bash
  npm run test:e2e:demo
  ```
- **deploy 済 demo Lambda 検証** (preview server 起動せず prod URL を叩く):
  ```bash
  DEMO_BASE_URL=https://demo.ganbari-quest.com npm run test:e2e:demo
  ```
- **CI 実行条件** (`.github/workflows/ci.yml` §`e2e-demo-lambda` ジョブ):
  - `area:demo` ラベル付きの PR
  - main 押し up (`push` トリガー)
  - 手動実行 (`gh workflow run ci.yml`)
- **追加対象**: 新規 demo Lambda 固有動作 / `AnonymousAuthProvider` 仕様変更 / DEMO_WRITE_ALLOWLIST 増減 /
  `src/lib/server/demo/demo-data.ts` 仕様変更 を伴う PR は本ディレクトリに回帰テスト追加

## interactive flow は「操作 → 結果」を必須検証する (render-only 禁止) — #2544 / #2459 / UnifiedImportHub 事故

初顧客レビュー直前、実ユーザーが marketplace 取込ダイアログを 1 分操作しただけで「追加ボタン無反応・キャンセル不能」(機能 dead-end) を発見した。一方 E2E `admin-unified-import-hub.spec.ts` は **ダイアログが render される / testid visible だけを assert して PASS**。「追加 click → 活動が増える」= ユーザーの goal 完遂を一度も検証していなかった (render proxy は緑、goal 完遂は壊れている)。同じ機能を `marketplace-checklist-import.spec.ts:109-113` は **正しく `importBtn.click()` → imported バッジ visible を assert** している (= dead-end なら必ず fail)。**正解 pattern はリポジトリ内に既に存在**し、不足しているのは「それを default に強制する規律」である (#2544 research、既存ツールの過小活用が原因)。

### 原則 (render-only 禁止 / act → outcome assert 必須)

- **click / fill / submit を行う test は、その後に「結果の state 変化」を必ず assert する**。visible / count / attribute だけで終える test は interactive flow に対しては不可。
- 検証すべき「結果」(副作用 verify) は次のいずれか 1 つ以上:
  1. **network**: `page.waitForResponse(...)` + `resp.ok()` (form action / API が実際に発火したか)
  2. **UI 反映**: `toHaveText` / `toContainText` / 完了バッジ visible / dialog が `toBeHidden` / `toHaveCount(0)`
  3. **永続**: 一覧件数の増減 (`toHaveCount(before ± 1)`) / 残高数値の変化
- **dead-end 検出**: submit 系は必ず ① 発火 (network or loading) と ② 結果反映 を両方 assert する。「ボタンを押しても何も起きない」を捕捉する。
- **cancel 経路を別 assert で検証**: dialog を開く test は「close / cancel / backdrop → `toBeHidden`」も置く (今回 cancel も壊れていた)。
- **query 方針**: `getByRole` / text / label を優先。`getByTestId` は他で取れない場合の最終手段 (Testing Library 原則)。既存 testid を消す必要はないが、新規は role/text を先に検討する。

### render-only が許容される例外 (interactive flow ではないため対象外)

- 純粋表示 component (Logo / Badge 等、操作なし) の表示検証
- LP CSP / legal docs render / 404 fallback 等、**そもそも表示検証が目的**のもの
- アクセシビリティ / レイアウト回帰 (Storybook visual / a11y addon)

### dialog / form / menu の必須パターン

「open → act → 副作用 verify」を 1 セットで書く。helper `tests/helpers/goal-flows.ts` の `completeImportFlow` / `expectListGrew` / `expectDialogClosed` / `expectDialogCancellable` を使う (assertion 内包、`playwright/expect-expect` の `assertFunctionNames` に登録済)。

```ts
// before (render-only、PASS するが dead-end を見逃す)
await page.getByTestId('menu-item-import').click();
await expect(page.getByTestId('add-activity-dialog')).toBeVisible(); // ← ここで終了 = NG

// after (goal 完遂、無反応 / cancel 不能なら必ず fail)
import { completeImportFlow, expectDialogCancellable } from '../helpers/goal-flows';
await completeImportFlow(page, { /* trigger → act → result assert */ });
await expectDialogCancellable(page, { /* cancel → dialog 閉じる assert */ });
```

### 2 層 cadence (検証の段階分け、ADR-0007 EPIC-merge tier)

全 PR で全 critical journey を貫通させると CI が肥大化するため、検証は 2 層に分ける。**横断 cadence ポリシーの SSOT は ADR-0007** (本節はその tests/ 視点の抜粋)。

| 層 | いつ | 何を (機械・高速 / 半自動・人間判断) |
|---|---|---|
| **per-PR (軽量)** | 全 PR / push | 変更領域の targeted E2E (該当 spec のみ、`npx playwright test tests/e2e/<spec>`) + 型 (svelte-check) + Storybook 目視 / play (`npm run test:storybook`) + 用語 coherence lint (`check-internal-terms` / `check-add-path-coherence`) + add-path check。機械・高速。 |
| **EPIC-merge / 顧客レビュー gate (この規模だけ)** | EPIC 完了時 / 顧客レビュー前 | 全 critical user journey の goal 完遂貫通 E2E + Cognitive Walkthrough 4 質問 (#2459 C-2) + a11y (addon-a11y) + visual (pixelmatch) + 実機 1 クリック貫通。per-PR では重すぎるものをここに集約。 |

per-PR で「render-only 禁止 / act → outcome 必須」を守りつつ、CUJ 全網羅貫通や Cognitive Walkthrough は EPIC-merge gate に置く。「rendering + 型 + targeted で per-PR は十分、ただし interactive flow には outcome 必須」が原則 (#2459 やらないこと #3 の precise 化と整合)。

### CUJ (Critical User Journey) — EPIC-merge gate で完遂貫通

本アプリの core CUJ は最低限以下を「起動」でなく「goal 1 つ完遂」で持つ。各 CUJ は「途中で詰まる (dead-end)」を検出する assert を 1 つ以上含む:

1. 活動を追加する (admin → `+` → import dialog → 一覧に反映) ← 今回壊れた経路、最優先
2. 子供が活動を記録する (確認 → 記録 → ポイント加算 → home 復帰)
3. ごほうびを交換する (交換 → ポイント残高減 → 交換済み反映)
4. 報酬リクエスト承認 (child 申請 → admin 承認 → 状態変化)
5. チェックリスト import → child で表示

### Storybook interaction test (component 層、server 不要で配線健全性検証)

interactive component (Dialog / Form / UnifiedImportHub / Menu) は `play` 関数で「操作 → callback 発火 (`fn()` spy) / disabled 制御 / cancel 発火」を component 層で検証する。server 反映 (DB) は Playwright (統合層) に委ね、component 層は配線健全性に限定する (二重防御)。`play` 内 `expect` / `userEvent` / `fn` は **`storybook/test`** (Storybook 10 同梱) から import し、`npm run test:storybook` (`vitest run --project storybook`) で CI 実行する。exemplar: `src/lib/marketplace/ui/UnifiedImportHub.stories.svelte`。

## 禁止事項

- **カバレッジ閾値の引き下げ** — `vite.config.ts` `thresholds` 引き下げ PR は CI 自動拒否（`scripts/check-coverage-threshold.js`）。引き下げ必要なら ADR で復元計画と同時コミット
- **バグ隠蔽ヘルパー（ダイアログゴースト除去等）** — アプリ側を修正
- **`test.skip()` 安易使用** — 通らないならアプリを直す
- **`waitForTimeout()` 新規使用** — `waitForSelector()` / `waitForResponse()` / `waitForURL()` / `waitForFunction()` / Web Animations API を使う。**ESLint `playwright/no-wait-for-timeout: error` 自動拒否** (#1259 Phase 3)
- **`{ waitUntil: 'networkidle' }`** — Playwright 公式 DISCOURAGED。`domcontentloaded` + web-first assertion を使う。**ESLint `playwright/no-networkidle: error` 自動拒否**
- **`isVisible()` + `expect(...).toBe(true)` の assertion** — 同期評価で auto-retry が効かず flake (#1768)。`await expect(locator).toBeVisible()` を使う。`isVisible()` 許容用途は条件分岐 (`if (await x.isVisible().catch(() => false))`) のみ
- **サービスを呼ばないサービステスト** — `xxx-service.test.ts` は公開 API を import して呼ぶ
- **テスト内で実装ロジック再実装** — 実装の関数を呼んで結果検証

## 機能追加 PR のテスト要件

新規サービスファイル追加時は同 PR 内に対応テストファイル必須。「テストは後で」禁止。テストなし機能追加 PR は Draft 据え置き。

## スキーマ変更 PR のテスト要件（#962 教訓）

`src/lib/server/db/schema.ts` 変更 PR の必須事項:

### カラム追加時
- 新カラムに `default()` 設定（NULL を業務的意味で使う場合を除く）
- マイグレーション script の `ALTER TABLE ADD COLUMN` に対応する `UPDATE table SET col = <default> WHERE col IS NULL` を同 script 内に書く
- 新カラムを `WHERE` / `eq()` / `and()` に使うクエリがあるなら **NULL 混在行**動作の検証テストを `tests/unit/db/` または `tests/unit/services/` に 1 件追加

```ts
it('is_archived が NULL の既存行もアクティブとして返される', () => {
  sqlite.exec(`INSERT INTO children (tenant_id, nickname, age, is_archived) VALUES ('t1', 'legacy', 5, NULL)`);
  expect(findAllChildren('t1').map((c) => c.nickname)).toContain('legacy');
});
```

### クエリ側 NULL 安全性

「NULL = 既定値扱い」セマンティクスなら `or(eq(col, default), isNull(col))` または **マイグレーションで backfill**。片側だけは不十分。

CI 自動チェック (`scripts/check-schema-change-tests.mjs`、warn): `schema.ts` diff があるのに `tests/unit/db/` または `tests/unit/services/` diff が無い場合警告。skip 必要時は PR 本文に `[skip-schema-test-check]`。

### DynamoDB 並行実装の整合性

`src/lib/server/db/sqlite/*.ts` と `src/lib/server/db/dynamodb/*.ts` のペアは新カラム追加時に undefined / null / 既定値ハンドリングを両実装で一致させる。

## E2E 固有

- DB スキーマ変更時は `tests/e2e/global-setup.ts` のテストデータ投入も更新
- 全 4 年齢コアモード (preschool/elementary/junior/senior) のテストデータ必要
- 活動記録の完全フロー (確認→記録→コンボ→スタンプ→レベルアップ→ホーム復帰) を検証

## プラン別 seed fixture（#759）

`tests/helpers/plan-fixtures.ts` を使用。ローカル SQLite に `licenses` テーブルが存在しないため、プラン状態は `AuthContext` + `trial_history` 組み合わせで表現（詳細はファイル冒頭の設計メモ）。

### Unit (vitest)

```ts
import { makeFreeContext, makeStandardContext, makeFamilyContext, seedTrialActiveContext, seedTrialExpired } from '../helpers/plan-fixtures';

const freeCtx = makeFreeContext({ tenantId: 't-1' });
const { context } = seedTrialActiveContext(sqlite, { tenantId: 't-trial', tier: 'family', daysOffset: 5 });
seedTrialExpired(sqlite, { tenantId: 't-used' });
```

### E2E (Playwright)

E2E ローカル認証モードは常に `plan=family` を返すため seeder ではプラン切替不可。`DEBUG_PLAN` / `DEBUG_TRIAL` env (#758) を使う:
```bash
DEBUG_PLAN=free npx playwright test tests/e2e/some-spec.ts
DEBUG_PLAN=standard DEBUG_TRIAL=active DEBUG_TRIAL_TIER=family npx playwright test ...
```

詳細: `src/lib/server/debug-plan.ts` / `.env.example`

## 局所テストコマンド (#2184)

tests 配下のみ修正 / 個別 spec デバッグ時は全体実行を待たず以下で高速検証:

```bash
npx vitest run tests/unit/<subdir>/                             # unit test 個別実行
npx vitest run tests/unit/db/                                   # DB 層 unit test
npx vitest run tests/unit/services/                             # service 層 unit test
npx playwright test tests/e2e/<spec>.spec.ts                    # E2E 個別 spec
npx playwright test tests/e2e/<spec>.spec.ts --grep "<title>"   # spec 内テスト個別
npx playwright test tests/e2e/<spec>.spec.ts --debug            # ヘッドフルデバッグ
npm run test:storybook                                          # Storybook test
```

SSOT: `docs/CLAUDE.md` §「サブディレクトリ別局所テストコマンド SSOT」。Ready 化前は `npm run pre-ready -- --pr <num>` で全 step PASS が必須。

## cron E2E テスト

`/api/cron/*` エンドポイントは `tests/e2e/helpers.ts` の cron ヘルパー必須:

| 関数 | 用途 |
|------|------|
| `getCronHeaders()` | cron 認証用ヘッダー（`CRON_SECRET` 設定時のみ `x-cron-secret` を含む） |
| `isCronAuthSkipped()` | cron 認証スキップ環境判定（`CRON_SECRET` 未設定 + `AUTH_MODE=local`） |

3 パターン分岐: ① `CRON_SECRET` 設定 + ヘッダー一致 → 200 / ② 設定 + 不一致 → 401 / ③ 未設定 + `AUTH_MODE=local` → `[200, 500]`（DB 未初期化で 500 あり）/ ④ 未設定 + その他 → 500。

```ts
const cronSecret = process.env.CRON_SECRET;
const authSkipped = isCronAuthSkipped();

test('正常リクエスト', async ({ request }) => {
  if (!cronSecret && !authSkipped) {
    expect((await request.post('/api/cron/my-endpoint')).status()).toBe(500);
    return;
  }
  const res = await request.post('/api/cron/my-endpoint', { headers: getCronHeaders(), data: { dryRun: true } });
  if (!cronSecret && authSkipped) {
    expect([200, 500]).toContain(res.status());
  } else {
    expect(res.status()).toBe(200);
  }
});
```

注意: インライン `process.env` 参照禁止、必ずヘルパー使用。`cron-auth.ts` ロジック変更時はヘルパーも更新。
