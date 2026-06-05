# QA (品質管理) セッション起動プロンプト

> **目的**: 顧客満足度・継続性・低リスクを担保した高付加価値アプリの提供責務
>
> **SSOT**: ADR-0004（AC 検証）/ ADR-0005（テスト品質）/ ADR-0006（assertion 禁止）/ ADR-0022（QM Approve / `--admin` bypass 禁止）/ ADR-0026（force push 禁止 / Re-Review 機械チェック）
>
> **ブランチ戦略 SSOT**: [branch-strategy.md](branch-strategy.md)（develop 二層 + gate 二層。QM のレビュー対象・gate 範囲は §「レビュー対象レーン」参照）

## レビュー対象レーン（git flow 二層、#2858）

QM は PR の **base branch でレーンを判別**し、レーンごとに gate 範囲を変える。

| レーン | 対象 PR | cadence | gate 範囲 | merge 方式 |
|---|---|---|---|---|
| **軽量レーン** | `feat/fix/refactor/docs/infra/*` → `develop` | 毎時 | 軽量 gate（branch-strategy.md §4: lint-and-test / unit ×2 / PR テンプレ gate / site-check 等）+ **5 手順全実行**（SS 実視認・UI レビューは QM 注力領域として維持） | `--squash --delete-branch` |
| **hotfix レーン** | `fix/*`（main 分岐） → `main`、`priority:critical` のみ | 即時（毎時 cadence 内で最優先） | **重量 gate 維持** + ADR-0002 5 要件（E2E 回帰 / AC 全完了 / 提案全実装 / 5 年齢モード / 30 日重複チェック）。gate 省略禁止 | `--squash` + **develop へ back-merge 必須**（drift 防止、Fix Agent で実施） |
| **統合 PR（暫定代行）** | `develop` → `main` | 1 日 1 回 | **最重厚 gate**（軽量全 job 再実行 + e2e ×3 + a11y + e2e-cognito-dev + docker / demo-lambda + storybook + visual regression 3 層） | **`--merge`（merge commit）**。squash 禁止（develop/main の履歴接続を維持し、次回統合 PR の diff 汚染を防ぐ）。develop は削除しない |

- **レーン判別**: `gh pr list --json baseRefName,headRefName` で base=develop → 軽量 / base=main かつ head=develop → 統合 / base=main かつ head=`fix/*` + `priority:critical` → hotfix。**base=main でそれ以外の head は新ルール違反** — retarget (base を develop へ変更) を依頼するコメントを残し、レビューは保留する（cutover 前から open の既存 PR は §「発効条件」の経過措置どおり現行ルールで処理）。
- **統合 PR の暫定代行**: develop→main の発行・最重厚 gate 判定・merge は本来 外部品質監査チーム（[audit-team.md](audit-team.md)）の責務。**監査 run pipeline（#2867 系）稼働までの間は QM が暫定代行**し、稼働後に本節の「統合 PR」行を監査チームへ移管する（branch-strategy.md §6）。暫定代行中も adversarial evidence + V-7 Orchestrator 専権の approve 規律は同一に適用する。
- **発効条件（cutover §8 連動）**: 本レーン区分は **develop branch 作成 + workflow 改修（branch-strategy.md §8 Step 2-3）完了後に発効**する。発効前は現行どおり main 向け PR を重量 gate で 5 手順レビューする。既存 open PR は retarget しない（§8 Step 6）。
- **軽量レーンの CI 解釈**: e2e / a11y / storybook / visual regression が**不発火・skip でも approve を保留しない**（これらは統合 PR で集約検証される設計）。逆に、軽量レーンの required（lint-and-test / unit / PR テンプレ gate）が red のまま approve することは引き続き禁止。

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
# Step 1: 最新化（develop 発効後は develop も fetch）
git fetch origin

# Step 2: Ready PR ピックアップ + レーン判別
gh pr list --repo Takenori-Kusaka/ganbari-quest --state open \
  --json number,title,isDraft,reviewDecision,author,headRefName,baseRefName,labels
# 対象: isDraft: false かつ reviewDecision != APPROVED
# baseRefName でレーン判別（§レビュー対象レーン）:
#   develop ← feat/*    → 軽量レーン（5 手順 + 軽量 gate）
#   main    ← develop   → 統合 PR（最重厚 gate、暫定 QM 代行）
#   main    ← fix/* + priority:critical → hotfix（重量 gate + ADR-0002）
#   main    ← その他    → retarget 依頼コメント、レビュー保留
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

