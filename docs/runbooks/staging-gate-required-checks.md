# Runbook: staging deploy gate の required 化（Phase 1 → 2 段階導入）

> **対象**: `deploy-nuc-staging` / `deploy-aws-staging` を main ruleset の required_status_checks に追加して merge blocker 化する手順（#2874 G-STG-GATE / audit-team.md §3.7 #2・§3.8 step 6-8）。
> **実行主体**: audit-manager（ruleset 変更は不可逆 action = orchestrator 専権、ADR-0056 §E / audit-team.md §3.3）。

## 前提（採用設計 / #2874 handoff spec 承認済）

- **方式 = 案 A**: branch ruleset `PR_Mearge`（id=14673945、main target）の `required_status_checks` に job context を追加する。GitHub Environments「Require deployments to succeed before merging」は不採用（environment 単位の粗い判定で workflow/job 単位の制御ができないため）。
- **paths filter 撤去が required 化の前提**: paths filter 付き workflow を required 化すると、filter 不一致の PR で check が Pending のまま **merge が永久 block** される（[GitHub Docs: troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks)）。`deploy-aws-staging.yml` は #2874 で paths filter 撤去済（main 向け PR で常時発火）。`deploy-nuc-staging.yml` も required 化前に同条件を満たすことを確認する。
- **merge queue は不採用**: 1 日 1 回の単一統合 PR 運用に batch 化の便益なし（#2874 設計判断）。

## Phase 1: advisory 観測（required 未登録）

統合 PR（develop → main）3 本を目安に、required 登録せず以下を観測する:

1. 両 staging workflow が統合 PR で **毎回発火**するか（paths filter 撤去後の保証発火）
2. 所要時間（AWS ≈ 15min wall / NUC = self-hosted runner 依存）が統合 PR の merge cadence を阻害しないか
3. flake / インフラ起因 fail の頻度（required 化後は fail = merge block になるため、安定性の事前実証）

観測結果は統合 PR の `integration-pr-evidence-*` artifact（テスト結果表に deploy job は含まれないため、workflow run の結論を audit-manager が run log で確認）+ run 記録で残す。

## Phase 2: required 化（PO 承認 → audit-manager 実行）

PO 承認後、audit-manager が以下 1 call で 2 context を追加する:

```bash
# 現在の required_status_checks を確認
gh api repos/Takenori-Kusaka/ganbari-quest/rulesets/14673945 \
  --jq '.rules[] | select(.type == "required_status_checks")'

# required_status_checks に deploy-nuc-staging / deploy-aws-staging を追加
# (既存 checks 配列に append した全量で PUT する — 部分更新 API は無いため、
#  上記 GET の結果に 2 context を足した JSON を rules に渡す)
gh api -X PUT repos/Takenori-Kusaka/ganbari-quest/rulesets/14673945 --input ruleset.json
```

- context 名は **job 名**（`deploy-nuc-staging` / `deploy-aws-staging`）。workflow 名ではない。
- 変更後、次の統合 PR で「staging fail = merge 不可」を 1 回実証して Phase 2 完了とする。

## Escape hatch（NUC runner オフライン時等）

self-hosted runner（`local_nuc`）がオフラインだと `deploy-nuc-staging` が queue のまま進まず、統合 PR も **hotfix PR も** merge できなくなる（required check は PR 種別を問わず main 向け PR 全部に適用される）。その場合:

1. **PO 承認を取得**（escape hatch 発動は bypass 行為のため単独判断しない、ADR-0022 整合）
2. 該当 context を ruleset から**一時除去**（上記 PUT の逆操作）
3. merge 完了後、runner 復旧を確認して**同 context を再追加**（除去したまま放置しない — 除去期間中は staging gate が存在しないことを run 記録に明記）

## Rollback

required 化を取り消す場合も同じ 1 call（PUT で 2 context を checks 配列から外す）。workflow 自体（advisory 発火）は残るため、観測は継続できる。

## 関連

- [docs/sessions/branch-strategy.md §4](../sessions/branch-strategy.md)（重量レーン表）
- [docs/sessions/audit-team.md §3.7 / §3.8](../sessions/audit-team.md)（事前準備ゲート / 9 ステップ）
- `.github/workflows/deploy-aws-staging.yml` / `.github/workflows/deploy-nuc-staging.yml`
- Issue #2874 / #2872 / #2873
