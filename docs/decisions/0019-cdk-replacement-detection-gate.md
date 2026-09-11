# 0019. CDK Replacement 検知を deploy 前必須ゲートとして組み込む

- **Status**: Accepted
- **Date**: 2026-04-24
- **Related Issue**: #1400
- **Related Incidents**: #1366, ADR-0017 (Rejected), ADR-0018 (Accepted)

## 背景

2026-04-21 に #1366 の CDK 変更 (Cognito User Pool の `email: mutable: false → true`) を本番
deploy したところ、AWS CloudFormation が in-place UpdateUserPool を試行して `UPDATE_ROLLBACK_FAILED`
で stuck する事故が発生した (ADR-0017 参照)。

根本的な構造的欠陥:

- `.github/workflows/deploy.yml` は `cdk deploy` を直接実行しており、deploy 前に `cdk diff` で
  Replacement が起きるかを確認する仕組みがなかった
- PR レビュー時点で「CDK が in-place Update を試みる」と気づけなかった
- ADR を書いても、実際の deploy で初めて判明するリスクが残ったまま

## 決定

### 1. `scripts/check-cdk-replacement.mjs` の作成

CDK diff の stdout を解析して Replacement / Destroy 対象の論理 ID を抽出するスクリプト。

**検出パターン**:

| パターン | 説明 |
|---------|------|
| `[-] AWS::Type LogicalId ...` | リソース削除 (destroy) |
| `[~] AWS::Type LogicalId ... (replace/replacement)` | リソース置き換え |
| プロパティ行の `(may cause replacement)` / `(requires replacement)` | プロパティ変更が置き換えを誘発 |

**承認メカニズム**:
- PR 本文またはコミットメッセージに `replacement-approved: LogicalId1,LogicalId2` を記載
- squash merge のコミットメッセージに PR 本文が含まれるため、PR 本文への記載で十分
- 承認がない場合は exit 1 でデプロイをブロック

### 2. `.github/workflows/deploy.yml` への組み込み

CDK deploy ステップの **直前** に `cdk diff | check-cdk-replacement.mjs` を実行する:

- Phase 1: `GanbariQuestStorage` deploy 前に Storage スタック diff チェック
- Phase 3: `--all` deploy 前に全スタック diff チェック (Auth スタックの Cognito User Pool 等が対象)

コミットメッセージを `git log -1 --pretty=%B` で取得し、`COMMIT_MSG` 環境変数として渡す。

### 3. `.github/PULL_REQUEST_TEMPLATE.md` への `replacement-approved` セクション追加

CDK Replacement が予想される PR で、作者がマーカーを記載する場所と使い方の説明を追加。

## 承認マーカーの使い方

CDK diff ステップが以下を出力した場合:

```
CDK Replacement / Destroy detected (2 resource(s)):
  [destroy] UserPool — NOT APPROVED
  [destroy] UserPool/PublicClient — NOT APPROVED

DEPLOY BLOCKED: 2 unapproved replacement(s) detected.
Add the following line to the PR body (squash merge commit message) to approve:
  replacement-approved: UserPool,UserPool/PublicClient
```

PR 本文に以下を追加する:

```
replacement-approved: UserPool,UserPool/PublicClient
```

## 検討した代替案

### A. CDK changeset を全 PR で実行する

- **メリット**: より正確な Replacement 検知 (CloudFormation Changeset ベース)
- **デメリット**: 全 PR で AWS 認証と実 stack 参照が必要。PR CI コストが増大。
  フル spun-up は Pre-PMF ではオーバーエンジニアリング (ADR-0010)

### B. cdk diff --strict で CI 失敗させる

- **メリット**: 実装シンプル
- **デメリット**: 変更があるだけで失敗するため、通常の変更もブロックされる。運用不可能。

### C. PR レビュー時の目視確認のみ

- **メリット**: 変更なし
- **デメリット**: ADR-0017 の事故と同じ経路が再発する。機械チェックなしは再発防止にならない。

## 制約・注意事項

### cdk diff の制限

- `cdk diff` は CloudFormation API で現在のスタック状態を取得するため、AWS 認証が必要
  → deploy ジョブ (OIDC 認証済み) 内でのみ実行可能。PR CI には含まない。
- Storage スタックが未デプロイ (初回デプロイ) の場合、diff はすべて `[+]` (新規追加) のみ → Replacement なし → 正常通過
- `cdk diff` は `--strict` なしで使用。`--strict` は変更があるだけで exit 1 になる

### `Fn::GetAtt` ベース Route53 RecordSet の悲観的 `may-cause-replacement`（SES DKIM 系）

`cdk diff` の template-only 比較は、replacement 強制プロパティ（Route53 RecordSet の `Name`/`Type`/`HostedZoneId`）に**未解決 `Fn::GetAtt` トークンが含まれる場合、値を確定できず「変わったかもしれない=may-cause-replacement」と悲観判定する**（既知挙動。`aws/aws-cdk#21164` は現在 404 で、同題の <https://github.com/aws/aws-cdk-cli/issues/1572> が移管先と見られる）。SES `EmailIdentity`（Easy DKIM）が自動生成する `DkimDnsToken1/2/3` は `Name`・`Value` とも同一 EmailIdentity への `Fn::GetAtt` で、**identity が replace されない限り SES 発行値（DKIM 検証ホスト）は不変**（AWS SES 公式: Easy DKIM トークンは domain identity 単位で安定）。

