# Runbook: rollback 後の orphan named resource 掃除 (already exists → redeploy block 解消)

**関連**: #3881 (起票) / #3870 / #3872 (第16回リリース実障害) / #3874 (層別防御 epic) / ADR-0019 / ADR-0061
**再発防止 SSOT**: `tests/unit/infra/physical-name-ratchet.test.ts` (明示物理名 allowlist ratchet) + `infra/CLAUDE.md` §「明示物理名は auto-naming が既定」

---

## 1. 対象 class と症状

CDK deploy が CREATE 途中で失敗 → stack rollback した際、**明示物理名を持つリソース**が削除できず orphan 化 (stack 管理外で物理残存) することがある。次の deploy は同じ物理名で再作成しようとして **`already exists`** (名前衝突) で block される。

代表的な fail message:

```
Resource of type 'AWS::Backup::BackupVault' with identifier 'ganbari-quest-dsql-vault' already exists.
```

`deploy.yml` の「Orphan-block detection」step (`if: failure()`) が stack events / 失敗 change set から `already exists` を自動検出し、本 runbook への link を `::error::` で出力する。

**AWS 公式挙動 (一次情報)**:

- rollback は作成物を削除するが、削除できないリソースは orphan 化する ("Resource removed from stack but not deleted"): <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/troubleshooting.html>
- 物理名は "unique across all your active stacks" — 衝突すると deploy 失敗。回避の AWS 推奨 = 物理名を明示せず auto-naming: <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-name.html>
- BackupVault は recovery point があると削除自体が失敗し特に固着しやすい: <https://docs.aws.amazon.com/aws-backup/latest/devguide/deleting-backups.html> / <https://github.com/aws/aws-cdk/issues/33711>

## 2. 検出手順

deploy 失敗時、まず「どの物理名が衝突しているか」を特定する:

```bash
# (a) stack events から already exists を探す (直近 deploy の失敗理由)
aws cloudformation describe-stack-events --stack-name <STACK> --region us-east-1 \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`].[LogicalResourceId,ResourceStatusReason]' \
  --output text | grep -i "already exists"

# (b) change-set early validation で落ちた場合は失敗 change set 側に理由が残る
aws cloudformation list-change-sets --stack-name <STACK> --region us-east-1 \
  --query 'Summaries[?Status==`FAILED`].[ChangeSetName,StatusReason]' --output text

# (c) 該当物理名のリソースが stack 管理外 (orphan) かを確認
#     → どの active stack にも属していなければ orphan
aws cloudformation describe-stack-resources --physical-resource-id <PHYSICAL_NAME> --region us-east-1
```

(c) が `Stack with id <PHYSICAL_NAME> does not exist` 等を返し、かつ実リソースが存在する (下記 §4 の各 list コマンドで見える) 場合、それが orphan である。

## 3. 判断 gate (削除前に必ず確認)

| gate | 判定 | 削除可否 |
|---|---|---|
| **G-1: orphan であること** | §2 (c) でどの active stack にも属さない | 属している場合は削除禁止 (稼働リソース)。stack 側の状態を先に確認 |
| **G-2: 中身が空であること** | §4 の各「空確認」コマンドで recovery point / user / object / image が 0 | **空でない場合は削除禁止**。データ喪失になるため PO 承認 + backup 取得後にのみ実施 |
| **G-3: RETAIN の意図確認** | RETAIN + 固定名リソース (vault / UserPool / S3 / ECR / backup-role) は「stack 削除でもデータを守る」意図の設計 | 中身があるならそれは守るべきデータの可能性が高い。削除ではなく「import して stack 管理へ戻す」(`cdk import`) を優先検討 |

## 4. 資源別掃除手順 (空 orphan の削除 → redeploy)

すべて `--region us-east-1` (region SSOT: `infra/CLAUDE.md`)。

### 4.1 AWS Backup Vault (第16回で実際に orphan 化した type)

```bash
# 空確認 (G-2): recovery points が 0 であること
aws backup list-recovery-points-by-backup-vault --backup-vault-name <VAULT_NAME> \
  --query 'length(RecoveryPoints)' --region us-east-1

