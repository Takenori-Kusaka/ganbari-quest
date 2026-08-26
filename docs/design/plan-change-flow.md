# plan-change-flow.md — プラン変更フロー仕様 (#747)

> アップグレード（free→standard→family）とダウングレード（family→standard→free）、および解約時の挙動を 1 か所にまとめた SSOT。**年額プランは #2719 で廃止**しており、購入できるのは月額のみ。実装は `/admin/license` ページと `/api/stripe/{checkout,portal,webhook}` に集約されている。

---

## 1. 全体像

| フロー | エントリ | 経路 | 終端 |
|--------|---------|------|------|
| **アップグレード (新規購入)** | `/admin/license` プラン選択カード | `POST /api/stripe/checkout` → Stripe Checkout (外部) → `checkout.session.completed` Webhook | success URL = `/admin/license?session_id=...` → PremiumWelcome 表示 |
| **アップグレード (プラン昇格)** | `/admin/subscription` プラン利用状況カードのアップグレード CTA | PIN 確認 → `POST /api/stripe/portal` → Stripe Customer Portal → `customer.subscription.updated` Webhook | Portal の return URL = `/admin/license` → 新プラン反映 |
| **ダウングレード** | 同上（Customer Portal） | 同上 → Portal で下位プランに変更 → `customer.subscription.updated` Webhook | 同上 → 新プラン反映＋PlanStatusCard で超過リソースを警告 |
| **解約 (cancel)** | Customer Portal または `/admin/subscription` (アプリ内 API) | `cancel_at_period_end=true` を予約 → 期末に `customer.subscription.deleted` Webhook | DB: `stripe_subscription_id=NULL, plan=NULL, status=suspended`（テナントは残る、#3982）。到着順に依らない収束規則は §10.5 |
| **支払い失敗** | Stripe (自動) | `invoice.payment_failed` Webhook | DB: `status=grace_period, planExpiresAt=now+7d` → 猶予期間中は機能維持 |
| **ライセンスキー適用** | `/admin/license` フォーム | `applyLicenseKey` action → `consumeLicenseKey` (Stripe を経由しない) | テナント plan を直接昇格、Stripe 課金は発生しない |

