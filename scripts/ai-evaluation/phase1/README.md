# Phase 1.1 POC — 6 Layer Stack LLM Judge FP 圧縮基盤 (Issue #2711)

> **Round 18 frontier 突破挑戦の起点**。Round 17 で 5 領域世界規模未解決と honest 認定した第 1 領域 **「LLM-as-Judge False Positive 80% リスク」** を、本 product (がんばりクエスト = SvelteKit + 子供向け + 日本語 + Pre-PMF) で業界 SOTA ≤ 20% に圧縮するための 6 layer stack POC 実装。

## 構成 C5 (全 6 layer)

```
Layer F (Calibration)         ← Judge's Verdict κ 実測 + 重み付け            [layer6-judge-verdict.mjs]
Layer E (Synthetic HE)        ← Nielsen 10 + terms.ts inject + 5 mode dedup [layer5-synthetic-he.mjs]
Layer D (Constitution)        ← DESIGN.md §9 + ADR-0012 P1-P6 critique      [layer4-constitutional.mjs]
Layer C (Refute-or-Promote)   ← Stage A/B + Cross-Model Critic              [layer3-refute-or-promote.mjs] ★ 79% kill rate 主担保
Layer B (Multi-Agent Debate)  ← 3-agent + KS-test adaptive stop             [layer2-multi-agent-debate.mjs]
Layer A (Self-Consistency)    ← k=3 runs + CISC confidence weighted         [layer1-self-consistency.mjs]
Layer 0 (Runtime + Capture)   ← Playwright + capture.mjs (既存資産 PR #2695 流用)
```

詳細 spec: `tmp/round18-phase1-poc-design-2026-05-30.md` (1742 行、step-by-step protocol + 実装可能 prompt template、本 dir prompt-templates/*.md は同 SSOT から逐語コピー)。

## Mock vs Real cost 試算

| Mode | 用途 | cost | API 呼出 |
|---|---|---|---|
| **`--mock`** (本 PR 範囲) | structural 健全性検証 | **$0** | なし (realistic dummy response) |
| **Real (AC3、別 step)** | 5-10 type 実 FP 実測 | **$25-65** | Anthropic Claude Opus 4.7 + Gemini 2.5 Pro (Cross-Model Critic) |

**Mock の目的**: 実 Claude API cost $25-65 を投じる前に pipeline 健全性を実証する **Pre-PMF Bucket A cost gate** (PR #2695 の Mock smoke test pattern 踏襲)。

## 使い方

### Mock smoke test (cost $0、本 PR 範囲)

```bash
node scripts/ai-evaluation/phase1/run-phase1-poc.mjs --mock --type activity-pack --runs 3
# 出力: tmp/round18-poc/mock-evaluation-c5.json (6 layer pipeline structural 健全性確認)
```

### Real Claude API (AC3、User 承認後 opt-in)

```bash
# 1. .env.local に API key を配備
cat >> .env.local << 'EOF'
ANTHROPIC_API_KEY=sk-ant-api03-...
GEMINI_API_KEY=...
AI_EVAL_MODEL=claude-opus-4-7
AI_EVAL_RUNS=3
EOF

# 2. demo Lambda env を別 terminal で起動
AUTH_MODE=anonymous DATA_SOURCE=demo npm run preview -- --port 5180

# 3. 6 layer pipeline 実行 (実 API、cost $25-65)
node scripts/ai-evaluation/phase1/run-phase1-poc.mjs --type activity-pack --runs 3
# 出力: tmp/round18-poc/evaluation-c5-result.json (5 軸定量実測値)
```

### 5 軸定量実測閾値 (AC4 達成判定)

| 指標 | 目標 | honest 予測 (-20% 補正後) |
|---|---|---|
| (a) Recall | ≥ 70% | 52-62% |
| (b) **Precision (= 1 - FP 率)** ★主目標 | **≥ 80% (FP ≤ 20%)** | **60-70% (FP 30-40%)** |
| (c) FN 率 | ≤ 30% | 18-28% |
| (d) Cohen's Kappa | ≥ 0.50 | 0.36-0.56 |
| (e) User filter 時間 | ≤ 30 分 / type | 14-28 分 |

**達成判定 path**:
- 5 件全達成 → Phase 1.2 (5-10 type 展開) sub 起票
- 1-2 件未達 → Phase 1.5 (不足軸 deep research) sub 起票
- 3+ 件未達 → Phase 1-E (Stack 振り出し ADR) 起票

## File Layout

```
scripts/ai-evaluation/phase1/
├── run-phase1-poc.mjs              # CLI entry (--mock / --runs N / --type <pack> flag)
├── lib/
│   ├── layer1-self-consistency.mjs    # k=3 runs majority vote + CISC confidence weighted
│   ├── layer2-multi-agent-debate.mjs  # 3 agent (planner / heuristic-evaluator / adversarial) + KS-test adaptive stop
│   ├── layer3-refute-or-promote.mjs   # Stage A (1+2) → Stage B (2+3) → Stage D Cross-Model Critic
│   ├── layer4-constitutional.mjs      # P1-P7 principle critique (DESIGN.md §9 + ADR-0012 + ADR-0045 + ...)
│   ├── layer5-synthetic-he.mjs        # Nielsen 10 split prompt (1-5 / 6-10) + terms.ts inject + dedup
│   ├── layer6-judge-verdict.mjs       # Cohen's Kappa + layer 重み付け calibration
│   ├── pipeline.mjs                   # 6 layer 統合 sequential gate (A → B → C → D → E → F)
│   └── prompt-templates/
│       ├── role-toddler-parent.md      # Persona A: 3 歳児の親 30 代 IT 中
│       ├── role-elementary-parent.md   # Persona B: 小 3 親 40 代 IT 中-高
│       ├── role-junior-student.md      # Persona C: 中高生本人 13-18 歳
│       ├── role-nn-g-heuristic.md      # NN/G 10 heuristics 主観評価
│       └── role-mercari-cgi.md         # 子供 CGI 評価
└── README.md                           # 本 file
```

## 認識バイアス -20% 補正前提

memory `feedback_acknowledge_knowledge_limit_research_phenomena.md` + `feedback_technical_achievement_not_user_goal.md` 整合:

- Mock smoke test pass = **技術達成 (必要条件) のみ**、5 軸定量実測 + 達成判定 = **十分条件 (User goal 完全実装は別 step)**
- 達成可能性 50-60% は -20% 補正で **40-48%**、達成不可能性 **52-60%** も視野
- 6 領域達成不能要因 (Round 18 認定): F1 主観評価 inherent FP / F2 子供認知発達 nuance / F3 日本語 UX domain gap / F4 cross-screen aggregation 限界 / F5 LLM hallucination 21.2% / F6 persona heterogeneity bias

## 関連 file

- **本 sub 主 SSOT**: `tmp/round18-phase1-poc-design-2026-05-30.md` (1742 行)
- **6 手法 deep research SSOT**: `tmp/round18-phase1-fp-research-2026-05-30.md` (1196 行)
- **Round 18 初動完遂継承 SSOT**: `tmp/round18-initial-completion-2026-05-31.md`
- **PR #2695 既存資産**: `scripts/ai-evaluation/` (Mock smoke test pattern + 5 Role POC + Anthropic SDK 設定)
