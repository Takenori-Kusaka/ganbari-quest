# DynamoDB push_subscription `subscriberRole` Migration Runbook

> **対象**: 運用担当 (PO)
> **関連 Issue**: [#1666](https://github.com/takenori-kusaka/ganbari-quest/issues/1666) (#1593 follow-up)
> **関連 ADR**: ADR-0010 (Pre-PMF), ADR-0023 I6 (push subscriber role 監査), ADR-0012 (Anti-engagement)
> **関連 設計書**: [docs/design/14-セキュリティ設計書.md §8.8](../design/14-セキュリティ設計書.md), [docs/design/08-データベース設計書.md §push_subscriptions](../design/08-データベース設計書.md)

---

## 1. 目的

#1593 で `push_subscriptions.subscriber_role` カラムを追加し、SQLite (NUC) は `scripts/migrate-local.ts` で既存レコードを default `'parent'` に backfill 済。本 runbook は **DynamoDB (本番 AWS)** 側の同等 migration を扱う。

### 1.1 達成すべき状態

- 全 push_subscription レコードに `subscriberRole` 属性が存在
- 値は `'parent'` または `'owner'` のみ
- `notification-service.ts` 送信時の skip warn ログ (`[notification] 非 parent/owner role の subscription への送信をスキップ`) が CloudWatch で 0 件

---

## 2. 前提条件

以下が **すべて** 満たされた状態で実行する。

| 前提 | 確認方法 |
|------|---------|
| #1593 が main にマージ済 | `git log --grep '#1593'` |
| DynamoDB 側 `push-subscription-repo.ts` が **本実装済** (※) | `node scripts/check-dynamodb-stub.mjs` が green |
| `subscribe API` が role validation を実施 (child=403) | `tests/unit/routes/notifications-subscribe-api.test.ts` 全 pass |
| 実行端末から本番 DynamoDB に書き込み可能な IAM 権限 | `aws sts get-caller-identity` + 後述 §6 IAM ポリシー |

> ※ DynamoDB 実装本体は本 PR スコープ外（別 follow-up Issue で扱う）。実装本体マージ後に本 runbook を実行する。

---

## 3. dry-run（必ず最初に実行）

書き込みは行わず、対象件数のみを表示する。

```bash
# Lambda 同梱版を使う場合（デプロイ済 image 内のスクリプト）
AWS_REGION=us-east-1 \
DYNAMODB_TABLE=ganbari-quest \
node scripts/migrate-dynamodb-push-subscriber-role.mjs --dry-run
```

期待される出力例:

```
[migrate-push-role] INFO start (table=ganbari-quest, region=us-east-1, dryRun=true)
[migrate-push-role] INFO scan complete {"total":42,"needsBackfill":42}
[migrate-push-role] INFO dry-run mode — sample of items to migrate (first 10):
[migrate-push-role] INFO   T#tenant-abc#PUSH_SUB / PUSH_SUB#deadbeef (current=null)
...
[migrate-push-role] INFO dry-run end (would migrate 42 items)
{
  "status": "ok",
  "total": 42,
  "migrated": 0,
  "skipped": 0,
  "wouldMigrate": 42
}
```

### 3.1 dry-run 結果の判断

| `total` | `needsBackfill` | 判断 |
|---------|----------------|------|
| 0 | 0 | 既存レコードなし。本 migration 不要。Issue #1666 を `total=0` 証跡付きで close。 |
| > 0 | 0 | すでに全レコード backfill 済（idempotent 確認）。本 migration 不要。 |
| > 0 | > 0 | §4 本実行へ進む |

---

## 4. 本実行

```bash
AWS_REGION=us-east-1 \
DYNAMODB_TABLE=ganbari-quest \
node scripts/migrate-dynamodb-push-subscriber-role.mjs
```

期待される出力例:

```
[migrate-push-role] INFO start (table=ganbari-quest, region=us-east-1, dryRun=false)
[migrate-push-role] INFO scan complete {"total":42,"needsBackfill":42}
[migrate-push-role] INFO progress: 25/42
[migrate-push-role] INFO done {"total":42,"migrated":42,"skipped":0}
{
  "status": "ok",
  "total": 42,
  "migrated": 42,
  "skipped": 0
}
```

### 4.1 例外時の対応

- **ProvisionedThroughputExceededException / ThrottlingException** — script 内で exponential backoff (最大 30 秒) で 6 回 retry する。それでも継続するなら on-demand 課金モードへの切替を検討。
- **ResourceNotFoundException** — `DYNAMODB_TABLE` 環境変数 が誤り。CDK output `TableName` を確認。
- **ConditionalCheckFailedException** — script 内で swallow（既に valid role が設定済の race condition）。エラー扱いしない。
- **AccessDeniedException** — IAM 権限不足。§6 を確認。

### 4.2 中断・再実行

本 script は **idempotent**。中断後に再実行しても、既に `'parent'` / `'owner'` が設定されているレコードはスキップされる（`ConditionExpression` で保護）。安心して再実行可能。

---

## 5. 検証（migration 完了後 24 時間以内）

### 5.1 AWS CLI でサンプル確認

```bash
# subscriberRole が無いレコードが残っていないか Scan で確認
aws dynamodb scan \
  --table-name ganbari-quest \
  --filter-expression "begins_with(SK, :prefix) AND attribute_not_exists(subscriberRole)" \
  --expression-attribute-values '{":prefix":{"S":"PUSH_SUB#"}}' \
  --select COUNT \
  --region us-east-1
```

期待値: `"Count": 0`。0 でなければ §4 を再実行。

### 5.2 CloudWatch Logs で warn 件数確認

`/aws/lambda/ganbari-quest-app` (または該当 Lambda log group) で次の query を実行:

```
fields @timestamp, @message
| filter @message like /非 parent\/owner role の subscription への送信をスキップ/
| stats count() by bin(1h)
```

期待値: 直近 24 時間で **0 件**。1 件でも検出されたら、対応するレコードの `subscriberRole` 属性が `'parent'` / `'owner'` 以外であることを意味する。AWS Console で当該レコードを確認し、手動で修正するか、本 script を再実行する。

### 5.3 Issue #1666 close 条件

- §3 dry-run 出力をコメントに貼付
- §4 本実行ログ (`migrated`/`skipped` 件数) をコメントに貼付
- §5.1 / §5.2 検証結果（共に 0）をコメントに貼付

---

## 6. IAM 権限要件（最小特権）

実行端末は次の権限を持つ IAM Role / User を使用する。

```json
{
	"Version": "2012-10-17",
	"Statement": [
		{
			"Sid": "AllowScanAndUpdatePushSubscriptions",
			"Effect": "Allow",
			"Action": ["dynamodb:Scan", "dynamodb:UpdateItem"],
			"Resource": "arn:aws:dynamodb:us-east-1:*:table/ganbari-quest"
		}
	]
}
```

> 本 migration は **PK / SK 全 partition を Scan** するため、`Resource` を絞れない。代わりに Action を `Scan` + `UpdateItem` に限定する（`DeleteItem` / `PutItem` は不要）。

---

## 7. ロールバック手順（任意）

通常はロールバック不要（idempotent な前進更新のみ）。
ただし、**`subscriberRole = 'parent'` を誤って設定すべきでないレコード**（例: 本来 `'owner'` のはずのレコード）が混在する可能性がある場合は、次の手順で個別修正する。

```bash
# 個別レコードを 'owner' に修正
aws dynamodb update-item \
  --table-name ganbari-quest \
  --key '{"PK":{"S":"T#tenant-abc#PUSH_SUB"},"SK":{"S":"PUSH_SUB#xyz"}}' \
  --update-expression "SET subscriberRole = :role" \
  --expression-attribute-values '{":role":{"S":"owner"}}' \
  --region us-east-1
```

> 本 migration の default `'parent'` は **送信側で skip されない安全側の値**（`notification-service.ts` の二重防御を通過）。`'owner'` への昇格が必要な場合のみ手動修正する。

`subscriberRole` 属性自体を削除する逆 migration は **意図的に提供しない**（NULL 混在防止 / ADR-0031 の趣旨）。

---

## 8. 履歴

| 日付 | 版 | 変更内容 |
|------|----|---------|
| 2026-04-29 | 1.0 | 初版（#1666） |
