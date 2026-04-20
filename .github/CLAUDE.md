# .github/ — チケット管理・PR運用・Issue起票ルール

## チケット管理（GitHub Issues 必須）

チケットは **GitHub Issues** で管理する。`docs/tickets/` はレガシー（参照のみ・新規追加厳禁）。

- 新規チケットは `gh issue create` で作成。`docs/tickets/` にファイルを作ってはならない
- Issue テンプレート（`.github/ISSUE_TEMPLATE/dev_ticket.yml`）を使用すること
- ラベル体系: `type:feat|fix|refactor|infra|design|docs|marketing|test`, `priority:critical|high|medium|low`, `status:blocked|in-progress|on-hold`, `area:auth|billing|child-ui|admin|lp|db`
- コミットメッセージや PR 本文で `#<issue番号>` を参照し、完了時は `closes #<issue番号>` で自動クローズ

## 並行 PR 上書き防止ルール (#1200)

同一ファイルを変更する open PR が複数ある場合、後続 PR (特に full rewrite 系) が先行 PR の成果を
無意識に消滅させる事故が実際に発生している (PR #1143/#1144/#1178)。再発防止ルール:

### ルール

1. **PR open/synchronize 時に `pr-file-overlap.yml` が自動で overlap を検出** し、警告コメントを PR に投稿する（block しない）
2. overlap 警告が出た PR を **Ready for Review にする前に** 両 PR 作者間で以下を合意すること
   - どちらを先にマージするか
   - 後続 PR はどのタイミングで rebase するか
   - スコープを分けられる場合は重複ファイルを外すか
3. **full rewrite 系 PR (単一ファイルの -50% 行以上を変更) は、先行の小粒 PR のマージを待ってから rebase する**
   - 先に full rewrite をマージすると小粒 PR の意図を機械的には拾えない
   - どうしても先にやる必要がある場合、小粒 PR の内容を手動で取り込む責任を full rewrite 作者が負う
4. ローカル検証: `PR_NUMBER=<num> REPO=owner/repo node scripts/check-pr-file-overlap.mjs`

### 免除
- Dependabot PR は auto-merge 運用のため overlap 警告は無視してよい
- docs-only 変更同士の overlap は merge conflict 解決で十分

## Draft PR 運用

- PR は `gh pr create --draft` で Draft PR として作成
- 作業完了・CI 全通過後に `gh pr ready <番号>` で Ready for Review に変更
- **Ready 変更前に `gh pr checks <番号>` で CI 全緑を必ず確認すること**（#1074）
- CI 失敗中の PR を Ready にした場合、`draft-on-ci-fail.yml` が自動で Draft に戻す
- Draft PR はマージできない（GitHub ルールセットで保護）
- Dependabot PR は自動的に non-draft で作成されるため、従来通りレビュー → auto-merge

## レビュー必須化（#964 / Postmortem #962）

PR は **APPROVED レビュー 1 件以上なしではマージ禁止**。GitHub Branch Ruleset の
`required_approving_review_count=1` で強制。

- Copilot の自動レビュー (`COMMENTED`) は APPROVED にならない → 別途明示的な APPROVE が必要
- PO 1 人体制のため、Claude Code Quality Manager / 他 AI レビュアの APPROVED を APPROVED として運用
- 緊急修正 (`priority:critical`) は admin bypass (`RepositoryRole=Admin`) で許容、ただし PR 本文に bypass 理由を必ず記載
- 500 行超えの PR は `pr-size-check.yml` が自動警告コメントを投稿する (分割・スコープ明記を検討)

## admin bypass merge の証跡記録運用（#1201 / ADR-0044（archive））

PO 1 人体制（#964 Postmortem）のため、`required_approving_review_count=1` を admin 権限で
bypass して merge する運用が実際には発生している。レビュー観点が PR 本体に記録されないまま
main に入ることを防ぐため、admin bypass merge を行うときは **PR 本文または merge 前コメントに
Self-Review 証跡セクションを必ず記載する**。

### Self-Review 証跡テンプレート

PR 本文または merge 前コメントに以下セクションを含めること。`scripts/check-admin-bypass-evidence.mjs`
が自動検出する。

```markdown
## Self-Review 証跡 (admin bypass)

### 確認した観点
- [ ] Issue AC 全項目突合（Issue #<番号> の Acceptance Criteria に対する達成状況）
- [ ] UI/UX 禁忌事項（DESIGN.md §9）セルフチェック
- [ ] 並行実装ペア（`docs/design/parallel-implementations.md`）の同期確認
- [ ] テスト同梱（unit / E2E / Storybook のうち該当するもの）
- [ ] 設計書同期（`docs/CLAUDE.md` 更新表）
- [ ] セキュリティ・プライバシー影響無し（該当する場合は詳細）

### 添付スクリーンショット
- 主要変更画面の before/after 画像 or 該当なしの理由
- モバイル / デスクトップ両視点（UI 変更の場合）

### 実機確認ログ
- `npm run dev:cognito` での手動動作ログ（認証絡む画面の場合）
- 実行したコマンド・確認した URL・発見した事象
```

### 検出 & bot 通知

- merge 後 1 時間以内に `scripts/check-admin-bypass-evidence.mjs` が admin bypass PR を走査
- Self-Review セクションが無い PR には GitHub Actions bot が追記コメントを投稿
- 月次で `/ops` ダッシュボードに admin bypass merge 件数レポートを掲示（過剰運用検知）

### 免除

- Dependabot / renovate 等の bot 作成 PR
- `docs/` のみを変更した 50 行未満の typo 修正 PR
- これらは `scripts/check-admin-bypass-evidence.mjs` が自動スキップする

詳細: [ADR-0044（archive）](../docs/decisions/archive/0044-admin-bypass-evidence.md)

### Ruleset 変更コマンド (管理者のみ)
```bash
# required_approving_review_count を 1 に設定
gh api --method PUT repos/:owner/:repo/rulesets/<ruleset-id> \
  --input <patch.json>
```
詳細: Issue #964, Postmortem #962

### コマンド例
```bash
gh issue create --title "feat: 機能名" --label "type:feat,priority:medium"
gh pr create --draft --title "feat: #123 機能名" --body "closes #123"
gh pr ready <PR番号>
gh issue list --label "priority:high"
gh issue view <番号>
```

## Issue 起票ルール（CRITICAL — ADR-0003）

Issue は仕様書である。Issue の品質が低ければ実装の品質も低くなる。

### 起票前チェック（必須）
- [ ] 根本原因を特定した（症状ではなく原因を記載）
- [ ] 同一領域の過去 Issue を確認した（過去の修正がなぜ不十分だったか記載）
- [ ] 解決策は1つに絞った（「AまたはB」の併記は禁止）
- [ ] 再発問題はスクラップ＆ビルドを前提とした
- [ ] Acceptance Criteria に全境界条件を列挙した
- [ ] 設計上の制約を明記した（使用すべきパターン、禁止事項）

## 依存関係フィールドと工程区分（#1261）

全 3 テンプレート (`dev_ticket.yml` / `bug_report.yml` / `feature_request.yml`) に以下 4 フィールドを必須配置している。**起票時に全フィールドを適切に埋めること**。

### 3 分割された関連 Issue フィールド

| フィールド | 意味 | 運用 |
|-----------|------|------|
| **`blocked_by`** | このIssue を着手する前に完了すべき**上流 Issue** | 列挙した Issue が全て closed になるまで in-progress にしない |
| **`blocks`** | このIssue 完了後にアンブロックされる**下流 Issue** | 途中で scope 変更・close する場合、ここに挙げた Issue の再見積が必要 |
| **`related`** | 関連するが**依存関係を持たない** Issue / ADR / ドキュメント | 「Blocked by / Blocks」に該当しないもののみ |

**禁忌**: 単一の「関連」欄に混ぜて書かない。どれに入れるかで着手タイミングの判断が変わるため、AI エージェントも人間もその 3 分類を尊重する。

### 工程区分 dropdown (`phase`)

下流 Phase の Issue は **上流 Phase が閉じるまで着手しない**。

| Phase | 意味 | 典型例 |
|-------|------|--------|
| P0 | インフラ・プロセス更改 | Issue テンプレ改訂、CI ジョブ追加、ADR 管理プロセス |
| P1 | ポリシー・判断基準 (ADR) | Pre-PMF 判断基準、セキュリティ最小化方針 |
| P2 | プロダクト定義・顧客範囲（企画） | ペルソナ確定、LP IA |
| P3 | アーキテクチャ・技術選定 (ADR) | DynamoDB 単一テーブル、Cognito 採用 |
| P4 | 戦略・構造設計 | FSM 採用、ルート構造 |
| P5 | 実装・コンテンツ | マスタデータ拡充、文言 SSOT 統一 |
| P6 | 機能実装 | 新画面、新 API |
| P7 | バグ修正・クリーンアップ | defect fix、dead code 削除 |
| N/A | 独立タスク | 上記フローに当てはまらないタスク |

### 運用例

- Phase 0 の Issue が **Blocks** に Phase 1 の Issue 番号を記載 → Phase 1 Issue 起票者は Phase 0 クローズまで実装着手しない
- Phase 6 の新機能が **Blocked by** に Phase 2 企画 Issue を記載 → 企画が未確定のまま実装に進まない
- `related` にだけ載っている Issue は参考情報。待つ必要はない

### AI エージェントへの指示

- Claude Code / Copilot が Issue を自律的に起票する際も、**4 フィールド全て埋める**こと
- `Blocked by` が未解決のまま着手を始めない。違反は `.github/copilot-instructions.md` / CLAUDE.md のルール違反
- 既存 Issue の修正時、当時 phase が無かった Issue は現時点で推定した値を記入する

詳細: Issue #1261

## 新規 env / secret 追加時の必須要件（ADR-0006 / #914）

production guard を新規追加する PR は、CI の `new-env-distribution-check` ジョブが
PR 本文の **「配布済み: <ENV>」証跡** を検証する。証跡がない場合は CI が red になりマージ不可。

### 検出パターン（`scripts/check-new-required-env.mjs`）
- `assert*Configured()` 関数定義 / 呼び出し
- `throw new Error('XXX is required')` 形式（multi-line 対応）
- `process.env.X || (() => { throw ... })()` 形式

### PR 本文に必須記載

```markdown
## 配布済み env / secret (ADR-0006)
- 配布済み: AWS_LICENSE_SECRET → GitHub Actions Secrets (deploy.yml, deploy-nuc.yml)
- 配布済み: AWS_LICENSE_SECRET → SSM Parameter Store /ganbari-quest/prod/aws_license_secret
- 配布済み: AWS_LICENSE_SECRET → NUC .env (本機 + バックアップ機)
```

### ADR-0006 禁止 5 項目（PR レビューで `[must]` 所見化）

1. throw を含む production guard を warn に落とす変更
2. `NODE_ENV === 'test'` 等で本体コードの assertion を skip する分岐の混入
3. `ALLOW_LEGACY_*` / `DISABLE_*` / `SKIP_*` の既定値を true にする変更
4. health check / retry / timeout を根本原因未解明のまま増やす変更
5. `.skip` / `.todo` / `// @ts-expect-error` / `// eslint-disable` の追加（Issue 番号 + owner + 30 日以内 deadline の 3 点セットが無いもの）

詳細: [ADR-0006](../docs/decisions/0006-safety-assertion-erosion-ban.md)

## Pre-PMF Issue 優先度判断基準（ADR-0010）

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

詳細: [ADR-0010](../docs/decisions/0010-pre-pmf-scope-judgment.md)
