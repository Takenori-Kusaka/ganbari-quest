# ADR-0043: NativeSelect primitive を案A で採用する

> **Archived (2026-04-20)**: NativeSelect primitive 新設。PR #1258 で置換完了

- **Status**: Accepted
- **Date**: 2026-04-20
- **Issue**: #1194
- **Superseded by**: -

## Context

#1175 UI 監査で、`<select>` 直書きが 14 件（admin/checklists: 4, admin/challenges: 3, ops/export: 3 他）検出された。実際に精査したところ対象は 27 件に増加していた。

既存の `$lib/ui/primitives/Select.svelte` は Ark UI ベースの高機能カスタム Select で、以下のユースケースに不向き:

- 単純な「プラン名 / 年 / 月 / カテゴリ」等の少数選択肢での選択 UI
- ops / admin 等、情報密度重視で native UX を踏襲したい画面
- form validation が native `<select required>` で十分な単純フォーム

一方で raw `<select>` を直書きするとスタイル・ARIA 属性・error/hint 表示が画面ごとにばらつき、管理コストが嵩む。

## Decision

**案 A**: native `<select>` のラッパ `$lib/ui/primitives/NativeSelect.svelte` を追加し、既存の raw `<select>` を全て置換する。

### 採用した理由

- Ark UI Select への全件移行（案B）は挙動変更を伴い、ops / admin の情報密度が犠牲になる。
- native select を統一ラップする方が、既存 UX を温存しつつ「スタイル統一・label/error/hint 一貫化」という本来の目的を満たす。
- 既存の `FormField.svelte` と同じ外装パターン（`<div class="flex flex-col gap-1">` + label + control + error/hint）を踏襲できる。

### 非採用（案B）の理由

- Ark UI Select は単純用途には over-engineered で、bundle size も増える。
- ops / admin で native select の OS ネイティブな拡張挙動（キーボード選択・mobile picker）を失う。

## Consequences

### 正の影響

- raw `<select>` の管理が primitive 1 箇所に集約される。
- label / error / hint / disabled / required の一貫化。
- FormField と同じ props 設計で学習コスト最小。

### 負の影響・ガード

- Ark UI Select（`Select.svelte`）と NativeSelect の 2 primitive を使い分ける必要が生じる。以下の基準で使い分ける:

| 基準 | NativeSelect | Ark UI Select |
|------|--------------|---------------|
| スタイル | native OS UI（浏覧器デフォルト） | カスタム装飾（dropdown, アイコン等） |
| 選択肢数 | 3〜20 件 | 20 件以上 / 検索/グルーピング必要 |
| 画面 | ops / admin 情報密度高 | 子供向け装飾 UI / カスタマイズ必須 |

- 新規 `<select>` は常に primitive 経由。直書きは CI で検出可能（将来 eslint rule 追加検討）。

## Implementation

- `src/lib/ui/primitives/NativeSelect.svelte` — label 任意、value `string | number`、options `Array<{ value, label, disabled? }>`、placeholder/error/hint 対応
- `src/lib/ui/primitives/NativeSelect.stories.svelte` — 7 variants (Default / WithPlaceholder / WithValue / WithError / WithHint / Disabled / WithDisabledOption)
- raw `<select>` 27 件を置換（14 files）:
  - admin: checklists(4), challenges(3), achievements(1), children(1), events(1), rewards(1), members(3), settings(3)
  - ops: export(3), license/issue(2), license/[key](1)
  - features: ActivityEditForm(1), ChildProfileCard(2)
  - demo: demo/rewards(1)
