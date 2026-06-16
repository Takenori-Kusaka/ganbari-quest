<!--
統合 PR 専用 template (#2950 / Phase B/B-1、親 #2949 / 祖父 EPIC #2861)

この template は develop→main の「統合 PR」専用です (feature → develop の PR は
.github/PULL_REQUEST_TEMPLATE.md を使います)。統合 PR は単一 Issue に紐づかず・
複数の feature/fix PR を集約し・1 日 1 回発行される性質を持つため、`closes #<single>` /
per-PR AC 検証マップ / SS 4 スロットを前提とする feature 用 template とは別系統です。

必須 `## ` 見出しの SSOT: .github/INTEGRATION_PR_TEMPLATE_SECTIONS.json
(template ⇔ JSON 同期は check-pr-template-sections-sync.yml が検証)。

lane-aware gate との接続 (Phase A/A-3):
  - pr-ac-verification-check.yml (integration lane): エビデンス表 section (下記 §3) の
    存在 + 4 列以上のデータ行 + 残 NG 0 件 明示を検証する (audit-team.md §3.5)。
  - pr-merge-gate.yml (integration lane): env MERGE_GATE_INTEGRATION_SECTIONS で指定した
    section の未チェック `- [ ]` を検証する。本 template は §5 (NG / カバレッジ宣言) を接続する。

  注: gate は section 見出し文字列を本文から検索するため、この説明コメント内では
  実際の `## ` 見出し文字列を再掲しない (誤マッチ回避)。各 section の正確な見出しは下記参照。

B-3 (#2871) が含有 PR 一覧 + サマリを、B-4 (#2876) がエビデンス表を自動生成・差込します。
本 template が確定するまでは手動記入し、placeholder には「B-3/B-4 で自動生成」と注記します。
-->

## 統合サマリ

<!-- 対象 develop HEAD SHA / 統合対象期間 / 統合 PR 番号 (自動採番)。B-3 (#2871) が自動生成。 -->

- 対象 develop HEAD: `<develop HEAD SHA>`
- 統合対象期間: `<YYYY-MM-DD>` 〜 `<YYYY-MM-DD>` (前回統合 merge 〜 今回)
- 統合 PR 番号: `#<自動採番>`

> 統合 PR は単一 Issue に紐づきません (`closes #<single>` を持ちません)。変更の出典は
> 「含有 PR 一覧」が担保します。Issue 非紐づけは統合 PR の設計前提です (#2950 AC4)。

## 含有 PR 一覧

<!--
develop に積み上がった全 feature/fix PR を 1 行ずつ列挙する。
B-3 (#2871) が develop の merge 履歴から自動生成する (それまでは手動記入)。
-->

| PR | title | type label | 対象領域 |
|---|---|---|---|
| #NNNN | `<title>` | `type:feat` | `<area>` |

> _この表は B-3 (#2871) で develop merge 履歴から自動生成予定。_

## マージ判定エビデンス表

<!--
audit-team.md §3.5 のマージ判定エビデンス基準 (6 列)。
CI artifact (SARIF 集約 + カバレッジ gap map) を入力に audit-manager run が記入する。
- 全行 pass + 残 NG 合計 0 + カバレッジ閾値割れなし を満たして初めて audit-manager が merge を実行する。
- 1 行でも fail / 残 NG > 0 なら merge せず §3.6 起票/棄却 flow に送る。
- finding は SARIF 2.1.0 (`scripts/audit/to-sarif.mjs`、#2876) で正規化され、
  `integration-evidence` job が NG-0 + coverage ratchet を advisory (非 block) で評価する。
gate (pr-ac-verification-check.yml / integration lane) はこの section の存在 +
4 列以上のデータ行 + 空欄/プレースホルダ無し + 「残 NG 0 件」明示を機械検証する。
-->

| 変更（出典 PR） | 対象領域 | 対応テストケース | 結果 | カバレッジ影響 | 残 NG |
|---|---|---|---|---|---|
| 機能 A（#NNNN） | admin/activities | unit×N / e2e×M | pass | 閾値内 | 0 |
| 修正 B（#NNNN） | child-home | unit×N / e2e×M | pass | 閾値内 | 0 |

> _この表は CI artifact `integration-pr-evidence-<run_id>` (#2874、SARIF 集約 + カバレッジ gap map) を入力に audit-manager run が記入する。_

## 監査 run 結果リンク

<!--
当該統合 PR の audit run (`<pr>-<YYYYMMDD>`) の evidence と adversarial evidence への link。
merge 後は in-toto Release predicate attestation (`integration-attest.yml`、#2876) が
merge commit に紐付き、`gh attestation verify` で audit trail を改ざん検知付きで遡れる。
-->

- audit run evidence: `<run URL / artifact link>` (run id: `<pr>-<YYYYMMDD>`)
- adversarial evidence: `tmp/adversarial-evidence/<pr>.json`
- attestation (merge 後): `integration-attestation-<run_id>` artifact + GH attestations API
  (`gh attestation verify --predicate-type https://in-toto.io/attestation/release/v0.2 <merge commit>`)

## NG 0 件 / カバレッジ宣言

<!--
severity 3-4 + policy_compliant=false の未解決 finding が 0 件 +
カバレッジ ratchet 閾値割れなしの宣言 (audit-team.md §3.5 #4/#5)。
pr-merge-gate.yml (integration lane) が下記 `- [ ]` の全消化を機械検証する
(env MERGE_GATE_INTEGRATION_SECTIONS が本 section を指す)。
-->

- 残 NG 合計 0 件 (severity 3-4 + policy_compliant=false の未解決 finding なし)
- [ ] 8 領域 finding のうち severity 閾値以上の未解決 NG が **0 件**である
- [ ] カバレッジ ratchet 閾値割れがない (ADR-0005 整合)
- [ ] 最重厚レーン (branch-strategy.md §4) の全 job が緑である
- [ ] adversarial evidence の反対理由が全件解消済みである

## back-merge / drift 状態

<!--
直近 hotfix back-merge (B-5) の取り込み状況 + develop⇔main drift 日数。
-->

- 直近 hotfix back-merge: `<取り込み済み / 該当なし>` (出典: `<main→develop PR #NNNN>`)
- develop⇔main drift: `<N>` 日 (前回統合 merge からの経過)
