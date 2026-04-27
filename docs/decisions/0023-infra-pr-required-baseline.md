# ADR-0023: インフラ PR 必須要件 — ENV silent skip 禁止 + secrets validation + post-deploy smoke test + alarm

- **Status**: accepted
- **Date**: 2026-04-27
- **Issue**: #1586
- **関連 PR**: #1587（本 ADR のルール 1-4 を実装する PR、同期マージ）
- **上位概念**: ADR-0006（Safety Assertion Erosion Ban）の CDK 適用版

## コンテキスト

PR #1509（#1376 EventBridge cron）のデプロイで 4 つの根本原因が複合し、本番 cron 全 fail を **2 日間誰も気づかない**インシデントが発生（#1586）。

| # | 根本原因 |
|---|---------|
| A | GitHub Secret `CRON_SECRET` 未登録（PR本文の「登録済み」記載は虚偽） |
| B | CDK `?? ''` + spread skip による silent 欠落（ADR-0006 違反） |
| C | dispatcher Lambda に `OPS_SECRET_KEY` fallback 注入漏れ |
| D | post-deploy smoke test 0 + CloudWatch Alarm 0（2 日気付かず） |

結果: `license-expire` / `retention-cleanup` / `trial-notifications` の 3 cron が 2 日間全実行失敗。

ADR-0006 が「assertion を弱める変更を禁止」する一方、CDK 側で silent skip するパターン（`...(value ? { ENV: value } : {})`）が複数箇所に残っており、ADR-0006 は実質的に CDK レベルで形骸化していた。本 ADR は ADR-0006 の CDK 適用版として、インフラ PR の必須要件を 4 本のルールで定める。

## 決定（ルール 4 本）

### ルール 1: tryGetContext で取った必須 env は throw で assert する（silent skip 禁止）

```typescript
// ❌ 禁止
const cronSecret = this.node.tryGetContext('cronSecret') ?? '';
environment: {
  ...(cronSecret ? { CRON_SECRET: cronSecret } : {}),
}

// ✅ 必須 env はこう書く
const cronSecret = this.node.tryGetContext('cronSecret');
if (!cronSecret) {
  throw new Error('cronSecret context is required (set via -c cronSecret=$CRON_SECRET in deploy.yml)');
}
environment: { CRON_SECRET: cronSecret }

// ✅ 任意 env はコメントで明示
const optionalWebhook = this.node.tryGetContext('discordWebhookSupport');
environment: {
  // optional: 設定されていれば通知を送る、未設定でも起動 OK
  ...(optionalWebhook ? { DISCORD_WEBHOOK_SUPPORT: optionalWebhook } : {}),
}
```

### ルール 2: deploy.yml に validate-required-secrets step 必須

cdk deploy の前に GitHub Secrets の存在を validate するステップを置く:

```yaml
- name: Validate required secrets
  run: |
    missing=0
    for s in OPS_SECRET_KEY AWS_OIDC_IAMROLE_ARN STRIPE_SECRET_KEY; do
      if [ -z "${!s}" ]; then echo "::error::Required secret $s is missing"; missing=1; fi
    done
    [ $missing -eq 0 ]
  env:
    OPS_SECRET_KEY: ${{ secrets.OPS_SECRET_KEY }}
    AWS_OIDC_IAMROLE_ARN: ${{ secrets.AWS_OIDC_IAMROLE_ARN }}
    STRIPE_SECRET_KEY: ${{ secrets.STRIPE_SECRET_KEY }}
```

新規必須 secret を追加した PR は本 step の env block に追加すること。

### ルール 3: 新規 Lambda を含むインフラ PR は post-deploy smoke test step 必須

```yaml
- name: Cron dispatcher smoke test
  run: |
    aws lambda invoke --function-name ganbari-quest-cron-dispatcher \
      --payload '{"cronJob":"license-expire","dryRun":true}' \
      --cli-binary-format raw-in-base64-out \
      response.json
    grep -q '"statusCode":200' response.json || (echo "::error::smoke test failed" && exit 1)
```

dryRun mode は Lambda 側で「実 HTTP POST せず env 確認のみ」にする実装契約とする。

### ルール 4: scheduled / cron Lambda は CloudWatch Alarm 必須（CDK で生成）

```typescript
new cw.Alarm(this, 'CronDispatcherErrorAlarm', {
  alarmName: 'ganbari-quest-cron-dispatcher-errors',
  metric: this.cronDispatcherFn.metricErrors({ period: cdk.Duration.minutes(5) }),
  threshold: 1,
  evaluationPeriods: 1,
  comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
  treatMissingData: cw.TreatMissingData.NOT_BREACHING,
});
// → 既存 ops SNS topic / Discord webhook に紐付け
```

scheduled / cron / queue consumer 等、ユーザー操作以外で起動する Lambda 全て対象。

## 例外手続き

- 任意の env を silent skip するのは OK。ただしコメントで「optional: なくても動く」を必ず明記すること
- ルール 3 / 4 を skip する場合は、本 ADR を supersede する新 ADR で正当性を明示すること（ADR-0006 の例外手続きと同じ運用）

## 結果

- インフラ PR の作業量は増える（smoke test + alarm 追加）が、PR #1509 のような 2 日間気付かないインシデントを防ぐ ROI は高い
- ADR-0006 の CDK 適用版として位置づけ、両方守ることを徹底する
- silent skip パターンが CI / レビューで `[must]` 検出される

## References

- ADR-0006: Safety Assertion Erosion Ban（本 ADR の上位概念）
- Issue #1586: 本 ADR を生んだインシデント
- PR #1509: 本 ADR で禁止するアンチパターンを作った PR
- PR #1587: 本 ADR のルール 1-4 を実装する PR（同期マージ）
