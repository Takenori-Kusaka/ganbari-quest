# 0018. Cognito User Pool 論理 ID 変更による明示的 Replacement (#1366 再設計)

- **Status**: Accepted
- **Date**: 2026-04-21
- **Related Issue**: #1366
- **Supersedes**: [ADR-0017](archive/0017-cognito-pool-recreation-email-mutable.md) (Rejected — in-place Update 失敗)

## 背景

ADR-0017 で `email: { mutable: false → true }` を deploy したところ、`AWS::Cognito::UserPool` の `Mutable` 属性変更は `Update requires: Replacement` とドキュメント記載があるにも関わらず、CloudFormation が in-place UpdateUserPool を試行し、Cognito から `Invalid AttributeDataType input` を受けて `UPDATE_ROLLBACK_FAILED` で stuck した（ポストモーテム詳細は ADR-0017 / git 履歴）。

ポストモーテムで判明した教訓:

- CloudFormation は `Mutable` 変更を Replacement ではなく Update として扱う実装ギャップを持つ
- Replacement を強制するには **論理 ID (Logical ID) を変更して別リソースとして認識させる**、または **RemovalPolicy.DESTROY + parallel stack** 方式が必要

本 ADR は前者（論理 ID 変更）を採用し、#1366 の根本解決である `email: mutable` 化を実行する。

## 決定

### 1. User Pool 論理 ID を `UserPool` → `UserPoolV2` に変更

`infra/lib/auth-stack.ts` で論理 ID を変更（実装と race 対処コメントは同ファイルが SSOT）:

```ts
this.userPool = new cognito.UserPool(this, 'UserPoolV2', {
  userPoolName: 'ganbari-quest-users-v2',
  standardAttributes: { email: { required: true, mutable: true } },
  removalPolicy: cdk.RemovalPolicy.RETAIN,
  ...
});
```

CloudFormation は旧 `UserPool` と `UserPoolV2` を**別リソース**として認識し、新 Pool を **Create** / 旧 Pool を **Delete** 試行 → `removalPolicy: RETAIN` により実体は orphan として残存する。旧 Pool は deploy 成功後に手動削除する。

### 2. 関連子リソースも新 Pool に紐づけ直される

`UserPoolClient` / `CognitoDomain` / `UserPoolIdentityProviderGoogle` / `CfnUserPoolGroup` (OpsGroup) / `CUSTOM_MESSAGE` trigger は CDK が新 Pool 側に自動再作成する。Route53 `AuthDomainAlias` は alias target が更新され、ACM 証明書は共用可能なので再利用される。

### 3. SSM パラメータの自動追従

`/ganbari-quest/cognito/user-pool-id` 等は CDK が `this.userPool.userPoolId` から取るため自動更新される。compute-stack は SSM 経由で読むので、次回 cold start で新 Pool に切り替わる。

### 4. 既存 federated ユーザー (3 名) は消失

Pre-PMF 境界内で全員 PO テストアカウントのみと確認済み（2026-04-21 ユーザー明示確認: 「ユーザは全員いなくなっても問題ない」）。再度 Google OAuth でサインアップし直す。

### 5. Deploy 後の手動クリーンアップ

新 Pool に stack が sync された後、旧 Pool を手動削除する（`removalPolicy: RETAIN` のため CloudFormation は触らない）:

```bash
aws cognito-idp list-user-pools --max-results 10 --region us-east-1
aws cognito-idp delete-user-pool --user-pool-id <旧 Pool ID> --region us-east-1
```

> 初回 deploy では 2 つの副次問題が発覚した（rollback 経緯詳細は git 履歴 / #1366）: ① 旧 Pool が `auth.ganbari-quest.com` カスタムドメインを保持したままで新 Pool が claim できず、`delete-user-pool-domain` での **事前**手動解放が必要だった ② `UserPoolClient` が `UserPoolIdentityProviderGoogle` 作成前に並列作成され "The provider Google does not exist" で失敗したため、`userPoolClient.node.addDependency(googleIdP)` を明示追加した。①②の恒久対処は `infra/lib/auth-stack.ts` のコメント（SSOT）と runbook [cognito-pool-migration.md](../runbooks/cognito-pool-migration.md) に反映済み。

