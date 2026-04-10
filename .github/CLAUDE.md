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
