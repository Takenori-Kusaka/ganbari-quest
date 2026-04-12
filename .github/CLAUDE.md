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

## 新規 env / secret 追加時の必須要件（ADR-0029）

新規必須環境変数 / secret を追加する PR では、以下を全て満たすこと（CI スクリプト `scripts/check-new-required-env.mjs` が機械的にブロックする）。

### 必須チェック
- [ ] secret を**配布先まで完全に配置**してから PR を出す（後回し禁止）
  - GitHub Secrets / SSM Parameter Store / NUC `.env` / `.env.production` のうち該当する全配布先
- [ ] PR 本文に配布証跡を以下フォーマットで記載:
  ```
  配布済み: ENV_NAME → GitHub Secrets, SSM Parameter Store, NUC .env
  ```
- [ ] 該当モジュールが **fail-closed default**（未設定時に throw）であること
- [ ] 本番デプロイワークフローを単独で実行し green を確認した（ADR-0021）

### 禁止事項（ADR-0029 違反 — `[must]` 所見扱い）
- 既存の `assert*Configured()` を `console.warn` に落とす変更
- `NODE_ENV === 'test'` 等で本体コードの assertion を skip する分岐の混入
- `ALLOW_LEGACY_*` / `DISABLE_*` / `SKIP_*` の既定値を `true` にする変更
- 根本原因未解明のまま retry / timeout / health check を増やす変更
- `.skip` / `.todo` / `// @ts-expect-error` / `// eslint-disable` の追加（Issue 番号 + 30 日 deadline コメント無しの場合）

### 例外手続き
上記禁止事項を実行する唯一のルート: **別 ADR を書き、旧 ADR を supersede する**。PR 単独では不可。

### 一時的緩和の境界判別
> その緩和を取り消すときの owner と deadline が PR 本文に書かれているか。書かれていない緩和はすべて禁止。

詳細: [docs/decisions/0029-safety-assertion-erosion-ban.md](../docs/decisions/0029-safety-assertion-erosion-ban.md)

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
