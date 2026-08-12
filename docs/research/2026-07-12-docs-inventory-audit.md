# docs/ 全サブディレクトリ棚卸 inventory 監査（#3516 AC1）

| 項目 | 内容 |
|------|------|
| 関連 Issue | #3516（docs/ ゴミ箱化防止の体系的整理） |
| 役割 | docs/ 全サブディレクトリの per-file 4 分類一覧 + 是正の段階 PR 計画。基準書 `2026-06-04-docs-inventory-audit.md`（#2440、経緯メタ汚染軸）の続編（本書は one-off 量産・誤配置・死蔵軸） |
| 是正実施 | 本書は分類と計画のみ（AC1）。削除・移動は分類確定後の段階 PR（AC2、#2225 の 50 file ルール準拠）で消化 |

## 1. 判定基準（4 分類 + 要 PO 判断）

| 区分 | 定義 | 是正 |
|---|---|---|
| **A: SSOT（現状の正解）** | 現行の設計・運用・調査 SSOT。被参照あり、または層の本務（rationale / sessions / runbooks 等） | 残置 |
| **B: 検討 narrative** | 機能設計の検討経緯・棄却案比較が file 単位で誤層に存在 | `docs/rationale/` へ移動 |
| **C: 死蔵（削除可）** | 役目を終えた one-off。機械確認 = 被参照 0（または死蔵同士の相互参照のみ）+ 結論が設計書 / ADR に内包済 | 削除（履歴は git、削除主義） |
| **D: 誤配置** | 内容と配置層が不一致（例: research 内容が reference/ に存在） | 移動先明示 + 参照更新を同一 PR で完結（#2225） |
| **E: 要 PO 判断** | 機械判定不能（完了済か将来利用かの判断根拠がリポジトリ内にない、EPIC 進行中の process artifact 等）。**保守的に削除計画へ載せない**（Issue no-go 準拠） | PO 判断後に段階 PR |

## 2. 機械計測方法（2026-07-12、origin/develop 4ca1ec18）

```bash
# 対象: docs/{research,design,rationale,decisions,sessions,runbooks,operations,troubleshoot,reference,security,guides,inquiry,marketing,retrospectives}/**/*.md = 322 file
# 最終更新日
git log -1 --format=%as -- "<file>"
# 被参照（ファイル名 basename の全文一致、自ファイル除外）
grep -rl -F "<basename>" docs scripts .github src tests .claude CLAUDE.md \
  --include='*.md' --include='*.mjs' --include='*.js' --include='*.ts' \
  --include='*.yml' --include='*.yaml' --include='*.json' --include='*.svelte'
```

scope 注記: `docs/zenn/`（自前 README / prh 運用 #2243）と top-level 4 file（CLAUDE.md / DESIGN.md / codebase-map.md / GEMINI.md = すべて SSOT）は本分類の対象外。`docs/decisions/`（69 file）は **ADR 月 1 棚卸プロセス（docs/CLAUDE.md §ADR 月 1 棚卸）が既存の専用棚卸 SSOT** のため、本書では dir 一括 A とし per-file 再分類しない（二重管理回避）。

## 3. dir 別集計

| dir | files | A: SSOT | B: narrative | C: 死蔵 | D: 誤配置 | E: 要 PO 判断 |
|---|---|---|---|---|---|---|
| research | 17 | 10 | 0 | 7 | 0 | 0 |
| design（top-level） | 82 | 63 | 0 | 5 | 0 | 14 |
| design/dsql | 18 | 5 | 0 | 0 | 0 | 13 |
| design/billing-redesign | 47 | 1 | 0 | 0 | 0 | 46 |
| rationale | 15 | 15 | 0 | 0 | 0 | 0 |
| decisions | 69 | 69（一括、ADR 棚卸へ委譲） | 0 | 0 | 0 | 0 |
| sessions | 16 | 16 | 0 | 0 | 0 | 0 |
| runbooks | 12 | 10 | 0 | 1 | 0 | 1 |
| operations | 11 | 6 | 0 | 2 | 0 | 3 |
| troubleshoot | 2 | 2 | 0 | 0 | 0 | 0 |
| reference | 16 | 2 | 0 | 9 | 2 | 3 |
| security | 2 | 1 | 0 | 1 | 0 | 0 |
| guides | 9 | 1 | 0 | 0 | 0 | 8 |
| inquiry | 2 | 0 | 0 | 2 | 0 | 0 |
| marketing | 2 | 0 | 0 | 0 | 0 | 2 |
| retrospectives | 2 | 0 | 0 | 2 | 0 | 0 |
| **合計** | **322** | **201** | **0** | **29** | **2** | **90** |

