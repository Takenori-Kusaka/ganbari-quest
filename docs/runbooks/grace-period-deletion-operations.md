# grace-period-deletion 運用 runbook（顧客データの物理削除）

対象: `grace-period-deletion` cron（毎日 02:00 JST / `cron(0 17 * * ? *)`）。
グレースピリオドが切れた退会済みテナントを**物理削除**する。**取り消せない処理**であり、
本 runbook は「止める / 気付く / どこまで戻せるか」を SSOT として定める。

関連: `src/lib/server/services/grace-period-service.ts` / `src/lib/server/cron/schedule-registry.ts` /
`infra/lib/compute-stack.ts` / `infra/lib/ops-stack.ts` / ADR-0049（保持期間ポリシー）

---

## 1. 緊急停止（2 層）

**どちらか一方ではなく、性質が違う 2 層**。急ぐときは層 1 を先に打つ（即時・deploy 不要）。

### 層 1: EventBridge Rule を無効化する（cron を呼ばせない・即時）

```bash
aws events disable-rule --name ganbari-quest-cron-grace-period-deletion --region us-east-1

# 効いたことの確認（State が DISABLED であること）
aws events describe-rule --name ganbari-quest-cron-grace-period-deletion --region us-east-1 \
  --query 'State' --output text
```

- **効く範囲**: EventBridge → cron-dispatcher の起動のみ。手動 POST や別経路の呼び出しは止まらない。
- **注意**: CDK は Rule の `enabled` を指定していないため、**次回 deploy で ENABLED に戻る**。
  停止を維持したいなら層 2 を併用する。
- 再有効化: `aws events enable-rule --name ganbari-quest-cron-grace-period-deletion --region us-east-1`

### 層 2: env kill-switch（呼ばれても消させない）

`GRACE_PERIOD_DELETION_DISABLED=true` で、**対象の走査すら行わずに即 return** する
（`purgeExpiredSoftDeletedTenants`）。手動 POST も止まる。

即時に効かせる（次の Lambda 起動から反映。**次回 deploy で CDK 値に戻る**）:

```bash
# 既存 env を壊さないよう、必ず現行値を取得してから上書きする
aws lambda get-function-configuration --function-name ganbari-quest-app --region us-east-1 \
  --query 'Environment.Variables' > /tmp/env.json
# /tmp/env.json の GRACE_PERIOD_DELETION_DISABLED を "true" にして
aws lambda update-function-configuration --function-name ganbari-quest-app --region us-east-1 \
  --environment "Variables=$(jq -c . /tmp/env.json)"
```

恒久的に停止したまま deploy する（推奨。deploy で戻らない）:

1. GitHub の repository variable `GRACE_PERIOD_DELETION_DISABLED` を `true` にする
   （`gh variable set GRACE_PERIOD_DELETION_DISABLED --body true --repo Takenori-Kusaka/ganbari-quest`）
2. deploy すると CDK context 経由で Lambda env に `true` が入る

停止中は実行のたびに以下の warn が残る（無音で止まらない）:

```
[grace-period] physical deletion is disabled by kill-switch env; skipping
```

---

## 2. 気付く（観測）

| 事象 | どこに出るか |
|---|---|
| 部分失敗（`tenantsFailed > 0`） | endpoint が **HTTP 500** を返す → dispatcher の Lambda invocation error → alarm `ganbari-quest-cron-dispatcher-errors` |
| 同上（cron の切り分け用） | log `[grace-period-deletion] partial failure` → metric `GanbariQuest/Deletion / GracePeriodPartialFailure` → alarm `ganbari-quest-grace-period-partial-failure`（1 件で即発火） |
| 同上（人に届く経路） | Discord incident webhook（`sendDiscordAlert`、level=critical）。件数のみで**テナント識別子は載せない** |
| 削除メタデータの欠落 | log `[grace-period] soft-delete metadata incomplete`（#4321。該当テナントは削除対象から外れ復元可能） |
| 持ち越し発生 | log `[grace-period] purge carried over remaining tenants to next run` |

