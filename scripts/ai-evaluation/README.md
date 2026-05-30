# AI Heuristic Evaluator POC

> **Status**: Issue #2692 POC 基盤実装 (Day 1-2 範囲)、EPIC #2691 並走 path の核機構
>
> **Goal**: Stagehand v3 + Claude Opus 4.7 + axe-core で activity-pack 1 type の顧客 review 基盤を実証 (Multi-Agent 5 Role + Self-Consistency naive 3 runs)

## なぜ

PR #2657 後段フェーズ Round 18 並走 path 用 (EPIC #2691)。Phase 1 (task #192) = LLM-as-Judge FP 克服が 1-1.5 年の長期 R&D 路線である一方、**並走期間中も business 価値創出 (顧客 review feedback ループ) を止めない**ため、業界実証域 91-99% stack を本 product に着地する。

User goal「立ち会うだけ」を **15-30 分 / type の User filter session** で達成する譲歩条件付き構成 (Phase 1 完成で撤廃判断)。

## Stack 選定根拠

[ADR-0014 OSS 先調査ルール](../../docs/decisions/README.md) 整合。詳細: `tmp/round18-parallel-path-stack-2026-05-30.md` §A.4。

| Layer | OSS / 機構 | 採用根拠 |
|---|---|---|
| 1. Runtime env | port 5180 demo Lambda env (`AUTH_MODE=anonymous` + `DATA_SOURCE=demo`、ADR-0048) | 既存資産 100% reuse、5 fixture child (`demo-data.ts` L10-14) |
| 2. 自動探索 | **Stagehand v3** (MIT、TypeScript native) | 既存 playwright.config.ts (port 5180) 直接拡張可能、atomic primitives で reproducibility |
| 2. a11y audit | **@axe-core/playwright** (MPL-2.0、Deque 公式) | 業界標準、WCAG 2.2 AA 自動評価 |
| 3. Multi-Agent | **@anthropic-ai/sdk** + Claude Opus 4.7 | 5 Role (Planner/Adversarial/Persona A/B/Brand) を本 product 既存 4 Skill (`cognitive-walkthrough` / `customer-voice` / `brand-check` / `adversarial-reviewer`) SSOT に直結 |
| 3. Self-Consistency | naive 3 runs (Promise.all 並列) | Phase 1 完成 (#192) で 5-10 runs + adaptive stability に upgrade |

**不採用**: browser-use (Python 別 stack 管理コスト) / Anthropic Computer Use vision-only (DOM-driven より 12-17 pt 低信頼 + cost 不確実)

## Prerequisite

```bash
# 1. POC 依存 install (本 PR で完了済)
npm install -D @browserbasehq/stagehand@^3.4 @axe-core/playwright@^4.11 @anthropic-ai/sdk@^0.100

# 2. .env.local 配備 (取得: https://console.anthropic.com/settings/keys)
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> .env.local

# 3. 別 terminal で demo Lambda env 起動 (ADR-0048)
AUTH_MODE=anonymous DATA_SOURCE=demo npm run preview -- --port 5180
```

## 使い方

```bash
# preschool 1 age mode で full POC (推奨初回実行、約 $5-10)
node scripts/ai-evaluation/run-poc.mjs --type activity-pack --age preschool

# 5 age mode 全部 (約 $25-50、要注意)
node scripts/ai-evaluation/run-poc.mjs --type activity-pack --age all

# Stagehand + axe smoke test のみ (API cost 0、key 不要、Stagehand 動作確認)
node scripts/ai-evaluation/run-poc.mjs --age preschool --skipMultiAgent

# 既存 SS を使い Multi-Agent のみ再実行 (prompt 調整時に有用)
node scripts/ai-evaluation/run-poc.mjs --age preschool --skipStagehand

# ヘルプ
node scripts/ai-evaluation/run-poc.mjs --help
```

## ディレクトリ structure

```
scripts/ai-evaluation/
├── README.md                          # 本 file (POC 使い方 SSOT)
├── run-poc.mjs                        # entry point (CLI)
├── lib/
│   ├── stagehand-runner.mjs           # Stagehand v3 自動探索 (5 step × 5 age mode)
│   ├── axe-runner.mjs                 # axe-core + 子供向け custom audit (tapSize per age)
│   ├── multi-agent-evaluator.mjs      # 5 Role × Self-Consistency 3 runs + 集約 JSON
│   ├── filter-session-renderer.mjs    # User filter session markdown 生成 (AC7)
│   └── prompt-templates/
│       └── index.mjs                  # 5 Role prompt SSOT (DOMAIN_CONTEXT full inject)
└── output/                            # POC 一時 output (gitignore)
```

## 出力

| 成果物 | path |
|---|---|
| Stagehand 自動探索 SS (25+ 枚) | `tmp/round18/ss-<age>-step<N>.png` |
| axe-core report (25 cycle) | `tmp/round18/axe-<age>-step<N>.json` |
| Multi-Agent 集約 JSON | `tmp/round18/evaluation-<type>-<age>.json` |
| User filter session md (AC7) | `tmp/round18-review-<type>-<age>-<date>.md` |
| POC 結果 summary | `tmp/round18-poc-result-<date>.md` |

## 5 Role Multi-Agent prompt

各 Role は本 product 既存 Skill SSOT を full inject:

| Role | SSOT | 目的 |
|---|---|---|
| 1. Planner | `.claude/skills/cognitive-walkthrough/SKILL.md` | NN/G Q1-Q4 で 5 step × 4 質問 = 20 cell 評価 |
| 2. Adversarial Reviewer | `.claude/skills/adversarial-reviewer/SKILL.md` (ADR-0056) | 3 反対理由 (business/UX/security) 必須、FP 抑制 |
| 3. Persona A | `.claude/skills/customer-voice/SKILL.md` | 3 歳児の親、認知負荷 / 専門用語検出 |
| 4. Persona B | `.claude/skills/customer-voice/SKILL.md` | 小 3 親、用語不統一 / 重複 CTA / dead-end (#2558 4 bug 視点) |
| 5. Brand Auditor | `.claude/skills/brand-check/SKILL.md` | DESIGN.md §9 5 禁忌 + Anti-engagement (ADR-0012) |

詳細: `scripts/ai-evaluation/lib/prompt-templates/index.mjs`

## 達成判定 5 軸 (Issue #2693 で実測)

本 POC (Issue #2692) は Day 1-2 = 基盤完成までで、5 軸定量実測は Day 3 + User filter session = Issue #2693 で実施:

| 軸 | 閾値 | 測定方法 |
|---|---|---|
| (a) AI 検出 true positive 率 (Recall) | ≥ 70% | User filter 後の AI 評価 vs User ground truth |
| (b) AI 見落とし率 (FN) | ≤ 25% | User 違和感記録欄 件数 / 総 issue 件数 |
| (c) AI 過剰検出率 (FP) | ≤ 35% | User 「No 却下」件数 / AI 評価総件数 |
| (d) Cohen's Kappa (severity AI vs User) | ≥ 0.50 | Catching UX Flaws arXiv:2512.04262 moderate agreement 線 |
| (e) User 立ち会い時間 | ≤ 30 分 / type | session 開始 / 終了時刻記録 |

判定 path:
- **3 件全達成** → sub #N3 (reward-set 展開、cross-type 学習で 10-20 分短縮想定)
- **1-2 件未達成** → Round 18.5 fallback (不足軸 deep research)
- **3+ 件未達成** → Round 18.5-E (Stack 振り出し判断、ADR 起票)

## honest 限界 (memory `feedback_acknowledge_knowledge_limit_research_phenomena.md` 整合)

- **POC 期待値は -20% 補正後**: AI 単独 55-70% / User filter 後 85-95% (業界実証域 91-99% 下限張り)
- **本 POC は本 product 実測前**: Round 16/17 業界 SOTA 起点、Round 18 activity-pack POC で実測補強
- **Stagehand v3 動作未実証**: 本 POC で activity-pack 1 type で実証、失敗時は browser-use Python wrapper fallback
- **Multi-Agent naive 3 runs**: diversity 不足 (CISC 40-90% 削減効果は再現不能)、Phase 1 (#192) 完成で upgrade
- **日本語 LLM 精度低下**: terms.ts atom SSOT を prompt full injection で部分緩和、POC で実測

## 次 step (Issue #2693)

本 POC 基盤 (Issue #2692 = Day 1-2) 完成後:

1. **Day 3 通し実行**: activity-pack 全 step × 5 age mode で SS 30+ 枚 + axe-core 25 JSON + 集約 JSON 出力
2. **User filter session 実施** (15-30 分): markdown を browser で開き Section 1-4 を編集
3. **5 軸定量実測**: filter 後 ground truth vs AI 出力で Recall / FN / FP / Kappa / 立ち会い時間算出
4. **判定 path 適用**: 達成 → reward-set 展開 / 未達成 → fallback 路

## 関連 SSOT

- **本 sub Issue**: [#2692](https://github.com/Takenori-Kusaka/ganbari-quest/issues/2692) POC 基盤実装
- **EPIC**: [#2691](https://github.com/Takenori-Kusaka/ganbari-quest/issues/2691) 並走 path 全体設計
- **後続 sub**: [#2693](https://github.com/Takenori-Kusaka/ganbari-quest/issues/2693) activity-pack 初回 review session 実施 (5 軸実測)
- **stack 選定**: `tmp/round18-parallel-path-stack-2026-05-30.md`
- **作業手順 (詳細)**: `tmp/round18-parallel-path-first-review-plan-2026-05-30.md`
- **Phase 1 frontier 突破**: task [#192](https://github.com/Takenori-Kusaka/ganbari-quest/issues/192) (本 POC の Self-Consistency 3 runs naive は完成後 5-10 runs に upgrade)
- **5 fixture child SSOT**: `src/lib/server/demo/demo-data.ts` (901-906)
- **age tier SSOT**: `src/lib/domain/validation/age-tier.ts` AGE_TIER_CONFIG (tapSize per age)
- **既存 E2E reference**: `tests/e2e/admin-activities-import-marketplace.spec.ts`
- **Multi-Agent 4 Skill**: `.claude/skills/{cognitive-walkthrough,customer-voice,brand-check,adversarial-reviewer}/SKILL.md`

## 関連 ADR

- **ADR-0010** Pre-PMF Bucket A 適合 ($10-30 POC cost)
- **ADR-0012** Anti-engagement (prompt template Constitutional principle として inject)
- **ADR-0014** OSS 先調査ルール (Stagehand / browser-use / Computer Use 3 候補比較)
- **ADR-0045** terms.ts SSOT 2 階層化 (FP 類型 1 UI Component Recognition Errors 抑制)
- **ADR-0048** demo Lambda env (`AUTH_MODE=anonymous` + `DATA_SOURCE=demo`)
- **ADR-0055** Per-child primary data model (activity-pack は per-child 型、`selectedChildId` cookie 切替)
- **ADR-0056** QM drift prevention (Adversarial Reviewer must_object_count: 3 schema 強制)
