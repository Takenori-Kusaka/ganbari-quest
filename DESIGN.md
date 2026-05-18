# DESIGN.md — がんばりクエスト デザインシステム SSOT

> **AI エージェントへ**: 新規画面・コンポーネントを作成する前に、このファイルを最初に読んでください。
> ここに記載されたルール・トークン・コンポーネントが実装の基準です。
> この文書は、ブランドからコンポーネント、レイアウトへと段階的に構造化されています。上位レイヤーの文脈を下位レイヤーの実装へ引き継いでください。

---

## 1. ブランド・プロダクトの核 (Brand Identity)

- **ターゲット**: 3-15歳の子供 × 保護者
- **トーン**: 明るい・温かい・親しみやすい・冒険的
- **テーマ**: RPG / 冒険（ポイント、レベル、クエスト）
- **対象年齢ごとのスタイル**: 幼児向けは丸く大きく、中高生向けはシャープで情報密度を上げる
- **Anti-engagement 原則 ([ADR-0012](docs/decisions/0012-anti-engagement-principle.md))**: 子供側 UI の滞在時間は価値毀損指標。「記録する → 数秒で閉じる」最短経路を設計原則とし、連続ガチャ / インフィニットスクロール / 通知連打 / 自動再生 / サプライズ濫用は不採用。販促文言も同じ審査対象
- **年齢帯別 UI（4 コアモード + 準備モード）**:
  - コアターゲット: **3〜18 歳** (ADR-0011)。0〜2 歳は「準備モード」として保護者向け画面を提供。
  - `baby`: 準備モード (0-2歳), fontScale 1.5, tapSize 120px, 保護者向け・子供向けゲーミフィケーション非適用
  - `preschool`: 幼児 (3-5歳), fontScale 1.2, tapSize 80px, 丸い形、ひらがなのみ
  - `elementary`: 小学生 (6-12歳), fontScale 1.0, tapSize 56px, 標準レイアウト、漢字最小限
  - `junior`: 中学生 (13-15歳), fontScale 1.0, tapSize 48px, 情報密度やや高い
  - `senior`: 高校生 (16-18歳), fontScale 1.0, tapSize 44px, 情報密度高い、漢字
- **画像アセット方針**: 絵文字は装飾程度で許容。ゲーミフィケーション報酬などは Gemini API 等で生成しプレースホルダーを置く。詳細: [docs/product/asset-catalog.md](docs/product/asset-catalog.md)
- **詳細**: [docs/product/ブランドガイドライン.md](docs/product/ブランドガイドライン.md)

---

## 2. デザイントークン層 (Tokens: Color, Typography, Spacing)

### 2.1 カラートークン（3 層アーキテクチャ）
色は **Base → Semantic → Component** の 3 層で管理する。
- **禁忌**: routes / features 配下で hex カラー直書き禁止 (`#fff` 等)。Tailwind arbitrary hex 禁止。Base トークン直接使用禁止。

<!-- AUTOGEN:colors -->
#### Action（操作）

| トークン | 値 |
|---------|----|
| `--color-action-primary` | `var(--theme-primary)` |
| `--color-action-primary-hover` | `var(--color-brand-700)` |
| `--color-action-secondary` | `var(--theme-secondary)` |
| `--color-action-accent` | `var(--theme-accent)` |
| `--color-action-danger` | `var(--color-danger)` |
| `--color-action-success` | `var(--color-success)` |
| `--color-action-ghost` | `transparent` |
| `--color-action-trial` | `var(--color-premium-light)` |
| `--color-action-trial-hover` | `var(--color-premium)` |
| `--color-action-trial-upgrade` | `var(--color-warning)` |
| `--color-action-trial-upgrade-hover` | `var(--color-warning-hover)` |

#### Surface（背景）