B（file 単位の narrative 誤層）は 0 件 — narrative 混入は inline（設計書本文への経緯メタ混入）が主形態であり、#2440 確定計画の整形 PR 群が SSOT。本棚卸では扱わない。

## 4. per-file 一覧

凡例: 「被参照」列は自ファイル除外の外部参照元（機械 grep 結果の要約）。日付は最終 commit 日。

### 4.1 docs/research/（17）

| file | 最終更新 | 被参照 | 分類 | 根拠 |
|---|---|---|---|---|
| 2026-05-22-import-hub-ux-redesign.md | 2026-05-23 | v2 のみ（相互） | C | v2 に supersede。結論（marketplace 一本化）は DESIGN.md §10 / #2558 に内包済 |
| 2026-05-22-import-hub-ux-redesign-v2.md | 2026-05-23 | 0 | C | 同上。実装完遂済（#2558 / #2903 / #2998） |
| 2026-06-04-docs-inventory-audit.md | 2026-06-04 | docs/CLAUDE.md（基準書指定） | A | #2440 整形計画の基準書 SSOT |
| 2026-06-11-audit-infra-gap-list.md | 2026-06-18 | scripts/audit/generate-api-coverage-map.mjs | A | 稼働 tooling が参照 |
| 2026-06-27-backup-import-coverage-audit.md | 2026-06-27 | design/backup-import-redesign.md | A | 現行設計書が調査根拠として参照 |
| 2026-06-28-aurora-dsql-adoption.md | 2026-07-09 | 6 件（ADR-0063 の PoC SSOT 等） | A | active ADR の research SSOT |
| 2026-06-29-followup-treadmill-root-cause.md | 2026-06-29 | scripts/check-ac-verification-map.mjs | A | 稼働 gate script が参照 |
| 2097-legacy-demo-routes-inventory.md | 2026-05-17 | 0 | C | EPIC #2097 完遂済（demo routes 全削除完了）の作業 inventory |
| 2097-multi-lambda-demo-evidence-based-architecture.md | 2026-05-15 | ADR-0048 / 14-セキュリティ設計書 | A | active ADR-0048 の根拠 SSOT |
| 2097-multi-lambda-detailed-system-design.md | 2026-05-15 | 死蔵候補同士の相互のみ | C | 外部被参照 0。設計結論は ADR-0048 + merged 版に内包 |
| 2097-multi-lambda-merged-system-design.md | 2026-05-15 | ADR-0048 | A | active ADR-0048 が参照 |
| 2097-multi-lambda-oop-solid-uml-design.md | 2026-05-15 | 死蔵候補同士の相互のみ | C | 同 detailed 版。削除時は merged 版内の link 整理を同時実施 |
| 2173-parent-report-completion-audit.md | 2026-05-18 | 0 | C | 完了度監査 one-off、被参照 0 |
| 2278-retention-audit-result.md | 2026-05-19 | ADR-0049 / 19-プライシング戦略書 | A | active ADR-0049 の根拠 |
| 2353-pin-gate-redesign.md | 2026-05-21 | 0 | C | 決定は ADR-0050（accepted）が SSOT。被参照 0 |
| dsql-poc-phase1-results-2026-07-05.md | 2026-07-09 | 10 件 | A | 進行中 EPIC #3424 の PoC 結果 SSOT |
| qm-drift-prevention-2026-05-28.md | 2026-05-28 | ADR-0056 の Research SSOT 等 6 件 | A | active ADR-0056 が参照 |

