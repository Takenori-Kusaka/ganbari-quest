# scripts/audit/ — 監査 run finding pipeline

> EPIC #2861 / B4 = #2867。外部品質監査チームの **手動 audit run** で
> finding → 重複統合 → severity filter → 起票候補 の機械処理部分を担う pure function
> + CLI 群。役割定義の SSOT は [docs/sessions/audit-team.md](../../docs/sessions/audit-team.md)、
> 手順骨格の SSOT は [.claude/agents/audit-manager.md](../../.claude/agents/audit-manager.md)。
> 本 README は重複定義せず、それらを前提に「dispatch 手順」と「pipeline CLI の使い方」のみ記す。

## 役割分担 (hard gate は rules-based のみ — EPIC 設計原則 1)

| 段 | 主体 | 実装 |
|---|---|---|
| dispatch (8 領域 + ポリシー準拠判定 skill 起動) | audit-manager (Claude session) が Agent tool で skill を起動 | 人手 / LLM (CI に載せない) |
| 機械検証可能項目 (axe / lp-metrics / check 系 / coverage) | CI | `.github/workflows/audit-run.yml` (workflow_dispatch) |
| 全件発露 → schema verify → 重複統合 → severity filter | CI / CLI (rules-based) | `scripts/audit/run-pipeline.mjs` |
| ポリシー準拠 filter (誤起票防止) | audit-manager が policy-compliance skill で判定 | LLM (CI に載せない、advisory) |
| 起票 / approve / merge (不可逆 action) | audit-manager **専権** | LLM + gh (CI に載せない) |

LLM 判定 (policy filter / adversarial) を **hard gate にしない**のは EPIC 設計原則 1
(GitHub Copilot code review「AI は required approval にカウントしない」/ Anthropic
「LLM-as-judge is generally not robust」整合)。CI が block するのは rules-based のみ。

## dispatch 手順 (audit-manager session が実施)

詳細手順骨格は [audit-manager.md §E run flow](../../.claude/agents/audit-manager.md) を SSOT とする。要約:

1. **対象 run を確定** — baseline run は `integration_pr=0` (main 全体、差分非依存)。統合 run は対象 develop→main PR 番号。
2. **8 領域 + ポリシー準拠判定を dispatch** — 再利用 skill / workflow ([audit-team.md §3.2](../../docs/sessions/audit-team.md)):
   - 技術調査 = `impact-analysis` / `regression-check`
   - プロダクト実装調査 = `pr-review` / `regression-check`
   - ユーザビリティ・a11y = `cognitive-walkthrough` / `customer-voice` / `age-mode-check` / axe-core job
   - セキュリティ = `security-scan.yml` / codeql / dependency-review
   - パフォーマンス = `lp-metrics` / visual regression / `cost-review`
   - テスト品質 = `flake-hunt`
   - 競合調査 = `competitive-research` (一次情報 URL 必須)
   - ポリシー準拠判定 = `policy-compliance`
   - 問題起票 = `issue-triage`
3. **各 subagent は finding を structured JSON で `tmp/audit-evidence/<team>.json` に Write**
   ([evidence schema](#evidence-schema))。
4. **機械検証項目は CI で回す** — `.github/workflows/audit-run.yml` を `workflow_dispatch` で起動し
   artifact を取得。
5. **pipeline を実行** — `scripts/audit/run-pipeline.mjs` で全 evidence を集約し `tmp/audit-run-<date>.md` を生成。
6. **audit-manager が後段を実施** — ポリシー準拠 filter → adversarial dispatch → 起票 / merge 判定
   (不可逆 action は orchestrator 専権、[audit-manager.md §C/§F](../../.claude/agents/audit-manager.md))。

## evidence schema

`tmp/audit-evidence/<team>.json` の最小 field + SARIF 2.1.0 互換 field。SSOT は
[audit-manager.md §B](../../.claude/agents/audit-manager.md) と
[`scripts/audit/evidence-schema.mjs`](evidence-schema.mjs)。

```jsonc
{
  "run_id": "baseline-20260610",
  "integration_pr": 0,                 // baseline は 0
  "team": "security",                  // 許容値は evidence-schema.mjs VALID_TEAMS
  "findings": [
    {
      "id": "security-1",              // 重複統合のキー
      "title": "<1 行サマリ>",
      "location": "src/lib/server/auth/foo.ts:42",
      "severity": 3,                    // 1-2=軽微(backlog) / 3-4=重大(起票候補)
      "policy_candidate": false,
      "detail": "<再現手順 / 根拠 / 影響>",
      "evidence_urls": [],             // competitive / audit-manager-cuj は必須

      // --- SARIF 2.1.0 互換 (EPIC 設計原則 4 — dedup 安定化) ---
      "ruleId": "authz/missing-tenant-check",
      "level": "error",                // none|note|warning|error
      "partialFingerprints": { "primary": "authz/missing-tenant-check::src/lib/server/auth/foo.ts" },
      "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "src/lib/server/auth/foo.ts" } } }]
    }
  ]
}
```

- **dedup は `ruleId + 正規化 location`** (= partialFingerprints) ベース。文字列一致ではないため
  行番号ズレ / 大文字小文字差を吸収する ([dedup.mjs](dedup.mjs))。
- `competitive` / `audit-manager-cuj` は `evidence_urls` 必須。欠落は自動棄却 (幻覚 finding 防止)。

## CLI

```bash
# 単一 evidence の schema 物理 verify (audit-manager が dispatch 後に実行)
node scripts/audit/verify-audit-evidence.mjs --file tmp/audit-evidence/security.json

# 全 evidence を集約 → tmp/audit-run-<date>.md 生成
node scripts/audit/run-pipeline.mjs --run-id baseline-20260610 --scope baseline

# CI gate: schema 不充足 evidence が 1 件でもあれば exit 1
node scripts/audit/run-pipeline.mjs --run-id baseline-20260610 --strict
```

## CI 共有 fixture

`scripts/audit/fixtures/sample-evidence.json` は `audit-run.yml` の `pipeline-selftest` job
(CLI smoke) と `tests/unit/audit/evidence-schema.test.ts` の両方が参照する固定 evidence。
schema が変わっても fixture が追従していなければ unit test 側で fail し、CI smoke の偽 PASS を防ぐ。

## 局所テスト

```bash
npx vitest run tests/unit/audit/
```

pure function (schema 検証 / dedup / severity filter / report 組み立て) の unit test。
I/O (CLI) は薄い wrapper のため pure function の test でロジックを担保する。