| トークン | 値 |
|---------|----|
| `--color-surface` | `white` |
| `--color-surface-base` | `var(--color-bg)` |
| `--color-surface-card` | `white` |
| `--color-surface-overlay` | `rgba(0, 0, 0, 0.5)` |
| `--color-surface-elevated` | `white` |
| `--color-surface-muted` | `var(--color-neutral-50)` |
| `--color-surface-secondary` | `var(--color-neutral-100)` |
| `--color-surface-accent` | `var(--color-feedback-info-bg)` |
| `--color-surface-info` | `var(--color-feedback-info-bg)` |
| `--color-surface-success` | `var(--color-feedback-success-bg)` |
| `--color-surface-warning` | `var(--color-feedback-warning-bg)` |
| `--color-surface-warm` | `#fef3c7` |
| `--color-surface-themed` | `var(--theme-bg)` |
| `--color-surface-nav` | `var(--theme-nav)` |
| `--color-surface-trial` | `var(--color-premium-50)` |
| `--color-surface-trial-urgent` | `var(--color-feedback-warning-bg)` |
| `--color-surface-trial-expired` | `var(--color-neutral-50)` |
| `--color-surface-muted-strong` | `var(--color-neutral-100)` |
| `--color-surface-tertiary` | `var(--color-neutral-200)` |
| `--color-surface-error` | `var(--color-feedback-error-bg)` |
| `--color-surface-error-strong` | `var(--color-feedback-error-bg-strong)` |

#### Border（枠線）

| トークン | 値 |
|---------|----|
| `--color-border` | `var(--color-neutral-200)` |
| `--color-border-default` | `var(--color-neutral-200)` |
| `--color-border-light` | `var(--color-neutral-100)` |
| `--color-border-strong` | `var(--color-neutral-300)` |
| `--color-border-focus` | `var(--theme-primary)` |
| `--color-border-accent` | `var(--theme-accent)` |
| `--color-border-warm` | `rgba(251, 191, 36, 0.3)` |
| `--color-border-warning` | `var(--color-feedback-warning-border)` |
| `--color-border-premium` | `color-mix(in srgb, var(--color-premium) 20%, transparent)` |
| `--color-border-danger` | `color-mix(in srgb, var(--color-danger) 20%, transparent)` |
| `--color-border-success` | `color-mix(in srgb, var(--color-success) 20%, transparent)` |
| `--color-border-success-strong` | `color-mix(in srgb, var(--color-success) 40%, transparent)` |
| `--color-border-trial` | `var(--color-premium-200)` |
| `--color-border-trial-urgent` | `var(--color-feedback-warning-border)` |
| `--color-border-trial-expired` | `var(--color-neutral-200)` |

#### Text（文字）

| トークン | 値 |
|---------|----|
| `--color-text` | `#2d2d2d` |
| `--color-text-muted` | `#8b8b8b` |
| `--color-text-inverse` | `white` |
| `--color-text-accent` | `var(--theme-accent)` |
| `--color-text-link` | `var(--color-brand-700)` |
| `--color-text-primary` | `var(--color-neutral-700)` |
| `--color-text-secondary` | `var(--color-neutral-600)` |
| `--color-text-tertiary` | `var(--color-neutral-400)` |
| `--color-text-disabled` | `#9ca3af` |
| `--color-text-warm` | `#92400e` |
| `--color-text-warm-muted` | `#a16207` |

#### Feedback（フィードバック）

| トークン | 値 |
|---------|----|
| `--color-feedback-success-bg` | `#f0fdf4` |
| `--color-feedback-success-bg-strong` | `#dcfce7` |
| `--color-feedback-success-text` | `#15803d` |
| `--color-feedback-success-border` | `#bbf7d0` |
| `--color-feedback-error-bg` | `#fef2f2` |
| `--color-feedback-error-bg-strong` | `#fee2e2` |
| `--color-feedback-error-text` | `#dc2626` |
| `--color-feedback-error-border` | `#fecaca` |
| `--color-feedback-warning-bg` | `#fffbeb` |
| `--color-feedback-warning-bg-strong` | `#fef3c7` |
| `--color-feedback-warning-text` | `#b45309` |
| `--color-feedback-warning-border` | `#fde68a` |
| `--color-feedback-info-bg` | `#eff6ff` |
| `--color-feedback-info-bg-strong` | `#dbeafe` |
| `--color-feedback-info-text` | `#1d4ed8` |
| `--color-feedback-info-border` | `#bfdbfe` |
<!-- /AUTOGEN:colors -->
実体: `src/lib/ui/styles/app.css`

