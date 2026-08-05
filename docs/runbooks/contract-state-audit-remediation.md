# 契約状態監査 (`/ops` X1-X4) の一次対応 runbook

`/ops` の「契約状態」カード（`ContractStateAuditCard.svelte`）が報告する不正状態 (X1-X4) /
未分類状態 (`UNCLASSIFIED`) について、**検出された行に対して誰が何を確認しどう是正するか**を定める。

状態の定義そのもの（S1-S6 / X1-X4 の意味、判定順、書き手一覧）は
[`contract-state-matrix.md`](../design/billing-redesign/contract-state-matrix.md) §4 が SSOT。
本 runbook はその「在庫」が出たときの運用手順のみを持つ。

---

## 1. どこで見るか

`/ops` を開くと毎回、全テナントの `families` 4 列
（`status` / `plan` / `stripe_subscription_id` / `plan_expires_at`）を
`classifyContractState()` で分類し直す（cron ではなく on-demand、`auditContractStates()`）。
問題行（X1-X4 + `UNCLASSIFIED`）は `tenantId` / 分類 / `status` / 4 列の有無（値そのものは出さない）
の一覧で表示される。プライバシー上、氏名・メール・Stripe customer ID はここに出ない。

## 2. 是正の原則

**直接 SQL で `families` を書き換えることを既定にしない。** 契約状態の書き込みは
`updateTenantStripe()` という単一強制点を通る設計（matrix §7）で、各 webhook handler
（`stripe-service.ts`）がその唯一の書き手になっている。この経路を迂回して手で 4 列を書くと、
**単一強制点の前提が崩れ、次に別の webhook が来たときにまた不整合を作る**可能性がある。

優先順位:

1. **まず、その行に対応する Stripe 側の実データ（subscription / customer）を確認する。**
   Stripe Dashboard で `stripe_customer_id` から辿る（`/ops` には出ないため、DB を直接 SELECT する
   か、テナント管理画面の該当テナントから確認する）。
2. **可能なら、正規の webhook を再送して直させる。** Stripe Dashboard の対象 event から
   resend するか `stripe events resend <event_id>`（`docs/runbooks/silent-failure-alert-response.md`
   §2.3 と同じ操作）。これなら書き込みは通常の handler が行うため、単一強制点は崩れない。
   ただし resend で直るのは「今の Stripe 側の実データを正しく再反映できる」場合のみ（§3 参照）。
3. **resend でも直らない、または対応する Stripe event が無い場合のみ、直接 UPDATE を検討する。**
   この場合は必ず §4 の決裁を経る。

## 3. 是正が必須ではない場合

以下は「検出されたが今は是正しない」判断がありうる:

- **`UNCLASSIFIED` で、直近の webhook 処理の最中に取得した 1 行だけの場合**: `handleSubscriptionUpdated`
  等は複数列を書く途中経過が一瞬だけ観測されうる（同一トランザクション内のため通常は起きないが、
  `/ops` の読み取りタイミングと重なった疑いがあれば）。**再読み込みして再現するかを先に確認する。**
  再現しなくなれば是正不要。
- **同一 `tenantId` が前回監査でも同じ分類のまま残っている場合**、それは一過性ではなく実在する
  不整合なので、この節の対象にはならない（§4 に進む）。

上記に当てはまらない X1-X4 は、たとえ低リスクに見えても放置しない
（matrix §7 の「既に不正な既存行は検出されない」問題を再現するため）。

## 4. 決裁 — 本番データの書き換えはオーナー

`families` の直接書き換え（4 列いずれかの UPDATE）は**本番データの書き換え**であり、
チーム憲章 [`docs/sessions/README.md`](../sessions/README.md) §4.4 の不可逆 4 操作のうち
「課金書込」に準じる（契約状態は課金と直結する列であり、書き込み経路も課金 webhook と同一のため）。

**気づいた人が誰でも `state:needs-owner` を付けて起票する。** QM / Dev の判断だけで UPDATE を
実行しない。Issue には最低限、対象 `tenantId`・現在の分類・§3 で確認した Stripe 側の実データ・
提案する是正後の値を書く。

## 5. X1-X4 個別の一次対応

### X1 — `sub` なし + `plan` あり

| 項目 | 内容 |
|---|---|
| 何が起きている状態か | 契約 (`stripe_subscription_id`) が無いのに `plan` だけ残っている。`licenseStatus` は `none` になるはずが、`plan` を直接参照する経路があれば誤表示しうる |
| 想定される原因 | matrix §4 では「起きない」と評価されている（W5 が終端遷移で 4 列を網羅的にクリアする単一強制点、#3982 / #4026）。**理論上起きないはずの行が出た場合は、#4026 より前に作られた legacy 行か、webhook 経路以外（過去の手動介入等）で書かれた行を疑う** |
| 確認手順 | (a) `stripe_customer_id` から Stripe Dashboard で顧客の現在の subscription 有無を確認する。(b) 該当行の `updated_at` を見て、#4026 の反映日より古い行かを確認する |
| 是正手順 | Stripe 側に生きている subscription が無いなら、`plan` を `NULL` にして S1 相当に揃える。生きている subscription があるなら `stripe_subscription_id` にそれを補完する（§2 の resend を優先） |
| 是正してよいのは誰か | 提案は誰でも可。**実行はオーナー決裁後**（§4） |