### 4.2 docs/design/ top-level（82）

**A: SSOT 残置（63）** — 連番設計書シリーズ 45 file（01〜44、43 を除く）+ 機能設計書 18 file（`_template` / account-deletion-flow / admin-ia / asset-catalog / async-backup-export / backup-import-redesign / data-model-resource-scope / dsql-data-model / family-group-management / guide-copy-rules / lp-content-map / lp-deploy-pipeline / marketplace-architecture / marketplace-import-flow / marketplace-overhaul-spec / nuc-saas-runtime-bifurcation / parallel-implementations / plan-change-flow）。

うち **鮮度要確認（被参照 0 + 60 日以上未更新、A 残置のまま月 1 棚卸で確認推奨）**: 02-要求仕様書（2026-02-19）/ 17b-ログ設計書（2026-04-10）/ 18-個人開発SaaS展開ガイド / 20-リリース判定・運用手順書 / 27-監視オブザーバビリティ設計書（2026-04-13）/ 28-エラーハンドリング設計書（2026-04-09）/ 31-Cookieポリシー / 32-SLI-SLO定義書 / 36-OSSライセンスコンプライアンス / 41-依存関係管理方針（各 2026-04-10）/ 42-獲得戦略書（2026-04-28）。

**C: 死蔵（5）**:

| file | 最終更新 | 被参照 | 根拠 |
|---|---|---|---|
| accessibility-audit-2026-03.md | 2026-03-28 | 0 | dated 監査 one-off。現行 a11y gate は @axe-core/playwright（CX-DoR #10）が SSOT |
| license-key-competitor-analysis.md | 2026-06-04 | 2（stale 同士） | license key 全廃済（#2813 / ADR-0060 項目 10 で deprecation header 付与済） |
| license-key-lifecycle.md | 2026-06-04 | 5（stale 同士 + link 節） | 同上 |
| license-key-requirements.md | 2026-06-04 | 10（同上） | 同上 |
| license-subscription-causality.md | 2026-06-04 | 14（同上） | 同上。削除 PR は参照元設計書（07-API / 08-DB / 19-pricing 等）の link 節更新を同時実施 |

**E: 要 PO 判断（14）**:

| file | 最終更新 | 被参照 | 判断論点 |
|---|---|---|---|
| 43-ユーザーオンボーディング監査.md | 2026-05-19 | 0 | dated 監査 one-off だが連番シリーズ内。削除 or 連番から外して research 移動 |
| admin-home-tab.md | 2026-04-26 | 1 | admin-ia.md に統合済か要確認 |
| competitive_analysis.md | 2026-02-19 | 1 | 5 ヶ月未更新。competitive-research skill（週次）が後継か |
| dsql-implementation-plan.md | 2026-07-01 | 0 | dsql/m4-implementation-plan.md に supersede 疑い（EPIC #3424 進行中のため Dev 確認） |
| family-discipline-research.md | 2026-04-20 | 1 | 調査系。research 層相当（移動）か役目完了（削除）か |
| gender-segmentation-market-research.md | 2026-04-20 | 3 | 同上（archive ADR-0042 マーケット性別バリアント方針の根拠） |
| marketplace-competitor-analysis.md | 2026-04-21 | 5 | 調査系だが marketplace 系設計書が参照。残置 or research 移動 |
| marketplace-content-audit.md | 2026-04-20 | 5 | preset カタログの根拠 SSOT として残置か、監査 one-off として削除か |
| marketplace-naming-recommendation.md | 2026-04-20 | 3 | archive ADR-0041 の根拠。残置 or 削除 |
| marketplace-persona-research.md | 2026-04-10 | 3 | 調査系。research 層相当 |
| marketplace-preset-activity-audit.md | 2026-04-20 | 5 | preset 実数（LP 訴求 ≥300 の根拠）に関わる可能性。残置判断あり |
| marketplace-preset-checklist-audit.md | 2026-05-01 | 2 | 同上 |
| marketplace-preset-reward-audit.md | 2026-04-21 | 2 | 同上 |
| plan-features-audit.md | 2026-05-19 | 4 | プラン機能監査。19-プライシング戦略書に内包済か要確認 |

