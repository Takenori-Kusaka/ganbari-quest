# Phase 1 補強 1 文脈判断 6 件 + lookup_key 段階移行 + API version 維持判断 SSOT (Epic #2525 Phase 6 子 4、#2683 補強)

| 項目 | 内容 |
|------|------|
| 孫 issue | #2664 (Phase 6 グループ B 並列) / #2683 (補強 — API version `2026-04-22.dahlia` 維持判断 + 副次制約 4 連動) |
| 親 | Phase 6 親 (#2660) / Epic #2525 |
| 前提 | Phase 1 補強 1 ([phase1-naming-url-integrity-requirements](phase1-naming-url-integrity-requirements.md)) Open question 5 件 / Phase 5 子 1 ([phase5-stripe-product-architecture](phase5-stripe-product-architecture.md)) Step 3 lookup_key (#2683 で 2 Product 各 1 Price 構成に変更) + API version `'2026-04-22.dahlia'` 維持 (#2683 訂正) |
| 並列対象 | Phase 6 子 2 (#2662 Test clock) / 子 3 (#2663 DB migration script) |
| 連動 (Phase 7) | Phase 6 子 1 ([phase6-phase7-execution-ssot](phase6-phase7-execution-ssot.md)) Step 3 / Stripe Dashboard #2627 / 実装 PR #2531 |
| ステータス | 設計確定 (本 PR で SSOT 化、コード変更は Phase 7) / **2026-05-30 補強 #2683: API version 維持判断 + Webhook immutable 副次制約 4 を本 docs から phase5 子 1 §4.4 へ参照集約** / **2026-06-03 補強 #2788 (license key 完全全廃): 文脈判断 6 件のうち論点 2 / 3 / 4 / 6 を「license key 残す」前提から「削除 / 物理削除」に全面再評価 (§3.8 参照)** |
| 起点 | Phase 1 補強 1 で「文脈判断 6 件」と確定された個別判断を、推奨案 + 業界根拠 + PO 判断票で SSOT 化 + lookup_key 段階移行 4 step + **API version 維持判断 (`'2026-04-22.dahlia'`)** + 72h rollback window 監視計画 (将来の stable bump 時に発動) を確定する。**2026-06-03 (#2788) で license key 完全全廃が確定 ([phase1-license-key-removal-final-requirements.md](phase1-license-key-removal-final-requirements.md)) したため、論点 2 / 3 / 4 / 6 の「rename しない (license key 残す)」前提は崩れ、削除 / 物理削除に再評価した (§3.8)。** |

> **位置づけ**: Phase 6 グループ B 並列子 (子 2 Test clock / 子 3 DB migration script と独立)。Phase 1 補強 1 で「Open question 5 件 + FR-5 残対象 6 件」として明文化された個別判断を、Phase 5 子 1 の lookup_key + API version bump 戦略と統合し、Phase 7 統合 PR 5 step (子 1 SSOT) Step 3 + Step 5 で参照される PO 判断票 + 実装手順 SSOT として確定する。

## 1. 設計背景

### 1.1 課題: Phase 1 補強 1 の「文脈判断 6 件」が PO 判断票として SSOT 化されていない

Phase 1 補強 1 ([phase1-naming-url-integrity-requirements](phase1-naming-url-integrity-requirements.md)) は「機械置換 28 件 + 文脈判断 6 件 + 残す 13 件」と整理した。機械置換 28 件は Phase 7 統合 PR Step 2-3 (子 1 SSOT) で一括 rename されるが、**文脈判断 6 件は PO の個別判断が必要**であり、判断材料 (業界根拠 / 影響範囲 / 推奨案) が散在しているため Phase 7 実装着手時に決定が滞留するリスクがある。

文脈判断 6 件 (Phase 1 補強 1 §Open question + FR-5 残対象):

1. `AUTH_LICENSE_STATUS` enum → `AUTH_PLAN_STATUS` rename 是非
2. `LICENSE_PLAN` enum 名称変更是非 (billing namespace consistency)
3. `/ops/license/*` ops internal tool rename 是非
4. `site/help/license-key.html` 更新範囲 (legacy guide 性質保持 vs subscription 案内置換)
5. メール文面の「ライセンス」言及 5 件処理
6. DB schema 内 `license_key_status` enum (NUC で残存) 扱い

### 1.2 課題: lookup_key 段階移行手順が Stripe 公式 `transfer_lookup_key` パターンに整合していない

Phase 5 子 1 §3.4 で lookup_key 経由参照を確定したが、**旧 env var (`STRIPE_PRICE_*` 4 件) から新 lookup_key (`standard_monthly` / `premium_monthly` 2 件) への切替手順**が docs 化されていない。Stripe 公式 [manage-prices](https://docs.stripe.com/products-prices/manage-prices) は `transfer_lookup_key` API による段階移行を推奨するが、本プロダクトでの適用手順 (caching layer / feature flag / 並行運用期間) が散在している。

### 1.3 課題: Stripe API version 維持判断 (#2683 訂正) と将来 bump 時の 5 phase migration 必須性

> **#2683 補強 (2026-05-30、訂正)**: 旧設計 (本 docs 元版) では `'2026-04-22.dahlia'` → `'2026-05-27.dahlia'` への bump を採用候補としていたが、Stripe 公式 [API versioning](https://docs.stripe.com/api/versioning) を再確認した結果、`'2026-05-27.dahlia'` は **preview リリース** (production 非推奨、backward incompatible change の評価用) であることが判明。本プロダクトは**現行 stable `'2026-04-22.dahlia'` を維持** ([phase5-stripe-product-architecture.md §3.4](phase5-stripe-product-architecture.md) #2683 訂正)、次回 stable 月次リリース (例: `'2026-06-XX.dahlia'`) が公開され次第、別 PR で bump 判断する。

**将来の stable apiVersion bump 時の必須手順** (本 docs SSOT、Phase 7 着手時には bump なしのため使用しないが、将来の発動準備):

`src/lib/server/stripe/client.ts` の `STRIPE_API_VERSION` 定数 1 行修正だけでは不十分で、副次制約 4 (Webhook destination api_version immutable、[phase5-stripe-product-architecture.md §4.4](phase5-stripe-product-architecture.md)) により**新規 destination 作成 → cutover → 旧 delete の 5 phase migration が強制必須**。具体的に: (a) Webhook destination の API version は immutable のため**新規作成必須** (Stripe Dashboard #2627)、(b) Stripe Changelog `'2026-04-22.dahlia'` → 新 stable バージョンの breaking change 全件確認、(c) 72h rollback window 監視計画 (Sentry / Discord alert thresholds) を本 docs §5 で SSOT 化。

### 1.4 設計がなかった場合に何が困るか

1. **Phase 7 実装着手時の PO 判断滞留**: 文脈判断 6 件の決定が散在 → 実装者が独断で進めるか / PO 確認待ちで blocker 化
2. **lookup_key 移行で stale Price 状態発生**: 段階移行手順 (旧 env var + 新 lookup_key の二重 priceId 解決期間) が docs 化されていない → cutover で priceId 切替競合が発生し active subscription の請求停止リスク (Pre-PMF Bucket A 課金別格 [[billing-critical-extra-caution]] 整合)
3. **API version bump で 72h rollback window 逸失**: breaking change 確認不足 → Webhook event field 構造変化を見逃す → handler 破壊 → rollback window (72h) 内に検知できない長期 incident 化
4. **Webhook destination の API version 不一致**: Dashboard 側 Webhook の `default_api_version` と SDK の `apiVersion` 乖離 → event の field 構造が SDK 期待値と異なり handler エラー (Phase 5 子 1 R5 と同一リスク、本 PR で手順 SSOT 化により予防)

## 2. 設計原則

| 原則 | 内容 | 根拠 |
|------|------|------|
| **文脈判断 6 件は SSOT 1 表で PO 判断票化** | 推奨案 + 業界根拠 + 影響範囲 + PO 判断要否を 1 表に集約、Phase 7 実装着手前に PO が 6 件を一括判断可能 | ADR-0008 (設計ポリシー先行確認フロー) / Phase 1 補強 1 Open question 5 件 |
| **lookup_key 段階移行は 4 step + 1 feature flag** | (1) caching layer 設計 / (2) 並行運用 (旧 env var + 新 lookup_key 両解決) / (3) cutover (新 lookup_key 直読) / (4) 旧 Price archive | Stripe 公式 `transfer_lookup_key` / [manage-prices](https://docs.stripe.com/products-prices/manage-prices) |
| **API version bump は 4 step + 72h rollback window 監視** | (1) Changelog breaking change 全件確認 / (2) Webhook destination 同期 / (3) SDK 1 行修正 + smoke test / (4) 72h 監視 (Sentry / Discord alert) | Stripe 公式 [api/versioning](https://docs.stripe.com/api/versioning) 72h policy |
| **PO 判断推奨案は Pre-PMF 過剰防衛回避を優先** | rename 候補は「rename しない」推奨を基本、業界根拠で「rename する」が必要な場合のみ推奨に転換 | ADR-0010 Pre-PMF 過剰追加回避 / [[adr0010-interpretation]] |
| **~~NUC 互換性最優先~~ → NUC は信頼ベース (license key 全廃)** | ~~DB schema 内 `license_key_status` enum / `licenseKey()` DynamoDB prefix / `license-key-service.ts` は NUC edition で billing proof として残存、rename 禁止~~ → **#2788 で訂正: NUC は信頼ベース (family 固定・判定なし) で license key を読まないため、`LICENSE_KEY_STATUS` enum / `licenseKey()` prefix / `license-key-service.ts` は全て物理削除** (補強 3 §3.1 / §3.4) | ~~Phase 1 補強 1 FR-5~~ → [phase1-license-key-removal-final-requirements.md §2.1 / §1.2](phase1-license-key-removal-final-requirements.md) (FR-5 自己矛盾訂正) |
| **monitoring は既存 alert pipeline 流用** | Sentry / Discord alert は Phase 1 security FR-1 (webhook tenant 再検証) と統合、新規 monitoring 機構導入禁止 | ADR-0010 Pre-PMF 最小構成 |
| **本 PR は docs のみ、コード変更なし** | 実装は Phase 7 統合 PR Step 3 (lookup_key + API version bump) で実施、本 PR は SSOT 確定のみ | [[per-issue-execution-workflow]] / Phase 6 子 1 SSOT |

## 3. 文脈判断 6 件 PO 判断票 ⭐ 本 docs の核

各論点で「推奨案 + 業界根拠 + 影響範囲 + 推奨判断 + PO 判断必要 ON/OFF」を SSOT 化する。PO は本表 6 件を一括判断後、Phase 7 統合 PR Step 0-3 に反映する。

> **⚠️ 2026-06-03 再評価 (#2788 license key 完全全廃)**: 本 §3 の元設計 (#2664、2026-05-29) は「NUC edition で license key は唯一の billing proof として残存」という前提で論点 2 / 3 / 6 を「rename しない (残す)」、論点 4 を「legacy guide 性質保持」と推奨していた。しかし [phase1-license-key-removal-final-requirements.md](phase1-license-key-removal-final-requirements.md) (#2790 マージ済) §2.1 / §1.2 で **NUC は信頼ベース (判定なし・family 固定、DRM 作らない) で license key billing proof は不要** と確定し、SaaS / NUC 問わず license key **完全全廃** が PO 確定 (OQ-1〜OQ-4)。これにより前提が崩れたため、各論点を以下に再評価する (差分は §3.8 サマリ参照):
> - **論点 2** (`LICENSE_PLAN` enum): rename しない → **OQ-4 物理削除** (enum 定義削除)
> - **論点 3** (`/ops/license/*`): rename しない → **物理削除** (OQ-2 Stripe Coupon / Promotion Code 代替)
> - **論点 4** (`site/help/license-key.html`): legacy 保持 → **OQ-3 完全削除 + `/admin/subscription` 301 redirect**
> - **論点 6** (`LICENSE_KEY_STATUS` enum): rename しない → **OQ-4 物理削除** (enum + `licenseKey` 列 + `LicenseRecord` table DROP)
> - **論点 1 / 5** は影響なし (論点 1 = `AUTH_LICENSE_STATUS` enum rename は license key とは独立、論点 5 = メール「ライセンス」は `PLAN_TERMS` 経由化で従前通り)。ただし論点 1 の enum 内に license key 由来の値があれば全廃で同時整理する。

### 3.1 論点 1: `AUTH_LICENSE_STATUS` enum → `AUTH_PLAN_STATUS` rename 是非

| 項目 | 内容 |
|---|---|
| **現状** | `src/lib/domain/constants/auth-license-status.ts` で定義、user plan subscription status (subscribed / trial / expired 等) を表現する**内部識別子** |
| **影響範囲** | enum 参照 43 件 (Explore 照合 2026-05-29、`AUTH_LICENSE_STATUS` + `LICENSE_PLAN` 合算) |
| **業界根拠** | (a) Stripe SDK は `subscription.status` (active / past_due / canceled 等) を使用、`license_status` という概念は存在しない (b) `AUTH_PLAN_STATUS` の方が Stripe SSOT + Phase 1 plan-change 整合 (c) Phase 1 補強 2 で `family` → `premium` rename も同 Phase 7 で実施、同タイミングで rename することで cognitive load を 1 回に集約 |
| **デメリット** | enum 名 rename は machinable replace (28 件)、文脈判断不要だが、DB に persist された値は internal identifier のため変更不要 (enum 名 ≠ 値の string literal) |
| **推奨案** | **rename する** (`AUTH_LICENSE_STATUS` → `AUTH_PLAN_STATUS`)。Stripe SSOT + Phase 1 補強 2 同期で Phase 7 Step 2-4 (atom rename) と同時実施。enum 値 (string literal) は変更しない (Phase 1 補強 1 FR-5 「DB schema 後方互換」整合)。 |
| **PO 判断必要** | **ON** (rename 是非 + Phase 7 Step 2-4 同期是非) |

### 3.2 論点 2: `LICENSE_PLAN` enum 名称変更是非

| 項目 | 内容 |
|---|---|
| **現状** | `src/lib/domain/constants/license-plan.ts` で定義、plan billing tier (FREE / MONTHLY / YEARLY / FAMILY_MONTHLY / FAMILY_YEARLY / LIFETIME) を表現する**内部識別子** |
| **影響範囲** | 論点 1 と合算 43 件 (Explore 照合) |
| **業界根拠** | (a) Stripe SDK は `Plan` という概念を持つが、本プロダクトの `LICENSE_PLAN` は実質 SubscriptionPlan / BillingPlan 相当 (b) Phase 1 補強 2 で `family` → `premium` rename 後、`LICENSE_PLAN.FAMILY_MONTHLY` も `LICENSE_PLAN.PREMIUM_MONTHLY` に rename する必要が出るが、enum 名自体は `LICENSE_PLAN` のままでも内部識別子として支障なし — **だったが、#2788 で license key 完全全廃が確定し「NUC で license key は billing proof」前提が崩れたため、enum 自体が dead concept 化** |
| **🔄 再評価 (#2788、2026-06-03)** | 元推奨「rename しない (維持)」は「NUC で license key は唯一の billing proof」前提に依存していた。[phase1-license-key-removal-final-requirements.md §3.4 / §3.8](phase1-license-key-removal-final-requirements.md) OQ-4 で **`LICENSE_PLAN` enum は物理削除** (列 DROP + enum 定義削除、expand-contract PR-L5 の contract phase) と確定。NUC は信頼ベース (family 固定) で license key を読まないため、`LICENSE_PLAN` enum を残す billing proof 根拠が消滅した。 |
| **デメリット** | 物理削除は破壊的変更。ただし Phase 1 補強 2 Open question 4「active subscription 0 件」+ #2788 OQ-1「本番 license key 発行件数 = Pre-PMF 顧客ゼロ前提で救済 skip」確定により rollback 不可点 (列 DROP 後 forward-fix のみ) を許容できる。expand-contract (書込経路削除 → 観測期間 → 列 DROP) で慎重実施。 |
| **推奨案** | **物理削除** (`LICENSE_PLAN` enum 定義削除、`phase1-license-key-removal-final 補強 3` PR-L5 contract phase)。プラン billing tier は Stripe Subscription を唯一 SSOT とし、enum 自体を撤廃。enum 値 `FAMILY_MONTHLY` → `PREMIUM_MONTHLY` の rename (Phase 1 補強 2) は全廃に吸収され実施不要。 |
| **PO 判断必要** | **OFF** (#2788 OQ-4 で物理削除確定済、本 PR は再評価記録のみ) |

### 3.3 論点 3: `/ops/license/*` ops internal tool rename 是非

| 項目 | 内容 |
|---|---|
<!-- doc-code-refs: ignore-line -->
| **現状 (削除前)** | 旧 `src/routes/ops/license/+page.server.ts` + `[key]/` + `issue/` + `legacy-count/` (4 subroute)、ops group (Cognito ops group ADR-0033) 専用 internal tool でライセンスキー検索 + 詳細閲覧 + 発行 + legacy count を提供 (PR-L3 #2818 で物理削除済) |
| **影響範囲** | route file 4 件 + label `OPS_LICENSE_PAGE_LABELS` + nav `OPS_LAYOUT_LABELS.navLicense` (`/ops/+layout.svelte` L16) |
| **業界根拠** | (a) ops internal tool は user-facing URL と異なり業界 SaaS でも一貫した命名なし (Stripe Dashboard / Notion admin / Linear admin 各社独自) (b) ライセンスキー検索は NUC edition で残存する billing proof の運用画面 — **だったが、#2788 で license key 完全全廃が確定し、検索対象 (license key) そのものが消滅するため、画面の存在意義が消える** (c) campaign キー発行 (`issue/`) の用途は Stripe Coupon / Promotion Code で代替する |
| **🔄 再評価 (#2788、2026-06-03)** | 元推奨「rename しない (維持)」は「`/ops/license` は license key 運用画面として機能的に正確」前提に依存していた。[phase1-license-key-removal-final-requirements.md §3.1 / §3.6](phase1-license-key-removal-final-requirements.md) で **`/ops/license/*` (`+page` / `[key]` / `issue` / `legacy-count` の 4 subroute) は物理削除** と確定。代替: campaign キー発行 (`issue/`) は **Stripe Coupon / Promotion Code (OQ-2 確定)**、期限管理 (`legacy-count` 関連の cron) は `customer.subscription.deleted` webhook。ops internal tool のため redirect 不要 (削除のみ)。 |
| **デメリット** | ops 担当者 (PO) の operational muscle memory (`/ops/license` 運用) を破壊するが、license key 概念自体が全廃されるため運用対象が消滅 (画面を残すと dead UI 化)。割引配布は Stripe Dashboard Coupon UI に移管。 |
| **推奨案** | **物理削除** (`/ops/license/*` 4 subroute 削除 + `OPS_LICENSE_PAGE_LABELS` / `OPS_LAYOUT_LABELS.navLicense` 撤去 + EventBridge Scheduled Rule (legacy-count cron) の CDK 撤去)。`phase1-license-key-removal-final 補強 3` PR-L3 (routes 物理削除) で実施。 |
| **PO 判断必要** | **OFF** (#2788 OQ-2 で Stripe Coupon 代替 + 物理削除確定済、本 PR は再評価記録のみ) |

### 3.4 論点 4: `site/help/license-key.html` 更新範囲

| 項目 | 内容 |
|---|---|
| **現状** | LP `site/help/license-key.html` (NUC edition ライセンスキー仕様詳細ガイド)、`/admin/license` href 含有 |
| **影響範囲** | 1 HTML file + LP analytics tracking + existing external links (NUC edition 既存ユーザー / docs) |
| **業界根拠** | (a) NUC edition で license key は唯一の billing proof として残存 — **だったが、#2788 で NUC は信頼ベース (family 固定・判定なし) と確定し license key billing proof が不要化、ガイド自体が記述対象を失う** (b) `/admin/license` href も Phase 7 で `/admin/subscription` rename + 削除されるため href 更新では足りない (c) license key 仕様詳細を残すと「全廃したはずの概念」をユーザーに読ませ続ける意味破綻状態 (補強 3 §1.1) |
| **🔄 再評価 (#2788、2026-06-03)** | 元推奨「legacy guide 性質保持 + href のみ新 URL」は「NUC で license key は唯一の billing proof として残存」前提に依存していた。[phase1-license-key-removal-final-requirements.md §3.4 / OQ-3](phase1-license-key-removal-final-requirements.md) で **`site/help/license-key.html` は完全削除 + LEGACY_URL_MAP で `/help/license-key` → `/admin/subscription` 301 redirect** と確定。本文 (license key 仕様) を残す根拠が消滅したため、ファイル丸ごと削除 + ブックマーク救済の redirect のみ提供する。 |
| **デメリット** | 既存 external link / ブックマークは redirect で救済 (削除のみだと 404)。`site/shared-labels.js` の licenseKey namespace (47 key) も LP file 削除と同期撤去 (補強 3 §3.4)。 |
| **推奨案** | **完全削除 + 301 redirect** (`site/help/license-key.html` 物理削除 + `LEGACY_URL_MAP` に `/help/license-key` → `/admin/subscription` 301 entry 追加 + `shared-labels.js` licenseKey namespace 撤去)。`phase1-license-key-removal-final 補強 3` PR-L4 (LP / メール / LEGACY_URL_MAP) で実施。 |
| **PO 判断必要** | **OFF** (#2788 OQ-3 で完全削除 + redirect 確定済、本 PR は再評価記録のみ。元「置換範囲の細部 PO 判断」は全削除確定により不要化) |

### 3.5 論点 5: メール文面の「ライセンス」言及 5 件処理

| 項目 | 内容 |
|---|---|
| **現状** | `src/lib/server/services/lifecycle-email-service.ts` 等で「ライセンス」言及 5 件未満 (Phase 1 補強 1 FR-8 推定) |
| **影響範囲** | email template 5 件未満 + `LIFECYCLE_EMAIL_LABELS` atom |
| **業界根拠** | (a) Phase 1 補強 1 FR-8「endpoint 名 license → subscription に置換、文面は『ご利用プラン』に統一 (`PLAN_TERMS` 経由)」と整合 (b) Spotify / Apple / Netflix の billing email 文面は「subscription」「membership」「plan」を文脈で使い分け、license という単語は使用しない (c) `PLAN_TERMS` atom 経由参照で 1 行修正で全 5 件伝播 (ADR-0045) |
| **デメリット** | 「ライセンス」直書きを残すと用語不統一でユーザー混乱、`PLAN_TERMS` atom 経由化で SSOT 整合 |
| **推奨案** | **`PLAN_TERMS` 経由化** (文面の「ライセンス」を「ご利用プラン」/ `PLAN_TERMS.standard` 等で参照に置換)。Phase 7 Step 2-3 (atom rename) で `LIFECYCLE_EMAIL_LABELS` 内部の「ライセンス」を `${PLAN_TERMS.standard}` 等の template literal 参照に rewrite。 |
| **PO 判断必要** | **OFF** (Phase 1 補強 1 FR-8 で方向性確定済、本 PR は実装手順 SSOT のみ) |

### 3.6 論点 6: DB schema 内 `license_key_status` enum (NUC で残存) 扱い

| 項目 | 内容 |
|---|---|
| **現状** | `LICENSE_KEY_STATUS` enum (`src/lib/domain/constants/license-key-status.ts` 想定 + `src/lib/server/db/dynamodb/auth-repo.ts` 参照) — NUC license key 内部状態 (consumed / revoked / migrated) を表現 |
| **影響範囲** | enum 定義 + DynamoDB `auth-repo.ts` の `licenseKey` 列 + `LicenseRecord` table + `license-key-service.ts` (#2788 で全て物理削除対象、旧「NUC で唯一の billing proof」は FR-5 自己矛盾訂正で撤回) |
| **業界根拠** | (a) Phase 1 補強 1 FR-5「`LICENSE_KEY_STATUS` enum NUC license key 内部状態 (consumed/revoked/migrated)、DB schema 後方互換」で「残す」と明記済 — **だったが、補強 3 §1.2 で FR-5 は SSOT 内部の自己矛盾フラグメントと判明し訂正済** (b) NUC は信頼ベース (family 固定) で license key を読まないため、`LICENSE_KEY_STATUS` enum も `LicenseRecord` table も参照されない dead schema 化 (c) DB persist 値は internal identifier だが、参照経路が全廃されるため列ごと撤去可能 |
| **🔄 再評価 (#2788、2026-06-03)** | 元推奨「rename しない (維持)」は「NUC で license key は billing proof として残存、DB schema 後方互換」前提 (FR-5) に依存していた。[phase1-license-key-removal-final-requirements.md §3.4 / §3.8 / OQ-4](phase1-license-key-removal-final-requirements.md) で **`LICENSE_KEY_STATUS` enum + `licenseKey` 列 + `LicenseRecord` table を物理削除** (4 backend: sqlite / dynamodb / demo / fixture) と確定。expand-contract (PR-L1〜L3 で書込経路削除 + NULL 化 → 観測期間 → PR-L5 で列 DROP + enum 定義削除 + table DROP) で実施。rollback 不可点 (Pre-PMF 顧客ゼロ前提で許容、列 DROP 直前に本番 DynamoDB `licenseKey()` prefix item 最終確認推奨)。 |
| **デメリット** | 破壊的 migration (列・table DROP は revert 不可、forward-fix のみ)。Pre-PMF Bucket A (DB schema 変更) だが、#2788 OQ-1 (顧客ゼロ前提) + `feedback_billing_critical_extra_caution` 整合で慎重実施するため許容。 |
| **推奨案** | **物理削除** (`LICENSE_KEY_STATUS` enum + `licenseKey` 列 + `LicenseRecord` table DROP、4 backend)。`phase1-license-key-removal-final 補強 3` §3.8 expand-contract 手順 + PR-L5 contract phase で実施。 |
| **PO 判断必要** | **OFF** (#2788 OQ-4 で物理削除確定済、本 PR は再評価記録のみ) |

### 3.7 PO 判断票サマリ (#2788 再評価後)

| 論点 | 元推奨案 (#2664) | #2788 再評価後 | PO 判断必要 |
|---|---|---|---|
| 1. `AUTH_LICENSE_STATUS` → `AUTH_PLAN_STATUS` | rename する | rename する (変更なし、license key と独立) | **ON** |
| 2. `LICENSE_PLAN` enum 名称 | rename しない | **物理削除** (enum 定義削除、OQ-4) | OFF |
| 3. `/ops/license/*` rename | rename しない | **物理削除** (Stripe Coupon 代替、OQ-2) | OFF |
| 4. `site/help/license-key.html` 更新範囲 | legacy 性質保持 + href のみ新 URL | **完全削除 + 301 redirect** (OQ-3) | OFF |
| 5. メール文面「ライセンス」5 件 | `PLAN_TERMS` 経由化 | `PLAN_TERMS` 経由化 (変更なし) | OFF |
| 6. `LICENSE_KEY_STATUS` enum 扱い | rename しない | **物理削除** (enum + 列 + table DROP、OQ-4) | OFF |

PO 判断必要 = 1 件 (論点 1 のみ)。論点 4 は #2788 OQ-3 で完全削除確定により PO 判断不要化。論点 1 は Phase 7 統合 PR Step 2-3 着手前に PO 確認、判断結果を本 docs §3.1 に追記する運用。

### 3.8 #2788 license key 完全全廃 再評価サマリ

[phase1-license-key-removal-final-requirements.md](phase1-license-key-removal-final-requirements.md) (#2790 マージ済) の OQ-1〜OQ-4 確定で、本 §3 の元設計が依存していた「NUC で license key は唯一の billing proof として残存」前提が崩れた。論点 2 / 3 / 4 / 6 を以下に再評価する。

| 論点 | 崩れた前提 (#2664) | 再評価 (#2788) | 確定根拠 | 落とし先 (補強 3 PR) |
|---|---|---|---|---|
| 2. `LICENSE_PLAN` enum | NUC で billing proof 概念整合のため維持 | **物理削除** (enum 定義削除) | OQ-4 (列 + enum 物理削除) | PR-L5 (contract、§3.8 expand-contract) |
| 3. `/ops/license/*` | license key 運用画面として機能的に正確 | **物理削除** (4 subroute) | OQ-2 (Stripe Coupon / Promotion Code 代替) | PR-L3 (routes 物理削除) |
| 4. `site/help/license-key.html` | NUC onboarding のため legacy 保持 | **完全削除 + `/admin/subscription` 301 redirect** | OQ-3 (完全削除 + redirect) | PR-L4 (LP / メール / LEGACY_URL_MAP) |
| 6. `LICENSE_KEY_STATUS` enum | DB schema 後方互換のため残す (FR-5) | **物理削除** (enum + `licenseKey` 列 + `LicenseRecord` table、4 backend) | OQ-4 + FR-5 自己矛盾訂正 (補強 3 §1.2) | PR-L1〜L3 (expand) → PR-L5 (contract) |

論点 1 (`AUTH_LICENSE_STATUS` → `AUTH_PLAN_STATUS` rename) は license key 層とは独立 (subscription status の内部識別子 rename) のため再評価対象外、論点 5 (メール「ライセンス」5 件 `PLAN_TERMS` 経由化) も従前通り。本 §3 PO 判断票は #2788 補強 3 §4 PR-L0〜L5 に統合され、Phase 7 統合 PR の Step 0 (license key 全廃、[phase6-phase7-execution-ssot.md §3 Step 0](phase6-phase7-execution-ssot.md)) として前置される。

## 4. lookup_key 段階移行 4 step (Stripe 公式 `transfer_lookup_key`)

Phase 5 子 1 §3.4 で確定した lookup_key 経由参照を、Stripe 公式 [manage-prices](https://docs.stripe.com/products-prices/manage-prices) の `transfer_lookup_key` パターンで段階移行する。Phase 7 統合 PR Step 3 (子 1 SSOT) で実装。

### 4.1 4 step 順序

| Step | 工程 | feature flag | 期間 (目安) |
|---|---|---|---|
| **1. caching layer 設計** | `stripeCache.getPriceByLookupKey(key)` 関数を新設、Stripe API 呼び出し結果を in-memory cache (TTL: 5 min) | — | 1 PR (~1 day、Phase 7 Step 3 内部) |
| **2. 並行運用** (旧 env var + 新 lookup_key 両解決) | `USE_LOOKUP_KEY=false` で env var fallback、`true` で lookup_key 優先解決 (失敗時 env var fallback) | `USE_LOOKUP_KEY=false` (デフォルト) | 1-2 weeks |
| **3. cutover** (新 lookup_key 直読) | `USE_LOOKUP_KEY=true` に切替、env var fallback は kill switch として残存 | `USE_LOOKUP_KEY=true` | cutover 1 日 + 1 週間 smoke test |
| **4. 旧 Price archive** (active=false) | Stripe Dashboard #2627 領域 G で旧 4 Price archive、env var (`STRIPE_PRICE_*` 4 件) を CDK / Lambda env / GitHub Secrets から削除 | — | Phase 7 統合 PR Step 5 (子 1 SSOT) |

### 4.2 caching layer 設計 (Step 1)

```typescript
// src/lib/server/stripe/cache.ts (Phase 7 で新設)
const priceCache = new Map<string, { priceId: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

export async function getPriceByLookupKey(lookupKey: string): Promise<string> {
  const cached = priceCache.get(lookupKey);
  if (cached && cached.expiresAt > Date.now()) return cached.priceId;
  const stripe = getStripeClient();
  const prices = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  if (prices.data.length === 0) throw new Error(`INVALID_LOOKUP_KEY: ${lookupKey}`);
  const priceId = prices.data[0].id;
  priceCache.set(lookupKey, { priceId, expiresAt: Date.now() + CACHE_TTL_MS });
  return priceId;
}
```

**TTL = 5 min 根拠**: Stripe Dashboard で Price 更新が反映される最大遅延 (Stripe 公式 SLA 暗黙的) + Lambda cold start 影響最小化のバランス。`transfer_lookup_key` で lookup_key 移行時は cache flush 不要 (新 priceId が次回解決で取得される)。

### 4.3 並行運用 (Step 2) の feature flag SSOT

`.env.example` に追加 (Phase 7 統合 PR Step 3):

```bash
# Stripe lookup_key 解決の段階移行 (Phase 7 Step 3 / Phase 5 子 1 §3.4)
# false (default、Step 2 並行運用): env var STRIPE_PRICE_* 直読、lookup_key は副次照合
# true (Step 3 cutover): prices.list({ lookup_keys }) で解決、env var fallback は kill switch
USE_LOOKUP_KEY=false
```

Phase 6 子 1 SSOT §5.3 で確定した 2 feature flag (`USE_LOOKUP_KEY` / `STRIPE_WEBHOOK_SHADOW_MODE`) の片方。

### 4.4 cutover (Step 3) の検証手順

| 検証項目 | 手段 | PASS 条件 |
|---|---|---|
| lookup_key 解決成功 | Stripe Dashboard test mode で `prices.list({ lookup_keys })` 手動実行 | `data.length === 1` |
| cache hit rate | Lambda CloudWatch metric (Phase 7 で追加) | > 90% (5 min TTL 整合) |
| env var fallback 動作 | `USE_LOOKUP_KEY=false` 強制、checkout 経路で旧 env var priceId 解決 | PASS |
| 二重 priceId 期間中の冪等性 | webhook event の `event.id` で重複検出 (Stripe 24h idempotency 保証、Phase 5 子 1 §10 Open question 5 整合) | PASS |

### 4.5 旧 Price archive (Step 4) の前提

Phase 1 補強 2 Open question 4「active subscription 0 件」が PO 確定済 (Pre-PMF stage で実 customer 不在) のため、旧 Price archive 後の請求継続失敗リスクはゼロ。Phase 7 統合 PR Step 5 直前に PO が再確認する手順を子 1 SSOT §3 Step 5 AC (d) に組込済。

## 5. Stripe API version 維持判断 + 将来 bump 時の 5 phase migration 手順 (#2683 訂正)

> **#2683 補強 (2026-05-30)**: Phase 7 統合 PR では apiVersion = `'2026-04-22.dahlia'` (stable 最新) **維持判断** ([phase5-stripe-product-architecture.md §3.4](phase5-stripe-product-architecture.md) #2683 訂正)。`'2026-05-27.dahlia'` は preview リリースで production 非推奨のため不採用。次回 stable リリース採用時の手順を本 §5 で SSOT 化 (将来の発動準備)。

### 5.1 4 step 順序 (将来の stable apiVersion bump 時に発動)

| Step | 工程 | 検証 |
|---|---|---|
| **1. Changelog breaking change 全件確認** | Stripe Changelog `'2026-04-22.dahlia'` → 新 stable バージョンの差分を精査、webhook event の field 構造変化 / API request schema 変化 / response field rename 等を全件リスト化 | リスト化結果を本 docs §5.4 に追記 (apiVersion bump PR 着手時) |
| **2. Webhook destination 新規作成** (副次制約 4 #2683) | 副次制約 4 (Webhook destination api_version immutable、[phase5-stripe-product-architecture.md §4.4](phase5-stripe-product-architecture.md)) により**既存 destination の api_version 変更不可** → Stripe Dashboard #2627 領域 C (Test mode) + F (Production mode) で**新規 destination を新 api_version で作成** ([phase6-phase7-execution-ssot.md §5 Webhook 5 phase migration](phase6-phase7-execution-ssot.md) と同型) | Dashboard UI で目視 + Stripe API `webhookEndpoints.retrieve` で `api_version` field 確認 |
| **3. SDK 1 行修正 + 5 phase shadow → cutover → retire** | `src/lib/server/stripe/client.ts` の `STRIPE_API_VERSION` 定数を新 stable バージョンに変更、Phase 6 子 1 #2667 §5 Webhook 5 phase migration と同型で shadow mode → cutover → retire (旧 destination delete) | unit test (apiVersion bump PR で新規 client.test.ts 拡張) + Test clock E2E (Phase 6 子 2 #2662 SSOT) |
| **4. 72h 監視** (Sentry / Discord alert) | Step 3 cutover 後 72h 以内に Sentry error rate / Stripe webhook handler エラー / Discord alert を監視、breaking change 漏れによる incident を検知 | Sentry dashboard / Discord channel 監視 |

### 5.2 72h rollback window 監視計画 (将来の stable apiVersion bump 時に発動)

Stripe 公式 [api/versioning](https://docs.stripe.com/api/versioning) より、apiVersion bump 後 72h 以内であれば Dashboard で旧 apiVersion に巻き戻し可能。ただし副次制約 4 (Webhook destination api_version immutable、#2683) により Dashboard 側は新 destination 作成 + 旧 destination 再有効化のセット、SDK 側は revert PR 即時 merge となる。本プロダクトの監視 threshold:

| metric | threshold | 検出時の対応 |
|---|---|---|
| Sentry error rate (Stripe SDK 由来) | > 0.5% / 1 hour | Discord alert + 1 名以上の Dev エンジニアに通知 |
| Stripe webhook handler エラー率 | > 1% / 1 hour | apiVersion 即時 rollback (Stripe Dashboard で旧 destination 再有効化 + 新 destination 即時 disabled、副次制約 4 整合) + SDK 側も旧 stable バージョン `'2026-04-22.dahlia'` に revert |
| Stripe webhook silent drop (Phase 5 子 3 dedup table 経由検出) | > 0 件 / 24 hour | apiVersion bump とは独立だが、Phase 7 Step 4-a shadow mode (子 1 SSOT) と重ねて検証 |
| customer inquiry (Discord / メール) | > 3 件 / 24 hour | PO 判断で rollback 実施 |

### 5.3 Webhook destination の api_version immutable (#2683 副次制約 4、Step 2 詳細)

副次制約 4 ([phase5-stripe-product-architecture.md §4.4](phase5-stripe-product-architecture.md) #2683)「Webhook destination api_version 不変性」により、Stripe Dashboard #2627 領域 C / F で:

- **Test mode (領域 C)**: Webhook destination **新規作成時**に `default_api_version: <新 stable バージョン>` を明示。既存 destination の api_version を Dashboard UI で変更しようとすると Stripe API が `400 Bad Request` を返す (#2683 副次制約 4 検証手順)
- **Production mode (領域 F)**: 旧 destination とは別の新 destination を新 api_version で作成、5 phase migration (shadow → cutover → retire、[phase6-phase7-execution-ssot.md §5](phase6-phase7-execution-ssot.md)) で cutover

Dashboard 操作は PO 手動 (#2627)、本 PR では手順 SSOT のみ確定。

### 5.4 Changelog breaking change 確認結果 (将来の stable apiVersion bump 時に追記)

Phase 7 では apiVersion bump なし (`'2026-04-22.dahlia'` 維持、#2683 訂正)。将来の次回 stable リリース採用 PR 着手時、`docs.stripe.com/changelog/dahlia/<新 stable>` を確認後、breaking change を本節に列挙する。確認項目:

| カテゴリ | 確認内容 |
|---|---|
| webhook event field 構造 | 新規購読 event の field 変化 (Phase 7 Step 4 で 5 event 購読対象、`customer.subscription.*` / `invoice.payment_*` / `credit_note.created`、#2683 訂正) |
| API request schema | `subscriptions.update` / `prices.list` の request schema 変化 |
| API response field | `subscription.items.data[].price` 等の field rename |
| TypeScript 型定義 | `stripe-node` 最新版で apiVersion 整合性確認 |

**将来の apiVersion bump PR 着手時 AC**: 本節 §5.4 を埋めずに当該 PR 着手禁止 (子 1 SSOT §3 Step 3 ロールバック判断基準 (b) 整合)。

## 6. impact-analysis 4 layer 防御 + 21 カテゴリ checklist

本 PR は **docs 設計のみ** で新規 1 ファイル追加。L1-L4 影響範囲は最小だが、Phase 7 統合 PR Step 3 (子 1 SSOT) に向けた事前見積として記録。

### L1 構文 (ast-grep / ripgrep)

| 検出パターン | 件数 (Explore 照合 2026-05-29) | 影響 step |
|---|---|---|
| `STRIPE_PRICE_*` env var 直読 | 4 件 (`src/lib/server/stripe/config.ts` 内部、`.env.example` L89-92) | Phase 7 Step 3 (lookup_key 切替) + Step 5 (env var 削除) |
| `STRIPE_API_VERSION` 定数 | 1 件 (`src/lib/server/stripe/client.ts` L7) | Phase 7 Step 3 (1 行修正) |
| `AUTH_LICENSE_STATUS` + `LICENSE_PLAN` enum 参照 | 43 件 (Explore 照合) | Phase 7 Step 2-4 (atom rename、論点 1 PO 判断後) |
| `/ops/license/*` route 参照 | route file 4 件 + `OPS_LAYOUT_LABELS.navLicense` (`/ops/+layout.svelte` L16) | **物理削除** (論点 3 再評価、#2788 PR-L3 + Stripe Coupon 代替) |
| `LICENSE_KEY_STATUS` 参照 | `src/lib/server/db/dynamodb/auth-repo.ts` 内部 | **物理削除** (論点 6 再評価、#2788 PR-L1〜L5 expand-contract) |
| `site/help/license-key.html` 内 `/admin/license` href | LP 1 file | **完全削除 + 301 redirect** (論点 4 再評価、#2788 PR-L4) |
| `lifecycle-email-service.ts` 内「ライセンス」言及 | 5 件未満 (Phase 1 補強 1 FR-8 推定) | Phase 7 Step 2-3 で `PLAN_TERMS` 経由化 (論点 5) |

### L2 意味 (型 / 同名異義)

- **`AUTH_LICENSE_STATUS` enum 名 vs 値**: enum 名は rename 候補 (論点 1)、値 (string literal、DB persist) は変更不要 (Phase 1 補強 1 FR-5 後方互換)
- **`LICENSE_PLAN` enum 名 vs 値**: enum 名は維持 (論点 2)、enum 値 `FAMILY_MONTHLY` → `PREMIUM_MONTHLY` rename は Phase 1 補強 2 範囲 (本 PR scope 外)
- **`STRIPE_PRICE_*` env var の 3 系統**: CDK 設定 (infra/lib/compute-stack.ts) Lambda env / GitHub Actions Variables / .env.example の 3 系統 (Phase 5 子 1 §7 L2 整合) — Phase 7 Step 5 で 3 系統同時撤去

### L3 構造 (依存グラフ)

```
src/lib/server/stripe/client.ts (apiVersion bump、Step 3-3)
  ↓
src/lib/server/stripe/cache.ts (新設、Step 3-1)
  ↓
src/lib/server/stripe/config.ts (lookup_key 解決切替、Step 3-3)
  ↓
src/lib/server/services/stripe-service.ts (priceId 参照経路)
  ↓
src/routes/api/stripe/* (checkout / webhook handler)
```

論点 1-6 の rename は labels.ts / routes / email / DB の各層に独立波及、依存 chain なし (各層が ADR-0045 atom/compound SSOT 経由で独立)。

### L4 派生 artifact 21 カテゴリ checklist (主要項目)

| # | カテゴリ | 影響 step |
|---|---|---|
| 1 | DB schema | **#2788 再評価: `LICENSE_KEY_STATUS` enum + `licenseKey` 列 + `LicenseRecord` table 物理削除** (論点 6、PR-L5 contract、4 backend)。`AUTH_LICENSE_STATUS` enum 値 (string literal) は不変 (論点 1) |
| 2 | DB 保存済 string value | **#2788 再評価: `licenseKey` 列の保存値は PR-L1〜L3 で NULL 化 → PR-L5 で列ごと DROP** (論点 6)。`AUTH_LICENSE_STATUS` 値は不変 (enum 名のみ rename、論点 1) |
| 7 | Stripe Product / Price / Webhook | Phase 7 Step 3 (apiVersion bump + lookup_key 切替) + Step 5 (旧 Price archive) |
| 10 | email template | 論点 5 で `PLAN_TERMS` 経由化、Phase 7 Step 2-3 で `LIFECYCLE_EMAIL_LABELS` 内部 rewrite |
| 13 | Help Center / FAQ | **#2788 再評価: `site/help/license-key.html` 完全削除 + `/help/license-key` → `/admin/subscription` 301 redirect** (論点 4、PR-L4)。元「href 更新」から全削除に変更 |
| 16 | GitHub Actions / pipeline | Phase 7 Step 5 で `STRIPE_PRICE_*` GitHub Variables 4 件削除 |
| 17 | deployment env / secrets | Phase 7 Step 5 で CDK / Lambda env / GitHub Secrets 撤去 (Phase 5 子 1 §7 L4 #17 整合) |
| 19 | fixture / seed / golden | Phase 7 Step 3 で `tests/fixtures` に Stripe lookup_key mock 追加 (Phase 5 子 1 §7 L4 #19 整合) |
| 21 | audit log / 過去レコード | 影響なし (Phase 1 補強 2 Open question 4 active subscription 0 件確定) |

## 7. 想定リスク + ロールバック

| # | リスク | 検出 | ロールバック手順 |
|---|---|---|---|
| R1 | 論点 1 PO 判断遅延 → Phase 7 Step 2-4 着手 blocker | Phase 7 着手時に判断未確定検出 | 暫定的に rename しない (推奨案 OFF 側) で進行、Phase 7 Step 2-4 完了後に別 PR で rename PR を起票 |
| R2 | 論点 4 PO 判断で「完全 subscription 案内置換」が選択された場合 | PR レビューで legacy 性質毀損検出 | 部分置換 PR を revert、legacy 性質保持 + href のみ新 URL の中間案で再 PR |
| R3 | lookup_key Step 2 並行運用期間中に env var fallback が失敗 (lookup_key も env var も両方解決失敗) | Sentry alert / Lambda CloudWatch alarm | `USE_LOOKUP_KEY=false` で env var 直読のみに即時切替 (kill switch、Phase 6 子 1 SSOT §5.3 整合) |
| R4 | apiVersion bump cutover 後 72h 以内に breaking change 漏れ検出 | Sentry error rate > 0.5% / 1 hour | Stripe Dashboard で apiVersion 即時 rollback (旧 `2026-04-22.dahlia`)、SDK 側も revert (Phase 5 子 1 R7 整合) |
| R5 | Webhook destination 同期遅延 → SDK apiVersion bump 後 destination 側未更新で event field 構造乖離 | Webhook handler エラー (`event.data.object.<field>` undefined) | PO に Discord alert 通知、Dashboard で destination API version 即時同期 (Phase 6 子 1 SSOT §4.3 同期失敗時の検出ポイント整合) |
| R6 | 論点 5 `PLAN_TERMS` 経由化漏れ → email 文面で「ライセンス」直書き残存 | `npm run pre-ready` Step 7 (`check-no-plan-literals`) で検出 | Phase 7 Step 2-3 で個別 email template に直接修正、`PLAN_TERMS` template literal 参照に rewrite |

詳細は Phase 6 子 5 #2665 (ロールバック詳細 SSOT) に集約 (本 docs では主要 6 件のみ)。

## 8. Open question (PO 判断、Phase 7 で確定)

| # | 軸 | 論点 | 推奨案 | 状態 |
|---|---|------|------|------|
| 1 | **business** | 論点 1 `AUTH_LICENSE_STATUS` rename を Phase 1 補強 2 `family` → `premium` rename と同タイミングで実施するか?分割するか? | 同タイミング推奨 (Phase 7 Step 2-4 で一括、cognitive load 集約)。分割すると 2 度の rename PR + 2 度のレビュー工数 | Phase 7 Step 2-4 着手時 PO 判断 |
| 2 | **UX** | ~~論点 4 `site/help/license-key.html` で「ライセンスキー」用語を「サブスクリプション」に置換する箇所は?~~ → **#2788 OQ-3 で完全削除 + 301 redirect 確定により本 OQ は解消** | ~~legacy guide 性質保持 + href のみ新 URL~~ → **`site/help/license-key.html` 完全削除 + `/help/license-key` → `/admin/subscription` 301 redirect** (補強 3 §3.4) | ✅ #2788 OQ-3 で確定 (2026-06-03)、PO 判断不要化 |
| 3 | **security** | lookup_key Step 2 並行運用期間 (1-2 weeks) を delay する場合、staging で 1 週間以上の検証期間を設ける?Pre-Ready 必須化? | 1 週間 staging 検証推奨 (Pre-PMF 課金別格 [[billing-critical-extra-caution]] 整合)、Phase 7 統合 PR Step 3 Pre-Ready チェックリストに「staging で 1 週間 USE_LOOKUP_KEY=true 検証 PASS」を追加 | **#2718 で確定 (2026-06-01): [phase7-staging-validation-protocol.md](phase7-staging-validation-protocol.md) — 2-3 日案 (推奨) + 1 営業週間案 (本 OQ-3 推奨案 fallback) を併記、QM 再協議で最終確定** |
| 4 | **security (adversarial)** | apiVersion bump で `2026-05-27.dahlia` Changelog 確認 (本 docs §5.4) を未完了のまま Phase 7 Step 3 着手された場合の防御策は?CI gate で自動拒否可能? | 自動拒否推奨 (PR body に「Changelog 確認結果」セクション必須、CI gate 検証スクリプトを Phase 7 着手時に `scripts/` 配下で新設して確認、本 PR scope 外)。本 docs §5.4 が空のまま Phase 7 Step 3 着手された場合は QM Re-Review で BLOCK | Phase 7 Step 3 着手前に CI gate 整備 (別 Issue、本 PR scope 外) |
| 5 | **security (adversarial)** | 旧 Price archive (Step 4) 前に「active subscription 0 件」確認を再度実施 (Phase 1 補強 2 Open question 4 PO 確定済) する場合、誰がいつ確認?Stripe Dashboard 手動 vs API 経由自動? | API 経由自動推奨 (Phase 7 統合 PR Step 5 Pre-Ready CI で `stripe.subscriptions.list({ status: 'active' })` を実行、`data.length === 0` を assert)。Dashboard 手動は人為ミスリスク | Phase 7 Step 5 Pre-Ready 設計時に確定 |

## 9. 関連 (2026-05-29 整合)

### Phase 1 (上位要件)

- [naming-url-integrity-requirements](phase1-naming-url-integrity-requirements.md) — Phase 1 補強 1 (文脈判断 6 件 SSOT、本 PR §3 の元)
- [plan-naming-pricing-axis-requirements](phase1-plan-naming-pricing-axis-requirements.md) — Phase 1 補強 2 (`family` → `premium` rename、論点 1 同タイミング判断)

### Phase 5 (アーキ、全 5 子)

- [phase5-stripe-product-architecture](phase5-stripe-product-architecture.md) (子 1 #2639) — §3.4 apiVersion bump + §3 lookup_key (本 PR §4 + §5 の元)
- [phase5-atom-ssot-architecture](phase5-atom-ssot-architecture.md) (子 5 #2643) — atom 統合 5 step (Phase 7 Step 2 内部)

### Phase 6 同位 (本 PR 関連子 issue)

- [phase6-phase7-execution-ssot](phase6-phase7-execution-ssot.md) (子 1 #2661 / マージ済 #2667) — Phase 7 統合 PR 5 step (本 PR は Step 3 + Step 5 の詳細 SSOT)
- 子 2 #2662 (Test clock 6 シナリオ、グループ B 並列)
- 子 3 #2663 (DB migration script、グループ B 並列)
- 子 5 #2665 (ロールバック詳細 + kill switch SSOT + Phase 1 構造的欠落 3 件、グループ C)

### Phase 7 (実装、本 PR の落とし先)

- #2531 (Phase 7 実装) — 本 PR §3 PO 判断結果 + §4 lookup_key + §5 apiVersion bump を Step 3 + Step 5 に反映
- #2627 (Stripe Dashboard PO 手動操作) — 本 PR §5.3 Webhook destination 同期整合

### ADR (関連)

- ADR-0008 (設計ポリシー先行確認フロー、本 PR §3 PO 判断票の運用根拠)
- ADR-0010 (Pre-PMF、過剰追加回避。元設計で論点 2 / 3 / 6「rename しない」推奨の根拠だったが、#2788 license key 完全全廃で前提が崩れ物理削除に再評価。ADR-0010 は「過剰追加回避」であり全廃した dead concept を残す口実ではない、[[adr0010-interpretation]] 整合)
- ADR-0014 (OSS 先調査ルール、Stripe 公式 `transfer_lookup_key` パターン採用)
- ADR-0033 (Cognito ops group authz、論点 3 `/ops/license/*` 維持の整合)
- ADR-0045 (atom/compound 2 階層、論点 5 `PLAN_TERMS` 経由化の根拠)

### memory (関連)

- [[per-issue-execution-workflow]] — 6 観点 + git workflow
- [[impact-analysis-methodology]] — 4 layer 防御 + 21 カテゴリ
- [[branch-base-main-freshness]] — main 最新化 + push 前 rebase
- [[pr-body-encoding-powershell-stdin]] — Bash here-doc UTF-8
- [[pause-and-replan-on-stuck]] — 詰まり時立ち戻り 4 ステップ
- [[pr-review-recurring-blocks]] — QM BLOCK 予防 4 項目
- [[billing-critical-extra-caution]] — 課金は Bucket A でもさらに別格
- [[adr0010-interpretation]] — Pre-PMF は「過剰追加」回避、品質を削る口実ではない
- [[oss-first-principle]] — Stripe 公式 `transfer_lookup_key` パターン採用根拠

## 10. 根拠 (primary source)

### Stripe 公式

- [Stripe manage-prices (transfer_lookup_key)](https://docs.stripe.com/products-prices/manage-prices) — 本 docs §4 lookup_key 段階移行の元
- [Stripe API versioning (72h rollback window)](https://docs.stripe.com/api/versioning) — 本 docs §5 apiVersion bump の元
- [Stripe set-version (Node SDK apiVersion)](https://docs.stripe.com/sdks/set-version) — §5.3 SDK 1 行修正
- [Stripe build-subscriptions (lookup_key recommended pattern)](https://docs.stripe.com/billing/subscriptions/build-subscriptions) — §4.2 caching layer 設計
- [Stripe prices.list API (lookup_keys parameter)](https://docs.stripe.com/api/prices/list) — §4.4 cutover 検証手段
- [Stripe webhooks (at-least-once delivery / idempotency)](https://docs.stripe.com/webhooks) — §4.4 二重 priceId 期間中の冪等性

### 業界根拠 (論点 1-6)

- Spotify / Apple Subscriptions / Apple Family Sharing — 論点 1 (subscription status 命名整合) / 論点 4 (legacy guide パターン) / 論点 5 (billing email 「subscription」「plan」使い分け)
- Stripe SDK (`Plan` / `Subscription` 概念) — 論点 2 `LICENSE_PLAN` 維持判断
- Notion / Linear / Slack admin tool — 論点 3 ops internal tool URL は各社独自
- Adobe Creative Cloud / Microsoft 365 — ライセンスキー → サブスク移行事例 (Phase 1 補強 1 §FR-2 完全置換型整合)

### 自プロダクト関連

- [Phase 6 計画書 v2](../../../tmp/reviews/phase6-execution-plan.md) — 本 PR の起点
- [Phase 5 子 1 deep-research](../../../tmp/reviews/phase5-stripe-product-research.md) — Stripe 公式 14 URL 検証済 SSOT
- Phase 1 補強 1 `phase1-naming-url-integrity-requirements.md` §Open question + FR-5 残対象 6 件 — 本 PR §3 の元
- Phase 6 子 1 `phase6-phase7-execution-ssot.md` §3 Step 3 + Step 5 + §5.3 feature flag SSOT — 本 PR §4 + §5 の整合先