### 2.2 タイポグラフィ
- **基本フォント**: system-ui (OS デフォルト)
- **スケール**: 年齢帯ごとに `fontScale` が変動 (上記1層目を参照)
- **詳細**: [docs/product/タイポグラフィ・スペーシングガイドライン.md](docs/product/タイポグラフィ・スペーシングガイドライン.md)

### 2.3 スペーシング (基本)
- **基本グリッド**: 4px base
- **タップサイズ**: 年齢帯ごとに可変 (上記1層目を参照)

---

## 3. コンポーネント層 (UI Primitives & Components)

以下のコンポーネントは `$lib/ui/primitives/` に定義済み。routes で再実装禁止。

<!-- AUTOGEN:primitives -->
| コンポーネント | インポートパス |
|--------------|---------------|
| Alert | `$lib/ui/primitives/Alert.svelte` |
| Badge | `$lib/ui/primitives/Badge.svelte` |
| BirthdayInput | `$lib/ui/primitives/BirthdayInput.svelte` |
| Button | `$lib/ui/primitives/Button.svelte` |
| Card | `$lib/ui/primitives/Card.svelte` |
| Dialog | `$lib/ui/primitives/Dialog.svelte` |
| Divider | `$lib/ui/primitives/Divider.svelte` |
| FormField | `$lib/ui/primitives/FormField.svelte` |
| IconButton | `$lib/ui/primitives/IconButton.svelte` |
| NativeSelect | `$lib/ui/primitives/NativeSelect.svelte` |
| PinInput | `$lib/ui/primitives/PinInput.svelte` |
| Progress | `$lib/ui/primitives/Progress.svelte` |
| Select | `$lib/ui/primitives/Select.svelte` |
| Tabs | `$lib/ui/primitives/Tabs.svelte` |
| Toast | `$lib/ui/primitives/Toast.svelte` |
<!-- /AUTOGEN:primitives -->

- **ボタンは必ず `Button.svelte` を使用**
- **フォーム要素は `FormField.svelte` を使用** (type 一覧: text, email, password, number, tel, url, search, date, time, datetime-local, textarea)
- **Toast**: 成功フィードバック等、自動消滅する一時通知に使う。
- **PinInput**: 家族/保護者 PIN 等、数値のみの認証入力に使う。

---

## 4. レイアウト・パターン層 (Layout & Patterns)

### 4.1 z-index 階層（#1722）
オーバーレイ系 UI（Modal / Dialog / Banner / Tutorial / Celebration）の重畳順を一元管理するため、`app.css` に `--z-*` トークンを定義する。
- `--z-base`: 0 (通常 flow)
- `--z-sticky`: 10 (固定 header / sticky)
- `--z-dropdown`: 20 (menu / popover)
- `--z-banner`: 30 (FAB / inline banner)
- `--z-overlay`: 40 (Dialog Backdrop)
- `--z-modal`: 50 (Dialog Content / AdminLayout sidebar)
- `--z-reward`: 90 (祝福 modal)
- `--z-tutorial`: 100 (操作ガイド系)
- `--z-celebration`: 200 (最上位演出)
- `--z-debug`: 9999 (dev 内部用)

**重畳ルール**: celebration > tutorial > reward > modal > overlay > banner > dropdown > sticky > base
**禁忌**: `z-index: 50;` 等の生数値直書き禁止。

### 4.2 LP Spacing/Layout 3 層トークン (ADR-0042)
LP (`site/index.html`) の Layout 系設計値も 3 層で管理する。
- Component: `.section{padding-block: var(--lp-section-padding-y)}`
- Semantic: `--lp-section-padding-y: var(--space-7);`
- Base: `--space-7: 28px;`
**禁忌**: `site/index.html` 内に padding/margin の数値直書き禁止。

---

## 5. インタラクション・モーション層 (Interaction & Motion)

(時間軸を伴う動き・アニメーションの方向性をここに定義します。現状は Anti-engagement 原則により、過度なアニメーションや連続演出は控える方針です。)

