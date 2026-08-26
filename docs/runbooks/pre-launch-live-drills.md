# 公開前の本番実演 3 件（kill switch / アラート到達 / テナント間不可視）

対象: 有償サービスイン前に本番で 1 度だけ通す実演 3 件（#4582 / EPIC #4580 の G3 / G4 / G9）。
**当日「どのコマンドを叩くか」「何を見たら成功と言えるか」を考え始めないために置く。**
Dev が段取りを用意し、**オーナーは実行と判定だけを行う**。

関連（方針の SSOT はこちらで、本書は重複させない）:
`docs/design/billing-redesign/phase6-rollback-and-kill-switches.md` §5（kill switch の設計）/
`docs/runbooks/ops-alert-notification.md`（通知方針と切り分け）/
`docs/runbooks/grace-period-deletion-operations.md` §1（env kill-switch の 2 層パターン）/
ADR-0063（テナント分離の設計根拠）

---

## 0. 3 件に共通の前提

| 前提 | 内容 |
|---|---|
| リージョン | `us-east-1`（全 AWS コマンド共通） |
| アプリ Lambda | `ganbari-quest-app` |
| 本番ドメイン | `https://ganbari-quest.com` |
| 原則 | **本番は read-only**。顧客データを書き換える操作は本書に含めない。書き込みが要る箇所は §3.0 / §1.5 に「オーナー判断」と明記してある |
| 戻す手順 | **押す前に「戻す手順」を読む**。3 件とも「戻す」を先に書いてある |

**実演の順番は G4 → G3 → G9 を推奨する。** G4（アラート到達）が先に通っていれば、
G3 で万一 kill switch が課金 path を壊したときに気付ける経路が生きている状態で実演できる。

---

## 1. G3 — kill switch (`USE_LOOKUP_KEY`) の live 実演

### 1.0 何を切り替えるスイッチか（1 行）

Stripe の Price ID を **lookup_key で Stripe API から解決する経路**（既定 `true`）と、
**env var `STRIPE_PRICE_*_MONTHLY` を直読する経路**（`false`）を切り替える。
判定は `src/lib/server/stripe/config.ts` の `isLookupKeyEnabled()` で、
**`'true'` という文字列のときだけ true**（`'TRUE'` / `'1'` は false 扱い）。

`false` に倒すと `getPriceId()` は env var 直読だけになる（同 `config.ts`）。
**env var が入っていなければ購入が落ちる**ので、押す前に §1.1 で env var の存在を確認する。

> **kill switch はこれ 1 件だけではない。** 顧客データ物理削除の `GRACE_PERIOD_DELETION_DISABLED`
> は別系統で、手順は [grace-period-deletion-operations.md](grace-period-deletion-operations.md) §1 が SSOT。
> 本節では扱わない。

### 1.1 押す前に見る（30 秒）

```bash
aws lambda get-function-configuration --function-name ganbari-quest-app --region us-east-1 \
  --query 'Environment.Variables.{USE_LOOKUP_KEY:USE_LOOKUP_KEY,
           STD:STRIPE_PRICE_STANDARD_MONTHLY, FAM:STRIPE_PRICE_FAMILY_MONTHLY}'
```

| 見るもの | 期待 | 期待どおりでないとき |
|---|---|---|
| `USE_LOOKUP_KEY` | `"true"`（CDK 既定） | `false` なら既に倒れている。実演の前後関係が変わるのでオーナーに報告して中止 |
| `STD` / `FAM` | **どちらも `price_...` が入っている** | **片方でも空なら実演しない**。`false` に倒した瞬間に該当プランの購入が `MISSING_PRICE_ID` で落ちる |

### 1.2 切り替える（即時・deploy 不要）

**既存 env を壊さないよう、必ず現行値を取ってから上書きする**（grace-period runbook §1 層 2 と同じ形）。

```bash
aws lambda get-function-configuration --function-name ganbari-quest-app --region us-east-1 \
  --query 'Environment.Variables' > /tmp/env.json
# /tmp/env.json の USE_LOOKUP_KEY を "false" に書き換えてから
aws lambda update-function-configuration --function-name ganbari-quest-app --region us-east-1 \
  --environment "Variables=$(jq -c . /tmp/env.json)"
```

### 1.3 何秒で反映されるか / 何を見て反映を確認するか

