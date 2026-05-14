# .github/ — チケット管理・PR 運用

**SSOT**: ADR-0003（Issue 品質）/ ADR-0006（assertion 禁止）/ ADR-0010（Pre-PMF）/ ADR-0013（LP truth）/ ADR-0022（QM Approve）

## チケット管理（GitHub Issues 必須）

- 新規チケットは `gh issue create`。`docs/tickets/` への新規ファイル禁止（レガシー、参照のみ）
- テンプレート: `.github/ISSUE_TEMPLATE/dev_ticket.yml` / `bug_report.yml` / `feature_request.yml`
- ラベル: `type:feat|fix|refactor|infra|design|docs|marketing|test` / `priority:critical|high|medium|low` / `status:blocked|in-progress|on-hold` / `area:auth|billing|child-ui|admin|lp|db`
- PR / コミットで `closes #<num>` 自動クローズ

## Issue 起票ルール（CRITICAL — ADR-0003）

Issue 起票手順 SSOT → [Skill: issue-triage](../.claude/skills/issue-triage/SKILL.md) (Pre-PMF check / HEREDOC 禁止 / OSS 先調査 / research 添付 / namespace 重複検査、#2089)。Issue は仕様書、品質低下が実装品質低下に直結する。

最低限の絶対ルール (詳細は SKILL.md):
- 根本原因特定 / 同一領域の過去 Issue 確認 / 解決策は 1 つに絞る / AC に全境界条件列挙 / 再発問題はスクラップ&ビルド前提

## 依存関係 3 分割と工程区分（#1261）

| フィールド | 意味 |
|---|---|
| `blocked_by` | 上流 Issue。全 closed まで in-progress にしない |
| `blocks` | 下流 Issue。scope 変更・close 時に再見積必要 |
| `related` | 依存関係なしの参考 Issue / ADR / docs |

工程区分 dropdown (P0-P7 / N/A): 下流 Phase は上流が閉じるまで着手しない。
- P0 インフラ・プロセス / P1 ポリシー (ADR) / P2 企画 / P3 アーキ (ADR) / P4 構造設計 / P5 実装・コンテンツ / P6 機能実装 / P7 バグ修正

AI エージェントも 4 フィールド全て埋める。`Blocked by` 未解決のまま着手禁止。

## Draft PR 運用

- `gh pr create --draft` で作成 → CI 全通過後 `gh pr ready <num>` で Ready 化（#1074）
- CI 失敗で Ready にすると `draft-on-ci-fail.yml` が自動 Draft 戻し
- Dependabot PR は non-draft 自動作成、auto-merge 運用

### Dependabot CI exempt（#1808）

Dependabot / Renovate の依存更新 PR は以下を自動 skip（`dependencies` ラベル + `actor != bot`）:
`pr-template-gate.yml` 5 ジョブ / `pr-ac-verification-check.yml` / `pr-merge-gate.yml`。AC マップ・Ready チェックは依存更新に該当しない。

## 並行 PR 上書き防止（#1200）

事故事例: PR #1143/#1144/#1178 で full rewrite が小粒 PR の成果を消滅。

1. PR open/synchronize 時 `pr-info.yml` overlap-check が overlap を自動検出（block しない）
2. overlap 警告 PR は Ready 前に両作者間で合意（マージ順序 / rebase / scope 分割）
3. **full rewrite 系 PR (-50% 行以上)** は先行小粒 PR のマージを待ってから rebase
4. ローカル検証: `PR_NUMBER=<num> REPO=owner/repo node scripts/check-pr-file-overlap.mjs`

免除: Dependabot / docs-only 同士

## レビュー必須化 + QM Approve 体制（ADR-0022 / #1481）

- `required_approving_review_count=1` 強制。Copilot の `COMMENTED` は APPROVED にならない
- admin bypass 完全禁止（`bypass_actors: []`）。`ganbariquestsupport-lab`（QA 専用）が approve → squash merge
- approve body は `docs/sessions/qa-session.md` Tier 2 手順 5 の 5 手順（Issue 照合 / SS 実視認 / SS 欠落検知 / CI 確認 / 承認判断）必須
- 500 行超 PR は `pr-info.yml` が自動警告コメント

### コマンド例

```bash
gh issue create --title "feat: 機能名" --label "type:feat,priority:medium"
gh pr create --draft --title "feat: #123 機能名" --body "closes #123"
gh pr ready <PR番号>
```

## PR テンプレート必須ゲート（`pr-template-gate.yml`）

5 ジョブ並列 hard-fail（Ready PR / non-Dependabot のみ）。テンプレ動的読込のため template 変更で workflow 修正不要（PR HEAD 読込、#1855）。

| ジョブ | 検証 |
|---|---|
| 必須セクション存在確認 | `## ` 見出し削除なし |
| 関連 Issue 番号 | `closes #` に番号、または `#\d+` 参照 |
| 変更タイプ | `[x]` 1 つ以上 |
| 顧客価値・目的 | プレースホルダー残存なし |
| テスト実行結果 | `<!-- PASS / FAIL -->` 残存なし（type:docs は skip） |

AC 検証マップ (`pr-ac-verification-check.yml`) も hard-fail。

セットアップ: Branch Ruleset の `required_status_checks` に 5 ジョブ追加（管理者作業）。

## 新規 env / secret 追加時（ADR-0006）

`scripts/check-new-required-env.mjs` が以下を検出: `assert*Configured()` / `throw new Error('XXX is required')` / `process.env.X || (() => { throw })()`。

PR body に必須記載:
```markdown
## 配布済み env / secret (ADR-0006)
- 配布済み: AWS_LICENSE_SECRET → GitHub Actions Secrets (deploy.yml, deploy-nuc.yml)
- 配布済み: AWS_LICENSE_SECRET → SSM Parameter Store /ganbari-quest/prod/aws_license_secret
- 配布済み: AWS_LICENSE_SECRET → NUC .env (本機 + バックアップ機)
```

ADR-0006 禁止 5 項目: warn 化 / `NODE_ENV` skip / `ALLOW_*=true` / retry 延長 / `.skip` 追加（Issue + owner + 30 日 deadline 必須）。詳細: ADR-0006

## LP / 販促文言変更時（ADR-0013 / #1314）

LP (`site/**`) / pricing / `plan-features.ts` / `pricing-strategy.md` 文言変更時:

1. PR body に「実装コードパス + Committed/Aspirational 区分」を記載
2. **Aspirational を LP に新規追加禁止**（`docs/design/19-プライシング戦略書.md` 附則）
3. 禁止語（`ガチャ` / `抽選` / `コンプリート`）→ `scripts/measure-lp-dimensions.mjs` FORBIDDEN_TERMS が CI 自動拒否

確認: `node scripts/measure-lp-dimensions.mjs` / 詳細: ADR-0013

## Pre-PMF Issue 優先度（ADR-0010）

`type:feat` 新規起票は Pre-PMF チェックリスト必須（PO 体制バイアス是正）:
- 「サインアップ 20 名/月 (V2MOM Q2) なしで到達可能か」自問が最重要
  - 可 → `priority:medium` 以下 / 不可 → `priority:high` 以上、根拠明記
- 新規機能 Issue 連続時は Growth / Marketing / Activation を 1 本挟む
- AI エージェント代理起票も同基準

免除: `priority:critical` bug fix / 法務・セキュリティ / `type:fix` 保守。詳細: ADR-0010