**alarm の Discord 通知は既定 off**（#4189 のオーナー決裁で通知は opt-in）。
`ganbari-quest-grace-period-partial-failure` も現時点で `notify: false` のため、
**CloudWatch 上には出るが alarm 自体は Discord に出ない**。ただし同じ部分失敗は
上表の `sendDiscordAlert` 経路で人に届く。alarm 側の昇格手順は
[ops-alert-notification.md](ops-alert-notification.md) §3。

失敗したテナントの特定（識別子は log にのみ残す）:

```bash
aws logs filter-log-events --region us-east-1 \
  --log-group-name /aws/lambda/ganbari-quest-app \
  --filter-pattern '"[grace-period-deletion] partial failure"' \
  --start-time $(( ($(date +%s) - 86400) * 1000 ))
```

---

## 3. 復旧の限界（できないことを明記する）

**単一テナントだけを削除前の状態に戻す手段は存在しない。** 期待しないこと。

| 対象 | 手段 | 実際にできること |
|---|---|---|
| DSQL（テナント・子供・活動・ポイント等） | cluster 単位の日次 snapshot・7 日保持（`infra/lib/dsql-stack.ts`）。**PITR 非対応** | 新しい cluster を作って endpoint を切り替える = **全テナントを snapshot 時点へ巻き戻す**。1 テナントだけの復元は不可 |
| S3 `tenants/<tenantId>/`（アバター / 音声 / 画像） | AssetsBucket は **versioning 未設定** | **復旧不能** |
| 削除直前の退避 | 無し（`fullTenantDeletion` は export / backup を呼ばない） | — |
| 顧客自身のバックアップ | 退会前にエクスポート（バックアップ ZIP）を取っていれば、そこからの取り込みは可能 | 顧客の手元にファイルがある場合のみ |

したがって**運用上の第一原則は「消してから戻す」ではなく「怪しければ止める」**。
部分失敗の alarm が鳴ったら、原因調査より先に §1 層 1 で cron を止めてよい
（1〜2 日の遅延は許容範囲 — 個人情報保護法 22 条は努力義務）。

### 途中失敗したテナントはどうなるか（#4327）

削除は「判定材料（`settings` の `soft_deleted_at` / `physical_deletion_date`）を最後に消す」
順序になっており、**families 行の削除より前で失敗した場合は判定材料が残る** →
翌日の実行で同じテナントが再び対象になり、削除が完遂する（自己回復）。

例外は最終ステップ（families 行を消した**後**の settings 削除）が失敗した場合で、
このときは `settings` 行だけが孤児として残る。個人データ本体は既に消えており、
log に tenantId が出るので手動で掃除する:

```
[tenant-cleanup] settings 削除失敗 (tenant 行は削除済 / 手動掃除が必要)
```

---

## 4. 再有効化の手順（停止から戻すとき）

1. §1 の層 2（env / repository variable）を `false` に戻し deploy する
2. **dry-run で対象件数を実測する**（実削除しない）

   ```bash
   aws lambda invoke --function-name ganbari-quest-cron-dispatcher --region us-east-1 \
     --payload '{"cronJob":"grace-period-deletion","dryRun":true}' \
     --cli-binary-format raw-in-base64-out response.json && cat response.json
   ```

   **根拠に使うのは `tenantsProcessed` と `expired` の 2 つ**。
   `tenantsRemaining` は dryRun 分岐でハードコード 0 を返すため、
   対象が何件あっても 0 になる（#4327 product-5）。安全根拠として引用しないこと。
3. `expired` が想定より多い場合は止めたまま原因を確認する（想定外の soft-delete が起きていないか）
4. §1 層 1 で Rule を有効化する
5. 初回実行後、実際の削除件数（`tenantsProcessed` / `tenantsDeleted`）を記録する

---

## 5. 動作確認（dry-run）

```bash
# dispatcher 経由
aws lambda invoke --function-name ganbari-quest-cron-dispatcher --region us-east-1 \
  --payload '{"cronJob":"grace-period-deletion","dryRun":true}' \
  --cli-binary-format raw-in-base64-out response.json

# endpoint 直（GET は常に dry-run）
curl -s https://ganbari-quest.com/api/cron/grace-period-deletion -H "x-cron-secret: $CRON_SECRET"
```

cron 全体の検証手順は [cron-3-endpoints-verification.md](cron-3-endpoints-verification.md)。
