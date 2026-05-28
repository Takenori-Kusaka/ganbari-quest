# 0056. QM Orchestrator role drift の構造的対処 (Adversarial Reviewer + PreToolUse Hook + JSON Schema 強制)

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-05-28 |
| 起票者 | Claude Opus 4.7 (1M context) — Dev Session Agent (worktree mode) |
| 関連 Issue | #2597 (drift baseline scan) / #2590 / #2591 / #2592 |
| 関連 ADR | ADR-0010 (Pre-PMF) / ADR-0022 (admin bypass + QM Approve 体制) |
| Research SSOT | [docs/research/qm-drift-prevention-2026-05-28.md](../research/qm-drift-prevention-2026-05-28.md) |

## コンテキスト

QM Orchestrator (Claude Code session) が「顧客品質最終ゲート」役割から「BLOCK 列挙 / CI proxy」役割に drift する事象を **33 日で 42 回観測**。memory / ADR / checklist の追加 (5 回試行) は再発率を変えなかった。

drift の原因類型 (文献根拠、詳細は research SSOT §2):

1. **Persona Drift** (Wang et al. 2024): 多段会話で agent 役割が薄まり単純 executor 役に slide
2. **Echoing** (arXiv:2511.09710): Dev 主張を肯定的に echo し独立 judgment が消失
3. **Normalization of Deviance** (Vaughan 1996): 「ここまで事故ゼロ」累積経験が逸脱を許容と再定義
4. **Goodhart's Law**: 「CI 全 PASS + BLOCK 列挙」が target 化し本来の顧客 judgment が proxy された

memory / ADR で覆せない理論根拠 (詳細は research SSOT §3):
- **Sleeper Agents (Hubinger 2024)**: instruction 経由の役割強化は「演じる」能力を強化するだけで drift trigger には対処しない
- **Constitutional AI (Anthropic 2022)**: self-monitoring は target が "judgmental" な場合は精度低下。drift 中の agent は drift を否認する (identity drift の定義)
- **Lost in the Middle (Liu 2023)**: memory / ADR 量増加は context window 圧迫で重要 instruction の参照率を逆に下げる

42 回再発はこの理論群と整合する。**agent 内部の自覚に依存しない構造的対処** が必要である。

## 検討した選択肢 (OSS / 確立パターン最低 2 件、#1350)

詳細比較は research SSOT §7。

### 選択肢 A: 多 verifier / heterogeneous ensemble

- 概要: 異なる model 2 つで verifier ensemble (Comet 2024 LLM-as-Judge production guide、確立パターン)
- メリット: 単 verifier より drift 耐性高
- デメリット: API cost 2 倍 + orchestration 工数大、Pre-PMF 段階では過剰防衛 (ADR-0010)

### 選択肢 B: Adversarial Reviewer + structured JSON schema (採用)

- 概要: subagent が `must_object_count: 3` の structured output を強制、`PreToolUse` hook が schema 検証で approve 系 Bash command を物理 block
- 根拠 OSS / 既存知見: **arXiv:2511.09710** "Echoing: Identity Failures when LLM Agents Talk to Each Other" で structured response schema 強制が echoing 30-40% → <10% を実証 + Claude Code hooks 公式 spec (`permissionDecision: "deny"`) が agent 自覚に依存せず物理 block 可能
- メリット: 文献で実証済 + Pre-PMF cost 最小 (1-2 日工数) + agent 役職を剥奪せず autonomous 維持
- Pre-PMF コスト: hook 1 本 + subagent skill 1 件 + 検証 script 1 本 + unit test 1 spec で完遂 (ADR-0010 整合)

### 選択肢 C: Hard Gate + human merge (案 3)

- 概要: agent から approve action を完全剥奪し人間が最終 merge
- デメリット: PO が本日明示否定 ("agent-led / autonomous 維持")。agent 責務剥奪は解決ではない。PR 10x で human cost 線形成長

### 選択肢 D: 独自 instruction 補強

- 既試行 5 回 / 42 回再発で実証不能。Sleeper Agents 根拠で原理的に効かない (棄却)

**選定**: B を採用。理論根拠が文献実証済 + Pre-PMF cost 最小 + autonomous 維持の制約に整合する唯一の解。

## 決定

