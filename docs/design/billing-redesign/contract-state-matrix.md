# 契約状態マトリクス — `families` 4 列の許容組み合わせと遷移

| 項目 | 内容 |
|------|------|
| 版数 | 1.0 |
| 関連 Issue | #3988 |
| SSOT 対象 | `families.status` / `.plan` / `.stripe_subscription_id` / `.plan_expires_at` の**組み合わせ** |

---

## 1. 設計背景

### 課題

`docs/design/billing-redesign/` には契約に関する設計文書が 47 本あり、**機能軸では網羅されている**（解約 / dunning / プラン変更 / 復帰 / 冪等性）。不足しているのは **1 枚の状態遷移表** — `families` の 4 列の**組み合わせとして許される状態の一覧**である。

機能軸で分かれていると、**軸をまたぐ矛盾が設計レビューで検出できない**。「誰が」「どの列に」「何を書くか」を 1 枚に並べた瞬間に見えるが、1 つの機能を見ている限り気づけない類の欠陥が実際に複数発生した（`grace_period` の二重定義 / チャーンを書き手のいない状態で数える、など）。

### この設計書がないと何が困るか

- 新しい webhook handler を足すとき、「書いてよい組み合わせ」の一覧が無いため、**既存の不正状態を再生産する**
- `licenseStatus` / `planTier` は 4 列からの**導出値**であり、元の組み合わせが不正だと導出結果も無意味になる。しかし導出側だけ見ても元の不正には辿り着けない
- KPI（チャーン / 課金ユーザー数）を `status` 単独で数えると、書き手が存在しない状態を数えていても誰も気づかない（§4.2）

---

## 2. 設計原則

1. **`status` は Stripe の状態を写したものであり、退会（アカウント削除）の状態ではない。** 退会は `settings` 表（`soft_deleted_at` / `physical_deletion_date`）が持つ別軸である（§6）
2. **`plan` と `stripe_subscription_id` は同時に生きるか同時に消えるか、のいずれか。** 片方だけ残る状態は不正とする
3. **導出値（`licenseStatus` / `planTier`）に新しい分岐を足す前に、本表に行を足せるかを先に確認する。** 表に無い状態を導出側で救うのは、不正状態を温存することと同じ

---

## 3. 対象 4 列

`src/lib/server/db/dsql/schema.ts:136-163`（`families`）。

| 列 | 型 | 制約 |
|---|---|---|
| `status` | text | `CHECK families_status_ck` = `active` / `grace_period` / `suspended` / `terminated`（`ALL_SUBSCRIPTION_STATUSES`） |
| `plan` | text NULL 可 | CHECK なし（plans lookup は増減集合。DSQL は ALTER 後付け不可のため固定 CHECK を張らない） |
| `stripe_subscription_id` | text NULL 可 | UNIQUE なし（`stripe_customer_id` のみ UNIQUE） |
| `plan_expires_at` | timestamptz NULL 可 | — |

`licenseStatus` は**列ではなく算出値**（schema コメント明記）。

---

## 4. 状態マトリクス

`sub` = `stripe_subscription_id`、`exp` = `plan_expires_at`。「あり/なし」は NULL でないか。

| # | 状態名 | `status` | `plan` | `sub` | `exp` | 意味 | `licenseStatus` | `planTier` | 課金 KPI |
|---|---|---|---|---|---|---|---|---|---|
| **S1** | 未課金 | `active` | なし | なし | なし | サインアップ直後 / トライアル | `none` | trial 中は `trialTier`、外なら `free` | 対象外 |
| **S2** | 課金中 | `active` | あり | あり | なし | 正常な有料契約 | `active` | `plan` に応じ `standard` / `family` | **課金ユーザー** |
| **S3** | 支払い失敗猶予 | `grace_period` | あり | あり | あり（猶予終了日） | dunning 中。**有料機能は維持されるべき** | `active` | `standard` / `family` | 課金ユーザー |
| **S4** | 停止 | `suspended` | あり | あり | 任意 | Stripe が `unpaid` / `paused` / `incomplete` 等（`canceled` / `incomplete_expired` は終端なので S5 へ落ちる） | `suspended` | `free`（trial 判定へ落ちる） | 対象外 |
| **S5** | 契約終了 | `suspended` | なし | なし | なし | 解約が確定し subscription 割り当てが解けた状態 | `none` | `free` | 対象外 |
| **S6** | 退会済 | `terminated` | 任意 | 任意 | 任意 | 退会（アカウント削除）が確定した印。**通常運用では観測されない**（下記） | `none` | `free` | チャーン（legacy 行のみ） |

