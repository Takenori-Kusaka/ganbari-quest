# marketplace-architecture.md — Marketplace import/export 統一抽象化 SSOT

| 項目 | 内容 |
|------|------|
| 関連 ADR | [ADR-0052](../decisions/0052-marketplace-type-registry.md) (Strategy + Registry) / ADR-0046 (Service Interface + Context DI) / ADR-0023 archive (tenant isolation) |
| 関連 Issue | EPIC #2362 / 本 Issue #2363 (interface 基盤) / #2365-2369 (5 type concrete strategy) / #8 #9 #10 (UnifiedImportHub / PageGuideRegistry / Round-trip) |
| 更新タイミング | 新 MarketplaceType 追加 / Registry interface 変更 / Hub 配布パターン変更時 |

---

## 1. 設計背景

PO が `/admin/activities` の 1 SS から構造的欠陥 4 件を同時指摘 (EPIC #2362)。補佐 5 階層調査で根本原因が **抽象化欠如 5 階層 (L1-L5)** にあることが判明:

| 階層 | 欠如 | 物的証拠 | 本 PR (#2363) の扱い |
|---|---|---|---|
| **L1** | `MarketplaceItemType` Strategy パターン | 4 import service (`activity-import-service` / `reward-set-import-service` / `checklist-template-import-service` / `rule-preset-import-service`) が copy-paste、challenge-set は service 不存在 | **本 PR で interface 基盤を整備、#2365-2369 で concrete strategy 実装** |
| L2 | `ImportSource` Strategy | MP 選択 + File upload の 2 経路詰込 | #8 で UnifiedImportHub |
| L3 | PageGuide Registry | `PageHelpButton (?)` と Menu 内「使い方を見せる」二重表示 | #9 で PageGuideRegistry |
| L4 | Export/Import 互換 schema | `/api/v1/activities/export` 出力を受け取る import path 不在 | #10 で Round-trip schema v2 |
| L5 | Empty State 統一 | `ActivityEmptyState` は activity 専用、他 type で再発設計 | #8 (UnifiedEmptyState) |

本ドキュメントは **L1 (Strategy + Registry)** の SSOT。L2-L5 は別 Issue / 別 ADR で扱う。

---

## 2. 設計原則

### 2.1 1 type = 1 Strategy = 1 Descriptor

5 種類の `MarketplaceTypeCode` (activity-pack / reward-set / checklist / rule-preset / challenge-set) ごとに 1 つの `ImportStrategy<TPayload>` 実装 + 1 つの `MarketplaceTypeDescriptor<TCode, TPayload>` 登録を行う。Strategy は `parse(input)` / `preview(payload, ctx)` / `apply(payload, ctx)` の 3 メソッドを提供する契約 (`src/lib/marketplace/types.ts`)。

### 2.2 tenant isolation 型レベル強制 (ADR-0023 archive 整合)

`ImportContext.tenantId: string` を必須プロパティとして全 Strategy メソッドに引き渡す。Repository 層が `tenantId` を必須引数とする既存 SSOT と一貫し、cross-tenant データ汚染を型レベルで阻止。

### 2.3 dry-run / apply の二段階分離

UI 側で「N 件追加 / M 件重複スキップ」を事前提示できるよう、`preview()` と `apply()` を分離。`ctx.dryRun === true` を `apply()` 内で見ても良いが、原則は preview / apply の二段階呼び出し。

### 2.4 eager-load パターン (VSCode / Obsidian 同型)

`src/lib/marketplace/index.ts` で `import './types/<type>'` の side-effect により全 type が起動時 register される。SSR と CSR で同じ Registry singleton を共有 (module scope)。実行順序依存なし。

### 2.5 ADR-0046 Context DI 同型

Registry の SSR / CSR 配布は ADR-0046 と同じ `setContext` / `getContext` + symbol key パターン (`src/lib/marketplace/context.ts`)。本番 / demo / 第三者 host で別 Registry を注入する余地を残す。

---

## 3. アーキ概念図

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        src/lib/marketplace/  (SSOT)                          │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ types.ts                                                             │  │
│  │   ImportContext { tenantId, dryRun?, presetId?, childId?, ... }      │  │
│  │   ImportPreview { total, newItems, duplicates, ... }                 │  │
│  │   ImportResult  { imported, skipped, errors }                        │  │
│  │   ImportStrategy<TPayload> {                                         │  │
│  │     parse(input):    TPayload                                        │  │
│  │     preview(p, ctx): Promise<ImportPreview>                          │  │
│  │     apply(p, ctx):   Promise<ImportResult>                           │  │
│  │   }                                                                  │  │
│  │   MarketplaceTypeDescriptor<TCode, TPayload> {                       │  │
│  │     typeCode, displayLabel, description,                             │  │
│  │     strategy, requiresChildId, schema?                               │  │
│  │   }                                                                  │  │
│  │   MARKETPLACE_TYPE_CODES = [activity-pack, reward-set,               │  │
│  │     checklist, rule-preset, challenge-set] as const                  │  │
│  └────────────────────────────┬─────────────────────────────────────────┘  │
│                               │                                              │
│  ┌────────────────────────────▼─────────────────────────────────────────┐  │
│  │ registry.ts                                                          │  │
│  │   class MarketplaceTypeRegistry {                                    │  │
│  │     register(descriptor) → 二重登録は throw                          │  │
│  │     get(typeCode)        → narrowed Descriptor / 未登録は throw     │  │
│  │     has / list / size / clear                                        │  │
│  │   }                                                                  │  │
│  │   export const marketplaceRegistry = new MarketplaceTypeRegistry()   │  │
│  └────────────────────────────┬─────────────────────────────────────────┘  │
│                               │                                              │
│  ┌────────────────────────────▼─────────────────────────────────────────┐  │
│  │ context.ts (ADR-0046 同型 Svelte 5 DI)                               │  │
│  │   setMarketplaceRegistryContext(registry) — +layout.svelte で 1 度  │  │
│  │   getMarketplaceRegistry() — 配下 component / page                  │  │
│  └────────────────────────────┬─────────────────────────────────────────┘  │
│                               │                                              │
│  ┌────────────────────────────▼─────────────────────────────────────────┐  │
│  │ index.ts (公開 API + eager-load 統合)                                │  │
│  │   import './types/activity-pack'   // #2365                          │  │
│  │   import './types/reward-set'      // #2366                          │  │
│  │   import './types/checklist'       // #2367                          │  │
│  │   import './types/rule-preset'     // #2368                          │  │
│  │   import './types/challenge-set'   // #2369                          │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ 利用
                                    │
┌─────────────────────────────────────────────────────────────────────────────┐
│  src/routes/admin/  (UI 層、UnifiedImportHub = Issue #8、本 PR scope 外)    │
│                                                                              │
│  +layout.svelte                                                              │
│    setMarketplaceRegistryContext(marketplaceRegistry)                        │
│                                                                              │
│  marketplace/[typeCode]/import/+page.svelte (#8 で実装)                     │
│    const registry = getMarketplaceRegistry();                                │
│    const descriptor = registry.get(typeCode);                                │
│    const payload = descriptor.strategy.parse(uploadedJson);                  │
│    const preview = await descriptor.strategy.preview(payload, ctx);          │
│    // user 確認 → ...                                                       │
│    const result = await descriptor.strategy.apply(payload, ctx);             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 5 type の段階移行 (Strangler Fig、Shopify / Stripe API versioning 同型)

| Phase | Issue | type | 旧 service (削除予定) |
|---|---|---|---|
| **P1 (本 PR)** | **#2363** | **interface 基盤のみ** | — |
| P1 | #2364 | Valibot + Standard Schema 導入 | — |
| P2 | #2365 | activity-pack | `activity-import-service.ts` |
| P3 | #2366 | reward-set | `reward-set-import-service.ts` |
| P3 | #2367 | checklist | `checklist-template-import-service.ts` |
| P3 | #2368 | rule-preset | `rule-preset-import-service.ts` |
| P3 | #2369 | challenge-set | (新規、現状 service 不存在) |
| P4 | #8 | UnifiedImportHub + UnifiedEmptyState | `ActivityImportPanel.svelte` |
| P4 | #9 | PageGuideRegistry + Driver.js | `PageHelpButton` / Menu 二重 |
| P4 | #10 | Export schema v2 + round-trip | 既存 export endpoint |

旧 `*-import-service.ts` の即時削除は禁止。Strangler Fig パターンで 1 release 期間 `deprecated` marker を経由してから削除する (ADR-0022 archive の billing × データライフサイクル整合の発想を継承)。

---

## 5. 使用例 (#2365 以降の参考)

```ts
// src/lib/marketplace/types/activity-pack.ts (Issue #2365)
import { marketplaceRegistry } from '../registry.js';
import type { MarketplaceTypeDescriptor } from '../types.js';
import {
  importActivities,
  previewActivityImport,
  type ActivityImportPreview,
  type ActivityImportResult,
} from '$lib/server/services/activity-import-service.js';
import type { ActivityPackPayload } from '$lib/domain/marketplace-item.js';

const descriptor: MarketplaceTypeDescriptor<'activity-pack', ActivityPackPayload> = {
  typeCode: 'activity-pack',
  displayLabel: '活動セット',
  description: '日々の活動メニュー (運動 / 勉強 / 生活など) を一括取込',
  requiresChildId: false,
  strategy: {
    parse(input) {
      // Valibot schema (#2364) で validation、暫定で type assertion
      return input as ActivityPackPayload;
    },
    async preview(payload, ctx) {
      const p = await previewActivityImport(payload.activities, ctx.tenantId);
      return {
        total: p.total,
        newItems: p.newActivities,
        duplicates: p.duplicates,
        duplicateNames: p.duplicateNames,
        byCategory: p.byCategory,
      };
    },
    async apply(payload, ctx) {
      const r = await importActivities(payload.activities, ctx.tenantId, {
        presetId: ctx.presetId,
        applyMustDefault: ctx.applyMustDefault,
      });
      return { imported: r.imported, skipped: r.skipped, errors: r.errors };
    },
  },
};

marketplaceRegistry.register(descriptor);
```

```ts
// src/lib/marketplace/index.ts (#2365 完了後)
import './types/activity-pack';  // ← この 1 行が SSOT
// ...
```

---

## 6. 禁忌

- **Registry 外で type 別の switch 文を書かない**: `if (typeCode === 'activity-pack')` の散在禁止。常に `registry.get(typeCode).strategy.xxx()` を経由する
- **`+server.ts` / `+page.svelte` から `marketplaceRegistry` を直接 import しない**: 必ず `getMarketplaceRegistry()` (Context DI) 経由。SSR / CSR の Registry 入替え可能性を残す
- **`marketplaceRegistry.clear()` を本番コードで呼ばない**: テスト専用
- **新 type 追加時は `MARKETPLACE_TYPE_CODES` への追加と Descriptor 登録 + side-effect import を同 PR で完結させる**: 部分 commit 禁止
- **旧 `*-import-service.ts` を即削除しない**: Strangler Fig 期間 (1 release) は併存
- **tenant isolation の `ImportContext.tenantId` を optional にしない**: 型レベル強制を弱体化禁止 (ADR-0006)

---

## 7. テスト戦略

- **`tests/unit/marketplace/registry.test.ts`** (本 PR): Registry の register / get / list / has / size / clear + discriminated union + strategy 呼出契約 + `MARKETPLACE_TYPE_CODES` SSOT (15 ケース)
- **per-type strategy test** (#2365-2369): 各 type concrete strategy の parse / preview / apply 単体テスト
- **integration E2E** (#10): 5 type 全件 export → import round-trip
- **Registry 完整性 CI 検知** (#12): CI で `MARKETPLACE_TYPE_CODES` 5 件全てが register 済かを assert

---

## 8. 関連ドキュメント

- [ADR-0052](../decisions/0052-marketplace-type-registry.md) — 採用根拠 + OSS 4 件比較
- [ADR-0046](../decisions/0046-svelte5-service-interface-context-di.md) — Service Interface + Context DI の同型パターン
- [docs/design/parallel-implementations.md](parallel-implementations.md) — 並行実装ペア (本 Registry 機構が確立した後、import service 並行 → strategy 並行へ移行予定)
- `src/lib/marketplace/types.ts` / `registry.ts` / `context.ts` / `index.ts` — 実体
- `tests/unit/marketplace/registry.test.ts` — Registry 単体テスト
