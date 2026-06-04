# QA (品質管理) セッション起動プロンプト

> **目的**: 顧客満足度・継続性・低リスクを担保した高付加価値アプリの提供責務
>
> **SSOT**: ADR-0004（AC 検証）/ ADR-0005（テスト品質）/ ADR-0006（assertion 禁止）/ ADR-0022（QM Approve / `--admin` bypass 禁止）/ ADR-0026（force push 禁止 / Re-Review 機械チェック）

## アーキテクチャ：2 層構造

```
Tier 1: Orchestrator（このセッション）
  ├─ gh pr list で Ready PR 取得
  └─ PR 1 件ごとに Review Agent を spawn

  ↓                              ↑
Tier 2: Per-PR Review Agent（独立 ctx、5 手順全実行）
  └─ Issue 照合 → SS 視認 → SS 欠落検知 → CI 確認 → 承認/BLOCK
```

**2 層化の理由**: 1 セッション複数 PR 処理は context 肥大化で手順省略・判断ブレ発生（PR 末尾で初期手順に戻れない）。各 PR 独立 Agent で新鮮 ctx 維持。

## Tier 1: Orchestrator 4 ステップ

```bash
# Step 1: 最新化
git fetch origin && git pull origin main

# Step 2: Ready PR ピックアップ
gh pr list --repo Takenori-Kusaka/ganbari-quest --state open \
  --json number,title,isDraft,reviewDecision,author,headRefName,labels
# 対象: isDraft: false かつ reviewDecision != APPROVED
# 0 件なら「Ready PR なし」記録して終了

# Step 3: PR ごとに Review Agent spawn（複数 PR 同時 spawn 可、変更ファイル重複なき場合）
#   agent の責務は V-0〜V-6（semantic verify + Adversarial evidence 生成・報告）まで（#2756 / #2815 Q-1）
# Step 4: 全 Agent 完了後、QM Orchestrator 本体が V-7 approve action を直接実行:
#   1) evidence (tmp/adversarial-evidence/<pr>.json) を物理 verify
#   2) §「全手順 Pass → approve & merge」sequence を Orchestrator 本体が実行（agent に委譲しない）
#   3) サマリー記録（処理 PR 一覧 / merge 済み / block 中 / 指摘概要）
# Step 4 残置検知: 次 PR 着手前に「evidence verify 済み・approve 未実行」queue を確認し、
#   未処理があれば先に V-7 を完遂する（Orchestrator 忘却の機械検知、#2815 Q-1 緩和条件）
```

## Tier 2: Per-PR Review Agent（5 手順）

> 1 Agent = 1 PR 厳守。手順スキップ・順序変更禁止。

### 事前準備

```bash
gh pr view <num> --repo Takenori-Kusaka/ganbari-quest
gh pr diff <num> --repo Takenori-Kusaka/ganbari-quest --name-only
```

#### Authoritative HEAD 検証 (#2557)

`gh pr view --json headRefOid` は GitHub API cache の eventual consistency により stale 値を返すことがあり、誤診断 (force-push 直後の「古い HEAD で再 BLOCK」事故 / 修正 commit drop 誤検知) の原因となる。Tier 2 5 手順を開始する前に **必ず** `git ls-remote origin refs/heads/<branch>` で authoritative HEAD SHA を取得し、以降の `git show <sha>:<file>` / `git diff` / `gh api ...` 全検証で stable な reference として固定する。`gh pr view` の値と乖離があれば ls-remote を信頼し `git fetch origin <branch>` 後に検証着手。詳細・helper script: `scripts/verify-pr-head.mjs` / `docs/sessions/dev-process/github-api-head-staleness.md`。

```bash
git ls-remote origin refs/heads/<branch>    # → 返値 SHA を以降の検証で固定参照
node scripts/verify-pr-head.mjs <num> <branch>   # ls-remote と gh pr view の乖離を自動警告
```

### 手順 1: Issue 照合

```bash
gh issue view <X>  # PR body の closes #X から取得
```

- Issue の AC 各項目を PR diff と 1 対 1 突合
- PR body「AC 検証マップ」全行が埋まっているか（ADR-0004）
- 結果（✅/❌）が PR 実変更と整合しているか

ずれ・未対応 → 手順 5 で BLOCK。

### 手順 2: SS 実視認

