# ADR-0021: Cognito Pool 移行におけるユーザー保全戦略

- **Status**: accepted
- **Date**: 2026-04-24
- **Issue**: #1399
- **Deciders**: PO (Takenori Kusaka)

---

## コンテキスト

2026-04-21 の ADR-0018（Cognito User Pool 論理 ID 変更による明示的 Replacement）で Pool を再作成した際、**既存 federated ユーザーが全員消失した**。Pre-PMF 段階で PO テストアカウントのみだったため許容できたが、Post-PMF では再発不可。

Pool 再作成が必要なケース:
- standard attribute の `mutable` / `required` / `attributeDataType` 変更
- `AliasAttributes` / `UsernameAttributes` 変更
- セキュリティインシデント対応での緊急入れ替え

## 決定事項

### 1. email を persistent natural key として使用（DynamoDB 変更不要）

本プロジェクトの DynamoDB ユーザーレコードは `email` を natural key として管理している:
- `findUserByEmail()` が認証時のユーザー解決に使われる（`cognito.ts` 参照）
- Cognito `sub`（UUID）は DynamoDB に保存していない
- Pool 再作成で Cognito `sub` が変わっても、email が同じなら DynamoDB 既存レコードを再利用できる

**→ Pool 再作成時に DynamoDB のマイグレーションは不要**。

### 2. ユーザー種別ごとのインポート戦略

| ユーザー種別 | 特徴 | インポート方法 |
|------------|------|-------------|
| email/password | Cognito native ユーザー | `AdminCreateUser` (SUPPRESS) + パスワードリセット案内 |
| Google OAuth | federated identity | `AdminCreateUser` + `AdminLinkProviderForUser` |

パスワードハッシュは AWS の仕様上エクスポート不可。email/password ユーザーには移行後にパスワードリセット案内が必要（MFA の TOTP シークレットは再スキャン不要）。

### 3. スクリプト整備

- `scripts/cognito/export-users.mjs` — Pool 全ユーザーを JSON エクスポート
- `scripts/cognito/import-users.mjs` — JSON から新 Pool へインポート（--dry-run 対応）
- `docs/runbooks/cognito-pool-migration.md` — 手順書（事前チェック・export・import・検証・rollback）

### 4. 次回 Pool 再作成の手順（義務化）

Pool 再作成を伴う変更をデプロイする前に、以下を必ず実行:

```
事前: node scripts/cognito/export-users.mjs --pool-id <OLD_ID> --output /tmp/backup.json
  ↓
CDK deploy (新 Pool 作成)
  ↓
事後: node scripts/cognito/import-users.mjs --pool-id <NEW_ID> --input /tmp/backup.json --dry-run
      node scripts/cognito/import-users.mjs --pool-id <NEW_ID> --input /tmp/backup.json
```

## 却下した選択肢

### A. Pool Migration Lambda（透過移行）

初回ログイン時に旧 Pool から新 Pool へ透過マイグレーションする Lambda を配置する方式。
**却下理由**: Pre-PMF ユーザー数では実装コストが見合わない。Admin API で一括インポートで十分。

### B. Cognito への permanent identity 保存

内部 userId を Cognito custom attribute に保存し、sub 変更を検知してマッピングする。
**却下理由**: email lookup が既に機能している。二重管理になり複雑化するだけ。

### C. Pool 再作成を完全禁止（フィーチャーフラグ等で代替）

属性変更を必要としないアーキテクチャを徹底し、Pool 再作成自体を封じる。
**却下理由**: ADR-0018 が示す通り、将来の schema 変更を完全に封じることはできない。

## 結果

- DynamoDB 変更ゼロで Pool 再作成対応が可能になる
- export/import スクリプトの dry-run で事前検証ができる
- runbook により誰でも手順を再現できる
- Post-PMF でのユーザー消失リスクが排除される

## 参考

- [ADR-0018](0018-cognito-user-pool-logical-id-replacement.md) — 論理 ID 変更による Replacement
- [ADR-0019](0019-cdk-replacement-detection-gate.md) — CDK Replacement Detection Gate
- [cognito-pool-migration.md](../runbooks/cognito-pool-migration.md) — 移行ランブック
- Issue #1399
