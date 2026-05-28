# URL / 命名 / 用語の意味的整合性 要件 (Epic #2525 Phase 1 補強、2026-05-28)

| 項目 | 内容 |
|------|------|
| 親 issue | #2526 (Phase 1 要件、再オープン) |
| Epic | #2525 (課金/プラン体系再設計、ライセンスキー撤廃) |
| 起点 | Phase 3 着手中に `/admin/license` URL がライセンスキー撤廃で**意味的に破綻**することが発覚 |
| 原則 | #2559 (前工程不備は元フェーズ再オープン) + PO 指示 (ad hoc 対応禁止、Epic 全体計画から再整理) |
| ステータス | Phase 1 補強として要件追加 (補強 PR でマージ予定) |

## 背景: 見落とした要件

Epic #2525 はライセンスキー販売モデル (`/admin/license`、`LICENSE_PAGE_LABELS`、`SaasLicensePanel.svelte` 等) からサブスクリプションモデル (Stripe Subscription SSOT) への移行を目的とする。Phase 1 (#2526) で 10 機能領域 (signup/trial/checkout/plan-change/cancellation/dunning/data-lifecycle/nuc/security/legal) の要件は定義したが、**「ライセンスキー撤廃に伴う URL / 命名 / 用語の意味的整合性」が要件として明文化されていなかった**。

Phase 3 (UI 設計) 着手時、`/admin/license` プランページの UI 設計を進めようとして、

- `license` という URL がライセンスキー撤廃後に**意味的に破綻**
- `LICENSE_PAGE_LABELS` / `SaasLicensePanel` 等のコンポーネント / atom 名も同じく破綻
- これらは Epic 全体の波及範囲を持つ (308 件 URL 参照 + 218 件 atom 参照 + 450 件「ライセンス」日本語)

ことが発覚。本要件で明文化する。

## 機能要件 (FR)

### FR-1: 新 URL 命名 = `/admin/subscription`

`/admin/license` を `/admin/subscription` にリネームする。業界整合性根拠:

| 候補 | 採用 SaaS | 評価 |
|---|---|---|
| **`/admin/subscription`** ⭐ | Spotify (`/account/subscription/change`) / Apple Subscriptions / Lingokids / Stripe Customer Portal `subscription_cancel/update` flow | **採用** — Stripe 採用と単語一致、業界デファクト |
| `/admin/membership` | Netflix (UI) / YouTube (`paid_memberships`) / Nintendo / ABCmouse | 第 2 案、温かさあるが URL plural + 日本語 atom 追加コスト |
| `/admin/account` (集約型) | Apple Family / Microsoft 365 Family / Disney+ | 棄却 — 解約 hearing 動線が薄まる |
| `/admin/plan` | Notion / Slack (B2B 寄り) | 棄却 — 家庭向け B2C で URL 単独使用事例ほぼなし |
| `/admin/license` 継続 | JetBrains (B2B 技術者向け) | 棄却 — 家庭向け B2C で license URL 事例ゼロ、命名意味破綻 |

deep-research 詳細: `tmp/reviews/` (Phase 3 着手時の調査結果)、family/kids SaaS 15+ プロダクト primary source 検証済。

### FR-2: 移行戦略 = 完全置換型

Microsoft 365 / Adobe consumer / Disney+ と同パターンの**完全置換**。

| 移行戦略 | 事例 | 採用判断 |
|---|---|---|
| **完全置換** ⭐ | Microsoft 365 / Adobe consumer / Disney+ | ✅ 採用 (B2C 家庭向け) |
| 併存 | Adobe enterprise / Autodesk | ❌ B2B 向け |
| 概念分離 | JetBrains (license = アクティベーション / subscription = 課金) | ❌ 家庭向けで分ける利益なし |

### FR-3: 既存用語 atom で十分 (`SUBSCRIPTION_*_TERMS` 新規不要)

既存 atom (ADR-0045 整合):

| 既存 atom | カバー範囲 |
|---|---|
| `PLAN_TERMS` / `PLAN_FULL_TERMS` | プラン名 (無料/スタンダード/ファミリー) |
| `PRICE_TERMS` | 価格 (¥500/¥780/税込/月) |
| `TRIAL_TERMS` | トライアル (7日間/カード登録不要) |
| `CANCEL_TERMS` | 解約 (いつでも解約/退会) |

**新規 `SUBSCRIPTION_*_TERMS` atom は不要**。Phase 3 着手時に私が早とちりで「SUBSCRIPTION_TERMS 追加候補」と書いたのは影響範囲調査前の推測ミス。

### FR-4: コンポーネント / labels の rename

