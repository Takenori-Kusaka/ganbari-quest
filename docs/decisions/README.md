# Architecture Decision Records (ADR)

本ディレクトリは、がんばりクエストの重要な技術決定・設計判断を記録する。

## ADR テンプレート

```markdown
# NNNN. タイトル

| 項目 | 内容 |
|------|------|
| ステータス | proposed / accepted / deprecated / superseded |
| 日付 | YYYY-MM-DD |
| 起票者 | 名前 |
| 関連 Issue | #番号 |

## コンテキスト

なぜこの決定が必要だったのか。

## 検討した選択肢（OSS / 確立パターン最低 2 件必須 — #1350）

技術選定・機構設計を伴う ADR では、**独自実装する前に OSS / 確立パターンを最低 2 件調査**し、
その比較を本節に残すこと。「世間が使っているものを見もしないまま独自実装」を構造的に防ぐ。

### 選択肢 A: ○○（OSS / 既存パターン）
- 概要: npm パッケージ名 / 参照 URL / 採用実績
- メリット: ...
- デメリット: ...
- Pre-PMF コスト: 導入工数 / 学習コスト / bundle size / 長期保守性（ADR-0010）

### 選択肢 B: ○○（OSS / 既存パターン）
- 概要: ...
- メリット: ...
- デメリット: ...
- Pre-PMF コスト: ...

### 選択肢 C: 独自実装
- 概要: ...
- メリット: ...
- デメリット: OSS 選定比較で落ちる場合は必ず「なぜ独自が必要か」を明記

## 決定

何を選び、なぜ選んだか。独自実装を選ぶ場合は A/B を退けた具体的理由を記載すること。

## 結果

この決定により何が変わるか。トレードオフは何か。
```

### OSS 先調査ルール (#1350)

ADR / 実装 Issue を起票する前に、以下の順で調査:

1. **npm / GitHub で既存 OSS を 2 件以上探す** — 採用実績 (stars / downloads) / 最終コミット / ライセンス / bundle size
2. **確立パターン (GoF / DDD / Repository 等) の該当有無を確認**
3. **見つからない場合は「探した範囲」を ADR 本文に明記** — どのキーワードで探したか、なぜ該当がなかったか
4. **独自実装が 10 行超えそうなら、先に OSS を探す** (Dev セッション agent ルール)

この節を埋めない新規 ADR / 実装 Issue は PR レビューで `[must]` 指摘となる。
ADR-0010 (Pre-PMF scope 判断) と併せて、OSS 導入コストが Pre-PMF 段階で過剰な場合の判断基準も
参照すること。

### OSS 採用記録 (本リポジトリ採用済み、#1350 整合)

10 行超の独自実装の代替として OSS / 確立パターンを採用した事例。新規採用時は本表に 1 行追記し、選定根拠 ADR / Issue を残す。