| 段階 | 目安 | 確認コマンド |
|---|---|---|
| Lambda 設定の更新完了 | 数秒〜十数秒 | `aws lambda get-function-configuration --function-name ganbari-quest-app --region us-east-1 --query '{S:LastUpdateStatus,V:Environment.Variables.USE_LOOKUP_KEY}'` → `S=Successful` かつ `V=false` |
| アプリへの反映 | **設計 doc の記載は約 30 秒**（`.env.example` / `infra/lib/compute-stack.ts` のコメント）。実体は「新しい実行環境から反映」で、既存の warm instance は入れ替わるまで旧値のまま | 上記と同じ（**アプリ側に確認する口は無い**、下記） |

> **「切り替わった」ことをアプリの画面や API から確認する手段は無い。**
> `/api/health` は `USE_LOOKUP_KEY` を返さない（`src/routes/api/health/+server.ts` の返却フィールドに無い）。
> `/ops` にも表示は無い。**確認は Lambda の実 env を読むこと 1 本**である。
>
> log からも確認できない。`getPriceId()` が log / alert を出すのは **lookup_key の解決に失敗したとき
> だけ**（`notifyStripeAlert({ kind: 'stripe-lookup-failed' })`）で、成功経路は無音。
> 「どちらの経路で解決したか」を示す成功 log は存在しない。

### 1.4 戻す（先に読む）

```bash
# /tmp/env.json の USE_LOOKUP_KEY を "true" に戻して再適用
aws lambda update-function-configuration --function-name ganbari-quest-app --region us-east-1 \
  --environment "Variables=$(jq -c . /tmp/env.json)"
```

確認は §1.3 と同じ（`LastUpdateStatus=Successful` かつ `USE_LOOKUP_KEY=true`）。

**戻し忘れても次回 deploy で `true` に戻る。** `.github/workflows/deploy.yml` が
`-c useLookupKey=${{ vars.USE_LOOKUP_KEY || 'true' }}` を渡し、`infra/lib/compute-stack.ts` の
既定が `'true'` のため。逆に言うと、**手で入れた `false` を deploy 後も維持したいなら
`gh variable set USE_LOOKUP_KEY --body false --repo Takenori-Kusaka/ganbari-quest` が要る**
（実演では使わない。使ったら実演の最後に必ず戻す）。

### 1.5 実演で「確認しないこと」（意図的に外す）

**`false` の状態で本番の購入導線を実際に叩くことはしない。** 本番で購入を発生させるのは
書き込みであり、返金・解約の後始末が要る。この確認が要るとオーナーが判断する場合は、
**Stripe Test mode での切替 dry-run**（`phase6-rollback-and-kill-switches.md` §5.5）が既存手順。

したがって本実演で言えるのは **「切替が反映され、戻せる」ところまで**である。
その先（`false` 経路で購入が成立すること）は Test mode 側の証跡で担保する。

### 1.6 成功の判定条件

- [ ] §1.1 で `STRIPE_PRICE_STANDARD_MONTHLY` / `STRIPE_PRICE_FAMILY_MONTHLY` が両方入っていた
- [ ] `false` へ切替後、実 env が `"false"` になった（`LastUpdateStatus=Successful`）
- [ ] `true` へ戻した後、実 env が `"true"` に戻った
- [ ] 実演中に Discord の incident に `stripe-lookup-failed` が出ていない

---

## 2. G4 — アラート到達の実演（Discord に届くまで）

### 2.0 何を実演するか

alarm → SNS topic `ganbari-quest-ops-alerts` → 転送 Lambda `ganbari-quest-ops-alert-forwarder`
→ Discord incident webhook、の**一本道が末端まで生きていること**を 1 通で確かめる。
通知方針そのもの（どの alarm を出すか / 鳴りすぎたときの対処）は
[ops-alert-notification.md](ops-alert-notification.md) が SSOT で、本節はその経路を 1 回通すだけ。

### 2.1 経路 A（推奨・実経路を通す）: `/ops` の拒否を 1 件起こす

**未ログインのブラウザで `https://ganbari-quest.com/ops` を開く**（プライベートウィンドウ）。
403 が返り、`requireOpsAccess()`（`src/lib/server/auth/ops-authz.ts`）が
`[auth-alert] ops-access-denied` を warn log に出す。これが MetricFilter →
`GanbariQuest/Auth / OpsAccessDenied` → alarm `ganbari-quest-ops-access-denied`
（5 分 window / 1 件で発火、`infra/lib/ops-stack.ts`）を経て Discord まで流れる。

- **読み取りだけ**（403 を受け取るページアクセス 1 回）。顧客データに触れない
- 平常時はデータ点自体が無い（`treatMissingData: NOT_BREACHING`）ので、**鳴ったのは実演の 1 件だと分かる**
- 所要は **アクセスから Discord まで数分**（log 反映 + 5 分の評価期間）。すぐ出なくても慌てない