| 対象 | 現名 | 新名 |
|---|---|---|
| Compound Label | `LICENSE_PAGE_LABELS` | `SUBSCRIPTION_PAGE_LABELS` |
| Compound Label | `NUC_LICENSE_LABELS` | `NUC_SUBSCRIPTION_LABELS` |
| Compound Label | `OPS_LICENSE_PAGE_LABELS` | `OPS_SUBSCRIPTION_MANAGEMENT_LABELS` (検討) |
| Service | `license-service.ts` | `subscription-service.ts` |
| Component | `SaasLicensePanel.svelte` | `SaasSubscriptionPanel.svelte` |
| Component | `NucLicensePanel.svelte` | `NucSubscriptionPanel.svelte` |
| Route | `/admin/license/` | `/admin/subscription/` |
| API Route | `/api/v1/admin/license/` | `/api/v1/admin/subscription/` |

### FR-5: 残す対象 (legacy 互換性)

| 対象 | 理由 |
|---|---|
| `LICENSE_KEY_STATUS` enum | NUC license key 内部状態 (consumed/revoked/migrated)、DB schema 後方互換 |
| `LICENSE_PLAN` enum | plan billing tier 内部識別子、DB schema 後方互換 |
| `AUTH_LICENSE_STATUS` enum | user plan subscription status、内部識別子 (検討余地あり) |
| `license-key-service.ts` | NUC edition で license key は**唯一の billing proof**、サービスロジック残存 |
| `licenseKey()` DynamoDB prefix | DB schema 後方互換 |
| `LEGACY_URL_MAP` の旧 entry | 永久保持ルール (#578) |
| `/ops/license/*` routes | ops internal tool、ユーザー向け rename と独立層 |
| `docs/design/license-*-requirements.md` | 過去設計決定の歴史的記録 |
| `site/help/license-key.html` | legacy ユーザー向けキー管理ガイド (URL 内容更新は別判断) |

### FR-6: LEGACY_URL_MAP 永久リダイレクト

`src/lib/server/routing/legacy-url-map.ts` に永久エントリ追加 (CLAUDE.md `#578` 旧 URL 廃止ルール整合):

```typescript
{
  from: '/admin/license',
  to: '/admin/subscription',
  deletedAt: '2026-05-DD',  // Phase 4 着手時に確定
  issue: '#2525',
  reason: 'ライセンスキー撤廃 → サブスクリプションモデル統一 rename',
}
```

`tests/unit/routing/legacy-url-map.test.ts` + `tests/e2e/legacy-url-redirect.spec.ts` に対応 test 追加。

### FR-7: LP / 法務 / FAQ の用語整合

| 対象 | 扱い |
|---|---|
| `site/help/license-key.html` 内 `/admin/license` href | `/admin/subscription` に置換 |
| `site/pricing.html` / `site/index.html` / `site/faq.html` | 「ライセンス」「License」言及ほぼなし (CTA は `FREE_TERMS` / `PLAN_TERMS` 経由)、影響軽微 |
| 法務文書 (`site/terms.html` / `site/tokushoho.html` / `site/privacy.html`) | 「ライセンス」言及があれば「サブスクリプション」/「プラン」に置換 |
| `site/shared-labels.js` の `licenseKey.*` i18n key | LP analytics tracking + existing links 安定性のため **保持** |

### FR-8: メール文面 / 通知

`src/lib/server/services/lifecycle-email-service.ts` 等で「ライセンス」言及は 5 件未満。endpoint 名 license → subscription に置換、文面は「ご利用プラン」に統一 (`PLAN_TERMS` 経由)。

## 各 Phase の責務再整理 (URL rename の Phase 配置)

URL 命名変更は **Phase 4 (動線設計)** の本来責務。Phase 3 (UI) で着手しようとしたのは越境。

| Phase | 本要件に関する責務 |
|---|---|
| **Phase 1 (要件)** | 本書: 「URL/命名/用語の意味的整合性」要件として明文化 ✅ |
| **Phase 2 (UX)** | ジャーニー内の `/admin/license` 参照を新 URL に更新 (再オープン #2527) |
| **Phase 3 (UI)** | 新 URL/コンポーネント名前提で UI 設計 (現在中断中、子 issue #2567-2575) |
| **Phase 4 (動線)** | **URL マッピング / LEGACY_URL_MAP / IA 確定** ⭐ ここが URL rename 本拠地 |
| **Phase 5 (アーキ)** | labels.ts / atom の SSOT 設計確定 |
| **Phase 6 (実装詳細)** | 機械置換 28 件の手順 + 文脈判断 6 件の確定 |
| **Phase 7 (実装)** | 実装 + tests + LEGACY_URL_MAP entry 追加 + 一括 rename PR |

## 非機能要件 (NFR)

- **NFR-1**: rename PR は CLAUDE.md `docs/CLAUDE.md` 「巨大 docs refactor PR 分割ガイドライン」整合 (100 ファイル超で BLOCK / 50 ファイル超で警告)。機械置換 28 + 文脈判断 6 = 約 34 ファイル想定 → 1 PR で完結可能
- **NFR-2**: SSOT ファイル削除なし (rename のみ、git mv で履歴継承)
- **NFR-3**: `LEGACY_URL_MAP` entry は永久保持 (CLAUDE.md #578)
- **NFR-4**: 用語辞書経由 (ADR-0045 atom/compound 2 階層) で 1 行修正で全箇所伝播

## ユーザーストーリー

- US-1: 保護者として、ライセンスキー撤廃後の URL (`/admin/subscription`) が「サブスクリプション管理画面」と直感的に分かる
- US-2: 旧 URL (`/admin/license`) のブックマーク・外部リンクから自動的に新 URL にリダイレクトされ、迷子にならない
- US-3: LP / FAQ / 法務文書で用語 (subscription / プラン) が統一されている

## 影響範囲サマリ (Explore 照合 2026-05-28)

| カテゴリ | 件数 | 内訳 |
|---|---|---|
| `/admin/license` URL 参照 | **308 件** | `src/` / `tests/` / `docs/` / `site/` 全体 |
| `*License*` ファイル | 5 個 | constants 3 + routes 2 |
| `LICENSE_*_LABELS` atom 参照 | **218 件** | labels.ts + 利用側 |
| 日本語「ライセンス」「ライセンスキー」 | **450 件** | UI/docs/メール |
| 機械置換可能 | 28 ファイル | 一括 rename (Phase 7) |
| 文脈判断必要 | 6 entity | design review (Phase 5) |
| 残す | 13 entity | legacy 互換性 |

## Open question (PO 判断)

| # | 論点 | 状態 |
|---|---|---|
| 1 | `AUTH_LICENSE_STATUS` enum を `AUTH_PLAN_STATUS` に rename するか | Phase 5 design review |
| 2 | `LICENSE_PLAN` enum 名称変更 (billing namespace consistency) | Phase 5 design review |
| 3 | `/ops/license/*` の rename 是非 | Phase 5 (現状維持推奨、internal tool) |
| 4 | `site/help/license-key.html` の URL/内容更新範囲 | Phase 4 (legacy guide 性質を保つか subscription 案内に置換するか) |
| 5 | ADR 起票要否 (URL 命名規則 + ライセンスキー → サブスク移行戦略) | TOP 10 active 超過中、1-in-1-out で月 1 棚卸でトリガー |

## 根拠 (primary source)

- **deep-research (2026-05-28)**: 家庭向け / 子供向け SaaS 15+ プロダクト
  - Spotify Premium Family ([support.spotify.com/family-plan](https://support.spotify.com/us/article/family-plan/))
  - Apple Family Sharing ([support.apple.com/108783](https://support.apple.com/en-us/108783))
  - Netflix Membership ([help.netflix.com/41049](https://help.netflix.com/en/node/41049))
  - Disney+ Account & Billing ([help.disneyplus.com/category/account-billing](https://help.disneyplus.com/category/account-billing))
  - YouTube Premium Family ([support.google.com/youtube/12156000](https://support.google.com/youtube/answer/12156000))
  - Microsoft 365 Family ([support.microsoft.com/d89eb066](https://support.microsoft.com/en-us/account-billing/manage-microsoft-365-family-subscription-sharing-d89eb066-176a-42ba-99d6-ce033d4df741))
  - Nintendo Switch Online Family ([nintendo.com/online/family-membership](https://www.nintendo.com/us/online/nintendo-switch-online/family-membership/))
  - Duolingo Super/Family ([duolingo.com/help/family-plan](https://www.duolingo.com/help/family-plan))
  - ABCmouse / ClassDojo Plus / Lingokids / Outschool
- **ライセンスキー → サブスク移行事例**: Adobe Creative Cloud / Microsoft Office → 365 / Autodesk / JetBrains / Atlassian
- **Stripe Customer Portal 標準**: [Stripe deep links](https://docs.stripe.com/customer-management/portal-deep-links) (`subscription_cancel/update/payment_method_update`)
- **既存実装 (Explore 照合 2026-05-28)**: `src/routes/(parent)/admin/license/` + `src/lib/features/admin/components/SaasLicensePanel.svelte` + `src/lib/server/routing/legacy-url-map.ts` (#578) + `src/lib/domain/{labels,terms}.ts` (ADR-0045)
- Phase 1 既存 10 要件書 (signup/trial/checkout/plan-change/cancellation/dunning/data-lifecycle/nuc/security/legal) — 本要件はそれらと並列
- CLAUDE.md / `docs/CLAUDE.md` (旧 URL 廃止ルール #578、巨大 docs refactor PR ガイドライン)
- 原則 #2559 (前工程不備は元フェーズ再オープン) / ADR-0010 (Pre-PMF) / ADR-0045 (atom/compound 2 階層)
