# Cognito User Pool 移行ランブック

**用途**: Cognito User Pool を再作成する必要がある際（standard attribute schema 変更・`AliasAttributes` 変更等）に、既存ユーザーを消失させずに新 Pool へ移行する手順。

**前提**:
- AWS CLI v2 が設定済み（`aws configure` または `AWS_PROFILE` 環境変数）
- Node.js 22 以上が利用可能
- 対象 Pool の管理者権限があること

---

## 0. DynamoDB 側の変更は不要

本プロジェクトは **email を natural key** として DynamoDB ユーザーレコードを管理している（`findUserByEmail` で照合）。Cognito `sub` は DynamoDB に保存していない。

**つまり、Pool 再作成後も DynamoDB レコードは変更不要**。新 Pool で同じ email アドレスで認証されたユーザーは、自動的に既存の DynamoDB レコードに紐付く。

---

## 1. 事前チェックリスト

```bash
# ユーザー数確認
aws cognito-idp describe-user-pool \
  --user-pool-id <POOL_ID> \
  --query 'UserPool.EstimatedNumberOfUsers'

# Google OAuth 比率確認 (export-users.mjs で確認)
node scripts/cognito/export-users.mjs \
  --pool-id <POOL_ID> \
  --output /tmp/cognito-backup.json
# → 出力の "federated (Google等) ユーザー" 件数を確認

# DynamoDB 整合性確認 (メール・ユーザー数が一致しているか)
# （現状はアドホックに DynamoDB Console / CLI で確認）
```

---

## 2. ユーザーデータのエクスポート

Pool 再作成の **直前** に実行する（エクスポートとインポートの間にユーザーが新規登録すると追加対応が必要）。

```bash
# export
node scripts/cognito/export-users.mjs \
  --pool-id <OLD_POOL_ID> \
  --region ap-northeast-1 \
  --output /tmp/cognito-backup-$(date +%Y%m%d-%H%M%S).json

# バックアップ確認
cat /tmp/cognito-backup-*.json | python3 -m json.tool | head -40
```

**出力ファイルを安全な場所に保管すること**（email アドレス等の個人情報を含む）。

---

## 3. Pool 再作成

CDK / CloudFormation での再作成手順（通常は ADR-0018 の手順に従う）:

```bash
# CDK deploy で新 Pool を作成
# (論理 ID 変更による Replacement の場合は infra/CLAUDE.md 参照)
cd infra
cdk deploy AuthStack --require-approval never
```

新 Pool ID を確認:

```bash
aws cognito-idp list-user-pools --max-results 20 \
  --query 'UserPools[?Name==`ganbari-quest-users-v2`].{Id:Id,Name:Name}'
```

---

## 4. ユーザーのインポート

新 Pool 作成後に実行する。

```bash
# dry-run で検証
node scripts/cognito/import-users.mjs \
  --pool-id <NEW_POOL_ID> \
  --input /tmp/cognito-backup-YYYYMMDD-HHMMSS.json \
  --region ap-northeast-1 \
  --dry-run

# 問題なければ本番実行
node scripts/cognito/import-users.mjs \
  --pool-id <NEW_POOL_ID> \
  --input /tmp/cognito-backup-YYYYMMDD-HHMMSS.json \
  --region ap-northeast-1
```

---

## 5. インポート後の検証

### 5.1 ユーザー数確認

```bash
aws cognito-idp describe-user-pool \
  --user-pool-id <NEW_POOL_ID> \
  --query 'UserPool.EstimatedNumberOfUsers'
# → エクスポート時の totalUsers と一致すること
```

### 5.2 サインイン疎通テスト

1. アプリを新 Pool に向けて起動（`npm run dev:cognito` または staging 環境）
2. テストアカウントでサインイン
3. 管理画面が正常に表示され、家族データ・活動記録が見えること（DynamoDB から取得）

### 5.3 Google OAuth ユーザー確認

Google アカウントでサインイン可能なことを確認する（federated re-link が正しく動作しているか）。

### 5.4 DynamoDB 紐付け確認

```bash
# サインイン後、DynamoDB Console でユーザーレコードが既存のものと一致することを確認
# → PK: USER#u-<uuid>, SK: PROFILE のレコードが変わっていないこと
```

---

## 6. パスワードリセット案内

email/password ユーザーは一時パスワードで作成されているため、パスワードリセットが必要。

```bash
# 全ユーザーにパスワードリセットを送信（必要な場合）
node -e "
const { readFileSync } = require('fs');
const data = JSON.parse(readFileSync('/tmp/cognito-backup-YYYYMMDD-HHMMSS.json'));
const pwUsers = data.users.filter(u => !u.federatedIdentities);
console.log('パスワードリセット対象:', pwUsers.length, '件');
for (const u of pwUsers) {
  console.log(u.email);
}
"

# AWS CLI でパスワードリセット送信
aws cognito-idp admin-reset-user-password \
  --user-pool-id <NEW_POOL_ID> \
  --username <user@example.com>
```

---

## 7. Rollback 手順

移行に失敗した場合、旧 Pool を RETAIN した上で戻す。

```bash
# 旧 Pool を RETAIN して CDK から切り離し（削除保護）
# → CDK の RemovalPolicy が RETAIN の場合は自動的に保持される

# App を旧 Pool ID に向け直す
# → 環境変数 COGNITO_USER_POOL_ID を旧 Pool ID に戻す
# → deploy-nuc.yml / CDK context を更新

# 新 Pool を削除
aws cognito-idp delete-user-pool --user-pool-id <NEW_POOL_ID>
```

---

## 8. 既知の制限事項

| 制限 | 詳細 |
|------|------|
| パスワード不可搬 | Cognito のパスワードハッシュはエクスポート不可。インポート後はリセット必要 |
| MFA 設定 | TOTP の設定はユーザーの authenticator アプリに保存されているため再登録不要だが、新 Pool への紐付けは再スキャンが必要 |
| Google OAuth linked user の sub | `admin-link-provider-for-user` に使う Google の `userId` (sub) が古い export に含まれているため、同一値で再紐付け可能 |
| エクスポートとインポートの間の登録 | エクスポート後・Pool 削除前に登録したユーザーは手動対応が必要 |

---

## 参考

- [ADR-0018](../decisions/0018-cognito-user-pool-logical-id-replacement.md) — Pool 再作成の判断基準
- [ADR-0021](../decisions/0021-cognito-pool-migration-user-preservation.md) — ユーザー保全戦略
- [infra/CLAUDE.md](../../infra/CLAUDE.md) — NUC/Lambda デプロイ手順
- Issue #1399 — 本ランブックの起点
