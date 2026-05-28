# `/admin/subscription/confirm` 特商法最終確認画面 UI 設計 (Phase 3 #2573)

| 項目 | 内容 |
|------|------|
| 孫 issue | #2573 (Phase 3 子、特商法 6 項目 最終確認画面 + 同意取得 UI 設計) |
| 親 | #2528 (Phase 3 UI) / Epic #2525 |
| Phase 1+2 整合 | Phase 1 #2541 法務 (FR-L1〜L7) / Phase 1 #2534 checkout (FR-1〜FR-8) / Phase 1 #2588 plan naming-pricing-axis (月額のみ確定) / Phase 2 #2548 checkout journey (谷⑤特商法最終確認) |
| Phase 7 rename 方針 | `/admin/subscription/confirm` (新 URL、本画面の rename は無し、Phase 7 初出) / `family` → `プレミアム` (atom 1 行、Phase 1 #2588) |
| 上位 #2567 採用案 C 整合 | 4 ページ分割の機能 3, 8 (proration 差額表示 + 特商法 6 項目) を本画面に分離。`SaasSubscriptionPanel.svelte` (旧 `SaasLicensePanel`) からの遷移先 |
| 作業姿勢 (#2525 critical) | 法令適合性最優先 / 全文言に設計意図 + 法的根拠 / Stripe vs 自社判断は deep-research primary source で裏付け / 個別法律解釈は法務確認必須 |
| deep-research | (1) Stripe Checkout `custom_text` API 仕様 (4 field × 1200 文字 Markdown) / (2) JP 改正特商法第12条の6 6 項目 + 同意取得方法 / (3) Stripe Japan 公式特商法対応ガイド + Qiita 実装事例 / (4) Stripe 標準機能の限界 (定期購入各回代金 / 動的 proration / 解約手続詳細) |

> **法務確認指示 (PR レビューで必須)**: 本画面の文言・同意取得方法・項目数 (5 vs 6) は最終的に **PO + 法律専門家** の確認を取った上で確定する。本設計書は deep-research primary source に基づく **暫定設計** であり、Phase 7 実装着手前に法務 review round を 1 回挟むこと (Phase 1 #2541 FR-L1 同様の取扱い)。

---

## 1. 設計背景

### 1.1 なぜこの画面が必要か

- **JP 改正特商法 (令和3年改正、令和4年6月施行) 第12条の6** が、通信販売の最終確認画面で **6 項目 (定期購入時)** の明示表示を事業者に義務付け
- 違反は **行政処分 (指示・業務停止命令)** + **消費者契約取消可能性 (消費者契約法第4条1項、誤認表示の場合)** の二重リスク
- Stripe Checkout `custom_text` (4 field × 1200 文字) は**部分カバーのみ**で、以下を満たせない:
  - **定期購入の各回代金** (改正法第12条の6第1項第2号、定期購入特則)
  - **動的 proration 差額表示** (プラン変更時)
  - **解約手続詳細** (Customer Portal 動線への明示誘導)
  - **6 項目の網羅的 1 画面表示** (消費者庁ガイドライン「網羅的表示望ましい」)

### 1.2 何が困るか (この設計がなかった場合)

| 想定リスク | 影響 |
|---|---|
| 改正特商法 6 項目未表示 | 行政処分 + サブスク誤認購入クレーム |
| 「すべての機能」誤認表示 | 景品表示法 5 条 1 号 (優良誤認) — 消費者庁「動画見放題プラン」措置命令事例 |
| 解約方法不明確 | 消費者契約法第10条 (不当条項)、cancellation 動線が「電話のみ」等不可 |
| Stripe Checkout 単体運用 | 各回代金・proration 差額表示不可、誤認表示リスク継承 |

### 1.3 Phase 1 SSOT との整合 (5 vs 6 項目)

Phase 1 #2541 では「FR-L1: 最終確認画面で **5 項目**」と記載されているが、本画面は **6 項目** を採用する。差異の根拠:

- 改正特商法第12条の6 第1項は **5 号** (①分量 / ②販売価格 / ③支払時期・方法 / ④引渡時期 / ⑤申込撤回・解除) が **必須**
- **第6号 (申込期間の定め)** は「定めがあるとき」のみ表示 (条件付き表示)
- **定期購入特則** (各回代金 / 次回発送時期) は ②③④ の中に含まれるため数として独立しないが、UI 上は **「自動更新の明示」を独立項目として配置**することで `Phase 2 #2548` の「自動更新?」不安解消を強化
- 結論: **法定 5 項目 (①-⑤) + 自動更新明示 (③の subset を独立配置) = 視覚的に 6 ブロック**。Phase 1 SSOT の「5 項目」は**法的最低要件**、本画面の「6 項目」は**UI 表示粒度**。両者は矛盾しない (Phase 1 を Phase 7 実装時に補強)

---

## 2. 設計原則

### 2.1 設計判断: Stripe `custom_text` vs 自社確認画面 (deep-research 結論)

**採用案: ハイブリッド方式 (自社 `/admin/subscription/confirm` を主、Stripe Checkout `custom_text` を補)**

| 観点 | Stripe `custom_text` 単体 | 自社確認画面単体 | **ハイブリッド (採用)** |
|---|---|---|---|
| 6 項目網羅 | △ submit (1200 文字) で詰め込み可だが視認性低 | ✅ 6 ブロック構造化可 | ✅ 自社で網羅、Stripe は補強 |
| 各回代金 (定期購入特則) | ❌ 静的文字列、proration 動的表示不可 | ✅ サーバ側で `subscriptions.update preview` を呼び出し動的表示 | ✅ 自社で動的表示 |
| 動的 proration 差額 | ❌ 不可 | ✅ 可 | ✅ 可 |
| 解約方法明示 | △ after_submit に Markdown link | ✅ Portal 動線 + 解約手順 3 step UI | ✅ 両方併記 |
| 同意取得 | △ `terms_of_service_acceptance` 必須チェックボックス | ✅ 自社チェックボックス + 「確認しました」ボタン | ✅ 自社で確認 + Stripe で再度規約同意 |
| 法的確実性 | △ 「リンク参照方式」は推奨されない (消費者庁ガイドライン) | ✅ 網羅的 1 画面表示で「望ましい」整合 | ✅ 最高 |
| 実装コスト (Pre-PMF) | 低 (既存 custom_text 拡張のみ) | 中 (画面 1 つ追加) | 中 (主に画面 1 つ) |

**判断根拠**:

1. **消費者庁ガイドライン** (`https://www.no-trouble.caa.go.jp/pdf/20220601la02_07.pdf`) は「最終確認画面に必要事項を **網羅的に表示**することが望ましい」と明言。Stripe Checkout の汎用 UI に詰め込むより、自社で **6 ブロック構造化** する方が確実
2. **定期購入特則** (改正法第12条の6第1項第2号) の **2 回目以降の代金 / 各回の請求時期** は **動的計算が必要**なため Stripe 標準 (静的文字列) で不可
3. **Stripe Japan 公式 Help** (`https://support.stripe.com/.../guidelines-under-the-revised-specified-commercial-transactions-act-to-be-enforced-in-june-2022`) も「事業者側で実装する必要がある項目」を明示しており、Stripe 単体運用は推奨されない
4. 既に `stripe-service.ts:74-81` で `custom_text.submit` / `custom_text.after_submit` を使用中なので、**両者を併用する追加コストは画面 1 つ分のみ**
5. Pre-PMF 過剰防衛 (ADR-0010) でなく、**法令必須 = Bucket A** に該当 (memory: feedback_billing_critical_extra_caution / feedback_adr0010_interpretation)

### 2.2 ADR 整合

| ADR | 観点 | 適合性 |
|---|---|---|
| ADR-0012 (Anti-engagement) | 滞在時間延伸 / 煽り | ✅ 1 画面で完結、countdown timer 不採用、確認 → Stripe Checkout への即時遷移 |
| ADR-0013 (LP truth) | 実装の事実が SSOT | ✅ 表示する 6 項目 = `tokushoho.html` / Phase 1 #2541 / Stripe `custom_text` と完全一致 (3 経路 SSOT 整合) |
| ADR-0045 (terms.ts 2 階層) | atom / compound 責務分離 | ✅ 新規 `TOKUSHOHO_TERMS` atom (terms.ts) + `SUBSCRIPTION_CONFIRM_LABELS` compound (labels.ts) を追加 (`§4` 参照) |
| ADR-0050 (Parent-Gate session cookie) | 子供 UI 課金圧排除 | ✅ `/admin/*` 配下のため Parent-Gate 通過後のみ表示 |

---

## 3. UI 画面構成

### 3.1 mermaid 図 1: 画面遷移 (Phase 2 #2548 谷⑤特商法最終確認 と整合)

```mermaid
flowchart TB
    Sub[/admin/subscription<br/>プラン選択 #2567]
    Sub -->|プレミアムにする CTA| Confirm[/admin/subscription/confirm<br/>本画面 #2573]
    Confirm -->|6 項目確認 + チェック + 同意ボタン| Stripe[Stripe Checkout<br/>カード入力 + 再度規約同意]
    Stripe -->|決済完了| Success[/admin/subscription/success<br/>processing gap polling #2572]
    Success -->|webhook 権限付与| Activated[プレミアム機能解放]
    Confirm -.「やめる」.->Sub
    style Confirm fill:#fff3e0
    style Stripe fill:#e3f2fd
    style Activated fill:#d4edda
```

### 3.2 6 ブロック構造 (法定 5 項目 + 自動更新明示)

```
┌─────────────────────────────────────────────────────────────┐
│ お申し込み内容のご確認                                       │  ← page title (h1)
│ ご家族のプランを「プレミアム」に変更します                   │  ← subtitle
└─────────────────────────────────────────────────────────────┘

┌─[① 分量 + ② 販売価格]─────────────────────────────────────┐
│ プラン: プレミアムプラン (月額契約)                        │
│ 月額料金: ¥780 (税込)                                       │
│ お子さま登録数: 無制限                                      │
│ 活動登録数: 無制限                                          │
│ 月次レポート / ご家族メッセージ / 人生記録レベル機能つき    │
└────────────────────────────────────────────────────────────┘

┌─[③ 支払時期・方法]─────────────────────────────────────────┐
│ 初回請求: 本日 (2026/05/28)                                │
│ 支払方法: クレジットカード (Stripe 決済)                   │
│ 受け付けカード: Visa / Mastercard / JCB / American Express │
└────────────────────────────────────────────────────────────┘

┌─[④ 引渡時期・自動更新]─────────────────────────────────────┐
│ ご利用開始: 決済完了後すぐ                                  │
│ 次回更新: 2026/06/28 (毎月 28 日、自動更新)                 │
│ 自動更新を停止しない限り、月額 ¥780 (税込) が毎月課金されます │
└────────────────────────────────────────────────────────────┘

┌─[⑤ 申込撤回・解約方法]─────────────────────────────────────┐
│ いつでも解約できます (契約期間の縛りなし)                  │
│ 解約方法: 「ご家族の見守り画面」→「ご請求情報」から、または │
│         Stripe の請求管理ページから手続き                  │
│ 解約後: 現在の請求期間終了まで引き続きご利用いただけます   │
│         日割り計算による返金は行いません                    │
└────────────────────────────────────────────────────────────┘

┌─[⑥ 重要事項・誤認防止]─────────────────────────────────────┐
│ ・本お申し込みは、月額自動更新のサブスクリプション契約です   │
│ ・カード情報はStripeで安全に保管されます (当社では保存しません) │
│ ・表示価格以外の追加料金は一切ありません                    │
│ ・詳細は <a href="/tokushoho">特定商取引法に基づく表記</a> /  │
│   <a href="/terms">利用規約</a> / <a href="/privacy">プライバシーポリシー</a> をご確認ください │
└────────────────────────────────────────────────────────────┘

[ ] 上記内容を確認し、お申し込みに同意します  ← チェックボックス (必須)
[「やめる」]  [「上記内容で申し込む」(disabled until checked)]
```

### 3.3 proration 差額表示 (機能 3、SaaS 既存契約者の plan-change 用)

```
┌─[本日の請求]──────────────────────────────────────────────┐
│ プレミアムプラン 月額                  ¥780 (税込)         │
│ ─ スタンダードプラン日割り戻入        −¥250 (税込)         │
│ ─────────────────────────────────────                      │
│ 本日のお支払い差額                    ¥530 (税込)         │
│ 次回 (2026/06/28) より              ¥780 (税込) /月       │
└────────────────────────────────────────────────────────────┘
```

実装: `subscriptions.update preview` API (`stripe-service.ts` 新規追加) で差額計算、サーバ側 `+page.server.ts` の `load` で取得して props 注入。

---

## 4. 文言 atom (terms.ts / labels.ts、ADR-0045 整合)

### 4.1 新規 atom (`TOKUSHOHO_TERMS`、terms.ts)

特商法 6 項目は **法務文書 (tokushoho.html) / Stripe Checkout `custom_text` / 本画面** の 3 経路で**同一文言**を維持する必要があり、SSOT 化が必須。

```ts
// src/lib/domain/terms.ts 新規追加 (ADR-0045 atom 責務)
//
// 設計意図: 特商法第12条の6 6 項目の見出し / 主要文言を atom 化。
// terms.ts 1 行修正で tokushoho.html / Stripe custom_text / 本画面 3 経路に伝播。
//
// 法的根拠:
//   - 改正特商法 (令和3年改正) 第12条の6 第1項各号
//   - 消費者庁「通信販売の申込み段階における表示についてのガイドライン」(令和4年6月)
//   - 景品表示法第5条1号 (優良誤認、CHECKOUT_TERMS と相補)
//
// 既存 atom との関係:
//   - PRICE_TERMS — 価格本体 (¥500 / ¥780 / ¥0 / 税込) は既存
//   - TRIAL_TERMS — 7 日間 / カード登録不要は既存
//   - CANCEL_TERMS — 解約 (いつでも解約) は既存
//   - CHECKOUT_TERMS — 「お選びのプランの機能」(景品表示法対応) は既存
//   - TOKUSHOHO_TERMS — 本 atom、特商法 6 項目の見出し / 補足文言
export const TOKUSHOHO_TERMS = {
	// 6 ブロック見出し
	heading1Quantity: '分量',
	heading2Price: '販売価格',
	heading3Payment: '支払時期・方法',
	heading4Delivery: '引渡時期・自動更新',
	heading5Cancel: '申込撤回・解約方法',
	heading6Important: '重要事項',
	// 重要事項補足
	subscriptionType: '月額自動更新のサブスクリプション契約',
	pciNote: 'カード情報はStripeで安全に保管されます（当社では保存しません）',
	noAdditionalFee: '表示価格以外の追加料金は一切ありません',
	// 解約方法 (Customer Portal 動線)
	cancelMethodFull: '「ご家族の見守り画面」→「ご請求情報」から、または Stripe の請求管理ページから手続き',
	cancelAfterPolicy: '解約後は現在の請求期間終了まで引き続きご利用いただけます。日割り計算による返金は行いません。',
	// 同意取得文言 (法的に「申込完了意思の明確化」が必要 — 第12条の6第2項誤認防止)
	consentLabel: '上記内容を確認し、お申し込みに同意します',
	confirmButtonLabel: '上記内容で申し込む',
	cancelButtonLabel: 'やめる',
	// 自動更新明示 (第12条の6第1項第2号 定期購入特則)
	autoRenewalNotice: '自動更新を停止しない限り、月額が毎月課金されます',
	noProrationRefund: '日割り計算による返金は行いません',
} as const;
```

### 4.2 新規 compound (`SUBSCRIPTION_CONFIRM_LABELS`、labels.ts)

```ts
// src/lib/domain/labels.ts 新規追加 (ADR-0045 compound 責務)
//
// terms.ts atom の組合せで本画面の表示文字列を構成。
// atom 値の文字列リテラル直書きは禁止 (ADR-0045 §3.3)。
export const SUBSCRIPTION_CONFIRM_LABELS = {
	pageTitle: 'お申し込み内容のご確認',
	pageSubtitlePremium: `ご家族のプランを「${PLAN_TERMS.family}」に変更します`,
	// ① 分量 + ② 販売価格
	planLabel: 'プラン',
	monthlyPriceLabel: '月額料金',
	childrenLimitLabel: 'お子さま登録数',
	activitiesLimitLabel: '活動登録数',
	unlimitedValue: `${NUC_EDITION_TERMS.unlimited}`,
	// ③ 支払時期
	firstChargeLabel: '初回請求',
	paymentMethodLabel: '支払方法',
	paymentMethodValue: 'クレジットカード（Stripe 決済）',
	acceptedCardsLabel: '受け付けカード',
	acceptedCardsValue: 'Visa / Mastercard / JCB / American Express',
	// ④ 引渡 + 自動更新
	startUsingLabel: 'ご利用開始',
	startUsingValue: '決済完了後すぐ',
	nextChargeLabel: '次回更新',
	autoRenewalNoticePremium: `自動更新を停止しない限り、月額 ${PRICE_TERMS.family} ${PRICE_TERMS.taxNote}が毎月課金されます`,
	autoRenewalNoticeStandard: `自動更新を停止しない限り、月額 ${PRICE_TERMS.standard} ${PRICE_TERMS.taxNote}が毎月課金されます`,
	// ⑤ 申込撤回・解約
	cancelHeading: TOKUSHOHO_TERMS.heading5Cancel,
	cancelAnytime: CANCEL_TERMS.anytimeOk,
	cancelMethodFull: TOKUSHOHO_TERMS.cancelMethodFull,
	cancelAfterPolicy: TOKUSHOHO_TERMS.cancelAfterPolicy,
	// ⑥ 重要事項
	importantHeading: TOKUSHOHO_TERMS.heading6Important,
	subscriptionTypeNote: `本お申し込みは、${TOKUSHOHO_TERMS.subscriptionType}です`,
	pciNote: TOKUSHOHO_TERMS.pciNote,
	noAdditionalFeeNote: TOKUSHOHO_TERMS.noAdditionalFee,
	legalLinksText: '詳細は特定商取引法に基づく表記 / 利用規約 / プライバシーポリシーをご確認ください',
	// proration 差額表示 (plan-change 経路、機能 3)
	prorationHeading: '本日の請求',
	prorationCurrentPlanRefund: '日割り戻入',
	prorationDiffLabel: '本日のお支払い差額',
	prorationNextChargeLabel: '次回より',
	// 同意 + ボタン
	consentLabel: TOKUSHOHO_TERMS.consentLabel,
	confirmButtonLabel: TOKUSHOHO_TERMS.confirmButtonLabel,
	cancelButtonLabel: TOKUSHOHO_TERMS.cancelButtonLabel,
	// 誤認防止: 申込完了意思の明確化 (第12条の6第2項)
	disabledTooltip: '上記内容を確認のうえチェックしてください',
} as const;
```

### 4.3 既存 atom 流用 (新規不要)

- `PLAN_TERMS.standard` / `.family` (Phase 7 で `.family` → `.premium` rename)
- `PRICE_TERMS.standard` / `.family` / `.taxNote`
- `CANCEL_TERMS.anytimeOk`
- `CHECKOUT_TERMS.chosenPlanFeature` (Stripe `custom_text` 側、本画面では不要)
- `STRIPE_PORTAL_TERMS.canonical` / `.short`

---

## 5. a11y 設計 (screen reader / コントラスト)

### 5.1 セマンティック構造

- 全体: `<main aria-labelledby="confirm-title">`
- 6 ブロックは `<section aria-labelledby="block{N}-heading">` で構造化、各 `<h2>` で見出し階層を明示
- proration 差額表示 (`<table>` または `<dl>`) は screen reader で各行が「項目名 + 値」のペアで読み上げ可能に
- 同意 checkbox: `<input type="checkbox" id="consent" required aria-describedby="consent-help">`
- 「申し込む」button: `disabled={!consented}` + `aria-disabled` + `aria-describedby="consent-help"` で disable 理由を読み上げ

### 5.2 コントラスト

- 全テキスト: `var(--color-text-primary)` (#171717) on `var(--color-surface-card)` (white) = WCAG AAA (16.4:1)
- 注意事項 (誤認防止): `var(--color-text-warm)` (#92400e) on `var(--color-surface-warm)` (#fef3c7) = WCAG AA (5.3:1)
- 「やめる」button: `var(--color-action-ghost)` で透明背景、disabled 状態と区別
- 「申し込む」button: `var(--color-action-primary)` でブランド青、disabled 時は `var(--color-text-disabled)` + opacity 0.5

### 5.3 keyboard 操作

- tab 順序: ① h1 → ② 6 ブロックの本文 → ③ checkbox → ④ 「やめる」 → ⑤ 「申し込む」
- Enter で checkbox toggle、Space で button activate (標準挙動維持)
- focus ring は `var(--color-border-focus)` (2px outline)
- ESC で「やめる」相当 (Phase 7 実装、現状は明示的 button 操作のみ)

---

## 6. Storybook stories 設計

```typescript
// SubscriptionConfirmPage.stories.svelte (Phase 7 実装)
- FreeToPremium       // 無料 → プレミアム 新規 (proration なし、6 ブロックのみ)
- FreeToStandard      // 無料 → スタンダード 新規 (6 ブロック、価格 ¥500)
- StandardToPremium   // スタンダード → プレミアム (proration 差額表示 + 6 ブロック)
- PremiumToStandard   // プレミアム → スタンダード (downgrade、proration 戻入表示 + #2575 DowngradeResourceSelector 統合事前確認)
- ConsentChecked      // チェック済 (「申し込む」 button enabled、focus ring)
- ConsentUnchecked    // チェック未済 (「申し込む」 button disabled、tooltip 表示)
```

---

## 7. Playwright SS + E2E テスト計画

### 7.1 SS 取得 (memory test-coverage-every-issue 整合)

| 変数 | URL | 状態 | 用途 |
|---|---|---|---|
| `confirm-free-to-premium` | `/admin/subscription/confirm?plan=premium` | 無料 → プレミアム | 6 ブロック網羅 (PC + mobile 2 viewport) |
| `confirm-free-to-standard` | `/admin/subscription/confirm?plan=standard` | 無料 → スタンダード | 6 ブロック (価格 ¥500) |
| `confirm-standard-to-premium` | `/admin/subscription/confirm?plan=premium` (Standard 加入者) | proration 差額表示 | 機能 3 動的計算 |
| `confirm-consent-checked` | 同上 | 同意済 | button enabled 状態 |

### 7.2 E2E 結合テスト (`tests/e2e/subscription-confirm.spec.ts`)

```typescript
// 必須 6 シナリオ
test('特商法 6 項目すべて表示', async ({ page }) => {
  // 6 ブロック (h2 見出し 6 個) の存在 + 各 atom 文言の visible 検証
});

test('同意 checkbox 未チェックで「申し込む」disabled', async ({ page }) => {
  await expect(page.getByRole('button', { name: '上記内容で申し込む' })).toBeDisabled();
});

test('同意 checkbox チェックで「申し込む」enabled', async ({ page }) => {
  await page.getByRole('checkbox', { name: '上記内容を確認し、お申し込みに同意します' }).check();
  await expect(page.getByRole('button', { name: '上記内容で申し込む' })).toBeEnabled();
});

test('「申し込む」クリックで Stripe Checkout へ遷移', async ({ page }) => {
  // mock + URL assertion
});

test('plan-change (standard→premium) で proration 差額表示', async ({ page }) => {
  // subscriptions.update preview API mock + 差額表示 ¥530 等
});

test('「やめる」で /admin/subscription に戻る', async ({ page }) => {
  // navigation assertion
});
```

### 7.3 a11y 自動検証

- `@axe-core/playwright` で WCAG 2.1 AA 全自動チェック (既存 `tests/e2e/a11y/` 配下に追加)
- screen reader 手動検証 (VoiceOver / NVDA) は Phase 7 PR レビューで 1 回実施

### 7.4 UX レビュー (3 ペルソナ、Phase 7 PR で実施)

1. **慎重派 (FUD 高)**: 6 項目すべて読了 + 「自動更新を停止しない限り」「日割り返金なし」を不安なく理解できるか
2. **即決派 (FUD 低)**: スクロール最下部の「申し込む」まで 5 秒以内で到達できるか (Anti-engagement: 滞在強要しない)
3. **法務確認**: 改正特商法第12条の6 6 項目すべての必要事項が網羅されているか + 誤認表示禁止 (第2項) 違反がないか

---

## 8. impact-analysis 4 layer 防御

### L1 構文 (ast-grep / ripgrep) — 事後検証 PR 時に実施

- `tokushoho.html` の表記文言と本画面の文言一致 (Phase 7 実装で `data-lp-key` 経由参照)
- `CHECKOUT_TERMS.chosenPlanFeature` の Stripe `custom_text` 参照 (`stripe-service.ts:76`) と本画面 ⑥ 重要事項の整合
- `TOKUSHOHO_TERMS` atom 新規追加箇所と `tokushoho.html` 表記の文言一致 (`scripts/generate-lp-labels.mjs --check`)

### L2 意味 (型 / 同名異義)

- `PLAN_TERMS.family` (= 「ファミリー」、Phase 7 で → `.premium`) vs 内部 enum `'family'` / DB `plan_tier='family'` の区別 — Phase 1 #2588 FR-5 で明文化済
- proration 差額表示の通貨単位 (`PRICE_TERMS.taxNote` 適用範囲) — 本画面 ¥ 表示すべて税込

### L3 構造 (依存グラフ)

- 新規 route `/admin/subscription/confirm/+page.svelte` + `+page.server.ts` (load 関数で `subscriptions.update preview` 呼び出し)
- `stripe-service.ts` に `previewSubscriptionChange()` 関数を新規追加 (proration 計算)
- `SaasSubscriptionPanel.svelte` (Phase 7 rename) の「プレミアムにする」CTA → 本画面遷移 (現状の Stripe Checkout 直遷移を 1 段階噛ませる変更)

### L4 派生 artifact 21 カテゴリ (本 #2573 docs PR は該当なし、Phase 7 実装 PR で適用)

| カテゴリ | 影響 (Phase 7 実装時) |
|---|---|
| A. 法務文書 | `tokushoho.html` の 6 項目見出し / 文言を `TOKUSHOHO_TERMS` 参照に変更 (terms.ts 経由 SSOT 化) |
| B. Stripe 連携 | `stripe-service.ts:74-81` `custom_text` 現状維持 + 新規 `previewSubscriptionChange()` 追加 |
| C. 認可 / Parent-Gate | `/admin/*` 配下のため既存 Parent-Gate (ADR-0050) で保護済 |
| D. E2E / Playwright | `tests/e2e/subscription-confirm.spec.ts` 新規 (§7.2 6 シナリオ) |
| E. Storybook | `SubscriptionConfirmPage.stories.svelte` 新規 (§6 6 variant) |
| F. labels.ts | `SUBSCRIPTION_CONFIRM_LABELS` 新規 + `TOKUSHOHO_TERMS` atom 新規 (terms.ts) |
| G. generate-lp-labels | `npm run pre-ready` Step 8 で TOKUSHOHO_TERMS の LP 反映チェック |
| H. legacy-url-map | 本画面は新 URL のため不要、`/admin/subscription/confirm` 永続 URL |
| I-U (その他 11) | docs / scripts / CI / 通知 / monitoring 等は Phase 7 個別判断 |

---

## 9. 大方針整合チェック (作業姿勢、#2525 critical case)

### 9.1 目的達成

| 目的 (Issue #2573) | 達成方法 |
|---|---|
| 特商法 6 項目表示 | §3.2 6 ブロック構造 + §4 atom SSOT |
| 同意取得 | §3.2 checkbox + button disable + §5 a11y |
| Stripe Checkout 遷移 | §3.1 mermaid 遷移図 + §2.1 ハイブリッド判断 |

### 9.2 premium 階層 signal 打消 (refs #2594 D-2)

本画面はサブスク開設の最終段階のため `premium` 階層 signal を**さらに打消す必要はない** (LP / プラン選択で打消済、Phase 4 移行 gate 確認)。ただし以下を維持:

- 「ご家族のプランを『プレミアム』に変更します」(subtitle) で **無料からの能動的選択** を明示
- `CHECKOUT_TERMS.chosenPlanFeature` (= 「お選びのプランの機能」) で 「すべての機能」誤認を排除

### 9.3 ADR 適合性総括

| ADR | 適合 |
|---|---|
| ADR-0010 (Pre-PMF) | ✅ Bucket A (法令必須)、過剰防衛なし |
| ADR-0012 (Anti-engagement) | ✅ countdown timer / modal interrupt / 連続演出すべて不採用 |
| ADR-0013 (LP truth) | ✅ tokushoho.html / Stripe custom_text / 本画面 3 経路で SSOT 整合 |
| ADR-0045 (terms.ts 2 階層) | ✅ TOKUSHOHO_TERMS atom + SUBSCRIPTION_CONFIRM_LABELS compound 分離 |
| ADR-0050 (Parent-Gate) | ✅ /admin/* 配下、子供 UI に課金圧表示なし |
| ADR-0051 (NUC-SaaS Bifurcation) | ✅ NUC 環境では本画面非表示 (Edition badge 経路) |

---

## 10. Phase 7 実装手順 (本 #2573 は docs のみ、実装は Phase 7)

1. `terms.ts` に `TOKUSHOHO_TERMS` atom 追加 (§4.1)
2. `labels.ts` に `SUBSCRIPTION_CONFIRM_LABELS` compound 追加 (§4.2)
3. `tokushoho.html` の 6 項目表記を `data-lp-key` 経由 `TOKUSHOHO_TERMS` 参照に SSOT 化 (Phase 1 #2541 と統合)
4. `src/routes/(parent)/admin/subscription/confirm/+page.server.ts` 新規 (load で `previewSubscriptionChange()` 呼出)
5. `src/routes/(parent)/admin/subscription/confirm/+page.svelte` 新規 (§3.2 6 ブロック + §5 a11y)
6. `stripe-service.ts` に `previewSubscriptionChange()` 関数追加
7. `SaasSubscriptionPanel.svelte` の「プレミアムにする」CTA を `/admin/subscription/confirm` 遷移に変更
8. Storybook 6 variant 追加 (§6)
9. Playwright E2E 6 シナリオ追加 (§7.2)
10. impact-analysis 4 layer 防御 + 21 カテゴリ checklist を Phase 7 PR body に記載
11. **法務 review round (Phase 7 PR Ready 前必須)** — 改正特商法第12条の6 全項目適合 + 誤認表示禁止違反なし
12. UX レビュー 3 ペルソナ (§7.4) + a11y 手動検証 (VoiceOver / NVDA)

---

## 11. Open question (PO 判断、Phase 7 実装時に確認)

| # | 論点 | 状態 |
|---|---|---|
| 1 | Phase 1 SSOT「5 項目」と本画面「6 ブロック」差異の Phase 1 補強記載 (Phase 7 着手前に Phase 1 #2541 補強 PR) | 推奨、要 PO 判断 |
| 2 | 同意 checkbox 文言「上記内容を確認し、お申し込みに同意します」の法務確認 (誤認表示禁止違反性) | **法務 review 必須** |
| 3 | proration 差額表示の小数点処理 (¥530 表示時の rounding 規則) | Phase 7 実装時、Stripe 側 cents 単位整合確認 |
| 4 | NUC 環境 (`/admin/subscription/confirm` 非表示) の代替動線 | ADR-0051 整合、別 issue で扱う |
| 5 | scope 外: 年額プラン (Phase 1 #2588 で月額のみ確定済) — 将来年額追加時は本画面の「次回更新」表記を「次回 (毎年)」に拡張 | 不要 (月額のみ確定) |
| 6 | proration 戻入が ¥0 になるエッジケース (即時 upgrade) の表示 | Phase 7 実装時 |

---

## 12. 根拠 (primary source、deep-research 2026-05-28)

### 12.1 法令 + ガイドライン

- 改正特商法 (令和3年改正) 第12条の6 第1項各号 + 第2項 (誤認表示禁止)
- 消費者庁「通信販売の申込み段階における表示についてのガイドライン」(令和4年6月) `https://www.no-trouble.caa.go.jp/pdf/20220601la02_07.pdf`
- 消費者契約法第4条1項 (誤認による契約取消) / 第10条 (不当条項)
- 景品表示法第5条1号 (優良誤認、CHECKOUT_TERMS との連携)
- 弁護士坂生雄一「最終確認画面に必要な6項目」`https://bengoshi-sakao.com/column/...` (改正法解説)
- クラウドサイン「特商法改正 サブスク規制」`https://www.cloudsign.jp/media/20210422-tokusyouhou2021kaisei/`

### 12.2 Stripe 公式 + 業界実装

- Stripe Checkout `custom_text` API 仕様 `https://docs.stripe.com/payments/checkout/customization/policies` (4 field × 1200 文字 Markdown)
- Stripe Japan 公式 Help「改正特商法 2022 ガイドライン」`https://support.stripe.com/questions/guidelines-under-the-revised-specified-commercial-transactions-act-to-be-enforced-in-june-2022`
- Stripe API Reference Create Session `https://docs.stripe.com/api/checkout/sessions/create`
- Stripe Resources「Notation based on Japan's Act on Specified Commercial Transactions」`https://stripe.com/resources/more/specified-commercial-transactions-act-japan`
- Qiita 実装事例「2022 年 6 月施行の改正特商法に対応するための、Stripe Checkout / Payment Links 設定ガイド」`https://qiita.com/hideokamoto/items/9ca5845a4f68dae808fd`

### 12.3 既存実装 (Explore 照合 2026-05-28)

- `site/tokushoho.html` (現特商法表記、12 項目テーブル)
- `src/lib/server/services/stripe-service.ts:43-114` (createCheckoutSession + custom_text submit/after_submit)
- `src/lib/domain/terms.ts:700-725` (CHECKOUT_TERMS atom、景品表示法対応)
- `src/lib/domain/labels.ts:8088-8178` (LP_LEGAL_TOKUSHOHO_LABELS SSOT、ADR-0025 経由 LP 注入)
- `docs/design/billing-redesign/phase1-legal-requirements.md` (Phase 1 #2541 FR-L1〜L7)
- `docs/design/billing-redesign/phase1-checkout-requirements.md` (Phase 1 #2534 FR-1〜FR-8)
- `docs/design/billing-redesign/phase2-checkout-journey.md` (Phase 2 #2548 谷⑤特商法最終確認)
- `docs/design/billing-redesign/phase3-subscription-page-ui-design.md` (Phase 3 #2567、本 #2573 起票根拠)

### 12.4 ADR + memory

- ADR-0010 (Pre-PMF scope、Bucket A 法令必須)
- ADR-0012 (Anti-engagement)
- ADR-0013 (LP truth、tokushoho.html / Stripe / 本画面 3 経路 SSOT)
- ADR-0045 (terms.ts 2 階層、TOKUSHOHO_TERMS / SUBSCRIPTION_CONFIRM_LABELS 責務分離)
- ADR-0050 (Parent-Gate session cookie)
- ADR-0051 (NUC-SaaS Bifurcation)
- skill `impact-analysis` (4 layer 防御 + 21 カテゴリ checklist)
- 関連 memory: feedback_billing_critical_extra_caution / feedback_adr0010_interpretation / feedback_scope_customer_experience_layer / feedback_design_intent_grounding / feedback_test_coverage_every_issue / feedback_deep_research_product_specific
