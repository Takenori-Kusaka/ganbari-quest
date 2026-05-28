# Retrospective 2026-05-28 → 2026-05-29: rebase drift 9 連続再発 (race condition 4 ラウンド連続を含む)

> **Status**: open (#2603 第 1 弾 + #2607 第 2 弾 + #2615 time-aware 拡張で構造的対処 deploy、6 ヶ月後再評価予定)
> **関連 Issue**: #2603 / #2598 / #2599 / #2582 / #2595 / #2602 / #2560 / #2607 / #2615 / #2618
> **関連 ADR**: ADR-0056 (QM drift prevention 案 1、2026-05-28 deploy)、ADR-0010 (Pre-PMF Bucket A 判断)、ADR-0001 (設計書 SSOT)

---

## 1. 起こったこと

### 2026-05-28: rebase drift 5 連続再発 (起源 cases)

2026-05-28 単日、**5 件の PR で rebase drift が連続再発**した:

| 番号 | タイトル / scope | drift 内容 | 解消経路 |
|---|---|---|---|
| #2582 | Phase 1 残 5 領域 | rebase 不足で過去 merge を revert する diff | Fix Agent rebase で解消、MERGED `9d869984` |
| #2595 | process #2559 補強 (QM Tier 2 BLOCK 解消) | scope creep 14 file 混入 | Fix Agent rebase で解消、MERGED `530075f9` |
| #2598 | follow-up Issue 起票 (構造予防、Dev 側) | rebase 順序整合性確認 SKILL の必要性発覚 | Issue 起票のみ、構造予防は未 deploy |
| #2602 | Phase 3 subscription UI | 本日 deploy した #2599 (ADR-0056 + QM drift prevention 案 1) 関連 file を削除する diff | Fix Agent 進行中 (commit `a2879c00345524778`) |
| #2560 | marketplace 4 bugs | 同上、ADR-0056 関連 file 削除を検出 | Fix Agent 進行中 (commit `a2cf679a62ea49cd1`) |

特に **#2602 / #2560 は当日 deploy した PR #2599 (ADR-0056 + adversarial reviewer + PreToolUse Hook + JSON Schema 強制) の関連 file (hook 259 行 / skill 112 行 / unit test 251 行 / verify script 95 行 / ADR + research doc) を削除する状態**で Review Agent honest verify が事前 gate した。Echoing 抑制 / Persona Drift 対処の中核機構が、deploy された当日に rebase drift で消失する寸前まで進んだ。

### 2026-05-28 → 2026-05-29: race condition 4 ラウンド連続観察 (#2615 起因事例、6-9 件目)

PR #2607 (`check-recent-deploy-deletion.mjs` 自体の deploy) で **Round 1-4 連続 BLOCK** 発生 (本日 6-9 件目に該当):

| Round | 観察事象 | 構造的原因 |
|---|---|---|
| Round 1 (6 件目) | Fix Agent push 後の Re-Review で削除検出 → BLOCK | Fix Agent が古い main から rebase 開始、push までの間に新規 deploy 追加 |
| Round 2 (7 件目) | 再 rebase → push → Re-Review で再度 BLOCK | 同上、本日 ~18min/commit ペースで main 進化が止まらない |
| Round 3 (8 件目) | rebase + force-push 時点では gate PASS → Re-Review 時に再 BLOCK | **Time-of-Check vs Time-of-Use race**: push 時 `origin/main` (M1) と Re-Review 開始時 `origin/main` (M2) が不一致 |
| Round 4 (9 件目) | 4 度目の rebase で convergence、Round 5 で MERGE 達成 | race window 自体は短く本日特有の高頻度 deploy で連鎖 |

**race condition 構造的根因**: gate logic が `--days 7` 全体比較 = main 進化の新規追加 file まで含めて compare していたため、**main 進化 (新規 file 追加) を「PR 削除」と誤検出**する race condition が成立。Pre-PMF 期高頻度 main 進行 (本日 11+ deploy 観察) と Fix Agent → QM Re-Review turnaround (5-30min) の重なりで発生。

### 関連: #2618 機構運用層 bypass (別 PR で対処)

#2613 Fix Agent Round 3 が "gate PASS" 報告したが、QM Re-Review #3 で実 PR HEAD checkout すると BLOCK 検出 = Fix Agent の worktree HEAD が原 main HEAD と同一化していた偽陽性。Issue #2618 で第 4 弾 candidate として起票済 (本 PR scope 外、別 PR で対処)。本 PR (#2615) は **同じ gate に time window 限定 flag を追加**することで race の発生条件自体を構造的に取り除く相補的対処。

---

## 2. 根本原因分析 (5 Whys)

| Why | 観察事実 |
|---|---|
| **Why 1**: なぜ rebase drift が 5 件起きたか | 並列 Agent が古い base から派生し、`git pull --rebase origin/main` を作業開始時のみ実行、再 push 直前に再 rebase しなかった |
| **Why 2**: なぜ作業途中の rebase が抜けたか | Dev Agent SKILL に「commit 直前 rebase」「push 直前 rebase」が明文化されていない (#2598 で起票したが未 deploy) |
| **Why 3**: なぜ Dev 側 SKILL のみで予防しようとしたか | 「Dev 教育で防げる」という前提 (#2598 起票時の判断)。QM review 側の machine-verify を Defense in Depth として置く設計が欠落 |
| **Why 4**: なぜ QM review が machine-verify を持たなかったか | Tier 2 5-step (Step 1 Issue 照合 / Step 2 SS 視認 / Step 3 SS 欠落検知 / Step 4 CI / Step 5 承認判断) は semantic 中心。「直近 deploy file の削除」という特定 symptom を機械検証する step が定義されていなかった |
| **Why 5**: なぜ「直近 deploy file 削除」を gate に置く発想がなかったか | rebase drift の典型 symptom が **本日 deploy の自己破壊** であるという観察が ADR-0056 deploy 直後 (#2602 検出時) に初めて明確化された (= 構造的盲点) |

**根本原因 (root cause)**: QM Tier 2 5-step は semantic 承認判断中心で、`git diff origin/main..HEAD` の **削除 file が直近 deploy file と重複していないか** を機械検証する step が存在しなかった。Dev 側 (#2598) 単独防御では予防として弱く、Defense in Depth の Layer 2 = QM 側 machine-verify が必須。

---

## 3. 構造的対処 (本 PR #2603 で deploy)

### 対処内容

1. **`scripts/check-recent-deploy-deletion.mjs`** (新規) — `git diff -M --name-status origin/main..HEAD` で削除 file (rename 除外) を取得し、直近 7 日 (`--since=N days ago`) main merge commit の touched file と path level 照合。重複検出で exit 2 + stderr に file:commit:date listing 出力
2. **`tests/unit/scripts/check-recent-deploy-deletion.test.ts`** (新規、22 件、AC-1〜AC-7 境界値網羅)
3. **`docs/sessions/qa-session.md` Step 5 拡張** — approve コマンド発行前に `node scripts/check-recent-deploy-deletion.mjs --pr <N>` を必ず実行、exit 2 で BLOCK 必須を明文化
4. **`.claude/skills/pr-review/SKILL.md`** 8 観点 → 9 観点拡張 (`I. 直近 deploy file 削除なし`)
5. **`.claude/skills/adversarial-reviewer/SKILL.md`** business 軸 example 追記 (echo 抑制強化、QM drift しても adversarial reviewer が代替検出)

### 設計根拠

- **arXiv:2412.00804 (Persona Drift)**: QM identity drift しても機械検証で gate できる Defense in Depth Layer 2
- **ADR-0056 §結果 escalate trigger**: 案 1 (Adversarial Reviewer + Hook + Schema) の deploy 自身の保全機構として本 script を位置付け
- **ADR-0010 Pre-PMF Bucket A**: 本日 5 連続再発 = 実観察 defect への直接対処、過剰防衛ではない
- **既存パターン整合**: `scripts/check-gh-account-before-pr.mjs` (ADR-0022 amendment 1) と同型の pre-action gate script

### Defense in Depth 構造

| Layer | 対象 | 機構 | 状態 |
|---|---|---|---|
| L1 (Dev 側予防) | Dev Agent / 開発者 | `git pull --rebase origin/main` を作業開始 / push 直前に強制 | **#2598 で Issue 起票のみ、SKILL 未 deploy** (次回対処) |
| **L2 (QM 側 machine-verify)** | **QM Tier 2 Review Agent** | **`check-recent-deploy-deletion.mjs` exit 2 で BLOCK 必須** | **#2603 本 PR で deploy** |
| L3 (adversarial reviewer echo 抑制) | Adversarial Reviewer subagent | business 軸 example で「直近 deploy 機構の自己破壊」を明示 | 本 PR で deploy (ADR-0056 SKILL に追記) |

---

## 4. やってはいけない (anti-pattern)

| Pattern | 教訓 |
|---|---|
| `git pull --rebase origin/main` を作業開始時のみ実行 | 並列 Agent / 長時間 worktree 作業時は main 進化が複数発生する。**push 直前にも必ず再 rebase + `git diff origin/main..HEAD --stat` で diff 全体 verify** |
| QM 側で「semantic 承認判断のみ」で approve | 削除 file が当日 deploy file と重複している rebase drift symptom は semantic では見えない。**機械検証 (`check-recent-deploy-deletion.mjs`) を Step 5 で必ず通過** |
| Dev 側 SKILL のみで予防 (#2598 単独) | 教育 / SKILL は drift trigger に対処しきれない (Sleeper Agents Hubinger 2024 教訓)。**Defense in Depth で QM 側にも gate を置く** |
| 1 PR で複数 Issue / scope 混合 | scope creep が rebase drift と混同される (#2595 教訓)。**1 PR = 1 Issue 厳守、rebase 後の diff stat 全体 verify** |

---

## 5. 残課題 / 次の手 (open)

### 短期 (1-2 週間)

- [ ] **#2598 Dev Agent rebase SKILL deploy** — push 直前 rebase 強制 + `git diff origin/main..HEAD --stat` verify を SKILL 化 (本 PR の L1 layer 補完)
- [ ] **CI gate 化判断** — `scripts/check-recent-deploy-deletion.mjs` を `pr-quality-gate.yml` に組み込むか QM Tier 2 Review 単独で十分かの 6 月最終週 retrospective で評価
- [x] **time-aware flag 拡張 (#2615)** — `--since <ISO>` / `--since-ref <SHA>` / `--since-recent <N>` 追加。本 PR で deploy 済 (2026-05-29)
- [ ] **#2618 worktree HEAD verify gate** — `check-recent-deploy-deletion.mjs` 冒頭で PR HEAD verify 必須化 (第 4 弾 candidate、機構運用層 bypass 防止)

### 中期 (1-3 ヶ月)

- [ ] **`--days` 既定値の調整** — main merge 頻度の実観察 (本リポジトリは squash merge 中心、daily 1-5 merge) を踏まえ 7 日 → 14 日 / 3 日への調整が必要か
- [ ] **`--ignore-pattern` SSOT 集約** — `docs/decisions/archive/` 等の legitimate 除外パスを baseline.json (将来追加検討) として SSOT 化

### 長期 (6 ヶ月、retrospective re-evaluate)

- [ ] **2026-11-28 (6 ヶ月後) 本 retrospective 再評価** — rebase drift 再発回数 / `check-recent-deploy-deletion.mjs` exit 2 検出回数 / QM Tier 2 5-step 運用実績を計測。**0 件再発なら本機構を SSOT として継続、3 件以上なら追加 layer (CI gate 化 / pre-push hook 強化) を ADR で議論**

---

## 6. 関連リソース

| 種別 | 参照 |
|---|---|
| 起票 Issue | #2603 (本 PR の motivating issue) |
| 構造予防 Issue (Dev 側) | #2598 (L1 layer、SKILL deploy 待ち) |
| motivating example | #2602 / #2560 (本日 deploy ADR-0056 関連 file を削除する状態) |
| 関連 ADR | ADR-0056 (QM drift prevention 案 1)、ADR-0010 (Pre-PMF Bucket A)、ADR-0001 (設計書 SSOT) |
| 関連 SKILL | `.claude/skills/pr-review/SKILL.md` (I 項目)、`.claude/skills/adversarial-reviewer/SKILL.md` (business 軸 example) |
| 関連 session SSOT | `docs/sessions/qa-session.md` §Step 5 |

---

## 7. 結語

本日 5 連続 rebase drift は **個別 PR の人為的ミスではなく、QM Tier 2 5-step に機械検証 step が欠落していた構造的盲点**。Dev 側 SKILL (#2598) 単独では drift trigger に対処しきれず、QM 側 machine-verify (本 PR #2603) を Defense in Depth Layer 2 として置く必要があった。

本機構を deploy した本 PR 自体も、`node scripts/check-recent-deploy-deletion.mjs --pr <self>` で dogfood 自己適用し exit 0 を確認 (本 PR は新規追加のみで削除ゼロ、本日 deploy file の削除なし)。

次回再発 (6 ヶ月以内に 3 件以上) なら追加 layer を ADR で議論する。
