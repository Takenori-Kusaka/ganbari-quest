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

### 3. `.github/pull_request_template.md` への `replacement-approved` セクション追加

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