---

## 6. アクセシビリティ・ライティング層 (Accessibility & Writing)

### 6.1 日本語テキスト折り返し（ADR-0016）
- **第一選択**: `text-wrap: balance; word-break: auto-phrase;` を適用。
- **フォールバック**: BudouX (`use:budoux`) を必要箇所に適用。

### 6.2 用語辞書（SSOT: `terms.ts` → `labels.ts`）
UI に表示されるラベル・用語は 2 階層 SSOT で管理する (ADR-0045)。

<!-- AUTOGEN:terms -->
#### PLAN_TERMS

| key | 値 |
|-----|----|
| `free` | `'無料'` |
| `standard` | `'スタンダード'` |
| `family` | `'ファミリー'` |

#### PLAN_FULL_TERMS

| key | 値 |
|-----|----|
| `free` | `'無料プラン'` |
| `standard` | `'スタンダードプラン'` |
| `family` | `'ファミリープラン'` |

#### PRICE_TERMS

| key | 値 |
|-----|----|
| `standard` | `'¥500'` |
| `family` | `'¥780'` |
| `free` | `'¥0'` |
| `taxNote` | `'（税込）'` |
| `monthlyPrefix` | `'月 '` |
| `fromSuffix` | `'〜'` |

#### TRIAL_TERMS

| key | 値 |
|-----|----|
| `duration` | `'7日間'` |
| `durationSpaced` | `'7 日間'` |
| `durationDays` | `7` |
| `noCreditCard` | `'クレジットカード登録不要'` |
| `noCreditCardShort` | `'クレカ登録不要'` |
| `noCreditCardMid` | `'カード登録不要'` |
| `noCreditCardDetailed` | `'無料体験中もカード情報は不要。有料プラン切替時に初めて入力します'` |

#### CANCEL_TERMS

| key | 値 |
|-----|----|
| `anytime` | `'いつでも解約'` |
| `anytimeOk` | `'いつでも解約できます（契約期間の縛りなし）'` |

#### FREE_TERMS

| key | 値 |
|-----|----|
| `base` | `'基本無料'` |
| `start` | `'まずは無料'` |
| `tryFree` | `'無料で始める'` |
| `suffix` | `'無料'` |
| `priceGate` | `'必要なら'` |

#### CTA_TERMS

| key | 値 |
|-----|----|
| `freeTrialNoun` | `'無料体験'` |
| `freeTrialVerb` | `'無料で試す'` |
| `freeTrialDesc` | `'無料で試せます'` |

#### LP_FAQ_TERMS

| key | 値 |
|-----|----|
| `canonicalLong` | `'よくあるご質問'` |
| `canonicalShort` | `'FAQ'` |
| `linkLabel` | `'よくあるご質問'` |
| `faqHtmlTitle` | `'よくあるご質問'` |
| `inlineCtaSentence` | `'他のご質問は <a href="faq.html" class="nav-text">よくあるご質問</a> をご覧ください。'` |

#### AGE_RANGE_TERMS

| key | 値 |
|-----|----|
| `short` | `'3〜18 歳'` |
| `long` | `'3 歳から 18 歳まで'` |
| `numericShort` | `'3〜18'` |
| `juniorShort` | `'13〜18 歳'` |
| `juniorNumericShort` | `'13〜18'` |

#### POINT_TERMS

| key | 値 |
|-----|----|
| `unit` | `'pt'` |
| `unitFull` | `'ポイント'` |
| `unitSymbol` | `'P'` |

#### CURRENCY_TERMS

| key | 値 |
|-----|----|
| `yen` | `'¥'` |
| `yenFull` | `'円'` |

#### FREE_PLAN_TERMS

| key | 値 |
|-----|----|
| `forever` | `'永久無料'` |
| `foreverDot` | `'永久無料 ・ '` |
| `planSelfNoun` | `'フリー'` |

#### AUTONOMY_TERMS

| key | 値 |
|-----|----|
| `selfMotivated` | `'自分から動きだす'` |
| `selfMotivatedPast` | `'自分から動きだした'` |
| `selfPlanning` | `'自分で計画する'` |
| `selfPlanningAble` | `'自分で計画できる'` |

