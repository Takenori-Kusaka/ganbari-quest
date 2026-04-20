# tests/ — テスト品質ルール（ADR-0020）

テスト品質の劣化を許容しない。カバレッジ閾値の引き下げ・テスト回避パターンは CI で自動拒否する。

## 禁止事項

- **カバレッジ閾値の引き下げ** — `vite.config.ts` の `thresholds` を下げる PR はマージ不可。引き下げが必要な場合は ADR に理由と復元計画を同時にコミット
- **バグ隠蔽ヘルパー（ダイアログゴースト除去等）** — アプリのバグをテスト側で隠すのは禁止。アプリ側を修正する
- **`test.skip()` の安易な使用** — テストが通らないならアプリを直す。正当な理由（環境依存等）のみ許容
- **`waitForTimeout()` の新規使用** — E2E テストで固定待機を使わない。`waitForSelector()` / `waitForResponse()` / `waitForURL()` / `waitForFunction()` / Web Animations API (`el.getAnimations({ subtree: true }).map(a => a.finished)`) を使う。**ESLint (`playwright/no-wait-for-timeout: error`) が自動拒否** (#1259 Phase 3)
- **`{ waitUntil: 'networkidle' }` の新規使用** — Playwright 公式で DISCOURAGED。Single Page App では never idle になる。`domcontentloaded` + web-first assertion (`toBeVisible()` / `toHaveText()`) を使う。**ESLint (`playwright/no-networkidle: error`) が自動拒否** (#1259 Phase 3)
- **サービスを呼ばないサービステスト** — `xxx-service.test.ts` は必ずサービスの公開 API を import して呼ぶ。DB 直接操作のみのテストは禁止
- **テスト内で実装ロジックを再実装** — 実装の関数を呼んで結果を検証する。テスト内で同じロジックを書いて「一致した」は無意味

## 機能追加 PR のテスト要件

- 新規サービスファイル追加時は、同 PR 内に対応するテストファイルを含めること
- 「テストは後で追加」は禁止。テストなしの機能追加 PR はドラフトのまま据え置き

## スキーマ変更 PR のテスト要件（ADR-0031（archive））

`src/lib/server/db/schema.ts` を変更する PR は以下を必須とする。#962 (`is_archived` NULL 混在で本番全停止) の再発防止。

### カラム追加時

- [ ] 新カラムに `default()` を必ず設定する（NULL を業務的意味で使う場合を除く）
- [ ] マイグレーション script (`scripts/add-*.cjs` / `scripts/migrate-*.cjs`) の `ALTER TABLE ADD COLUMN` に **対応する `UPDATE table SET col = <default> WHERE col IS NULL`** を同 script 内に書くこと
- [ ] 新カラムを `WHERE` / `eq()` / `and()` に使うクエリが 1 つでもあるなら、**NULL 混在行**での動作を検証するテストを `tests/unit/db/` または `tests/unit/services/` に 1 件追加すること

```ts
// 例: is_archived が NULL の既存行がクエリ結果から不当に除外されないか
it('is_archived が NULL の既存行もアクティブとして返される', () => {
  sqlite.exec(`INSERT INTO children (tenant_id, nickname, age, is_archived) VALUES ('t1', 'legacy', 5, NULL)`);
  const result = findAllChildren('t1');
  expect(result.map((c) => c.nickname)).toContain('legacy');
});
```

### クエリ側の NULL 安全性

新カラム + 既存テーブルの組み合わせで、「NULL = 既定値と同じ扱いにしたい」セマンティクスなら
`or(eq(col, default), isNull(col))` を使うか、**マイグレーション側で backfill** するかのどちらかを選ぶこと。
片側だけでは不十分（backfill が走る前にクエリが走るケースがある）。

### CI 自動チェック（warn）

`scripts/check-schema-change-tests.mjs` が PR 差分を走査し、`schema.ts` に diff があるのに
`tests/unit/db|services/` に diff が無い場合は警告を出す。blocker ではないが、
PR レビュー側で `[must]` 指摘判断の材料に使う。skip が必要なときは PR 本文に `[skip-schema-test-check]` を含める。

### DynamoDB 並行実装の整合性

`src/lib/server/db/sqlite/*.ts` と `src/lib/server/db/dynamodb/*.ts` に同じエンティティの repo
があるペアは、新カラム追加時に undefined / null / 既定値のハンドリングを両実装で一致させる。

## E2E 固有ガイダンス

- DB スキーマ変更時は `tests/e2e/global-setup.ts` のテストデータ投入も更新すること
- 全 5 年齢モード（baby/kinder/lower/upper/teen）のテストデータが必要
- 活動記録の完全フロー（確認→記録→コンボ→スタンプ→レベルアップ→ホーム復帰）を検証すること

## プラン別 seed fixture（#759）

プランティア（free / standard / family）やトライアル状態を持ったテストを書く場合、
`tests/helpers/plan-fixtures.ts` のヘルパを使う。ローカル SQLite には `licenses`
テーブルが存在しないため、プラン状態は `AuthContext` + `trial_history` テーブルの
組み合わせで表現する（詳しい経緯はファイル冒頭の設計メモを参照）。

### unit テスト（vitest）での使い方

```ts
import { createTestDb, closeDb } from '../helpers/test-db';
import {
  makeFreeContext,
  makeStandardContext,
  makeFamilyContext,
  seedTrialActive,
  seedTrialExpired,
  seedTrialActiveContext,
} from '../helpers/plan-fixtures';

const { sqlite, db } = createTestDb();

// 1. 純粋な AuthContext を組み立てる（DB I/O なし）
const freeCtx     = makeFreeContext({ tenantId: 't-1' });
const standardCtx = makeStandardContext({ tenantId: 't-2' });
const familyCtx   = makeFamilyContext({ tenantId: 't-3', role: 'parent', childId: 10 });

// 2. トライアル中のテナントを用意（licenseStatus=none のまま、trial_history で解決）
const { context, trial } = seedTrialActiveContext(sqlite, {
  tenantId: 't-trial',
  tier: 'family',
  daysOffset: 5,
});
// → resolveFullPlanTier('t-trial', 'none') が 'family' を返す

// 3. トライアル終了済み（再開始不可）
seedTrialExpired(sqlite, { tenantId: 't-used' });

closeDb(sqlite);
```

### E2E テスト（Playwright）での使い方

E2E のローカル認証モードは常に `plan=family` を返すため、本 seeder を呼んでも
プラン切替にはならない。E2E からプラン状態を切り替えたいときは
**`DEBUG_PLAN` / `DEBUG_TRIAL` 環境変数（#758）**を使うこと。

```bash
# 例: free プランで任意の E2E テストを実行
DEBUG_PLAN=free npx playwright test tests/e2e/some-spec.ts
DEBUG_PLAN=standard DEBUG_TRIAL=active DEBUG_TRIAL_TIER=family npx playwright test ...
```

詳細: `src/lib/server/debug-plan.ts` / `.env.example`

## cron E2E テストの書き方

`/api/cron/*` エンドポイントの E2E テストでは、`tests/e2e/helpers.ts` の cron ヘルパーを使う。

### ヘルパー

| 関数 | 用途 |
|------|------|
| `getCronHeaders()` | cron 認証用ヘッダーを返す（`CRON_SECRET` 設定時のみ `x-cron-secret` を含む） |
| `isCronAuthSkipped()` | cron 認証がスキップされる環境か判定（`CRON_SECRET` 未設定 + `AUTH_MODE=local`） |

### 認証の 3 パターン

`verifyCronAuth`（`src/lib/server/auth/cron-auth.ts`）は環境変数に応じて 3 通りの動作をする。
テストでは `getCronHeaders()` と `isCronAuthSkipped()` でこの分岐を吸収する。

| 条件 | 動作 | テストでの期待値 |
|------|------|----------------|
| `CRON_SECRET` 設定済み + ヘッダー一致 | 認証成功 | `200` |
| `CRON_SECRET` 設定済み + ヘッダー不一致/なし | 認証失敗 | `401` |
| `CRON_SECRET` 未設定 + `AUTH_MODE=local` | 認証スキップ | `[200, 500]`（DB 未初期化で 500 の場合あり） |
| `CRON_SECRET` 未設定 + `AUTH_MODE≠local` | 設定ミス | `500` |

### 使用例

```ts
import { expect, test } from '@playwright/test';
import { getCronHeaders, isCronAuthSkipped } from './helpers';

const cronSecret = process.env.CRON_SECRET;
const authSkipped = isCronAuthSkipped();

test('正常リクエスト', async ({ request }) => {
  // 認証不可能な環境では早期リターン
  if (!cronSecret && !authSkipped) {
    const res = await request.post('/api/cron/my-endpoint');
    expect(res.status()).toBe(500);
    return;
  }

  // getCronHeaders() が環境に応じた認証ヘッダーを返す
  const res = await request.post('/api/cron/my-endpoint', {
    headers: getCronHeaders(),
    data: { dryRun: true },
  });

  if (!cronSecret && authSkipped) {
    expect([200, 500]).toContain(res.status());
    if (res.status() !== 200) return;
  } else {
    expect(res.status()).toBe(200);
  }

  const body = await res.json();
  expect(body.ok).toBe(true);
});

test('認証エラー', async ({ request }) => {
  const res = await request.post('/api/cron/my-endpoint');
  if (cronSecret) {
    expect(res.status()).toBe(401);
  } else if (authSkipped) {
    expect([200, 500]).toContain(res.status());
  } else {
    expect(res.status()).toBe(500);
  }
});
```

### 注意事項

- インラインで `process.env.CRON_SECRET` / `AUTH_MODE` を直接参照してヘッダーを組み立てない。必ずヘルパーを使う
- `isCronAuthSkipped()` の判定ロジックは `verifyCronAuth` と同期している。cron-auth.ts のロジック変更時はヘルパーも更新すること
- ローカル開発環境（`AUTH_MODE=local`）では DB が未初期化で 500 を返す場合があるため、`[200, 500]` を許容する