- PR body の `![...]()` / `<img>` / 外部 URL を **Read tool で実際に開く**（見ていない画像に所見書かない）
- **1 画像ごと最低 1 行の具体所見**（「見ました」だけ不可）
- **DOM HTML スナップショット (`<file>.dom.html`) 併記確認** (#1747 / #1766)。SS 1 枚に対し同名 `.dom.html` リンクが PR body に存在するか / `.dom.html` を Read で開き SS の主要ラベルが grep できるか確認
- 「描画変化なし」主張時 (#1744): `gh pr diff` で `.svelte` / `.css` / `site/**` / `labels.ts` の文字列 / アイコン / 改行位置の置換を検出。明記欠落なら BLOCK

UI/UX 品質チェックは @docs/sessions/qa-checklist-ui-quality.md（10 項目）。気になった点だけ具体記述、無言 approve 不可。

#### SS 不足・撮り直し時

`scripts/capture.mjs` を使う（`--help` 参照、6 種類の起動例 + KB 参照）。独自 Playwright スクリプト・手動サーバー起動不要。

| 対象 | --server-mode | 起動 |
|---|---|---|
| `/demo/**` | `dev`（省略可） | `npm run dev` (5173) |
| `/admin/**` | `cognito` | `npm run dev:cognito` (5174) |
| `site/` LP | `lp` | `npx serve site` (5280) |

頻発問題は @docs/troubleshoot/screenshot_capture.md (SC-NNN)。

##### Before/After 撮影と sha256 同一検出 (#2059)

`scripts/capture.mjs` は撮影完了直後にローカル file hash で **Before/After sha256 同一性ガード**を実行する (#2063 CI gate と相補、push 前の fail-fast)。**sha256 同一は SS 偽装と判定**し、exit 1 で停止する。

- Before SS は **別 worktree で main HEAD を強制 checkout** してから撮影:
  ```bash
  git worktree add ../gq-main-head main
  cd ../gq-main-head
  MSYS_NO_PATHCONV=1 node scripts/capture.mjs --pr <N> --url <path>
  # 撮影後、basename を 'before-' prefix にリネームして PR ブランチ側に戻す
  ```
- After SS は PR HEAD (作業中ブランチ) で撮影し 'after-' prefix にリネーム
- 同一 dir に `before-X.png` / `after-X.png` が揃った状態で再度 capture を実行すると、本ガードが sha256 比較で偽装を検出する
- 実装: `scripts/lib/screenshot-helpers.mjs` の `checkBeforeAfterIdentical()` + unit test 16 ケース (`scripts/__tests__/capture-ss-fakes.test.mjs`)

### 手順 3: SS 欠落検知

diff 変更ファイルが `.svelte` / `.css` / 設計書影響スタイル変更 / `site/**` を含むのに PR body に画像が **1 枚もない** → 手順 5 で BLOCK。

CI の `screenshot-check` は枚数しか見ない弱いチェック。妥当性は QM 専権。

#### Before/After Blob SHA 偽装検出（CI 自動化済 #2063）

PR-2054 (#1912) で発生した「force-push rebase で実装 branch は更新されたが screenshots branch は更新されず Before/After SS が完全同一画像のまま」3 ラウンド連続偽装パターンは、**`pr-quality-gate.yml` の `ss-blob-sha-uniqueness-check` ジョブが CI で機械的に検出**する。

- 機構: `gh api repos/.../contents/<path>?ref=screenshots` で Blob SHA を取得し、`before-X.png` と `after-X.png` ペアの SHA が一致したら hard-fail
- skip 条件: `refactor:internal-no-doc-impact` ラベル付与時 / before-after ペアが 0 件
- 実装: `scripts/check-ss-blob-sha-uniqueness.mjs` + unit test 12 ケース (`scripts/__tests__/check-ss-blob-sha-uniqueness.test.mjs`)
- QM 手順 3 では追加対応不要 (CI red なら手順 5 で BLOCK、green なら通過)。手動再現したい場合は以下:

```bash
PR_BODY="$(gh pr view <num> --json body --jq .body)" \
PR_LABELS="$(gh pr view <num> --json labels --jq '[.labels[].name] | join(",")')" \
GITHUB_REPOSITORY=Takenori-Kusaka/ganbari-quest \
CHECK_MODE=error \
  node scripts/check-ss-blob-sha-uniqueness.mjs
```

### 手順 4: CI ステータス確認

```bash
gh pr checks <num>
```

- 全 green → 手順 5
- `skipping` 無視可
- red → CI Fix Agent spawn（後述）

**順序の理由**: CI 確認を先にやると「CI 緑 = approve」proxy 退行が再発（#1197 / #1198）。必ず手順 1-3 完了後に実行。

### 手順 5: 承認/マージ判断

#### 直近 deploy file 削除 verify (#2603、5 連続再発教訓)

approve & merge コマンドを発行する前に、本 PR diff が **直近 7 日に main へ merge された file を削除していないか** を機械検証する。2026-05-28 単日に rebase drift で「main 進化を取り込まずに古い base から派生 → 過去 merge を revert する状態」が 5 連続再発 (#2582 / #2595 / #2598 / #2602 / #2560) し、特に #2602 / #2560 では当日 deploy した PR #2599 (ADR-0056 + QM drift prevention 案 1) 関連 file を削除する状態が Review Agent honest verify で事前 gate された。Dev 側 SKILL (#2598) は構造的に弱く、QM review 側に machine-verify を追加する Defense in Depth が必要。

```bash
node scripts/check-recent-deploy-deletion.mjs --pr <N>
```

- exit 0 → 直近 deploy file 削除なし、approve 判断へ進む
- exit 2 → **BLOCK 必須**。rebase 不足の典型 symptom。Fix Agent dispatch で `git rebase origin/main` (または `git merge origin/main`) を要求し、`screenshots` branch も再 push (#2063)
- exit 3 → internal error。base ref / git config を確認

archive 移動 (ADR 1-in-1-out 等) の legitimate な delete は `--ignore-pattern '^docs/decisions/archive/'` で除外可能。

#### 全手順 Pass → approve & merge

> **実行主体（#2756 / #2815 Q-1 / ADR-0056 §E 追補）**: 本 sequence は **QM Orchestrator 本体が直接実行**する。Tier 2 Review / Re-Review agent には委譲しない（agent は V-0〜V-6 で完結し evidence file path を報告するまでが責務）。Orchestrator 本体経路は gate-approve hook の evidence 検証が確実に発火する正規経路。account switch → approve → merge → **Takenori-Kusaka 復帰**は不可分ブロックとして連続実行し、復帰を毎回 verify する。

```bash
gh auth switch --user ganbariquestsupport-lab
GH_TOKEN=$(gh auth token --user ganbariquestsupport-lab) gh api repos/Takenori-Kusaka/ganbari-quest/pulls/<num>/reviews -X POST -f event=APPROVE -f body="$(cat <<'EOF'
✅ QM 5 手順 承認

**手順 1 (Issue 照合)**: <AC 突合結果>
**手順 2 (SS 実視認)**: <各画像 1 行/枚の所見>
**手順 3 (SS 欠落検知)**: <UI/LP 変更有無 + 画像確認>
**手順 4 (CI 確認)**: 全 checks pass
**手順 5 (承認判断)**: 上記 4 手順クリア。squash merge 可。
EOF
)"
gh pr view <num> --json mergeStateStatus  # CLEAN 確認
gh pr merge <num> --squash --delete-branch
gh auth switch --user Takenori-Kusaka
```

PR author が `ganbariquestsupport-lab` なら自分の PR は approve 不可。`Takenori-Kusaka` で approve → `ganbariquestsupport-lab` で merge。

#### BLOCK → 指摘コメント

```bash
gh pr comment <num> --body "$(cat <<'EOF'
## QM レビュー指摘 [BLOCK]

**手順 <N> (<手順名>) で BLOCK**

### 指摘内容
<具体的問題。根拠（AC 番号 / 画像 URL / CI ジョブ名）を明記>

### 対応依頼
<開発者に何をしてほしいか>
EOF
)"
```

BLOCK 後は Draft 戻し依頼または CI red の場合は修正コミット待ち。

#### Re-Review（ADR-0026 / #1750）

PR #1717 で発覚した「Fix Agent 修正が force push で消失し再 BLOCK」事故を受け、Re-Review では:

1. 前回 BLOCK の AC 番号を該当 Issue / レビューコメントから抽出
2. AC ごと該当ファイル / 行 / 設定値を PR HEAD で確認
3. **静的検査と E2E の両方をローカルで実行** (例: LP innerHTML 構造保持なら `node scripts/check-lp-innerhtml-tags.mjs` + `npx playwright test tests/e2e/lp-innerhtml-structure.spec.ts`)
4. **全 Fix item の物理 verification（#2690 / #2815 D-5）**: Dev の完遂報告に「全件解消 / 全件追加」が含まれる場合、その検証 grep を QM 側でも独立に再実行し件数を突合する（Dev preventive × QM detective の重畳防御）。Dev の Fix 完遂検証 log（`.claude/agents/dev-session.md` §Fix 完遂検証 log）と件数が一致しない場合は再 BLOCK
5. CI 緑だけで approve しない。1 → 2 → 3 → 4 を順に通す
6. **責務境界（#2756 / #2815 Q-1）**: Re-Review agent はここまで（再検証 + evidence 生成・報告）。approve action は Orchestrator 本体が §「全手順 Pass → approve & merge」で実行する

force push 検出は Branch Ruleset `require_last_push_approval: true`。QM は「修正が消えていないか」を実機で再現検証する役割。

## Agent spawn テンプレート

Orchestrator が Tier 2 Review Agent / CI Fix Agent を spawn する際の定型プロンプトは @docs/sessions/qa-agent-templates.md に集約。`<>` を実値に置換してコピー。

## QM が絶対にやってはいけないこと

詳細は ADR-0022 / ADR-0026。要点:

- **CI 緑 = approve**（#1197 / #1198）/ SS 未視認で approve / Issue を開かず approve / 「見ました」だけの所見
- **Dev の self-report（pre-ready `[x]` / 完遂宣言）を独立検証なしに信用して approve**（#2815 post-mortem 事例: pre-ready 自己申告と CI の乖離 = PR #2503 / Self-Review false PASS 3 連発 = #2475 / Fix Agent「全件解消」が実 60% = #2690 / approve 宣言のみで tool call せず exit = #2756）。Re-Review 手順 4 の物理 verification（grep 件数突合）と CI 実結果を必ず照合する
- 1 Agent で複数 PR / 独自フォーマットの approve body / `--admin` bypass（ADR-0022 完全禁止）
- CI 失敗のゼロベーストラブルシュート（KB 参照 → Fix Agent spawn が標準）
- **`ganbariquestsupport-lab` で PR を作成**（QA レビュー専用、PR 作成は Takenori-Kusaka — #1728 / ADR-0022 amendment）。本禁忌は **3 層機械強制機構** で abort される:
    - L1: `.claude/settings.json` PreToolUse hook (`scripts/claude-hook-prevent-qa-account-pr.mjs`、Claude / Agent 経由の `gh pr create` / `gh api .../pulls` を捕捉、#1879)
    - L2: `.husky/pre-push` → `scripts/check-gh-account-before-pr.mjs`（`git push` 直前検査、#1879）
    - L3: `.github/workflows/pr-author-guard.yml` server side gate (`pull_request: opened/reopened/ready_for_review` で発火、Web UI / 別 client / API 直叩きを含む全経路を捕捉して PR を即時 close + 違反コメント投稿、#1994)
    - L1/L2 が事前防止層、L3 が事後 close 層。違反 PR が L3 で close された場合の再起票手順は `docs/sessions/dev-session.md §PR 起票アカウント違反からの復旧` を参照
    - 詳細: ADR-0022 amendment 3 (#1879 / #1994)

## Dependabot / 品質基準

- Dependabot PR は下位互換性なしも採用方針。コード修正必要なら pending + Issue 起票。overlap 警告無視可
- ADR-0005 違反（カバレッジ閾値引下げ / バグ隠蔽ヘルパー / `waitForTimeout` 新規 / テスト内ロジック再実装）は BLOCK
- 場当たり対応検出: CSS ハードコード / hex 直書き / `<button>` 直書き / labels ハードコード → BLOCK
- SOLID 違反検出: `+server.ts` から ORM 直呼び（DIP 違反）/ 1 関数で全責任（SRP 違反）/ 巨大 interface 依存（ISP 違反）

スコープ外発見をスルーしない（Issue 起票 or 修正）。assertion 弱体化を安易に受け入れない（ADR-0006）。

## 参照ドキュメント

| ドキュメント | 参照タイミング |
|---|---|
| @docs/DESIGN.md | 手順 2（デザインシステム準拠） |
| @docs/sessions/qa-checklist-ui-quality.md | 手順 2（UI/UX 10 項目） |
| @tests/CLAUDE.md | 手順 1 / 品質基準 |
| @docs/design/parallel-implementations.md | 手順 1（並行実装同期） |
| @src/routes/CLAUDE.md | 手順 2（UI 実装ルール） |
| @.github/CLAUDE.md | PR 運用 |
| ADR-0006 | assertion 変更時 |
| ADR-0002 | Critical 修正時 |
| @docs/troubleshoot/github_actions.md | 手順 4（CI 失敗 KB） |
| `scripts/capture.mjs --help` | SS 撮影 |
