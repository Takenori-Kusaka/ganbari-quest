# 管理画面 IA（情報アーキテクチャ）再設計書

| 項目 | 内容 |
|------|------|
| Issue | #1395 (Sub B of umbrella #1393) |
| 版数 | 1.0 |
| 作成日 | 2026-04-26 |
| 作成者 | Dev セッション |
| ステータス | Committed（設計）/ 実装は #1396 |

---

## §1 設計背景

### 1.1 現状の IA

現在の管理画面ナビゲーションは `labels.ts` の `NAV_CATEGORIES` に基づき 4 カテゴリで構成されている。

| カテゴリ ID | ラベル | 含まれる items (URL) |
|------------|--------|---------------------|
| `monitor` | 記録・分析 | レポート / グロースブック / チャレンジ履歴 / アナリティクス |
| `encourage` | 応援・報酬 | ポイント / おうえん / ごほうび |
| `customize` | 活動設定 | 活動管理 / チェックリスト / イベント / チャレンジ / テンプレート |
| `settings` | アカウント | こども / 設定 / プラン / 請求管理 / メンバー |

合計 17 items（うちホームは別扱い）。

### 1.2 課題

- **「応援・報酬」と「活動設定」が並立している問題**: 保護者にとって「応援する」と「活動を管理する」は異なる頻度・文脈の操作だが、どちらが先かの序列が不明確
- **「記録・分析」に報酬系が含まれない問題**: ポイント履歴・おうえん履歴は「振り返り」文脈に属するが、現状は「応援・報酬」カテゴリに分類されており、レポートとの文脈が分断されている
- **「こども」が「アカウント」に入っている問題**: 子供の追加・設定変更は週次操作（活動設定と同文脈）だが、設定・プランと同じ「稀」文脈のカテゴリに格納されている

### 1.3 設計ゴール

- **頻度ベース分類**: 操作頻度が近い items を同じカテゴリにまとめる
- **4 → 4 tab 維持（ホーム含む）**: ボトムナビの物理的な幅制約（モバイル 375px で 4 つが限界）
- **既存 URL は維持**: `/admin/children` 等の URL パスは変更しない

---

## §2 設計原則

1. **頻度でカテゴリを決める**: 毎日 / 週次 / 稀 の 3 段階で分類する
2. **URL は変えない**: IA 変更はナビゲーション UI の変更のみ。redirect も不要
3. **labels.ts SSOT 維持**: `NAV_CATEGORIES` / `NAV_ITEM_LABELS` の変更で全 UI（デスクトップ・モバイル・デモ）が追従する設計
4. **チュートリアル・E2E への影響を最小化**: `data-tutorial` 属性・`data-testid` を参照する既存テストへの影響を事前にリストアップし、#1396 で同時修正する

---

## §3 仕様

### 3.1 提案 IA（案 P: 頻度ベース分類）

| tab | カテゴリ ID（新） | ラベル（新） | 含まれる items | 頻度 |
|-----|-----------------|------------|---------------|------|
| ホーム | (専用ページ) | ホーム | — (admin-home-tab.md 参照) | 毎日 |
| **活動** | `activity` | 活動 | 活動管理 / チェックリスト / イベント / チャレンジ / テンプレート / **こども** | 週次 |
| **記録** | `record` | 記録 | レポート / グロースブック / チャレンジ履歴 / アナリティクス / ポイント / おうえん / ごほうび | 週次 |
| **設定** | `settings` | 設定 | 設定 / プラン / 請求管理 / メンバー | 稀 |

#### 移動の根拠

| item | 現状カテゴリ | 新カテゴリ | 理由 |
|------|------------|-----------|------|
| こども | `settings`（アカウント） | `activity`（活動） | 子供追加・設定変更は活動登録と同じ週次操作文脈 |
| ポイント | `encourage`（応援・報酬） | `record`（記録） | ポイント履歴は「振り返り」文脈。レポート・グロースブックと同一 tab に置くことで一気通貫で振り返れる |
| おうえん | `encourage`（応援・報酬） | `record`（記録） | 同上。おうえん送付操作はホームのクイックアクション（Aspirational）で対応予定 |
| ごほうび | `encourage`（応援・報酬） | `record`（記録） | ごほうび設定は週次以下の頻度。ポイント・おうえんと同文脈でまとめる |

### 3.2 `labels.ts` の変更案

#### NAV_CATEGORIES（変更）

```typescript
// 変更前
export const NAV_CATEGORIES = {
  monitor: { label: '記録・分析', icon: '📊' },
  encourage: { label: '応援・報酬', icon: '💬' },
  customize: { label: '活動設定', icon: '🎮' },
  settings: { label: 'アカウント', icon: '⚙️' },
} as const;

// 変更後（#1396 実装時）
export const NAV_CATEGORIES = {
  activity: { label: '活動', icon: '🎮' },
  record: { label: '記録', icon: '📊' },
  settings: { label: '設定', icon: '⚙️' },
} as const;
```

> ホームはカテゴリではなく専用ルート（`/admin`）として扱うため、NAV_CATEGORIES には含まない。

#### NAV_ITEM_LABELS（変更なし）

`NAV_ITEM_LABELS` の各 key・値は変更しない。AdminLayout.svelte での item 配置のみ変更する。

### 3.3 AdminLayout.svelte の navCategories 変更案

