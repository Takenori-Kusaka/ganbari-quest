# 0017. Cognito User Pool 再作成による email mutable 化（Pre-PMF 破壊的変更許容） — **Rejected**

- **Status**: Rejected (deployment failed 2026-04-21) — superseded by [ADR-0018](0018-cognito-user-pool-logical-id-replacement.md)
- **Date**: 2026-04-21
- **Related Issue**: #1366 (ADR-0018 で再設計して解決)

## ポストモーテム (2026-04-21 07:43 JST)

本 ADR の決定に基づいて `mutable: true` を deploy したところ、CloudFormation が **in-place UpdateUserPool** を試行し AWS Cognito から `Invalid AttributeDataType input` エラーを受信、`UPDATE_ROLLBACK_FAILED` で stuck した。

**想定と現実の乖離**:

| 項目 | ADR-0017 の想定 | 実際の挙動 |
|------|----------------|----------|
| CloudFormation の動作 | `mutable` 変更 → User Pool Replacement (新 Pool 作成 → 既存破棄) | in-place UpdateUserPool 試行 → Cognito が拒否 |
| 既存ユーザー | 全 federated ユーザー消失 (破壊) | **破壊されず** 3 名健在 (update が rejected されたため) |
| 結果 | 新 Pool で #1366 解決 | スタック UPDATE_ROLLBACK_FAILED で stuck、#1366 未解決 |

**復旧手順 (実施済)**:
1. `aws cloudformation continue-update-rollback --stack-name GanbariQuestAuth --resources-to-skip UserPool6BA7E5F2` で UserPool を skip して rollback 完走 → stack = `UPDATE_ROLLBACK_COMPLETE`
2. revert 案は**却下** (2026-04-21 PO 指摘: 「revert ではなくて、ちゃんと目的を達成できるように修正してもらいたい」)
3. [ADR-0018](0018-cognito-user-pool-logical-id-replacement.md) で**論理 ID を変更する明示的 Replacement 方式**に切り替えて #1366 を根本解決する設計に再起動

**根本原因**:
- CloudFormation `AWS::Cognito::UserPool` の `Mutable` 属性変更は **Update requires: Replacement** と AWS 公式ドキュメントに記載されているが、**CloudFormation 側がそれを Update にしか使わない** (置換トリガーとして扱わない) という既知のギャップがある
- 正攻法: 論理 ID を `UserPool6BA7E5F2` → `UserPoolV2` 等に変更して **明示的に新リソース作成** させる、または `RemovalPolicy.DESTROY` + 別 stack で新 Pool を parallel 構築

**教訓**:
- ADR で「CloudFormation が Replacement する」と書くときは必ず AWS 公式ドキュメントの `Update requires` 節を verbatim 引用し、さらに staging 環境で検証してから Accept する
- 本番 deploy 先行の破壊的変更は、まず **staging / CDK synth diff** で Replacement 挙動を確認する段取りが ADR に含まれていなかったのが構造的欠陥
- Pre-PMF だから破壊可能、だから staging 省略、という連鎖は `ADR-0010` の誤適用

**後続 ADR で再設計する点** → [ADR-0018](0018-cognito-user-pool-logical-id-replacement.md) で採択済み (2026-04-21):
- ~~User Pool 論理 ID を変える~~ → **採用** (`UserPool` → `UserPoolV2`)
- ~~bulk import 手順~~ → **不要** (ユーザー全員 Pre-PMF テストアカウントで消失許容と確認済み)
- SSM パラメータは CDK が自動追従
- rollback 計画: `removalPolicy: RETAIN` 継続により旧 Pool は orphan として残存、deploy 成功後に手動削除

**関連して起票する Issue**:
- Cognito ユーザーバックアップ / リストア運用確立 (DynamoDB 側 user ID との紐付け方法含む) — 本件のような Pool 再作成時にユーザーを失わないため

---

## 以下、元の ADR 本文 (履歴として保持)

## コンテキスト

本番 (ganbari-quest.com) で Google OAuth サインアップ済みユーザーが、セッション期限経過後に再度 Google OAuth でログインしようとすると Cognito callback が以下を返しログイン不能になる:

```
user.email: Attribute cannot be updated.
```

### 根本原因

`infra/lib/auth-stack.ts` の User Pool 定義と Google IdP 設定が構造的に衝突している:

1. User Pool の email 属性が `mutable: false` (標準属性)
2. Google IdP の `attributeMapping` で `email: GOOGLE_EMAIL` をマップ
3. 再認証のたびに Cognito は IdP から取得した email を「属性更新」として処理する (値が同じでも)
4. `mutable: false` に阻まれて `invalid_request` 応答になる

