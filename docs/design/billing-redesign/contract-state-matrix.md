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

機能軸で分かれていると、**軸をまたぐ矛盾が設計レビューで検出できない**。列の組み合わせを並べた瞬間に見えるが、1 つの機能を見ている限り気づけない類の欠陥が実際に複数発生した（§5）。

### この設計書がないと何が困るか

- 新しい webhook handler を足すとき、「書いてよい組み合わせ」の一覧が無いため、**既存の不正状態を再生産する**
- `licenseStatus` / `planTier` は 4 列からの**導出値**であり、元の組み合わせが不正だと導出結果も無意味になる。しかし導出側だけ見ても元の不正には辿り着けない
- KPI（チャーン / 課金ユーザー数）は `status` 単独で数えている。書き手が存在しない状態を数えていても誰も気づかない（§5 D3）

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
| **X3** | `status=active` + `exp` あり | `active` に期限は無い。dunning / 解約の残骸 | **起きる**（§5 D2） |
| **X4** | `status=grace_period` + `sub` なし | 猶予の対象となる契約が存在しない | 起きうる |

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
| W1 | `checkout.session.completed` | `stripe-service.ts` `handleCheckoutCompleted` | `sub` / `plan` / `status=active` / `trialUsedAt` | S1 → S2 |
| W2 | `invoice.paid` | `stripe-service.ts` `handleInvoicePaid` | `status=active` + `plan`（未解決なら**保持**） + **`plan_expires_at=null`** | S3 → S2 / S2 → S2 |
| W3 | `invoice.payment_failed` | `stripe-service.ts` `handlePaymentFailed` | `status=grace_period` / `exp = now + 7d` | S2 → S3 |
| W4 | `customer.subscription.updated` | `stripe-service.ts` `handleSubscriptionUpdated` | 非終端: `plan`（未解決なら保持）+ `status`（Stripe status を正規化）+ **`plan_expires_at`**（`active` 復帰 → `null` / `grace_period` 入りで未設定なら `now+7d` / それ以外は無変更。`planExpiresAtPatchFor()`） / 終端: W5 と同じ 4 列 | S2 ⇄ S3 / → S4 / → S5 |
| W5 | `customer.subscription.deleted` | `stripe-service.ts` `handleSubscriptionDeleted` | `sub=NULL` / `plan=NULL` / `exp=NULL` / `status=suspended`（`TERMINAL_CONTRACT_STATE` の 4 列を網羅、#4026） | S2/S3/S4 → S5 |
| W6 | アプリ内解約 | `tenant/cancel/+server.ts` | **書かない**（Stripe に `cancel_at_period_end=true` を予約するのみ、#3991） | S2 → S2（期末に W5 で S5 へ） |
| W7 | 解約取り消し | `tenant/reactivate/+server.ts` | **書かない**（Stripe の `cancel_at_period_end=false`、#3991） | S2 → S2 |
| W8 | （欠番）退会猶予満了バッチ | — | **書き手なし**。退会の物理削除は `families` 行ごと削除するため status を書かない（§4.1） | — |
| W9 | （テナント作成） | `createTenant` | `status=active` のみ | → S1 |

### 書き手を増やさない起動点: checkout reconciliation（#3958）

`/admin/subscription?session_id=cs_…`（Stripe checkout の success_url）は `reconcileCheckoutSession`
（`stripe-service.ts`）を経て **W1 と同じ `handleCheckoutCompleted` に合流する**。webhook が届かなくても
顧客の画面復帰だけで S1 → S2 に遷移できる救済経路であり、**新しい書き手ではない**（列の書き分けが
W1 と一致するため、片方だけ直る不整合が生まれない）。

反映前に「session の subscription == `tenants.stripe_subscription_id`」を突合し、一致していれば
書き込みも通知も行わない。webhook 先着・URL 再訪・リロードはいずれもこの突合で吸収される。

### 表と実装のズレ（実読で確認、いずれも別 Issue で対処中）

| ID | ズレ | 実装の事実 | Issue |
|---|---|---|---|
| **D2** | W6 と W3 が同じ `grace_period` に書く | **解消済**。W6 / W7 は DB の契約状態を書かなくなり、`grace_period` の書き手は W3 / W4 (`past_due`) = **支払い失敗の dunning のみ**に一意化された。「解約申請中か」の SSOT は Stripe の `cancel_at_period_end` | #3986 → #3991（解消済） |
| **D3** | S6 (`terminated`) に書き手がいない | 退会の物理削除は行ごと消すため status を残せない（§4.1）。`terminated` だけを見ていた KPI 3 本は恒常 0 を返していた。**解約は S5 で数える**ように是正済（`isChurnedContract`、§4.2） | #3987（解消済） |
| **D4** | S4 に実効果が無い | `authorization.ts:171-173` は `suspended` でも `allowed: true` を返す。「読み取り専用」というコメントと実装が不一致 | #3982 / #3993 |
| **D5** | W3 が退会向け機構を誤発火させる | `grace_period` は `hooks.server.ts:430` の**読み取り専用ロック**と `tenant-cleanup` の**物理削除対象**のトリガでもある。支払い失敗しただけで子どもが記録できなくなる | **#3993（critical）** |

