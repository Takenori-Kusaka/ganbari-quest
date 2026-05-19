# 管理画面 IA（情報アーキテクチャ）設計書

| 項目 | 内容 |
|------|------|
| 版数 | **v2.1 (#2274 / EPIC #2266, 2026-05-19)** — rewards/cheer を record→activity 配下に移動 + /admin/messages 廃止 |
| 旧版 | v2.0 (#2177 / EPIC #2176, 2026-05-18 — 5 tab subject-first 構成、本 v2.1 で部分 supersede) / v1.0 (#1395, 2026-04-26 — 頻度ベース分類) |
| 作成者 | Dev セッション |
| ステータス | Committed（設計）/ 実装は #2178 (5 tab 構成) + #2270 (messages 廃止) + #2274 (rewards/cheer 移動) |
| 関連 ADR | ADR-0009 (旧) / ADR-0014 (OSS 先調査整合) / ADR-0012 (Anti-engagement) |

---

## §1 設計背景

### 1.1 v2.0 改訂の動機 (#2176 EPIC)

v1.0 (頻度ベース分類) では「こども」が「活動」配下、「メンバー」が「設定」配下にあった。これは v1.0 §3.1 の頻度ベース分類 (週次操作の「こども」を「活動」へ、稀操作の「メンバー」を「設定」へ) として整合していたが、PO 報告 (2026-05-17) で以下の構造的違和感が露出した:

- 「こども」が「活動 (gamification の機能設定)」配下にあるのは subject (誰の) より function (何を) を上位化していて違和感がある
- PO の優先度判断: 「アプリ機能 (活動) vs ユーザ情報 (こども)」では後者を上位化すべき
- 将来「家族グループ招待 / テナント名設定 / 家族プロフィール」が PO の頭の中にあるが、上位カテゴリが不在で配置先が決まらない

### 1.2 v1.0 → v2.0 の主要変更点

| 項目 | v1.0 (頻度ベース) | v2.0 (subject-first) |
|---|---|---|
| カテゴリ数 | 3 (活動 / 記録 / 設定) + ホーム = 4 tab | **4 (家族 / 活動 / 記録 / 設定) + ホーム = 5 tab** |
| こども | 活動配下 (週次操作と同文脈) | **家族配下** (家族グループの構成要素) |
| メンバー | 設定配下 (稀操作) | **家族配下** (家族グループの構成要素) |
| 分類軸 | 頻度 (毎日 / 週次 / 稀) | **subject-first (誰の / 何を / 何の記録 / 何の設定)** |

### 1.3 業界 prior art 採用根拠 (Phase Admin-Nav-Restructure research)

- **Family Link 流 subject-first** (Google): 「家族」を独立カテゴリ化し、その配下に「メンバー」「設定」を配置
- **iOS HIG**: tab bar 5 タブ上限、78pt/tab で iPhone 12 (390pt) ジャスト収容
- **Material Design 3**: bottom navigation 3-5 destinations 仕様化、48×48dp target
- **5 tab 採用 SaaS 実機確認 (Phase C2)**: App Store / Instagram (2025) / X / LinkedIn / Roblox / Linear

### 1.4 この設計がなかった場合に何が困るか

- 「こども」を探すユーザが「活動」配下を予期せず混乱する (PO 違和感の根本)
- 将来「家族グループ招待」等を配置するカテゴリが決まらない (上位カテゴリ不在)
- subject-first の業界水準から逸脱したまま親管理画面が固定化する

---

## §2 設計原則

1. **subject-first 上位化**: 「誰の」(家族) > 「何を」(活動) > 「何の記録」(記録) > 「何の設定」(設定) の順で配置
2. **5 tab 上限** (iOS HIG 整合): ホーム + 4 カテゴリ = 5 tab 構成。6 tab 以上に拡張しない
3. **既存 URL は維持**: ナビ UI の再配置のみ、`/admin/children` 等は不変
4. **labels.ts SSOT 維持**: `NAV_CATEGORIES` / `NAV_ITEM_LABELS` 改訂で全 UI (デスクトップ / モバイル / ボトムナビ / デモ) が追従
5. **チュートリアル / E2E は同 PR 内で追従**: data-tutorial / data-testid を参照する既存テスト群を #2178 で同時更新

---

## §3 仕様

### 3.1 提案 IA (v2.0 = 案 P': subject-first 上位化)

| tab | カテゴリ ID | ラベル | icon | 含まれる items | 設計意図 |
|-----|-----------|------|------|---------------|---------|
| ホーム | (専用ページ) | ホーム | 🏠 | — (`admin-home-tab.md` 参照) | 毎日 |
| **家族** (新規) | `family` | 家族 | 👨‍👩‍👧 | こども / メンバー | 家族グループの構成要素を subject-first 上位化 |
| 活動 | `activity` | 活動 | 🎮 | 活動管理 / チェックリスト / イベント / チャレンジ / **テンプレート (現状維持)** | アプリの機能設定 (Notion 流業界整合) |
| 記録 | `record` | 記録 | 📊 | レポート / グロースブック / アナリティクス / ポイント / おうえん / ごほうび | 振り返り文脈 |
| 設定 | `settings` | 設定 | ⚙️ | 設定 / プラン / 請求管理 | アカウント設定 (メンバー外し) |

#### 移動の根拠

| item | v1.0 カテゴリ | v2.0 カテゴリ | 理由 |
|------|------------|-----------|------|
| こども | `activity` | **`family`** | 家族グループの構成要素 (subject-first)。活動配下では PO 違和感 |
| メンバー | `settings` | **`family`** | 同上。設定配下では subject 関係性が見えない |

### 3.2 labels.ts の改訂 (#2177 で実装済)

```typescript
// 改訂前 (v1.0)
export const NAV_CATEGORIES = {
  activity: { label: '活動', icon: '🎮' },
  record: { label: '記録', icon: '📊' },
  settings: { label: '設定', icon: '⚙️' },
} as const;

// 改訂後 (v2.0)
export const NAV_CATEGORIES = {
  family: { label: '家族', icon: '👨‍👩‍👧' },  // ← 新規
  activity: { label: '活動', icon: '🎮' },
  record: { label: '記録', icon: '📊' },
  settings: { label: '設定', icon: '⚙️' },
} as const;
```

`NAV_ITEM_LABELS` の各 key・値は変更しない。AdminLayout.svelte での item 配置のみ #2178 で変更する。

### 3.3 AdminLayout.svelte の navCategories 変更案 (#2178 で実装)

```typescript
const navCategories: NavCategory[] = $derived([
  {
    id: 'family',
    label: NAV_CATEGORIES.family.label,
    icon: NAV_CATEGORIES.family.icon,
    items: [
      { href: `${basePath}/children`, label: NAV_ITEM_LABELS.children, icon: '👧' },
      { href: `${basePath}/members`, label: NAV_ITEM_LABELS.members, icon: '👥' },
    ],
  },
  {
    id: 'activity',
    label: NAV_CATEGORIES.activity.label,
    icon: NAV_CATEGORIES.activity.icon,
    items: [
      { href: `${basePath}/activities`, label: NAV_ITEM_LABELS.activities, icon: '📋' },
      { href: `${basePath}/checklists`, label: NAV_ITEM_LABELS.checklists, icon: '✅' },
      { href: `${basePath}/events`, label: NAV_ITEM_LABELS.events, icon: '🎉' },
      { href: `${basePath}/challenges`, label: NAV_ITEM_LABELS.challenges, icon: '👥' },
      // #2274 (EPIC #2266): ごほうび/応援を record→activity 配下に移動
      { href: `${basePath}/rewards`, label: NAV_ITEM_LABELS.rewards, icon: '🎁' },
      { href: `${basePath}/cheer`, label: NAV_ITEM_LABELS.cheer, icon: '🎉' },
      { href: '/marketplace', label: NAV_ITEM_LABELS.marketplace, icon: '🛍️' },
      // こども は family に移動
    ],
  },
  {
    id: 'record',
    label: NAV_CATEGORIES.record.label,
    icon: NAV_CATEGORIES.record.icon,
    items: [
      { href: `${basePath}/reports`, label: NAV_ITEM_LABELS.reports, icon: '📊' },
      { href: `${basePath}/growth-book`, label: NAV_ITEM_LABELS.growthBook, icon: '📚' },
      { href: `${basePath}/analytics`, label: NAV_ITEM_LABELS.analytics, icon: '📈' },
      { href: `${basePath}/points`, label: NAV_ITEM_LABELS.points, icon: '⭐' },
      // #2270 / #2274 (EPIC #2266): messages 廃止 + rewards/cheer を activity 配下に移動
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
      // メンバー は family に移動
    ],
  },
]);
```

### 3.4 URL の維持について

**既存 URL は一切変更しない**。

- `/admin/children` — 変更なし (family カテゴリから遷移)
- `/admin/members` — 変更なし (family カテゴリから遷移)
- `/admin/reports` / `/admin/points` / `/admin/settings` 等 — 変更なし

`src/lib/server/routing/legacy-url-map.ts` への追加は **不要** (URL 変更がないため)。

### 3.5 E2E・チュートリアルへの影響範囲

#2178 で同時修正:

| ファイル | 影響箇所 | 修正内容 |
|---------|---------|---------|
| `tests/e2e/admin-nav-marketplace.spec.ts` | `getByRole('button', { name: /^活動$/ })` で「こども」へ到達不可能になる | 影響なし: marketplace は activity 配下のまま。本テストは影響なし |
| `tests/e2e/admin-nav-responsive.spec.ts` (新設) | 5 tab × 3 breakpoint 検証 | 新規追加 |
| `src/lib/ui/tutorial/tutorial-chapters.ts` | カテゴリ数言及 (もしあれば) | 5 tab に追従更新 |

### 3.6 デモ画面 (`/demo/admin`) への影響

デモ管理画面は `basePath="/demo/admin"` を渡して同一の `AdminLayout.svelte` を使用しているため、IA 変更は自動反映される。追加対応は不要。

---

## §4 関連ドキュメント

- [docs/design/family-group-management.md](family-group-management.md) — 家族グループ管理 SSOT (本 EPIC で新設、committed / aspirational 分離)
- [docs/rationale/10-admin-nav-restructure-rationale.md](../rationale/10-admin-nav-restructure-rationale.md) — 5 tab + family カテゴリ採用経緯 (Phase Admin-Nav-Restructure research 統合)
- [docs/design/admin-home-tab.md](admin-home-tab.md) — ホームタブコンテンツ設計
- [docs/design/06-UI設計書.md](06-UI設計書.md) — 管理画面 UI コンポーネント仕様
- [docs/design/parallel-implementations.md](parallel-implementations.md) — 並行実装ペア一覧
- [src/lib/domain/labels.ts](../../src/lib/domain/labels.ts) — NAV_CATEGORIES / NAV_ITEM_LABELS (実装 SSOT)
- [src/lib/features/admin/components/AdminLayout.svelte](../../src/lib/features/admin/components/AdminLayout.svelte) — ナビゲーション実装
- [tests/e2e/admin-nav-responsive.spec.ts](../../tests/e2e/admin-nav-responsive.spec.ts) — 5 tab レスポンシブ E2E (#2178 で新設)

---

## §5 v1.0 (頻度ベース分類) の保全

> **archived (2026-05-18, #2177 で supersede)**: v1.0 (頻度ベース分類) の文言は本ファイル git 履歴で保全。直前 commit を確認すれば v1.0 文書を取得可能。新規 PR は v2.0 (subject-first 上位化) を参照すること。

### v1.0 → v2.0 supersede 経緯サマリ

- v1.0 (2026-04-26 / #1395): 4 カテゴリ → 3 カテゴリに整理、こども = 活動配下 (週次操作と同文脈)
- v2.0 (2026-05-18 / #2177): 4 カテゴリに再拡張 (家族新設)、こども + メンバー = 家族配下 (subject-first 上位化)

棄却された v1.0 配置は `docs/rationale/10-admin-nav-restructure-rationale.md` §「棄却した代替案」も併せて参照。
