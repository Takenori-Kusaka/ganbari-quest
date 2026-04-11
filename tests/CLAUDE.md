# tests/ — テスト品質ルール（ADR-0020）

テスト品質の劣化を許容しない。カバレッジ閾値の引き下げ・テスト回避パターンは CI で自動拒否する。

## 禁止事項

- **カバレッジ閾値の引き下げ** — `vite.config.ts` の `thresholds` を下げる PR はマージ不可。引き下げが必要な場合は ADR に理由と復元計画を同時にコミット
- **バグ隠蔽ヘルパー（ダイアログゴースト除去等）** — アプリのバグをテスト側で隠すのは禁止。アプリ側を修正する
- **`test.skip()` の安易な使用** — テストが通らないならアプリを直す。正当な理由（環境依存等）のみ許容
- **`waitForTimeout()` の新規使用** — E2E テストで固定待機を使わない。`waitForSelector()` / `waitForResponse()` を使う
- **サービスを呼ばないサービステスト** — `xxx-service.test.ts` は必ずサービスの公開 API を import して呼ぶ。DB 直接操作のみのテストは禁止
- **テスト内で実装ロジックを再実装** — 実装の関数を呼んで結果を検証する。テスト内で同じロジックを書いて「一致した」は無意味

## 機能追加 PR のテスト要件

- 新規サービスファイル追加時は、同 PR 内に対応するテストファイルを含めること
- 「テストは後で追加」は禁止。テストなしの機能追加 PR はドラフトのまま据え置き

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
