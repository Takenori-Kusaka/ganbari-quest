# 0018. Cognito User Pool 論理 ID 変更による明示的 Replacement (#1366 再設計)

- **Status**: Accepted
- **Date**: 2026-04-21
- **Related Issue**: #1366
- **Supersedes**: [ADR-0017](0017-cognito-pool-recreation-email-mutable.md) (Rejected — in-place Update 失敗)

## 背景

ADR-0017 で `email: { mutable: false → true }` を CloudFormation に deploy したところ、AWS::Cognito::UserPool の `Mutable` 属性変更は `Update requires: Replacement` とドキュメント記載があるにも関わらず、実際には **CloudFormation が in-place UpdateUserPool を試行** し、Cognito から `Invalid AttributeDataType input` を受けて `UPDATE_ROLLBACK_FAILED` で stuck した。

ADR-0017 ポストモーテム（2026-04-21 07:43 JST 記録）で以下が判明:

- CloudFormation は `Mutable` 変更を Replacement ではなく Update として扱う実装ギャップを持つ
- 「Replacement を強制する」には **論理 ID (Logical ID) を変更して別リソースとして認識させる**、または **RemovalPolicy.DESTROY + parallel stack** 方式が必要

本 ADR は前者（論理 ID 変更）を採用し、#1366 の根本解決である `email: mutable` 化を実行する。

## 決定

### 1. `infra/lib/auth-stack.ts` の User Pool 論理 ID を変更

```ts
// Before (ADR-0017 の in-place 更新試行で UPDATE_ROLLBACK_COMPLETE 状態で残存)
this.userPool = new cognito.UserPool(this, 'UserPool', { ... });

// After
this.userPool = new cognito.UserPool(this, 'UserPoolV2', {
  userPoolName: 'ganbari-quest-users-v2',
  standardAttributes: { email: { required: true, mutable: true } },
  removalPolicy: cdk.RemovalPolicy.RETAIN, // 継続
  ...
});
```

CloudFormation は `UserPool6BA7E5F2` と `UserPoolV2XXXXX` を**別リソース**として認識し、

- 新 User Pool (`UserPoolV2`) を **Create**
- 旧 User Pool (`UserPool`) を **Delete** 試行 → `removalPolicy: RETAIN` により実体は残存 (orphan)

という動作になる。旧 Pool は deploy 成功後に AWS Console または CLI で手動削除する。

### 2. 関連子リソースも新 Pool に紐づけ直される

CDK は以下の子リソースを自動で新 Pool 側に再作成する（論理 ID が `UserPoolV2` の子として展開されるため）:

- `UserPoolClient` (PublicClient)
- `CognitoDomain` (auth.ganbari-quest.com)
- `UserPoolIdentityProviderGoogle` (GoogleIdP)
- `CfnUserPoolGroup` (OpsGroup)
- `UserPoolOperation.CUSTOM_MESSAGE` trigger (CustomMessageFn)

Route53 `AuthDomainAlias` は旧 domain resource の削除 → 新 domain resource の作成に伴い alias target が更新される。ACM 証明書は共用可能なので再利用される。

### 3. SSM パラメータの自動追従

`/ganbari-quest/cognito/user-pool-id` 等の SSM パラメータは CDK が `this.userPool.userPoolId` から値を取るため、自動で新 Pool の ID に更新される。compute-stack は SSM 経由で Pool ID を読むので、次回 cold start で新 Pool に切り替わる。

### 4. 既存 federated ユーザー (3 名) は消失

Pre-PMF 境界内で全員 PO テストアカウントのみと確認済み (2026-04-21 ユーザー明示確認: 「ユーザは全員いなくなっても問題ない」)。再度 Google OAuth でサインアップし直す。

### 5. Deploy 後の手動クリーンアップ

CloudFormation stack が新 Pool にクリーンに sync された後、以下を実施:

```bash
# 旧 Pool の確認 (ganbari-quest-users のはず)
aws cognito-idp list-user-pools --max-results 10 --region us-east-1

# 旧 Pool を手動削除 (RETAIN により CloudFormation は触らないため)
aws cognito-idp delete-user-pool --user-pool-id <旧 Pool ID> --region us-east-1
```

## 代替案と却下理由

### 代替案 A: RemovalPolicy.DESTROY + parallel stack 方式

- **メリット**: 新旧 Pool を併存させる期間を長く取れる（カットオーバーを段階的に実施可能）
- **デメリット**: 新 stack 作成 / SSM パラメータ二重化 / cutover スクリプト追加が必要で、作業量が論理 ID 変更の 3〜4 倍
- **却下**: Pre-PMF で既存ユーザー全員消失 OK という前提なら過剰。ADR-0010 (Pre-PMF スコープ判断) の趣旨に反する

### 代替案 B: 既存ユーザー bulk import (`aws cognito-idp admin-create-user`)