### 不正状態（書いてはならない組み合わせ）

| # | 組み合わせ | なぜ不正か | 現に起きるか |
|---|---|---|---|
| **X1** | `sub` なし + `plan` あり | 契約が無いのにプランだけ残る。`licenseStatus=none` なのに `plan` を表示する経路が生まれる | 起きない（W5 が 4 列を網羅的にクリアし、後着 event は単一強制点の突合で弾かれる。#3982 / #4026） |
| **X2** | `sub` あり + `plan` なし | 課金しているのにプラン不明。`planTier` が `standard` に丸められ、premium 契約者が standard 扱いになる | 起きうる（checkout の `metadata.planId` が未知のとき。alert は出る） |
| **X3** | `status=active` + `exp` あり | `active` に期限は無い。dunning / 解約の残骸 | 現在の書き手からは起きない（W2 / W4 は `active` を書くとき `exp=null` を同時に書く）。過去に作られた行は §7 ③ の監査で検出する |
| **X4** | `status=grace_period` + `sub` なし | 猶予の対象となる契約が存在しない | 現在の書き手からは起きない（W3 / W4 は現行契約と突合してから書くため `sub` が必ずある。#4026） |

### 4.1 S6 (`terminated`) は通常運用では観測されない

`terminated` は **退会（アカウント削除）済み**を意味する。解約ではない。意味は読み手 3 箇所が一致して示している:

| 読み手 | 挙動 |
|---|---|
| `hooks.server.ts` | 当該テナントを**完全ブロック**。`/auth/login?reason=deleted` へ redirect、API は「アカウントは削除済みです。」 |
| `auth-license-status.ts` | `terminated` → `licenseStatus='none'` |
| `SaasLicensePanel.svelte` | `SUBSCRIPTION_PAGE_LABELS.statusTerminated` を表示 |

一方、退会の物理削除（`purgeExpiredSoftDeletedTenants` → `deleteOwnerOnlyAccount` / `deleteOwnerFullDelete` → `deleteTenant()`）は **`families` 行ごと削除する**。したがって「削除完了を status で表す」ことは構造上できない（status を保持する行が残らない）。残りうるのは legacy 行と手動介入のみである。

**この状態を KPI の分子に使ってはならない** — 恒常的に 0 になる。`hooks.server.ts` の締め出しは legacy 行に対する防御として維持する。

なお退会**申請中**（猶予期間）の状態も `families.status` は持たない。§6 のとおり `settings` の `soft_deleted_at` / `physical_deletion_date` が別軸で持ち、`hooks.server.ts` はそれを読んで読み取り専用ロックをかける。申請時に `terminated` を書くと猶予中に完全ブロックされ、退会の取り消し導線が塞がる。

### 4.2 チャーン（解約）の判定は S5

解約は **S5 = `suspended` かつ `sub` なし**で表現される（`TERMINAL_CONTRACT_STATE` が書く終端）。`suspended` は S4（契約が残り復帰しうる停止）も兼ねるため、`status` 単独では判定できない。

判定の SSOT は `isChurnedContract(tenant)`（`src/lib/domain/constants/subscription-status.ts`）:

```
S5 (suspended + sub なし) → チャーン
S6 (terminated)          → チャーン（legacy 行の救済）
S4 (suspended + sub あり) → チャーンではない（復帰しうる）
```

KPI service（`cohort-analysis` / `ops-analytics` / `pricing-trigger` / `stripe-metrics`）は本関数を経由する。直接比較は `tests/unit/architecture/churn-status-predicate-ssot.test.ts` が禁止する。

