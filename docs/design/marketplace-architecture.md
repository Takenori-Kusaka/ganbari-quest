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
| P4 | #2370 / #2391 | UnifiedImportHub + UnifiedEmptyState (5 admin route 横展開完了) | `ActivityImportPanel.svelte` (#2391 で物理削除) |
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

- **`tests/unit/marketplace/registry.test.ts`** (#2363): Registry の register / get / list / has / size / clear + discriminated union + strategy 呼出契約 + `MARKETPLACE_TYPE_CODES` SSOT (15 ケース)
- **per-type strategy test** (#2365-2369): 各 type concrete strategy の parse / preview / apply 単体テスト
- **`tests/unit/marketplace/round-trip-required.test.ts`** (#2374): 5 type 全件 schema 経由 round-trip (seed → JSON → schema parse → 値同等性)
- **`tests/e2e/marketplace-round-trip-required.spec.ts`** (#2374): activity-pack の実 admin UI 動線 round-trip (export endpoint → import action)
- **integration E2E** (#10): 5 type 全件 export → import round-trip (将来、export endpoint 拡張時に追加)
- **Registry 完整性 CI 検知** (#2374): CI で `MARKETPLACE_TYPE_CODES` 5 件全てが register 済かを assert (詳細は §10)

---

## 10. Registry 完整性 CI 検知 (#2374、AN-5 #2180 補強 7)

Issue #2374 (EPIC #2362 P4) で導入された CI gate。`scripts/check-marketplace-registry-integrity.mjs` が `MARKETPLACE_TYPE_CODES` SSOT と register / strategy / schema / types module / index.ts side-effect import の完整性を構造的に検証する。

### 検証内容

| # | 検証項目 | 違反時の挙動 |
|---|---|---|
| 1 | `src/lib/marketplace/types.ts` の `MARKETPLACE_TYPE_CODES` を正規表現で抽出 | 抽出失敗 → exit 1 |
| 2 | `src/lib/marketplace/index.ts` で全 type が `import './types/<code>'` で side-effect import されている | 1 件でも欠落 → exit 1 |
| 3 | `src/lib/marketplace/types/<code>.ts` が存在し `marketplaceRegistry.register(...)` 呼出を持つ | 欠落 → exit 1 |
| 4 | 同 module 内の Descriptor object が `typeCode` / `displayLabel` / `description` / `strategy` / `requiresChildId` を全て持つ | 1 field 欠落 → exit 1 |
| 5 | Strategy ファイル (`src/lib/marketplace/strategies/<code>-strategy.ts`) が存在 | 欠落 → exit 1 |
| 6 | Schema ファイル (`src/lib/marketplace/schemas/<code>-schema.ts`) が存在 | 欠落 → exit 1 |

### CI ジョブ

`.github/workflows/ci.yml` `marketplace-registry-integrity-check` (独立並列 job、lint-and-test と並列)。`needs.changes.outputs.app == 'true'` または `deps == 'true'` 時のみ実行。`ci-gate` の `needs` 配列に組込済。

### ローカル実行

```bash
npm run check:marketplace-registry-integrity
# 内部で node scripts/check-marketplace-registry-integrity.mjs
```

### challenge-set 型漏れ事例 (本 CI gate の起票根拠)

EPIC #2362 background §L1 で判明した「challenge-set が `MarketplaceItemType` 4 値の中に含まれず service 不存在で 1 ヶ月放置」事例の構造的再発防止。新 type を `MARKETPLACE_TYPE_CODES` に追加した時点で、5 件の必須実装 (schema / strategy / types module / index.ts import / strategy unit test) が PR 段階で全て揃っていることを CI で hard-fail 検証する。

---

## 11. Round-trip E2E 必須化 (#2374)

PO 指摘 ④ (Export → Import 消失) の構造的回帰防止。以下 2 spec を CI で並列実行し、新 schema 変更が export/import 互換を破壊した瞬間に hard-fail する。

| spec | 担当 | カバレッジ |
|---|---|---|
| `tests/unit/marketplace/round-trip-required.test.ts` | 5 type 全件 | seed payload → `v.safeParse(Schema)` → JSON serialize → JSON deserialize → 再 `v.safeParse(Schema)` → 値同等性 (`toEqual`) |
| `tests/e2e/marketplace-round-trip-required.spec.ts` | activity-pack | 実 admin UI 動線 (`/api/v1/activities/export` → `/admin/activities?/importFile`) でゼロ情報欠落 round-trip |

5 type 全件 E2E round-trip は将来 (`#10` で `/api/v1/<type>/export` endpoint を全 type に展開した後) に拡張する。本 PR 時点では schema 経由 in-memory round-trip + activity-pack 実 UI round-trip の 2 段で「seed JSON が安全に export/import を往復できる」契約を CI で必須化する。

### round-trip 違反パターン (本 spec で検知される代表例)

- schema に新 field を追加したが optional 未指定 → 旧 export JSON を re-import で reject
- schema に `transform()` を追加して output ≠ input → 値同等性 assertion 失敗
- challenge-set のような新 type を export endpoint に追加し忘れ → SEED_CASES の `MARKETPLACE_TYPE_CODES` 全件カバレッジ assertion で fail

---

## 8. 関連ドキュメント

- [ADR-0052](../decisions/0052-marketplace-type-registry.md) — 採用根拠 + OSS 4 件比較
- [ADR-0046](../decisions/0046-svelte5-service-interface-context-di.md) — Service Interface + Context DI の同型パターン
- [docs/design/parallel-implementations.md](parallel-implementations.md) — 並行実装ペア (本 Registry 機構が確立した後、import service 並行 → strategy 並行へ移行予定)
- `src/lib/marketplace/types.ts` / `registry.ts` / `context.ts` / `index.ts` — 実体
- `tests/unit/marketplace/registry.test.ts` — Registry 単体テスト

---

## 9. Valibot schema 5 type 仕様 (#2364)

EPIC #2362 P1 Phase 1 で導入された Valibot schema SSOT。`src/lib/marketplace/schemas/` 配下の 5 type schema は、`src/lib/domain/marketplace-item.ts` の対応 TypeScript interface と完全整合する。Registry 統合 (`#2363` 後の各 type Strategy 実装 #2365-2369) で `descriptor.schema` として参照されることを想定。

実装ファイル:
- `src/lib/marketplace/schemas/activity-pack-schema.ts`
- `src/lib/marketplace/schemas/reward-set-schema.ts`
- `src/lib/marketplace/schemas/checklist-schema.ts`
- `src/lib/marketplace/schemas/rule-preset-schema.ts`
- `src/lib/marketplace/schemas/challenge-set-schema.ts`
- `src/lib/marketplace/schemas/index.ts` (compound SSOT、`MarketplacePayloadSchemaMap` 一元 export)

### 9.1 `activity-pack` (`ActivityPackPayloadSchema`)

```ts
{
  activities: Array<{
    name: string (1-50)
    categoryCode: 'undou' | 'benkyou' | 'seikatsu' | 'kouryuu' | 'souzou'
    icon: string (1-10)
    basePoints: integer (1-10000)
    ageMin: number | null
    ageMax: number | null
    gradeLevel: 'baby' | 'kinder' | 'elementary_lower' | ... | null
    triggerHint?: string (≤200)
    description?: string (≤500)
    mustDefault?: boolean    // #1758 / #1709-D
  }>  (minLength: 1)
}
```

### 9.2 `reward-set` (`RewardSetPayloadSchema`)

```ts
{
  rewards: Array<{
    title: string (1-100)
    points: integer (1-10000)
    icon: string (1-10)
    category: 'academic' | 'sports' | 'social' | 'creative' | 'life' | 'other'
    description?: string (≤500)
  }>  (minLength: 1)
}
```

### 9.3 `checklist` (`ChecklistPayloadSchema`)

```ts
{
  timing: 'morning' | 'evening' | 'weekend' | 'daily' | 'weekly'
  items: Array<{ label: string (1-100); icon: string (1-10); order: integer ≥ 0 }>  (minLength: 1)
}
```

### 9.4 `rule-preset` (`RulePresetPayloadSchema`)

```ts
{
  ruleType: 'exchange' | 'bonus' | 'penalty' | 'special'
  rules: Array<{
    title: string (1-100)
    description: string (1-500)
    icon: string (1-10)
    pointCost?: integer (0-10000)
    pointBonus?: integer (0-10000)
  }>  (minLength: 1)
}
```

### 9.5 `challenge-set` (`ChallengeSetPayloadSchema`)

SSOT 整合: `src/lib/domain/marketplace-item.ts` `ChallengeSetPayload` interface (#2297 で導入)。協力タイプ固定 (EPIC #2294 ② で competitive UI 撤去済) で、期間は monthDay (MM-DD) + durationDays の論理表現で年間行事 (お正月 / 節分 / ひな祭り / ハロウィン / クリスマス等) を表現する。import 時に service 側で当該年の日付に展開。

#2896 (2026-06-11 PO 判断): marketplace を活動 / ごほうび / チェックリストの 3 type に絞る方針に伴い、challenge-set は陳列対象外とし唯一の production preset を廃止した。`challenge-set` の型 / schema / Registry 登録は互換のため残置し、schema 整合の参照データは test fixture `tests/fixtures/marketplace/challenge-sets/japan-annual-events.json` (15 件) で継続検証する。陳列方針・顧客価値は [44-チャレンジ設計書.md](44-チャレンジ設計書.md) を参照。

```ts
{
  challenges: Array<{
    title: string (1-100)
    description: string (1-500)     // interface 上必須
    monthDay: string                // 'MM-DD' 形式 (例: '03-03' = ひな祭り)
    durationDays: integer (1-90)    // startDate = monthDay の (durationDays - 1) 日前 / endDate = monthDay
    categoryId: 1 | 2 | 3 | 4 | 5   // 1=undou 2=benkyou 3=seikatsu 4=kouryuu 5=souzou
    baseTarget: integer (1-1000)    // 達成目標 (例: 累積 10 回)
    rewardPoints: integer (0-10000)
    icon: string (1-10)
  }>  (minLength: 1)
}
```

### 9.6 bundle size 実測 (esbuild + gzip)

`--minify --format=esm --target=es2022 --tree-shaking=true`:

| シナリオ | minified | gzipped |
|---|---|---|
| Valibot 単純 schema 1 件 (`activity-pack` 相当) | 1460 B | 741 B |
| **Valibot 5 type 全 schema bundle** | **1838 B (1.79 KB)** | **859 B** |
| Zod v3.x 単純 schema 1 件 (参考) | 1436 B | 736 B |

複雑 schema (refinements / discriminated unions / transforms) では Valibot との乖離が拡大することが公式ベンチで報告されている。Strategy 連動で複雑化する本プロダクトでは Valibot 選定が妥当。

### 9.7 使用例

```ts
import * as v from 'valibot';
import {
  ActivityPackPayloadSchema,
  type ActivityPackPayload,
} from '$lib/marketplace/schemas';

const result = v.safeParse(ActivityPackPayloadSchema, unknownInput);
if (result.success) {
  const payload: ActivityPackPayload = result.output;
} else {
  for (const issue of result.issues) {
    console.error(issue.path?.map((p) => p.key).join('.'), issue.message);
  }
}
```

### 9.8 後続フェーズ

- **Phase 2-6 (#2365-2369)**: 各 type の Strategy が `descriptor.schema = SchemaXxx` を保持して parse 段階で利用
- **後続フェーズ (EPIC #2362 完遂時)**: `marketplace-item.ts` の TypeScript interface を schema 由来型 (`v.InferOutput<...>`) に置換し SSOT を schema 側に一元化 (現時点は interface が SSOT、schema が integrity 検証)