- **メリット**: 既存ユーザーの email/paswword アカウントを新 Pool に移行できる
- **デメリット**: federated (Google OAuth) ユーザーは Provider 側の sub が変わらないので import しても再紐付け不可。email/password のみ import する意味が薄い
- **却下**: ユーザー明示確認で「全員消えて OK」と承認済み

### 代替案 C: ADR-0017 のまま mutable: false に revert

- **メリット**: stack を安定化させられる
- **デメリット**: **#1366 未解決のまま**。Google OAuth 再ログイン不能を放置することになる
- **却下**: 2026-04-21 ユーザー指摘「revert ではなくて、ちゃんと目的を達成できるように修正してもらいたい」により明確に NG

## 結果

### 期待される効果

- `#1366` (Google OAuth セッション期限後の再ログイン失敗) が根本解決される
- `email: mutable: true` により、Google 側で email が変更されても次回 OAuth で Cognito に追従反映される
- `#1365` (Refresh Token 実装) のブロッカー解消

### トレードオフ

- **既存 federated ユーザー全消失** (Pre-PMF 許容)
- **Deploy 中に短時間 (数分) の認証機能停止**: Hosted UI Domain の Route53 alias 更新タイミングで一時的に auth.ganbari-quest.com が 503 を返す可能性あり
- **CloudFormation stack に orphan resource (旧 User Pool) が残る**: deploy 成功後に手動削除する運用タスクが発生

### リスクと緩和策

| リスク | 緩和策 |
|-------|-------|
| 新 User Pool の Hosted UI Domain 作成が証明書検証で失敗 | 旧 Pool で使用中の ACM 証明書 ARN は共用可能（別 User Pool で参照しても問題ない）。`auth.ganbari-quest.com` の DNS は新 Pool の CloudFront に auto-switch される |
| Lambda (CustomMessage trigger) のアタッチ失敗 | CDK が `userPool.addTrigger()` を新 Pool 側に実行するので自動追従。Lambda の resource policy も CDK が付け直す |
| SSM パラメータ切替タイミングで compute-stack が旧 Pool ID を参照 | auth-stack → compute-stack の順で CDK deploy される。deploy 完了後に Lambda を明示的に再起動することでコールドスタート時に新 Pool ID を読み直す。`deploy.yml` は CDK deploy all なので自動で compute-stack も更新される |
| deploy 途中失敗で旧 Pool が残ったまま stack が壊れる | `removalPolicy: RETAIN` により旧 Pool の実体は保護される。rollback 時は論理 ID を元に戻して再 deploy すれば旧 Pool が再紐付けされる |

## Post-deploy 検証チェックリスト (Issue #1366 AC 連動)

- [ ] `git push` → GitHub Actions `deploy.yml` 成功 (test → CDK deploy all)
- [ ] CloudFormation stack `GanbariQuestAuth` が `UPDATE_COMPLETE` (旧 `UPDATE_ROLLBACK_COMPLETE` から抜ける)
- [ ] 新 User Pool ID が `/ganbari-quest/cognito/user-pool-id` に反映
- [ ] Google OAuth で新規サインアップ → `/admin` 到達
- [ ] 1 時間以上放置 → 再度 Google OAuth → エラーなくログイン可能 (#1366 AC)
- [ ] email/password サインアップフローの E2E regression なし
- [ ] 旧 User Pool を手動削除 (`aws cognito-idp delete-user-pool`)
- [ ] `docs/design/14-セキュリティ設計書.md` / `07-API設計書.md` の Cognito 記述を新 Pool 前提に更新

## 今後のために起票する Issue

- **Cognito ユーザーバックアップ / リストア運用確立** (#1366 派生): DynamoDB 側の user ID との紐付け方法を含め、Pool 再作成時にユーザーを失わないための運用手順を策定する。Pre-PMF 終了までに必ず整備する（Post-PMF 以降は本 ADR のような破壊的変更が許容されない）
- **CDK synth diff を deploy 前チェックに組み込む**: ADR-0017 の根本欠陥 (「staging で Replacement 挙動を確認する段取りが無かった」) への構造的対策。`cdk diff --strict` を deploy job の必須ステップにし、`Replacement` / `requires replacement` を含む diff が出たら deploy を block する案

## 関連

- [ADR-0017](0017-cognito-pool-recreation-email-mutable.md) — 本 ADR の前身 (Rejected)
- [ADR-0010](0010-pre-pmf-scope-judgment.md) — Pre-PMF 境界内での破壊的変更許容
- #1366 — 本 ADR の起票 Issue
- #1365 — Refresh Token 実装 (本 ADR 後にアンブロック)
- AWS CloudFormation docs: `AWS::Cognito::UserPool` `Update requires: Replacement` (実装ギャップの公式明記箇所)
