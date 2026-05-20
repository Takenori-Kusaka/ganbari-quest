# Ready 化前 必須 CI Gate チェックリスト

> **Skill 親**: [SKILL.md](./SKILL.md) / **親 SSOT**: [Dev Session](../../../docs/sessions/dev-session.md)

Wave 1 (#1969 / #1970 等) で 4 Agent 連続して同じ 4 種類の CI gate に初回 fail した知見を skill 化したもの。Draft → Ready 化前にこの 4 gate を**機械的に**通過させてから `gh pr ready <num>` する。

**親 SSOT との関係**: 「PR 起票手順」は [SKILL.md](./SKILL.md) のステップ 1〜4 を参照。本ファイルは **Ready 化直前の最終チェックリスト** として SKILL.md ステップ 4 の前段に挿入される位置付け。

## 4 必須 CI gate サマリ

| # | CI gate | workflow | hard-fail | 関連 ADR / Issue |
|---|---|---|---|---|
| 1 | AC 検証マップ (`Verify AC map in PR body`) | `pr-ac-verification-check.yml` | yes | ADR-0004 / #1775 |
| 2 | 必須セクションの存在確認 | `pr-template-gate.yml` (5 ジョブ並列) | yes | #1855 |
| 3 | PR チェックリスト `[x]` 完了確認 | `pr-merge-gate.yml` / `check-pr-body.mjs` | yes | ADR-0030 / #1775 |
| 4 | screenshot-check (4 スロット) | `pr-quality-gate.yml` | yes (UI 変更時) | #1740 / #1741 / #1747 |

ローカル一括検証: `npm run pre-ready -- --pr <num>` (#1775 / ADR-0030 / #1920 で SSOT 検証 step 拡張)。10 step (biome / svelte-check / vitest / hardcoded-strings / lp-dimensions / lp-fallback / check-no-plan-literals / generate-lp-labels --check / check-pr-body / capture)。Step 9 (`check-pr-body.mjs`) が gate 1〜3 を網羅。Step 10 (capture) は手動推奨で gate 4 を補助。

### hotfix PR (priority:critical / hotfix label) は 4 種 pre-push check 追加必須 (#2343)

`priority:critical` / `hotfix` label PR は urgency 文脈で 4 PR 連続 fail (#2318 / #2340 / #2341 / #2342) した教訓に基づき、Ready 化前に以下 4 種を**順次**実行:

```bash
# 1. PR body 全体 (必須セクション 13 件 / AC マップ / 禁止語 / hotfix 配布証跡欄強化チェック)
node scripts/check-pr-body.mjs --body-file tmp/pr-bodies/<num>-<slug>.md \
  --labels "priority:critical,hotfix" --skip-mergeable

# 2. 設計書同期 (src/routes/ 変更時に docs/design/ 同期 or refactor:internal-no-doc-impact label exempt)
PR_FILES="$(gh pr diff <num> --name-only)" \
PR_LABELS="$(gh pr view <num> --json labels --jq '[.labels[].name] | join(",")')" \
node scripts/check-design-doc-sync.mjs

# 3. env 直接参照禁止 (ADR-0040 P1)
node scripts/check-no-direct-env-access.mjs

# 4. 新規 env 配布証跡 (ADR-0006)
node scripts/check-new-required-env.mjs
```

詳細 narrative + 4 PR root cause: `docs/rationale/08-hotfix-pr-ci-fail-prevention.md` / `docs/sessions/dev-session.md` §hotfix PR runbook

---

## Section 1: 4 必須 CI gate 詳細

### Gate 1: AC 検証マップ (ADR-0004)

**条件**: PR body の `## AC 検証マップ (ADR-0004)` 表に Issue の Acceptance Criteria 1 行ごとに 1 行を追加し、**4 列全て**埋めること。

| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |
|---|---|---|---|
| AC1 | （Issue 本文から転記） | `<コマンド>` または `<ファイルパス>` または `<SS パス>` | PASS / 値 / `node scripts/...` 出力末尾 |

**確認方法**:
```bash
# ローカル
node scripts/check-pr-body.mjs --body-file tmp/pr-bodies/<num>-<slug>.md --skip-mergeable
# CI 上
gh pr checks <num> --watch
```

**典型的失敗パターン**:
- 「検証手段」「結果 / エビデンス」列が `<!-- 例: ... -->` のままで空 → CI fail (`AC1 row 4列目がコメントのみ`)
- 行を追加せず雛形 `AC1` 行のみ → Issue に AC が複数あるのに 1 行しかない (実装未了扱い)
- AC を削除/縮小して通そうとする → ADR-0004 違反 (Issue 改訂が必要なら別 PR で先行)

**修正方法**:
- Issue 本文の `Acceptance Criteria` セクション `- [ ]` 行を抽出し、`init-pr-body.mjs` の `{{AC_TABLE}}` 自動展開で生成
- 検証手段は機械検証可能な形式 (`npx vitest run path/to/test.ts` / `docs/screenshots/pr-NNN/<file>.png` / `grep -c '...' src/...`)
- 例外: 監査ログ的な合理的理由がある AC のみ `<!-- ac-verification-skip: 理由 -->` で対象外化

### Gate 2: 必須セクションの存在確認 (`pr-template-gate.yml` 5 ジョブ並列)

**条件**: `.github/PR_TEMPLATE_SECTIONS.json` (#2060 SSOT) の `sections` 配列にある `## ` 全見出しを PR body に**全て含める**こと。SSOT JSON が template と同期しているかは `check-pr-template-sections-sync.yml` が別途検証する。

**必須セクション (削除禁止、#2060 で 12 → 13 に拡張、`## QM レビュー結果` も SSOT 内)**:

SSOT: `.github/PR_TEMPLATE_SECTIONS.json` の `sections` 配列を**逐語コピー**すること。現時点では以下 13 件 (template 更新時は本ファイル `--fix` で再生成、`scripts/check-pr-template-sections-sync.mjs`):

1. `## 顧客価値・目的`
2. `## 関連 Issue`
3. `## AC 検証マップ (ADR-0004)`
4. `## 変更タイプ` (1 つ以上 `[x]`)
5. `## 影響範囲・変更コンポーネント`
6. `## テスト & 安全装置セルフチェック`
7. `## スクリーンショット / ビジュアルデモ`
8. `## コード品質セルフレビュー (#1481)`
9. `## 横展開・影響波及チェック`
10. `## レビュー依頼事項・破壊的変更`
11. `## 配布済み env / secret (ADR-0006)`
12. `## Ready for Review チェックリスト`
13. `## QM レビュー結果` (QM 記入欄、Dev は雛形のまま残す)

**確認方法**:
```bash
# SSOT JSON 経由でローカル検証 (#2060)
node scripts/check-pr-body.mjs --body-file tmp/pr-bodies/<num>-<slug>.md --skip-mergeable
# template ↔ SSOT JSON 同期検証
node scripts/check-pr-template-sections-sync.mjs
# CI: pr-template-gate.yml「必須セクションの存在確認」ジョブ + check-pr-template-sections-sync.yml
```

**典型的失敗パターン (#2039 / #2043 教訓)**:
- Skill 雛形 (`init-pr-body.mjs`) を使わず手書きしてセクションを **12 件全欠落** (#2039 / #2043 連続再発)
- 「該当なしなのでセクションごと削除」 → fail (該当なしは「N/A」明記が正解)
- セクション名の表記揺れ (`## AC検証マップ` のように半角空白を消す) → SSOT 不一致で fail
- template だけ更新して `.github/PR_TEMPLATE_SECTIONS.json` を更新し忘れる → drift gate で fail (#2060)

**修正方法**:
- **第一選択**: `npm run dev:open-pr -- --issue <num> --kind default` で雛形再生成
- 該当なしの場合は `「該当なし（理由）」` または `N/A` を本文に明記してセクション自体は残す
- セクション見出しは `.github/PR_TEMPLATE_SECTIONS.json` (#2060 SSOT) から **逐語コピー**
- template 更新時は `node scripts/check-pr-template-sections-sync.mjs --fix` で JSON を再生成

### Gate 3: PR チェックリスト `[x]` 完了確認

**条件**: `## Ready for Review チェックリスト` の項目を**実機検証してから** `[x]` に変更。虚偽チェック禁止。

```markdown
- [x] **`npm run pre-ready -- --pr <num>` 全 Step PASS** をローカル確認した
- [x] セルフレビュー済み（不要な差分・デバッグコードなし）
- [x] 全 AC が実装済み
- [x] UI 変更時: SS が GitHub 上で表示確認 + DOM HTML 併記 + DESIGN.md §9 禁忌 6 点を目視確認
- [N/A] 認証画面変更時: `npm run dev:cognito` (#1026) で実ブラウザ操作した SS を添付
```

**確認方法**:
```bash
node scripts/check-pr-body.mjs --body-file tmp/pr-bodies/<num>-<slug>.md --skip-mergeable
# Output: "Ready for Review / 完了チェックリストの未チェック残置" 検出
```

**典型的失敗パターン**:
- `[ ]` のまま Ready 化 → CI fail (`未チェックの Ready チェックリスト項目が残っている`)
- 該当なし項目を削除 → セクション欠落で gate 2 fail
- 検証していないのに `[x]` → ラバースタンプ禁止 (memory `feedback_done_criteria_strict` / `feedback_no_rubber_stamp_merge`)

**修正方法**:
- 各項目を**順に実機検証**してから `[x]` (`pre-ready` 通過 / SS 撮影完了 / etc.)
- 該当なしは `[N/A]` または `[x]` + 末尾に「N/A — 該当なし」コメント (両方とも CI 通過する)
- UI 変更なし PR は SS 関連項目に `[N/A]` を付与

### Gate 4: screenshot-check (UI 変更時のみ)

**条件**: UI 関連ファイル (`*.svelte` / `*.svelte.ts` / `*.css` / `*.scss` / `site/**`) 変更時、PR body に**修正前 × Mobile + 修正前 × Desktop + 修正後 × Mobile + 修正後 × Desktop** の 4 スロット SS を添付。

| | モバイル (375px) | PC (1440px) |
|---|---|---|
| **修正前** | `![before-mobile](https://raw.githubusercontent.com/.../before-mobile.png)` | `![before-pc](...)` |
| **修正後** | `![after-mobile](...)` | `![after-pc](...)` |

**URL 制約 (#1741)**:
- OK: `https://github.com/user-attachments/assets/<uuid>` (PR drag&drop)
- OK: `https://raw.githubusercontent.com/Takenori-Kusaka/ganbari-quest/screenshots/pr-<num>/<file>.png` (screenshots branch)
- OK: `docs/screenshots/pr-<num>/<file>.png` (リポジトリ内 raw URL)
- **NG**: `tmp/screenshots/...` / `.tmp-screenshots/...` (gitignore 配下、PR ビューで表示不可)

**確認方法**:
```bash
# CI: pr-quality-gate.yml の screenshot-check ジョブ + screenshot-quality-check ジョブ
gh pr checks <num> --watch
```

**典型的失敗パターン**:
- UI 変更ありなのに SS ゼロ → `screenshot-check` fail
- `tmp/...` 相対パス参照 → `screenshot-quality-check` warning (将来 hard-fail 化)
- 「修正前」スロットなし (修正後のみ) → `screenshot-quality-check` で 4 スロット要件不足
- DOM HTML スナップショット (`<file>.dom.html`) なし → #1747 / #1766 違反

**修正方法**:
- UI 変更**なし** PR (refactor / docs / infra のみ) は本セクションに `**該当なし（理由）**` 明記 (画像不要)
- UI 変更**あり** PR は Section 2 の SS 撮影手順を順に実行
- 「修正前」は `git checkout origin/main -- <変更ファイル>` で main 状態に戻して撮影 → `git checkout HEAD -- <ファイル>` で復元

---

## Section 2: SS 撮影手順 (Windows + Git Bash)

### 修正前 SS の取得 (main 状態に切替)

```bash
# 1. 変更したファイルを main 状態に一時切替
git checkout origin/main -- site/index.html src/routes/...

# 2. dev サーバー起動 (別ターミナル)
npm run dev               # port 5173, 通常 UI 用
# または
npm run dev:cognito       # port 5174, 認証画面・plan-gated UI 用
# または
BASE_URL=http://localhost:5280 npx serve site -p 5280  # LP 用

# 3. 撮影 (Windows Git Bash では MSYS_NO_PATHCONV=1 必須)
MSYS_NO_PATHCONV=1 node scripts/capture.mjs \
  --url /admin/children \
  --presets mobile,desktop \
  --pr <num>
# → tmp/screenshots/pr-<num>/<flow>-mobile.png + -desktop.png 出力
# → 同名 .dom.html (DOM スナップショット) 自動併保 (#1747)

# 4. before として配置
mkdir -p docs/screenshots/pr-<num>
mv tmp/screenshots/pr-<num>/*-mobile.png docs/screenshots/pr-<num>/before-mobile.png
mv tmp/screenshots/pr-<num>/*-desktop.png docs/screenshots/pr-<num>/before-desktop.png

# 5. 変更を復元 (← 忘れずに!)
git checkout HEAD -- site/index.html src/routes/...
```

### 修正後 SS の取得

```bash
# 1. 修正後の状態 (現在の作業ツリー) で再撮影
MSYS_NO_PATHCONV=1 node scripts/capture.mjs \
  --url /admin/children \
  --presets mobile,desktop \
  --pr <num>

# 2. after として配置
mv tmp/screenshots/pr-<num>/*-mobile.png docs/screenshots/pr-<num>/after-mobile.png
mv tmp/screenshots/pr-<num>/*-desktop.png docs/screenshots/pr-<num>/after-desktop.png
```

### LP 用撮影 (port 5280, `--server-mode lp` または BASE_URL)

```bash
# 方法 A: --server-mode lp で自動起動
MSYS_NO_PATHCONV=1 node scripts/capture.mjs \
  --pr <num> \
  --server-mode lp \
  --url /index.html \
  --presets mobile,desktop \
  --format webp

# 方法 B: 手動起動 + BASE_URL
npx serve site -p 5280 &  # 別ターミナル
BASE_URL=http://localhost:5280 node scripts/capture.mjs \
  --url /index.html \
  --presets mobile,desktop \
  --format webp
```

### screenshots branch アップロード (bundle PR / 大量 SS 時)

`docs/screenshots/` 直 commit は単体 PR 向け。**3 Issue 以上の bundle PR で SS 5 枚超**は orphan `screenshots` branch (SC-007) を使う。

```bash
# 1. 別 worktree で screenshots branch checkout (main worktree を汚さない)
git worktree add .tmp-ss-worktree-<num> screenshots
cd .tmp-ss-worktree-<num>

# 2. PR 専用ディレクトリにコピー
mkdir -p pr-<num>
cp ../docs/screenshots/pr-<num>/*.png pr-<num>/
cp ../docs/screenshots/pr-<num>/*.dom.html pr-<num>/

# 3. add + commit (worktree 内で操作)
git add pr-<num>/
git commit -m "screenshots: pr-<num>"

# 4. push は main worktree 経由 (husky pre-push hook 通過のため、Section 3 の罠 1 参照)
cd ..
git push origin screenshots

# 5. PR 本文には raw URL で貼付
# https://raw.githubusercontent.com/Takenori-Kusaka/ganbari-quest/screenshots/pr-<num>/before-mobile.png

# 6. worktree クリーンアップ
git worktree remove .tmp-ss-worktree-<num>
```

### 撮影サーバー選択早見表

| 撮影対象 | サーバー | port | 認証 | 撮影例 |
|---|---|---|---|---|
| `/admin/*` `/children/*` 等 | `npm run dev` | 5173 | 自動 | `--url /admin/children` |
| `/auth/login` `/auth/signup` | `npm run dev:cognito` | 5174 | Cognito mock | `--server-mode cognito --url /auth/login` |
| `/ops/*` プラン別 UI | `npm run dev:cognito` | 5174 | ops group | `--server-mode cognito --url /ops/dashboard` |
| LP (`site/index.html` etc.) | `npx serve site -p 5280` | 5280 | なし | `--server-mode lp --url /index.html` |

---

## Section 3: technical 落とし穴 (Wave 1 経験)

### 罠 1: husky pre-push が screenshots worktree から MODULE_NOT_FOUND

**症状**: `.tmp-ss-worktree-<num>` 内で `git push origin screenshots` すると husky pre-push hook が `scripts/check-gh-account-before-pr.mjs` を要求して失敗する。

**原因**: screenshots branch は orphan で `scripts/` を含まないため hook script が解決できない。

**対処**:
- worktree 内で `git commit` までは行い、`git push` は **main worktree 経由** で実行する (上記 Section 2 手順 4)
- main worktree から `git push origin screenshots` した場合、husky は `HEAD` (現在のブランチ = main 系) の scripts を解決するため通る
- それでも fail する場合のみ `git push --no-verify origin screenshots` で hook skip (#1804 例外として screenshots branch は許容、PO ルールと矛盾しない)

### 罠 2: capture.mjs の `--url` にフル URL を渡すと 404

**症状**: `node scripts/capture.mjs --url http://localhost:5173/admin/children` → 二重結合で `http://localhost:5173/http://localhost:5173/admin/children` を fetch して 404。

**原因**: `--url` は path のみを取り、`BASE_URL` 環境変数 (デフォルト `http://localhost:5173`) が自動付与される。

**対処**:
- **path のみを渡す**: `--url /admin/children`
- 別ホスト (LP 等) で撮りたい場合は `BASE_URL=http://localhost:5280` を environment variable で指定
- `--server-mode lp` 指定時は内部で BASE_URL も自動切替されるため `--url /index.html` だけで OK

### 罠 3: stacked PR は CI workflow が起動しない

**症状**: PR を別の feature branch (`feat-A` ブランチを base にして `feat-B` を作成) で起票すると、`pr-template-gate.yml` 等の workflow が起動しない (`branches: [main]` trigger のため)。

**原因**: `.github/workflows/*.yml` の多くは `pull_request: types: [...]` のうち `branches: [main]` で base が main の PR にしか反応しない。

**対処**:
- **main 起点で 1 PR ずつ直列 merge** する (Wave 1 推奨パターン)
- どうしても stacked が必要な場合は base を main に戻し、conflict は rebase で解決
- 「stacked PR で CI が通っていないのに ready 化」は PO ルール違反 → 必ず main 起点で再起票

### 罠 4: biome cognitive-complexity は CI のみで `--error-on-warnings`

**症状**: ローカル `npx biome check .` は通ったのに CI で fail (`Cognitive Complexity of <X> exceeds threshold`)。

**原因**: CI 側 `ci.yml` は `npx biome check --error-on-warnings .` を実行するが、`pre-ready` Step 1 はデフォルトで warnings を許容する。

**対処**:
- **複雑関数を新規追加した PR** は事前に `npx biome check --error-on-warnings <file>` でローカル確認
- 関数を分割するか、複雑度許容ファイルに追加する (後者は ADR-0007 静的解析 tier ポリシー要参照)
- pre-ready CLI は将来 `--strict` モードで `--error-on-warnings` を有効化予定 (#1775 follow-up)

### 罠 5: `git push --no-verify` は原則禁止 (例外あり)

main / release 候補ブランチへの push に `--no-verify` (husky skip) を使うのは ADR-0026 違反。罠 1 で screenshots branch のみ許容される。

### 罠 6: `tmp/pr-bodies/` の SS パス参照は不可

PR body に `tmp/pr-bodies/<slug>.md` から相対パスで `../screenshots/pr-<num>/before.png` のように書いても、GitHub の PR ビューでは render されない (SC-008 / #1741)。

**対処**: SS パスは Section 2 の URL 制約に従い、`docs/screenshots/pr-<num>/...` の **リポジトリ root 起点 raw URL** または `https://raw.githubusercontent.com/...` を使う。

---

## Agent / 開発者向け使い方

### 通常フロー (Wave 3+ Agent)

```bash
# 1. PR 雛形展開 (SKILL.md ステップ 1)
npm run dev:open-pr -- --issue <num> --kind default

# 2. 実装 + AC 検証マップ穴埋め (SKILL.md ステップ 2)

# 3. ローカル一括検証 (SKILL.md ステップ 3 + 本ファイル gate 1〜3 の機械検証)
npm run pre-ready -- --pr <num>
# Step 9 (check-pr-body) で gate 1+2+3 を網羅検出 (#1920 で 10 step 化、SSOT 検証 step 拡張)

# 4. UI 変更ありなら本ファイル Section 2 で SS 撮影 (gate 4)

# 5. Draft PR 起票 + CI 全緑後 Ready (SKILL.md ステップ 4)
gh pr create --draft --title "..." --body-file tmp/pr-bodies/<num>-<slug>.md
gh pr checks <PR番号> --watch
gh pr ready <PR番号>

# 6. tmp クリーンアップ
rm tmp/pr-bodies/<num>-<slug>.md
```

### Ready 化前最終チェック (1 行コマンド)

```bash
# pre-ready 全 Step PASS + UI 変更時は SS 4 スロット添付済 → ready 化可
npm run pre-ready -- --pr <num> && gh pr ready <num>
```

`pre-ready` が fail したら本ファイル Section 1 の該当 gate に戻って修正。

### Wave 1 で発生した代表的な手戻り

| Wave 1 PR | 初回 fail 内容 | 修正手順 |
|---|---|---|
| Agent #5 PR | gate 2 (必須セクション「コード品質セルフレビュー」欠落) | Skill 雛形を再生成して書き直し |
| Agent #7 PR | gate 1 (AC1 検証手段列が空) | `node scripts/check-pr-body.mjs --body-file ...` で diff 表示 → 検証コマンド追記 |
| Agent #8 PR | gate 4 (UI 変更ありなのに SS なし) | Section 2 の修正前/後 4 スロット撮影手順実行 |
| Agent #9 PR | gate 3 (`[ ]` のまま Ready 化) | 各項目検証後 `[x]` 化、該当なしは `[N/A]` |

→ 全て **本ファイルを最初に読んでから Ready 化**することで未然防止できた。

---

## 関連ドキュメント

| ドキュメント | 用途 |
|---|---|
| @.claude/skills/dev-open-pr/SKILL.md | Skill 親 (PR 起票 4 ステップ) |
| @docs/sessions/dev-session.md | Dev Session 親 SSOT (PR 作業手順) |
| @.github/PULL_REQUEST_TEMPLATE.md | PR template SSOT (本ファイル gate 2 の根拠) |
| @scripts/check-pr-body.mjs | gate 1+2+3 の機械検証 CLI |
| @scripts/check-pr-screenshot.mjs | gate 4 の機械検証 CLI |
| @scripts/pre-ready.mjs | 10 Step 一括検証 CLI (#1920 で SSOT 検証 step 3 件追加) |
| @docs/troubleshoot/screenshot_capture.md | SS 撮影 KB (SC-007 / SC-008 / etc.) |
| @docs/decisions/0004-review-and-ac-verification.md | AC 検証マップ義務 (gate 1) |
| @docs/decisions/0030-pre-ready-cli.md | pre-ready 全 Step PASS 必須 |
| @docs/decisions/0026-no-force-push.md | force push 禁止 (罠 5) |