```typescript
// 変更後の navCategories （#1396 実装時）
const navCategories: NavCategory[] = $derived([
  {
    id: 'activity',
    label: NAV_CATEGORIES.activity.label,
    icon: NAV_CATEGORIES.activity.icon,
    items: [
      { href: `${basePath}/activities`, label: NAV_ITEM_LABELS.activities, icon: '📋' },
      { href: `${basePath}/checklists`, label: NAV_ITEM_LABELS.checklists, icon: '✅' },
      { href: `${basePath}/events`, label: NAV_ITEM_LABELS.events, icon: '🎉' },
      { href: `${basePath}/challenges`, label: NAV_ITEM_LABELS.challenges, icon: '👥' },
      { href: '/marketplace', label: NAV_ITEM_LABELS.marketplace, icon: '🛍️' },
      { href: `${basePath}/children`, label: NAV_ITEM_LABELS.children, icon: '👧' },  // ← 移動
    ],
  },
  {
    id: 'record',
    label: NAV_CATEGORIES.record.label,
    icon: NAV_CATEGORIES.record.icon,
    items: [
      { href: `${basePath}/reports`, label: NAV_ITEM_LABELS.reports, icon: '📊' },
      { href: `${basePath}/growth-book`, label: NAV_ITEM_LABELS.growthBook, icon: '📚' },
      { href: `${basePath}/achievements`, label: NAV_ITEM_LABELS.achievements, icon: '🏅' },
      { href: `${basePath}/analytics`, label: NAV_ITEM_LABELS.analytics, icon: '📈' },
      { href: `${basePath}/points`, label: NAV_ITEM_LABELS.points, icon: '⭐' },       // ← 移動
      { href: `${basePath}/messages`, label: NAV_ITEM_LABELS.messages, icon: '💌' },   // ← 移動
      { href: `${basePath}/rewards`, label: NAV_ITEM_LABELS.rewards, icon: '🎁' },     // ← 移動
    ],
  },
  {
    id: 'settings',
    label: NAV_CATEGORIES.settings.label,
    icon: NAV_CATEGORIES.settings.icon,
    items: [
      { href: `${basePath}/settings`, label: NAV_ITEM_LABELS.settings, icon: '⚙️' },
      { href: `${basePath}/license`, label: NAV_ITEM_LABELS.license, icon: '💎' },
      { href: `${basePath}/billing`, label: NAV_ITEM_LABELS.billing, icon: '🧾' },
      { href: `${basePath}/members`, label: NAV_ITEM_LABELS.members, icon: '👥' },
      // こども は activity に移動
    ],
  },
]);
```

### 3.4 URL の維持について

**既存 URL は一切変更しない**。ナビゲーション UI の category 割り当てのみを変更する。

- `/admin/children` — 変更なし（activity カテゴリから遷移）
- `/admin/reports` — 変更なし（record カテゴリから遷移）
- `/admin/points` — 変更なし（record カテゴリから遷移）
- `/admin/settings` — 変更なし（settings カテゴリから遷移）
- 他すべての URL — 変更なし

`src/lib/server/routing/legacy-url-map.ts` への追加は**不要**（URL 変更がないため）。

### 3.5 E2E・チュートリアルへの影響範囲

以下のファイルが #1396 で同時修正が必要になる可能性がある。

| ファイル | 影響箇所 | 修正内容 |
|---------|---------|---------|
| `src/lib/ui/tutorial/tutorial-chapters.ts` | chapter 1 step `intro-1` の description | `NAV_CATEGORIES.monitor.label` 等の参照が `NAV_CATEGORIES.activity.label` 等に変わる |
| `tests/e2e/admin-nav-marketplace.spec.ts` | category ID `customize` → `activity` | `navCategories[].id === 'customize'` をチェックしているセレクタを更新 |
| `tests/e2e/tutorial-verification.spec.ts` | チュートリアル step 1 の description 文言チェック | NAV_CATEGORIES ラベル変更に追従 |

> **注**: `data-tutorial="nav-desktop"` / `data-tutorial="nav-primary"` は AdminLayout.svelte に固定されており、カテゴリ数変更の影響を受けない。

### 3.6 デモ画面（`/demo/admin`）への影響

デモ管理画面は `basePath="/demo/admin"` を渡して同一の `AdminLayout.svelte` / `AdminHome.svelte` を使用している。IA 変更は自動的にデモ画面にも反映される。追加対応は不要。

---

## §4 Open Items

以下は設計確定後の #1396 実装フェーズで判断する。

| # | 項目 | 判断ポイント |
|---|------|------------|
| OI-1 | 「記録」カテゴリの items 数（7 items）が多い | モバイルのサブメニュー UI で 7 items がスクロール不要に収まるか確認 |
| OI-2 | チュートリアル step 1 description の書き直し範囲 | 「4 つのカテゴリ」→「3 つのカテゴリ」に変わることへのチュートリアル文言更新 |
| OI-3 | ボトムナビのアイコン選定 | `🎮`（活動）/ `📊`（記録）が視認性・直感性の観点で適切か |

---

## 関連ドキュメント

- `docs/design/admin-home-tab.md` — #1394 ホームタブコンテンツ設計
- `docs/design/06-UI設計書.md` — 管理画面 UI コンポーネント仕様
- `docs/design/parallel-implementations.md` — 並行実装ペア一覧
- `src/lib/domain/labels.ts` — NAV_CATEGORIES / NAV_ITEM_LABELS（実装 SSOT）
- `src/lib/features/admin/components/AdminLayout.svelte` — ナビゲーション実装
- `src/lib/ui/tutorial/tutorial-chapters.ts` — チュートリアル step 定義
- `tests/e2e/admin-nav-marketplace.spec.ts` — ナビゲーション E2E テスト