> **誰が叩いたかは log に残らない。** この warn は identity / IP を意図的に一切載せない
> （`ops-authz.ts` のコメント）。実演の 1 件だと同定できるのは**時刻だけ**なので、
> 開いた時刻を控えておく。

### 2.2 経路 B（合成・速い）: alarm 状態を手で ALARM にする

log → metric の伝播を待たずに転送以降だけを試したいときはこちら。

```bash
aws cloudwatch set-alarm-state --region us-east-1 \
  --alarm-name ganbari-quest-ops-access-denied \
  --state-value ALARM \
  --state-reason "公開前の通知到達確認 (#4582)"
```

`--state-reason` に書いた文字列がそのまま Discord の本文に出る（転送 Lambda は
`NewStateReason` を載せる）ので、**実演だと分かる文言を入れる**。

### 2.3 何を見たら「届いた」と言えるか

| 層 | 見る場所 | 期待 |
|---|---|---|
| 人 | Discord の incident チャンネル | `異常: ganbari-quest-ops-access-denied` の赤い embed |
| 転送 Lambda | `/aws/lambda/ganbari-quest-ops-alert-forwarder` の log | `[ops-alert] forward-succeeded` |
| 数 | `GanbariQuest/Ops` の `AlertForwardSucceeded` が +1 | ops-alert-notification.md §6 のコマンドで Sum を読む |

### 2.4 戻す（必須）

**経路 A / B のどちらでも、alarm は ALARM のまま放置しない。**

```bash
aws cloudwatch set-alarm-state --region us-east-1 \
  --alarm-name ganbari-quest-ops-access-denied \
  --state-value OK \
  --state-reason "実演終了 (#4582)"

# 状態の確認
aws cloudwatch describe-alarms --region us-east-1 \
  --alarm-names ganbari-quest-ops-access-denied \
  --query 'MetricAlarms[0].StateValue' --output text
```

この alarm は **OK 遷移でも通知が飛ぶ**（`opsAccessDeniedAlarm.addOkAction(alarmAction)`）ので、
Discord に緑の `復旧: ...` が 1 通出る。**それが出て初めて実演は完了**（往復とも経路が生きている証拠になる）。

手で戻さなくても、実データが無ければ次の評価で OK に戻る（`NOT_BREACHING`）が、
**戻ったことを確認できる時刻が読めないので手で戻す**。

### 2.5 届かなかったとき、何を見るか

上から順に、**どこで切れたかを 1 つずつ潰す**。切り分け表の SSOT は
[ops-alert-notification.md](ops-alert-notification.md) §5 / §6 / §7 で、ここでは実演当日の見る順だけ書く。

1. **転送 Lambda の log に何か出ているか**（`/aws/lambda/ganbari-quest-ops-alert-forwarder`）
   - `[ops-alert] forward-failed reason=...` → **転送は動いたが Discord に拒否された**。
     `reason=` の意味と対処は ops-alert-notification.md §6 の表
   - `suppressed alarm=...` → 方針表で `notify: false`。ただし**現在 `ALARM_NOTIFY_POLICY` は全件 `notify: true`**
     （`infra/lib/ops-alert-policy.ts`）なので、これが出たら方針表が変わっている
   - **log が 1 行も無い** → SNS subscription が無い。ops-alert-notification.md §5 の 2 コマンドで確認
2. **alarm が本当に ALARM になったか**（§2.4 の `describe-alarms`）。なっていなければ log → metric の
   伝播待ちか、経路 A の 5 分評価がまだ回っていない
3. **`DISCORD_WEBHOOK_INCIDENT` が転送 Lambda の実 env にあるか**（ops-alert-notification.md §5）

> **自己参照の限界**（ops-alert-notification.md §6 と同じ話）: 「転送が失敗した」ことを知らせる
> alarm `ganbari-quest-ops-alert-forward-failed` も**同じ転送経路**を通る。Discord が完全に不達な間は
> その通知も届かず、残るのは CloudWatch console の状態と `GanbariQuest/Ops` の metric だけになる。
> **この実演が「届かない」で終わったときは、Discord を見ても答えは出ない。上の 1 → 2 → 3 を見る。**

### 2.6 成功の判定条件

- [ ] Discord incident に赤い `異常: ganbari-quest-ops-access-denied` が 1 通届いた
- [ ] 転送 Lambda の log に `[ops-alert] forward-succeeded` がある
- [ ] `set-alarm-state --state-value OK` 後、緑の `復旧: ...` が 1 通届いた
- [ ] `describe-alarms` の `StateValue` が `OK` に戻っている

---

## 3. G9 — テナント間不可視の実機確認

### 3.0 前提（**ここでオーナー判断が要る**）

