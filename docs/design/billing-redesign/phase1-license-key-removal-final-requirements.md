# Phase 1 補強 3: license key 完全全廃 → Stripe Subscription 認可一本化 要件定義

| 項目 | 内容 |
|------|------|
| Epic | #2525 課金/プラン体系再設計 |
| Phase | 1 補強 3 (Phase 1 #2526 の補強、FR-5 自己矛盾訂正含む) |
| 発端 | Phase 7「atom 5 step 完了」報告後、PO が 5 秒 grep で LP/アプリ「ライセンスキー」言及 125+ file 残存を発見 |
| PO 確定 | license key = SaaS / NUC 問わず全廃 (移行期の既存キー保持者は deprecation 救済、ただし Pre-PMF 顧客ゼロ前提で救済 skip) |
| deep-research | v4 (2026-06-02、実コード verbatim + SSOT 引用で裏付け) |

---

## §1 設計背景

### 1.1 この補強がなかった場合に何が困るか

Phase 7 で atom rename (PR-2c〜2e) を「完了」と報告したが、実態は:
- アプリ `src/` に「ライセンスキー」**142 occurrence (28 file)** 残存
- LP `site/` に「ライセンスキー」言及 3 file (pricing.html 直書き 2 件含む)
- メール配布テンプレ残存

→ **Stripe Subscription に移行したはずの顧客接点で「ライセンスキー」を読ませ続ける意味破綻状態**。「漏れたらそこだけやる」を繰り返した構造的失敗の集大成。

### 1.2 FR-5 自己矛盾の発見 (deep-research v4)

`phase1-naming-url-integrity-requirements.md` FR-5 (L82) verbatim:
<!-- doc-code-refs: ignore-line -->
> | `license-key-service.ts` | NUC edition で license key は**唯一の billing proof**、サービスロジック残存 |

これは **SSOT 内部の自己矛盾フラグメント**。以下 2 つの上位 SSOT が既に全廃を明記:
- `billing-redesign/README.md` 基本方針 (L16): 「license key 撤廃 → Stripe Subscription をプラン状態の唯一 SSOT に」
- `phase1-nuc-requirements.md` FR-1/FR-2 + OQ-2 (PO 確定 2026-05-27): 「NUC は **信頼ベース** (判定なし・family 固定、DRM 作らない)、`nuc-prod && !licenseKey.valid` deny 撤廃」

→ **NUC は「全機能無制限・課金なし」(`NUC_EDITION_TERMS`) なので billing proof 不要**。FR-5 の「NUC で唯一の billing proof」は Phase 1 補強 1 起票時の stale 記述。本補強 3 で訂正する。

---

## §2 設計原則

### 2.1 認可モデルは「移行」ではなく「冗長層の除去」(最重要)

deep-research v4 の実コード照合結論: **SaaS 認可は既に subscription-based**。license key は authorization の冗長な input path に過ぎない。

`cognito.ts` L147-152 verbatim:
```typescript
const licenseStatus = tenant?.stripeSubscriptionId
    ? tenant.status === ACTIVE || GRACE_PERIOD ? ACTIVE : SUSPENDED
    : NONE;
```
→ `licenseStatus` は `tenant.stripeSubscriptionId` + `tenant.status` から計算、**license key を読まない**。名前が "licenseStatus" なのは #972 当時の legacy nomenclature。

唯一の実効ゲートは `capabilities.ts` L77:
```typescript
if (ctx.mode === 'nuc-prod' && !ctx.licenseKey?.valid) return deny('license-key-invalid');
```
→ **nuc-prod 限定**。SaaS では `ctx.licenseKey` 常に `null`。`phase1-nuc FR-2` が要求するこの deny 撤廃で license key 認可ゲートは完全消滅。

### 2.2 起動失敗リスクは限定的 (no-op 化を最初に)

`assertLicenseKeyConfigured` (`hooks.server.ts` L43-45) は `AWS_LICENSE_SECRET` 未設定時に production で throw するだけ。**最初に no-op 化すれば起動不能リスクが消える** → 以降の削除 PR は安全。

### 2.3 Epic #2525 = 3 直交軸

| 軸 | 内容 | 状態 |
|---|---|---|
| (i) Stripe subscription = entitlement SSOT | Phase 5-7、license key と直交 | 進行中 (8 PR マージ済は正しい) |
| (ii) license key 層 全廃 | **本補強 3**、認可は限定変更 (6 file core) | 未着手 |
| (iii) family→premium / 月額のみ | Phase 5 atom + Phase 7 Step 2-4 | 進行中 |

→ Phase 7 マージ済 8 PR (lookup_key/webhook) は正しい。PR-3b cdk deploy 凍結は license key と無関係。

---

## §3 仕様: 4 分類による全廃作業 SSOT

### 3.1 機械削除 (file 丸ごと、低リスク)

| 対象 | 手法 |
|---|---|
<!-- doc-code-refs: ignore-line -->
| `src/lib/server/services/license-key-service.ts` (700 行) | import 削除 + 物理削除 (PR-L3 #2818 で完了) |
| `src/routes/(parent)/admin/license/**` | Phase 7 Step 2-3 の `/admin/subscription` rename と統合削除 |
| `src/routes/ops/license/**` (+page / issue / legacy-count / [key]、7 file) | 物理削除 (運営キー発行、Stripe Dashboard 代替) |
| `src/routes/api/cron/license-expire/**` | 物理削除 (`customer.subscription.deleted` webhook 代替) |
| `src/routes/api/v1/admin/license/**` | 物理削除 |
| `src/routes/auth/signup/` キー入力 section | section 削除 |

### 3.2 認可移行 (慎重、expand-contract、中リスク)

| 対象 | 変更 |
|---|---|
| `src/lib/policy/capabilities.ts` | L77 `nuc-prod && !licenseKey.valid` deny 撤廃 + L46 `Capability` 型 `redeem.license_key` 削除 + L57 `DenyReason` 型 `license-key-invalid` 削除 + L127-132 evaluator 削除 |
| `src/lib/runtime/evaluation-context.ts` | L42-46 `EvaluationLicenseKey` 型撤廃 |
| `src/hooks.server.ts` | L43-45 `assertLicenseKeyConfigured` no-op化(先行) + L111-122 `getDebugLicenseKeyOverride` 経路撤廃 |
| `src/lib/server/debug-plan.ts` | L111-122 `getDebugLicenseKeyOverride` 削除 (`DEBUG_PLAN` は subscription tier 切替なので残す) |

**NUC write 回帰防止 E2E 必須** (5 年齢モード、`phase1-nuc US-N3` 整合)。

### 3.3 冗長層削除 (subscription 直結化、振る舞い不変、低リスク)

`stripe-service.ts` `handleCheckoutCompleted` L274-303 の `issueLicenseKey` + `sendLicenseKeyEmail` 削除。entitlement は L266-272 の `tenant.status=ACTIVE` で既付与 (key 経由しない)。

### 3.4 LP / メール / DB deprecation (低リスク)

| 対象 | 手法 |
|---|---|
| `site/help/license-key.html` | **完全削除** (OQ-3 確定) + LEGACY_URL_MAP で `/help/license-key` → `/admin/subscription` 301 redirect |
| `site/pricing.html` L301/L326 | 「購入後ライセンスキーをメールでお送りします」→「購入後すぐ有料機能をご利用いただけます」等 |
| `site/shared-labels.js` licenseKey namespace (47 key) | LP file 削除と同期 (namespace 撤去) |
| `email-service.ts` 件名「ライセンスキーをお届け」 | 削除 (SaaS subscription welcome mail に置換) |
| `auth-repo.ts` (4 backend) `licenseKey` 列 | **物理削除** (OQ-4 確定、破壊的 migration、§3.8 慎重手順) |
| `LICENSE_KEY_STATUS` / `LICENSE_PLAN` enum | **物理削除** (OQ-4 確定、§3.8) |

### 3.8 DB 列・enum 物理削除の慎重手順 (OQ-4 完全削除、破壊的)

OQ-4 で「列も enum も migration で物理削除」確定。破壊的変更で前方互換が崩れるため、Phase 6 子 3 #2675 の `lazy-startup-migrations.ts` 4 dimension SSOT に乗せた expand-contract:

1. **expand (PR-L1〜L3)**: 書込経路削除 (列は残すが NULL 化、enum 参照削除)
2. **観測期間**: 旧 code (列読込) が完全に消えたことを確認 (1 PR 分の安定)
3. **contract (PR-L5)**: migration script で `licenseKey` 列 DROP + `LICENSE_KEY_STATUS`/`LICENSE_PLAN` enum 定義削除 + `LicenseRecord` table DROP (4 backend: sqlite/dynamodb/demo/fixture)
4. **rollback 不可点**: 列 DROP 後は revert 不可、forward-fix のみ (Pre-PMF 顧客ゼロ前提で許容、`feedback_billing_critical_extra_caution` 整合で慎重実施)

⚠️ Pre-PMF 顧客ゼロ前提が崩れている場合、列 DROP 前に本番 DynamoDB の `licenseKey()` prefix item 確認必須 (OQ-1 は skip 確定だが contract 直前に最終確認推奨)。

### 3.5 LEGACY_URL_MAP redirect

- `/admin/license` → `/admin/subscription` (308 永久、`phase1-naming FR-6` 既定義)
- `/ops/license/*`: internal tool、redirect 不要 (削除のみ)
- `tests/e2e/legacy-url-redirect.spec.ts` 追加

### 3.6 ops 発行フロー全廃の代替

| 旧 | 新 |
|---|---|
| `ops/license/issue` (campaign キー発行) | **Stripe Coupon / Promotion Code 代替** (OQ-2 確定)。ops 発行 UI 撤去、割引配布は Stripe Dashboard Coupon で運用 |
| `cron/license-expire` (期限管理) | `customer.subscription.deleted` webhook (Phase 5 子 4 #2650 archive 機構) |
| `legacy-count` | 用途消失、削除 + EventBridge Scheduled Rule (CDK) 撤去 |

### 3.7 env 撤去 (最後、CDK)

`AWS_LICENSE_SECRET` / `ALLOW_LEGACY_LICENSE_KEYS` を CDK / Secrets / GitHub Variables 3 系統から撤去 (`phase1-nuc OQ-5` 整合)。

---

## §4 PR 分割 (expand-contract、起動失敗回避)

| PR | 内容 | 起動リスク |
|---|---|---|
| **PR-L0 (expand)** | `assertLicenseKeyConfigured` no-op化。throw 源を最初に消す | これで起動不能リスク消滅 |
| **PR-L1** | 入力経路削除 (signup key / admin/license action / handleCheckoutCompleted 冗長層) | なし (冗長層) |
| **PR-L2 (contract、最慎重)** | `capabilities.ts:77` deny 撤廃 + 型/evaluator + `EvaluationLicenseKey` + `getDebugLicenseKeyOverride`。**NUC write E2E 必須** | 低 (NUC 回帰のみ) |
<!-- doc-code-refs: ignore-line -->
| **PR-L3** | routes 物理削除 (admin/license は Phase 7 Step 2-3 rename 統合) + ops + cron + api + `license-key-service.ts` | なし |
| **PR-L4** | LP / メール / LEGACY_URL_MAP + CI gate (`check-license-key-leak.mjs`) | なし |
| **PR-L5 (contract)** | env 撤去 (CDK、最後) + **DB 列・enum 物理削除** (§3.8、`licenseKey` 列 DROP + `LICENSE_KEY_STATUS`/`LICENSE_PLAN` enum + `LicenseRecord` table、rollback 不可点) | 中 (CDK deploy + 破壊的 migration) |

Phase 7 既存 5 step と直交。PR-L0〜L2 を Phase 7 Step 1 並行/前置、PR-L3 admin/license を Step 2-3 統合、PR-L5 を Step 5 統合。

---

## §5 「全対応完了」SSOT 10 項目 (別 ADR-0060 化候補)

1. 機械削除完了 (import 残存 0 grep)
2. 認可移行 E2E (5 年齢モード NUC write 可能 + production build 起動成功)
3. 冗長層削除検証 (Stripe Checkout → tenant.status=ACTIVE entitlement、key 経由しない integration test)
4. DB deprecation 移行検証 (4 backend 整合)
5. LP/メール書換 (`site/help/license-key.html` href / 件名)
6. LEGACY_URL_MAP redirect + E2E spec
7. `check-license-key-leak.mjs` CI gate (全廃前提、NUC 例外なし)
8. ops 発行フロー代替確認 (campaign 需要 PO 判断 + cron 代替)
9. `AWS_LICENSE_SECRET` 等 env 撤去 (3 系統)
10. 設計書同期 (FR-5 訂正 + `docs/design/license-*.md` 5 件 + 08-DB + 07-API)

---

## §6 Open question (PO 判断待ち)

| # | 軸 | 論点 | 確定 | 状態 |
|---|---|---|---|---|
| OQ-1 | business | 本番 license key 発行件数 | Pre-PMF 顧客ゼロ前提で救済 skip (PR-L5 contract 直前に最終確認推奨) | ✅ PO 確定 2026-06-02 (skip) |
| OQ-2 | business | campaign 配布 (`ops/license/issue`) 実需要 | **Stripe Coupon / Promotion Code 代替** (ops 発行 UI 撤去、§3.6) | ✅ PO 確定 2026-06-03 |
| OQ-3 | UX | `site/help/license-key.html` 処遇 | **完全削除 + `/admin/subscription` 301 redirect** (§3.4) | ✅ PO 確定 2026-06-03 |
| OQ-4 | security | `LICENSE_KEY_STATUS`/`LICENSE_PLAN` enum + `licenseKey` 列 | **物理削除** (列 DROP + enum 削除、expand-contract §3.8、rollback 不可点) | ✅ PO 確定 2026-06-03 |

---

## §7 関連

- Epic: #2525 / Phase 1: #2526 (CLOSED、本補強 3 で FR-5 訂正)
- 直交軸: Phase 5-7 (Stripe subscription、進行中)
- 凍結中: Phase 7 PR-4b / PR-X / PR-5 + PR-3b cdk deploy (Epic やり直し完了まで)
- 別 issue: 内部 SSOT 不整合棚卸 (Product 構成 / 月額年額 / lifetime)
- deep-research v4: 実コード verbatim (`cognito.ts` / `capabilities.ts` / `hooks.server.ts` / `stripe-service.ts`) + SSOT 引用
- memory: feedback_ssot_verification_before_proposal / feedback_root_design_blind_spot / feedback_billing_critical_extra_caution / feedback_rework_from_original_phase / reference_impact_analysis_methodology