**過去分の扱い（バックフィル不要）**: S5 の 4 列は `handleSubscriptionDeleted` が以前から書いていた（`clearSubscriptionAssignment()` が `sub=NULL` / `plan=NULL` / `status=suspended` を書いていた。#4026 で `TERMINAL_CONTRACT_STATE` に集約された際も同じ 4 列）。よって**過去に解約した行も既に S5 の形で残っており、`updated_at` も解約時刻を保持している**。`isChurnedContract` は過去分も遡って数えるため、データ移行やバックフィルは不要。

**既知の残課題**:

- 退会（アカウント削除）は行ごと消えるため、`families` を集計する限り KPI から観測できない。解約（S5）は数えられるが、退会は数えられない。観測するには削除前の事実を別テーブルに残す必要があり、本表の 4 列の範囲では解けない。
- 「当月チャーン」の時刻軸が `families.updated_at` 依存。`families` 行は解約以外の理由でも更新されるため、**過去に解約したテナントが当月チャーンとして再計上されうる**。解約時刻を保持する列（`cancelled_at` 相当）が無い限り構造的に解けない。同様に `ops-analytics` の cohort は分母が無料含む全テナント・分子が有料解約で母集団が揃っていない。

---

## 5. 遷移トリガ一覧（書き手 9 箇所、実読）

`grep -rn "updateTenantStripe\|updateTenantStatus" src/` で全件（repo 実装・interface を除く）。

| # | トリガ | 実装 | 書く内容 | 遷移 |
|---|---|---|---|---|
| W1 | `checkout.session.completed` | `stripe-service.ts` `handleCheckoutCompleted` | `sub` / `plan` / `status=active` / `trialUsedAt` | S1 → S2 / S5 → S2 |
| W2 | `invoice.paid` | `stripe-service.ts` `handleInvoicePaid` | `status=active` + `plan`（未解決なら**保持**） + **`plan_expires_at=null`** | S2/S3/S4 → S2 |
| W3 | `invoice.payment_failed` | `stripe-service.ts` `handlePaymentFailed` | `status=grace_period` + **`plan_expires_at`**（未設定なら `now+7d` / 既にあれば無変更。W4 と共通の `graceExpiresAtPatch()`、§5.2） | S2/S3/S4 → S3 |
| W4 | `customer.subscription.updated` | `stripe-service.ts` `handleSubscriptionUpdated` | 非終端: `plan`（未解決なら保持）+ `status`（Stripe status を正規化）+ **`plan_expires_at`**（`active` 復帰 → `null` / `grace_period` は `graceExpiresAtPatch()`（§5.2）/ それ以外は無変更。`planExpiresAtPatchFor()`） / 終端: W5 と同じ 4 列 | S2/S3/S4 → S2（`active` / `trialing`）/ S2/S3/S4 → S3（`past_due`）/ S2/S3/S4 → S4（`unpaid` / `paused` / `incomplete`）/ S2/S3/S4 → S5（終端） |
| W5 | `customer.subscription.deleted` | `stripe-service.ts` `handleSubscriptionDeleted` | `sub=NULL` / `plan=NULL` / `exp=NULL` / `status=suspended`（`TERMINAL_CONTRACT_STATE` の 4 列を網羅、#4026） | S2/S3/S4 → S5 |
| W6 | アプリ内解約 | `tenant/cancel/+server.ts` | **書かない**（Stripe に `cancel_at_period_end=true` を予約するのみ、#3991） | なし（期末に W5 が S5 へ移す） |
| W7 | 解約取り消し | `tenant/reactivate/+server.ts` | **書かない**（Stripe の `cancel_at_period_end=false`、#3991） | なし |
| W8 | （欠番）退会猶予満了バッチ | — | **書き手なし**。退会の物理削除は `families` 行ごと削除するため status を書かない（§4.1） | なし |
| W9 | （テナント作成） | `createTenant` | `status=active` のみ | なし（行の新規作成。S1 を作る） |

### 5.1 `遷移` 列の読み方と機械検証

`遷移` 列は **`families` の 4 列が実際に書き換わる組み合わせ**を列挙する。書式は 2 つだけ:

- `S2 → S3`（左辺は `S2/S3/S4 → S5` のように `/` で複数可）
- `S2 ⇄ S3`（両向き）