これは AWS Cognito の既知の挙動であり、User Pool 再作成以外に正攻法の解決手段はない。Pre-PMF 段階で実ユーザー数が 10 未満 (PO テストアカウント中心) のため、Pool 再作成に伴うデータ消失を許容できるのは今だけである。

### なぜ ADR に残すか

- 本番インフラの破壊的変更 (User Pool 再作成 → 全 federated ユーザー消失) を伴う
- `mutable` 属性変更は CloudFormation が User Pool を「作り直し」扱いするため、復旧は新 Pool 作成のみ
- Pre-PMF 終了後は同じ判断ができない (既存ユーザー保護が優先される) ため、判断の時点と境界を残す

## 決定

### 1. `email: { required: true, mutable: true }` に変更

`infra/lib/auth-stack.ts:38-40` の standardAttributes 定義を以下に変更する:

```ts
standardAttributes: {
  email: { required: true, mutable: true },
},
```

### 2. 既存 User Pool を破棄して再作成

CloudFormation が User Pool 置換 (Replacement) を自動トリガーする。既存 Pool の federated ユーザー (Google OAuth 経由) は全て消失する。Pre-PMF 境界内でのみ許容。

### 3. SSM パラメータの再バインド確認

`/ganbari-quest/cognito/user-pool-id` 等のパラメータが新 Pool の値に自動更新されることを deploy 後に確認する。手動で旧値を残さない。

### 4. email 変更 UI は実装しない

`mutable: true` は federated IdP 経由の email 更新を許容するだけで、ユーザー自身が email を変更する UI は追加しない。Google 側で email を変更した場合のみ次回 OAuth で Cognito に反映される。

## 代替案と却下理由

### 代替案 B: PreTokenGeneration Lambda で email 更新を bypass

- メリット: User Pool 再作成不要、データ保持
- デメリット: workaround が永続負債化。ADR-0010 (Pre-PMF 過剰防衛禁止) に反する。Lambda 実行コスト + デバッグ負荷が全てのログインで発生
- **却下**

### 代替案 C: Google IdP attributeMapping から email を削除

- メリット: User Pool 定義に触らない
- デメリット: 初回サインアップで email が空になり `required: true` 違反で user create 失敗。そもそも email が確認できない OAuth は成立しない
- **却下** (動作しない)

### 代替案 D: Google IdP 自体を無効化して email/password のみに退避

- メリット: 本 Issue は即時解消
- デメリット: ユーザー体験が劣化 (Google OAuth 訴求を取り下げる)、LP の「Google で始める」文言と矛盾
- **却下**

## 結果

### 期待される効果

- Google OAuth 再ログインが継続可能になる (セッション / Refresh Token 期限切れ後も)
- `#1365 (Refresh Token 実装)` のブロッカー解消 (Refresh Token があっても revoke 後に同じエラーが出るため、本件先行が必須)
- email 変更耐性が副次的に得られる (Google 側でユーザーが email を変更した場合も追従可能)

### トレードオフ

- **既存 federated ユーザー (Google OAuth 経由) 全消失**。PO テストアカウントのみのため許容
- email/password サインアップユーザーは影響を受けない
- 次回 Pool 再作成が必要なスキーマ変更は Pre-PMF 終了までに棚卸しすること (Post-PMF では実質不可能になる)

### デプロイ運用上の制約

- CDK deploy は auth-stack → compute-stack の順で更新される。新 Pool ID が SSM に反映された後に compute-stack が取得し直す
- `deploy-nuc.yml` は NUC で Cognito を使わないため影響なし
- 本 ADR merge 後のデプロイ前に、PO が AWS Console で旧 Pool のユーザー一覧を bak 目的でエクスポートしておく

## 関連

- ADR-0010 (Pre-PMF スコープ判断) — 破壊的変更の許容境界
- #1366 — 本 ADR の起票 Issue
- #1365 — Refresh Token 実装 (本 ADR の merge 後にアンブロック)
- AWS Cognito docs: Attribute mapping — `Mutable` が false のとき federated IdP からの更新が拒否される旨の公式記述

## Post-deploy 検証チェックリスト (Issue #1366 AC 連動)

- [ ] CDK deploy 完了、新 User Pool ID が発行される
- [ ] `/ganbari-quest/cognito/user-pool-id` 等 SSM パラメータが新値に更新
- [ ] Google OAuth で新規サインアップ → `/admin` 到達
- [ ] 1 時間以上放置 → 再度 Google OAuth → エラーなくログイン可能
- [ ] email/password サインアップフローの E2E regression なし
- [ ] `docs/design/14-セキュリティ設計書.md` / `07-API設計書.md` の Cognito 関連記述が新 Pool 前提に更新済み
