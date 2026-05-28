# archived リソース表示 + One-click reactivation UI 設計 (Phase 3 #2575)

| 項目 | 内容 |
|------|------|
| 孫 issue | #2575 (Phase 3 子、archived リソース親画面 read-only 表示 + One-click reactivation banner + 子供画面 invisible) |
| 親 | #2528 (Phase 3 UI) / Epic #2525 |
| Phase 1 整合 | [phase1-plan-change-requirements.md](phase1-plan-change-requirements.md) (#2535) FR-5 (`DowngradeResourceSelector` 既存維持) |
| Phase 2 整合 | [phase2-plan-change-journey.md](phase2-plan-change-journey.md) (#2549) ジャーニー B-7 (再アップで瞬時復元 = 最終山) / Pattern A (Notion 型) 採用根拠 / 文言 atom 拡張 (`PLAN_CHANGE_TERMS.protected` / `.resumeReady`) |
| Phase 3 兄弟 | [phase3-admin-header-ui-design.md](phase3-admin-header-ui-design.md) (#2568 plan-badge) / [phase3-subscription-page-ui-design.md](phase3-subscription-page-ui-design.md) (#2567 `/admin/subscription` 純化) / [phase3-activity-limit-banner-ui-design.md](phase3-activity-limit-banner-ui-design.md) (#2569 ActivityLimitBanner) |
| Phase 7 rename 方針 | `/admin/license` → `/admin/subscription` / `family` → `プレミアム` (atom 1 行) / 月額のみ (年額廃止)。本 docs 内では Phase 7 rename 後の名称を前提に記述、既存実装 reference (`SaasLicensePanel.svelte` 等) は現名維持 |
| 採用案 | Notion 型 Pattern A (Phase 2 #2549 既確定) + Calendly 型 「toggle-back restore」(One-click) を融合。read-only listing + 常時表示 reactivation banner |
| `premium` 階層 signal 打消 | reactivation banner は **「データは保護されています」**を主訴求とし、「上位プランで restore」を副訴求にとどめる (上位プラン誘導を一次目的化しない)。LP コピー (`FREE_PLAN_TERMS.forever` 等) と連動して「無料が排除されている印象を与えない」設計を貫徹 (refs #2594 D-2) |

## 設計背景 (なぜこの設計が必要か)

### 現状実装の構造的欠落

| # | 既存実装 (file:line) | 機能 | 欠落点 |
|---|---|---|---|
| 1 | `downgrade-service.ts:31-117` (`getDowngradePreview`) | ダウン前 preview | ✅ 完備 |
| 2 | `downgrade-service.ts:133-202` (`archiveForDowngrade`) | ダウン時 archive | ✅ 完備 (`archived_reason='downgrade_user_selected'`) |
| 3 | `resource-archive-service.ts:96-105` (`restoreArchivedResources`) | trial / downgrade 両 archive を一括復元 | ✅ 完備 |
| 4 | `resource-archive-service.ts:110-120` (`getArchivedResourceSummary`) | archived **子供**件数のみ概要返却 | △ **activity / checklist 集計未対応** |
| 5 | `routes/api/v1/admin/downgrade-restore/+server.ts` | POST `/api/v1/admin/downgrade-restore` | ✅ 完備 |
| 6 | `(parent)/admin/+layout.server.ts:147-151` | `archivedSummary` を全 admin 画面に配布 | △ **`planTier==='free' && isTrialExpired` 条件下のみ**配布 (downgrade 経路で archived 残存中は対象外) |
| 7 | `(parent)/admin/+layout.svelte:60-68` (`TrialBanner`) | trial 期限切れ時 archived 1 行訴求 | △ **downgrade 経路 archived の表示動線なし** |
| 8 | `DowngradeResourceSelector.svelte:295` (`restoreNote`) | 「アーカイブ済はアップグレード時に復元できます」明示 | ✅ ダウン時のみ。降格後の常時表示動線なし |

**構造的欠落の本質**: archived リソースは 2 経路 (`trial_expired` / `downgrade_user_selected`) で発生するが、**降格 (downgrade_user_selected) 経路の親画面表示・reactivation 動線が空白**。trial 経路は `TrialBanner` に 1 行 (`bannerDescExpiredWithArchive`) で吸収済みだが、降格経路は再アップグレード時に `restoreArchivedResources` が呼ばれる以外、ユーザーが「自分の家族には archived データが眠っている」事実を知る手段がない。

### なぜ「常時 reactivation banner + read-only listing」が必要か (Anti-engagement 整合)

| 観点 | 必要性 |
|---|---|
| データ持続性原則 (Phase 2 #2549 Pattern A) | ユーザーの「失う恐怖」をゼロ化するには、「保護されている」事実を可視化する必要がある。データはあるのに UI 不可視 = 体感上「データ消失」と等価 |
| Win-Back 業界基準 (66% within 90 days、deep-research) | 降格直後〜90 日が再アップグレードの黄金期。この期間にユーザーが archived の存在を再認識する動線がないと win-back 機会を失う |
| ADR-0012 (Anti-engagement) | 親画面のみ表示 + 子供画面 invisible で「子供 UI に課金圧をかけない」を構造的に担保。banner は静的・1 行・煽らない (Notion 型 yellow banner と同型) |
| ADR-0049 (履歴保持期間ポリシー) | archived は物理削除されず保持される。「保護されている」事実は実装の事実 (ADR-0013 LP truth) であり、これを UI で表現することは煽りでなく真実伝達 |
| ADR-0045 (terms.ts 2 階層) | 「失う / 消える」を避け「保護 / 復活できる」atom を SSOT 化することで、全文言の品質を atom 1 行で担保 |

### deep-research による業界ベンチマーク照合 (2026-05-28)

| ベンチマーク観点 | 採用 SaaS | 自プロダクト採用 |
|---|---|---|
| **Notion** plan downgrade | view-only (read-only) 化、一部機能のみ「最初の 1 件のみ keep」 | ✅ read-only listing 採用 |
| **Notion** archive banner | yellow banner 「archived by X on Y, click Unarchive」 | ✅ 同型 (banner + 復活 CTA) |
| **Calendly** event types deactivate | On/Off toggle、三点メニューから one-click 復活 | △ 子供・活動の個別 toggle は将来検討 (本 PR scope 外)。本 PR では tenant 全体一括 reactivation を採用 (`restoreArchivedResources` 既存 API) |
| **Win-Back rate** (Totango) | 業界 15-30% / 90 日以内 66% / 30 日以内 45% | 90 日以内 banner 常時表示 + 30 日強調 (Phase 4 動線で email 化検討) |
| **Banner 原則** | subtle / non-disruptive / horizontal、即座アクション不要 | ✅ 1 行 + 1 CTA の固定 banner (modal / countdown 不採用) |

## 設計方針

### 機能配置 (Phase 7 rename 後の最終形)

```
親画面 (/admin/*)
├ [既存] +layout.svelte (AdminLayout + TrialBanner)
│  └ archived banner 配置 = TrialBanner と同階層 (本文上部、sticky でなく flow)
├ [新規] ArchivedResourceBanner.svelte (本 PR で設計、Phase 7 実装)
│  ├ archived 件数 X 件 + 「保護されています」
│  └ CTA 1: 「プレミアムにする」(reactivation = 上位プラン化で一括復元)
│  └ CTA 2: 「一覧を見る」→ /admin/subscription#archived (read-only listing)
└ [新規] /admin/subscription#archived セクション (read-only listing、SaasSubscriptionPanel 配下)
    └ archived 子供 / 活動 / チェックリストの 3 sub-list (件数 + 名称、グレーアウト)

子供画面 ((child)/[uiMode]/*)
└ 構造的 invisible: archived = repository layer filter (is_archived=1 を除外)、UI 層で追加防御不要
```

### state 別の banner 表示パターン (4 variant)

本 UI 設計は server から `data.archivedSummary` (拡張版) を受けて分岐。`+layout.server.ts` 既存 SSOT に `archived_reason` 別件数集計を追加 (Phase 7)。

| variant | 条件 | banner 表示 |
|---|---|---|
| **none** | archived 件数 0 | banner 非表示 |
| **trial-archived** | `archived_reason='trial_expired'` のみ | 既存 TrialBanner `bannerDescExpiredWithArchive` 1 行 (本 PR で文言を `PLAN_CHANGE_TERMS` atom 経由に変更) |
| **downgrade-archived** | `archived_reason='downgrade_user_selected'` あり | **新規 ArchivedResourceBanner** 表示 (1 行 + CTA × 2) |
| **mixed** | 両 reason 混在 | 新規 ArchivedResourceBanner 表示 (合算件数、文言は downgrade 優先) |

### 4 軸採用案 (Phase 2 #2549 採用案 Pattern A の具体化)

| 軸 | 採用 | 不採用 | 根拠 |
|---|---|---|---|
| **表示方式** | read-only listing + banner 1 行 | Edit-lock (Figma 型) / Watermark (Canva 型) | Figma 「team locked、何もできない」苦情多発 / 子供 UI 不適 (Anti-engagement) |
| **reactivation 単位** | tenant 全体一括 (`restoreArchivedResources`) | 個別 item 単位 toggle (Calendly 型) | 個別 toggle は plan limit 超過時のエラーハンドル複雑化。Pre-PMF 段階では一括復元で十分 (Open question #1) |
| **CTA 配置** | banner 内 2 CTA (上位プラン化 / 一覧へ) | modal interrupt / popup | ADR-0012 静的・自発探索原則 |
| **文言フレーミング** | 「保護されています / いつでも復活できます」 | 「失う / 消える / 使えなくなる」 | Phase 2 #2549 atom 候補 (`PLAN_CHANGE_TERMS.protected` / `.resumeReady`) |

## UI 画面構成 (mermaid)

### 図 1: archived banner の variant 分岐

```mermaid
flowchart TB
    Server[+layout.server.ts<br/>archivedSummary 拡張: reason 別件数]
    Server --> Layout[(parent)/admin/+layout.svelte]
    Layout --> Decide{archived 件数 + reason}
    Decide -->|0 件| None[banner 非表示]
    Decide -->|trial のみ| Trial[既存 TrialBanner 1 行]
    Decide -->|downgrade あり| New[ArchivedResourceBanner 新規]
    Decide -->|mixed| New
    New --> CTA1[CTA 1: プレミアムにする<br/>→ /admin/subscription]
    New --> CTA2[CTA 2: 一覧を見る<br/>→ /admin/subscription#archived]
    style New fill:#e3f2fd
    style CTA1 fill:#fff3e0
    style CTA2 fill:#d4edda
```

### 図 2: archived 表示と reactivation 経路 (Pattern A + Calendly toggle-back)

```mermaid
flowchart LR
    Down[ダウン or trial 終了] --> Archive[archived_reason 付与]
    Archive --> Server[+layout.server.ts<br/>archivedSummary 計算]
    Server --> Banner[ArchivedResourceBanner<br/>親画面 1 行訴求]
    Server --> Listing[/admin/subscription#archived<br/>read-only 3 sub-list]
    Banner -.CTA1.-> Upgrade[/admin/subscription<br/>プラン選択]
    Listing -.CTA.-> Upgrade
    Upgrade --> Restore[restoreArchivedResources<br/>tenant 全体一括復元]
    Restore --> Visible[即時親画面 + 子画面に復元]
    style Listing fill:#fff3cd
    style Restore fill:#d4edda
```

### 図 3: 子供画面 invisible の構造的担保

```mermaid
flowchart LR
    Root[+layout.svelte] --> Parent[(parent)/admin/+layout.svelte]
    Root --> Child[(child)/[uiMode]/+layout.svelte]
    Parent --> Banner[ArchivedResourceBanner 表示]
    Parent --> Listing[#archived sub-list 表示]
    Child --> ChildShell[ChildShell or 各 mode layout]
    ChildShell -.- NoBanner[ArchivedResourceBanner import なし]
    ChildShell -.- RepoFilter[repository layer filter<br/>is_archived=1 を除外]
    NoBanner --> Guard[banner 発生不能]
    RepoFilter --> Guard2[archived item 発生不能]
    style Parent fill:#e3f2fd
    style Child fill:#ffebee
    style Guard fill:#d4edda
    style Guard2 fill:#d4edda
```

## UI 設計詳細 (4 variant + listing)

### A. none variant (archived 件数 0)

banner 非表示。既存 TrialBanner も `hasArchivedResources=false` で archived 文言を出さない (既存挙動維持)。

### B. trial-archived variant (既存 TrialBanner 流用 + atom 化)

既存 `TrialBanner.svelte:85-89` の `bannerDescExpiredWithArchive` 文言を `PLAN_CHANGE_TERMS` atom 経由に変更。

```
┌─────────────────────────────────────────────────────────┐
│ 📦  プレミアム無料体験が終了しました                     │
│     一部のデータは保護されています。                     │
│     プレミアムにすることで、いつでも復活できます。       │
│                                       [プレミアムにする]│
└─────────────────────────────────────────────────────────┘
```

文言 atom (Phase 7 実装時):
```ts
TRIAL_LABELS.bannerDescExpiredWithArchive =
  `一部のデータは${PLAN_CHANGE_TERMS.protected}。${PLAN_FULL_TERMS.premium}にすることで、${PLAN_CHANGE_TERMS.resumeReady}。`
```

### C. downgrade-archived variant (新規 ArchivedResourceBanner)

```
┌─────────────────────────────────────────────────────────┐
│ 📦  X 件のデータは保護されています                       │
│     お子さま 1人 / 活動 5個 / チェックリスト 2個         │
│     プレミアムにすることでいつでも復活できます。         │
│                       [プレミアムにする] [一覧を見る]   │
└─────────────────────────────────────────────────────────┘
```

- **配置**: `(parent)/admin/+layout.svelte` 内、TrialBanner と同階層 (本文上部、flow)
- **色**: surface = `var(--color-feedback-info-bg)` / border = `var(--color-border-default)` (情報帯、警告色を使わない)
- **icon**: `📦` (既存 TrialBanner と同型、archived 箱を象徴)
- **タップ**: banner 全体ではなく CTA 2 ボタンに限定 (誤タップ防止、Anti-engagement)
- **件数表示**: 内訳が 0 件の resource 種別は省略 (例: 活動のみ archived なら「活動 5 個」のみ表示)

文言 atom:
```ts
PLAN_CHANGE_LABELS.archivedBannerTitle = (total: number) =>
  `${total}件のデータは${PLAN_CHANGE_TERMS.protected}`
PLAN_CHANGE_LABELS.archivedBannerDesc =
  `${PLAN_FULL_TERMS.premium}にすることで${PLAN_CHANGE_TERMS.resumeReady}。`
PLAN_CHANGE_LABELS.archivedBreakdown = (c: { children: number; activities: number; checklists: number }) =>
  [
    c.children > 0 && `お子さま ${c.children}人`,
    c.activities > 0 && `活動 ${c.activities}個`,
    c.checklists > 0 && `チェックリスト ${c.checklists}個`,
  ].filter(Boolean).join(' / ')
PLAN_CHANGE_LABELS.archivedBannerCta = `${PLAN_FULL_TERMS.premium}にする`
PLAN_CHANGE_LABELS.archivedBannerLink = '一覧を見る'
```

### D. mixed variant (trial + downgrade 両 archived 混在)

C variant と同じ ArchivedResourceBanner を表示。`archived_reason` 区別なく合計件数を表示 (ユーザー視点では発生経緯より「保護されている」事実が重要)。

```
┌─────────────────────────────────────────────────────────┐
│ 📦  X 件のデータは保護されています  (合算)              │
│     お子さま 2人 / 活動 7個                              │
│     プレミアムにすることでいつでも復活できます。         │
│                       [プレミアムにする] [一覧を見る]   │
└─────────────────────────────────────────────────────────┘
```

TrialBanner と二重表示にならないよう、`mixed` variant では既存 `TrialBanner.bannerDescExpiredWithArchive` 文言を出さず archived は ArchivedResourceBanner に集約 (Phase 7 実装時に TrialBanner 側の archived 文言を抑止)。

### E. /admin/subscription#archived listing (read-only)

`/admin/subscription` ページの一番下に anchor target `#archived` でセクション追加。`SaasSubscriptionPanel` (Phase 7 rename 後) 内で `data.archivedSummary` を受けて表示。

```
┌─────────────────────────────────────────────────────────┐
│ 保護されているデータ                                     │
│                                                          │
│ お子さま (1 人)                                          │
│   ・たろうくん (小学生)                  [復活はプレミアム化]│
│                                                          │
│ 活動 (5 個)                                              │
│   📚 漢字練習                            [復活はプレミアム化]│
│   🏃 ランニング                          [復活はプレミアム化]│
│   ・・・                                                  │
│                                                          │
│ チェックリスト (2 個)                                    │
│   ・朝の身じたく (たろうくん)            [復活はプレミアム化]│
│                                                          │
│ ──────────────────────────────────────────              │
│ これらのデータは削除されません。                         │
│ プレミアムにすることで、いつでも復活できます。           │
│                                       [プレミアムにする]│
└─────────────────────────────────────────────────────────┘
```

- **read-only 視覚化**: 各 item は `opacity: 0.6` + 編集 / 削除 ボタン非表示。背景は `var(--color-surface-muted)`
- **編集不可の明示**: 各 row 右端に小さく「復活はプレミアム化」label (link でなく text、Calendly 型 toggle-back の代替で誤操作回避)
- **Calendly 型個別 toggle 不採用**: Phase 1 段階では tenant 全体一括復元のみ。個別 toggle は plan limit 超過時のエラー UX が複雑化するため Open question #1 で将来検討
- **下部 CTA**: banner と同じ「プレミアムにする」を再掲 (Fitts's Law、長 listing でも CTA に到達可)

## 文言 atom (terms.ts/labels.ts、ADR-0045 整合)

### terms.ts atom 新規追加 (Phase 2 #2549 既提案を本 PR で確定)

```ts
// src/lib/domain/terms.ts 追加
export const PLAN_CHANGE_TERMS = {
  changeVerb: 'プランを変更',     // 「アップグレード」「ダウングレード」煽り回避で統一
  archive: 'アーカイブ',
  restore: '復活',
  protected: '保護されています',  // 「失う」「消える」を排除
  resumeReady: 'いつでも復活できます',
} as const
```

### labels.ts compound 新規追加 (Phase 7 実装時)

```ts
// src/lib/domain/labels.ts 追加
export const PLAN_CHANGE_LABELS = {
  // archived banner
  archivedBannerTitle: (total: number) =>
    `${total}件のデータは${PLAN_CHANGE_TERMS.protected}`,
  archivedBannerDesc:
    `${PLAN_FULL_TERMS.premium}にすることで${PLAN_CHANGE_TERMS.resumeReady}。`,
  archivedBreakdown: (c: { children: number; activities: number; checklists: number }) =>
    [
      c.children > 0 && `お子さま ${c.children}人`,
      c.activities > 0 && `活動 ${c.activities}個`,
      c.checklists > 0 && `チェックリスト ${c.checklists}個`,
    ].filter(Boolean).join(' / '),
  archivedBannerCta: `${PLAN_FULL_TERMS.premium}にする`,
  archivedBannerLink: '一覧を見る',
  // archived listing (read-only)
  listingTitle: `${PLAN_CHANGE_TERMS.protected.replace(/います$/, '')}いるデータ`,  // 「保護されているデータ」
  listingChildrenSection: (n: number) => `お子さま (${n}人)`,
  listingActivitiesSection: (n: number) => `活動 (${n}個)`,
  listingChecklistsSection: (n: number) => `チェックリスト (${n}個)`,
  listingItemRestoreHint: `${PLAN_CHANGE_TERMS.restore}は${PLAN_FULL_TERMS.premium}化`,
  listingFooter:
    `これらのデータは削除されません。${PLAN_FULL_TERMS.premium}にすることで、${PLAN_CHANGE_TERMS.resumeReady}。`,
} as const
```

### 既存 atom の本 PR 取込

| 既存 atom | 本 PR での参照 |
|---|---|
| `PLAN_FULL_TERMS.premium` (Phase 7 で `.family` → `.premium` rename) | banner / listing 全体 |
| `TRIAL_LABELS.bannerDescExpiredWithArchive` | Phase 7 で `PLAN_CHANGE_TERMS` 経由文言に置換 |
| `DOWNGRADE_RESOURCE_SELECTOR_LABELS.restoreNote` | 既存維持 (DowngradeResourceSelector 内のみ参照、文言は本 PR `PLAN_CHANGE_LABELS.listingFooter` と整合) |

### 禁止語彙 (Phase 2 #2549 + 本 PR で確定)

「失う」「消える」「使えなくなる」「ロックされる」「制限されています」「閲覧できなくなります」を archived 表示文脈で使用禁止。`PLAN_CHANGE_TERMS.protected` / `.resumeReady` / `.restore` で全文言を組み立てる。

検出: `scripts/check-no-plan-literals.mjs` (#972 / #1918) の `forbidden_words` リストに上記 6 語を追加 (Phase 7 実装時)。

## ADR-0012 整合性チェック

| 観点 | 適合 |
|---|---|
| 子供 UI に課金圧をかけない | ✅ `(child)/[uiMode]/*` ルートに ArchivedResourceBanner / archived listing は構造的に import されない (図 3 参照) + repository layer で is_archived=1 filter |
| 滞在時間を伸ばさない | ✅ banner は 1 行 + 2 CTA の静的表示。即時遷移 (modal / countdown / 連続演出なし) |
| サプライズ濫用禁止 | ✅ archived は降格 / trial 終了時点で確定、新規発生通知なし。banner は state 駆動の静的表示 |
| 連続演出 / 煽り禁止 | ✅ 「あと N 日!」「急いで!」「失う恐怖」型不採用。Kinde 「what happens when clicked」原則 |
| 解約動線を隠さない | ✅ banner は archived 訴求であり解約導線とは独立。`/admin/subscription` 内に既存解約導線 (`/admin/billing/cancel`) を維持 |
| 「premium = 必須」階層 signal 打消 | ✅ banner 主訴求は「保護されています」、副訴求のみ「プレミアム化で復活」。「無料では使えない」型の文言を不採用 (refs #2594 D-2) |

## アクセシビリティ検証 (Phase 7 実装時)

| 観点 | 検証項目 |
|---|---|
| **コントラスト比** | banner 背景 (`--color-feedback-info-bg`) + text (`--color-text-primary`): WCAG AA 4.5:1 以上 / read-only listing の `opacity: 0.6` text: AA 3:1 以上を保持 (背景色 + opacity 計算後実測) |
| **キーボードナビ** | banner 内 2 CTA は `<a>` 要素、Tab 順序: CTA1 → CTA2。listing item は非 interactive (Tab 対象外) |
| **focus ring** | `:focus-visible { outline: 2px solid var(--color-border-focus) }` 既存スタイル流用 |
| **aria-label** | banner: `role="status" aria-live="polite"` (state 変化時に SR 通知、ただし archived は静的のため過度通知なし)。CTA: `aria-label="${total}件のデータを復活させるためにプレミアムにする"` |
| **タップサイズ** | CTA 2 ボタン: 44px (Material Design 最小) 確保。mobile 横並び困難時は縦 stack |
| **role** | banner 全体: `role="status"` / listing section: `role="region" aria-labelledby="archived-listing-title"` |
| **`opacity: 0.6` の SR 対応** | listing item の opacity だけでは SR には伝わらないため `aria-label="保護されています、復活はプレミアム化"` を各 item に付与 |

## 子供画面非表示の構造的担保

### 1. import 経路の構造的担保

`ArchivedResourceBanner.svelte` は `(parent)/admin/+layout.svelte` のみが import。`(child)/[uiMode]/+layout.svelte` 系は `AdminLayout` 自体を使わないため、**コード構造上 banner は子供画面に発生しえない** (図 3 参照)。

### 2. repository layer の archived filter

子供画面の child / activity / checklist 取得経路 (`getChildById` / `findActivities` / `findTemplatesByChild` 等) は既に `is_archived=0` で filter 済 (既存実装、Phase 7 で追加防御不要)。

### 3. E2E 不在 assert (Phase 7 実装時)

`tests/e2e/admin-archived-resource-banner.spec.ts` (新規) で `/preschool/home` / `/elementary/home` / `/junior/home` / `/senior/home` / `/baby/home` の 5 mode で:

```ts
expect(page.locator('[data-testid="archived-resource-banner"]')).toHaveCount(0)
expect(page.locator('[data-archived="true"]')).toHaveCount(0)
```

## impact-analysis skill 4 layer 防御適用

### L1 構文 (ast-grep / ripgrep)

- 既存 `getArchivedResourceSummary` 参照: 2 箇所 (`+layout.server.ts` / unit test)
- 既存 `restoreArchivedResources` 参照: 5 箇所 (license `+page.server.ts` / downgrade-restore `+server.ts` / unit test 2 / integration test 1)
- 新規 `PLAN_CHANGE_TERMS` atom 参照: Phase 7 実装時に 0 → ~15 件 (banner + listing + DowngradeResourceSelector 文言移行)
- 新規 `ArchivedResourceBanner.svelte`: 1 箇所 import (`(parent)/admin/+layout.svelte`)

### L2 意味 (型 / 同名異義)

- **`archived_reason` enum** (`'trial_expired' | 'downgrade_user_selected'`) は repository / service 共通の SSOT。本 PR で文字列を変更しない (DB schema 互換性保持)
- **`hasArchivedResources` boolean** (既存 TrialBanner prop) vs **`archivedSummary` object** (新規 ArchivedResourceBanner prop): 役割分離。既存は trial 経路の 1 bit、新規は reason 別件数集計
- **`restoreArchivedResources` 単位** (tenant 全体) vs **個別 item toggle** (将来検討): 本 PR では tenant 全体のみ採用、個別 toggle は Open question #1

### L3 構造 (依存グラフ)

- `(parent)/admin/+layout.server.ts` 既存 `archivedSummary` 計算条件 (`planTier==='free' && isTrialExpired`) を拡張 (`planTier !== 'premium' || hasDowngradeArchived` 等、Phase 7 で確定)
- `getArchivedResourceSummary` は子供件数のみ返却 → activity / checklist 件数 + reason 別集計を返却する拡張版が必要 (Phase 7 実装で `resource-archive-service.ts` 拡張、既存 API 後方互換性は型拡張のみで保持)
- `ArchivedResourceBanner.svelte` 依存元: `(parent)/admin/+layout.svelte` のみ
- `/admin/subscription#archived` listing は `SaasSubscriptionPanel` (Phase 7 rename 後) 内、`/admin/subscription/+page.server.ts` から `archivedListing` prop を渡す経路を追加

### L4 派生 artifact 21 カテゴリ (本 #2575 は docs のため該当なし)

本 PR は UI 設計 docs のみで、A-G 全カテゴリ (DB / cache / SaaS / 分析 / 顧客接点 / CI/CD / テスト) の派生 artifact 影響なし。Phase 7 実装 PR で以下を必須確認:

- [ ] **A-1 DB schema**: `archived_reason` enum / `is_archived` column 既存維持、追加 column 不要
- [ ] **A-3 repository interface**: `findArchivedActivities` / `findArchivedChecklistTemplates` 新規追加 (現在は `findArchivedChildren` のみ存在、活動 / チェックリスト用の listing API 未整備)
- [ ] **B-4 Service Worker / browser cache**: `(parent)/admin/+layout.server.ts` 出力 schema 変更 (`archivedSummary` 拡張) → SW 更新
- [ ] **C-7 SaaS / Stripe**: 影響なし (本 PR は archived 表示のみ、Stripe 連携は restoreArchivedResources 既存経路を維持)
- [ ] **E-13 Help Center / FAQ**: 「ダウングレードしたらデータは消えますか?」FAQ に「データは保護されており、プレミアム化でいつでも復活できます」追記検討
- [ ] **G-19 Storybook snapshot**: 4 variant の `__snapshots__/*.snap` 新規追加
- [ ] **G-19 Playwright SS**: banner 3 variant (trial / downgrade / mixed) + listing 1 件撮影
- [ ] **G-20 E2E**: `admin-archived-resource-banner.spec.ts` (新規) + downgrade → archive → reactivate → 復元の通し E2E (`downgrade-flow.spec.ts` 既存に reactivation step 追加)

## Storybook stories 設計 (Phase 7 実装時)

```typescript
// ArchivedResourceBanner.stories.svelte
- NoArchived              // none variant: banner 非表示
- TrialArchivedOnly       // trial-archived variant: 既存 TrialBanner 文言で archived 1 行
- DowngradeArchivedSmall  // downgrade-archived variant: 子供 1 / 活動 5 / チェックリスト 0
- DowngradeArchivedLarge  // downgrade-archived variant: 子供 3 / 活動 15 / チェックリスト 8
- MixedArchived           // mixed variant: trial + downgrade 両 reason 混在

// SaasSubscriptionPanel.stories.svelte (Phase 7 #2567 と統合)
- WithArchivedListingSmall  // #archived sub-section 表示、archived 少件数
- WithArchivedListingLarge  // archived 多件数 (10 件超)、スクロール挙動確認
```

## Playwright SS 取得計画 (Phase 7 実装時)

| 変数 | URL | 状態 | 用途 |
|---|---|---|---|
| `admin-archived-banner-trial` | `/admin/home` | free + trial 終了 + archived あり | 既存 TrialBanner 文言 atom 化確認 |
| `admin-archived-banner-downgrade` | `/admin/home` | standard + 旧 family ダウン残 archived | 新規 ArchivedResourceBanner 表示 |
| `admin-archived-banner-mixed` | `/admin/home` | 両 reason 混在 | banner 集約表示 |
| `admin-archived-listing` | `/admin/subscription#archived` | 上記 mixed 状態 | listing read-only + footer CTA |
| `admin-archived-banner-mobile` | `/admin/home` | downgrade-archived + viewport 375px | mobile 縦 stack CTA |

撮影は `scripts/capture.mjs` 既存フロー流用、`--flow admin-archived-{variant}` を追加。

## テスト計画 (Phase 3 完了基準、memory test-coverage-every-issue 整合)

| テスト種別 | 対象 |
|---|---|
| **Storybook test** | 5 variant + listing 2 variant 全表示確認 |
| **E2E** | `tests/e2e/admin-archived-resource-banner.spec.ts` (新規) — 5 mode で子供画面 banner 不在 assert + 親画面 4 variant 表示 assert + CTA 遷移先 URL 確認 |
| **E2E (回帰)** | 既存 `tests/e2e/downgrade-flow.spec.ts` に reactivation step を追加 — downgrade → archive → banner 表示 → CTA クリック → checkout (mock) → restoreArchivedResources → banner 消失 + item 復元 |
| **unit** | `tests/unit/services/archive-summary-extended.test.ts` (新規) — reason 別件数集計 / activity / checklist 件数返却 / mixed 状態 |
| **integration** | 既存 `tests/integration/services/resource-archive.test.ts` に拡張 — `getArchivedResourceSummary` 拡張版の reason 別返却検証 |
| **Playwright SS UX レビュー** | 5 SS × 3 ペルソナ (1人っ子家庭 / 兄弟複数 / 卒業期) で「保護されている安心感」「Win-Back の押付けにならないか」 |
| **アクセシビリティ** | axe-core 自動チェック + コントラスト比 (`opacity: 0.6` の listing item) 手動測定 + SR (NVDA / VoiceOver) で banner / listing 読み上げ確認 |
| **用語 SSOT (atom)** | `scripts/check-no-plan-literals.mjs` (#972) に「失う」「消える」「使えなくなる」「ロックされる」「制限されています」「閲覧できなくなります」を追加し、archived 関連文言の atom 経由を強制 |

実行は Phase 7 一括 (本 docs PR では計画のみ記載、test-coverage-every-issue 整合)。

## Phase 7 実装手順 (本 #2575 は docs のみ、実装は Phase 7)

1. **terms.ts 拡張**: `PLAN_CHANGE_TERMS` atom 5 件追加 (`changeVerb` / `archive` / `restore` / `protected` / `resumeReady`)
2. **labels.ts 拡張**: `PLAN_CHANGE_LABELS` compound 追加 (banner 5 件 + listing 6 件)
3. **既存 atom 移行**: `TRIAL_LABELS.bannerDescExpiredWithArchive` を `PLAN_CHANGE_TERMS` 経由に置換 (1 行修正で旧文言伝播置換)
4. **repository 拡張**: `findArchivedActivities(tenantId)` / `findArchivedChecklistTemplates(tenantId)` を `activity-repo` / `checklist-repo` に追加 (interface + sqlite + dynamodb + demo の 4 backend)
5. **service 拡張**: `getArchivedResourceSummary` を reason 別件数 + 全 resource 種別件数返却に拡張 (型は object 拡張のみ、既存呼出元の後方互換性は型 widening で確保)
6. **`(parent)/admin/+layout.server.ts` 拡張**: archivedSummary 計算条件を `planTier === 'free' && isTrialExpired` から `archivedSummary.total > 0` 全件取得に変更 (Open question #2)
7. **`ArchivedResourceBanner.svelte` 新規実装** (本 docs 仕様準拠、~50 行)
8. **`(parent)/admin/+layout.svelte` 拡張**: TrialBanner 横に ArchivedResourceBanner を condition 付き配置 (mixed variant 時は TrialBanner archived 文言抑止)
9. **`SaasSubscriptionPanel.svelte` (Phase 7 rename 後) #archived セクション追加** (~80 行、listing)
10. **`/admin/subscription/+page.server.ts`** に `archivedListing` load を追加 (`findArchivedChildren` + `findArchivedActivities` + `findArchivedChecklistTemplates` 結合)
11. **Storybook 7 variant 追加 + Playwright SS 5 件撮影 + E2E + unit + integration test**
12. **`scripts/check-no-plan-literals.mjs` 拡張**: 禁止語彙 6 件追加 (`失う` / `消える` / `使えなくなる` / `ロックされる` / `制限されています` / `閲覧できなくなります`)
13. **impact-analysis skill 4 layer 防御 + 21 カテゴリ checklist** を Phase 7 PR body に記載

## Open question (PO 判断、Phase 7 実装時に確認)

| # | 論点 | 状態 |
|---|---|---|
| 1 | 個別 item toggle reactivation (Calendly 型) を Phase 7 で実装するか、tenant 全体一括のみで開始するか | **暫定: tenant 全体一括のみ** (Pre-PMF 段階で個別 toggle は plan limit 超過時の UX 複雑化、ADR-0010)。Phase 8 以降で個別 toggle 検討 |
| 2 | `archivedSummary` 取得条件を全 state で実施するか、`planTier !== 'premium'` 時のみに絞るか | **暫定: archivedSummary.total > 0 全件取得** (プレミアム加入中でも過去 archived データの可視化 = データ持続性原則整合) / 性能影響は archived listing query 性能次第、Phase 7 計測 |
| 3 | mixed variant で TrialBanner archived 文言を抑止する場合の遷移 UX | **暫定: TrialBanner は trial 状態文言のみ、archived は ArchivedResourceBanner に集約** (重複表示回避)。Phase 7 実装時に PR レビュー |
| 4 | `/admin/subscription#archived` listing の表示件数上限 (10 件超で「もっと見る」展開等) | **暫定: 全件表示** (archived 件数が爆発的に増えるユースケース不在、Pre-PMF 段階で十分)。Phase 8 以降で件数 > 30 時の UX 検討 |
| 5 | reactivation 後の banner / listing 消失タイミング (server SSOT 即時 vs 楽観 UI) | **暫定: server SSOT 即時** (webhook 反映後の再 load、楽観 UI は副作用ゼロ原則 phase1 NFR 整合) |
| 6 | downgrade `DowngradeResourceSelector` 内の `restoreNote` 文言 (既存) と本 PR `PLAN_CHANGE_LABELS.listingFooter` の統合可否 | **暫定: 文言を `PLAN_CHANGE_TERMS` atom 経由に統一**、表示文字列は両者で共有 (Phase 7 で `DOWNGRADE_RESOURCE_SELECTOR_LABELS.restoreNote` を deprecate し `PLAN_CHANGE_LABELS.listingFooter` 経由に置換) |

## 6 観点 自己検証チェック (per-issue-execution-workflow SSOT)

| # | 観点 | 本 docs 反映 |
|---|---|---|
| 1 | **着手時 deep-research** (Notion / Calendly / Slack archived 表示 + Win-Back 業界基準) | deep-research (2026-05-28) で Notion 公式 (`/help/plan-downgrade`、view-only 化) / Calendly 公式 (`/help/how-to-organize-and-manage-your-event-types`、On/Off toggle 復活) / Win-Back rate 15-30% / 90 日 66% 引用 + Phase 2 #2549 既調査 (5 パターン対比) を再利用 + 業界 banner UX 原則 (Stigg / Userpilot) を反映 |
| 2 | **UI SS + アクセシビリティ検証計画** | Storybook 7 variant + Playwright SS 5 件 + axe-core + コントラスト比 (`opacity: 0.6` 実測) + SR 読み上げ + role / aria-live / aria-label 明示 |
| 3 | **UX 変更時のテスト項目追加** | E2E `admin-archived-resource-banner.spec.ts` 新規 + 既存 `downgrade-flow.spec.ts` 拡張 (reactivation step) + unit / integration / Storybook / SS UX レビュー (3 ペルソナ) 計画記載 |
| 4 | **用語 SSOT (atom)** | `PLAN_CHANGE_TERMS` atom 5 件 + `PLAN_CHANGE_LABELS` compound 11 件 (banner 5 / listing 6) を terms.ts / labels.ts 拡張案として明示 + 禁止語彙 6 件 (`check-no-plan-literals.mjs` 拡張案) + 既存 `TRIAL_LABELS.bannerDescExpiredWithArchive` の atom 経由置換 |
| 5 | **影響範囲事後検証** | impact-analysis 4 layer 適用 (L1: 既存 5 参照箇所列挙 / L2: `archived_reason` enum / `archivedSummary` 型拡張の同名異義 / L3: `+layout.server.ts` 拡張 + repository 4 backend 追加 / L4: 21 カテゴリで A-1 DB / A-3 repo / B-4 cache / E-13 FAQ / G-19 SS / G-20 E2E を明示) |
| 6 | **目的達成 / 大方針整合** | AC 全件達成 (read-only listing + One-click reactivation banner + 子供画面 invisible + 既存 `restoreArchivedResources` API 流用 + `PLAN_CHANGE_TERMS` atom + Storybook + SS) / Notion 型 Pattern A (Phase 2 #2549) + ADR-0012 (子供画面 invisible、親画面のみ、煽らない) + Win-Back UX (90 日 66% 業界基準) + premium 階層 signal 打消 (banner 主訴求 = 保護、副訴求 = 上位プラン化 ) (refs #2594 D-2) |

## 根拠

- **既存実装 (Explore 照合 2026-05-28)**:
  - `src/lib/features/admin/components/DowngradeResourceSelector.svelte` (ダウン前 preview Dialog 既存 351 行)
  - `src/lib/server/services/downgrade-service.ts:31-117` (`getDowngradePreview`) / `:133-202` (`archiveForDowngrade`)
  - `src/lib/server/services/resource-archive-service.ts:96-105` (`restoreArchivedResources`) / `:110-120` (`getArchivedResourceSummary` 既存子供件数のみ)
  - `src/routes/api/v1/admin/downgrade-restore/+server.ts` (POST API 既存)
  - `src/routes/(parent)/admin/+layout.server.ts:147-151` (archivedSummary 既存、trial 終了条件のみ)
  - `src/routes/(parent)/admin/+layout.svelte:60-68` (TrialBanner + `hasArchivedResources` prop)
  - `src/lib/features/admin/components/TrialBanner.svelte:85-89` (`bannerDescExpiredWithArchive` 既存文言)
  - `src/lib/domain/labels.ts:4044-4075` (`DOWNGRADE_RESOURCE_SELECTOR_LABELS.restoreNote` 既存)
- **deep-research (2026-05-28)**:
  - Notion `/help/plan-downgrade` (view-only / archived banner)
  - Calendly `/help/how-to-organize-and-manage-your-event-types` (On/Off toggle 復活)
  - Totango / ChartMogul (Win-Back rate 15-30% / 90 日 66% / 30 日 45%)
  - Stigg (downgrade flow service design) / Userpilot (banner 原則)
  - Phase 2 #2549 deep-research (Notion / Figma / Calendly / Canva / Slack 5 パターン対比、本 PR で再利用)
- **関連 Phase 1+2+3 docs**:
  - [phase1-plan-change-requirements.md](phase1-plan-change-requirements.md) (#2535 FR-5 既存維持)
  - [phase2-plan-change-journey.md](phase2-plan-change-journey.md) (#2549 ジャーニー B + Pattern A + 文言 atom 提案)
  - [phase3-admin-header-ui-design.md](phase3-admin-header-ui-design.md) (#2568 plan-badge)
  - [phase3-subscription-page-ui-design.md](phase3-subscription-page-ui-design.md) (#2567 /admin/subscription 純化、本 PR で `#archived` セクション追加)
  - [phase3-activity-limit-banner-ui-design.md](phase3-activity-limit-banner-ui-design.md) (#2569 ActivityLimitBanner、本 banner と並列配置)
- **ADR**: ADR-0012 (Anti-engagement) / ADR-0013 (LP truth = 実装の事実) / ADR-0045 (terms.ts 2 階層) / ADR-0049 (履歴保持期間ポリシー) / ADR-0010 (Pre-PMF、個別 toggle 過剰防衛回避)
- **skill**: `impact-analysis` (4 layer 防御 + 21 カテゴリ checklist) / `pre-pmf-check` (Open question #1 個別 toggle 不採用根拠) / `age-mode-check` (子供画面 invisible 5 mode assert)
- **関連 memory**: per-issue-execution-workflow / impact-analysis-methodology / design-intent-grounding / test-coverage-every-issue / deep-research-product-specific / scope-customer-experience-layer