### 4.3 docs/design/dsql/（18）

| file 群 | 分類 | 根拠 |
|---|---|---|
| detailed-design-process.md / m1-conceptual-model.md / m2-logical-model.md / m3-physical-model.md / m4-implementation-plan.md（5） | A | 進行中 EPIC #3424 の設計 SSOT（被参照 5〜13） |
| m1-review-round1〜6 / m2-review-round1〜3 / m3-review-round1〜3 / m4-review-round1 の各 ledger（13） | E | レビュー往復の process artifact（被参照 0〜1）。EPIC 進行中は証跡として残置、**EPIC #3424 完了時に一括削除**を段階 PR 計画に予約（PO 確認事項: 完了時削除で良いか） |

### 4.4 docs/design/billing-redesign/（47）

| file 群 | 分類 | 根拠 |
|---|---|---|
| phase1-license-key-removal-final-requirements.md（1） | A | ADR-0060 の「10 項目 SSOT」として被参照（active ADR 参照） |
| 残り 46 file | E | EPIC #2514 / #2525 帰属の process artifact。#2440 で PO 判断 Q1 により scope 除外された経緯があり、EPIC close 済の現在も**一括削除は PO 判断必須**（billing 領域の監査証跡価値）。判断後は 1 PR ≤50 file で消化可能 |

### 4.5 docs/rationale/（15）— 全件 A

rationale 層は「検討 narrative の正当な置き場」であり全 15 file 残置。補足: `2510-activities-data-recovery-rationale.md`（被参照 0）は命名規約（`NN-機能名-rationale.md`）外の Issue 番号命名 — 実害小のため A 残置、次回改訂時に rename 推奨。

### 4.6 docs/decisions/（69）— dir 一括 A（ADR 月 1 棚卸へ委譲）

README.md（inventory SSOT）+ active 43 + archive 26 ほか。per-ADR の volume 超過 / archive 削除判断は既存の月 1 棚卸プロセス（docs/CLAUDE.md §ADR 月 1 棚卸）が専用 SSOT のため、本棚卸で二重分類しない。

### 4.7 docs/sessions/（16）— 全件 A

