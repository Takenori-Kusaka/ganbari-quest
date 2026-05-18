# ADR-0022: admin bypass 禁止と ganbariquestsupport-lab QM Approve 体制の確立

- **Status**: accepted
- **Date**: 2026-04-25
- **Issue**: #1481

---

## 背景

PO 1 人体制のため `required_approving_review_count=1` を admin bypass で回避するマージが常態化していた。
この運用には以下の構造的問題があった:

1. **ルール回避の常態化**: bypass merge が例外的なフローのはずが通常運用になり、QM レビュー手順が踏まれない PR が main に入り続けた
2. **フォーマットドリフト**: admin bypass 時の self-review comment に関する明示的な規定がなく、`qa-session.md §「QM approve 前の必須実行手順」` とは異なる独自フォーマット（13 観点テーブル等）が使われ始め、既存ルールの適用経路から外れた（#1481 Issue 内 QA 分析補足 Phase 0 参照）
3. **CI gate の限界**: CI はチェックリスト構造や AC マップの「存在」は確認できるが、スクリーンショット内容の品質・横展開調査の実施・AC 達成の真正性は人間が担う必要がある

## 決定内容

### 1. admin bypass を完全に禁止する

GitHub Repository Ruleset `PR_Merge` の `bypass_actors` を空配列（`[]`）に設定し、repo owner を含む全アクターの bypass を禁止する。

### 2. ganbariquestsupport-lab アカウントを QA 専用 approve アカウントとして運用する

- アカウント: `ganbariquestsupport-lab`（ganbari.quest.support@gmail.com で作成）
- コラボレーター権限: Write
- QA セッション起動時の `gh` アクティブアカウントを ganbariquestsupport-lab に設定する
- Takenori-Kusaka（Dev）が PR を作成 → ganbariquestsupport-lab（QA）が approve → squash merge の順で実行する

### 3. approve body フォーマットを `qa-session.md` 手順に統一する

`gh pr review --approve --body` の body には `docs/sessions/qa-session.md §「QM approve 前の必須実行手順」` と同等の内容を必ず記述する:

- SS 実視認所見（1 画像につき 1 行以上）
- Issue AC 照合結果（全 AC を 1 対 1 で突合）
- `docs/DESIGN.md §9` 禁忌事項確認

独自フォーマット（「13 観点テーブル」等）は既存ルールの適用経路から外れるため禁止する。

## 結果

- admin bypass がルールセットで物理的に禁止されることで、bypass 時の「QM レビューが記録されないまま main に入る」問題が解消される
- approve body フォーマットの統一により、`qa-session.md` の手順が確実に踏まれる
- CI gate（#1481 Phase 1〜4）は人間の判断を補助する防衛層として引き続き機能する

## 関連

- #1481 — PR マージ前チェックリスト CI 強制 + PR テンプレート QM 観点拡充
- ADR-0004 — レビュー & AC 検証品質
- `docs/sessions/qa-session.md` §「QM が絶対にやってはいけないこと」
- `.claude/agents/qa-session.md` §「QM Approve 体制（ganbariquestsupport-lab）」

---

## Amendment 1 (#1728, 2026-04-30): ganbariquestsupport-lab PR 作成禁止 + Takenori-Kusaka PR 作成ガード

### 背景

ADR-0022 本文（決定 2）で「Takenori-Kusaka が PR 作成 → ganbariquestsupport-lab が approve」の役割分担を定めたが、**`gh auth switch` で QA アカウントに切り替えたまま `gh pr create` を実行してしまう事故**が発生する経路があった（QA 後に Dev に戻し忘れ → 次の PR 作成タイミングで誤発火）。

ganbariquestsupport-lab で PR を作成すると以下の問題が起きる:

- そのアカウントは Write 権限のため通る → 後で「自分の PR は自分で approve できない」制約に当たり、Dev に手戻り
- PR 作成者と Dev 履歴の対応が崩れ、`gh pr list --author Takenori-Kusaka` 等の集計が破綻
- ADR-0022 が定めた role separation が事実上機能しない

### 決定（追加）

1. **`ganbariquestsupport-lab` での PR 作成を完全禁止**する（手順は本 ADR 本文「決定 2」に従い、PR 作成は Takenori-Kusaka のみ）
2. **PR 作成前の active アカウント確認スクリプトを必須化**する: `scripts/check-gh-account-before-pr.mjs` を `gh pr create` の直前に必ず実行する。`Takenori-Kusaka` 以外なら exit 1 で停止し、人間が `gh auth switch` で切替えてから再開する
3. AUTO_MODE / Agent / Claude セッションでの自動 PR 作成は、本スクリプトを通過した後にのみ `gh pr create` を呼ぶ前提で運用する（`docs/sessions/dev-session.md §PR 作業時 §5.5` に明記）
4. Pre-commit / Pre-push hook での同等チェックは **本 amendment では採用しない**。理由:
   - hooks は ganbariquestsupport-lab が `gh pr review --approve` のために行う **正当な commit / push（例: KB 追記）も誤検知して止めうる**
   - PR 作成は `gh pr create` 単一コマンドなので、その手前の単一スクリプトガードで十分（hook は粒度が粗すぎる）
   - 採用すると hook bypass (`--no-verify`) を Dev が常用するインセンティブを生み、ADR-0006 禁止 5 項目との運用衝突リスクがある
   - 将来再評価する場合: 本 amendment を上書きする新 amendment / 後続 ADR を起票する