#### ADMIN_VIEW_TERMS

| key | 値 |
|-----|----|
| `canonical` | `'ご家族の見守り画面'` |
| `short` | `'見守り画面'` |
| `parent` | `'保護者の見守り画面'` |

#### STRIPE_PORTAL_TERMS

| key | 値 |
|-----|----|
| `canonical` | `'Stripe の請求管理ページ'` |
| `short` | `'請求管理ページ'` |
| `billingPortal` | `'請求管理ページ'` |
<!-- /AUTOGEN:terms -->

<!-- AUTOGEN:labels -->
| エクスポート | 種類 | 用途 |
|------------|------|------|
| `APP_LABELS` | const |  |
| `PAGE_TITLES` | const |  |
| `UI_LABELS` | const |  |
| `SETUP_LABELS` | const |  |
| `NAV_CATEGORIES` | const | ナビゲーションカテゴリ名 |
| `NAV_ITEM_LABELS` | const | ナビゲーション項目ラベル |
| `AGE_TIER_LABELS` | const | 年齢区分ラベル（フル） |
| `AGE_TIER_SHORT_LABELS` | const | 年齢区分ラベル（短縮） |
| `PLAN_LABELS` | const | プラン名（フル） |
| `PLAN_SHORT_LABELS` | const | プラン名（短縮） |
| `PAID_PLAN_LABEL` | const | 有料プラン総称ラベル |
| `PLAN_GATE_LABELS` | const |  |
| `LICENSE_PLAN_LABELS` | const |  |
| `THEME_LABELS` | const | テーマ名 |
| `THEME_EMOJIS` | const | テーマ絵文字 |
| `FEATURE_LABELS` | const | 機能名ラベル |
| `ACTIVITY_PRIORITY_LABELS` | const |  |
| `ACTIVITY_PRIORITY_FORM_LABELS` | const |  |
| `ACTION_LABELS` | const |  |
| `TRIAL_LABELS` | const |  |
| `LIFECYCLE_EMAIL_LABELS` | const |  |
| `PMF_SURVEY_LABELS` | const |  |
| `PREMIUM_MODAL_LABELS` | const |  |
| `MARKETPLACE_LABELS` | const |  |
| `MARKETPLACE_FILTER_LABELS` | const |  |
| `TUTORIAL_LABELS` | const |  |
| `TUTORIAL_CHAPTER_LABELS` | const |  |
| `DEMO_LABELS` | const |  |
| `OYAKAGI_LABELS` | const |  |
| `IMPORT_LABELS` | const |  |
| `SETTINGS_LABELS` | const |  |
| `LICENSE_PAGE_LABELS` | const |  |
| `REPORTS_LABELS` | const |  |
| `OPS_LABELS` | const |  |
| `POINTS_LABELS` | const |  |
| `SIGNUP_LABELS` | const |  |
| `ANALYTICS_LABELS` | const |  |
| `BILLING_LABELS` | const |  |
| `CANCELLATION_CATEGORY` | const |  |
| `CANCELLATION_CATEGORIES` | const |  |
| `CANCELLATION_LABELS` | const |  |
| `GRADUATION_LABELS` | const |  |
| `OPS_GRADUATION_LABELS` | const |  |
| `OPS_CANCELLATION_LABELS` | const |  |
| `OPS_LICENSE_ISSUE_LABELS` | const |  |
| `OPS_REVENUE_LABELS` | const |  |
| `OPS_BUSINESS_LABELS` | const |  |
| `CHILD_HOME_LABELS` | const |  |
| `DEMO_SIGNUP_LABELS` | const |  |
| `CHALLENGES_LABELS` | const |  |
| `LOGIN_LABELS` | const |  |
| `MEMBERS_LABELS` | const |  |
| `DEMO_TOP_LABELS` | const |  |
| `GROWTH_BOOK_LABELS` | const |  |
| `OPS_ANALYTICS_LABELS` | const |  |
| `OPS_PRESET_DISTRIBUTION_LABELS` | const |  |
| `DEMO_SETTINGS_LABELS` | const |  |
| `ERROR_PAGE_LABELS` | const |  |
| `OPS_LICENSE_KEY_LABELS` | const |  |
| `STATUS_LABELS` | const |  |
| `PRICING_PAGE_LABELS` | const |  |
| `CONSENT_LABELS` | const |  |
| `DEMO_STATUS_LABELS` | const |  |
| `OPS_COSTS_LABELS` | const |  |
| `REWARDS_LABELS` | const |  |
| `DEMO_MEMBERS_LABELS` | const |  |
| `OPS_EXPORT_LABELS` | const |  |
| `MESSAGES_LABELS` | const |  |
| `OPS_COHORT_LABELS` | const |  |
| `SETUP_FIRST_ADVENTURE_LABELS` | const |  |
| `DEMO_POINTS_LABELS` | const |  |
| `ACTIVITIES_INTRODUCE_LABELS` | const |  |
| `DEMO_MESSAGES_LABELS` | const |  |
| `EVENTS_LABELS` | const |  |
| `FORGOT_PASSWORD_LABELS` | const |  |
| `DEMO_REWARDS_LABELS` | const |  |
| `SETUP_COMPLETE_LABELS` | const |  |
| `CERTIFICATE_DETAIL_LABELS` | const |  |
| `DEMO_CHILD_HOME_LABELS` | const |  |
| `DEMO_ADMIN_HOME_LABELS` | const |  |
| `SETUP_CHILDREN_LABELS` | const |  |
| `ADMIN_CHILDREN_LABELS` | const |  |
| `ACTIVITY_FORM_LABELS` | const |  |
| `ADMIN_HOME_LABELS` | const |  |
| `DOWNGRADE_RESOURCE_SELECTOR_LABELS` | const |  |
| `CHILD_PROFILE_CARD_LABELS` | const |  |
| `DEMO_REPORTS_LABELS` | const |  |
| `ADMIN_CHILDREN_PAGE_LABELS` | const |  |
| `CERTIFICATES_PAGE_LABELS` | const |  |
| `PACKS_PAGE_LABELS` | const |  |
| `OPS_LAYOUT_LABELS` | const |  |
| `SETUP_QUESTIONNAIRE_LABELS` | const |  |
| `CHILD_STATUS_LABELS` | const |  |
| `AUTH_INVITE_LABELS` | const |  |
| `DEMO_LAYOUT_LABELS` | const |  |
| `SETUP_PACKS_LABELS` | const |  |
| `PARENT_LOGIN_LABELS` | const |  |
| `VIEW_PAGE_LABELS` | const |  |
| `DEMO_BATTLE_LABELS` | const |  |
| `CHILD_CHECKLIST_LABELS` | const |  |
| `DEMO_CHILD_CHECKLIST_LABELS` | const |  |
| `ADMIN_CHECKLISTS_PAGE_LABELS` | const |  |
| `DEMO_ACTIVITIES_LABELS` | const |  |
| `DEMO_CHECKLISTS_LABELS` | const |  |
| `DEMO_EVENTS_LABELS` | const |  |
| `SWITCH_PAGE_LABELS` | const |  |
| `OPS_LICENSE_PAGE_LABELS` | const |  |
| `DEMO_CHALLENGES_LABELS` | const |  |
| `DEMO_CHILD_ACHIEVEMENTS_LABELS` | const |  |
| `LP_NAV_LABELS` | const |  |
| `LP_FOOTER_LABELS` | const |  |
| `LP_HERO_PRICE_BAND_LABELS` | const |  |
| `LP_CTA_TRUST_BADGES_LABELS` | const |  |
| `LP_HERO_SPEC_BADGES_LABELS` | const |  |
| `LP_COMMON_LABELS` | const |  |
| `LP_LEGAL_DISCLAIMER_LABELS` | const |  |
| `LP_PRICING_LABELS` | const |  |
| `FOUNDER_INQUIRY_LABELS` | const |  |
| `LP_RETENTION_LABELS` | const |  |
| `BABY_HOME_LABELS` | const |  |
| `ONBOARDING_LABELS` | const |  |
| `LP_VERSUS_LABELS` | const |  |
| `LP_GROWTH_ROADMAP_LABELS` | const |  |
| `LP_CORELOOP_LABELS` | const |  |
| `CHILD_SHOP_LABELS` | const |  |
| `ADMIN_SHOP_REQUEST_LABELS` | const |  |
| `UI_PRIMITIVES_LABELS` | const |  |
| `STAMP_PRESS_N_MESSAGES` | const |  |
| `USAGE_TIME_LABELS` | const |  |
| `UI_COMPONENTS_LABELS` | const |  |
| `FEATURES_LABELS` | const |  |
| `LEGAL_LABELS` | const |  |
| `PUSH_NOTIFICATION_LABELS` | const |  |
| `LP_LICENSEKEY_LABELS` | const |  |
| `LP_FAQ_LABELS` | const |  |
| `LP_SELFHOST_LABELS` | const |  |
| `LP_FLOATING_CTA_LABELS` | const |  |
| `LP_INDEX_EXTRA_LABELS` | const |  |
| `LP_PAMPHLET_LABELS` | const |  |
| `LP_PRICING_EXTRA_LABELS` | const |  |
| `STORYBOOK_LABELS` | const |  |
| `MILESTONE_LABELS` | const |  |
| `VALUE_PREVIEW_LABELS` | const |  |
| `LP_INDEX_PHASEB_LABELS` | const |  |
| `LP_PRICING_PHASEB_LABELS` | const |  |
| `LP_FAQ_PHASEB_LABELS` | const |  |
| `LP_PAMPHLET_PHASEB_LABELS` | const |  |
| `LP_LEGAL_PRIVACY_LABELS` | const |  |
| `LP_LEGAL_TERMS_LABELS` | const |  |
| `LP_LEGAL_SLA_LABELS` | const |  |
| `LP_LEGAL_TOKUSHOHO_LABELS` | const |  |
| `formatCount` | function |  |
| `formatAge` | function |  |
| `formatAgeRange` | function |  |
| `formatStreak` | function |  |
| `formatTimes` | function |  |
| `formatPeople` | function |  |
| `formatDateRange` | function |  |
| `getAgeTierLabel` | function | 年齢区分ラベル取得 |
| `getAgeTierShortLabel` | function | 年齢区分短縮ラベル取得 |
| `getPlanLabel` | function | プランラベル取得 |
| `getLicensePlanLabel` | function |  |
| `getThemeLabel` | function | テーマラベル取得 |
| `getThemeOptions` | function | テーマ選択肢一覧 |
| `getActivityPriorityLabel` | function |  |
| `getCancellationCategoryLabel` | function |  |
| `NavCategoryId` | type |  |
| `PlanKey` | type |  |
| `ThemeKey` | type |  |
| `ActivityPriority` | type |  |
| `PmfSurveyQ1` | type |  |
| `PmfSurveyQ3` | type |  |
| `MarketplaceGender` | type |  |
| `MarketplaceSortKey` | type |  |
| `ImportSkipReason` | type |  |
| `CancellationCategory` | type |  |
<!-- /AUTOGEN:labels -->

### 6.3 Storybook ラベル言語ポリシー（#1738）
- Story 名 / `argTypes`: 英語
- **コンポーネント表示テキスト**: **日本語** (`STORYBOOK_LABELS` 定数経由で参照)

---

## 7. 更新ルール

- `app.css` の `@theme` に CSS 変数追加 -> デザイントークン層を更新
- `primitives/` にコンポーネント追加 -> コンポーネント層を更新
- `terms.ts` / `labels.ts` に定数追加 -> ライティング層を更新
自動更新コマンド: `node scripts/generate-design-md-sections.mjs`

## 禁忌事項まとめ (Things Not To Do)
- hex 直書き（routes/features 内）
- プリミティブ再実装
- 内部コード UI 露出 (`child.uiMode` をそのまま出すなど)
- 用語ハードコード
- インラインスタイル（動的値以外）
- Tailwind arbitrary hex
- `<style>` ブロック 50 行超え