po/dev/qm-session / audit-team / branch-strategy / webui-review-process / dev-process/* 等、全てロール定義・プロセス SSOT（被参照 1〜49）。

### 4.8 docs/runbooks/（12）

| file | 最終更新 | 被参照 | 分類 | 根拠 |
|---|---|---|---|---|
| cognito-pool-migration.md | 2026-06-04 | 0 | C | 完了済一回限り migration（同種の ADR-0018 / 0021 は #2440 で削除済み）。runbook として再実行の可能性なし |
| push-subscription-role-migration.md | 2026-06-04 | 08-DB / 14-セキュリティ設計書 | E | 完了済 migration なら削除 + 参照 2 件更新（完了状態の機械判定不能） |
| 上記以外の 10 file | — | — | A | 運用 runbook は繰り返し参照が本務（被参照 0 でも残置。account-deletion-email-automation / activities-data-recovery / cron-3-endpoints-verification / integration-pr-operations / lp-visual-regression-baseline / nuc-container-recovery / nuc-pglite-cutover / nuc-to-web-migration / operator-pin-reset / staging-gate-required-checks） |

### 4.9 docs/operations/（11）

| file | 最終更新 | 被参照 | 分類 | 根拠 |
|---|---|---|---|---|
| runbook.md / notification-runbook.md / self-review-agent.md / sla.md / stripe-dashboard-runbook.md / stripe-post-mortem-runbook.md（6） | 2026-05〜06 | 2〜12 | A | 現行運用 SSOT |
| license-hmac-migration-plan.md | 2026-06-04 | 2（stale 同士） | C | license key 全廃済、deprecation header 付与済（§4.2 の license-key 4 file と同一クラスタで削除） |
| orphan-audit-2026-05-26.md | 2026-05-27 | 0 | C | dated 監査 one-off |
| license-key-secrets.md | 2026-06-04 | 6 | E | license key 全廃済だが AWS 側 secrets の残存 cleanup 状態が機械判定不能 |
| pin-auth-legacy-migration-plan.md | 2026-06-11 | 14-セキュリティ設計書 | E | migration 完了状態の確認要（完了済なら削除 + 参照更新） |
| biome-ignore-refactor-umbrella.md | 2026-06-04 | 0 | E | umbrella 計画の消化状態が機械判定不能 |

### 4.10 docs/troubleshoot/（2）— 全件 A

github_actions.md（被参照 5）/ screenshot_capture.md（被参照 8）。KB として現役。

### 4.11 docs/reference/（16）

| file | 最終更新 | 被参照 | 分類 | 根拠 |
|---|---|---|---|---|
| deep-research-request-methodology.md | 2026-06-04 | 8 | A | 現役方法論 SSOT |
| gemini_image_generation_guide.md | 2026-04-25 | 7 | A | 画像生成 SSOT（CLAUDE.md 参照） |
| 01-research-issue-templating-and-doc-consolidation.md | 2026-06-04 | .github/ISSUE_TEMPLATE 2 件 | D | 内容は調査（`research` 命名）。**移動先: docs/research/**。参照 2 件更新を同一 PR で完結 |
| 07-research-child-collapsible-prior-art.md | 2026-05-18 | 06-UI設計書 | D | 同上。**移動先: docs/research/**。参照 1 件更新 |
| 02-research-lp-purchase-cancellation-flow.md | 2026-05-18 | 0 | C | 完了済 UX 調査 one-off（reference 層への誤配置かつ死蔵） |
| 03-research-dialog-management-refactor.md | 2026-05-19 | 0 | C | 同上（dialog FSM は archive ADR-0019 が決定 record） |
| 05-research-push-notification-ux.md | 2026-05-18 | 0 | C | 同上 |
| 06-research-marketplace-completion.md + 06b（2） | 2026-05-18 | 相互のみ | C | pair 単位で死蔵（実装完遂済 marketplace 系） |
| 08-research-reward-shop-ux-modernization.md + 08b（2） | 2026-05-18 | 相互のみ | C | 同上 |
| 09-research-child-achievement-notification-ux.md + 09b（2） | 2026-05-18 | 相互のみ | C | 同上 |
| activity-expansion-guide.md | 2026-02-27 | 0 | E | 4.5 ヶ月未更新。preset 拡充ガイドの現行性が機械判定不能 |
| child-psychology-ux-research.md | 2026-03-28 | 0 | E | 設計背景資料としての残置価値の判断要 |
| color-mapping.md | 2026-04-05 | 0 | E | DESIGN.md §2 の 3 層トークンに supersede 疑い |

**欠落 finding**: `CLAUDE.md` L106 が `docs/reference/ui_framwork.md` / `docs/reference/backend_framework.md` を参照しているが**実ファイルが存在しない**（broken pointer）。codebase-map.md §3 も同名を記載。段階 PR（配置規律クラスタ）で CLAUDE.md / codebase-map.md の該当行修正が必要。

### 4.12 docs/security/（2）

| file | 最終更新 | 被参照 | 分類 | 根拠 |
|---|---|---|---|---|
| scan.md | 2026-04-21 | scripts/security-scan.mjs | A | 稼働 script が参照 |
| security-code-review-2026-03.md | 2026-04-16 | 0 | C | dated レビュー one-off（指摘は 14-セキュリティ設計書 / 実装に反映済） |

### 4.13 docs/guides/（9）

| file | 最終更新 | 被参照 | 分類 | 判断論点 |
|---|---|---|---|---|
| stripe-setup-guide.md | 2026-04-04 | billing-redesign 3 件 | A | 被参照あり |
| discord-setup-guide.md / gemini-claude-integration.md / github-pages-custom-domain-guide.md / ses-production-access.md（4） | 2026-03〜04 | 0 | E | 一回限り setup 手順。setup 完了済（Discord 稼働 / Pages 稼働 / SES 送信稼働）なら削除可だが、再構築時の再利用価値は PO 判断 |
| github-sponsors-1〜4（4） | 2026-04 | 相互 1〜2 | E | GitHub Sponsors 継続有無が PO 判断（放棄済なら 4 file 一括削除） |

### 4.14 docs/inquiry/（2）— 全件 C

`0064-lambda-web-adapter-issue.md` + `-repley.md`（2026-03-17、被参照 0）。AWS Lambda Web Adapter への外部問い合わせ記録 one-off。解決済・4 ヶ月弱未参照。dir ごと削除可。

### 4.15 docs/marketing/（2）— 全件 E

press-release.md（2026-04-11）/ product-hunt.md（2026-04-21）、被参照 0。Pre-PMF 販促 draft — 投稿予定の有無は PO 判断（放棄なら削除、実施予定なら残置）。

### 4.16 docs/retrospectives/（2）— 全件 C

2026-05-28-pr-body-checks-strengthened.md / 2026-05-28-rebase-drift-5-cases.md（被参照 0）。教訓は ADR-0056 §D〜F + pre-push hook（#2598）+ check-pr-body 強化（#2576 系）として機械化済。retrospective 記録の本来の置き場は git / rationale（`_template-claude-code-retrospective.md`）であり、dir ごと削除可（今後の retrospective 新規配置は禁止）。

## 5. 是正の段階 PR 計画（AC2、#2225 / #2440 粒度 3 条件準拠）

各 PR は「単一種別の操作のみ / 純削除 ≤800 行 / 機械検証可能」を満たす。**C 分類のみ削除対象**とし、E は PO 判断後に追補する。

| segment | 内容 | file 数 | 種別 |
|---|---|---|---|
| **PR-1** | research 死蔵 7 + retrospectives 2 + inquiry 2 の純削除。research/2097-multi-lambda-merged-system-design.md 内の削除対象への link 2 箇所を同時整理 | 11 削除 + 1 修正 | 純削除 |
| **PR-2a** | reference 死蔵 9（02 / 03 / 05 / 06+06b / 08+08b / 09+09b）の純削除 | 9 削除 | 純削除 |
| **PR-2b** | reference 誤配置 2（01 / 07）の `docs/research/` への git mv + 参照 3 件（ISSUE_TEMPLATE 2 + 06-UI設計書 1）更新 + CLAUDE.md / codebase-map.md の broken pointer（ui_framwork / backend_framework）修正 | 2 移動 + 4 修正 | 移動 + 参照更新 |
| **PR-3** | license-key 死蔵クラスタ 5（design 4 + operations/license-hmac-migration-plan）の純削除 + 参照元設計書（07-API / 08-DB / 19-pricing / license 系 link 節等）の参照更新 | 5 削除 + ~8 修正 | 純削除 + 参照更新 |
| **PR-4** | 監査 one-off 死蔵 4（design/accessibility-audit-2026-03 + security/security-code-review-2026-03 + runbooks/cognito-pool-migration + operations/orphan-audit-2026-05-26）の純削除 | 4 削除 | 純削除 |
| **PR-5 以降（PO 判断後）** | E 90 file の消化: (a) billing-redesign 46（監査証跡価値の判断）、(b) dsql review ledger 13（EPIC #3424 完了時に一括削除）、(c) design 調査系 14（research 移動 or 削除 or 残置の個別判断）、(d) guides 8 / marketing 2 / operations 3 / runbooks 1 / reference 3 | 最大 90 | PO 判断後に種別ごと分割 |

再混入防止 gate は #2440 確定方針どおり `check-internal-terms.mjs` の config 駆動化 + #2668 baseline-utils 相乗りで扱う想定だったが、**`check-internal-terms.mjs` は #4322 で削除済み（#4426）**。専用 script を新設しない方針自体は維持し、gate 再設計は #2668 着手時に判断する。
