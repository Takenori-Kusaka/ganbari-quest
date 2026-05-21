# 0052. MarketplaceTypeRegistry + ImportStrategy パターンによる 5 type 統一抽象化

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-05-21 |
| 起票者 | Dev (Issue #2363 / EPIC #2362) |
| 関連 Issue | #2362 (EPIC) / #2363 (本 ADR の起票元) / #2365-2369 (concrete strategy 実装) |

> **番号衝突メモ**: 元 Issue #2363 では「ADR-0051」と指示されていたが、起票時点で `0051-license-page-nuc-saas-bifurcation.md` (2026-05-20) が確保済のため renumber 規約 (`docs/decisions/README.md` §renumber) に従い **0052** に振り直した。

## コンテキスト

PO が 1 枚の `/admin/activities` SS から構造的欠陥 4 件を同時指摘した (EPIC #2362):
① マーケプレ → 活動 import が動かない / ② 活動管理画面に直接 import UI が重複 / ③ ヘッダー ? と overflow menu で二重ガイド / ④ エクスポート → インポートの round-trip が消失。

補佐 5 階層調査で根本原因が **抽象化欠如 5 階層 (L1-L5)** にあると判明:

- **L1 (本 ADR の対象)**: `MarketplaceItemType` Strategy パターン欠如
  - 4 import service (`activity-import-service` / `reward-set-import-service` / `checklist-template-import-service` / `rule-preset-import-service`) が copy-paste で signature 不統一
  - `reward-set-import-service.ts:1` のコメントが自認: 「activity-import-service.ts を template として横展開」
  - challenge-set は service 不存在で type 漏れ (`MarketplaceItemType` は 4 値のみ、5 番目が抜けている)
- L2-L5 は別 ADR / 別 Issue で対応 (UnifiedImportHub #8 / PageGuideRegistry #9 / Round-trip schema #10 / EmptyState 統一 #8)

「世間が使っているものを見もしないまま独自実装」(ADR-0014 / #1350) を避け、本 ADR で **Strategy + Registry パターンの SSOT 機構** を確立する。本 PR (#2363) は **interface 基盤のみ**、concrete strategy は #2365-2369 で順次追加する Strangler Fig 段階移行 (Shopify / Stripe API versioning 同型)。

## 検討した選択肢 (OSS / 確立パターン 4 件比較、ADR-0014 / #1350 整合)

### 選択肢 A: Strategy + Registry パターン (採用)

- **OSS / 確立パターンの実装例**:
  - **VSCode Extension API `contributes`**: <https://code.visualstudio.com/api/references/extension-manifest> — manifest 駆動 + extension activation event + commands / views / language registry。10 年以上の本番稼働実績、数万 extension が同型 interface を実装
  - **Obsidian Plugin**: <https://docs.obsidian.md/Reference/TypeScript+API/Plugin> — `Plugin.onload()` で Registry に register、TypeScript 完全型安全、1500+ community plugins
  - **Figma Plugin Manifest**: <https://developers.figma.com/docs/plugins/manifest/> — `manifest.json` driven、5000+ plugins
  - **GoF Strategy Pattern**: 1994 年以来の確立パターン、Effective Java / Design Patterns 教科書記載
- **メリット**:
  - **SOLID 5 全充足** (SRP / OCP / LSP / ISP / DIP): 新 type 追加が 1 ファイル増分 (`marketplace/types/` 配下に各 type module を 1 つ追加するだけで完結)
  - **discriminated union 型安全**: `registry.get('activity-pack')` がリテラル型 narrow
  - **eager-load パターン**: `src/lib/marketplace/index.ts` で `import './types/<type>'` の side-effect により全 type が起動時登録 (VSCode / Obsidian と同型)
  - **テスト容易性**: Strategy を mock 化して Registry 単体テストが書ける
  - **既存 ADR-0046 (Service Interface + Context DI) と相補的**: Registry の SSR / CSR 配布は ADR-0046 と同じ `setContext` / `getContext` パターンを再利用
- **デメリット**:
  - register 忘れで Registry が空のまま動く可能性 → `marketplace/index.ts` の side-effect import 行が SSOT、CI gate (#11 #12 で別途検討) で補強予定
- **Pre-PMF コスト (ADR-0010)**:
  - 機構コード ~250 行 (types.ts 130 行 + registry.ts 100 行 + context.ts 60 行 + index.ts 30 行、本 PR で完結)
  - bundle size 影響ほぼゼロ (純 TypeScript + Map のみ、追加 npm 依存なし)
  - 学習コスト 低 (GoF Strategy + Registry は教科書パターン)
  - **Bucket A** (5 EPIC 横展開時の浪費防止に必須、EPIC #2362 で確定)

### 選択肢 B: Manifest-driven Plugin Architecture (棄却)

- 概要: Figma 型 `manifest.json` 駆動 dynamic load (第三者 plugin 配布前提)
- メリット: 究極の拡張性、サードパーティーエコシステム
- デメリット: Pre-PMF で over-engineering、第三者 plugin 配布要件なし、`marketplace` UI 自体は社内 owned で十分
- Pre-PMF: **Bucket C** (将来 plugin marketplace 解放時に再評価)

### 選択肢 C: Hexagonal Architecture 単独 (採用、Strategy 併用)

- 概要: domain core + ports + adapters の 3 層分離
- 採用方針: Strategy + Registry **と併用**。本 ADR の `ImportStrategy<T>` interface は実質的に Hexagonal の "port"、concrete strategy は "adapter"。Strategy パターンの語彙の方が実装者にとって馴染み深いため命名は Strategy で統一
- Pre-PMF: **Bucket B** (推奨、本 PR で薄く敷く)

### 選択肢 D: 現状維持 (copy-paste 継続、棄却)

- 棄却理由: 既起票 5 EPIC (#2253 / #2266 / #2294 / #2319 / #2327) が新 abstraction なしで実装 → 完成後に再リファクタ浪費発生 (EPIC #2362 の起票根拠)

## 決定

**A を採用** (Hexagonal port/adapter として C も内包)。本 PR (#2363) では interface 基盤のみを実装し、5 type の concrete strategy は #2365-2369 で順次追加する Strangler Fig 段階移行を取る。

### 本 PR のスコープ (Issue #2363)

1. **`src/lib/marketplace/types.ts`** (~130 行): `ImportContext` / `ImportPreview` / `ImportResult` / `ImportStrategy<T>` / `MarketplaceTypeDescriptor<T>` interface + `MARKETPLACE_TYPE_CODES` SSOT (5 type)
2. **`src/lib/marketplace/registry.ts`** (~110 行): `MarketplaceTypeRegistry` class with register / get / has / list / size / clear、未登録 type は明確な error で fail-fast
3. **`src/lib/marketplace/context.ts`** (~65 行): Svelte 5 Context DI ヘルパー (`setMarketplaceRegistryContext` / `getMarketplaceRegistry`、ADR-0046 同型 symbol key パターン)
4. **`src/lib/marketplace/index.ts`** (~30 行): 公開 API + 5 type の side-effect import スロット (concrete strategy 実装後に有効化)
5. **`tests/unit/marketplace/registry.test.ts`** (~200 行、15 テストケース): register / get / list / has / size / clear / discriminated union / strategy 呼出契約 / `MARKETPLACE_TYPE_CODES` SSOT
6. **`docs/design/marketplace-architecture.md`**: アーキ概念図 + Registry / Strategy / Hub の関係 SSOT
7. **本 ADR (0052)** + `docs/decisions/README.md` 表追加

### tenant isolation 強制 (ADR-0023 archive 整合)

`ImportContext.tenantId: string` を **必須プロパティ**として interface 定義に組み込み、parse / preview / apply の全メソッドで受け取らせる。Repository 層が `tenantId` を必須引数とする既存 SSOT (archive ADR-0023 deprecated by ADR-0031) と一貫し、tenant cross-contamination を型レベルで阻止する。

### challenge-set の扱い

現状 `src/lib/domain/marketplace-item.ts` の `MarketplaceItemType` は 4 値だが、本 Registry の `MarketplaceTypeCode` は **5 値** (challenge-set 含む) として定義する。`MarketplaceItemType | 'challenge-set'` の union で型橋渡しし、#2369 で concrete strategy + domain 型同期を行う。

## 結果

- 5 type 横断の import/export 振る舞いが 1 箇所の SSOT で SOLID に整列
- 新 type 追加コストが 1 ファイル増分 (Descriptor) + 1 行 (`marketplace/index.ts` の side-effect import) に減る
- copy-paste 再発を構造的に阻止 (新 type は Strategy 実装で `parse/preview/apply` 契約を強制される)
- ADR-0046 / ADR-0047 の Service Interface + Context DI パターンと同型のため、既存実装者が再学習不要
- Pre-PMF (Bucket A): EPIC #2362 の 5 EPIC 浪費防止に直結、本基盤なしに次 Issue が動かない
- 1-in-1-out (README §10 枠超過時の義務): TOP10 の actual active 数は 27 件で既に大幅超過しており、本 PR では追加のみ。1-in-1-out 履行は別 follow-up Issue (#1924 系の継続棚卸) で扱う

## 関連

- EPIC #2362 (PO 4 問題の構造的解決)
- ADR-0010 (Pre-PMF Bucket A)
- ADR-0014 / #1350 (OSS 先調査ルール)
- ADR-0046 (Service Interface + Context DI) — 本 ADR の Registry 配布パターンの参照元
- ADR-0023 archive (tenant isolation 強制) — 本 ADR の `ImportContext.tenantId` 必須性の根拠
- `docs/design/marketplace-architecture.md` (本 PR で新規追加、アーキ概念図)