**これらは、機能軸の文書を個別に読んでいる限り見えない。** 本表のように「誰が」「どの列に」「何を書くか」を 1 枚に並べた時点で、W3 と W6 が同じセルに書いていること（D2）、S6 に書き手がいないこと（D3）が同時に見える。

---

## 6. 退会（アカウント削除）は別軸である

`status` に退会の状態は無い。退会は `settings` 表が持つ。

| 項目 | 契約軸（本表） | 退会軸 |
|---|---|---|
| 置き場 | `families.status` ほか 4 列 | `settings` の `soft_deleted_at` / `deletion_grace_plan_tier` / `physical_deletion_date` |
| 書き手 | W1〜W9 | `softDeleteTenant()`（`grace-period-service.ts:67-110`） |
| 猶予日数 | dunning 7 日（`config.ts`） | プラン別 free 0 / standard 7 / premium 30（`DELETION_GRACE_PERIOD_DAYS`） |

**`softDeleteTenant()` は `families` を一切触らない。** したがって「退会申請済み」は本表のどの行にも現れない。読み取り専用ロックと物理削除がこちらではなく契約軸に繋がっているのが D5（#3993）である。

---

## 7. 表に無い状態を検出する手段（#3988 AC3 の決定）

### 決定: **ドメイン層の判定関数 + 定期監査**を採る。CHECK 制約は採らない

| 案 | 判定 | 理由 |
|---|---|---|
| CHECK 制約 | **不採用** | 4 列の組み合わせ CHECK は後から張る必要があるが、DSQL は ALTER 後付けに制約があり（schema コメント §10-5「CHECK 固定だと ALTER 後付け不可で新プラン投入が表再構築になる」）、`plan` に CHECK を張らない既存判断と整合しない。**不正状態を書き込む経路（W1-W9）を塞ぐのが先**であり、DB 側で弾いても書き手のバグは残る |
| gate スクリプト | **不採用（単独では）** | 静的解析で「どの組み合わせが書かれるか」を導出するのは、`updateTenantStripe` の部分更新セマンティクス（`undefined` = 保持）があるため不可能に近い（「静的に読むと正しく見えるが効果が違う」形になる）。ただし「書き込み経路が単一関数を通ること」自体は静的に強制できる（`stripe-contract-write-single-enforcement.test.ts`、#4026） |
| **判定関数 + 定期監査** | **採用** | 許容集合をドメイン層の SSOT にし、(a) 書き手の unit test が「書いた結果が許容集合に入る」ことを assert できる、(b) 運用側が本番行を突合できる、の両方に使える |

### 実装（3 段のうち ①② が稼働、③ は未実装）

| # | 手段 | 実体 |
|---|---|---|
| ① | 許容集合（S1-S6）と分類関数 | `src/lib/domain/contract-state.ts` の `classifyContractState()`（#4181）。表と実装の対応は `tests/unit/architecture/contract-state-matrix-ssot.test.ts` が機械照合する |
| ② | webhook handler の書き込み後状態を分類して assert | `tests/unit/services/stripe-contract-state-classification.test.ts`（#4181）。X1-X4 に分類されたら fail する。**「意図と効果の乖離」はここで落ちる** |
| ③ | 定期監査（`/ops` or cron）で本番行を分類し X1-X4 を報告 | `contract-state-audit-service.ts` の `auditContractStates()`（`/ops` アクセス毎の on-demand 分類、#4249）。①② は「これから書く行」しか見ないため、既に不正な既存行はこの手だけが検出する |

**③ は #3993 の後に入れる。** X3 を作る書き手が現役のうちに監査を回すと、本番で恒常的に不正を報告し続ける（狼少年になる）。

検出した行への一次対応（確認手順・是正手順・決裁）は [`contract-state-audit-remediation.md`](../../runbooks/contract-state-audit-remediation.md) が SSOT。

---

## 7.1 状態を画面に出すときの SSOT

本表は `families` の列がどう組み合わさるかを定める。**その状態を顧客にどう見せるか**（告知文言 / 請求履歴の到達性 / 書き込み可否）は `src/lib/domain/contract-state-view.ts` の `CONTRACT_STATE_VIEW` が持ち、本表の S1〜S5 に 1:1 対応する（S6 = 退会は画面到達前にブロックされるため対象外）。仕様は `06-UI設計書.md` §4.7c。

**請求導線を `stripe_subscription_id` で出し分けてはならない。** 契約は解約で消えるが `stripe_customer_id` は残る（§4 S5）。請求書・領収書は過去の取引に紐づくため後者で判定する（契約で判定すると解約済みの顧客が領収書に到達できなくなる、#4156）。

## 8. 関連

- #4181（§7 ①② の実装）/ #4249（§7 ③ 定期監査の実装）
- #3982 / #4026（W5 の終端 4 列 + 単一強制点）/ #3982（D4）/ #3986 → #3991（D2）/ #3987（D3）/ **#3993 critical（D5）**
- `phase1-cancellation-requirements.md` FR-1 / NFR-2（期末解約）
- `phase1-dunning-requirements.md` FR-1 / NFR-3 / US-1 / US-4（支払い失敗で子供の体験を止めない）
- `docs/design/08-データベース設計書.md`（`families` 列定義）
- `docs/design/plan-change-flow.md` §10.5（webhook 到着順 × 収束）