**契約状態を書かない書き手は「なし」**と書く。Stripe 側だけが変わる操作（W6 / W7）に遷移を書くと、
表を読んだ人が「DB が動く」と誤解する。W9 は行の新規作成で開始状態が存在しないため遷移ではない。

本列は `tests/unit/architecture/contract-transition-matrix-ssot.test.ts` が機械照合する。
handler を実際に呼び、**開始状態 S1〜S5 × Stripe subscription status 8 種**を総当たりして
書き込み前後を `classifyContractState()` で分類し、観測集合と本列を**双方向**で突き合わせる
（表にあって実装に無い / 実装にあって表に無い、の両方で fail する）。

検証が届かない範囲は同 test の `UNCOVERED_WRITERS` に理由付きで列挙する。加えて、
**状態クラスが同じで列の値だけが違う書き込み**（例: `grace_period` のまま猶予終了日を書き換える）は
遷移としては同一に見えるため本列の対象外で、`tests/unit/services/stripe-contract-state-classification.test.ts`
が列の値まで見る。

読み取り上の注意:

- **W2 / W3 / W4 の左辺に S4 が入るのは、event の到着順が保証されないため。** Stripe が
  `unpaid` / `paused` を経た契約に後続の invoice event を送ることがあり、実装は現行 subscription を
  SSOT として書き戻す（S4 → S2 は支払い成功による復帰であり、顧客の有料機能が戻る正しい遷移）
- **W1 の左辺が S1 と S5 だけなのは、`createCheckoutSession()` が `sub` を持つテナントの
  checkout を `ALREADY_SUBSCRIBED` で拒む**ため。S5（解約済）からの再購読はこの経路で S2 に戻る
- S6（退会済）を開始状態とする遷移は本表に無い。§4.1 のとおり legacy 行としてしか存在せず、
  `hooks.server.ts` が当該テナントを完全ブロックする

### 5.2 dunning 猶予の終了日は「最初の支払い失敗から 7 日」

`grace_period` の `plan_expires_at` を決める規則は **1 つだけ**であり、W3 / W4 の両方が
`stripe-service.ts` の `graceExpiresAtPatch()` を通す。

- 猶予終了日が**未設定なら** `now + 7d` を立てる（S3 は `exp` あり必須）
- 猶予終了日が**既にあるなら触らない**

Stripe の dunning は同じ invoice を複数回 retry し、そのたび W3（`invoice.payment_failed`）と
W4（`past_due` の updated）を送る。retry ごとに `now + 7d` を書き直すと猶予の終わりが先送りされ、
**支払い失敗が続く間は猶予が一度も明けない**。`plan_expires_at` を読む唯一の顧客向け処理である
期限前リマインドメール（`lifecycle-email-service`、残り 30/7/1 日）も、残り日数が 7 に張り付いて
最終通知が届かなくなる。

到達可否（entitlement）は `status` で判定され本列を読まないため、本規則は機能の可否を変えない。
規則の固定は `tests/unit/services/stripe-contract-state-classification.test.ts`（#4416、W3 / W4 を
同じ入力で駆動して突き合わせる）と `tests/unit/services/lifecycle-email-service.test.ts`（残り日数）。

### 5.3 有料契約の確定でトライアルを閉じる（#4707）

`trial_history` は本表の 4 列の外にあるが、**S1（trial 中）→ S2 の遷移と同時に閉じる**。閉じないと
`planTier` は `standard` / `family` に解決される一方で `computeTrialStatus` が「トライアル中（残り N 日）」
を返し続け、払った直後の顧客に「本契約が必要です」と「⭐ 残り N 日」が出続け、終了予告メールも届く。

| 契機 | 実装 | 書く内容 |
|---|---|---|
| W1 `checkout.session.completed`（reconcile 経由を含む） | `stripe-service.ts` `closeTrialOnPaidContract` → `trial-service.ts` `endTrialOnConversion` | 最新 trial 行に `stripe_subscription_id` / `upgrade_reason` を記録。trial が有効（JST 暦日で `end_date ≥ 今日`）なら `end_date = 今日`。終了済みなら `end_date` は触らない |
| W2 `invoice.paid`（現行契約に適用されたときだけ） | 同上 | 同上（W1 未達時の救済。同一 subscription で移行済みなら no-op） |

規則:

