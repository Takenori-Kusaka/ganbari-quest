# 0046. Svelte 5 Service Interface + Context DI による本番/デモ UI 統合 (POC)

| 項目 | 内容 |
|------|------|
| ステータス | accepted (POC: child home 1 ページ + write API 拡張) |
| 日付 | 2026-05-14 (#2069) / 2026-05-14 #2085 で write API 追加 |
| 起票者 | Dev Agent (Issue #2069 / #2085) |
| 関連 Issue | #2069 / #2085 |

## コンテキスト

LP 撮影用デモ画面 (`/demo/`) と本番アプリ画面 (`/(child)/`) は UI が二重実装され、本番改善がデモに反映されない同期漏れが慢性化していた (`parallel-implementations.md` §3)。
本番 `+page.server.ts` は Cognito 認証 + Drizzle ORM が必須でデモ用に分岐コードを混入させることはできない (品質ポリシー: `if (isDemo)` 散在禁止)。
有識者調査資料 (`tmp/ref/SvelteKit 本番UIコンポーネントと未認証インタラクティブデモの統合アーキテクチャ.md`) で **Service Interface + Svelte 5 `createContext` DI** が最適解と判明。
ただし、本番 child home `+page.svelte` は 1094 行と巨大で、一気に統合すると UI 等価性証明 + diff レビュー難度が POC として過剰になる。

## 検討した選択肢

### 選択肢 A: Service Interface + Svelte 5 Context DI (採用)

- 概要: `$lib/services/types.ts` に `ChildDashboardService` interface 定義、本番 (`ProductionDashboardService`) / デモ (`DemoDashboardService`) が共通実装。`+layout.svelte` で `setContext` 注入、配下が `getContext` で取得。
- メリット: SSR/CSR 整合 / 既存サーバ load を破壊しない / 段階移行可能 / 型安全
- デメリット: Context 取得忘れで実行時エラー (本 PR では throw で fail-fast 化)
- Pre-PMF コスト: 機構コード ~250 行、bundle size 影響ほぼゼロ (純 TypeScript + Svelte 標準 API のみ、追加 npm 依存なし)

### 選択肢 B: `if (isDemo)` 条件分岐

- 概要: 本番 `+page.server.ts` / `+page.svelte` 内で `event.locals.isDemo` を見て分岐
- デメリット: ADR-0010 Pre-PMF 違反 (本番に不要な分岐を恒久的に残す)、Issue #2069 の品質ポリシーで明示禁止

### 選択肢 C: 別 SSR routes を維持して `$lib/views/` だけ共通化

- 概要: `+page.svelte` を `<DashboardView />` の薄いラッパに分離、データソースは page server に閉じ込め
- デメリット: 状態管理 (`$state` インメモリ) を共通 view に注入する DI 機構が無いと、demo インタラクション (sessionStorage) と本番 form action の差を view が直接知る必要があり、本質的な疎結合にならない

## 決定

**A を採用** (本資料 §10 と一致)。Service Interface + Context DI を SSOT パターンとし、Issue #2069 では **child home 1 ページ POC** として:

1. `$lib/services/types.ts` / `context.ts` / `production/DashboardService.ts` / `demo/DashboardService.ts` の機構を整備
2. demo `home/+page.svelte` を `DashboardView` 経由に refactor (UI 等価性は SS で証明)
3. 本番 `(child)/+layout.svelte` には Context 注入のみ追加し、既存 `+page.svelte` (1094 行) は触らない (POC 範囲外)
4. 残ページ (本番 child home 全機能、admin、demo admin 等) は follow-up Issue で段階適用

## 結果

- 並行実装ペア (本番 vs demo child home) のうち demo 側が共通 `DashboardView` を使うようになり、機構レベルの SSOT が確立
- `ChildDashboardService` interface に write API (`recordActivity` / `cancelRecord` / `claimLoginBonus` / `toggleActivityPin`) を **Issue #2085 で追加済**。本番側は既存 REST `/api/v1/...` を fetch で呼ぶ thin wrapper、demo 側は sessionStorage 経由で in-memory state を書き戻す。両実装の動作差は discriminated union (`{ok, error}`) で型レベルに整列
- POC scope のため本番 UI は完全に保持され (1094 行 +page.svelte 未変更)、リグレッション リスクが最小化される
- Pre-PMF (ADR-0010) Bucket A: 二重実装 SSOT 化はメンテ負債削減で適格
- POC が確立した DI パターンで Pre-PMF 中の各 follow-up Issue (admin / その他 child pages) を起票済 (#2069 follow-ups)
- Issue #2085 で interface + 実装 + テスト (33 件 PASS) は完備、`DashboardView` の form action 切替 (write API への UI 配線) は #2084 / 別 follow-up で扱う段階導入

## 関連

- `parallel-implementations.md` §3 (本番 vs demo)
- ADR-0010 Pre-PMF scope (Bucket A: 二重実装 SSOT 化は適格)
- ADR-0045 terms.ts SSOT 2 階層化 (同じ「atom / compound 責務分離」の発想を services 層にも適用)
- 1-in-1-out: 本 PR で active ADR を 21 → 22 に増やす。既存 33 件超過の整理は #1924 系で別途扱う (本 PR の scope ではない)
