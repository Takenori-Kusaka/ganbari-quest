# 0059. Phase 7 統合 PR cutover シーケンスと kill switch 戦略 (Stripe 公式 5 phase + env var 2 件、LaunchDarkly / Unleash 不採用、#2683 補強で 2 Product 構成 + 副次制約 4 連動)

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-05-30 (#2683 補強で同日更新) |
| 起票者 | Claude (補佐、PO 判断適用) |
| 関連 Issue | #2665 (Phase 6 子 5) / #2525 (Epic) / #2531 (Phase 7 実装) / #2627 (Stripe Dashboard PO 操作) / #2667 (Phase 6 子 1) / **#2683 (補強 — 代替案 D 適用 + API ver 訂正 + Webhook immutable 副次制約 4 連動)** |
| 関連 docs SSOT | [phase6-rollback-and-kill-switches.md](../design/billing-redesign/phase6-rollback-and-kill-switches.md) (本 ADR の元) / [phase6-phase7-execution-ssot.md](../design/billing-redesign/phase6-phase7-execution-ssot.md) §3 + §10 OQ-3 + §5 Webhook 5 phase migration (#2683 で副次制約 4 を根拠化) / [phase5-stripe-product-architecture.md §4.4](../design/billing-redesign/phase5-stripe-product-architecture.md) (#2683 副次制約 4 SSOT) |

## コンテキスト

Epic #2525 (課金/プラン体系再設計) Phase 7 で Stripe webhook handler の旧 endpoint → 新 endpoint 移行 + lookup_key 経由参照への切替を統合 PR 5 step (Step 1 DB migration → Step 2 atom 統合 → Step 3 lookup_key → Step 4 webhook shadow/cutover/retire → Step 5 旧 env var 削除) で実施する。

**#2683 補強 (2026-05-30)**: 本 ADR 起票後の追加発見により、以下 3 点を反映:

1. **代替案 D 採用 (2 Product 各 1 Price)**: Test mode 2026-05-30 PO 手動検証で「1 Product 内 2 Price + Portal 期末ダウン」構成が Stripe Dashboard UI 制約により不可能と判明 → `prod_STANDARD` + `prod_PREMIUM` の 2 Product 各 1 Price + Portal `subscription_update.products` に 2 entries 構成に変更。ダウン方式は Subscription Schedule (期末ダウン) → `subscriptions.update` + `proration_behavior='always_invoice'` (即時 + Stripe credit memo 自動発行) に統一 (Slack / Notion / Atlassian / Linear 等 50% SaaS 採用、業界収束) ([phase5-stripe-product-architecture.md §3](../design/billing-redesign/phase5-stripe-product-architecture.md))
2. **API version 維持判断 (`'2026-04-22.dahlia'`)**: 旧計画の `'2026-05-27.dahlia'` への bump は preview リリース (production 非推奨) と判明 → Phase 7 では現行 stable `'2026-04-22.dahlia'` 維持。次回 stable リリース採用時に別 PR で 5 phase migration を発動
3. **副次制約 4 (Webhook destination api_version immutable) 新規追加**: Stripe API は既存 destination の api_version 変更を拒否する仕様 → Phase 7 Step 4 の Webhook 5 phase migration ([phase6-phase7-execution-ssot.md §5](../design/billing-redesign/phase6-phase7-execution-ssot.md)) が**強制必須**となる根拠を本 ADR + [phase5-stripe-product-architecture.md §4.4](../design/billing-redesign/phase5-stripe-product-architecture.md) で SSOT 化

cutover 失敗時の MTTR (Mean Time To Recovery) を最小化するため、以下 3 要素を確定する必要がある:

1. **cutover シーケンス**: Phase 7 統合 PR 5 step + Stripe Dashboard 7 領域 (A-G) 同期 timeline + Stripe webhook 5 phase migration (setup → discovery → shadow → cutover → retire) の対応関係 ([phase6-phase7-execution-ssot.md §3-§5](../design/billing-redesign/phase6-phase7-execution-ssot.md))
2. **kill switch 機構**: cutover 失敗時に 30 秒以内に旧経路へ即時 fallback する feature flag 戦略 ([phase6-phase7-execution-ssot.md §10 OQ-3](../design/billing-redesign/phase6-phase7-execution-ssot.md))
3. **rollback 期間別判断**: Phase 7 マージ前 / マージ後 24h 以内 / マージ後 1 週間の 3 期間別 rollback 可否マトリクス ([phase6-rollback-and-kill-switches.md §4](../design/billing-redesign/phase6-rollback-and-kill-switches.md))

課金領域は Pre-PMF でも別格 ([[billing-critical-extra-caution]])、ADR-0010 で「Pre-PMF 過剰追加」を回避しつつも、課金正常性を担保する仕組みは過剰防衛にならない最小構成で確実に配備する必要がある ([[adr0010-interpretation]])。

## 検討した選択肢 (OSS / 確立パターン最低 2 件必須 — #1350)

### 選択肢 A: Stripe 公式 5 phase + 自前 env var 2 件 (本 ADR 採用)

- **概要**: Stripe 公式 [migrate-snapshot-to-thin-events](https://docs.stripe.com/webhooks/migrate-snapshot-to-thin-events) の 5 phase migration パターン (setup → discovery → shadow → cutover → retire) を Phase 7 Step 4 に転用 + kill switch は `.env.example` の `USE_LOOKUP_KEY` (Step 3) + `STRIPE_WEBHOOK_SHADOW_MODE` (Step 4) 2 件のみで構成
- **メリット**:
  - Stripe 公式パターン、webhook migration 業界標準
  - 追加 OSS dependency なし (bundle size 増加ゼロ)
  - AWS Lambda env update API で次 invocation (約 30 秒) で反映 → MTTR 目標 5 分以内に余裕で間に合う
  - feature flag は env var 2 件のみで管理 SSOT 単純
  - `.env.example` + CDK + GitHub Actions Variables の 3 系統同期は既存 `scripts/check-new-required-env.mjs` (#2218) で配布証跡担保
- **デメリット**:
  - 3 系統同期する手間 (`.env.example` + CDK + GitHub Variables)
  - feature flag 用 Web UI なし (AWS Console / CDK env override で操作、CloudTrail 経由監査)
- **Pre-PMF コスト**: 1 day (Phase 7 Step 3 + Step 4-a 各 PR の `.env.example` + `src/lib/server/stripe/config.ts` に各 1 行追加、ADR-0010 整合)

### 選択肢 B: Stripe `migrate-subscriptions toolkit` (10h rollback window) 採用

- **概要**: Stripe 公式 [import-subscriptions-toolkit](https://docs.stripe.com/billing/subscriptions/import-subscriptions-toolkit) を採用、10h 以内の rollback を toolkit 経由で実施
- **メリット**: Stripe 公式 toolkit、10h rollback window 自動管理
- **デメリット**: subscription record migration に特化、本プロダクトの主 scope (webhook handler migration) には用途乖離
- **Pre-PMF コスト**: 2 day (toolkit 学習 + 統合)
- **判断**: **部分採用** — rollback window 概念のみ本 ADR §「結果」§rollback 3 期間別マトリクスに転用、toolkit 自体は採用せず

### 選択肢 C: LaunchDarkly (SaaS feature flag platform)

- **概要**: launchdarkly.com、SaaS 提供の feature flag platform、Web UI + SDK 統合
- **メリット**: Web UI で flag 切替 / %ロールアウト機能 / A/B test 統合
- **デメリット**:
  - 月額 $0-$0.05/MAU (Pre-PMF で月 $0、PMF 後増加)
  - SDK bundle size 60+ KB
  - **Pre-PMF Bucket A 過剰防衛 (ADR-0010)** — kill switch 2 件のためだけに導入コスト過剰
  - 障害時の SaaS dependency (LaunchDarkly 障害 = 本プロダクト障害)
- **Pre-PMF コスト**: 5 day (SDK 統合 + account setup + Web UI 学習)
- **判断**: **不採用** (ADR-0010 整合、[[adr0010-interpretation]])

### 選択肢 D: Unleash (OSS feature flag self-hosted)

- **概要**: github.com/Unleash/unleash、Apache-2.0、自前 host OSS、Web UI + SDK
- **メリット**: self-hosted で SaaS dependency なし / OSS で無料
- **デメリット**:
  - self-host コスト (CDK Lambda / RDS 追加、認可設計、監視)
  - SDK bundle size 50+ KB
  - **Pre-PMF Bucket A 過剰防衛 (ADR-0010)**
  - admin Web UI 追加で運用負担増加
- **Pre-PMF コスト**: 7 day (self-host setup + SDK 統合 + 認可設計)
- **判断**: **不採用** (ADR-0010 整合)

## 決定

**選択肢 A 採用**: Stripe 公式 5 phase migration + 自前 env var 2 件 (`USE_LOOKUP_KEY` / `STRIPE_WEBHOOK_SHADOW_MODE`)。

採用理由:

1. **Stripe 公式 5 phase 整合**: Phase 7 Step 4 と直接同型、業界標準パターン採用で実装迷いゼロ
2. **Pre-PMF Bucket A (ADR-0010)**: kill switch 2 件のためだけに LaunchDarkly / Unleash の dependency 追加は過剰防衛 ([[adr0010-interpretation]])、env var 2 件で十分
3. **Lambda env 30 秒反映**: AWS Lambda は env update を次 invocation で反映、本番 incident MTTR 目標 5 分以内に余裕
4. **bundle size 増加ゼロ**: SDK 統合コスト不要
5. **3 系統同期手順は既存 CI で担保**: `scripts/check-new-required-env.mjs` (#2218) で env 配布証跡を機械検証

選択肢 B の `migrate-subscriptions toolkit` は rollback window 概念のみ転用、toolkit 自体は subscription record migration が主 scope のため不採用。

## 結果

### 1. Phase 7 統合 PR cutover シーケンス (5 step + Dashboard 7 領域、#2683 補強で 2 Product 構成 + apiVersion bump scope 外化)

| Step | コード PR | Stripe Dashboard 同期 | kill switch |
|---|---|---|---|
| Step 1 | DB migration (子 3 #2675 13 file) | なし | なし |
| Step 2 | atom 統合 5 sub step (子 5 #2643 §6、#2683 で `cancelPendingRedirect` atom 不要化) | なし | なし |
| Step 3 (#2683 訂正、#2718 staging SSOT 確定) | lookup_key 移行 (apiVersion は `'2026-04-22.dahlia'` 維持)。**PR-3a (caching layer、shadow) → PR-3b (cutover) 間の staging 検証期間 + AC SSOT は [phase7-staging-validation-protocol.md](../design/billing-redesign/phase7-staging-validation-protocol.md) (#2718) で確定 — 2-3 日案 (本 docs §2 推奨) + 1 営業週間案 (上流 OQ-3 推奨案 fallback) を併記、QM 再協議で確定** | 領域 A+B (Test mode **2 Product 各 1 Price** + Portal `subscription_update.products` 2 entries) | `USE_LOOKUP_KEY` 配備 |
| Step 4-a | webhook shadow mode (5 event 購読: `customer.subscription.*` 2 + `invoice.payment_*` 2 + `credit_note.created` 1、#2683 訂正) | 領域 C (Test mode Webhook disabled) | `STRIPE_WEBHOOK_SHADOW_MODE=true` |
| Step 4-b | webhook cutover | 領域 E+F (Production 2 Product + Webhook 有効化、副次制約 4 #2683 で新 destination 作成必須) | `STRIPE_WEBHOOK_SHADOW_MODE=false` |
| Step 4-c | webhook retire | 領域 G (旧 destination delete) | なし |
| Step 5 | 旧 env var 削除 + 旧 4 Price archive | 領域 G (旧 Price archive) | (Phase 7 OQ-2 で削除判断) |

詳細は [phase6-phase7-execution-ssot.md §3](../design/billing-redesign/phase6-phase7-execution-ssot.md) 参照。

### 2. kill switch 機構 (env var 2 件)

`.env.example` SSOT 1 箇所配備、`src/lib/server/stripe/config.ts` 経由参照:

```bash
# .env.example
USE_LOOKUP_KEY=true                  # Phase 7 Step 3: lookup_key 解決の段階移行
STRIPE_WEBHOOK_SHADOW_MODE=false     # Phase 7 Step 4-a: webhook 二重 destination 期間 log 検証
```

3 系統 (CDK Lambda env / GitHub Actions Variables / `.env.example`) 同期手順は [phase6-rollback-and-kill-switches.md §5.4](../design/billing-redesign/phase6-rollback-and-kill-switches.md) で SSOT 化。Test mode で kill switch dry-run を 1 度実演 (Phase 6 子 2 #2674 §6 シナリオ 2、本 ADR 採用判断 = Pre-Ready 必須化)。

### 3. rollback 3 期間別マトリクス

| 期間 | 開始 | 終了 | rollback 可否 |
|---|---|---|---|
| A. マージ前 | Phase 7 統合 PR Step 5 着手前 | Step 5 直前 | revert 可 (全戻し) |
| B. マージ後 24h 以内 | Step 5 直後 | cutover 24h 後 | kill switch revert 可 (部分戻し) |
| C. マージ後 1 週間 | cutover 24h 以降 | Step 4-c retire 完了直後 | revert 不可、forward-fix のみ |

期間別 rollback 手順は [phase6-rollback-and-kill-switches.md §4](../design/billing-redesign/phase6-rollback-and-kill-switches.md) で SSOT 化。

### 4. トレードオフ

| 項目 | トレードオフ |
|---|---|
| Web UI 不在 | AWS Console / CloudTrail 監査経由、PMF 後にチーム拡大時の UI 不要性は PO 再判断 |
| 3 系統同期手間 | `scripts/check-new-required-env.mjs` で機械検証、初回配備時の手順 SSOT で 1 day 工数 |
| %ロールアウト機能なし | Pre-PMF 段階で全ユーザー一括 cutover、PMF 後のチーム拡大時に必要なら別 ADR で再設計 |
| dependency 増加なし | bundle size 増加ゼロ / Stripe 公式パターン純度高い |

### 5. 1-in-1-out 履行

`docs/decisions/README.md` active 39 件 (2026-05-28 棚卸時点) で TOP 10 ルール超過中。本 ADR で +1 → 40 件。1-in-1-out 履行は **2026-06 月 1 棚卸 (docs/CLAUDE.md §「ADR 月 1 棚卸」、次回 2026-06 最終週)** で archive 候補確定後に実施 (ADR-0014 proposed のまま 1 ヶ月超過 / ADR-0017 rejected archive 候補 / per-ADR ボリューム超過 6 件 のいずれかから 1 件以上を archive 移動)。

### 6. 副次制約 4 (#2683 新規): Webhook destination api_version immutable

[phase5-stripe-product-architecture.md §4.4](../design/billing-redesign/phase5-stripe-product-architecture.md) (#2683 補強で SSOT 化) で確定した副次制約 4「Webhook destination api_version 不変性」が、本 ADR §1 Step 4 の Webhook 5 phase migration を**強制必須**にする根拠となる。Stripe API `webhookEndpoints.update({api_version})` は既存 destination の api_version 変更を `400 Bad Request` で拒否するため、新 destination 作成 → shadow → cutover → retire の 5 phase 以外に apiVersion bump 経路はない。

Phase 7 では apiVersion = `'2026-04-22.dahlia'` 維持判断 (#2683) のため本副次制約は発動しないが、将来の stable リリース採用時に本 ADR + [phase6-phase7-execution-ssot.md §5](../design/billing-redesign/phase6-phase7-execution-ssot.md) を参照することで誤った rollback 手順 (Dashboard UI で既存 destination 更新試行) を防止する。

### 7. ADR との関係

- ADR-0010 (Pre-PMF): LaunchDarkly / Unleash 不採用判断根拠
- ADR-0014 (OSS 先調査): 4 件比較を本 ADR §「検討した選択肢」に verbatim 記載
- ADR-0020 (PR size ≤ 500 行): Phase 7 Step 1-5 + PR-X 各分割の根拠
- ADR-0031 (DB migration 互換性): Step 1 DB migration の整合
- ADR-0045 (atom / compound): `SUBSCRIPTION_PAGE_LABELS` atom 配置 (#2683 で `cancelPendingRedirect` atom は不要化)
- ADR-0049 (retention): webhook events 30 日 cleanup

詳細実装手順は [phase6-rollback-and-kill-switches.md](../design/billing-redesign/phase6-rollback-and-kill-switches.md) §3-§8 を参照。本 ADR は判断原則のみ SSOT 化、詳細手順は補助 docs に集約 (per-ADR ≤ 150 行 / 章立て ≤ 7 セクション ルール整合)。
