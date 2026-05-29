# terms.ts / labels.ts atom / compound 配置確定 + Phase 7 atom 統合 PR 計画 — Epic #2525 Phase 5 グループ C (#2643)

| 項目 | 内容 |
|------|------|
| 孫 issue | #2643 (Phase 5 グループ C — Phase 3+4 で確定された新規 atom 3 種 / compound 5 種を terms.ts / labels.ts に配置確定 + Phase 7 atom 統合 PR 5 step 計画) |
| 親 | #2530 (Phase 5 アーキ) / Epic #2525 |
| 上位 (Phase 1) | #2526 補強 2 (plan-naming-pricing-axis、`family` → `premium` rename + 月額のみ) / #2526 補強 1 (naming-url-integrity、`SUBSCRIPTION_*_TERMS` 新規不要 / 既存 atom 流用) |
| Phase 3 起点 | [phase3-subscription-page-ui-design](phase3-subscription-page-ui-design.md) (#2567) / [phase3-trial-banner-ui-design](phase3-trial-banner-ui-design.md) (#2571) / [phase3-checkout-success-polling-ui-design](phase3-checkout-success-polling-ui-design.md) (#2572) / [phase3-subscription-confirm-tokushoho-ui-design](phase3-subscription-confirm-tokushoho-ui-design.md) (#2573) / [phase3-scheduled-downgrade-banner-ui-design](phase3-scheduled-downgrade-banner-ui-design.md) (#2574) / [phase3-archived-resource-reactivation-ui-design](phase3-archived-resource-reactivation-ui-design.md) (#2575) |
| Phase 4 起点 | [phase4-lp-app-flow-design](phase4-lp-app-flow-design.md) (#2621) / [phase4-reactivation-flow-design](phase4-reactivation-flow-design.md) (#2623) / [phase4-upgrade-flow-design](phase4-upgrade-flow-design.md) (#2624) |
| ステータス | docs 確定 (本 PR は設計書、terms.ts / labels.ts への実コード追加は Phase 7 #2531) |
| Phase 7 連動 | atom 3 種 + compound 5 種 追加 + `LICENSE_PAGE_LABELS` → `SUBSCRIPTION_PAGE_LABELS` rename + `PLAN_TERMS.family` → `PLAN_TERMS.premium` rename + `generate-lp-labels.mjs` 再生成 (5 step PR 計画 §6) |
| 担当 PO 手動操作 | なし (atom rename は機械置換、95 件は atom 1 行修正で伝播) |

> **位置づけ**: Phase 5 アーキ層で「Phase 3+4 設計層が確定した atom 3 種 / compound 5 種を terms.ts / labels.ts のどの位置にどのキーで配置するか + Phase 7 で atom 1 行修正 95 件伝播を実現するための 5 step PR 計画」を SSOT 化する設計書。Phase 3+4 docs に散在する atom / compound 提案を 1 箇所に集約し、Phase 7 実装者は本 docs を参照するだけで一意の atom 配置 + 一括 rename 順序 になる状態にする。

## 1. 設計背景 (§1)

### 1.1 課題: Phase 3+4 で 8 namespace が分散提案され、配置確定が不在

Phase 3+4 docs (#2567 / #2571 / #2572 / #2573 / #2574 / #2575 / #2621 / #2623 / #2624) で **新規 atom 3 種 + 新規 compound 5 種** が提案されたが、以下の問題が残る:

- **配置確定の不在**: 各 docs が「terms.ts / labels.ts に追加 (Phase 7 で)」と書くだけで、`terms.ts` / `labels.ts` の **どこに** (export 順序 / 既存 namespace との隣接) 配置するかが未確定
- **PLAN_CHANGE_TERMS の 2 docs 同時提案**: #2574 (scheduled-downgrade-banner) と #2575 (archived-resource-reactivation) が両方 `PLAN_CHANGE_TERMS` を提案するが、**キー名と値が部分的に重複かつ微妙に分岐**している (例: #2574 = `restoreAble: 'すぐに復活できます'` / #2575 = `resumeReadyPaid: 'いつでも復活できます'`)
- **Phase 7 atom 統合 PR 計画の不在**: 8 namespace 追加 + 2 種 rename (`LICENSE_PAGE_LABELS` / `PLAN_TERMS.family`) を **どの順序で何 PR に分割するか** が docs 化されておらず、Phase 7 実装者の自由裁量に委ねられる (= 並列 PR 衝突 + rebase drift リスク)
- **既存 atom 流用 vs 新規追加の判断不一致**: Phase 4 #2621 で「新規 atom 追加なし、既存 `CTA_TERMS.freeTrialVerb` 流用」を確定する一方、Phase 4 #2624 では「既存 PLAN_CHANGE_TERMS 再利用 + 新規 UPGRADE_FLOW_LABELS compound のみ」と明示するが、SSOT 表が docs 横断で存在しない

問題発生時の構造的影響:

- **atom 1 行修正で 95 件伝播の原則 (Phase 1 補強 2 NFR-1 + ADR-0045 §3.3) が崩壊**: 配置確定なしのまま Phase 7 実装に入ると、Phase 7 PR で「atom を terms.ts のどこに置くか」議論が発生し、各 PR が独自に判断 → SSOT 1 段集約が壊れる
- **`PLAN_CHANGE_TERMS` 衝突未解消で Phase 7 実装 PR が hard conflict**: #2574 と #2575 が別々の PR で `PLAN_CHANGE_TERMS` を terms.ts に追加すると、片方マージ → もう片方 conflict 連鎖
- **Phase 7 一括 rename PR (`LICENSE_PAGE_LABELS` → `SUBSCRIPTION_PAGE_LABELS`、95 件) が atom 追加 PR と衝突**: 追加 PR と rename PR が並列 → 同一 namespace で hard conflict、QA 工数浪費

### 1.2 PO 期待 (Phase 1 補強 2 NFR-1 + ADR-0045 整合)

> 「atom 1 行修正で 95 件自動伝播する仕組み (Phase 1 補強 2 Explore 確定) を Phase 7 で実現せよ。
> Phase 5 で atom 3 種 / compound 5 種の配置 (terms.ts / labels.ts) を確定し、Phase 7 PR 順序 (atom 追加 → compound 追加 → rename → atom rename → LP 再生成 の 5 step) を SSOT 化せよ。」

### 1.3 ADR-0010 (Pre-PMF) 整合性確認

- **本 docs は設計書 SSOT 確定のみで、Phase 7 までコード変更 0 件**: per-ADR ボリューム上限 (≤ 150 行 / 7 セクション) を遵守する compact 設計
- **新規 atom 3 種 / compound 5 種は Phase 3+4 で既に確定された設計事実**: 本 docs は配置を確定するだけで、atom / compound を新規発明しない (Pre-PMF 過剰抽象化回避 = ADR-0010 §3 整合)
- **5 step PR 計画は order 確定のみで、各 step を Pre-PMF 期間内で並列展開**: PR size 500 行警告 (ADR-0020) を遵守、各 step 100-200 行想定

## 2. 設計原則 (§2)

### 原則 1: 新規 atom 3 種は `terms.ts` の既存 namespace 列挙順序末尾に追加

`terms.ts` (878 行、29 namespace) の現状の export 順序は **機能領域別グルーピング** (PLAN → PRICE → TRIAL → CANCEL → … → CHECKOUT) を採用。新規 atom 3 種は以下の隣接性で配置する:

| 新規 atom | 配置 (隣接既存 atom) | 配置理由 |
|---|---|---|
| `PLAN_CHANGE_TERMS` | `UPGRADE_TERMS` (L34) 直後 | 「プラン変更 / アップグレード / 上位プラン」(UPGRADE) と「プラン変更動詞 / archive / restore / protected / resumeReady」(PLAN_CHANGE) が機能領域として隣接 |
| `TOKUSHOHO_TERMS` | `CHECKOUT_TERMS` (L43) 直後 | 特商法 6 項目は Checkout 同意取得文脈で参照され、`CHECKOUT_TERMS.chosenPlanFeature` (景品表示法) と機能領域として隣接 |
| `CHECKOUT_SUCCESS_TERMS` | `TOKUSHOHO_TERMS` (上記新規) 直後 | Checkout 直前 (`custom_text` = CHECKOUT_TERMS) / 同意 (TOKUSHOHO_TERMS) / 直後 (CHECKOUT_SUCCESS_TERMS) の 3 atom を時系列で配置 |

### 原則 2: 新規 compound 5 種は `labels.ts` の既存 namespace 領域別グルーピングに追加

`labels.ts` (8257 行、156 compound) の現状 export 順序は **画面 / 機能領域別**:

| 新規 compound | 配置 (隣接既存 compound) | 配置理由 |
|---|---|---|
| `SUBSCRIPTION_PAGE_LABELS` | `LICENSE_PAGE_LABELS` (L1633、Phase 7 step 3 で本 namespace を rename) | rename 後の正本として配置、`LICENSE_PAGE_LABELS` 既存構造を継承 (Phase 3 #2567 §文言 atom 確定済) |
| `UPGRADE_FLOW_LABELS` | `LICENSE_PAGE_LABELS` (L1633) 直後 | アップ動線文言 (`/admin/subscription/confirm` 上部 context) は subscription page と機能領域として隣接 |
| `SCHEDULED_DOWNGRADE_BANNER_LABELS` | `TRIAL_LABELS` (L618) と機能領域として隣接 → `BILLING_LABELS` (L2184) 直後配置 | banner / 通知系の `TRIAL_LABELS` (Reverse Trial) + `BILLING_LABELS` (請求) と機能領域として隣接 |
| `PHASE4_REACTIVATION_FLOW_LABELS` | `SCHEDULED_DOWNGRADE_BANNER_LABELS` (上記新規) 直後 | reactivation 動線は scheduled downgrade と表裏 (Phase 4 #2623 整合)、隣接配置で SSOT 一覧性確保 |
| `LP_PRICING_LABELS` 拡張 (新規 namespace 追加なし) | 既存 `LP_PRICING_LABELS` (L4901) に key 追加のみ | Phase 4 #2621 §3.1 確定: `LP_PRICING_LABELS.ctaTrialVerb` / `.faqPurchaseSteps*` / `.faqCancelSteps*` を既存 namespace 内に追記 (新規 namespace 起こさない) |

### 原則 3: `PLAN_CHANGE_TERMS` 衝突解消 (key 統合確定)

#2574 と #2575 で提案された `PLAN_CHANGE_TERMS` を本 docs で **統合 11 key として確定**する (Phase 7 実装時の hard conflict 回避):

```ts
// docs SSOT: Phase 7 step 1 で terms.ts に追加するキー一覧
export const PLAN_CHANGE_TERMS = {
  // 動詞 (#2574 + #2575 共通)
  changeVerb: 'プランを変更',     // アップ / ダウン 両動線で煽り回避統一 (Kinde 整合)
  changeNoun: 'プラン変更',
  // ダウン確定状態 (#2574 専用)
  scheduledChange: '切り替わります',
  // archive 行為 (#2574 + #2575 共通)
  archive: 'アーカイブ',
  archiveVerb: 'アーカイブされます',
  // 復活 (#2574 + #2575 共通、value 統一)
  restore: '復活',
  restoreAble: 'すぐに復活できます',
  resumeReady: 'いつでもワンクリックで復活できます',  // = paid plan 文脈 alias
  resumeReadyPaid: 'いつでも復活できます',            // #2575 ADR-0049 retention 整合 paid
  resumeReadyFree: '期限内にプラン切替で復活可能です', // #2575 ADR-0049 retention 整合 free
  // 保護 (#2574 + #2575 共通、ADR-0049 retention 整合で 4 variant)
  protected: '保護されています',                      // = paid alias
  protectedReason: '保護のため',
  protectedPaid: '保護されています',                  // #2575 paid 明示
  protectedFree: '90 日間アーカイブとして保持されます', // #2575 free 明示 (景表法 5 条整合)
  // CTA (#2574 専用)
  keepCurrent: '現プランのまま続ける',
} as const;
```

統合判断の根拠:
- **#2574 提案の 11 key を主軸** (banner / reactivation 動線で全 key 使用)
- **#2575 提案の `protectedFree` / `resumeReadyFree` を追加** (景表法 5 条 1 号 = ADR-0049 retention free plan 90 日整合)
- **alias key を残す** (`resumeReady` = `resumeReadyPaid` の alias) — Phase 7 で 段階的に alias 経路を撤去するため、初版は両 key 提供で参照側の選択肢を確保 (ADR-0010 = Pre-PMF 段階適用)

### 原則 4: `LICENSE_PAGE_LABELS` → `SUBSCRIPTION_PAGE_LABELS` rename は段階的 (構造継承)

Phase 1 補強 1 (#2526 補強 1 / `phase1-naming-url-integrity-requirements.md`) で「`SUBSCRIPTION_*_TERMS` 新規不要」確定済。一方 **compound レベルでは rename 必須** (URL = `/admin/license` → `/admin/subscription` 整合):

- **構造継承**: `LICENSE_PAGE_LABELS` 既存 namespace の全 key を `SUBSCRIPTION_PAGE_LABELS` に rename + Phase 3 #2567 §文言 atom 確定済 9 key を追加
- **rename 影響**: 95 件参照 → atom rename と同時に 1 PR 内で一括置換 (Phase 7 step 3 SSOT)

### 原則 5: 新規 atom 追加禁止判断 (ADR-0045 §3.3 = 「atom は 1 用語」)

Phase 4 #2621 §3.1 で確定された原則を本 docs で SSOT 化 (将来 Phase 7 実装で新規 atom 起票時の判断基準):

| 判断 | 例 |
|---|---|
| **新規 atom 追加 = OK** | `PLAN_CHANGE_TERMS.changeVerb` (単一動詞)、`TOKUSHOHO_TERMS.heading1Quantity` (単一見出し)、`CHECKOUT_SUCCESS_TERMS.successHeading` (単一見出し) |
| **新規 atom 追加 = NG (= 既存 atom 流用)** | `'${TRIAL_TERMS.duration}${CTA_TERMS.freeTrialVerb}'` = "7日間無料で試す" は compound、`'スタンダードプラン以上で'` は compound (`${PLAN_FULL_TERMS.standard}以上で…`) |
| **新規 atom 追加 = NG (= 別 atom 既存)** | `'お申し込み'` = `SIGNUP_TERMS.canonical` 既存 |

## 3. terms.ts 配置確定 (3 atom) (§3)

### 3.1 PLAN_CHANGE_TERMS (新規) — `terms.ts` L34 (UPGRADE_TERMS) 直後

§2 原則 3 で確定した統合 11 key を配置。docs SSOT。

```ts
// src/lib/domain/terms.ts L34 直後に追加 (Phase 7 step 1 で実装)
//
// 設計意図: プラン変更 (アップ / ダウン 双方) の SSOT atom。
//   #2574 (期末ダウン banner) + #2575 (archived reactivation) + #2623 (Phase 4 動線) で共通参照される
//   11 key を本 namespace に集約。ADR-0049 retention 90 日整合で free / paid variant を併設。
//
// 関連 ADR:
//   - ADR-0012 (Anti-engagement): 「失う / 消える / 使えなくなる」atom を含めない (煽り回避)
//   - ADR-0045 (terms.ts 2 階層): atom 単一用語、compound 組立は labels.ts 側
//   - ADR-0049 (retention 90 日): protectedFree / resumeReadyFree で景表法 5 条 1 号回避
export const PLAN_CHANGE_TERMS = { /* §2 原則 3 確定 11 key */ } as const;
```

### 3.2 TOKUSHOHO_TERMS (新規) — `terms.ts` L43 (CHECKOUT_TERMS) 直後

Phase 3 #2573 §4.1 確定 15 key (heading 6 + 重要事項補足 3 + 解約方法 2 + 同意取得 3 + 自動更新明示 1) を配置。docs SSOT は #2573 §4.1 を継承。

### 3.3 CHECKOUT_SUCCESS_TERMS (新規) — `terms.ts` (TOKUSHOHO_TERMS 新規) 直後

Phase 3 #2572 §文言 atom 確定 15 key (variant A success + B preparing + C processing + D failed + E timeout の 5 variant × 3 文言) を配置。docs SSOT は #2572 §文言 atom を継承。

### 3.4 既存 atom 流用 (新規不要、Phase 1 補強 2 FR-3 再確認)

Phase 1 補強 2 FR-3 で「`SUBSCRIPTION_*_TERMS` 新規不要、既存 atom 流用」確定済。Phase 3+4 設計で新規 atom 起票検討された全 8 候補のうち、3 種のみが atom (上記 3.1-3.3)、残り 5 種は既存流用で確定:

| 既存 atom | 既存値 | 流用先 (Phase 3+4 docs) |
|---|---|---|
| `PLAN_TERMS.standard` / `.family` (Phase 7 step 4 で `.premium`) | スタンダード / ファミリー → プレミアム | #2567 / #2573 / #2575 / #2621 / #2624 全件 |
| `PLAN_FULL_TERMS.*` | スタンダードプラン / プレミアムプラン | 同上 |
| `PRICE_TERMS.*` | ¥500 / ¥780 / ¥0 / 税込 | #2567 / #2573 / #2621 |
| `TRIAL_TERMS.*` | 7日間 / カード登録不要 | #2567 / #2571 / #2621 |
| `CANCEL_TERMS.*` | 解約 / いつでも解約 / 退会 | #2567 / #2573 / #2621 |
| `CTA_TERMS.freeTrialVerb` | 無料で試す | #2621 (LP_PRICING_LABELS.ctaTrialVerb で組立) |
| `SIGNUP_TERMS.canonical` | お申し込み | #2572 (成功文言) / #2573 (同意文言) |
| `STRIPE_PORTAL_TERMS.*` | Stripe の請求管理ページ | #2573 (解約方法) / #2621 (FAQ 解約手順) |
| `ADMIN_VIEW_TERMS.*` | ご家族の見守り画面 | #2621 (FAQ 購入手順 / 解約手順) |

## 4. labels.ts 配置確定 (5 compound) (§4)

### 4.1 SUBSCRIPTION_PAGE_LABELS (新規 + rename 元継承) — Phase 3 #2567 §文言 atom 確定済

Phase 7 step 3 で **既存 `LICENSE_PAGE_LABELS` (L1633) を本 namespace に rename + #2567 §文言 atom 9 key 追加**。docs SSOT は #2567 §文言 atom を継承。

### 4.2 UPGRADE_FLOW_LABELS (新規) — `labels.ts` `LICENSE_PAGE_LABELS` (L1633) 直後

Phase 4 #2624 §4.2 確定 5 method (`contextFromFeatureGate` / `contextFromTrialEnd` / `contextFromHeaderBadge` / `contextFromBanner` / `contextFallback`) を配置。docs SSOT は #2624 §4.2 を継承。

### 4.3 SCHEDULED_DOWNGRADE_BANNER_LABELS (新規) — `labels.ts` `BILLING_LABELS` (L2184) 直後

Phase 3 #2574 §4 確定 7 method (3 variant × 2 + 共通 CTA + aria) を配置。docs SSOT は #2574 §4 を継承。

### 4.4 PHASE4_REACTIVATION_FLOW_LABELS (新規) — `labels.ts` `SCHEDULED_DOWNGRADE_BANNER_LABELS` (上記新規) 直後

Phase 4 #2623 §文言 atom 確定 6 method (dismiss 2 + context 3 + toast 1) を配置。docs SSOT は #2623 §文言 atom を継承。

### 4.5 LP_PRICING_LABELS 拡張 (新 namespace 不要) — 既存 `LP_PRICING_LABELS` (L4901) に key 追加

Phase 4 #2621 §3.1 + §4.1 + §4.2 確定 key 追加 (`ctaTrialVerb` / `faqPurchaseSteps*` 5 key / `faqCancelSteps*` 5 key) を既存 namespace 内に追記。docs SSOT は #2621 §3.1 + §4.1 + §4.2 を継承。

### 4.6 PLAN_CHANGE_LABELS / CHECKOUT_SUCCESS_LABELS / SUBSCRIPTION_CONFIRM_LABELS (関連 compound、本 PR scope 外)

以下の compound は Phase 3 docs で既に SSOT 確定済 (本 PR では配置確認のみ、Phase 7 step 2 で labels.ts に追加):

| compound | Phase 3 docs | 配置 (labels.ts) |
|---|---|---|
| `PLAN_CHANGE_LABELS` | #2575 §文言 atom (11 key) | `PLAN_CHANGE_TERMS` 配置に隣接、`SUBSCRIPTION_PAGE_LABELS` 直後 |
| `CHECKOUT_SUCCESS_LABELS` | #2572 §文言 atom (3 method) | `CHECKOUT_LABELS` (L8114) 直後 |
| `SUBSCRIPTION_CONFIRM_LABELS` | #2573 §4.2 (約 25 key) | `SUBSCRIPTION_PAGE_LABELS` (新規 §4.1) 直後 |

## 5. impact-analysis 4 layer 防御 + 21 カテゴリ checklist (§5)

### L1 構文 (ast-grep / ripgrep) — 既存参照件数

| 検索パターン | 既存件数 | Phase 7 影響 |
|---|---|---|
| `LICENSE_PAGE_LABELS` 参照 | 218 件 (Phase 1 補強 1 確認) | step 3 rename PR で `SUBSCRIPTION_PAGE_LABELS` に 1 行修正で全件伝播 |
| `PLAN_TERMS.family` 参照 | 95 件 (Phase 1 補強 2 Explore) | step 4 atom rename PR で `PLAN_TERMS.premium` に 1 行修正で全件伝播 |
| `PLAN_FULL_TERMS.family` 参照 | 同上 (95 件に含む) | 同上 |
| `PRICE_TERMS.family` 参照 | 同上 (95 件に含む) | 同上 |
| `/admin/license` URL 参照 | 308 件 (Phase 1 補強 1) | LEGACY_URL_MAP 永久エントリ追加 (Phase 4 #2620 SSOT、本 PR scope 外) |

### L2 意味 (型 / 同名異義)

- **表示プラン名 (`PLAN_TERMS.family`) vs 内部識別子 (`'family'` enum / `family-tenant` / `LICENSE_KEY_STATUS`)**: Phase 1 補強 2 FR-5 で明文化済。step 4 atom rename PR で表示名のみ rename、enum / DB 値は別 PR (Phase 7 step 別)
- **`PLAN_CHANGE_TERMS.resumeReady` (alias) vs `.resumeReadyPaid` (明示) の同名異義**: §2 原則 3 で alias 残し確定、Phase 7 段階撤去判断
- **`TOKUSHOHO_TERMS.heading5Cancel` vs `CANCEL_TERMS.canonical`**: 前者は 6 項目見出し「申込撤回・解約方法」、後者は単純名詞「解約」。意味的に異なるため両 atom 維持

### L3 構造 (依存グラフ)

新規 atom 3 種 / compound 5 種の参照グラフ:

```
terms.ts atom (新規 3)
   ↓ import
labels.ts compound (新規 5 + 既存 LP_PRICING_LABELS 拡張)
   ↓ import
*.svelte / *.ts (Phase 7 #2531 実装)
   ↓ generate-lp-labels.mjs
site/shared-labels.js (Phase 7 step 5 LP 反映)
   ↓ injection
site/*.html (LP)
```

Phase 7 PR 順序を §6 で確定する理由: 上記グラフの **下流から先に追加すると import error**、上流から順次配置必須。

### L4 派生 artifact 21 カテゴリ checklist

| カテゴリ | 影響 | Phase 7 対応 |
|---|---|---|
| **F-18 i18n platform** | `site/shared-labels.js` 自動生成元 = labels.ts | step 5 で `generate-lp-labels.mjs` 再生成 (`npm run pre-ready` Step 8 自動検証) |
| **G-19 fixture / golden** | terms.ts atom 値変更時 snapshot 更新 | step 4 atom rename PR で snapshot 一括更新 (Vitest `--update` 経由) |
| **E-15 法務文書** | tokushoho.html の特商法 6 項目を `data-lp-key` 経由 `TOKUSHOHO_TERMS` 参照に SSOT 化 | Phase 7 別 PR (Phase 1 #2541 法務統合、本 §6 step 外) |
| **その他 17 カテゴリ** | 影響なし (DB / Stripe / Cognito / email template / analytics 等) | 確認のみ、Phase 7 PR 別 |

## 6. Phase 7 atom 統合 PR 5 step 計画 (§6) ⭐ 本 docs の核

Phase 7 (#2531) 実装時に **以下の 5 PR を順序通り** に作成 + マージする。並列化禁止 (上記 §5 L3 依存グラフのため)。

### Step 1: terms.ts に 3 atom 追加 (1 PR、推定 100 行)

| 項目 | 内容 |
|---|---|
| 追加対象 | `PLAN_CHANGE_TERMS` (§3.1) / `TOKUSHOHO_TERMS` (§3.2) / `CHECKOUT_SUCCESS_TERMS` (§3.3) |
| 配置位置 | `terms.ts` L34 (UPGRADE_TERMS) 直後 (PLAN_CHANGE) + L43 (CHECKOUT_TERMS) 直後 (TOKUSHOHO + CHECKOUT_SUCCESS) |
| 影響範囲 | terms.ts のみ +約 80 行 (compound 側は本 PR で参照しない、import error 起こさない) |
| AC | `npx svelte-check` PASS + `npx vitest run src/lib/domain/` PASS + DESIGN.md §6 atom 一覧 自動再生成 (`scripts/generate-design-md-sections.mjs`) |
| Pre-merge | 本 PR 単体でマージ可、Step 2 を blocker としない (atom は使われなくても存在可) |

### Step 2: labels.ts に 5 compound 追加 (1 PR、推定 200 行)

| 項目 | 内容 |
|---|---|
| 追加対象 | `SUBSCRIPTION_PAGE_LABELS` (新規追加部分のみ、既存 `LICENSE_PAGE_LABELS` 構造継承は Step 3 で実施) / `UPGRADE_FLOW_LABELS` / `SCHEDULED_DOWNGRADE_BANNER_LABELS` / `PHASE4_REACTIVATION_FLOW_LABELS` / `LP_PRICING_LABELS` 拡張 (key 追加のみ) |
| 追加対象 (related) | `PLAN_CHANGE_LABELS` (Phase 3 #2575) / `CHECKOUT_SUCCESS_LABELS` (Phase 3 #2572) / `SUBSCRIPTION_CONFIRM_LABELS` (Phase 3 #2573) — §4.6 で SSOT 確定済、本 step で同時追加 |
| 配置位置 | §4 で確定した各位置 |
| 影響範囲 | labels.ts のみ +約 180 行 (atom 経由 import で template literal 解決) |
| AC | Step 1 マージ済 + `npx svelte-check` PASS + `check-no-plan-literals.mjs` PASS + DESIGN.md §6 compound 一覧 自動再生成 |
| Pre-merge | Step 1 マージ必須 (atom import error 回避) |

### Step 3: `LICENSE_PAGE_LABELS` → `SUBSCRIPTION_PAGE_LABELS` rename (1 PR、推定 250 行 + 警告 1 件)

| 項目 | 内容 |
|---|---|
| rename 対象 | `labels.ts` の `LICENSE_PAGE_LABELS` (L1633) → `SUBSCRIPTION_PAGE_LABELS` (Step 2 で追加した新規 9 key と統合) |
| 影響範囲 | 218 件 参照 (Phase 1 補強 1 確認、`*.svelte` / `*.ts` 全件) — atom 1 行修正で全件自動伝播 |
| AC | Step 2 マージ済 + `npx svelte-check` PASS + `npx vitest run` PASS + 218 件 grep 0 件 (旧名残存ゼロ) + Storybook 起動確認 + `npm run pre-ready -- --pr <num>` 10 step PASS |
| Pre-merge | Step 2 マージ必須 + PR size 250 行警告 (ADR-0020) 分割不可理由明示 (rename は一体性必要、分割すると intermediate state でビルド失敗) |
| 同時更新 | `LEGACY_URL_MAP` 永久エントリ `/admin/license` → `/admin/subscription` (Phase 4 #2620 SSOT 経由、別 PR 可) |

### Step 4: `PLAN_TERMS.family` → `PLAN_TERMS.premium` atom rename (1 PR、推定 200 行 + 警告 1 件)

| 項目 | 内容 |
|---|---|
| rename 対象 | `terms.ts` の `PLAN_TERMS.family` / `PLAN_FULL_TERMS.family` / `PRICE_TERMS.family` 3 atom (1 行修正で 95 件伝播) |
| 影響範囲 | 95 件 参照 (Phase 1 補強 2 Explore 確定) + テストケース文脈判断 + LP 35 件 (`generate-lp-labels.mjs` 再生成で Step 5 連動) + DB schema enum (`'family'` → `'premium'`) は別 PR (Phase 7 step 別、ADR-0031 db-migration skill) |
| AC | Step 3 マージ済 + atom 1 行修正で 95 件自動伝播確認 + `npx svelte-check` PASS + `npx vitest run` PASS (snapshot 更新含む) + `check-no-plan-literals.mjs` PASS |
| Pre-merge | Step 3 マージ必須 (`SUBSCRIPTION_PAGE_LABELS` 配下で `.family` 参照する key を一括 rename) + PR size 200 行警告 (ADR-0020) 分割不可理由明示 (atom rename は全件同時で SSOT 維持) |
| 法務文書 | terms.html / tokushoho.html「ファミリープラン: 30日」grace-period 文脈 5 件は手動更新 + 法務確認、別 PR (Phase 1 #2541 法務統合) |

### Step 5: `generate-lp-labels.mjs` 再生成 (LP 反映) (1 PR、推定 50 行、ほぼ自動生成)

| 項目 | 内容 |
|---|---|
| 対象 | `site/shared-labels.js` (`scripts/generate-lp-labels.mjs` で labels.ts → 文字列値 解決) |
| 影響範囲 | site/shared-labels.js 自動再生成 + LP 35 件 HTML 表記が `data-lp-key` 経由で自動反映 (manual 更新不要) |
| AC | Step 4 マージ済 + `npm run pre-ready` Step 8 (`generate-lp-labels --check`) PASS + LP 撮影 SS 4 件 (`scripts/capture-hp-screenshots.mjs --only feature`) 目視確認 + `measure-lp-dimensions.mjs` PASS (LP 高さ閾値遵守) |
| Pre-merge | Step 4 マージ必須 (atom rename 完了状態で再生成) |
| 副作用 | LP visual regression (ADR-0053 pixelmatch) で diff > 10% 出る可能性、`--update-baseline` で baseline 更新 |

### 5 step 並列化禁止理由 (§6 まとめ)

| 並列化候補 | 禁止理由 |
|---|---|
| Step 1 + Step 2 並列 | Step 2 が Step 1 の import に依存、import error |
| Step 2 + Step 3 並列 | Step 3 の rename 対象 (`LICENSE_PAGE_LABELS`) が Step 2 で `SUBSCRIPTION_PAGE_LABELS` (新規 9 key 部分) として追加されており、同一 namespace で hard conflict |
| Step 3 + Step 4 並列 | Step 4 で `PLAN_TERMS.family` rename 対象が Step 3 の `SUBSCRIPTION_PAGE_LABELS` 配下にあり、同一 PR 内 conflict |
| Step 4 + Step 5 並列 | Step 5 が Step 4 の atom rename 完了状態を前提に再生成、未完了で実行すると `'ファミリー'` 残存 LP に伝播 |

## 7. ADR-0045 整合性チェック (§7)

| ADR-0045 §3.3 原則 | 本 docs での適用 |
|---|---|
| **atom (terms.ts)**: 単一の用語、1 行修正で全 LP・アプリ本体・法務文書に伝播 | §3 で 3 atom 配置 + §6 step 4 で `PLAN_TERMS.family` → `.premium` 1 行修正で 95 件伝播確認 |
| **compound (labels.ts)**: 複数 atom を文に組み立てた表示文字列、`${PLAN_FULL_TERMS.standard}` 等 template literal で参照、atom 値の文字列リテラル直書き禁止 | §4 で 5 compound 配置 + `check-no-plan-literals.mjs` PASS で直書き 0 件強制 (`§6 step 2 AC`) |
| **LP 側 (`site/shared-labels.js`)**: `generate-lp-labels.mjs` で template literal を解決後、文字列値として配信 (Phase 1 B1 / #1917) | §6 step 5 で再生成、`npm run pre-ready` Step 8 で自動検証 |
| **CSS 3 層トークン (ADR-0042) と同型**: Base (atom) → Semantic (compound) → Component (svelte/html) の責務分離 | §1.1 §1.2 で本構造を継承 |

## 8. Phase 1 補強 2 FR-3 整合性チェック (§8)

[Phase 1 補強 2](phase1-plan-naming-pricing-axis-requirements.md) FR-3 で確定:

> **FR-3: trial = プレミアム固定 7 日 (旧「family 固定」rename のみ)**

本 docs の SSOT 確定:

- **新規 `SUBSCRIPTION_*_TERMS` atom 起票なし**: Phase 1 補強 2 FR-3 + Phase 1 補強 1 「`SUBSCRIPTION_*_TERMS` 新規不要」確定済を本 §3.4 で再確認、§3.1-3.3 で追加する 3 atom (`PLAN_CHANGE_TERMS` / `TOKUSHOHO_TERMS` / `CHECKOUT_SUCCESS_TERMS`) は別領域 (プラン変更 / 特商法 / Checkout 成功) で新規領域 atom
- **既存 `TRIAL_TERMS` (7日間 / カード登録不要) 流用**: Phase 1 補強 2 NFR-1 「atom 1 行修正で 95 件伝播」を §6 step 4 で実現確認

## 9. 大方針整合チェック (§9)

| 大方針 | 整合性 |
|---|---|
| ADR-0010 (Pre-PMF) | ✅ 本 docs は設計書 SSOT 確定のみで、Phase 7 までコード変更 0 件 / 新規 atom 3 種は Phase 3+4 既確定で発明なし / 5 step PR 計画は order 確定のみで各 step Pre-PMF 期間内展開 |
| ADR-0012 (Anti-engagement) | ✅ `PLAN_CHANGE_TERMS` 統合 11 key に「失う / 消える / 使えなくなる」atom を含めない (§2 原則 3) / 子供 UI 配下に本 atom を import しない (Phase 3 #2575 担保) |
| ADR-0013 (LP truth) | ✅ §3.4 既存 atom 流用一覧で LP 文言 = 実装の事実 SSOT 保全 / §6 step 5 で LP 再生成自動化 |
| ADR-0045 (terms.ts 2 階層) | ✅ §7 で全 4 原則整合確認 / atom (3 種) / compound (5 種) の責務分離を §3 / §4 で明示 |
| ADR-0001 (設計書 SSOT) | ✅ 本 docs が Phase 5 グループ C の SSOT、Phase 7 step 1-5 PR は本仕様に準拠 |
| Phase 1 補強 1 (naming-url-integrity) | ✅ `SUBSCRIPTION_*_TERMS` 新規不要 (§8) / `LICENSE_PAGE_LABELS` → `SUBSCRIPTION_PAGE_LABELS` rename を §6 step 3 で SSOT 化 |
| Phase 1 補強 2 (plan-naming-pricing-axis) | ✅ §8 で FR-3 整合確認 / NFR-1 (atom 1 行修正 95 件伝播) を §6 step 4 で実現確認 |
| Phase 3 #2567-2575 設計 | ✅ §3-4 で 6 docs 確定 atom / compound を本 docs 配置 SSOT 化、二重実装回避 |
| Phase 4 #2621/2623/2624 設計 | ✅ §3-4 で 3 docs 確定 atom / compound を本 docs 配置 SSOT 化、二重実装回避 |

## 10. Open question (Adversarial Reviewer 3 軸、PO 判断、Phase 7 で確定) (§10)

| 軸 | 論点 | 推奨案 | 状態 |
|---|---|---|---|
| **business** | `PLAN_CHANGE_TERMS` の alias key (`resumeReady` = `resumeReadyPaid` の alias) を Phase 7 段階撤去するか、永久維持するか。撤去すれば SSOT 1 段集約強化、永久維持なら参照側の選択肢確保 (free / paid の文脈判定を compound 側にカプセル化) | **暫定: 永久維持** (alias 経路を残すことで Phase 7 実装 PR で「文脈判定を compound に書く」cognitive load を下げる、Pre-PMF 段階で SSOT 1 段集約の純粋性より参照側選択肢を優先、ADR-0010 整合)。Phase 7 実装後 3 ヶ月時点で alias 経路の参照件数を実測し、< 10% なら別 Issue で撤去判断 | PO 判断必要 |
| **UX** | Step 4 atom rename PR (`'family'` → `'premium'`) で LP visual regression が diff > 10% 出る確率は? `--update-baseline` で baseline 更新時に、LP 「ファミリー」表記の家庭が「家族向けでなくなった」「対象外になった」と誤認するリスク (Phase 1 補強 2 F9 「兄弟複数 vs 1 人っ子で価値?」整合) | **暫定: `--update-baseline` 実行 + Phase 1 補強 2 §F9 解消の §FR-4 framing 軸 V4 (decoy: premium 最右 + standard 「✓ お勧め」) で 1 人っ子家庭の除外感を回避** (Phase 3 #2567 §文言 atom 確定済 `SUBSCRIPTION_PAGE_LABELS.standardRecommendBadge: '✓ お勧め'` で担保)。Phase 7 SS UX レビュー (3 ペルソナ: 1 人っ子家庭 / 兄弟複数 / 卒業期) で「プレミアム」誤認率を測定 | PO 判断必要 |
| **security** | Step 1 で `TOKUSHOHO_TERMS` 追加時、改正特商法第12条の6第2項「誤認表示禁止」遵守のため、特商法 6 項目見出し / 主要文言が tokushoho.html / Stripe Checkout `custom_text` / `/admin/subscription/confirm` 3 経路で完全一致するか自動検証する CI gate を追加するか (Phase 3 #2573 §法令根拠で確定済要件) | **暫定: 既存 `npm run pre-ready` Step 8 (`generate-lp-labels --check`) で部分担保 + Phase 7 step 5 後に 3 経路一致 grep 検証スクリプト追加 (`scripts/check-tokushoho-consistency.mjs` 新規、Phase 1 #2541 法務統合 PR で実装)**。本 docs では SSOT 配置確定のみ、CI gate 追加は別 PR (Phase 7 別 step) | PO 判断必要 + security 必須 |

## 11. 6 観点 自己検証 (§11、per-issue-execution-workflow SSOT)

| # | 観点 | 本 docs 反映 |
|---|---|---|
| 1 | **着手時 deep-research** | §1 で本プロダクト固有の課題 (8 namespace 分散提案 / `PLAN_CHANGE_TERMS` 衝突 / Phase 7 PR 計画不在) を Phase 3+4 既設計 6 docs Read で再確認、ADR-0045 / Phase 1 補強 1+2 既調査を「Phase 5 atom 配置確定」固有論点で再評価。自プロダクト既存実装 (`terms.ts` / `labels.ts`) を Explore 照合 (feedback_deep_research_product_specific 整合) |
| 2 | **UI SS + アクセシビリティ検証計画** | 本 #2643 は terms.ts / labels.ts 配置確定の docs SSOT で UI 文言追加なし。Phase 3 #2567-2575 + Phase 4 #2621/2623/2624 既設計の SS / a11y を保全 (本 §9 整合性チェックで確認)。Phase 7 step 5 で LP 撮影 SS 4 件目視確認 (§6 step 5 AC) |
| 3 | **UX 変更時のテスト項目追加** | §6 step 1-5 各 AC で unit / vitest / svelte-check / pre-ready 全 step PASS / Storybook 起動確認 / LP 撮影 SS 4 件 を Phase 7 実装時 SSOT として明示 (memory test-coverage-every-issue 整合) |
| 4 | **用語 SSOT (atom)** | §3 atom 3 種 + §4 compound 5 種 + §3.4 既存 atom 流用 9 件 SSOT 確定 / ADR-0045 全 4 原則整合 §7 / Phase 1 補強 2 FR-3 整合 §8 / `check-no-plan-literals.mjs` PASS を §6 step 2 AC で強制 |
| 5 | **影響範囲事後検証** | §5 で impact-analysis 4 layer 適用 (L1: 5 検索 × 既存件数列挙 / L2: 同名異義 3 件チェック / L3: 依存グラフ 4 node / L4: 21 カテゴリ checklist、F-18 i18n / G-19 fixture / E-15 法務 を主要影響として明示) |
| 6 | **目的達成 / 大方針整合** | AC 全件達成 (atom 3 種 配置確定 §3 / compound 5 種 配置確定 §4 / PLAN_CHANGE_TERMS 衝突解消 §2 原則 3 / Phase 7 atom 統合 PR 5 step 計画 §6 / ADR-0045 整合 §7 / Phase 1 補強 2 FR-3 整合 §8) / 個別最適でなく Phase 3+4 全 8 namespace 提案を 1 docs に集約 / 大方針整合 §9 (ADR-0010 / 0012 / 0013 / 0045 + Phase 1 補強 1+2 + Phase 3+4) |

## 12. 根拠 (§12)

- **既存実装 (Explore 照合 2026-05-29)**:
  - `src/lib/domain/terms.ts` 全 878 行 / 29 namespace (PLAN / PLAN_FULL / PRICE / TRIAL / CANCEL / FREE / CTA / LP_FAQ / AGE_RANGE / POINT / CURRENCY / FREE_PLAN / AUTONOMY / ADMIN_VIEW / STRIPE_PORTAL / CHILD / PARENT / SIGNUP / LOGIN / TRIAL_PERIOD / UPGRADE / GRADUATION / ADVENTURE / MECHANISM / LIFESTAGE / CHEER / REWARD / TEMPLATE / CHECKOUT) — §3 配置候補確認
  - `src/lib/domain/labels.ts` 全 8257 行 / 156 compound — §4 配置候補確認 (`LICENSE_PAGE_LABELS` L1633 / `LP_PRICING_LABELS` L4901 / `CHECKOUT_LABELS` L8114 / `BILLING_LABELS` L2184 / `TRIAL_LABELS` L618 主要)
  - 全 8 新規 namespace の既存重複 grep = 0 件 (§タスク 93 確認)
- **deep-research (2026-05-29、自プロダクト固有性)**:
  - ADR-0045 (terms.ts 2 階層原則) の 4 原則を本 docs 配置確定に再適用
  - Phase 1 補強 1+2 既調査を「Phase 5 atom 配置確定」固有論点で再評価 (95 件 atom 経由参照 / `SUBSCRIPTION_*_TERMS` 新規不要)
  - Phase 3+4 docs 9 件 Read で 8 namespace 提案 SSOT 確認 + `PLAN_CHANGE_TERMS` 衝突発見 + 統合 11 key 確定
- **関連 Phase 1+2+3+4 docs**:
  - [phase1-plan-naming-pricing-axis-requirements.md](phase1-plan-naming-pricing-axis-requirements.md) (#2526 補強 2 FR-1 / FR-3 / NFR-1)
  - [phase1-naming-url-integrity-requirements.md](phase1-naming-url-integrity-requirements.md) (#2526 補強 1 `SUBSCRIPTION_*_TERMS` 新規不要確定)
  - [phase3-subscription-page-ui-design.md](phase3-subscription-page-ui-design.md) (#2567 SUBSCRIPTION_PAGE_LABELS 配置 SSOT)
  - [phase3-trial-banner-ui-design.md](phase3-trial-banner-ui-design.md) (#2571 TRIAL_LABELS 拡張)
  - [phase3-checkout-success-polling-ui-design.md](phase3-checkout-success-polling-ui-design.md) (#2572 CHECKOUT_SUCCESS_TERMS / CHECKOUT_SUCCESS_LABELS 配置 SSOT)
  - [phase3-subscription-confirm-tokushoho-ui-design.md](phase3-subscription-confirm-tokushoho-ui-design.md) (#2573 TOKUSHOHO_TERMS / SUBSCRIPTION_CONFIRM_LABELS 配置 SSOT)
  - [phase3-scheduled-downgrade-banner-ui-design.md](phase3-scheduled-downgrade-banner-ui-design.md) (#2574 PLAN_CHANGE_TERMS / SCHEDULED_DOWNGRADE_BANNER_LABELS 配置 SSOT)
  - [phase3-archived-resource-reactivation-ui-design.md](phase3-archived-resource-reactivation-ui-design.md) (#2575 PLAN_CHANGE_TERMS / PLAN_CHANGE_LABELS 配置 SSOT)
  - [phase4-lp-app-flow-design.md](phase4-lp-app-flow-design.md) (#2621 LP_PRICING_LABELS 拡張 SSOT)
  - [phase4-reactivation-flow-design.md](phase4-reactivation-flow-design.md) (#2623 PHASE4_REACTIVATION_FLOW_LABELS 配置 SSOT)
  - [phase4-upgrade-flow-design.md](phase4-upgrade-flow-design.md) (#2624 UPGRADE_FLOW_LABELS 配置 SSOT)
- **ADR**: ADR-0045 (terms.ts 2 階層 = 本 docs の核理論) / ADR-0010 (Pre-PMF、新規 atom 発明禁止根拠) / ADR-0012 (Anti-engagement、「失う / 消える」atom 含めない) / ADR-0013 (LP truth、§3.4 既存 atom 流用) / ADR-0042 (CSS 3 層トークン、同型責務分離パターン) / ADR-0049 (retention 90 日、`protectedFree` / `resumeReadyFree` variant 根拠) / ADR-0014 (OSS 先調査、本 docs では新規 OSS 採用なし)
- **skill**: `impact-analysis` (§5 で 4 layer + 21 カテゴリ checklist 適用) / `regression-check` (Phase 3+4 既設計 + 本 atom 配置確定の整合 §9)
- **関連 memory**: per-issue-execution-workflow / impact-analysis-methodology / design-intent-grounding / test-coverage-every-issue / deep-research-product-specific / branch-base-main-freshness / pr-body-encoding-powershell-stdin / pr-review-recurring-blocks / ssot_verification_before_proposal / plan_name_implementation_gap