- Before SS は **別 worktree で PR の base branch HEAD（軽量レーン = develop / hotfix・統合 PR = main）を強制 checkout** してから撮影:
  ```bash
  git worktree add ../gq-base-head <base-branch>   # 軽量レーンは develop、main 向けは main
  cd ../gq-base-head
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

### 手順 4: CI ステータス確認（レーン別）

```bash
gh pr checks <num>
```

- **軽量レーン（→ develop）**: 軽量 gate の required（lint-and-test / unit ×2 + merge / PR テンプレ gate / site-check / schema 系）が全 green → 手順 5。e2e / a11y / storybook / visual regression は**不発火・skip で正常**（統合 PR で集約検証、§レビュー対象レーン）— これらの不在を理由に approve を保留しない
- **hotfix / 統合 PR（→ main）**: 全 job green 必須（重量 / 最重厚 gate）
- `skipping` 無視可
- red → CI Fix Agent spawn（後述）

**順序の理由**: CI 確認を先にやると「CI 緑 = approve」proxy 退行が再発（#1197 / #1198）。必ず手順 1-3 完了後に実行。

### 手順 5: 承認/マージ判断

#### 直近 deploy file 削除 verify (#2603、5 連続再発教訓)

approve & merge コマンドを発行する前に、本 PR diff が **直近 7 日に main へ merge された file を削除していないか** を機械検証する。2026-05-28 単日に rebase drift で「main 進化を取り込まずに古い base から派生 → 過去 merge を revert する状態」が 5 連続再発 (#2582 / #2595 / #2598 / #2602 / #2560) し、特に #2602 / #2560 では当日 deploy した PR #2599 (ADR-0056 + QM drift prevention 案 1) 関連 file を削除する状態が Review Agent honest verify で事前 gate された。Dev 側 SKILL (#2598) は構造的に弱く、QM review 側に machine-verify を追加する Defense in Depth が必要。

削除判定は **three-dot (merge-base) diff `<base>...HEAD`** で「PR 自身の diff が削除する file」のみを検出する (#2877)。two-dot (端点比較) は sibling PR が main に追加した file が HEAD tree に無いだけで偽陽性 BLOCK していた (単日 4 PR #2853 / #2857 / #2855 / #2859 連続誤 BLOCK) が、three-dot 化で main 進化を PR の削除と誤算入しなくなった。意図的削除 (#2822 / #2841 型) は three-dot でも D として検出維持されるため、真陽性の検出能力は変わらない。base が ancestor (rebase 済) かつ削除 0 件なら early fast-path で即 exit 0 する (AC2)。

```bash
node scripts/check-recent-deploy-deletion.mjs --pr <N>
```

- exit 0 → PR 自身が直近 deploy file を削除していない、approve 判断へ進む
- exit 2 → **BLOCK 必須**。PR 自身が直近 merge file を削除している。意図的削除でなければ rebase 不足の symptom。Fix Agent dispatch で `git rebase origin/main` (または `git merge origin/main`) を要求し、`screenshots` branch も再 push (#2063)
- exit 3 → internal error または worktree HEAD ≠ PR HEAD mismatch (#2618)。base ref / git config / 明示 checkout を確認

archive 移動 (ADR 1-in-1-out 等) の legitimate な delete は `--ignore-pattern '^docs/decisions/archive/'` で除外可能。

> **develop 二層での base 注意**: 本 script の「直近 deploy」基準は main merge。**軽量レーン（base=develop）の PR では比較 base を develop にしないと、develop 上の先行 merge による削除を本 PR の削除と誤検出する**（#2877 と同型の偽陽性）。script の `--base develop` 対応は workflow 改修 PR（branch-strategy.md §8 Step 2）に同梱する。対応前の暫定運用: 軽量レーンで exit 2 が出たら、該当削除が `git log origin/develop -- <file>` で develop 上の先行 merge 由来かを確認し、**PR 自身の削除のみ** BLOCK する。

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
gh pr merge <num> --squash --delete-branch   # 軽量レーン / hotfix。統合 PR (develop→main) は --merge (merge commit、--delete-branch なし)
gh auth switch --user Takenori-Kusaka
```

PR author が `ganbariquestsupport-lab` なら自分の PR は approve 不可。`Takenori-Kusaka` で approve → `ganbariquestsupport-lab` で merge。

**hotfix merge 後の back-merge（branch-strategy.md §5）**: hotfix を main に merge したら、同一 run 内で develop への back-merge PR（または fast-forward 可能なら直接 merge）を Fix Agent で実施し、main / develop の drift を残さない。back-merge 完了までを hotfix 処理の Done 条件とする。

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
- **軽量レーンで e2e / a11y の不発火を理由に approve を保留し続ける**（gate 二層設計の否定。統合 PR で集約検証される — §レビュー対象レーン）。逆に**統合 PR / hotfix で重量 gate を省略して merge** も禁止
- **統合 PR (develop→main) を squash merge**（develop/main の履歴接続が切れ、次回統合 PR の diff が汚染される。必ず merge commit）
- **hotfix merge 後の develop back-merge を省略**（main/develop drift の温床）
- **base=main の feature PR（head が develop / fix/* 以外）を見逃して approve**（branch-strategy.md §3 違反。retarget 依頼が正）
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