### 受入基準（#1728 AC）

- [x] `docs/sessions/dev-session.md` に「PR 作成は必ず Takenori-Kusaka アカウント。ganbariquestsupport-lab は QA レビュー専用」明文化（§PR 作業時 §5.5）
- [x] `docs/sessions/qa-session.md` の「QM が絶対にやってはいけないこと」に「ganbariquestsupport-lab で PR 作成しない」を追加
- [x] `scripts/check-gh-account-before-pr.mjs` を新設し、`gh auth status` の active アカウントが `Takenori-Kusaka` でない場合 exit 1 で停止する
- [x] `docs/sessions/dev-session.md §PR 作業時 §5.5` で `gh pr create` 直前にスクリプト実行を必須化
- [x] Pre-push hook 採否を本 amendment 内で判断（**不採用** — 理由は上記 4）

**機械的強制機構** (#1879): 本 amendment §決定 4 の「pre-push hook 不採用」は **amendment 3 (#1879) で supersede**。Claude Code hook (`.claude/settings.json` PreToolUse) + git pre-push hook (`.husky/pre-push` → `scripts/check-gh-account-before-pr.mjs`) を併設。Dev / Agent / 手動 push の 3 経路全てで QA アカウントによる `gh pr create` / `git push` を機械的に abort する。

---

## Amendment 2 (#1809, 2026-05-01): Dependabot auto-merge は admin bypass に該当しない

### 背景

PR #1805 で `dependabot` job が `Auto merge is not allowed for this repository` エラーで fail した。リポジトリ Settings > General > Pull Requests > "Allow auto-merge" が無効化されているのが直接原因。

ADR-0022 本文では「admin bypass を完全に禁止する」と決めているため、PO / QA から「Dependabot の auto-merge は admin bypass の一形態ではないか」という疑念が起き得る。本 Amendment で両者の関係を明確化する。

### 決定（追加）

1. **GitHub の auto-merge 機能は admin bypass に該当しない**
   - auto-merge は「approve + 全 required checks 通過時に自動で squash merge する」だけの機能で、required reviewers / required status checks は引き続き **enforce** される
   - admin bypass（`bypass_actors`）は「required reviewers / required checks をスキップする」機能であり、別物
   - したがって ADR-0022 本文「決定 1」の "admin bypass 完全禁止" は auto-merge を禁止するものではない
2. **Dependabot PR の auto-merge は許可する**（運用負担削減のため）
   - `dependabot-auto-merge.yml` workflow が `dependabot/fetch-metadata` で minor / patch update を判定し、`gh pr merge --auto --squash` で auto-merge を有効化する
   - approve → 全 CI 緑 → 自動 squash merge の流れで運用する
3. **リポジトリ設定の `allow_auto_merge=true` は PO 操作で有効化する**
   - Settings > General > Pull Requests > "Allow auto-merge" にチェック
   - or: `gh api repos/:owner/:repo --method PATCH -f allow_auto_merge=true`
   - 本 Amendment 文書化時点（2026-05-01）では `allow_auto_merge=false`。PO がリポジトリ owner 権限で有効化する必要あり
4. **#1808 (Dependabot exempt CI) と組み合わせて Dependabot 完全自動化を確立する**
   - #1808: `pr-template-gate.yml` / `pr-ac-verification-check.yml` / `pr-merge-gate.yml` を Dependabot exempt 化
   - 本 Amendment (#1809): `allow_auto_merge=true` を有効化
   - 両方が揃って初めて、Dependabot PR が「approve のみで自動 merge 完走」する状態になる

### 受入基準（#1809 AC）

- [x] AC3: `.github/CLAUDE.md` の Dependabot 運用方針記述を auto-merge 前提に揃える（本 PR で auto-merge が「ADR-0022 違反ではない」を明記）
- [x] AC4: ADR-0022 文中に「Dependabot auto-merge は admin bypass に該当しない」を明記（本 Amendment 2）
- [ ] AC1: リポジトリ Settings > "Allow auto-merge" 有効化 — **PO 操作必須**（Agent では実行不可。本 PR merge 後に PO が `gh api repos/Takenori-Kusaka/ganbari-quest --method PATCH -f allow_auto_merge=true` を実行する）
- [ ] AC2: 次回 Dependabot PR で `dependabot` job が PASS — AC1 完了後に自然検証

### PO 操作手順

```bash
# 必須: repo owner 権限のアカウントで実行
gh api repos/Takenori-Kusaka/ganbari-quest \
  --method PATCH \
  -f allow_auto_merge=true

# 確認
gh api repos/Takenori-Kusaka/ganbari-quest --jq '.allow_auto_merge'
# → true
```

---

## Amendment 3 (#1879, 2026-05-06): PR 起票アカウント違反の機械的強制機構を 2 経路で導入

### 背景

amendment 1 で「PR 作成前に `scripts/check-gh-account-before-pr.mjs` を必須実行」と定めた。
しかし、これは **手順書 (人間 / Agent の規律) に依存** しており、忘却・スキップが構造的に発生し得た。

実際 PR #1875 で `ganbariquestsupport-lab` による起票違反が発生した (`gh auth switch` 漏れ + script 未実行)。
**GitHub PR author は事後変更不可** であり、merge 直前 CI で止めても作り直しコストが高い。
そのため、**事前防止 (PR 作成前 / push 前) の機械的強制機構** を導入する。

### 決定（追加）

amendment 1 §決定 4 の「Pre-push hook **不採用**」を **本 amendment で supersede** する。理由:

- amendment 1 当時の懸念「ganbariquestsupport-lab の正当な commit / push (KB 追記) も誤検知」は、QA セッションでの commit / push が **そもそも禁止運用** (PR 作成は Takenori-Kusaka 専用) であるため誤検知ではなく **検出すべき正規シグナル** であると再評価
- `--no-verify` 常用インセンティブ懸念は、ADR-0026 で `--no-verify` 禁止を明記して別途対応する

採用する 2 経路:

1. **Claude Code hook** (`.claude/settings.json` `PreToolUse`):
   - `Bash` ツール実行直前に `scripts/claude-hook-prevent-qa-account-pr.mjs` が stdin から `tool_input.command` を受取り、`gh pr create` を含むかつ active gh account が `Takenori-Kusaka` 以外なら exit 2 で abort
   - 守備範囲: Claude / Agent 経由の `gh pr create` 全経路 (Dev session / Auto Mode / 手動 prompt 全て)

2. **git pre-push hook** (`.husky/pre-push`):
   - `git push` 直前に `node scripts/check-gh-account-before-pr.mjs` を呼出し、active gh account が `Takenori-Kusaka` 以外なら exit 1 で abort
   - 守備範囲: 手動 git push (Claude を介さない CLI 直接実行 / `git push` だけで PR 自動作成される flow も将来カバー)
   - husky 導入: `package.json` に `prepare: husky` を追加 (既存 `svelte-kit sync` と併設)、`npm install` 後の `npm run prepare` で hook が自動配備

### OSS 選定

| 案 | 採否 | 理由 |
|---|---|---|
| husky (~3M weekly DL, MIT) | **採用** | デファクト OSS、bundle 影響なし (devDep)、Pre-PMF コスト極小 |
| simple-git-hooks (~500K weekly DL, MIT) | 不採用 | 採用実績で husky に劣る、機能差は本件で無関係 |
| Claude Code 公式 hook (`.claude/settings.json`) | **採用** | Claude / Agent 経由保護の唯一の正規手段 |
| 独自 git hook (`.git/hooks/pre-push`) | 不採用 | git clone で配布されないため新規 clone 環境で保護が抜ける |

### 既知制約

- `git push --no-verify` で hook を skip 可能 (ADR-0026 で `--no-verify` 禁止を明記して運用側でカバー)
- Claude Code hook は **Claude セッション内のみ** 有効。ターミナル直接実行の `gh pr create` には pre-push hook (push 直前) または手動 script 実行で対応

### 受入基準（#1879 AC、本 PR で全件達成）

- [x] `.claude/settings.json` に `PreToolUse` hook 追加
- [x] `.husky/pre-push` で `node scripts/check-gh-account-before-pr.mjs` 呼出
- [x] 自テスト 3 ケース (PR body に明記)
- [x] 双方向リンク (本 ADR / qa-session.md / check-gh-account-before-pr.mjs)
- [x] `package.json` に `prepare: husky` 統合

### 補足 (#1994, 2026-05-09): server side gate 追加で 3 層防御に拡張

amendment 3 で導入した L1 (Claude PreToolUse) / L2 (husky pre-push) は **特定 client / 特定タイミング依存** で、以下の経路を捕捉できなかった:

- Claude Code 以外の CLI / シェル (WSL / Docker / CI ランナー)
- GitHub Web UI からの PR 作成
- `gh api repos/.../pulls` 等の REST 直叩き
- `git push` 通過後に `gh auth switch` → `gh pr create`

PR #1875 (1 回目) / PR #1982 (2 回目) で実際に違反が再発したため、Issue #1994 で **server side gate (`.github/workflows/pr-author-guard.yml`)** を追加。

- `pull_request: opened/reopened/ready_for_review` イベントで発火する。
- author が許可リスト (`Takenori-Kusaka`) 外であれば PR を自動 close + 違反コメント投稿 + workflow fail。
- client / 経路を問わず必ず発火するため、L1/L2 で抜けた全経路を server side で捕捉する 3 層防御に拡張された。