# recovery point がある場合 (G-2 fail): PO 承認後にのみ全 purge
#   aws backup delete-recovery-point --backup-vault-name <VAULT_NAME> \
#     --recovery-point-arn <ARN> --region us-east-1   # (各 ARN について繰り返し)

# 空 vault の削除
aws backup delete-backup-vault --backup-vault-name <VAULT_NAME> --region us-east-1
```

### 4.2 Cognito User Pool

```bash
# 空確認 (G-2): user 0 であること。user がいる pool は削除禁止 (ADR-0022 系の実害履歴あり)
aws cognito-idp list-users --user-pool-id <POOL_ID> --query 'length(Users)' --region us-east-1
aws cognito-idp delete-user-pool --user-pool-id <POOL_ID> --region us-east-1
```

### 4.3 S3 Bucket

```bash
# 空確認 (G-2)
aws s3api list-objects-v2 --bucket <BUCKET_NAME> --max-keys 1 --query 'KeyCount'
aws s3 rb "s3://<BUCKET_NAME>"        # 空のみ成功する。--force は G-2 承認後のみ
```

### 4.4 ECR Repository

```bash
# 空確認 (G-2)
aws ecr describe-images --repository-name <REPO_NAME> --query 'length(imageDetails)' --region us-east-1
aws ecr delete-repository --repository-name <REPO_NAME> --region us-east-1   # 空のみ。--force は承認後のみ
```

### 4.5 IAM Role (第16回一次原因の DsqlBackupRole 等)

```bash
# attach 済み policy を外してから削除 (attach されたままだと DeleteConflict)
aws iam list-attached-role-policies --role-name <ROLE_NAME> --query 'AttachedPolicies[].PolicyArn' --output text
aws iam detach-role-policy --role-name <ROLE_NAME> --policy-arn <POLICY_ARN>   # (各 ARN)
aws iam list-role-policies --role-name <ROLE_NAME> --output text               # inline policy 確認
aws iam delete-role --role-name <ROLE_NAME>
```

### 4.6 その他 (SNS Topic / Log Group / Alarm / SSM Parameter / EventBridge Rule)

データ喪失リスクが低い type。orphan 確認 (G-1) 後に削除してよい:

```bash
aws sns delete-topic --topic-arn <ARN> --region us-east-1
aws logs delete-log-group --log-group-name <NAME> --region us-east-1
aws cloudwatch delete-alarms --alarm-names <NAME> --region us-east-1
aws ssm delete-parameter --name <NAME> --region us-east-1
aws events remove-targets --rule <NAME> --ids $(aws events list-targets-by-rule --rule <NAME> --query 'Targets[].Id' --output text --region us-east-1) --region us-east-1
aws events delete-rule --name <NAME> --region us-east-1
```

## 5. redeploy と事後確認

1. orphan 削除後、`ROLLBACK_COMPLETE` の新規 stack が残っていれば削除する (`deploy.yml` Phase 2.5 「Cleanup failed stacks」が自動でも行う):

   ```bash
   aws cloudformation delete-stack --stack-name <STACK> --region us-east-1
   aws cloudformation wait stack-delete-complete --stack-name <STACK> --region us-east-1
   ```

2. deploy を再実行する (main への push 再トリガ or `gh workflow run deploy.yml`)。
3. deploy 後、`deploy.yml` の「Detect orphaned resources」step 出力で orphan が増えていないことを確認する。

## 6. 再発防止 (この runbook を使わずに済ませるために)

- **新規リソースに明示物理名を付けない** (CFN auto-naming が既定)。`tests/unit/infra/physical-name-ratchet.test.ts` が allowlist ratchet で機械強制する — allowlist 外の明示物理名は CI fail。
- 既存 RETAIN stateful named (vault / pool / bucket / ECR / backup-role) は **rename しない** (rename = replacement = データ喪失。ADR-0019 gate が検知する)。
- 原則の SSOT: `infra/CLAUDE.md` §「明示物理名は auto-naming が既定 (#3881)」。
