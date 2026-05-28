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

## 関連

- **Research SSOT**: [docs/research/qm-drift-prevention-2026-05-28.md](../research/qm-drift-prevention-2026-05-28.md)
- **既存 hook 規約**: `scripts/claude-hook-prevent-qa-account-pr.mjs` (#1879 / #1994、本 ADR の実装パターンソース)
- **ADR-0022**: admin bypass 禁止 + ganbariquestsupport-lab QM Approve 体制 (本 ADR はその QM 役を補強)
- **ADR-0010**: Pre-PMF スコープ判断 (本 ADR は Bucket A — 本日 #2588 実観察 defect への直接対処)
- **archive**: ADR-0031 (1-in-1-out 履行で本 PR で archive 移動)
