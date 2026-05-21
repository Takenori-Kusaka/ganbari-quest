# Marketplace Architecture SSOT

> **AI エージェント・新規貢献者へ**: マーケットプレイス (`src/lib/marketplace/`) の抽象化基盤・schema SSOT を集約するファイル。
> EPIC #2362 (PO 4 問題の構造的解決) で導入された Strategy + Registry パターン + Valibot schema の設計書。

**関連 Issue**: #2362 (EPIC) / #2363 (Registry 基盤) / #2364 (Valibot schema) / #2365-2369 (5 type 移行)
**関連 ADR**: ADR-0010 (Pre-PMF Bucket A) / ADR-0014 (OSS 先調査) / ADR-0045 (terms.ts SSOT 2 階層、同型) / ADR-0051 (本 EPIC で起票予定、#2363)

---

## §1 設計背景

### 1.1 PO 4 問題と抽象化欠如

EPIC #2362 で PO が 1 枚の `/admin/activities` SS から 4 問題を同時指摘:
1. マーケットプレイス → 活動 import 動作不良
2. 直接 import UI 重複表示
3. ヘッダー `?` ボタンと overflow menu の二重ガイド
4. Export → Import 機能消失

これらは全て **同じ抽象化欠如 5 階層 (L1-L5)** に起因。L1 `MarketplaceItemType` Strategy パターン欠如、L2 `ImportSource` Strategy、L3 PageGuide Registry、L4 Export/Import 互換 schema、L5 Empty State 統一。

### 1.2 既存実装の copy-paste 状態

`*-import-service.ts` 4 ファイル (activity / reward-set / checklist / rule-preset) が copy-paste で signature 不統一。`reward-set-import-service.ts:1` には「activity-import-service.ts を template として横展開」と明記コメントが残存。challenge-set は service 未実装で type 漏れ。新規 type 追加コストが 7 ファイル増分。

### 1.3 Valibot 採用判断 (#2364)

LP #1907 で 2.4 MB 削減した本プロダクトは bundle size に厳格。schema validation ライブラリ採否は EPIC 基盤判断:

| Library | Bundle (公開数値) | TS 推論 | SvelteKit 親和性 |
|---|---|---|---|
| Zod v3/v4 | 17.7 KB | 強 | superforms 公式 |
| **Valibot (採用)** | **1.37 KB** | 強 | superforms 対応 |
| TypeBox | 中 | 強 | Fastify エコ |
| ArkType | 中 | 最強 | △ |

本 PR で実測: 5 type 全 schema を 1 bundle に固めても **minified 1.79 KB / gzipped 859 bytes** で全 marketplace validation が完結。Standard Schema spec 対応で将来 Zod/ArkType 切替自由度を保持。

---

## §2 設計原則

### 2.1 Strategy + Registry パターン (ADR-0051、#2363)

新 type 追加が **1 ファイル増分** で済む構造。VSCode Extension Manifest / Obsidian Plugin / Figma Plugin Manifest と同型。

```
┌──────────────────────────────────────────────────┐
│ MarketplaceTypeRegistry                          │
│   register({ schema, strategy }) / get(type)     │
└─────────────┬────────────────────────────────────┘
              │ resolves
              ▼
┌──────────────────────────────────────────────────┐
│ ImportStrategy<T>          (per-type concrete)   │
│   preview(payload, ctx) / import(payload, ctx)   │
└──────────────────────────────────────────────────┘
```

### 2.2 Valibot schema SSOT 2 階層 (ADR-0045 同型、#2364)

`src/lib/domain/terms.ts` (atom) → `labels.ts` (compound) と**同型の責務分離**を schema にも適用:

```
src/lib/marketplace/schemas/
├─ activity-pack-schema.ts   ←─ atom (per-type Valibot schema)
├─ reward-set-schema.ts      ←─ atom
├─ checklist-schema.ts       ←─ atom
├─ rule-preset-schema.ts     ←─ atom
├─ challenge-set-schema.ts   ←─ atom
└─ index.ts                  ←─ compound (型 + Map re-export SSOT)
```

- 各 type 個別ファイルで Valibot DSL を定義 (`v.object({...})`)
- `index.ts` で `MarketplacePayloadSchemaMap` (Registry が consume する Map) と型 alias (`v.InferOutput<typeof Schema>`) を一元 export
- 既存 `src/lib/domain/marketplace-item.ts` の TypeScript interface は **schema 由来型と完全互換**になるよう設計 (Phase 1 段階では interface 残置、Phase 9 で削除統合)

### 2.3 Standard Schema spec 採用 (#2363 Registry interface で使用予定)

`@standard-schema/spec` 経由で `interface ImportStrategy<T>` の `schema: StandardSchema<T>` 型を定義することで、将来 Zod/ArkType 切替時も Registry side の変更不要。本 PR (#2364) では schema 定義側で `v.InferOutput` を直接使用し、Registry interface (#2363) で `StandardSchema` 抽象を被せる役割分担。

---

## §3 仕様

### 3.1 schema 5 type 仕様

#### 3.1.1 `activity-pack` (`ActivityPackPayloadSchema`)

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

#### 3.1.2 `reward-set` (`RewardSetPayloadSchema`)

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

#### 3.1.3 `checklist` (`ChecklistPayloadSchema`)

```ts
{
  timing: 'morning' | 'evening' | 'weekend' | 'daily' | 'weekly'
  items: Array<{ label: string (1-100); icon: string (1-10); order: integer ≥ 0 }>  (minLength: 1)
}
```

#### 3.1.4 `rule-preset` (`RulePresetPayloadSchema`)

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

#### 3.1.5 `challenge-set` (`ChallengeSetPayloadSchema`、新規 type)

EPIC #2364 で正式にマーケットプレイス対応。SiblingChallenge / AutoChallenge ドメインの「公式 challenge セット」形を融合定義。

```ts
{
  challenges: Array<{
    title: string (1-100)
    description?: string (≤500)
    icon: string (1-10)
    challengeType: 'cooperative' | 'competitive'
    periodType: 'daily' | 'weekly' | 'monthly'
    categoryCode?: CategoryCode    // 未指定時は全カテゴリ
    targetCount: integer (1-1000)
    rewardPoints: integer (0-10000)
  }>  (minLength: 1)
}
```

### 3.2 使用例

```ts
import * as v from 'valibot';
import {
  ActivityPackPayloadSchema,
  type ActivityPackPayload,
} from '$lib/marketplace/schemas';

const result = v.safeParse(ActivityPackPayloadSchema, unknownInput);
if (result.success) {
  const payload: ActivityPackPayload = result.output;
  // 型安全に消費
} else {
  // result.issues に path + message が path-precise で並ぶ
  for (const issue of result.issues) {
    console.error(issue.path?.map((p) => p.key).join('.'), issue.message);
  }
}
```

### 3.3 既存実装との関係 (Strangler Fig 段階移行)

- **Phase 1 (現在の本 PR #2364)**: Valibot schema 5 type を `src/lib/marketplace/schemas/` に新規追加。既存 `marketplace-item.ts` interface は残置、`*-import-service.ts` 4 ファイルも変更しない
- **Phase 2-6 (#2365-2369)**: 各 type の Strategy 実装で schema を consume するよう移行。旧 `*-import-service.ts` は deprecated marker 経由で 1 release 期間後に削除
- **Phase 9 (#2371 想定)**: `marketplace-item.ts` の TypeScript interface を schema 由来型 (`v.InferOutput<...>`) に置換し SSOT を schema 側に一元化

### 3.4 bundle size 実測 (#2364 PR description にも記載)

esbuild + gzip で計測 (`--minify --format=esm --target=es2022 --tree-shaking=true`):

| シナリオ | minified | gzipped |
|---|---|---|
| Valibot 単純 schema 1 件 (`activity-pack` 相当) | 1460 B | 741 B |
| **Valibot 5 type 全 schema bundle (本 PR scope)** | **1838 B (1.79 KB)** | **859 B** |
| Zod v3.x 単純 schema 1 件 (参考) | 1436 B | 736 B |

Zod は単純ケースでは tree-shaking で同等だが、複雑 schema (refinements / discriminated unions / transforms) で乖離が拡大することが Valibot 公式ベンチで報告されている。本プロダクトの marketplace schema は今後 Strategy 連動で複雑化するため、Valibot を選定する判断は妥当。

---

## §4 やらないこと (本 doc 範囲外)

- Registry interface 詳細 → ADR-0051 + marketplace/types module (#2363 で実装予定、本 PR 時点未存在)
- UnifiedImportHub UI → #2366 (EPIC P4)
- PageGuideRegistry → #2367 (EPIC P4)
- Export/Import round-trip 互換 schema v2 → #2370 (EPIC P4 #10)

---

## §5 関連リンク

- EPIC: [#2362](https://github.com/Takenori-Kusaka/ganbari-quest/issues/2362)
- Research: `tmp/research/architecture-redesign-result.md` §3-4
- Valibot 公式: https://valibot.dev/
- Standard Schema spec: https://github.com/standard-schema/standard-schema
- ADR-0014 (OSS 先調査原則 / #1350): [docs/decisions/0014-labels-i18n-mechanism.md](../decisions/0014-labels-i18n-mechanism.md)