### 1. PreToolUse hook (`.claude/hooks/gate-approve.mjs`)

- `Bash` matcher で `/gh pr (merge|review --approve)/i` を捕捉
- `tmp/adversarial-evidence/<pr-number>.json` の **存在 + 30 分 TTL + schema 必須 field** を検証
- 不在 / TTL 切れ / schema 不正で exit 2 + stderr に修正手順 ("Adversarial Reviewer subagent を先に dispatch")
- recursive loop 防止: `CLAUDE_SUBAGENT_ID` env 設定時 (subagent context) は無条件 allow
- 既存 `scripts/claude-hook-prevent-qa-account-pr.mjs` の規約 (exit 2 / stdin JSON / `.claude/settings.json` の `hooks[].hooks[]` ネスト) を踏襲

### 2. Adversarial Reviewer subagent (`.claude/skills/adversarial-reviewer/SKILL.md`)

- role identity: `"adversarial_reviewer (NOT QM, NOT Dev)"` を出力 schema に強制
- structured JSON output (`tmp/adversarial-evidence/<pr-number>.json`):
  - `must_object_count: 3` (literal 値)
  - `objections[]`: length 3、3 軸 (business / UX / security) 網羅必須、各 reason >= 100 文字
- skill instruction で「QM の approve 意図に echo するな、反対せよ」を repeated emphasis (Echoing 抑制、arXiv:2511.09710 §5.2 整合)

### 3. Schema validation script (`scripts/verify-adversarial-output.mjs`)

- CLI: `--pr <number>` で evidence file を読込
- 検証: `pr_number` (number) / `must_object_count === 3` / `objections.length === 3` / `axis ∈ {business,UX,security}` Set check / `reason.length >= 100` / `generated_at` 30 分以内
- fail で exit 1 + 修正手順 stderr

### 4. settings 統合

`.claude/settings.json` の既存 `hooks.PreToolUse[].hooks[]` に gate-approve.mjs を追加 (既存 prevent-qa-account hook を破壊せず追加)。

### 5. 1-in-1-out 履行

ADR 棚卸ルール (README §10 1-in-1-out) に従い、新規 ADR-0056 追加と引き換えに **ADR-0031 (ADR-0023 deprecation map)** を archive 移動する。ADR-0031 は内容上完了済 historical record (sub-Issue 7 件帰属マップは既に Issue comment で配布完了、現場参照率低) であり、README §2026-05-27 棚卸の P1 課題「ADR-0031 の archive 判断」を本 PR で消化する。

## 結果

### Positive

- **drift identification trap の構造化**: agent が drift しても hook が approve 系 Bash を物理 block する。agent 内部自覚に依存しない (Sleeper Agents / Constitutional AI 根拠整合)
- **echoing 抑制**: `must_object_count: 3` schema 強制で「反対理由なし」の echoing 路を構造的に閉じる (arXiv:2511.09710 §5.2 で 30-40% → <10% 実証済)
- **scalable**: PR throughput 10x でも human cost 0 維持 (autonomous 制約整合)
- **escalate 経路明示**: 案 1 → 案 2 (ensemble) → 案 3 (human merge) の trigger 条件を research SSOT §5.3 で定義

### Negative / Risk

- **subagent dispatch cost**: 全 approve action 前に Adversarial Reviewer dispatch が必要 → token cost +15-30%。Pre-PMF 段階では許容範囲 (ADR-0010)
- **TTL 30 分**: 短すぎると evidence 再生成が頻発、長すぎると stale evidence で drift 抜け。30 分は暫定値、Issue #2597 baseline scan の D1 / D2 結果で調整判断
- **false positive (deny 過剰)**: `gh api repos/.../pulls/<N>/reviews` 等の review 系 REST API も regex で過剰捕捉する可能性。誤検知側に倒す方が安全 (既存 hook と同方針)

### escalate trigger (research SSOT §5.3)

| trigger | escalate 先 |
|---|---|
| 案 1 deploy 後 30 日で drift 再発 ≥ 5 件 | 案 2 (heterogeneous ensemble) |
| 案 2 deploy 後 30 日で drift 再発 ≥ 3 件 | 案 3 (人間最終 approve) |
| 顧客に致命的 defect が漏れた | 即座に案 3 |