| 領域 | 採用 OSS | 採用 PR / Issue | 採用根拠 |
|------|---------|----------------|---------|
| LP テキスト折り返し (日本語) | BudouX (CDN Web Component) | #584 / #1353 (旧 ADR-0016、git 履歴。運用ルール: docs/DESIGN.md §3) | OS-non-dependent + 0 KB (CDN)。tiny-segmenter (切れすぎ) / kuromoji.js (辞書 17MB) / mecab (WASM 複雑) は不採用 |
| LP SSOT 注入 (XSS 設計) | DOMPurify | ADR-0025 / #1683 | innerHTML 経路の XSS 防御、業界標準 |
| Parent-Gate session cookie 署名 | cookie-signature | ADR-0050 / #2310 | HMAC-SHA256 検証、4 OSS 比較 |
| **Marketplace schema validation (5 type SSOT)** | **Valibot + @standard-schema/spec** | **#2362 EPIC / #2364** | **bundle 92% 削減 (vs Zod v3)、Standard Schema spec で将来 Zod/ArkType 切替自由度** |
| **E2E Accessibility audit (WCAG 2.2 AA、CX-DoR #10)** | **@axe-core/playwright** | **Round 18 PR-A11Y-2 (A-5)** | **Deque 公式 (axe-core 同元)、Playwright `Page` を直接受ける AxeBuilder で inline inject 不要。dev dependency のみ (本番 bundle 0、ADR-0010)。既存 axe-runner.mjs の inline inject は Stagehand v3 専用回避策のため通常 E2E では本 OSS を採用** |
| **ページガイド positioning (collision-aware + spotlight)** | **driver.js (MIT)** | **#2926 (EPIC #2925 Sub-1)** | **side/align 宣言 + viewport 自動調整 + scroll-into-view + backdrop cutout (spotlight) を標準装備。手動 positioning (PageGuideOverlay 独自の targetRect 計測 / 固定クランプ / 自前 SVG spotlight) を撤去し本来機能に委譲。intro.js / shepherd.js は AGPL or 商用で商用 SaaS 不適、floating-ui は positioning のみ (spotlight + scroll は別実装) のため driver.js を採用 (research SSOT: `tmp/research-page-guide-redesign-2026-06-05.md` §3)。PR #2387 で callsite 0 を理由に一旦撤去 → #2930 で PageGuideOverlay の手動 positioning を実委譲し再採用 (Issue #2406 の「Driver.js 不使用」前提を supersede)** |
| **DSQL pg integration test 基盤 (fitness#8 部分コミット再現)** | **@electric-sql/pglite (Apache-2.0)** | **#3531 (#N1-1、EPIC #3424)** | **WASM Postgres で Docker 不要 (Windows dev + CI 直動)、drizzle 公式 driver あり。dev dependency のみ (本番 bundle 0、ADR-0010)。testcontainers (実 pg) と比較: Docker 常設要 + DSQL 固有 OCC 40001 は実 pg でも再現不能で優位性薄。単一接続制約 (tx 内 await deadlock) は test 側 fire→settle パターンで回避 (issue #3531 記録)** |
| **CW Logs → S3 log archiving (IaC)** | **aws-cdk-lib GA L2 `aws-kinesisfirehose` (DeliveryStream) + `aws-logs-destinations` (FirehoseDestination)** | **#3939 (#3909 調査 (a))** | **追加依存ゼロ (aws-cdk-lib 同梱)。L1 CfnDeliveryStream + 手動 IAM role 2 本 + CfnSubscriptionFilter (~60 行) → L2 ~20 行、delivery/subscription role は L2 が最小権限で自動生成。community construct は該当なし (#3909 AC2 評価)** |
| コードベース探索性 (knowledge graph 化) | [Graphify](https://github.com/Graphify-Labs/graphify) (Apache-2.0) | #4343 (#4291) | ローカル AST 解析のみで増分更新でき LLM トークンを消費しない。`graphify-out/` を git 追跡することで、新しい clone / セッションがチェックアウト直後から構造を引ける (コールドスタート解消)。**制約**: `.svelte` は symbol 抽出が浅く、250 file が 492 node (2.0 node/file) — `.ts` の 6.6 node/file に対し粗い。UI 層の探索は `docs/codebase-map.md` + grep を主経路のままとする |

各採用 OSS の詳細根拠は対応する ADR / 設計書 (`docs/design/*-architecture.md`) を参照。本表は採用済み OSS の「インデックス」として機能し、新規実装者が `npm install` 前にまず参照する SSOT。

### OSS 調査済み・不採用記録 (#1350 整合)

調査したが採用しなかった OSS の**薄いインデックス**。同じ候補の再調査ループを断つことが目的。再評価トリガを満たした場合のみ再検討する。

| 領域 | 調査 OSS | 調査日 | 結論 (1 行) | 再評価トリガ | 不在の証明 | 詳細 |
|------|---------|-------|------------|------------|-----------|------|
| (現在 0 件) | | | | | | |

**記録する基準**: 10 行超の独自実装 / 既存機構の置換候補として**実測評価した**もののみ。カタログを見て軽く外したものは記録しない (記録の価値 = 再調査コストの回避であり、再調査が安いものは対象外)。

**「不在の証明」列 (#4395)**: 「これがリポジトリに存在したら不採用は嘘」と言えるパスを、バッククォートで囲んで書く (`graphify-out/` / `node_modules/<pkg>` 等)。`tests/unit/architecture/oss-rejection-record-falsifiable.test.ts` が全行のパスを検査し、**存在したら fail** する。不採用のまま採用された場合に表が「未採用」と誤答し続けるのを防ぐための、削除トリガ (a) の機械化である。**不在を機械で言えない候補は本表に載せない** — 採用の有無を後から判定できず、記録が腐っても誰も気づけないため。

**書き方**: 本表は 1 行 = 1 候補のインデックスに保つ。実測値・棄却理由・確度 (実測か推測か) は `docs/rationale/` 側に置く (`docs/CLAUDE.md` §docs SSOT 原則「棄却案比較 → `docs/rationale/`」整合)。

**削除トリガ**: (a) 再評価トリガを満たして再検討が完了した行 (採用したなら §OSS 採用記録 へ移し、再度不採用なら結論と調査日を更新する) / (b) 対象 OSS が廃止・アーカイブされた行。いずれも削除し、履歴は git で追跡する。

**§ボリューム上限ルールとの関係**: 同ルールの削除主義が挙げる「採択されなかった調査」は、**再評価トリガが生きている間は役目を終えた record ではない**ため本表は削除対象外とする。上記削除トリガを満たした時点で通常の削除主義に戻る。

## ボリューム上限ルール（削除主義、#2440 PR-A5 改定）

ADR を現場の常時参照ルールとして機能させるため、以下の上限を設ける。

| 項目 | 上限 | 根拠 |
|------|------|------|
| 分類 A（毎週レベルで参照される常時参照ルール / gate）active ADR 総数 | **≤ 10 件を目安** | Miller's Law (7±2) の認知限界。毎週以上参照するルールとして記憶し得る現実的上限 |
| per-ADR 本文 | ≤ 150 行 | 5 分以内に通読可能な分量 |
| per-ADR 章立て | ≤ 7 セクション | コンテキスト / 選択肢 / 決定 / 結果 + 固有セクション ≤ 3 |

**運用原則（削除主義）**: 役目を終えた record — 完了済 migration / 採択されなかった調査 / 完遂済の一回限りの決定記録 — は **archive ではなく削除する**（履歴は git で追跡する）。常時参照ルール / gate ではないが「現状の正解」を端的に記述している ADR（横断ポリシー・supersede 記録・技術選定根拠など）は active に残す。

超過時の運用:

- per-ADR が 150 行を超える場合、補助ドキュメント（`docs/design/*.md`）に詳細を分離
- 章立てが 7 を超える場合、統合またはサブセクション化

上限数値は暫定値。月 1 棚卸（`docs/CLAUDE.md` §ADR 月 1 棚卸）で見直し可能。

未消化の上限超過（per-ADR 150 行超過の 0056 / 0049 / 0010 の分離、DSQL 系 0063 / 0064 / 0065 の統合可否）は月 1 棚卸で判断する。

## 新規 ADR 追加 gate

以下のいずれかを満たさない限り、新規 ADR を起票しない。

1. **機械強制できない判断原則** — 定性的方針で CI / lint / テンプレで表現できないもの
2. **後から改訂時に背景理解が必須な決定** — 技術選定根拠・トレードオフ記録等
3. **既存 ADR と矛盾する新判断** — supersede 必須

上記いずれでもなければ、以下に配置する:

- CI / lint / workflow（`.github/workflows/*`, `scripts/*`）
- Issue / PR テンプレート（`.github/ISSUE_TEMPLATE/*`, `PULL_REQUEST_TEMPLATE.md`）
- CLAUDE.md（ルート / `docs/` / `src/` / `tests/` / `.github/` / `infra/`）

## 10 枠超過時の義務（削除主義、#2440 PR-A5 改定）

- 10 枠が埋まっている状態で新規追加する場合、役目を終えた既存 1 件以上を **削除**（git 履歴で追跡）または supersede することを同 PR 内で必須とする（旧 1-in-1-out の「archive 送り」は削除主義に置換）
- 同梱なしの PR は CI で自動 fail させる（CI 実装は follow-up で別 Issue 化）
- 該当する既存 ADR が見つからない場合、新規 ADR 起票自体を取り下げる

## archive 運用ルール（削除主義への移行、#2440 PR-A5）

> **新規の archive 移動は行わない**（役目を終えた record は archive ではなく削除する。§ボリューム上限ルール）。

`docs/decisions/archive/` は過去に退避された ADR の保管先（移行期の残存）。再活性化が必要になった場合は git 履歴または archive 配下から直下に戻す。新規退避は行わないため、以下の旧 archive 運用は残存 6 件の参照・再活性化時のみ適用する:

- **再活性化**: archive から直下に戻す際は、同 PR 内で active から役目を終えた 1 件を削除する
- **完全削除判断**: archive 内でも以下に該当すれば削除可（月 1 棚卸で判断）
  - 既に別 ADR で内容が完全カバーされている
  - 対象コード / プロセスが廃止済みで再活性化の可能性ゼロ

## renumber 規約

原則: **ADR 番号は不変ではない**。Pre-PMF 個人開発段階では renumber コスト < 認知負荷コスト であり、統合・整理のたびに番号を振り直して構わない。ただし混乱を避けるため以下手順を守る。

- **1:1 renumber**: `git mv OLD-*.md NEW-*.md` で履歴継承、フロントマター内の番号更新
- **N:1 統合**: 新番号で新規作成、旧ファイルは `git rm`（内容は新 ADR の「コンテキスト」セクションに統合元として記載）
- **renumber PR** は 1 つに集約（分割厳禁）、参照更新（CLAUDE.md / copilot-instructions / docs/design 等）を同時または直後の別 PR で行う
- **過去 PR / コミット本文** の ADR 番号参照は更新しない（git 履歴として保全）

## 命名規則

- ファイル名: `NNNN-kebab-case-title.md`
- 番号は 0001 から連番（欠番は renumber 時に詰める）
- active は `docs/decisions/` 直下、archive は `docs/decisions/archive/` に配置
- ステータスが `superseded` / `archived` になったファイルも、明示的削除判断がない限り git 履歴として残す

## 一覧（TOP 10 active）

> 本表は active ADR の SSOT（表 vs 実ファイルが一致することを月 1 棚卸で照合する）。番号は欠番を許容し、**削除済み ADR の番号は再利用しない**。新規 ADR は最大番号 +1 で採番する（renumber 手順は §renumber 規約）。

| # | タイトル | ステータス | 日付 |
|---|--------|----------|------|
| 0001 | [設計書は Single Source of Truth](0001-design-doc-as-source-of-truth.md) | accepted | 2026-04-20 |
| 0002 | [Critical 修正の品質ゲート](0002-critical-fix-quality-gate.md) | accepted | 2026-04-20 |
| 0003 | [Issue 起票・クローズ品質（根本原因 + 構造的解決）](0003-issue-quality-standard.md) | **accepted (2026-05-07 §4 内部 refactor exempt 追記、#1985 / #1986)** | 2026-04-20 |
| 0004 | [レビュー & AC 検証品質](0004-review-and-ac-verification.md) | accepted | 2026-04-20 |
| 0005 | [テスト品質 ratchet](0005-test-quality-ratchet.md) | accepted | 2026-04-20 |
| 0006 | [Safety Assertion Erosion Ban](0006-safety-assertion-erosion-ban.md) | accepted | 2026-04-20 |
| 0007 | [静的解析 tier ポリシー (T1/T2/T3/T4)](0007-static-analysis-tier-policy.md) | accepted (2026-07-19 §7 dependency-cruiser required 昇格 ratify、#3895) | 2026-04-20 |
| 0008 | [設計ポリシー先行確認フロー](0008-design-policy-pre-approval.md) | accepted | 2026-04-20 |
| 0010 | [Pre-PMF スコープ判断（3 バケット + セキュリティ最小化 + 優先度）](0010-pre-pmf-scope-judgment.md) | accepted | 2026-04-20 |
| 0011 | [0-2 歳 baby モードは「親の準備モード」](0011-baby-mode-as-parent-preparation.md) | accepted | 2026-04-21 |
| 0012 | [Anti-engagement 原則（滞在時間 = 価値毀損）](0012-anti-engagement-principle.md) | accepted | 2026-04-21 |
| 0013 | [LP 文言は実装の事実を SSOT とする](0013-lp-truth-from-implementation.md) | accepted | 2026-04-21 |
| 0019 | [CDK Replacement 検知を deploy 前必須ゲートとして組み込む](0019-cdk-replacement-detection-gate.md) | accepted | 2026-04-24 |
| 0022 | [admin bypass 禁止と ganbariquestsupport-lab QM Approve 体制の確立](0022-admin-bypass-disable-qm-approve.md) | accepted (2026-06-04 amendment 4: lab merge 2 role 区別 + 統合 PR 作成者ルール、#2863) | 2026-04-25 |
| 0024 | [インフラ PR 必須要件 — ENV silent skip 禁止 + secrets validation + post-deploy smoke test + alarm](0024-infra-pr-required-baseline.md) | accepted | 2026-04-27 |
| 0025 | [LP SSOT 注入機構の innerHTML 化 + XSS 設計（DOMPurify）](0025-lp-ssot-html-injection-with-xss-protection.md) | **accepted (2026-04-30, #1683 完遂 + #1704)** | 2026-04-29 |
| 0026 | [致命修正コミットの force push による消失防止](0026-force-push-protection.md) | accepted | 2026-04-30 |
| 0029 | [LP CSP and CDN SRI Strategy](0029-lp-csp-and-cdn-sri-strategy.md) | **accepted (2026-05-01、2026-05-14 connect-src amendment #2068)** | 2026-05-01 |
| 0030 | [`npm run pre-ready` CLI 採用と pre-push hook 非採用](0030-pre-ready-cli-and-no-pre-push-hook.md) | accepted (2026-05-27 stale-context 補追) | 2026-05-01 |
| 0042 | [LP CSS Spacing/Layout 3 層トークン化 (Base → Semantic → Component SSOT)](0042-lp-spacing-layout-tokens.md) | accepted | 2026-05-02 |
| 0045 | [terms.ts SSOT 2 階層化原則 (atom / compound 責務分離)](0045-terms-ssot-2-layer.md) | accepted | 2026-05-07 |
| 0048 | [Multi-Lambda Demo Deployment (env 駆動 + IAM role 分離 + client-side state)](0048-multi-lambda-demo-deployment.md) | accepted (2026-07-19 棚卸で旧 ADR-0046 / 0047 の決定核を §統合 に吸収) | 2026-05-15 |
| 0049 | [プラン別履歴保持期間ポリシー — 物理削除対象テーブル拡張 (旧 ADR-0028 un-archived + 拡張)](0049-retention-physical-delete-extended.md) | accepted (un-archived 2026-05-19) | 2026-04-11 (initial) / 2026-05-19 (拡張) |
| 0050 | [Parent-Gate Session Cookie 署名方式: cookie-signature (OSS 4 件比較)](0050-parent-gate-session-cookie-signature.md) | accepted (2026-06-17 §7 改訂: federated PIN reset を email-OTP 化、#3070) | 2026-05-20 |
| 0052 | [MarketplaceTypeRegistry + ImportStrategy パターンによる 5 type 統一抽象化](0052-marketplace-type-registry.md) | accepted | 2026-05-21 |
| 0053 | [LP visual regression: pixelmatch (OSS 6 件比較)](0053-lp-visual-regression-pixelmatch.md) | accepted | 2026-05-23 |
| 0055 | [Per-child 主軸 + 限定 family master データモデル原則 (6 type SSOT)](0055-per-child-primary-data-model-pattern.md) | accepted | 2026-05-23 |
| 0056 | [QM Orchestrator role drift の構造的対処 (Adversarial Reviewer + PreToolUse Hook + JSON Schema 強制)](0056-qm-drift-prevention-by-structural-agent-constraint.md) | accepted | 2026-05-28 |
| 0060 | [「全対応完了」宣言の 10 項目検証義務 (チケット close ≠ 完了、DoD checklist + CI gate 併用)](0060-completion-definition-10-item-verification.md) | accepted | 2026-06-04 |
| 0061 | [band-aid サイクル打破 + shift-left の機械強制 (failing-test-first / same-class-N→guard / push-down-pyramid / fitness function / accepted-residual gate)](0061-band-aid-breaking-shift-left-mechanization.md) | accepted | 2026-06-20 |
| 0062 | [統一エラー通知設計 (種別×手段マッピング + 内部例外非露出 + role/aria SSOT)](0062-unified-error-notification.md) | accepted | 2026-06-22 |
| 0063 | [DSQL pool マルチテナント分離 (信頼 claim/context + アプリ層単一強制点 + fitness function、RLS 非対応の代替防御線)](0063-dsql-pool-multitenant-isolation.md) | accepted | 2026-06-29 |
| 0064 | [NUC 新 model repo 構築方式 — PGlite 一次採用 (dialect 税ゼロ) + raw SQLite fallback](0064-sqlite-core-repo-strategy.md) | accepted | 2026-07-09 |
| 0065 | [DSQL DPU コスト規約 — service 層クエリの 5 原則 (実測裏付け)](0065-dsql-dpu-query-rules.md) | accepted | 2026-07-11 |
| 0066 | [export/import 値域 SSOT — wire schema とドメイン validator は同一値域定数を import する](0066-export-import-schema-range-ssot.md) | accepted | 2026-07-12 |
| 0067 | [アプリ側 CSP の `'unsafe-inline'` hardening (script-src = hash 撤廃 / style-src = 維持 + 構造的根拠)](0067-app-csp-script-src-hash.md) | accepted | 2026-07-17 |

## archive 一覧（6 件）

`docs/decisions/archive/` 配下。現場の常時参照ルールではないが、現役コード / 運用が参照する record として保全。再活性化時は本 README の §archive 運用ルール を参照する。

| # | タイトル | 保全理由 |
|---|--------|---------|
| 0024 | [resolvePlanTier 責務分離](archive/0024-plan-tier-resolution-pattern.md) | ALS cache key / invalidate 規約が他 doc に移管されていない |
| 0030 | [Cognito E2E user lifecycle](archive/0030-cognito-e2e-user-lifecycle.md) | E2E helpers / fixtures が「ADR-0030 D-2〜D-5」条項を拒否 guard / email 命名規則の SSOT として参照 |
| 0039 | [デモモード統合](archive/0039-demo-mode-app-execution-mode.md) | src / ci.yml / check-no-demo-route-duplication.mjs が設計根拠として現役参照 (supersede 先: ADR-0048) |
| 0040 | [実行モード × ライセンス統括](archive/0040-runtime-mode-license-unified-architecture.md) | runtime-mode P1〜P5 (Typed env / EvaluationContext / Policy Gate) の Phase 定義 SSOT。src 30+ 箇所が「ADR-0040 Px」を参照 |
| 0042 | [マーケット性別バリアント方針](archive/0042-marketplace-gender-variant-policy.md) | PO 3 回誤提案の判断根拠 (stated vs revealed)。読まないと同じ誤提案を繰り返す |
| 0044 | [admin bypass 証跡運用](archive/0044-admin-bypass-evidence.md) | 本番 ops UI + bot コメントが GitHub URL で現役リンク (上位: ADR-0022) |

## 削除済み ADR

削除した ADR の番号は再利用しない。何を削除し内容をどこへ移したかは git 履歴で追う（`git log --diff-filter=D -- docs/decisions/`）。過去の棚卸結果も同様に git / 棚卸 PR body を SSOT とし、本 README には残さない（`docs/CLAUDE.md` §docs SSOT 原則）。