**本番に別々のテナントのアカウントが 2 つ要る。** 既存の 2 つで足りるなら read-only で完結する。
足りない場合、**2 つ目のアカウントを本番で作るのは書き込み**（テナント行 + 子供 + 画像が増える）なので、
**作るかどうかはオーナー判断**。作った場合は実演後にどう扱うか（残す / 退会させる）も同時に決める。

以下、テナント A / テナント B と呼ぶ。**A の識別子を控えて、B のセッションで叩く**。

### 3.1 既存の自動テストが見ている軸（**手で歩かない**）

| 見ている軸 | どこ |
|---|---|
| `/tenants/[...path]` / `/uploads/avatars/[filename]` の cross-tenant IDOR（ハンドラ層） | `tests/integration/api/tenant-static-file-idor.test.ts` |
| `tenant_id` 述語の無い SELECT/UPDATE/DELETE を CI で禁止 | `tests/unit/architecture/dsql-tenant-predicate-fitness.test.ts` |
| `/ops` 配下の認可（全ルート列挙） | `tests/unit/architecture/ops-route-auth-fitness.test.ts` / `tests/e2e/ops-export-authz.spec.ts` |

**本番実機で 2 テナントを歩く E2E は存在しない。** だから本実演は
**「直接 URL 叩き」と「ID 差し替え」だけ**に絞る（画面を普通に操作して見えないことは上の層が担保済み）。

### 3.2 A の識別子を控える（A でログインした状態）

| 欲しいもの | どこから取るか |
|---|---|
| A の `tenantId` と子供の `childId` | 子供のアバター画像の URL。**`/tenants/<tenantId>/avatars/<childId>/<uuid>.png` という形**（`src/lib/server/storage-keys.ts`）。ブラウザで画像を右クリック → 画像の URL をコピー、または DevTools で `<img>` の `src` を見る |
| A の活動 ID | 活動管理で 1 件の編集を開いたときの URL `/admin/activities/<id>/edit` |

**DB を触る必要は無い。**画面から取れる。

### 3.3 B のセッションで叩く（すべて GET / read-only）

A からログアウトし、**B でログインした状態**で、控えた A の識別子を URL に入れて開く。

| # | 叩く URL | 期待 | 実装上の根拠 |
|---|---|---|---|
| 1 | `/tenants/<AのtenantId>/avatars/<AのchildId>/<uuid>.png` | **404**（画像が出ない） | `src/routes/tenants/[...path]/+server.ts`: path 先頭セグメント ≠ `context.tenantId` なら storage に触る前に 404 |
| 2 | `/admin/activities/<Aの活動id>/edit` | **404「活動が見つかりません」** | `.../[id]/edit/+page.server.ts`: `getActivityById(id, tenantId)` が null → `error(404, ...)` |
| 3 | `/api/v1/status/<AのchildId>` | **404 JSON**（`{"error":"こどもがみつかりません"}`） | `src/routes/api/v1/status/[childId]/+server.ts`: `getChildStatus(childId, tenantId)` |
| 4 | 未ログイン（プライベートウィンドウ）で 1 の URL | **404** | 同上（`context` が無ければ即 404） |

**403 ではなく 404 が正**（存在の有無を漏らさないため）。**403 が返ったら設計と違うので記録して止める。**

### 3.4 やらないこと

- **書き込みを伴う確認をしない。** A のリソース ID に対する POST / form 送信・削除は本実演に含めない。
  認可の書き込み側は `tests/unit/routes/import-authz-coverage.test.ts` 等のテスト層が見ている
- **B から A のデータを「見えた」ことを確かめるための細工をしない**（cookie の書き換え等）。
  tenantId は Cognito 署名を経て確定するもので（ADR-0063）、ブラウザ側の細工は分離の検証にならない

### 3.5 成功の判定条件

- [ ] §3.3 の 4 本すべてが **404** を返した（1 本でも 200 なら**そこで止めてオーナーに報告**）
- [ ] 200 が返ったものが 1 つも無い
- [ ] 実演のために本番に作ったアカウントがあれば、その後始末をオーナーと決めた

---

## 4. 実演の記録

3 件が終わったら、**次に同じことをする人のために**以下を残す（EPIC #4580 に貼る）:

- 実施日時（JST）と、G4 で `/ops` を叩いた時刻
- 各件の判定チェックリストの結果（通った / 通らなかった）
- **想定と違ったもの**（返ってきた status / 届かなかった通知 / 反映までにかかった実測時間）
- 実演のために本番に加えた変更と、それを戻したことの確認

**手順が実態と違ったら、このファイルを直す。**