> **重要**: プラン昇降格は **Stripe Customer Portal に委譲** している (#771)。解約は Portal に加えてアプリ内 API (`POST /api/v1/admin/tenant/cancel`) からも実行でき、いずれも **期末解約** (`cancel_at_period_end=true`) で予約する (#3991 / FR-1)。アプリ内 API は DB の契約状態を書かず、Stripe の `cancel_at_period_end` が「解約申請中か」の SSOT である (NFR-2)。期末が到来すると `customer.subscription.deleted` が §10.5 U5 の終端状態へ収束させる。取り消しは `POST /api/v1/admin/tenant/reactivate` (`cancel_at_period_end=false`) で、契約が生きているため Checkout の再実行は不要。

---

## 2. アップグレード — 新規購入（free → standard / family）

### 2.1 画面遷移

```
[/admin/license]
  ├─ プランカード × 2（standard / premium）
  └─ 「{プラン名}プランで始める」ボタン
        │
        ▼
  POST /api/stripe/checkout
   body: { planId: 'monthly' | 'family-monthly' }   // 年額は #2719 で廃止
        │
        ├─ 認可: role ∈ {owner, parent}（child は 403）
        ├─ tenantId: locals.context.tenantId（改ざん不可、サーバー署名付き）
        ├─ planId バリデーション: validPlanIds に含まれるか
        ▼
  createCheckoutSession()
        │
        ├─ Stripe Price ID を planId からマッピング (planId → price)
        ├─ custom_text.submit       = CHECKOUT_LABELS.submitMessage      (景表法 5 条 1 号整合)
        ├─ custom_text.after_submit = CHECKOUT_LABELS.afterSubmitMessage (#2346 EPIC #2345)
        ├─ success_url = ${origin}/admin/license?session_id={CHECKOUT_SESSION_ID}
        ├─ cancel_url  = ${origin}/pricing
        ▼
  { url: 'https://checkout.stripe.com/c/pay/...' }
        │
        ▼
  window.location.href = url   ← ブラウザを Stripe にリダイレクト
        │
        ▼
[Stripe Checkout（外部画面）]
        │
        ├─ 支払い方法入力 → 完了
        │   └─ 成功 → success_url にリダイレクト
        │       └─ 同時に Webhook: checkout.session.completed
        │
        └─ キャンセル → cancel_url (/pricing) にリダイレクト
            └─ Webhook 発火なし、DB は free のまま
```

### 2.2 Webhook 処理 — `checkout.session.completed`

`stripe-service.ts:handleCheckoutCompleted()`

1. `session.metadata.tenantId` を取得（Checkout 作成時に埋め込み済み）
2. `session.metadata.planId` を取得し `Tenant['plan']` にキャスト
3. `applyTenantContractState()`（契約を**新規割り当て**するため突合対象を持たない `assign-contract`、§10.5.1 P3）で以下を更新:
   - `stripeCustomerId`
   - `stripeSubscriptionId`
   - `plan` = 新プラン
   - `status` = `'active'`
   - `trialUsedAt` = now（トライアル消化済みフラグ）
4. **ライセンスキー発行 (#0247 / #801)**:
   - `issueLicenseKey({ kind: 'purchase', tenantId, plan, stripeSessionId, issuedBy })`
   - 発行されたキーをテナントに紐付け
   - Stripe Customer のメールアドレスへ `sendLicenseKeyEmail` で送信
   - キー発行失敗時も決済自体は成功扱い（手動補完可）
5. Discord には通知しない（課金**成功**の通知は持たない。`23-Discordサーバー設計書.md §4.5`。事実は `[STRIPE] Checkout completed` ログが残す）

### 2.3 PremiumWelcome モーダル表示

- success URL `/admin/license?session_id=...` への帰還時、admin の `+page.server.ts` (#743 §10.5) で次回ロード時に判定:
  - `isPaidTier(tier) && setting('premium_welcome_shown') !== 'true'` → モーダル表示
  - dismiss 時に setting を `'true'` に更新（テナントスコープ）

---

## 3. プラン変更 / ダウングレード / 解約 — Customer Portal 経由

### 3.0 解約理由ヒアリング（#1596 / ADR-0023 §3.8 / I3）

解約フローは **全プラン (free / standard / family / lifetime) で必須** に理由収集を行う。
PO の「解約原因が見えない」「卒業 vs 離反比率が検証されていない」課題を解決する。

#### 3.0.1 入口

```
[/admin/subscription]
  ├─ 「プラン管理」ボタン → /admin/license
  └─ 「解約手続き」ボタン → /admin/subscription/cancel    ← #1596 入口
```

#### 3.0.2 フォーム

```
[/admin/subscription/cancel]
  └─ POST /admin/subscription/cancel (form action)
        │
        ├─ category (必須):
        │    ┌─ 'graduation' (卒業: 子供が自律した) — ポジティブ KPI、緑
        │    ├─ 'churn'      (離反: 不満があった)    — 改善対象、赤
        │    └─ 'pause'      (中断: 一時停止)         — 復帰候補、橙
        │
        ├─ freeText (任意, 1000 文字以下)
        │
        ▼
  cancellation-service.submitCancellationReason()
        │
        ├─ DB: cancellation_reasons に保存
        │      (tenantId / category / freeText / planAtCancellation /
        │       stripeSubscriptionId / createdAt)
        │
        ├─ Discord には通知しない (churn チャネルは持たない、§4.5)
        │      理由・自由記述は DB に残り ops dashboard で集計する
        │
        ▼
  分岐:
    ├─ stripeSubscriptionId あり → Stripe Customer Portal にリダイレクト (303)
    │     → Portal 上で「サブスクリプションをキャンセル」
    │     → customer.subscription.deleted Webhook で DB 更新
    │
    └─ stripeSubscriptionId なし (free プラン)
          → /admin/subscription/cancel/thanks に遷移
          → ユーザーが必要に応じて /admin/license や /admin/settings へ
```

#### 3.0.3 上限超過リソースの選択 (解約 = 無料プラン復帰の経路)

解約すると無料プランに戻るため、上限を超えるリソース (子供 / 活動 / チェックリスト) と履歴保持期間の
扱いが決まる。**入口 (請求パネル / 解約フロー) によらず、失うものがあるときは必ず選択 UI を通す**。

```
[/admin/subscription/cancel]  submit (理由入力後)
  │
  ├─ 実効プラン (resolveFullPlanTier) = free → そのまま手続きへ
  │
  └─ free 以外 → GET /api/v1/admin/downgrade-preview?targetTier=free
        │
        ├─ shouldOpenDowngradeSelector(preview) = false (失うもの無し)
        │     → そのまま手続きへ
        │
        ├─ true → DowngradeResourceSelector (請求パネルと同一 component)
        │     └─ 確定 → POST /api/v1/admin/downgrade-archive
        │                (reason='downgrade_user_selected') → 手続きへ
        │
        └─ preview 取得失敗 → 理由を表示して 1 度止める
              (再送信で手続きは続く。解約を行き止まりにしない)
```

- 判定 SSOT: `src/lib/features/admin/downgrade-dialog-policy.ts` (`hasExcess || willLoseHistory`)
- API 呼び出し SSOT: `src/lib/features/admin/downgrade-client.ts` (2 入口で共有)
- **fallback (選ばずに手続きが完了した場合)**: 先に登録したものから順に無料プランの上限数だけ残し、
  超えた分をアーカイブする (`archiveExcessResources`)。この規則は解約画面に事前提示する
  (`CANCELLATION_LABELS.archiveFallback*`、上限値は `plan-limit-service` 由来)
- **fallback の起動条件**: `hasRevertedToFreePlan` (`src/lib/domain/free-plan-reversion.ts`) が SSOT。
  実効プランが free で、かつ (a) 体験の終了 または (b) 契約の終了 = S5
  ([contract-state-matrix](billing-redesign/contract-state-matrix.md) §4) のいずれかであること。
  解約フロー / 請求パネル / dunning はいずれも `customer.subscription.deleted` (同 §5 W5) で
  S5 に着地するため、3 経路で条件は同一になる。S3 支払い猶予 / S4 停止 (契約が残り復帰しうる) では
  発火しない。判定は `(parent)/admin/+layout.server.ts` の load で行い、archive 済みサマリの
  表示も同じ述語で出し分ける
- アーカイブは削除ではなく、再契約で復元できる

#### 3.0.4 Anti-engagement 原則 (ADR-0012)

- 「引き止め」UI を出さない（離脱トリガー化を防ぐ）
- 自由記述は **任意** （義務化はストレス）
- 「卒業」を選ばれた場合もポジティブに祝う（煽り無し）
- カテゴリは 3 択のみ（細分化すると意思決定コストが上がる）

#### 3.0.4 ops dashboard (`/ops/analytics`)

直近 90 日の集計を表示:
- カテゴリ別件数 + 比率（卒業 / 離反 / 中断）
- 自由記述サンプル（最新 20 件、最低限の検索機能）

詳細: `OpsAnalyticsData.cancellationReasons` (`src/lib/server/services/ops-analytics-service.ts`)

#### 3.0.5 DB スキーマ

```sql
CREATE TABLE cancellation_reasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    category TEXT NOT NULL,             -- 'graduation' | 'churn' | 'pause'
    free_text TEXT,                     -- 任意、最大 1000 文字
    plan_at_cancellation TEXT,          -- 解約時のプラン
    stripe_subscription_id TEXT,        -- 課金プランの場合のみ
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_cancellation_reasons_tenant ON cancellation_reasons(tenant_id);
CREATE INDEX idx_cancellation_reasons_category_date ON cancellation_reasons(category, created_at);
CREATE INDEX idx_cancellation_reasons_date ON cancellation_reasons(created_at);
```

DynamoDB: PK=`CANCEL_REASON`, SK=`<isoTs>#<uuid>` (single global partition、低頻度書込み < 100/月想定)

詳細: `docs/design/08-データベース設計書.md` §「cancellation_reasons」

---

### 3.0.6 卒業フロー（#1603 / ADR-0023 §3.8 / §5 I10）

#### §1. 設計背景

PO の「『卒業』をプロダクト哲学（ADR-0023 §3.8）として実装で示し、ポジティブ KPI として PR 数値化したい」方針 + 親の「子供が自律したから卒業したい、残ポイントを子供に何らかの形で還元したい」需要を、解約フロー（#1596）で「卒業」が選ばれた場合の専用ページで実現する。Q-α 回答（卒業 = ポジティブな解約）。

「離反」「中断」と違い、卒業は祝福すべき完了状態。3 分類のうち 1 つだけ動線が異なる（ポイント還元提案 + 祝福ビジュアル + 任意の事例公開承諾）のはこの非対称性に基づく。

#### §2. 設計原則

1. **ポジティブだが煽らない (ADR-0012)** — 「もう一度始めましょう」「もっと使えば〜」等の引き止め CTA を出さない。卒業を素直に祝うだけ。
2. **公開時の実名禁止** — 親が任意指定するニックネームのみ。お子さまの特定不可性を最優先。
3. **承諾なしでも KPI に含む** — 「卒業者数 / 平均利用期間 / 卒業率」は consented=false でもカウント。事例公開承諾は別管理。
4. **DynamoDB GSI 不採用 (Pre-PMF / ADR-0010)** — 単一パーティション + Scan + 属性フィルタで Tenant 単位検索。書込み < 50/月想定で過剰防衛しない。

#### §3. 仕様

##### 動線

```
[/admin/subscription/cancel]
  └─ POST /admin/subscription/cancel
       │
       ├─ category='graduation' を選択した場合
       │     ├─ submitCancellationReason() で解約理由保存（共通フロー）
       │     └─ redirect 303 → /admin/subscription/cancel/graduation     ← ★ 専用ページ
       │
       └─ category='churn' / 'pause' を選択した場合
             └─ 既存フローのまま (Stripe Portal or thanks)
```

##### `/admin/subscription/cancel/graduation` 専用ページ

- 残ポイント表示（全子供の getBalance() 合計）
- 還元提案テキスト（現金換算想定額 + 物品例 + 体験例）
- 祝福ビジュアル（既存 `static/assets/stamps/daikichi.png`「大吉」を再利用）
- 任意の事例公開承諾フォーム
  - チェックボックス（公開承諾）
  - ニックネーム（公開時実名禁止、最大 30 文字、承諾時のみ必須）
  - 卒業メッセージ（公開可、最大 500 文字、任意）
- 承諾済 / 未承諾どちらでも recordGraduationConsent() で記録
- 記録後の遷移は離反 / 中断経路と同型: Stripe Customer あり & Stripe 有効 → Customer Portal の解約フロー（失敗時は `thanks?portalUnavailable=1`）、無料プラン / Stripe 未有効 → `thanks`

##### graduation-service

- `recordGraduationConsent(input)`: 卒業セッション完了 + 任意の事例公開承諾保存
- `getGraduationStats(days=90)`: ops dashboard 用統計取得
- `calculateUsagePeriodDays(tenantCreatedAt)`: 利用日数計算（テナント作成日 → 現在）

##### ops dashboard (`/ops/analytics`)

直近 90 日:
- 卒業者数 / 事例公開承諾数 / 平均利用期間（日）
- 卒業率（卒業 / 全解約）— ADR-0023 ポジティブ KPI
- 公開承諾された卒業事例（最新 20 件、ニックネーム + 利用期間 + ポイント + メッセージ）

詳細: `OpsAnalyticsData.graduation` (`src/lib/server/services/ops-analytics-service.ts`)

##### DB スキーマ

```sql
CREATE TABLE graduation_consent (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    nickname TEXT NOT NULL,                  -- 公開時の表示名（実名禁止）
    consented INTEGER NOT NULL DEFAULT 0,    -- 公開承諾フラグ (0/1)
    user_points INTEGER NOT NULL DEFAULT 0,  -- 卒業時の残ポイント合計
    usage_period_days INTEGER NOT NULL DEFAULT 0,  -- 利用日数
    message TEXT,                            -- 任意の卒業メッセージ（最大 500 文字）
    consented_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_graduation_consent_tenant ON graduation_consent(tenant_id);
CREATE INDEX idx_graduation_consent_consented_date
    ON graduation_consent(consented, consented_at);
CREATE INDEX idx_graduation_consent_date ON graduation_consent(consented_at);
```

DynamoDB: PK=`GRADUATION_CONSENT`, SK=`<isoTs>#<uuid>` (single global partition、低頻度書込み < 50/月想定、#1596 同パターン)

##### プライバシーポリシー

`site/privacy.html` 第6条の2（卒業フローと事例公開承諾）に保管期間 + 公開時の実名禁止 + 承諾撤回フローを記載。

詳細: `docs/design/08-データベース設計書.md` §「graduation_consent」

---

### 3.1 PIN 確認ゲート (#771)

子供が親端末で誤操作するのを防ぐため、Portal 遷移前に二段階確認を必須化。

```
[/admin/license]
  └─ 「請求管理ページを開く」ボタン / アップグレード CTA
        │
        ▼
  Dialog: showPortalConfirm = true
        │
        ├─ pinConfigured === true   → 親 PIN コード（4桁数字、`PIN_LENGTH` SSOT）入力
        └─ pinConfigured === false  → 確認フレーズ「プランを変更します」入力
        │
        ▼
  「Stripe の管理画面を開く」確認ボタン
        │
        ▼
  POST /api/stripe/portal
   body: { pin: '1234' } または { confirmPhrase: 'プランを変更します' }
        │
        ├─ 認可: role ∈ {owner, parent}
        ├─ pinConfigured 分岐:
        │    pin あり → verifyPin()
        │      ├─ INVALID_PIN  → 401 INVALID_PIN
        │      ├─ LOCKED_OUT   → 423 LOCKED_OUT:{lockedUntil}
        │      └─ ok           → 続行
        │    pin なし → confirmPhrase === 'プランを変更します' でなければ 401
        ▼
  createPortalSession(tenantId, return_url=`${origin}/admin/license`)
        │
        ▼
  { url: 'https://billing.stripe.com/p/session/...' }
        │
        ▼
  window.location.href = url
```

### 3.2 Stripe Customer Portal で行える操作

| 操作 | Webhook | DB 反映 |
|------|---------|---------|
| プラン変更（standard ↔ family、月 ↔ 年） | `customer.subscription.updated` | `plan` を `planIdFromPriceId(item.price.id)` で更新、`status='active'` |
| サブスク解約（即時 or 期末） | `customer.subscription.deleted` | `stripeSubscriptionId=null, plan=null, planExpiresAt=null, status='suspended'`（終端 4 列、§10.5.1 P3） |
| 支払い方法更新 | （Stripe 側のみ） | DB 変更なし |
| 請求書履歴閲覧 | （Stripe 側のみ） | DB 変更なし |

### 3.2.1 Portal の着地は「顧客の意図」で決める（#4166）

Stripe portal の**ボタン文言は変更できない**（Branding で変えられるのは色・ロゴ・事業者名のみ）。
portal ホームに着地させると「サブスクリプションを更新」が並び、顧客はこれを
**「支払い方法の更新 / 継続」と読んでプラン変更に到達しない**。

したがって `createPortalSession(tenantId, returnUrl, flow)` が **flow を受け取り**、
`billingPortal.sessions.create()` の `flow_data` で目的のフローへ直行させる。

| flow | 入口 | 着地 | `flow_data` |
|---|---|---|---|
| `subscription_update` | 「⭐ プレミアムへ」等のアップグレード CTA（`intent='plan-upgrade'`） | プラン選択画面 | `type='subscription_update'` + `subscription_update.subscription` |
| `subscription_cancel` | 解約理由フォーム送信後（`cancel/+page.server.ts`） | 解約画面 | `type='subscription_cancel'` + `subscription_cancel.subscription` |
| `home`（既定） | 「請求管理ページを開く」 / 請求履歴 | portal ホーム | 付けない |

**`home` を残す理由**: flow を付けると**請求書閲覧・支払い方法変更の入口が消える**。
汎用導線はホームのままにする。

**完了後はアプリへ戻す**: `after_completion = { type: 'redirect', redirect: { return_url } }` を
**明示指定**する。省略時の挙動は公式ドキュメントに明記が無く、確認ページに留まると読めるため。
途中でやめた顧客が戻れるよう、トップレベルの `return_url` は flow の有無に関わらず常に渡す。

**`stripeSubscriptionId` を持たないテナントでは flow を付けない**（`home` にフォールバック）。
付けたまま送ると Stripe が 400 を返し、**顧客は何を押しても portal に入れなくなる**。

`subscription_update_confirm`（price 選択をアプリ側に持ち確認画面だけ portal に出す）は**採らない** —
proration / 期末切替の表示責務がアプリに移り、Stripe を課金状態の SSOT とする方針（#4096）と逆行する。

### 3.2.2 flow が拒否されたら home に倒し、次の操作を示す（#4270）

`flow_data` は **Stripe Dashboard の Portal 設定**（更新オプションとして表示する商品・価格 / 解約の許可）
が生きていることを前提にする。設定がずれた瞬間に **portal に一切入れなくなる**のは、直行できないより悪い。
外部 SaaS の設定を常時監視する機構は持たず（Pre-PMF、ADR-0010）、以下の 3 点で塞ぐ。

1. **フォールバック**: `createPortalSession()` は flow 付き session の作成が失敗したら、**flow 無しで作り直す**。
   作り直しも失敗した場合は握り潰さず型付きの失敗（`PORTAL_CREATE_FAILED`）を返す
   （portal に入れない事実を成功として返さない）
2. **倒れたことを顧客に伝え、理由で出口を変える**: 戻り値 `flowFallback` に**理由**
   （`PORTAL_FALLBACK_REASON`）を載せて呼び出し元へ返す。着地（portal ホーム）は同じでも、
   **顧客が次に取るべき行動が正反対**なので理由を落とさない

   | 理由 | 立つ条件 | 顧客に示す次の手 |
   |---|---|---|
   | `flow-rejected` | Stripe が `flow_data` を拒否した | 時間をおいて再試行（この画面の「請求ポータルを開く」から続ける） |
   | `no-subscription` | `stripeSubscriptionId` を持たず `flow_data` を組み立てられなかった | **サポート窓口**（`/admin/settings/support`）。自力では完了できない |

   `no-subscription` は解約済みで Customer だけ残る場合のほか、**Stripe 側にサブスクが生きているのに
   DB 側が null というドリフト**でも起き、黙って通すと「解約を押したのに課金が続く」になる。
   このとき再試行を促すと**押すたびに同じ画面へ戻る出口の無いループ**になり、解約導線の実効性を欠く
   （特商法）。`home` を要求した場合はホーム着地が期待どおりなので立てない
   - プラン変更（`POST /api/stripe/portal`）: 応答 `{ url, flowFallback, flowFallbackReason }`。
     画面は自動遷移せず `portal-fallback-notice` を出し、`flow-rejected` なら作成済み session への
     「請求管理ページへ進む」で進ませる（PIN 再入力なし）。`no-subscription` では進むボタンを出さず
     サポート導線（`portal-fallback-support`）に置き換える
   - 解約（`cancel/+page.server.ts`）/ 卒業（`cancel/graduation/+page.server.ts`）/ thanks の再試行:
     portal へ飛ばさず `/admin/subscription?portalFallback=cancel&portalFallbackReason=<理由>` へ戻し、
     理由に応じた通知を出す（URL 組み立ては `buildPortalFallbackLocation()` に集約）。
     **解約理由を書き終えた直後に予期しない画面へ落とさない**
   - `no-subscription` は `logger.warn`（tenantId 付き）で残す。課金整合性の破れを運用が数えられない
     状態にしない。Discord alert は上げない（正常な再訪でも立つため alert fatigue、ADR-0010）
   - 文言は `SUBSCRIPTION_PAGE_LABELS.portalFallback*`（labels SSOT）。**原因は顧客に説明しない**（ADR-0062）
3. **`intent` の検証**: `POST /api/stripe/portal` の `intent` は allowlist
   （`plan-change` / `plan-upgrade` / `billing-history`）で検証し、外れたら安全側（`home`）に倒して
   拒否した事実を記録する。**ログに顧客識別子は載せない**（intent の値と拒否した事実だけ）

**設定の生存確認は deploy 手順で踏む**: `docs/runbooks/stripe-dashboard-runbook.md` の
「portal 直行の実機確認」を本番投入の必須手順とする（CI では flow の着地を検証できない、#4161）。

### 3.3 Webhook 処理 — `customer.subscription.updated`

`stripe-service.ts:handleSubscriptionUpdated()`

1. `subscription.metadata.tenantId` か `resolveSubscriptionContext(subscription.id)` でテナント特定
   （後者は `subscriptions.retrieve()` → `customer` → `findTenantByStripeCustomerId()` の逆引き。
   **subscription ID ではなく customer ID を鍵にしている**ため、解約で
   `stripe_subscription_id` をクリアしても逆引きは壊れない、#3982）
2. **終端判定 (#3982)**: `subscription.status ∈ {canceled, incomplete_expired}` なら §10.5 の
   終端状態へ収束させて終了（plan を書き戻さない）
3. `subscription.items[0].price.id` から `planIdFromPriceId()` → `planIdFromLookupKey()` の順で
   `Tenant['plan']` を解決。解決できなければ **plan 列を更新せず既存値を保持** + alert（#3960、
   旧 `?? MONTHLY` の silent fallback は廃止）
4. `subscription.status` を DB 用に正規化:
   | Stripe status | DB status |
   |---------------|-----------|
   | `active` / `trialing` | `'active'` |
   | `past_due` | `'grace_period'` |
   | `unpaid` / `paused` / `incomplete` | `'suspended'` |
   | `canceled` / `incomplete_expired` | 終端収束（手順 2 で処理済、§10.5） |
5. `applyTenantContractState()`（契約状態を書き換える唯一の経路、§10.5.1 P3）で `plan, status` を保存。
   **event 対象の subscription が tenant の現行契約でなければ適用しない**（#4026）
6. Discord には通知しない（プラン変更の通知は持たない、§4.5。事実は `[STRIPE] Subscription updated` ログが残す）

### 3.4 Webhook 処理 — `customer.subscription.deleted`

`stripe-service.ts:handleSubscriptionDeleted()` → `applyTenantContractState()` + `TERMINAL_CONTRACT_STATE`

1. テナント特定（同上）
2. event 対象が tenant の現行契約であることを突合（§10.5.1 P3）。不一致なら適用しない（#4026）
3. 終端状態（`TERMINAL_CONTRACT_STATE`、契約に紐づく列を網羅）を書く:
   - `stripeSubscriptionId` = **`null`**（= SQL で `NULL` を書く）
   - `plan` = **`null`**（同上）
   - `planExpiresAt` = **`null`**（契約が無いのに期限だけ残る孤児を作らない、#4026）
   - `status` = `'suspended'`
   - `stripeCustomerId` は**意図的に残す**（再購読時の Stripe customer 再利用 + 後続 webhook の逆引き鍵）
4. **`undefined` ではなく `null` である理由 (#3982)**: `updateTenantStripe` は部分更新 API で、
   `undefined` = 「その列を更新しない」、`null` = 「NULL でクリアする」という 2 値セマンティクス
   （契約は `IAuthRepo.updateTenantStripe` の JSDoc が SSOT）。
   旧実装は `undefined` を渡しており **クリアが丸ごと no-op** だった。その結果
   `stripe_subscription_id` が解約後も残り、`createCheckoutSession()` の
   `if (tenant.stripeSubscriptionId) return { error: 'ALREADY_SUBSCRIBED' }` が発火して
   **解約済みユーザーの再購読導線が塞がっていた**
5. **重要**: テナント・子供データ・活動履歴は削除しない（解約と削除は別概念。アカウント削除は `/admin/settings` 経由 → `account-deletion-flow.md` 参照）
6. Discord には通知しない（解約の通知は持たない、§4.5。事実は `[STRIPE] Subscription deleted` ログが残す）

---

## 4. 支払い失敗フロー（猶予期間）

### 4.1 Webhook 処理 — `invoice.payment_failed`

`stripe-service.ts:handlePaymentFailed()`

1. テナント特定
1b. **終端判定 (#3982)**: retrieve した現行 subscription が `canceled` / `incomplete_expired` なら
   状態を更新せず終了（解約後に後着した payment_failed で終端状態を `grace_period` に戻さない）
2. **猶予期間設定**: `GRACE_PERIOD_DAYS = 7` (`src/lib/server/stripe/config.ts`)
   ```ts
   const graceExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
   ```
3. `applyTenantContractState()`（§10.5.1 P3、event 対象が現行契約のときのみ適用）で:
   - `status` = `'grace_period'`
   - `planExpiresAt` = `graceExpires`
4. Discord alert `stripe-payment-failed` を送出（**支払い失敗だけは incident に残す**、`23-Discordサーバー設計書.md §4.5`）。payload に tenantId は載せないため、対象は `[STRIPE] Payment failed` ログ / Stripe 側で特定する

### 4.2 ユーザー視点の挙動

- `/admin/license` の現在プラン表示で「⚠️ 猶予期間中」セクションが表示される
- プラン機能は維持される（=猶予期間中は引き続き standard/family の制限が適用）
- 7 日以内に支払い方法を更新 → Stripe が自動リトライ → `invoice.paid` Webhook で `status='active'` に復帰
- 7 日経過しても未払い → Stripe 側で `subscription.status='past_due' → 'unpaid'` 等に遷移 → `customer.subscription.updated` で `status='suspended'` に遷移
- `suspended` 状態では `/admin/license` に「⏸️ サービス停止中」セクションが表示される

### 4.3 リトライ・復帰

- Stripe Smart Retries に委譲（Stripe Dashboard 設定）
- 復帰経路: 支払い更新 → `invoice.paid` Webhook → `handleInvoicePaid()` で `status='active', plan=請求書から再解決` に戻す

---

## 5. ダウングレード時の超過リソース処理（#738 連動）

### 5.1 実装状況

**#738 で実装済み**。`/admin/license` の「プラン変更・支払い管理」ボタン押下時に、ダウングレードで**顧客が何かを失う場合**は Portal 遷移前に確認ダイアログを表示する。開くかどうかの判定は `src/lib/features/admin/downgrade-dialog-policy.ts` の `shouldOpenDowngradeSelector`（`hasExcess`（上限超過リソースあり）または `willLoseHistory`（保持期間短縮）の論理和）を SSOT とする。

### 5.2 挙動

ダウングレード前確認ダイアログ（`DowngradeResourceSelector`）で:

| 項目 | 仕様 |
|------|------|
| 現在リソース表示 | 子供 N 人 / 活動 M 個 / 履歴保持 X 日 |
| ダウングレード先制限 | 子供 2 人 / 活動 3 個 / 履歴 90 日 (free) |
| 超過分 | 「N - 2 人分」「M - 3 個分」を明示 |
| 残すリソース選択 | チェックボックスで「残す」「アーカイブ」を選択 |
| アーカイブ動作 | `is_archived = true, archived_reason = 'downgrade_user_selected'`。物理削除しない |
| アップグレード時の復元 | `is_archived = false` に戻すだけで完全復元可能（既存の `restoreArchivedResources` が `trial_expired` を復元するのと同じ機構） |
| 履歴保持の警告 | 現在の保持日数 > 新プランの保持日数なら、短縮の事実に加えて「新プランの保持期間を超えた記録は削除され、復元できません（再契約でも戻りません）」と警告する。retention 超過分は `retention-cleanup-service` が行ごと削除するため、アーカイブ (上表) と違い復元手段が無い |
| 超過なし + 保持期間短縮あり | 選択 UI は出さず、保持期間短縮の警告だけを出して「プラン変更へ進む」で PIN 確認へ進む |
| 超過なし + 保持期間短縮なし | 失うものが無いのでダイアログを開かず、直接 PIN 確認ダイアログへ進む |

### 5.3 ダウングレード経路のフロー

```
[/admin/license]
  └─ 「プラン変更・支払い管理」ボタン
        │
        ▼
  GET /api/v1/admin/downgrade-preview?targetTier=free
        │
        ├─ hasExcess === true（保持期間短縮の有無は問わない）
        │    └─ DowngradeResourceSelector ダイアログ表示
        │         │
        │         ├─ ユーザーがアーカイブするリソースを選択
        │         ├─ 「アーカイブしてプラン変更へ進む」ボタン
        │         ▼
        │    POST /api/v1/admin/downgrade-archive
        │      body: { targetTier, childIds, activityIds, checklistTemplateIds }
        │         │
        │         ├─ サーバーで is_archived を更新
        │         ├─ 残数が上限以内か検証（失敗→エラー返却）
        │         ▼
        │    成功 → PIN 確認ダイアログ (#771) へ進む
        │
        ├─ hasExcess === false かつ willLoseHistory === true
        │    └─ DowngradeResourceSelector ダイアログ表示（保持期間短縮の警告のみ。選択 UI なし）
        │         └─ 「プラン変更へ進む」→ archive は実行せず PIN 確認ダイアログへ
        │
        ├─ hasExcess === false かつ willLoseHistory === false
        │    └─ 失うものが無いのでダイアログを開かず PIN 確認ダイアログへ直接進む
        ▼
  PIN 確認 → POST /api/stripe/portal → Customer Portal
```

### 5.4 API エンドポイント

| メソッド | パス | 認可 | 説明 |
|---------|------|------|------|
| GET | `/api/v1/admin/downgrade-preview?targetTier={free\|standard\|family}` | owner, parent | 超過リソースのプレビュー取得 |
| POST | `/api/v1/admin/downgrade-archive` | owner, parent | 選択したリソースのアーカイブ実行 |

### 5.5 実装ファイル

| ファイル | 役割 |
|---------|------|
| `src/lib/domain/downgrade-types.ts` | クライアント/サーバー共有型定義 |
| `src/lib/server/services/downgrade-service.ts` | プレビュー計算・アーカイブ実行 |
| `src/routes/api/v1/admin/downgrade-preview/+server.ts` | プレビュー API |
| `src/routes/api/v1/admin/downgrade-archive/+server.ts` | アーカイブ API |
| `src/lib/features/admin/components/DowngradeResourceSelector.svelte` | リソース選択 UI |
| `src/routes/(parent)/admin/license/+page.svelte` | フロー統合 |
| `tests/unit/services/downgrade-service.test.ts` | ユニットテスト |

---

## 6. 課金期間

**月額のみ**。年額プランは #2719 で廃止した。

| プラン | planId | Stripe Price ID 取得元 |
|--------|--------|----------------------|
| standard | `monthly` | `STRIPE_PRICE_STANDARD_MONTHLY` |
| premium | `family-monthly` | `STRIPE_PRICE_FAMILY_MONTHLY` |

年額の planId (`yearly` / `family-yearly`) は `constants/subscription-plan.ts` に残るが、**新規購入の経路は無い**（過去契約の解決のためだけに存在する）。

---

## 7. ライセンスキー適用フロー（Stripe を経由しない昇格）

### 7.1 経路

`/admin/license` の「ライセンスキー適用」フォーム → `?/applyLicenseKey` action → `consumeLicenseKey` サービス。

```
[/admin/license]
  └─ 「ライセンスキーを適用」入力欄
        │
        ▼
  確認ダイアログ
        │
        ▼
  POST ?/applyLicenseKey  (form action)
        │
        ├─ 認可: requireRole(['owner'])  ← parent/child は 403
        ├─ validateLicenseKey(rawKey)
        │    └─ 形式・存在・状態（unused / not expired / not revoked）
        ▼
  consumeLicenseKey(rawKey, tenantId)
        │
        ├─ ライセンスを consumed にマーク
        ├─ tenant.plan を昇格
        ├─ tenant.planExpiresAt を設定（あれば）
        ▼
  { apply: { success: true, plan, planExpiresAt } }
        │
        ▼
  data リロード → PlanStatusCard / 現在のプラン表示が更新
```

### 7.2 Stripe との関係

- ライセンスキーは **Stripe を経由せず** プランを昇格させる
- 用途: キャンペーン配布 / サポート対応 / 法人顧客の請求書払い等
- consumed 後は同じキーを再利用不可（buyer_tenant にロック / #801）
- Stripe Subscription は発生しないため、`stripeSubscriptionId = undefined` のまま
- このため Customer Portal は使用不可（「サブスクリプション無し → プラン選択 UI」が表示される）
- 期限切れ時は `/api/cron/license-key-revoke` 等で自動失効（#821 で実装予定）

---

## 8. 状態マシン（簡略版）

```
                   ┌──────────────┐
                   │     free     │
                   └──────┬───────┘
                          │ checkout (購入)
                          │ or applyLicenseKey
                          ▼
                   ┌──────────────┐
        ┌─────────►│   standard   │◄─────────┐
        │          └──────┬───────┘          │
        │                 │ Portal でアップ  │
        │                 │ (webhook updated)│
        │                 ▼                  │
        │          ┌──────────────┐          │
        │          │    family    │          │
        │          └──────┬───────┘          │
        │                 │ Portal でダウン  │
        │                 │ (webhook updated)│
        │                 └──────────────────┘
        │
        │ 解約 (subscription.deleted)
        │ → status=suspended, plan=undefined
        ▼
   ┌──────────────┐
   │  suspended   │  ※ free 機能に縮退
   └──────────────┘

[並行] payment_failed → status=grace_period, planExpiresAt=now+7d
        │
        ├─ invoice.paid 受信 → status=active に戻る
        └─ 7d 経過＆未払い → suspended に遷移
```

詳細な画面遷移は [`diagrams/plan-change-flow.drawio`](diagrams/plan-change-flow.drawio) を参照。

---

## 9. 確認 UX サマリ

| アクション | 確認 UX | 理由 |
|-----------|---------|------|
| 新規購入 | プラン選択 → 「{プラン}プランで始める」→ Stripe Checkout でカード入力 | Stripe Checkout 自体が確認画面 |
| プラン変更（昇格・降格） | PIN 入力 or 確認フレーズ → Customer Portal に遷移 | #771: 子供誤操作防止 |
| 解約 | 同上 → Customer Portal で「Cancel Plan」 | Stripe Portal の標準 UI |
| 支払い方法更新 | 同上 → Customer Portal で更新 | 同上 |
| ライセンスキー適用 | キー入力 → 確認ダイアログ → 適用 | owner ロールのみ実行可 |

---

## 10. 途中離脱時の状態管理

### 10.1 Checkout 中断

- ユーザーが Stripe Checkout を完了せず戻った場合: cancel_url (`/pricing`) にリダイレクト
- Webhook は発火しないため DB は free のまま
- 副作用なし（Stripe 側で incomplete な session が残るのみ、24h で自動失効）

### 10.2 Customer Portal 中断

- ユーザーが Portal を完了せず閉じた場合: 何も起こらない
- Portal で実際に変更操作を完了しない限り Webhook は発火しない
- DB は変更前の状態を維持

### 10.3 Webhook 受信失敗

- Stripe は自動でリトライ（最大 3 日、指数バックオフ）
- アプリ側で 500 を返した場合 → Stripe が再送
- 200 を返した場合 → 完了扱い
- リコンサイル: Stripe Dashboard の Webhook ログで失敗イベントを目視確認可能。将来的に #821 で自動リトライ・調整 cron を予定

### 10.4 ロールバック

現状、明示的なロールバックは未実装。Webhook が成功した時点で DB は新状態に更新される。

**将来検討 (#823)**: Stripe 側を正として DB を eventually consistent に保つため、定期的に `stripe.subscriptions.list` で全 active subscription をスキャンし、DB と乖離があれば修正する reconcile job を追加する想定。

### 10.5 Webhook 到着順序と収束規則（SSOT — #3960 / #3982）

**Stripe は webhook の配信順序を保証しない**（公式: [Event ordering](https://docs.stripe.com/webhooks#event-ordering)）。
1 回のユーザー操作が複数 event を発火するため、**「どの順序で届いても最終状態が一致する」ことを
設計要件として明示**する。ここが曖昧なまま個別 handler を書いた結果、#3960（plan の巻き戻し）と
#3982（解約状態の巻き戻し）が連続して発生した。

> **本節は「順序」の SSOT であり、「重複」の SSOT ではない。** 同一 `event.id` の重複到達
> （at-least-once delivery / replay）に対する dedup は
> [`billing-redesign/phase5-webhook-idempotency-architecture.md`](billing-redesign/phase5-webhook-idempotency-architecture.md)
> で設計確定済だが **実装は未着手**（同 doc のステータス欄「コード変更は Phase 7」）。
> 順序ガード（本節）と dedup（#2641 設計）は別の防御であり、片方では他方を代替できない。

#### 10.5.1 収束の 3 原則

| # | 原則 | 実装 |
|---|------|------|
| **P1** | **可変な属性は「event の payload」ではなく「Stripe 上の現行 subscription」から解決する** | `handleInvoicePaid` のみ。`invoice.lines` を読まず `subscriptions.retrieve()` の現行 price を SSOT にする（#3960）。**`handleSubscriptionUpdated` は P1 の対象外** — payload の subscription から plan を解決する（`metadata.tenantId` が無いときに通る `resolveSubscriptionContext()` の retrieve は tenant 特定にのみ使う） |
| **P2** | **終端状態 (`canceled` / `incomplete_expired`) を検出した handler は、契約ありきの状態を書き戻さない** | `isSubscriptionTerminal()`（`stripe-service.ts`）。この 2 status は Stripe 上で他の status に戻らないため、「契約はもう存在しない」ことの確定印として使える（#3982）。判定対象は **payload の status** なので、終端の後に非終端 event が後着するケースは P3 が担う |
| **P3** | **契約状態の書き換えは「event 対象 = tenant の現行契約」のときだけ適用する。終端状態は列の集合として 1 箇所で定義し全列を書く** | `applyTenantContractState()` が唯一の書き込み経路（#4026）。`tenant.stripeSubscriptionId` と event の subscription が一致しなければ適用しない。不一致の観測レベルは 3 分岐（`tags.mismatchKind`）: 割り当てなし × 終端 event = warn のみ（解約済みへの正常な後着）/ 割り当てなし × **非終端** event = `stripe-contract-target-mismatch` alert（`tenant-unassigned-live-subscription`。Stripe 上は課金中なのに DB に紐付いておらず「払っているのに機能が開かない」ため人の介入が要る）/ 別 subscription = 同 alert（`other-subscription`）。終端は `TERMINAL_CONTRACT_STATE` = `stripe_subscription_id` / `plan` / `plan_expires_at` を null + `status=suspended`。迂回は `tests/unit/architecture/stripe-contract-write-single-enforcement.test.ts` が禁止する |

`paused` / `unpaid` / `incomplete` は復帰し得るため終端に含めない（含めると復帰経路を殺す）。

P3 の突合は tenant 同定の経路（`metadata.tenantId` / customer 逆引き）が「その tenant が今どの subscription を持つか」と独立であることから必要になる。`checkout.session.completed` だけは契約を**新規に割り当てる** event なので突合対象を持たない（`assign-contract`）。

#### 10.5.2 ユースケース × 到着順 収束表

`E1 → E2` は E1 が先着。**「最終状態」列がどちらの順序でも一致すること**が受入基準。

| # | ユースケース | 発火 event | 到着順 | 最終状態 | 担保 |
|---|---|---|---|---|---|
| U1 | 新規購入 | `checkout.session.completed`, `customer.subscription.updated`(active) | どちらでも | `id=sub_x` / `plan=購入プラン` / `active` | `checkout` が契約を割り当てる。`updated` は payload の price から plan を解決するが、新規購入では payload の price と現行 price が一致するため結果が正しい（P1 ではない）。`updated` が先着した場合は割り当て前なので P3 が適用を見送り、後着の `checkout` が確定させる |
| U2 | プラン変更（standard → premium） | `customer.subscription.updated`(active), `invoice.paid` | どちらでも | `plan=premium` | P1（#3960。旧実装は `invoice.lines.data[0]` = 変更前 price を書いて巻き戻していた） |
| U3 | 支払い失敗 | `invoice.payment_failed` | — | `grace_period` / `planExpiresAt=+7d` | — |
| U4 | 支払い失敗 → 更新して復帰 | `invoice.payment_failed`, `invoice.paid` | 実時系列どおり | `active` | Stripe が時系列に発火（同時発火ではない） |
| U5 | **解約** | `customer.subscription.updated`(canceled), `customer.subscription.deleted` | **どちらでも** | `id=NULL` / `plan=NULL` / `exp=NULL` / `suspended` | **P2 + P3**（先着が終端 4 列を書き、後着は割り当てが消えているため適用されない。P2 がないと updated 後着で `id=NULL` かつ `plan≠NULL`、P3 がないと **非終端** の updated 後着で同じ組合せが残る = U9） |
| U6 | **解約後に当期分請求が後着** | `customer.subscription.deleted`, `invoice.paid` | **どちらでも** | `id=NULL` / `plan=NULL` / `suspended` | **P2**（P2 がないと `invoice.paid` が `status=active` を書き戻し、**解約済みテナントが課金中として復活**する） |
| U7 | **解約後に payment_failed が後着** | `customer.subscription.deleted`, `invoice.payment_failed` | **どちらでも** | 同上 | **P2**（P2 がないと `grace_period` へ巻き戻る） |
| U8 | 解約 → 再購読 | `...deleted`, `checkout.session.completed`(新 sub) | **どちらでも** | `id=sub_new` / `plan=新プラン` / `active` | `stripeCustomerId` を残すこと + U5/U6/U7 の収束（`id` が残っていると `createCheckoutSession` が `ALREADY_SUBSCRIBED` で弾き、そもそも U8 に入れない = #3982 の実害）+ **P3**（旧 sub の event が後着しても現行契約 `sub_new` を指さないため適用されない。P3 がないと新契約の `id` が NULL 化し、ALREADY_SUBSCRIBED ガードが外れて二重課金が成立し得る） |
| U9 | **解約後に非終端の `updated` が後着** | `customer.subscription.deleted`, `customer.subscription.updated`(active) | **どちらでも** | `id=NULL` / `plan=NULL` / `exp=NULL` / `suspended` | **P3**（P2 は payload の status を見るため、この `updated` は終端分岐に入らない。割り当てが消えているため P3 が適用を見送る。P3 がないと `id=NULL` + `plan≠NULL` + `status=active` が残る） |
| U10 | **アプリ内解約（期末解約の予約）** | `/api/v1/admin/tenant/cancel`（**DB を書かない**）, `customer.subscription.updated`(active, `cancel_at_period_end=true`) | **どちらでも** | `id=sub_x` / `plan` 維持 / `active` | #3991。予約は Stripe 側だけで完結し、契約は期末まで生きているので `status` は `active` のまま。期末到来時の `deleted` が U5 の終端 4 列へ収束させる（旧実装が `grace_period` + `exp=+30d` を書いて X3 を作っていた経路は消滅した） |
| U11 | **期末解約の取り消し** | `/api/v1/admin/tenant/reactivate`（**DB を書かない**）, `customer.subscription.updated`(active, `cancel_at_period_end=false`) | **どちらでも** | `id=sub_x` / `plan` 維持 / `active` | #3991。取り消しも Stripe 側だけで完結する。`updated` は現行 price と status を反映するだけなので、どちらが先着しても最終状態は同一 |

回帰テスト: `tests/unit/services/stripe-service.test.ts`
（U2 = `#3960 — ... の順で` 2 本 / U5・U6・U7 = `#3982 — ...` 4 本 + 終端でない `past_due` の対照 1 本 / U8・U9・U10 = `#4026 — ...` 3 本 + `#4055 — ...` 1 本）。U10・U11 の連鎖は `tests/unit/services/period-end-cancellation-chain.test.ts`。
単一強制点の迂回禁止は `tests/unit/architecture/stripe-contract-write-single-enforcement.test.ts`。

#### 10.5.3 未カバー（既知の残課題）

| 項目 | 状態 |
|---|---|
| 同一 `event.id` の重複到達（dedup） | 設計確定・**実装未着手**（#2641 / phase5-webhook-idempotency-architecture.md） |
| 解約予約中の「利用できる最終日」の保持先 | Stripe (`items[].current_period_end`) のみ。DB に列を持たない。`/admin/subscription` の load が都度取得して表示する（#3991。DB に持たせると `plan_expires_at` が dunning 猶予と解約予定日を兼ねて #3986 と同じ多重定義になる） |
| 同一 tenant への webhook 並行処理（handler 間の競合） | 未設計。Lambda 並行実行下では U1〜U8 の順序ガードも read-modify-write の間に割り込まれ得る |
| DB ↔ Stripe の定期 reconcile | 未実装（#823、§10.4） |
| 解約後の猶予期限の顧客向け表示 | 終端クリア（U10）で `plan_expires_at` が null になるため、解約後は画面（`SaasLicensePanel` の「有効期限」行）から期限が消える。顧客への期限告知は解約完了メール（`sendCancellationEmail` の `graceEndDate`）が担う（暫定）。表示の担い手は #3991 で決める |

---

## 11. ライセンスキー方式でのプラン変更 — Phase 1 α（#2100 PO 8 項目 #5 を反映）— deprecated (Epic #2525 で全廃)

> **deprecated (Epic #2525 license key 全廃)**: 本章が記述する「ライセンスキー方式でのプラン変更」は全廃された。プラン変更は Stripe Subscription (Customer Portal / Checkout) が唯一の経路で、license key の発行・併存・revoke は消滅した。`license-key-requirements.md` / `license-subscription-causality.md` はいずれも deprecated (歴史記録)。現行のプラン変更フロー SSOT は `docs/design/billing-redesign/` (`phase1-plan-change-requirements.md` 等)。本章は当時の設計の歴史記録として残す。

### 11.1 設計背景

Standard プランから Family プランへのアップグレードは、Customer Portal 経由（§3 / Stripe Subscription の plan 変更）と並行して、**別ライセンスキーの追加購入による経路**も実装する。Phase 1 では「α 採用 = Family 780 円フル新規購入」を採用し、Phase 2 β（差額 280 円キーのみ追加発行）への移行は PMF 確認後に判断する。

### 11.2 採用案: α 採用（Family 780 円フル新規購入）

Standard プラン契約中の利用者が Family プランに変更する場合、`/admin/license` から **新たに Family プランのライセンスキーを購入** する。

```
[既存契約: Standard ¥500/月、active]
        │
        ▼
[/admin/license] → 「Family プランで始める」ボタン
        │
        ▼
POST /api/stripe/checkout
   body: { planId: 'family-monthly' }   ← Family プラン Price ID で新規 Checkout
        │
        ▼
[Stripe Checkout 完了]
        │
        ▼
checkout.session.completed Webhook
        │
        ├─ 新規 license 発行: kind='purchase', plan='family-monthly', expiresAt=current_period_end
        ├─ tenant.plan = 'family-monthly' に更新（新キーが active）
        │
        └─ 既存 Standard キーの扱い（α 採用例外、license-key-requirements.md §2.3）:
              ├─ 自動 revoke せず status='active' を維持
              └─ current_period_end まで併存（既支払い分のサービス提供義務）
```

### 11.3 Stripe 側の課金

- 既存 Standard subscription は自動継続（次回更新日に ¥500 請求）
- 新規 Family subscription として ¥780/月が追加課金される
- α 採用期間中は **両 subscription が併存** → 利用者は当月のみ ¥1,280 を支払う
- 翌月以降は ¥780/月（Family のみ）に集約。これは Customer Portal で旧 Standard subscription を解約することで実現する想定

### 11.4 Price ID 抽象化（Phase 2 β 移行容易性担保）

将来の Phase 2 β 移行を容易にするため、Price ID は config 抽象化済み（既存仕様）:

| プラン × 期間 | 環境変数 | 用途 |
|---|---|---|
| `family-monthly` | `STRIPE_PRICE_FAMILY_MONTHLY` | Family 月額 |
| `standard-to-family-monthly`（Phase 2 β、未実装） | `STRIPE_PRICE_STANDARD_TO_FAMILY_DIFF_MONTHLY` | 差額 ¥280/月（将来追加候補） |

Phase 2 β 移行時には `STRIPE_PRICE_STANDARD_TO_FAMILY_DIFF_MONTHLY` 等の差額 Price ID を Stripe Dashboard で作成し、本 §11 のフローを差額 Price 経由に切り替える。

### 11.5 既存内部プラン変更経路（Customer Portal）との関係

§3「Stripe Customer Portal 経由のプラン変更」フローと **両方が有効**:

| 経路 | 入口 UI | 適用ケース |
|---|---|---|
| Customer Portal 経由（§3） | `/admin/license` 「プラン変更・支払い管理」ボタン → PIN/Phrase → Stripe Portal | 既存 subscription の plan 変更（Stripe 標準 UX、proration 自動計算） |
| ライセンスキー方式（§11） | `/admin/license` プラン選択カード → 「Family プランで始める」ボタン → 新規 Stripe Checkout | 既存 subscription を残したまま上位プランを追加（α 採用）、ライセンスキー配布 / 法人請求書払い等 |

ユーザー導線の入口違いであり、どちらも実装上有効。UI 上の文言で「既に Standard をご契約中ですか？」「プラン変更は管理画面から」等の case sensitivity 案内を `/admin/license` 側で表示する想定（実装は別 Issue）。

### 11.6 関連 ADR / Issue

- ADR-0013（LP truth: LP / pricing.html に書いた仕様を実装の正とする）
- ADR-0026（archive: ライセンスキーアーキテクチャ）
- ライセンスキー要件: `license-key-requirements.md` §2.3 / §2.9（削除済、git 履歴参照）
- 因果関係マップ: `license-subscription-causality.md`（削除済、git 履歴参照）
- Phase 2 β 移行の判断基準: Phase F deep research 軸 D-6（補佐確認、PMF 後に再評価）

---

## 12. テスト戦略

### 11.1 ユニットテスト（vitest）

- `handleCheckoutCompleted` / `handleSubscriptionUpdated` / `handleSubscriptionDeleted` / `handlePaymentFailed` のモックイベントテスト（既存）
- `planIdFromPriceId` のマッピングテスト
- `createCheckoutSession` の planId バリデーション（INVALID_PLAN 系）
- Portal セッション作成の認可テスト（child=403、owner/parent=200）

### 11.2 E2E（Playwright）

- 既存: `tests/e2e/portal-pin-gate.spec.ts`（PIN 確認ダイアログ表示）
- **未整備**: アップグレード/ダウングレードの実際の Stripe 統合は test mode key が必要なため CI で動かない
- ローカル認証モードでは Stripe API 呼び出しはスタブ化されており、Webhook イベントを直接モック注入してハンドラをテストする想定

---

## 13. 関連

- 設計
  - [06-UI設計書.md §10](06-UI設計書.md) — プラン UI パターン全体（#743）
  - [account-deletion-flow.md](account-deletion-flow.md) — 削除フロー（#746、PR #908 でマージ予定）
  - #738 — ダウングレード前警告フロー（超過リソース処理）
  - #823 — Tenant plan 状態マシン統一 EPIC
- ADR
  - [ADR-0049](../decisions/0049-retention-physical-delete-extended.md) — プラン別履歴保持 + 物理削除ポリシー（旧 archive ADR-0022 の課金×データライフサイクル整合原則は本文と git 履歴に統合）
- 実装
  - `src/routes/(parent)/admin/license/+page.svelte`
  - `src/routes/(parent)/admin/license/+page.server.ts`
  - `src/routes/api/stripe/checkout/+server.ts`
  - `src/routes/api/stripe/portal/+server.ts`
  - `src/routes/api/stripe/webhook/+server.ts`
  - `src/lib/server/services/stripe-service.ts`
  - `src/lib/server/stripe/config.ts`

---

## CHECKOUT_LABELS SSOT (#2346 / EPIC #2345)

Stripe Checkout の `custom_text` 文言は `src/lib/domain/labels.ts` の `CHECKOUT_LABELS` を SSOT とする。`stripe-service.ts` への直書きは禁止 (景表法 5 条 1 号 / 特商法 2022-06 改正最終確認画面ガイドライン整合)。

| key | 値 |
|---|---|
| `CHECKOUT_LABELS.submitMessage` | お支払い後、すぐにお選びのプランの機能をご利用いただけます。 |
| `CHECKOUT_LABELS.afterSubmitMessage` | アプリに戻ってお選びのプランの機能をお楽しみください。 |

`CHECKOUT_TERMS.chosenPlanFeature` = 「お選びのプランの機能」を `terms.ts` の atom として保持し、上記 compound は `${CHECKOUT_TERMS.chosenPlanFeature}` 経由参照する (ADR-0045 atom / compound 責務分離)。「すべての機能」リテラルは production code path 上から完全排除済 (回帰防止: `tests/e2e/integration/stripe-checkout-labels.spec.ts`)。

法的根拠 + 5 項目チェックリストは [19-プライシング戦略書.md §2.4](19-プライシング戦略書.md) 参照。
