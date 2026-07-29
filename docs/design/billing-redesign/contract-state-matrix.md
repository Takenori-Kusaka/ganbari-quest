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
| **S4** | 停止 | `suspended` | あり | あり | 任意 | Stripe が `unpaid` / `incomplete_expired` 等 | `suspended` | `free`（trial 判定へ落ちる） | 対象外 |
| **S5** | 契約終了 | `suspended` | なし | なし | なし | 解約が確定し subscription 割り当てが解けた状態 | `none` | `free` | 対象外 |
| **S6** | データ削除済 | `terminated` | 任意 | 任意 | 任意 | 退会猶予満了で物理削除済 | `suspended` or `none` | `free` | **チャーン** |

### 不正状態（書いてはならない組み合わせ）

| # | 組み合わせ | なぜ不正か | 現に起きるか |
|---|---|---|---|
| **X1** | `sub` なし + `plan` あり | 契約が無いのにプランだけ残る。`licenseStatus=none` なのに `plan` を表示する経路が生まれる | 起きない（W5 が 4 列を網羅的にクリアし、後着 event は単一強制点の突合で弾かれる。#3982 / #4026） |
| **X2** | `sub` あり + `plan` なし | 課金しているのにプラン不明。`planTier` が `standard` に丸められ、premium 契約者が standard 扱いになる | 起きうる（checkout の `metadata.planId` が未知のとき。alert は出る） |
| **X3** | `status=active` + `exp` あり | `active` に期限は無い。dunning / 解約の残骸 | **起きる**（§5 D2） |
| **X4** | `status=grace_period` + `sub` なし | 猶予の対象となる契約が存在しない | 起きうる |

---

## 5. 遷移トリガ一覧（書き手 9 箇所、実読）

`grep -rn "updateTenantStripe\|updateTenantStatus" src/` で全件（repo 実装・interface を除く）。

| # | トリガ | 実装 | 書く内容 | 遷移 |
|---|---|---|---|---|
| W1 | `checkout.session.completed` | `stripe-service.ts` `handleCheckoutCompleted` | `sub` / `plan` / `status=active` / `trialUsedAt` | S1 → S2 |
| W2 | `invoice.paid` | `stripe-service.ts` `handleInvoicePaid` | `status=active` + `plan`（未解決なら**保持**） | S3 → S2 / S2 → S2 |
| W3 | `invoice.payment_failed` | `stripe-service.ts` `handlePaymentFailed` | `status=grace_period` / `exp = now + 7d` | S2 → S3 |
| W4 | `customer.subscription.updated` | `stripe-service.ts` `handleSubscriptionUpdated` | 非終端: `plan`（未解決なら保持）+ `status`（Stripe status を正規化） / 終端: W5 と同じ 4 列 | S2 ⇄ S3 / → S4 / → S5 |
| W5 | `customer.subscription.deleted` | `stripe-service.ts` `handleSubscriptionDeleted` | `sub=NULL` / `plan=NULL` / `exp=NULL` / `status=suspended`（`TERMINAL_CONTRACT_STATE` の 4 列を網羅、#4026） | S2/S3/S4 → S5 |
| W6 | アプリ内解約 | `tenant/cancel/+server.ts:79` | `status=grace_period` / `exp = now + 30d` | S2 → S3 |
| W7 | 解約取り消し | `tenant/reactivate/+server.ts:63` | `status=active` / `exp=undefined` | S3 → S2 |
| W8 | 退会猶予満了バッチ | `tenant-cleanup/+server.ts:64` | `status=terminated` | → S6 |
| W9 | （テナント作成） | `createTenant` | `status=active` のみ | → S1 |

### 表と実装のズレ（実読で確認、いずれも別 Issue で対処中）

| ID | ズレ | 実装の事実 | Issue |
|---|---|---|---|
| **D2** | W6 と W3 が同じ `grace_period` に書く | 「支払い失敗の猶予」と「解約申請の猶予」が同一値。しかも W6 は 30 日固定、W3 は 7 日で**日数も規約と不一致** | #3986 → #3991 に統合 |
| **D3** | S6 (`terminated`) の書き手が W8 のみ | しかも W8 は cron 未登録（`CRON_JOBS` に `tenant-cleanup` 無し）+ `dryRun` 既定 true。**実質書き手ゼロ**でチャーン KPI が恒常 0 になりうる | #3987 |
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

## 7. 表に無い状態を検出する手段（AC3 の決定）

### 決定: **ドメイン層の判定関数 + 定期監査**を採る。CHECK 制約は採らない

| 案 | 判定 | 理由 |
|---|---|---|
| CHECK 制約 | **不採用** | 4 列の組み合わせ CHECK は後から張る必要があるが、DSQL は ALTER 後付けに制約があり（schema コメント §10-5「CHECK 固定だと ALTER 後付け不可で新プラン投入が表再構築になる」）、`plan` に CHECK を張らない既存判断と整合しない。**不正状態を書き込む経路（W1-W9）を塞ぐのが先**であり、DB 側で弾いても書き手のバグは残る |
| gate スクリプト | **不採用（単独では）** | 静的解析で「どの組み合わせが書かれるか」を導出するのは、`updateTenantStripe` の部分更新セマンティクス（`undefined` = 保持）があるため不可能に近い（「静的に読むと正しく見えるが効果が違う」形になる）。ただし「書き込み経路が単一関数を通ること」自体は静的に強制できる（`stripe-contract-write-single-enforcement.test.ts`、#4026） |
| **判定関数 + 定期監査** | **採用** | 許容集合をドメイン層の SSOT にし、(a) 書き手の unit test が「書いた結果が許容集合に入る」ことを assert できる、(b) 運用側が本番行を突合できる、の両方に使える |

### 実装方針（本 Issue のスコープ外、follow-up）

本 Issue の AC3 は「**手段を決める**」であり実装は含まない。決定に基づく実装は以下の順で行う。

<!-- doc-code-refs: ignore-line -->
1. ドメイン層（`src/lib/domain/` 配下、新規ファイル）に許容集合（S1-S6）と分類関数 `classifyContractState()` を置く
2. 各 webhook handler の unit test で「handler 適用後の行が S1-S6 のいずれかに分類される」ことを assert する。**「意図と効果の乖離」はこの assert で落ちる**（#3982 / #4026 の契約テストが先例）
3. 定期監査（`/ops` or cron）で本番行を分類し、X1-X4 に該当する行を報告する

**先に #3991 / #3993 を入れる。** X1 を作る書き手は #3982 / #4026 で塞いだが、X3 を作る書き手が現役なので、判定関数を先に入れると本番で恒常的に不正を報告し続ける（狼少年になる）。

---

## 8. 関連

- #3982 / #4026（W5 の終端 4 列 + 単一強制点）/ #3982（D4）/ #3986 → #3991（D2）/ #3987（D3）/ **#3993 critical（D5）**
- `phase1-cancellation-requirements.md` FR-1 / NFR-2（期末解約）
- `phase1-dunning-requirements.md` FR-1 / NFR-3 / US-1 / US-4（支払い失敗で子供の体験を止めない）
- `docs/design/08-データベース設計書.md`（`families` 列定義）
- `docs/design/plan-change-flow.md` §10.5（webhook 到着順 × 収束）
