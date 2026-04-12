# .github/ — チケット管理・PR運用・Issue起票ルール

## チケット管理（GitHub Issues 必須）

チケットは **GitHub Issues** で管理する。`docs/tickets/` はレガシー（参照のみ・新規追加厳禁）。

- 新規チケットは `gh issue create` で作成。`docs/tickets/` にファイルを作ってはならない
- Issue テンプレート（`.github/ISSUE_TEMPLATE/dev_ticket.yml`）を使用すること
- ラベル体系: `type:feat|fix|refactor|infra|design|docs|marketing|test`, `priority:critical|high|medium|low`, `status:blocked|in-progress|on-hold`, `area:auth|billing|child-ui|admin|lp|db`
- コミットメッセージや PR 本文で `#<issue番号>` を参照し、完了時は `closes #<issue番号>` で自動クローズ

## Draft PR 運用

- PR は `gh pr create --draft` で Draft PR として作成
- 作業完了・CI 全通過後に `gh pr ready <番号>` で Ready for Review に変更
- Draft PR はマージできない（GitHub ルールセットで保護）
- Dependabot PR は自動的に non-draft で作成されるため、従来通りレビュー → auto-merge

### コマンド例
```bash
gh issue create --title "feat: 機能名" --label "type:feat,priority:medium"
gh pr create --draft --title "feat: #123 機能名" --body "closes #123"
gh pr ready <PR番号>
gh issue list --label "priority:high"
gh issue view <番号>
```

## Issue 起票ルール（CRITICAL — ADR-0018）

Issue は仕様書である。Issue の品質が低ければ実装の品質も低くなる。

### 起票前チェック（必須）
- [ ] 根本原因を特定した（症状ではなく原因を記載）
- [ ] 同一領域の過去 Issue を確認した（過去の修正がなぜ不十分だったか記載）
- [ ] 解決策は1つに絞った（「AまたはB」の併記は禁止）
- [ ] 再発問題はスクラップ＆ビルドを前提とした
- [ ] Acceptance Criteria に全境界条件を列挙した
- [ ] 設計上の制約を明記した（使用すべきパターン、禁止事項）

## 新規 env / secret 追加時の必須要件（ADR-0029 / #914）

production guard を新規追加する PR は、CI の `new-env-distribution-check` ジョブが
PR 本文の **「配布済み: <ENV>」証跡** を検証する。証跡がない場合は CI が red になりマージ不可。

### 検出パターン（`scripts/check-new-required-env.mjs`）
- `assert*Configured()` 関数定義 / 呼び出し
- `throw new Error('XXX is required')` 形式（multi-line 対応）
- `process.env.X || (() => { throw ... })()` 形式

### PR 本文に必須記載

```markdown
## 配布済み env / secret (ADR-0029)
- 配布済み: AWS_LICENSE_SECRET → GitHub Actions Secrets (deploy.yml, deploy-nuc.yml)
- 配布済み: AWS_LICENSE_SECRET → SSM Parameter Store /ganbari-quest/prod/aws_license_secret
- 配布済み: AWS_LICENSE_SECRET → NUC .env (本機 + バックアップ機)
```

### ADR-0029 禁止 5 項目（PR レビューで `[must]` 所見化）

1. throw を含む production guard を warn に落とす変更
2. `NODE_ENV === 'test'` 等で本体コードの assertion を skip する分岐の混入
3. `ALLOW_LEGACY_*` / `DISABLE_*` / `SKIP_*` の既定値を true にする変更
4. health check / retry / timeout を根本原因未解明のまま増やす変更
5. `.skip` / `.todo` / `// @ts-expect-error` / `// eslint-disable` の追加（Issue 番号 + owner + 30 日以内 deadline の 3 点セットが無いもの）

詳細: [docs/decisions/0029-safety-assertion-erosion-ban.md](../docs/decisions/0029-safety-assertion-erosion-ban.md)

## Pre-PMF Issue 優先度判断基準（ADR-0023）

Pre-PMF フェーズでは、PO 1 人 + エンジニア出身という体制に起因するバイアス（課金・管理画面偏重 / Growth・Marketing 欠落）を機械的に是正するため、**`type:feat` の新規起票は Pre-PMF チェックリストを必須**とする。

### チェック対象
- PO 自身が起票する場合
- Claude Code / その他 AI エージェントが代理起票する場合

両方に適用。

### チェック免除
- `priority:critical` な bug fix
- 法務・セキュリティ・コンプライアンス対応
- `type:fix` の既存機能の保守（新規機能追加ではないため）

### 運用ルール
- `feature_request.yml` テンプレの Pre-PMF チェックセクションを必ず埋める
- 「Pre-PMF サインアップ 20 名/月 (V2MOM Q2 目標) なしで到達できるか」の自問が最重要
  - できる → `priority:medium` 以下にする
  - できない → `priority:high` 以上にし、本文に根拠を明記
- 新規機能 Issue が連続している場合、必ず Growth / Marketing / Activation 系を 1 本挟む
- AI エージェントが自律的に Issue を起票するときも、このチェックを省略してはならない

詳細: [docs/decisions/0023-pre-pmf-issue-priority-guidelines.md](../docs/decisions/0023-pre-pmf-issue-priority-guidelines.md)