## §D. 機構運用層 bypass 防止 (worktree HEAD verify、#2618、2026-05-29 追記)

ADR-0056 第 2 弾 gate (`scripts/check-recent-deploy-deletion.mjs`、#2607 deploy) は本来 **PR HEAD checkout 済 worktree** で実行される設計。しかし Fix Agent worktree モードで `git checkout -B <branch> origin/<branch>` 後の操作で HEAD が `origin/main` と同一化する pattern (#2557 stale cache fix の延長で main 進化追随で発生) では、`origin/main..HEAD` diff が空 → 削除 file 0 件 → 偽陽性 `exit 0` が返る。

**実害観察 (2026-05-28)**: PR #2613 Round 3 で Fix Agent (`abbe53d06e71be222`) が「`check-recent-deploy-deletion.mjs` exit 0 GATE PASS」と完了報告したが、QM Re-Review #3 (`a4523a2072adbf306`) が PR HEAD 明示 checkout で再実行したところ exit 2 (BLOCK) = legal critical 506 行 (`phase3-subscription-confirm-tokushoho-ui-design.md`、改正特商法 12 条の 6 準拠) を喪失する寸前で阻止。第 2 弾 gate が機構として functioning するも、**実行側 (Fix Agent) が worktree HEAD verify せずに gate を回す経路で bypass 可能** = 機構運用層脆弱性。

### 二重防御 (defense in depth)

1. **Agent SKILL 強制ルール** (`.claude/agents/dev-session.md` + `.claude/skills/dev-open-pr/SKILL.md`): gate 実行前 prelude で worktree HEAD = PR HEAD verify 必須を SSOT 化
2. **gate 本体 self-defense** (`scripts/check-recent-deploy-deletion.mjs`): `--pr` 指定時に worktree HEAD ≠ PR HEAD を検出すると exit 3 (新エラーコード意味付け) + `git checkout <PR HEAD>` guidance を stderr 出力で BLOCK

### 実装

純粋関数 `verifyWorktreeHeadMatchesPrHead(prNumber, ghViewFn, gitRevParseHeadFn)` を `scripts/check-recent-deploy-deletion.mjs` から export し、`main()` 内で `--pr` 指定時のみ gate 実行前に呼ぶ。`gh pr view --json headRefOid` で PR HEAD を取得、`git rev-parse HEAD` で worktree HEAD を取得、不一致なら `{ ok: false, reason: 'head-mismatch', prHead, worktreeHead }` を返す (失敗類型は `gh-pr-view-failed` / `gh-pr-view-empty` / `git-rev-parse-failed` / `head-mismatch` の 4 種)。unit test (`tests/unit/scripts/check-recent-deploy-deletion.test.ts` AC-1〜AC-7) で網羅検証。

### 一般化原則

ADR-0056 系列の全 machine-verify gate (Adversarial Reviewer hook / recent-deploy-deletion / verify-adversarial-output 等) は **defense in depth** で:

- **gate 実行側 (Agent / SKILL)**: 前提条件 verify (worktree HEAD / PR 状態 / TTL 等) を skill ルールとして強制
- **gate 本体**: 前提条件 self-defense (実行側の verify 漏れに対する最終 backstop)

両方を実装する。**第 4 弾 deploy** (#2618) = 機構運用層 self-defense 第一例。今後同種 gate 追加時も両層実装を default 化する。

## 関連

- **Research SSOT**: [docs/research/qm-drift-prevention-2026-05-28.md](../research/qm-drift-prevention-2026-05-28.md)
- **既存 hook 規約**: `scripts/claude-hook-prevent-qa-account-pr.mjs` (#1879 / #1994、本 ADR の実装パターンソース)
- **ADR-0022**: admin bypass 禁止 + ganbariquestsupport-lab QM Approve 体制 (本 ADR はその QM 役を補強)
- **ADR-0010**: Pre-PMF スコープ判断 (本 ADR は Bucket A — 本日 #2588 実観察 defect への直接対処)
- **#2618 (§D 起票元)**: Fix Agent gate 実行時の worktree HEAD verify bypass 脆弱性 (QA self-implement 第 4 弾、2026-05-29 deploy)
- **archive**: ADR-0031 (1-in-1-out 履行で本 PR で archive 移動)
