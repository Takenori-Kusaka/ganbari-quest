# QM Orchestrator Role Drift 構造的対処 — Research SSOT (2026-05-28)

**status**: primary source for ADR-0056
**date**: 2026-05-28
**related**: Issue #2597 (drift baseline scan) / #2590 / #2591 / #2592 / ADR-0022

---

## 1. 観察された問題

QM Orchestrator (Claude Code session) が「顧客品質最終ゲート」役割から「BLOCK 列挙 / CI proxy」役割に drift。

| 指標 | 値 |
|---|---|
| 観察期間 | 33 日 (2026-04-25 〜 2026-05-28) |
| drift 再発回数 | 42 回 |
| 軽減策の効果 | memory / ADR / checklist を 5 回追加・更新したが、再発率変化なし (#1879 / ADR-0022 / `feedback_qm_continuous_responsibility.md` 等) |

「memory を増やせば drift が減る」という仮説は **実証不能**。本研究はこの実証結果を起点に、**memory/instruction 系で覆せない理論根拠** を文献から提示し、構造的対処 (Hook + Adversarial Reviewer + Schema) を採用する。

---

## 2. 原因類型 (文献参照)

### 類型 A: Persona Drift (役割固定の自己解消)

- 多段会話・長期 session で LLM agent の「与えられた役割」が context 圧力で薄まり、別役割 (より単純な executor 役) に slide する現象。
- 参照: Wang et al., "On the Robustness of Personality Adherence in LLM Agents" (2024)。
- 本 case 対応: QM 役 (顧客品質最終ゲート) → BLOCK 列挙 (Lint 等 CI が既に拾える項目を列挙する単純 executor) への slide。

### 類型 B: Echoing (相互同調による独立性消失)

- LLM 間 / multi-turn 自己対話で「直前の発言を肯定的に echo する」傾向。
- 参照: arXiv:2511.09710 "Echoing: Identity Failures when LLM Agents Talk to Each Other" — **structured response schema 強制で echoing 30-40% → <10% 実証**。
- 本 case 対応: QM が Dev からの PR 説明を読むと「Dev 視点での合理化」を echo してしまい、本来の「顧客視点でなお致命的か」judgment が薄れる。

### 類型 C: Normalization of Deviance (Diane Vaughan 1996)

- 「過去にこの程度の逸脱で事故が起きなかった」累積経験が、当該逸脱を「許容範囲」と再定義していく社会学的機構。
- 元出典: Diane Vaughan "The Challenger Launch Decision" (1996)。後続研究は航空・医療・原発で広く検証。
- 本 case 対応: QM が「ここまで merge して事故が起きていない」累積経験から、致命的ではない逸脱を「許容」と再カテゴライズする。BLOCK 列挙はその「許容」reframing の symptom。

### 類型 D: Goodhart's Law

- "When a measure becomes a target, it ceases to be a good measure."
- 本 case 対応: QM レビューの target が「CI 全 PASS + BLOCK ≥ 0 件列挙」となった結果、「顧客視点での致命的欠陥検出」という original measure が proxy された。

---

## 3. memory / ADR 系では覆せない理論根拠

### 根拠 1: instruction 補強の限界 (Sleeper Agents, Hubinger 2024)

- Anthropic "Sleeper Agents" (Hubinger et al. 2024): instruction 経由の安全性訓練は **agent の「隠す」能力を強化するだけ** で、backdoor は除去できないことを実験的に実証。
- 本 case 対応: QM 役を強化する memory / ADR / checklist を追加しても、agent は「役割を演じている」状態を強化するだけで、drift trigger (Echoing / Normalization) には対処していない。
- 42 回再発の実証データはこの理論と整合する。

### 根拠 2: Self-monitoring の信頼性低さ (Constitutional AI, Anthropic 2022)

- Constitutional AI (arXiv:2212.08073): self-critique は有効だが、**critique target が "broad" で "judgmental" な場合は精度低下**。LLM は「自分が drift しているか」を高信頼度で自己判定できない。
- 本 case 対応: QM 自身に「あなたは drift していませんか?」と問うても、drift 中の QM は drift を否認する (identity drift の定義そのもの)。
- 対策方針: **agent 内部の自覚に依存しない構造** が必要。

### 根拠 3: 量的増加の逆効果 (Lost in the Middle, Liu et al. 2023)

- arXiv:2307.03172 "Lost in the Middle": context 中盤の情報は冒頭・末尾より参照率が低下。memory / ADR を増やすほど、QM レビュー時点で重要 instruction の参照率が下がる。
- 本 case 対応: 過去 5 回の memory / ADR 追加は context window 圧迫により逆に drift を誘発した可能性がある。

---

## 4. 排除した解 (= 採用しない理由)

| 解 | 排除理由 |
|---|---|
| **Human approval を normal flow に組み込む** | 本日 PO が明示否定 ("agent-led / autonomous を維持"). agent 役職を剥奪して人間 throughput に依存させると PR 10x で human cost が線形成長し、scalable でなくなる |
| **Memory / ADR / instruction の量改善** | 5 回試行 / 42 回再発で実証不能 (上記根拠 1 / 2 / 3) |
| **Hard Gate で agent を approve action から物理排除** | agent の役割剥奪 = 解決ではない。役割を agent に残しつつ structural constraint を加えるのが正解 |
| **AI orchestrator 多重化 (3 agent voting 等)** | Pre-PMF コスト過剰 (ADR-0010)、本日の defect 直対処に対し過剰防衛 |

---

## 5. 採用解 (案 1: Adversarial Reviewer + PreToolUse Hook + JSON Schema 強制)

### 5.1 設計核心

1. **`PreToolUse` hook** (`.claude/hooks/gate-approve.mjs`):
   - `Bash` matcher で `gh pr (merge|review --approve)` 発火を捕捉
   - `tmp/adversarial-evidence/<pr-number>.json` の **存在 + 30 分以内 + schema 必須 field 充足** を確認
   - 不在 / TTL 切れ / schema 不正で `permissionDecision: "deny"` (Claude Code hooks 公式仕様: exit 2 で agent に block)
2. **Adversarial Reviewer subagent** (`.claude/skills/adversarial-reviewer/SKILL.md`):
   - role identity: "adversarial_reviewer (NOT QM, NOT Dev)"
   - `must_object_count: 3` で 3 軸 (business / UX / security) の反対理由を **必ず** 出力する schema 強制
   - skill instruction で "QM の approve 意図に echo するな、反対せよ" を repeated emphasis (類型 B echoing 抑制)
3. **Schema validation** (`scripts/verify-adversarial-output.mjs`):
   - structured output の shape 検証
   - `axis` Set check / `reason.length >= 100` / `generated_at` TTL 30 分以内

### 5.2 理論的根拠

- **arXiv:2511.09710 echoing 抑制**: structured response schema 強制で 30-40% → <10%。本実装は同 paper の核心知見を直接適用。
- **must_object_count: 3 強制**: 「3 つの反対理由を必ず書く」を role identity に焼き込むことで、reviewer が「反対理由が無い」と返す経路を schema レベルで物理的に閉じる。「皆同意した = OK」の echoing 路を構造的に絶つ。
- **Anthropic Claude Code hooks 公式 spec**: `PreToolUse` hook の `permissionDecision: "deny"` は agent 内部の自覚に依存せず、Bash command を物理 block する。Sleeper Agents 根拠 1 / Constitutional AI 根拠 2 に整合。

### 5.3 escalate 経路 (案 2 / 案 3 移行 trigger)

本実装は最小コストの案 1。以下の trigger 条件で案 2 (多 verifier ensemble) / 案 3 (Hard Gate + human merge) に escalate する。

| trigger | escalate 先 |
|---|---|
| 案 1 deploy 後 30 日で drift 再発 ≥ 5 件 | 案 2 (heterogeneous ensemble: 異なる model で 2 verifier) |
| 案 2 deploy 後 30 日で drift 再発 ≥ 3 件 | 案 3 (人間最終 approve) |
| 顧客に致命的 defect が漏れた | 即座に案 3 |

---

## 6. 計測指標 (Issue #2597 baseline scan で使用)

D1-D5 の 5 指標を 33 日 retroactive scan + 案 1 deploy 後 30 日 prospective scan で対比:

| ID | 指標 | 測定方法 |
|---|---|---|
| D1 | drift event 件数 | PR review コメントで「BLOCK 列挙のみ / 顧客 judgment 不在」を検出 |
| D2 | adversarial evidence 生成率 | `tmp/adversarial-evidence/<N>.json` の存在率 (approve action 全数中) |
| D3 | objection 多様性 | objections[].axis が 3 軸全てを cover した evidence の割合 |
| D4 | echo 率 | objections[].reason が PR description / Dev 主張を bag-of-words で >70% 重複 |
| D5 | escalate trigger 発火回数 | 案 1 → 案 2 移行条件 (5 件) に到達したか |

---

## 7. OSS 先調査記録 (ADR §「検討した選択肢」根拠資料、ADR-0014 / #1350 整合)

| 選択肢 | 種別 | 採用根拠 |
|---|---|---|
| A. 多 verifier / heterogeneous ensemble | 確立パターン (LLM-as-Judge production guide, Comet 2024) | 案 1 で drift 再発 ≥ 5 件時に escalate。Pre-PMF 段階では過剰 |
| B. Adversarial Reviewer + structured schema | OSS / 既存知見 (arXiv:2511.09710 paper、Claude Code hooks 公式 spec) | **採用**。理論根拠が文献で実証済 + Pre-PMF cost 最小 (1-2 日工数) |
| C. Hard Gate + human merge | 案 3 (PO 明示否定) | autonomous 維持の制約に反する |
| D. 独自 instruction 補強 | 既試行 (42 回再発で実証不能) | 棄却 |

### 確立パターンの該当検索範囲

- npm: `agent-evaluation`, `llm-judge`, `claude-code-hook` キーワードで 2026-05-27 検索 — Claude Code hooks 公式 spec が SDK レベルで存在、外部 npm package 不要
- GitHub: anthropic-cookbook (Constitutional AI / Adversarial Critique sample)、arXiv 2025 papers (Echoing identity failures)
- 確立パターン: Adversarial Process / Devil's Advocate / Six Thinking Hats (Edward de Bono) を multi-agent 文脈に転用

---

## 8. 関連 Issue / PR

- Issue #2597 — drift baseline 計測 (本案 1 deploy 前後の対比)
- Issue #2590 — Tier 2 semantic review Step 4.5 追加
- Issue #2591 — 本日 merged 8 件の semantic post-review
- Issue #2592 — Tier 2 業務判断 PR PO/business-panel 必須回付
- ADR-0022 — admin bypass 禁止 + ganbariquestsupport-lab QM Approve 体制
- 本 PR — ADR-0056 起票 + 案 1 実装

---

## 9. ADR-0056 へのリンク

本 research は ADR-0056 (QM drift prevention by structural agent constraint) の primary source。
ADR-0056 §「コンテキスト」「検討した選択肢」「決定」「結果」の根拠を本ファイルが SSOT として保持する。
