# 0015. 年齢帯 variant 管理アーキテクチャ（ラベル辞書とルート層の統合）

- **Status**: Proposed
- **Date**: 2026-04-21
- **Related Issue**: #1353（#1346 補完トラック）/ ADR-0009 / ADR-0014 / ADR-0010

## コンテキスト

PO 懸念（2026-04-21）: 「ラベルとページで年齢別制御が別管理 → スパゲッティ化」。現状:

| 層 | 実態 | 年齢バリアント |
|---|---|---|
| `labels.ts`（482 行） | フラット辞書 | なし |
| `child-home/variants/index.ts` | HIRAGANA/KANJI 2 variant | `child-home` feature 限定 |
| 他 feature（tutorial / tips / dialog） | 独自分岐の可能性 | 未棚卸 |
| ルート | `(child)/[uiMode=uiMode]/` で年齢別ページ | あり（ページ単位） |

チュートリアル・tips は世代別言い回しが大きく変わる（baby=「がんばったね！」/ senior=「目標達成です」）ため、動的変換（漢字→ひらがな）では対応不可。ラベル層とルート層が別 context で独立進化しており、tier 追加時に全コンポーネント touch が必要になる構造的リスクが顕在化している。

## 検討した選択肢（OSS 最低 2 件比較 — #1350 / ADR-0014 と整合）

### 選択肢 A: Fluent（Mozilla OSS）asymmetric localization

- 概要: Project Fluent の `select expression` で 1 key = 全 tier variant を 1 ファイル化。`@inlang/paraglide-js` が Fluent format を入力可能（ADR-0014 の Paraglide 採用と整合）
- メリット: (1) tier 分岐が **DSL native**、if 分岐散在を構造的に防ぐ、(2) TypeScript 型安全（未定義 tier をビルド失敗化）、(3) 将来の多言語化と同一機構、(4) ADR-0014（Paraglide 推奨）と整合し **追加 OSS ゼロ**
- デメリット: Fluent DSL の学習コスト、既存 `labels.ts` 482 行の一括移行が重い
- Pre-PMF コスト（ADR-0010）: 導入工数 **高**（全 key 移行）、学習コスト 中、bundle 増分 軽微（tree-shake）、長期保守性 **最高**

### 選択肢 B: i18next-context 方式（OSS）

- 概要: i18next の `_context` 接尾辞で variant を表現。`encourage.complete_baby` / `encourage.complete_preschool` 等
- メリット: 採用実績多数、学習コスト低、既存 flat 辞書と親和性高い
- デメリット: (1) key 爆発（tier × 機能数）、(2) fallback chain を手書き（baby → preschool → elementary → `_default`）、(3) ADR-0014 で Paraglide 採用時は 2 ライブラリ並立
- Pre-PMF コスト: 導入工数 中、学習コスト 低、bundle 増分 中、長期保守性 中

### 選択肢 C: 独自 `getLabel(key, ctx)` + hierarchical fallback（Pre-PMF 現実解）

- 概要: `labels.ts` に既存 flat key + nested tier dict を並立。`getLabel('encourage.complete', { ageTier })` で 1. tier 付き key 探索 → 2. hierarchical fallback（baby → preschool → elementary → `_default`）→ 3. raw key 返却
- メリット: (1) 1 週間 PoC 可能、(2) 既存 482 行を破壊的変更せず共存、(3) 後日 Fluent 移行容易（DSL subset と互換）
- デメリット: 独自 DSL で型安全性は TypeScript const narrowing 頼み。ADR-0014 承認後は Paraglide + Fluent 経路と並立の技術負債
- Pre-PMF コスト: 導入工数 **低**、学習コスト ゼロ、bundle 増分 ゼロ、長期保守性 中（Fluent 移行前提なら許容）

## 決定

**Phase 1 PoC は選択肢 C（独自 getLabel + hierarchical fallback）**。理由:

1. ADR-0014（Paraglide 採用 ADR）が **PO 承認待ち** の間に機構着手できる
2. 1 週間 PoC で Track 1 仮説（ラベル層とルート層の context 統合）を実証
3. Fluent DSL は選択肢 C の nested dict と互換 subset → ADR-0014 が承認されたら Phase 3 で選択肢 A へ移行（互換性あり、移行コスト限定）

**将来移行先は選択肢 A（Fluent via Paraglide）**。選択肢 B（i18next）は ADR-0014 で svelte-i18n が選ばれた場合の代替として保持。

### 統合設計（スパゲッティ防止の核）

`src/routes/(child)/[uiMode=uiMode]/+layout.server.ts` で `{ ageTier: params.uiMode }` を context 注入し、全ページ・コンポーネントが同一 context object で参照する。これにより **ラベル辞書とルート層の年齢別制御が同じ ctx.ageTier を共有** し、構造的に一致が保証される。

```ts
// labels.ts (SSOT 維持)
export const LABELS = {
  'encourage.complete': {
    baby: 'がんばったね！', preschool: 'やったね！', _default: 'よくできました',
  },
  'encourage.complete_senior': '目標達成です',
};
export function getLabel(key: string, ctx: { ageTier: UiMode }) { /* 1→2→3 */ }

// +layout.server.ts
export const load = ({ params }) => ({ ctx: { ageTier: params.uiMode } });
```

### 避けるべきアンチパターン（Phase 2 CI gate 候補）

| # | アンチパターン | 検出案 |
|---|-------------|-------|
| A1 | `if (uiMode === 'baby')` 各コンポーネント散在 | biome custom rule + grep |
| A2 | God-object registry（3 層以上の平坦 key） | key 深さ lint |
| A3 | 動的変換ロジック漏出（runtime 漢字→ひらがな） | grep + CLAUDE.md 明記 |
| A4 | tier 追加で全ファイル touch 必要 | fallback chain で構造防止 |
| A5 | routes 直接分岐（`{#if uiMode === 'baby'}` feature 跨ぎ） | Presenter 層（+page.ts load）に寄せる |
| A6 | SSOT 二重管理（labels.ts と独自辞書の並立） | parallel-implementations.md 更新 |
| A7 | Feature Flag を segment 代替に使う（LaunchDarkly 等） | ADR-0010 過剰防衛 NG |

## 結果

- ラベル層とルート層の年齢別制御が同じ `ctx.ageTier` で一致、スパゲッティ化を構造的防止
- ADR-0014 の OSS 選定基準に「年齢帯 variant サポート（Fluent 互換）」が追加される
- Phase 1 PoC で Fluent 移行の互換性を実証してから本番適用（ADR-0010 Pre-PMF 現実解）

### トレードオフ

- 選択肢 C は暫定的な独自実装 → ADR-0014 承認後は Phase 3 で選択肢 A へ移行コスト発生（移行互換性は担保するが工数は確定）
- 全 feature（tutorial / tips / dialog 等）の棚卸は follow-up Issue

## 関連

- ADR-0009（labels.ts SSOT 原則）— 本 ADR で tier 次元を追加
- ADR-0014（labels / i18n 機構選定）— 本 ADR は OSS 選定基準に variant サポートを fed
- ADR-0010（Pre-PMF scope）— Feature Flag（LaunchDarkly 等）不採用の根拠
- #1353（本 Issue）/ #1346（機構完成 Umbrella）