→ **aws-cdk-lib の bump 等で `EmailIdentity/DkimDnsToken*` に `may-cause-replacement` が出ても、infra コードが EmailIdentity を無変更なら実値変化ではなく differ のアーティファクト**。承認前に `cdk diff --method=change-set`（CloudFormation の正確判定で悲観判定を排除）+ deploy 後 `aws sesv2 get-email-identity` で `DkimStatus=SUCCESS` を smoke 確認すれば安全に承認できる。初回事例: aws-cdk-lib 2.260→2.261 bump で `EmailIdentity/DkimDnsToken3` が false-BLOCK（#3570 統合、一次情報で実値不変を確定）。

### `BucketDeployment` の `AwsCliLayer` 置換は真正・無害（悲観判定ではない）

`s3deploy.BucketDeployment` が付ける `AwsCliLayer` は `AWS::Lambda::LayerVersion` で、**全プロパティが Update requires: Replacement**（[CFN](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-layerversion.html) / [layer version は immutable](https://docs.aws.amazon.com/lambda/latest/dg/chapter-layers.html)）。**上の DKIM 系と違い悲観判定ではないので `--method=change-set` にしても消えない**（本 gate は既定 `auto` で既に change set 判定）。発生条件は aws-cdk-lib の bump 全部ではなく **`@aws-cdk/asset-awscli-v1` の pin が動いたとき**（実測: 2.261.0 / 2.262.2 = 2.2.282、2.268.0 = 2.2.292）。

**失われるものは無い**: CFN は「新規作成 → 参照張替え → 旧削除」で、Lambda は[削除済み layer version を参照する関数はそのまま動く](https://docs.aws.amazon.com/lambda/latest/dg/creating-deleting-layers.html)と明記。layer は handler の `Layers` からしか参照されず `Custom::CDKBucketDeployment` のプロパティに含まれないため**配信済み S3 オブジェクトは触られない**。**回避策も無い**（`BucketDeploymentProps` に layer 差替 prop 無し / CLI の除外機能も未実装: [aws-cdk-cli#903](https://github.com/aws/aws-cdk-cli/issues/903)）。AWS 公式にこのケースの扱いを定めた記述は見つけられなかった。

→ **恒久対処として gate 側で除外する（#4904）。** 除外条件は **`AWS::Lambda::LayerVersion` かつ construct path が `…/AwsCliLayer`** の両方一致に限る（型だけ / path だけでは除外しない。`scripts/check-cdk-replacement.mjs` の `EXEMPT_RULES`）。**握り潰しではなく `[exempt]` として必ず出力する**ので、除外されたことは毎回ログに残る。それ以外の replacement 検出は不変。

### 承認は main HEAD の 1 commit に紐づく（承認後に commit を積むと失効する）

gate は `git log -1 --pretty=%B` で **main HEAD の commit message だけ**を読む。**承認後に別 commit を main に積むと承認が失効する。** 第22回統合（2026-09-11）は hotfix `868122267` が `ErrorPagesDeploy/AwsCliLayer` のみ承認した状態で HEAD になり、次 run で `StaticAssetsDeploy/AwsCliLayer` が露出して 2 度目の BLOCK になった。→ **承認 commit を HEAD に置いたら deploy を発火させるまで main に積まない。** なお `AwsCliLayer` 起因の BLOCK は #4904 の除外で構造的に起きなくなったため、この運用が要るのは**本物の Replacement を承認するとき**だけになった。

### 本番 deploy でしか出ない replacement がある（staging 全緑 ≠ 本番 deploy 可）

`deploy-aws-staging` の gate は staging の stack しか見ず、**staging に無いリソースは原理的に exercise されない**。本番が BLOCK した時点では**まだ何も適用されていない**ので、止まってから実 diff の LogicalId を見て承認する（事前のブランケット承認をしない）。同 class は #4724（`DsqlBackupRole` の managed policy ARN が本番 deploy で初めて 404 → #4900）でも起きた。

### 承認の取り消し

`replacement-approved` マーカーを含む PR が一度マージされた後でも、次の deploy では
再度 diff チェックが走る。意図的な Replacement が完了した後は、後続 PR に不要なマーカーは
残さなくてよい (squash merge のコミットメッセージはそのコミット固定で、後続のコミットには引き継がれない)。

### CloudFormation Logical ID の識別方法

CDK diff 出力の形式:
```
[-] AWS::ResourceType CDK_CONSTRUCT_ID CF_LOGICAL_ID_WITH_HASH
```

`check-cdk-replacement.mjs` は `CDK_CONSTRUCT_ID` (3番目のトークン) を識別子として使用する。
承認マーカーには `CDK_CONSTRUCT_ID` を記載すること。

例: `[-] AWS::Cognito::UserPool UserPool UserPool6BA7E5F2`
→ 承認に必要なのは `UserPool` (CF hash の `6BA7E5F2` は不要)

## 教訓 (ADR-0017 から)

本 ADR は ADR-0017 postmortem の「構造的欠陥」に対する機械的ゲートである:

> 本番 deploy 先行の破壊的変更は、まず staging / CDK synth diff で Replacement 挙動を確認する
> 段取りが ADR に含まれていなかったのが構造的欠陥

「ADR を書く」だけでは防げない。機械チェックを deploy フローに組み込むことで、
次回の CDK Replacement 事故を予防する。