- **移行済み（`stripe_subscription_id` あり）の trial 行は `end_date` に関わらず終了扱い**（`isTrialActive=false`、`trialUsed=true`）。`findActiveTrials`（終了予告 cron の対象抽出）も除外する
- **第 2 防御**: 表示（admin layout / `/admin/subscription`）と通知（`getNotificationSchedule` / `getTrialExpirationInfo`）は `getTrialStatus(tenantId, licenseStatus)` を通し、`licenseStatus = active`（S2 / S3）なら trial 行の状態に関わらず「トライアル中」にしない。webhook 未達 / 旧データでも払った顧客にトライアル表示を出さない
- trial 行の書き込み失敗で webhook 全体を失敗させない（契約状態の確定が主。失敗は error log、次の event で再試行）
- トライアルの有効期間は **JST 暦日で `end_date` 当日いっぱい**。tier 判定（`resolvePlanTier`）と表示判定（`computeTrialStatus`）は同じ述語 `isTrialEndDateActiveJST`（`src/lib/domain/trial-period.ts`）を共有する

検証: `tests/unit/services/stripe-service.test.ts`（W1 / W2 で閉じる・冪等・失敗非伝播）/ `tests/unit/services/trial-service.test.ts`（移行済み行・licenseStatus 射影）/ `tests/unit/services/plan-limit-service.test.ts`（最終日 JST 全時間帯の tier）/ `tests/unit/db/dsql-family-satellite-repos.test.ts`（repo 層）。

### 書き手を増やさない起動点: checkout reconciliation（#3958）

`/admin/subscription?session_id=cs_…`（Stripe checkout の success_url）は `reconcileCheckoutSession`
（`stripe-service.ts`）を経て **W1 と同じ `handleCheckoutCompleted` に合流する**。webhook が届かなくても
顧客の画面復帰だけで S1 → S2 に遷移できる救済経路であり、**新しい書き手ではない**（列の書き分けが
W1 と一致するため、片方だけ直る不整合が生まれない）。

反映前に「session の subscription == `tenants.stripe_subscription_id`」を突合し、一致していれば
書き込みも通知も行わない。webhook 先着・URL 再訪・リロードはいずれもこの突合で吸収される。

### `grace_period` は支払い失敗の dunning だけを意味する

`grace_period` を書くのは **W3 と W4 の `past_due` 分岐だけ**である（#3986 → #3991）。解約申請の
猶予は Stripe の `cancel_at_period_end` が持ち、DB の契約状態には現れない。

この status に退会（アカウント削除）向けの機構を接続してはならない。読み取り専用ロック
（`hooks.server.ts`）と物理削除バッチ（`tenant-cleanup` → `purgeExpiredSoftDeletedTenants`）は
どちらも settings の `soft_deleted_at` を条件とする（§6）。支払い失敗は子供の利用体験を止めない
（`phase1-dunning-requirements.md` NFR-3 / US-4）。

**S4（`suspended`）は読み取り専用ではない。** `authorization.ts` は `suspended` でも
`allowed: true` を返す — 解約完了 = 無料プラン相当という扱いであり（#3993 PO 判断）、
書き込みを止める分岐は存在しない。

---

## 6. 退会（アカウント削除）は別軸である

`status` に退会の状態は無い。退会は `settings` 表が持つ。

| 項目 | 契約軸（本表） | 退会軸 |
|---|---|---|
| 置き場 | `families.status` ほか 4 列 | `settings` の `soft_deleted_at` / `deletion_grace_plan_tier` / `physical_deletion_date` |
| 書き手 | W1〜W9 | `softDeleteTenant()`（`grace-period-service.ts:67-110`） |
| 猶予日数 | dunning 7 日（`config.ts`） | プラン別 free 0 / standard 7 / premium 30（`DELETION_GRACE_PERIOD_DAYS`。**コード上の key は `family`** — 顧客向け表示名 premium の内部コード） |

**`softDeleteTenant()` は `families` を一切触らない。** したがって「退会申請済み」は本表のどの行にも現れない。読み取り専用ロックと物理削除は契約軸ではなくこちらを条件とする（#3993）。

---

## 7. 表に無い状態を検出する手段（#3988 AC3 の決定）