## 代替案と却下理由

| 代替案 | 却下理由 |
|-------|---------|
| **A: RemovalPolicy.DESTROY + parallel stack** | 段階カットオーバー可能だが新 stack / SSM 二重化 / cutover script が必要で作業量 3〜4 倍。既存ユーザー全消失 OK の前提では過剰（ADR-0010 趣旨に反する） |
| **B: 既存ユーザー bulk import** (`admin-create-user`) | federated (Google) ユーザーは Provider 側 sub が変わらず再紐付け不可。email/password のみ import する意味が薄い。ユーザー明示確認で「全員消えて OK」承認済み |
| **C: ADR-0017 のまま `mutable: false` に revert** | stack は安定化できるが **#1366 未解決**。2026-04-21 ユーザー指摘「revert ではなくちゃんと目的を達成できるように修正」で明確に NG |

## 結果

### 期待される効果

- `#1366`（Google OAuth セッション期限後の再ログイン失敗）が根本解決される
- `email: mutable: true` により、Google 側で email が変更されても次回 OAuth で Cognito に追従反映される
- `#1365`（Refresh Token 実装）のブロッカー解消

### トレードオフ

- **既存 federated ユーザー全消失**（Pre-PMF 許容）
- **Deploy 中に短時間 (数分) の認証機能停止**: Hosted UI Domain の Route53 alias 更新タイミングで `auth.ganbari-quest.com` が一時的に 503 を返す可能性
- **CloudFormation stack に orphan resource (旧 User Pool) が残る**: deploy 後の手動削除タスクが発生

### リスクと緩和策

| リスク | 緩和策 |
|-------|-------|
| 新 Pool の Hosted UI Domain 作成が証明書検証で失敗 | 旧 Pool の ACM 証明書 ARN は別 Pool で参照しても共用可能。DNS は新 Pool の CloudFront に auto-switch |
| Lambda (CustomMessage trigger) のアタッチ失敗 | CDK が `addTrigger()` を新 Pool 側に実行し resource policy も付け直すため自動追従 |
| SSM 切替タイミングで compute-stack が旧 Pool ID を参照 | auth-stack → compute-stack の順で deploy。deploy 完了後の cold start で新 Pool ID を読み直す（`deploy.yml` は deploy all） |
| deploy 途中失敗で旧 Pool が残ったまま stack が壊れる | `RETAIN` で旧 Pool 実体を保護。rollback 時は論理 ID を戻して再 deploy で旧 Pool が再紐付けされる |

Post-deploy 検証チェックリスト（#1366 AC 連動: deploy 成功 / stack `UPDATE_COMPLETE` / 新 Pool ID の SSM 反映 / Google OAuth 再ログイン / 旧 Pool 手動削除 / セキュリティ設計書・API 設計書の Cognito 記述更新）は #1366 の AC として追跡する。

## 関連

- [ADR-0017](archive/0017-cognito-pool-recreation-email-mutable.md) — 本 ADR の前身 (Rejected)
- [ADR-0021](0021-cognito-pool-migration-user-preservation.md) — Pool 再作成時のユーザー保全戦略
- [ADR-0019](0019-cdk-replacement-detection-gate.md) — `cdk diff` Replacement 検知ゲート（ADR-0017 の根本欠陥への構造的対策）
- [ADR-0010](0010-pre-pmf-scope-judgment.md) — Pre-PMF 境界内での破壊的変更許容
- [cognito-pool-migration.md](../runbooks/cognito-pool-migration.md) — Pool 再作成の運用手順 SSOT
- `infra/lib/auth-stack.ts` — 論理 ID 変更・IdP 依存 race 対処の実装 SSOT
- #1366（起票）/ #1365（Refresh Token 実装、本 ADR 後にアンブロック）