### X2 — `sub` あり + `plan` なし

| 項目 | 内容 |
|---|---|
| 何が起きている状態か | 課金 (`stripe_subscription_id`) はあるのに `plan` が無い。`planTier` が `standard` に丸められるため、premium 契約者が standard 扱いになりうる |
| 想定される原因 | matrix §4「起きうる」— checkout の `metadata.planId` が未知の値だったケース。発生時は alert が出る設計（該当 alert の詳細は本 runbook の scope 外、`silent-failure-alert-response.md` 側の webhook 系 alert を参照） |
| 確認手順 | Stripe Dashboard で該当 subscription の price / metadata を確認し、どのプランに対応するかを特定する |
| 是正手順 | 正しい `plan` 値が特定できたら、§2 の resend（`customer.subscription.updated` の再送）で `resolvePlanFromSubscriptionItems` に解決させられないかを先に試す。**resend でも `plan` が埋まらない場合**（未解決のまま保持する設計のため）は、特定した値を直接 UPDATE する |
| 是正してよいのは誰か | 提案は誰でも可。**実行はオーナー決裁後**（§4） |

### X3 — `status=active` + `exp` あり

| 項目 | 内容 |
|---|---|
| 何が起きている状態か | `active` なのに `plan_expires_at`（本来は猶予終了日）が残っている。dunning から復帰した際の残骸 |
| 想定される原因 | matrix §4「起きる」・§5 D2。**原因の書き手 (W6 / W3 混線) は #3986 → #3991 で解消済み**であり、今の実装で新たに X3 を作る書き手は無いはず。検出された行は #3991 より前に作られた残骸である可能性が高い |
| 確認手順 | 該当行の `updated_at` が #3991 反映日より古いかを確認する。新しい行なら「解消済みのはずが再発した」ため、原因調査を優先する（是正より先に Issue 化） |
| 是正手順 | `plan_expires_at` を `NULL` にする。これは W2 (`invoice.paid`) が active 復帰時に書く値と同じであり、是正後の形は正常系 S2 と一致する（4 列中 1 列のみの単純な補正で、他 3 列の解釈は変わらない） |
| 是正してよいのは誰か | 提案は誰でも可。**実行はオーナー決裁後**（§4）。ただし §「原因調査を優先」のとおり、新しい行の場合は是正より前に再発 Issue を起票する |

### X4 — `status=grace_period` + `sub` なし

| 項目 | 内容 |
|---|---|
| 何が起きている状態か | 猶予 (dunning) 状態なのに、対象となる契約 (`stripe_subscription_id`) が存在しない |
| 想定される原因 | matrix §4「起きうる」。実装から一意の原因は特定できない — `customer.subscription.deleted` (W5) が `sub` をクリアした直後に古い `invoice.payment_failed` (W3) が遅延到達して `status=grace_period` を書き戻す、のような**到達順の逆転**が考えられるが、これは推測であり実装コードから確証は得ていない |
| 確認手順 | Stripe Dashboard で該当 subscription（`stripe_customer_id` 経由で辿る）が実在するかを確認する。実在しない（解約済み）なら S5 が正しい終端。実在するなら W4/W5 のどちらかが正しく反映されていない |
| 是正手順 | 実在しないなら `TERMINAL_CONTRACT_STATE` の 4 列（`sub=NULL` / `plan=NULL` / `exp=NULL` / `status=suspended`）を書いて S5 に揃える（W5 が本来書く形と同じ）。実在するなら §2 の resend（`customer.subscription.updated` の再送）を優先する |
| 是正してよいのは誰か | 提案は誰でも可。**実行はオーナー決裁後**（§4） |

## 6. 未定（実装から読み取れない事項）

以下は本 runbook を書く時点で実装・設計書から確証を得られなかった。**推測で運用しない**。
決める必要が生じた時点で PO / オーナーが判断する。

- **X1-X4 是正の実行者ロール**: 「誰でも提案できる／実行はオーナー決裁後」までは §4.4 から
  導けるが、決裁後の UPDATE を実際に**誰が SQL を実行するか**（オーナー本人か、決裁を得た Dev か）
  は明文化されていない
- **是正の記録先**: `families` の書き換えを追跡する監査ログ（誰がいつ何を書いたか）は
  実装上存在しない（`schema.ts` に audit log テーブルは無い）。手動是正を行った場合、
  何を根拠に記録として残すかは決まっていない。当面は Issue 本文に UPDATE 文と実行結果を
  貼ることを最低限の記録とする
- **`UNCLASSIFIED` 全般の一次対応**: 本 runbook は X1-X4（matrix §4 で定義済みの不正状態）
  のみを扱う。表に無い新しい組み合わせ（`UNCLASSIFIED`）が出た場合の一次対応は、
  「matrix に行を足すべきか」を含めた設計判断が要るため、本 runbook の対象外
  （§3 の一過性チェックを除く）

## 関連

- [`contract-state-matrix.md`](../design/billing-redesign/contract-state-matrix.md) §4（状態定義）/ §5（書き手一覧）/ §7（検出手段の設計判断）
- [`silent-failure-alert-response.md`](silent-failure-alert-response.md) §2.3（webhook event の resend 手順）
- [`docs/sessions/README.md`](../sessions/README.md) §4.4（不可逆 4 操作）