### 決定: **ドメイン層の判定関数 + 定期監査**を採る。CHECK 制約は採らない

| 案 | 判定 | 理由 |
|---|---|---|
| CHECK 制約 | **不採用** | 4 列の組み合わせ CHECK は後から張る必要があるが、DSQL は ALTER 後付けに制約があり（schema コメント §10-5「CHECK 固定だと ALTER 後付け不可で新プラン投入が表再構築になる」）、`plan` に CHECK を張らない既存判断と整合しない。**不正状態を書き込む経路（W1-W9）を塞ぐのが先**であり、DB 側で弾いても書き手のバグは残る |
| gate スクリプト | **不採用（単独では）** | 静的解析で「どの組み合わせが書かれるか」を導出するのは、`updateTenantStripe` の部分更新セマンティクス（`undefined` = 保持）があるため不可能に近い（「静的に読むと正しく見えるが効果が違う」形になる）。ただし「書き込み経路が単一関数を通ること」自体は静的に強制できる（`stripe-contract-write-single-enforcement.test.ts`、#4026） |
| **判定関数 + 定期監査** | **採用** | 許容集合をドメイン層の SSOT にし、(a) 書き手の unit test が「書いた結果が許容集合に入る」ことを assert できる、(b) 運用側が本番行を突合できる、の両方に使える |

### 実装（3 段とも稼働）

| # | 手段 | 実体 |
|---|---|---|
| ① | 許容集合（S1-S6）と分類関数 | `src/lib/domain/contract-state.ts` の `classifyContractState()`（#4181）。表と実装の対応は `tests/unit/architecture/contract-state-matrix-ssot.test.ts` が機械照合する |
| ② | webhook handler の書き込み後状態を分類して assert | `tests/unit/services/stripe-contract-state-classification.test.ts`（#4181）。X1-X4 に分類されたら fail する。**「意図と効果の乖離」はここで落ちる** |
| ③ | 定期監査（`/ops` or cron）で本番行を分類し X1-X4 を報告 | `contract-state-audit-service.ts` の `auditContractStates()`（`/ops` アクセス毎の on-demand 分類、#4249）。①② は「これから書く行」しか見ないため、既に不正な既存行はこの手だけが検出する |

①② に加えて、**書き手どうしの遷移**（どの状態からどの状態へ動くか）は
`tests/unit/architecture/contract-transition-matrix-ssot.test.ts` が §5 の `遷移` 列と双方向照合する（§5.1）。

検出した行への一次対応（確認手順・是正手順・決裁）は [`contract-state-audit-remediation.md`](../../runbooks/contract-state-audit-remediation.md) が SSOT。

---

## 7.1 状態を画面に出すときの SSOT

本表は `families` の列がどう組み合わさるかを定める。**その状態を顧客にどう見せるか**（告知文言 / 請求履歴の到達性 / 書き込み可否）は `src/lib/domain/contract-state-view.ts` の `CONTRACT_STATE_VIEW` が持ち、本表の S1〜S5 に 1:1 対応する（S6 = 退会は画面到達前にブロックされるため対象外）。仕様は `06-UI設計書.md` §4.7c。

**請求導線を `stripe_subscription_id` で出し分けてはならない。** 契約は解約で消えるが `stripe_customer_id` は残る（§4 S5）。請求書・領収書は過去の取引に紐づくため後者で判定する（契約で判定すると解約済みの顧客が領収書に到達できなくなる、#4156）。

## 8. 関連

- #4181（§7 ①② の実装）/ #4249（§7 ③ 定期監査の実装）/ #4118（§5.1 遷移の機械照合）
- #3982 / #4026（W5 の終端 4 列 + 単一強制点）/ #3986 → #3991（`grace_period` の一意化）/ #3987（チャーン判定）/ #3993（退会機構の付け替え）
- `phase1-cancellation-requirements.md` FR-1 / NFR-2（期末解約）
- `phase1-dunning-requirements.md` FR-1 / NFR-3 / US-1 / US-4（支払い失敗で子供の体験を止めない）
- `docs/design/08-データベース設計書.md`（`families` 列定義）
- `docs/design/plan-change-flow.md` §10.5（webhook 到着順 × 収束）
