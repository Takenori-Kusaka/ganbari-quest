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

各採用 OSS の詳細根拠は対応する ADR / 設計書 (`docs/design/*-architecture.md`) を参照。本表は採用済み OSS の「インデックス」として機能し、新規実装者が `npm install` 前にまず参照する SSOT。

### OSS 調査済み・不採用記録 (#1350 整合)

調査したが採用しなかった OSS の**薄いインデックス**。同じ候補の再調査ループを断つことが目的。再評価トリガを満たした場合のみ再検討する。

| 領域 | 調査 OSS | 調査日 | 結論 (1 行) | 再評価トリガ | 詳細 |
|------|---------|-------|------------|------------|------|
| コードベース探索性 (knowledge graph 化) | [Graphify](https://github.com/Graphify-Labs/graphify) (Apache-2.0) | 2026-07-29 | `tree-sitter-svelte` 非対応で UI 層がグラフ上の空白、増分機能は既存資産と重複 | `tree-sitter-svelte` 対応が入る / v1.0.0 の Svelte・SvelteKit 対応状況 | [rationale](../rationale/16-graphify-evaluation-rationale.md) |

**記録する基準**: 10 行超の独自実装 / 既存機構の置換候補として**実測評価した**もののみ。カタログを見て軽く外したものは記録しない (記録の価値 = 再調査コストの回避であり、再調査が安いものは対象外)。

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

> **方針転換 (#2440 PR-A5)**: 役目を終えた record は archive ではなく **削除**する（履歴は git で追跡）。**今後の新規 archive 移動は行わない**。既存の `docs/decisions/archive/` は 2026-07-19 棚卸 (#3908) で 28 件 → 6 件に削減済（削除内訳は「削除済み」節）。

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

> **注 (2026-06-04 棚卸、#2440 PR-A5)**: 削除主義（§ボリューム上限ルール改定）に基づき、役目を終えた record 12 件（完了済 migration / 採択されなかった調査 / 完遂済の一回限り決定記録）を削除し、active を分類 A（常時参照ルール / 横断ポリシー / 技術選定根拠）に絞り込んだ。本表は active ADR の SSOT（表 vs 実ファイルが一致することを CI / 月 1 棚卸で照合）。削除内訳は「削除済み（git 履歴で追跡）」節を参照。

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

> 注 (2026-06-04 #2440 PR-A5): 番号は欠番を許容する（削除済 ADR の番号は再利用しない、git 履歴で追跡可能）。新規 ADR は最大番号 +1 で採番する。renumber 規約は §renumber 規約 を参照。
>
> **ADR-0055 番号衝突メモ (2026-05-23、QM Re-Review feedback #2449)**: 本 PR (#2449) で per-child データモデル原則 ADR を当初 0053 として起票したが、同日 PR #2435 で 0053 (LP visual regression pixelmatch) が確保済の番号衝突が QM Re-Review で発覚。0054 は別 PR (#2441 / #2443) の revert cycle で burn 済 (git 履歴のみ、active 不在) のため、renumber 規約 (§renumber 規約) に従い本 ADR を 0055 に振り直した。
>
> **ADR-0052 番号衝突メモ (2026-05-21)**: Issue #2363 は当初 ADR-0051 と指示されていたが、起票時点で既に旧 ADR-0051 (NUC-SaaS Bifurcation、2026-07-19 棚卸で削除、現状 SSOT は `docs/design/nuc-saas-runtime-bifurcation.md`) が確保済のため renumber 規約 (§renumber 規約) に従い 0052 に振り直した。

## archive 一覧（6 件）

`docs/decisions/archive/` 配下。現場の常時参照ルールではないが、現役コード / 運用が参照する record として保全。再活性化時は本 README の「archive 運用ルール」を参照（2026-07-19 棚卸で 28 件 → 6 件に削減、削除内訳は「削除済み」節）。

| # | タイトル | 保全理由 |
|---|--------|---------|
| 0024 | [resolvePlanTier 責務分離](archive/0024-plan-tier-resolution-pattern.md) | ALS cache key / invalidate 規約が他 doc に移管されていない |
| 0030 | [Cognito E2E user lifecycle](archive/0030-cognito-e2e-user-lifecycle.md) | E2E helpers / fixtures が「ADR-0030 D-2〜D-5」条項を拒否 guard / email 命名規則の SSOT として参照 |
| 0039 | [デモモード統合](archive/0039-demo-mode-app-execution-mode.md) | src / ci.yml / check-no-demo-route-duplication.mjs が設計根拠として現役参照 (supersede 先: ADR-0048) |
| 0040 | [実行モード × ライセンス統括](archive/0040-runtime-mode-license-unified-architecture.md) | runtime-mode P1〜P5 (Typed env / EvaluationContext / Policy Gate) の Phase 定義 SSOT。src 30+ 箇所が「ADR-0040 Px」を参照 |
| 0042 | [マーケット性別バリアント方針](archive/0042-marketplace-gender-variant-policy.md) | PO 3 回誤提案の判断根拠 (stated vs revealed)。読まないと同じ誤提案を繰り返す |
| 0044 | [admin bypass 証跡運用](archive/0044-admin-bypass-evidence.md) | 本番 ops UI + bot コメントが GitHub URL で現役リンク (上位: ADR-0022) |

## 削除済み（git 履歴で追跡）

以下は #1262 sub-A / sub-B で削除。内容は TOP 10 に吸収済み、または supersede チェーン終結。

- **TOP 10 吸収**: 旧 0003 / 0005 / 0006 / 0010 / 0017 / 0018 / 0020 / 0023 / 0029 / 0032 / 0034 / 0035 / 0037 / 0038（14 件、sub-A）
- **supersede チェーン終結**: 旧 0002 / 0008 / 0009 / 0016 / 0027（5 件、sub-B）

### 2026-06-04 削除（#2440 PR-A5、削除主義への移行）

役目を終えた record 12 件を archive ではなく削除（履歴は git で追跡。番号は再利用しない）。内訳:

- **完了済 migration / インフラ復旧記録**: 0018（Cognito 論理 ID Replacement）/ 0021（Cognito Pool 移行ユーザー保全）/ 0058（プラン命名 family→premium rename、適用済）
- **採択されなかった / reference 化済の調査**: 0014（labels / i18n 機構選定、`.claude/skills/issue-triage/SKILL.md` の OSS 先調査テンプレートとして役割移管済）/ 0015（年齢帯 variant 管理アーキテクチャ）/ 0057（Vale vs Node prose linter 選定）
- **完遂済の一回限り決定記録**: 0020（NUC スケジューラ node-cron 選定、採用済）/ 0027（チェックリスト責務純化 + must 属性、実装済）/ 0028（Pre-PMF founder 直対応動線 LP 不要、適用済。retention 拡張は ADR-0049 が SSOT）/ 0032（LP 静的コンテンツ コンポーネント設計、適用済）/ 0044（Birthday Input Component Choice、`BirthdayInput.svelte` 実装済）/ 0059（Phase 7 cutover sequence、完遂済）

### 2026-07-19 削除（#3908 月次棚卸前倒し、PO 指示「ADR は最小限に維持」）

役目を終えた record **28 file** を削除（履歴は git で追跡、番号は再利用しない）。判定基準 =「その ADR を読まないと誤る判断が今後あるか? — No なら削除」。判定表 SSOT: PR #3908 系棚卸 PR body + `tmp/adr-audit-2026-07-19.md`（Agent 報告）。内訳:

- **active 削除 (2 件)**: 0016（日本語テキスト折り返し — 運用ポリシーは docs/DESIGN.md §3 + src/routes/CLAUDE.md に完全移管済、BudouX 選定根拠は本 README §OSS 採用記録が保持）/ 0051（NUC-SaaS Bifurcation — 一回限りの画面分割決定は実装完遂済、現状 SSOT は `docs/design/nuc-saas-runtime-bifurcation.md`）
- **active 統合 (2 件)**: 0046（Svelte5 Service Interface + Context DI POC）/ 0047（Demo/本番 UI Contract）→ **ADR-0048 §統合** に決定核を吸収（demo/本番統合 3 部作の経緯 narrative は git 履歴）
- **棚卸レポート削除 (2 件)**: adr-inventory-2026-04-19 / adr-inventory-2026-04-20（一回限りの棚卸 record、旧番号体系の記述で現状の正解を含まない）
- **archive 削除 (22 件)**: 0001（rename 後方互換 → `src/routes/CLAUDE.md` へ移管）/ 0004（スタンプカード → 06-UI設計書 + 26-ゲーミフィケーション設計書）/ 0007（画像アセット保護 → DESIGN.md §7）/ 0009（superseded by ADR-0045）/ 0011-0015（技術選定 5 件: SvelteKit / DynamoDB (撤去済 #3438) / Cognito / CSS 3 層 (→DESIGN.md §2) / Repository (→ADR-0063/0064)）/ 0017（rejected、supersede チェーン終結）/ 0019（Dialog FSM → copilot-instructions が自持ち）/ 0021（deploy 検証 → CI 機械化完遂）/ 0022（課金×データライフサイクル → account-deletion-flow.md 等 3 設計書）/ 0023（廃案 placeholder）/ 0025・0026（license key 全廃 #2813 で対象消滅）/ 0031×2（schema 互換 → tests/CLAUDE.md + check-schema-change-tests.mjs、ADR-0023 帰属マップは役割完了自認）/ 0033（/ops 認可 → 07-API + 14-セキュリティ設計書）/ 0036（marketplace 公開 → marketplace-import-flow.md + DESIGN.md §10）/ 0041（命名 → terms.ts + DESIGN.md §6）/ 0043（NativeSelect → DESIGN.md §5）

## 棚卸レポート

過去の棚卸レポート file（adr-inventory-*）は 2026-07-19 棚卸で削除（git 履歴で追跡）。以降の棚卸結果は本節のサブセクションに直接記録する。

### 2026-05-09 棚卸 (#1924 Phase 6 G3)

per-ADR ボリューム上限ルール (`per-ADR ≤ 150 行 / 章立て ≤ 7 セクション`) 違反候補:

| ADR | 行数 | セクション数 | 違反内容 | 対応方針 |
|---|---|---|---|---|
| 0017 | 149 | 8 | セクション 7 超過 (1 件) | rejected ADR で historical record。実害なし、archive 候補（次回棚卸） |
| 0018 | 173 | 8 | 行 + セクション両方超過 | Cognito 復旧経緯の歴史的 record。詳細は `docs/design/14-セキュリティ設計書.md` 等への分離が次回棚卸の候補 |
| 0022 | 184 | 7 | 行超過 | admin bypass 規制の根拠詳細。補助 doc 分離が次回棚卸の候補 |
| 0025 | 177 | 5 | 行超過 | LP SSOT 注入の XSS 設計詳細。`docs/design/19-プライシング戦略書.md` 等への分離が次回棚卸の候補 |
| 0029 | 163 | 4 | 行超過 | LP CSP / CDN SRI 詳細。補助 doc 分離が次回棚卸の候補 |
| 0042 | 231 | 7 | 行超過 (最大) | LP Spacing 3 層トークン詳細表が大半。`docs/DESIGN.md §4` への分離が次回棚卸の候補 |

active 総数: 33 件 (TOP 10 ルール大幅超過)。整理本格実施は別 Issue (棚卸 6 ヶ月毎、Issue #1262 系の継続) で扱う。Phase 6 G3 #1924 は (a) ADR-0045 表追加 (b) ADR-0009 archive 移動 (c) 本棚卸結果記録 (d) ADR-0023 archive 表掲載漏れ修正 (e) 番号連続性 OK 確認 (ADR-0044 / 0045 連続) を完遂。

### 2026-05-27 棚卸 (P0 ADR cleanup)

ADR audit (`tmp/adr-audit-2026-05-27.md` Agent 報告) に基づく **P0 即対応** 結果:

**完了項目**:

1. **ADR-0030 stale-context 補追**: `docs/decisions/0030-pre-ready-cli-and-no-pre-push-hook.md` 末尾に「2026-05-27 補追: 前提崩れによる位置付け変更」セクションを追加。`package.json` に `husky: ^9.1.7` 追加 + `.husky/pre-push` (ADR-0022 amendment 3 / #1879) 確立により、本 ADR §AC6 非採用判断の根拠 (a)/(b) は history-only 化したが、中心位置付け (pre-push hook での重い検査自動実行は不採用) は依然有効である旨を明示。
2. **ADR-0017 README 表行削除**: ADR-0017 は #2097 (2026-05-15) で archive 移動済 (`archive/0017-cognito-pool-recreation-email-mutable.md`、rejected ADR で superseded by ADR-0018) のため README active 表から該当行を削除。rejected ADR の historical record は archive で保持。
3. **README 表 13 件追補**: ADR-0019 / 0020 / 0021 / 0022 / 0024 / 0026 / 0027 / 0028 / 0029 / 0030 / 0031 / 0044 を active 表に追補。L177 注釈の「別 PR で追補予定」記述を解消。
4. **docs/CLAUDE.md 月 1 棚卸ルール追加**: ADR 管理 section に「ADR 月 1 棚卸 (定期 retrospective)」を新設。次回適用は 2026-06 最終週。

**P1 以降の継続課題** (本 PR scope 外):

- per-ADR ボリューム上限ルール違反 (2026-05-09 棚卸 6 件 + 新規候補 ADR-0049 / 0050 など) の分割実施
- ADR-0014 / 0015 / 0016 の `proposed` → `accepted` 昇格判断
- ADR-0031 (ADR-0023 deprecation map) の archive 判断 (内容が完全に統合済かの確認後)
- active 39 件 → TOP 10 ルール準拠への段階的 1-in-1-out 履行

active 総数: 39 件 (棚卸後)。月 1 棚卸 (`docs/CLAUDE.md`) で継続消化。

### 2026-05-28 棚卸 (ADR-0056 起票 / 1-in-1-out 履行)

**完了項目**:

1. **ADR-0056 新規追加**: QM Orchestrator role drift の構造的対処 (Adversarial Reviewer + PreToolUse Hook + JSON Schema 強制)。33 日 / 42 回再発の defect 直対処、Pre-PMF Bucket A (ADR-0010 整合)。Research SSOT: [docs/research/qm-drift-prevention-2026-05-28.md](../research/qm-drift-prevention-2026-05-28.md)
2. **ADR-0031 archive 移動**: 2026-05-27 棚卸 P1 課題「ADR-0031 (ADR-0023 deprecation map) の archive 判断 (内容が完全に統合済かの確認後)」を消化。sub-Issue 7 件は CLOSED + 帰属 comment 配布完了 + 帰属先 ADR 0010 / 0012 / 0013 / 0025 / 0028 に統合済 → 現場常時参照ルールではなく historical record として archive 適格
3. **1-in-1-out 履行**: ADR-0056 +1 / ADR-0031 archive -1 で net 0、active 39 件維持。月 1 棚卸 (docs/CLAUDE.md §ADR 月 1 棚卸) で継続消化

**P1 以降の継続課題** (本 PR scope 外):

- per-ADR ボリューム上限ルール違反 (2026-05-09 棚卸 6 件 + 新規候補 ADR-0049 / 0050 など) の分割実施
- ADR-0014 / 0015 / 0016 の `proposed` → `accepted` 昇格判断
- active 39 件 → TOP 10 ルール準拠への段階的 1-in-1-out 履行 (2026-06 最終週 棚卸で再評価)

active 総数: 39 件 (棚卸後、ADR-0056 +1 / ADR-0031 -1 で net 0)。

### 2026-06-04 棚卸 (ADR-0060 起票)

**完了項目**:

1. **ADR-0060 新規追加**: 「全対応完了」宣言の 10 項目検証義務 (チケット close ≠ 完了)。Epic #2525 Phase 7 で「関連チケット close = 完了」と誤判断し虚偽完了報告 → PO が 5 秒 grep で 125+ file 残存を発見した構造的失敗の直対処。DoD checklist (Scrum) + CI gate 併用 (選択肢 C)、新規 script 不要で導入コスト最小 (Pre-PMF Bucket A、ADR-0010 整合)。10 項目 SSOT: [phase1-license-key-removal-final-requirements.md §5](../design/billing-redesign/phase1-license-key-removal-final-requirements.md)
2. **本 PR (#2892) で license key 全廃の項目 10 (設計書同期) を完遂**: stale 設計書 5 file (`license-key-lifecycle` / `license-key-requirements` / `license-key-competitor-analysis` / `license-subscription-causality` / `license-hmac-migration-plan`) に deprecation header 付与 + 参照元設計書 (07-API / 08-DB / 19-pricing / 24-arch / account-deletion-flow / plan-change-flow / stripe-dashboard-runbook / operations/runbook) の link 同期

**1-in-1-out 履行**: ADR-0059 起票時 (#2665) と同様、active 大幅超過 (40 件) の現状を踏まえ 1-in-1-out は **2026-06 最終週の月 1 棚卸** (`docs/CLAUDE.md` §ADR 月 1 棚卸) で archive 候補 (ADR-0014 proposed のまま / ADR-0017 rejected archive 候補 / per-ADR ボリューム超過 6 件) のいずれかと併せて消化する (本 PR scope 外)。

active 総数: 40 件 (棚卸後、ADR-0060 +1)。

### 2026-06-20 棚卸 (ADR-0061 起票)

**完了項目**:

1. **ADR-0061 新規追加**: band-aid サイクル打破 + shift-left の機械強制 (failing-test-first / same-class-N→guard / push-down-pyramid / fitness function)。export/import クラスタの 2 サイクル連続 blocker (#3104→#3132) + 重量 e2e すり抜け回帰 (#3163) の root class = 「再発防止が人の注意依存 + 不変条件が e2e-only」を機械強制で institutionalize。Pre-PMF Bucket A (ADR-0010 整合、既存 skill/gate/lint 拡張でツール費ほぼゼロ、SLO/Pact は no-go)。Phase 1 (本 PR) = ADR + Issue Template `根本原因` 必須欄 + pr-review skill C項。Phase 2 (構造ルールの dependency-cruiser/eslint fitness 化) は #3134/#3164 を起点に follow-up で段階導入。

**1-in-1-out 履行**: ADR-0060 起票時と同様、active 大幅超過 (41 件) の現状を踏まえ 1-in-1-out は **2026-06 最終週の月 1 棚卸** で archive 候補 (ADR-0014 proposed 据置 / per-ADR ボリューム超過) と併せて消化する (本 PR scope 外)。

active 総数: 41 件 (棚卸後、ADR-0061 +1)。

### 2026-06-29 棚卸 (ADR-0063 起票)

**完了項目**:

1. **ADR-0063 新規追加**: DSQL pool マルチテナント分離 (信頼 claim/context + アプリ層単一強制点 + fitness function、RLS 非対応の代替防御線)。EPIC #3424 (DynamoDB → Aurora DSQL 移管) で、実機 PoC (`docs/research/2026-06-28-aurora-dsql-adoption.md` §11.1、us-east-1 実クラスタ) で確証した **DSQL の RLS 非対応**を受け、テナント (家族グループ) 分離を pool + 偽造不能 tenantId + 単一強制点 + CI fitness function + cross-tenant E2E で機械強制する決定。silo (cluster-per-tenant) は pre-PMF 過剰で将来 enterprise 向け再検討トリガに温存。Pre-PMF Bucket A (ADR-0010 整合)。

**1-in-1-out 履行**: ADR-0060 / 0061 起票時と同様、active 大幅超過の現状を踏まえ 1-in-1-out は **2026-06 最終週の月 1 棚卸** で archive 候補 (ADR-0014 proposed 据置 / per-ADR ボリューム超過) と併せて消化する (本 PR scope 外)。

active 総数: 42 件 (棚卸後、ADR-0063 +1)。

### 2026-07-09 棚卸 (ADR-0064 起票)

**完了項目**:

1. **ADR-0064 新規追加**: NUC 新 model repo 構築方式 = PGlite 一次採用 (dialect 税ゼロ) + raw SQLite fallback。EPIC #3424 (DynamoDB → Aurora DSQL 移管) の NUC (セルフホスト) トラックで、DSQL 用 pg repos 33 本を書き直さず NUC でも動かすため、案 C = NUC を PGlite (@electric-sql/pglite) で駆動し pg repos を verbatim 再利用する決定 (PO 承認 2026-07-09、ロールバック可能前提 = 非破壊 import-then-swap / 旧 DB 物理保持 / errors>0 abort)。決定的根拠 = pg repos が既に PGlite で全 test green (`tests/unit/db/dsql-*.test.ts`、#3531 で dev dep 採用済) で二重実装税ゼロ + クラウド parity。選択肢 3 案比較 (案 A: drizzle sqlite-core の別 raw SQL repo 群 / 案 B: drizzle query-builder で方言非依存 repo に書き直し / 案 C: PGlite で pg repos 再利用) を本文に記載し、案 B 却下・案 A は fallback 温存。Pre-PMF Bucket A (ADR-0010 整合)。

**1-in-1-out 履行**: ADR-0060 / 0061 / 0063 起票時と同様、active 大幅超過の現状を踏まえ 1-in-1-out は **2026-07 最終週の月 1 棚卸** で archive 候補 (ADR-0014 proposed 据置 / per-ADR ボリューム超過) と併せて消化する (本 PR scope 外)。

active 総数: 43 件 (棚卸後、ADR-0064 +1)。

### 2026-07-11 棚卸 (ADR-0065 起票)

**完了項目**:

1. **ADR-0065 新規追加**: DSQL DPU コスト規約 — service 層クエリの 5 原則 (実測裏付け)。EPIC #3424 の設計 Sub #3430 を、staging cluster 実測 (#3425: write txn minimum 0.05 WriteDPU / 代表クエリ DPU / OccConflicts・CommitLatency 2.87ms) で裏取りして規約化。フルスキャン禁止 (PK prefix、ADR-0063 と同一強制点) / N+1 禁止・write 束ね (recordActivityCore 模範) / secondary index PoC 保留 / hot key 回避 (UUID v4) / 一括 3,000 行・10MiB チャンク。EXPLAIN ANALYZE VERBOSE は相対回帰用 (絶対閾値 gate 不向き) を明文化。Pre-PMF Bucket A (ADR-0010 整合、ツール導入ゼロ)。

**1-in-1-out 履行**: ADR-0060〜0064 起票時と同様、active 大幅超過の現状を踏まえ 1-in-1-out は **2026-07 最終週の月 1 棚卸** で archive 候補 (ADR-0014 proposed 据置 / per-ADR ボリューム超過) と併せて消化する (本 PR scope 外)。

active 総数: 44 件 (棚卸後、ADR-0065 +1)。

### 2026-07-12 棚卸 (ADR-0066 起票)

**完了項目**:

1. **ADR-0066 新規追加**: export/import 値域 SSOT (wire schema とドメイン validator は同一値域定数を import)。EPIC #3151 (export/import 値域ドリフト根絶) slice1 で、#3104→#3132 の 2 サイクル連続 round-trip blocker の root class =「Zod domain / Valibot wire の値域二重定義 + domain⊆wire 不変条件の機械表明欠如」に対し、値域定数の domain 層 SSOT 集約 + 実 validator boundary probe fitness (`tests/unit/architecture/schema-range-ssot.test.ts`) を決定。選択肢 3 案比較 (A: schema 変換 OSS / B: 単一 Valibot schema 完全統合 / C: 値域定数 SSOT + fitness) を本文に記載し C 採用、B は EPIC 最終形として方向固定。Pre-PMF Bucket A (ADR-0010 整合、新規 dep / build step ゼロ)。当初 0065 で起票したが、同番号は 2026-07-11 の DSQL DPU コスト規約が先取済のため renumber 規約 (§renumber 規約) に従い 0066 に振り直した。

**1-in-1-out 履行**: ADR-0064 / 0065 起票時と同様、1-in-1-out は **2026-07 最終週の月 1 棚卸** で archive 候補と併せて消化する (本 PR scope 外)。

active 総数: 45 件 (棚卸後、ADR-0066 +1)。

### 2026-07-17 棚卸 (ADR-0067 起票)

**完了項目**:

1. **ADR-0067 新規追加**: アプリ側 CSP の `'unsafe-inline'` hardening。EPIC #3408 の slice C (#3829, script-src) + slice B (#3828, style-src) を 1 ADR に統合。script-src は `hooks.server.ts buildCspHeader()` の `'unsafe-inline'` が残る限り将来の stored-XSS 経路混入時に CSP が最終防壁にならない構造リスク (#3112 リスク 1) を、SvelteKit `kit.csp` hash mode で根治 (inline script が hydration bootstrap 1 種のみと impact-analysis で実測、3 案比較 A 採用)。style-src は Svelte SSR が `style:` binding (102) / `style=` を inline style 属性化し CSP hash が style 属性に効かない構造的制約により撤廃過剰のため案C (維持 + 根拠 + 将来撤廃トリガ、#3828 AC2 fallback 合致)。ADR-0029 (LP 側 CSP、別 origin) は supersede せず併存。Pre-PMF Bucket A (ADR-0010、config 数行 + 依存ゼロ)。

**1-in-1-out 履行**: ADR-0064〜0066 起票時と同様、1-in-1-out は **2026-07 最終週の月 1 棚卸** で archive 候補 (ADR-0014 proposed 据置 / per-ADR ボリューム超過) と併せて消化する (本 PR scope 外)。

active 総数: 46 件 (棚卸後、ADR-0067 +1)。

### 2026-07-19 棚卸 (#3908、月次棚卸前倒し — PO 指示「ADR は最小限に維持」)

**完了項目**:

1. **全 active + archive 68 file を 4 分類で棚卸**（(i) 常時参照ルール/gate / (ii) 技術選定根拠・supersede 記録 / (iii) 役目終了 → 削除 / (iv) 統合）。判定基準 =「その ADR を読まないと誤る判断が今後あるか?」、迷いは保全。削除候補は全件原文精読で再検証 (ADR-0060)
2. **28 file 削除 + 2 件統合**（内訳は §削除済み「2026-07-19 削除」）: active 40 → **36** / archive 28 → **6** / 棚卸レポート file 2 件削除
3. **参照整合**: 削除 file への markdown リンク / パス参照を全件是正（DESIGN.md / CLAUDE.md 系 / 設計書 / copilot-instructions / ci.yml / check-schema-change-tests.mjs / doc-code-references-baseline.json）。コードコメント内の bare 番号 mention は git 履歴 pointer として現状維持（renumber 規約整合）。番号が現役コードの生きた SSOT shorthand として機能する archive 0030 (E2E D-2〜D-5) / 0039 / 0040 (runtime-mode P1〜P5) は削除せず保全
4. **旧 active 総数記載の是正**: 過去棚卸節の「active 総数 46 件」は表 40 行と乖離が累積していた（起票 +1 のみ記録し削除反映漏れ）。本棚卸で実 file 数と照合し 36 件に確定

**TOP 10 への残 gap と次回 (2026-08 月次棚卸) の消化計画**:

- active 36 件は依然 TOP 10 目安超過。ただし分類 A（毎週参照の常時参照ルール/gate）は 0001-0008 / 0010 / 0012 / 0013 / 0045 / 0055 / 0061 / 0062 / 0065 / 0066 の 17 件前後で、残りは (ii) 技術選定根拠・現行アーキ SSOT。追加削除は「役目終了」の発生（機構撤去 / 設計書への完全移管）を待って個別判断（虚偽根拠での削減は行わない）
- **per-ADR 150 行超過 3 件の分離/圧縮**: 0056 (288 行 → §D-§G を qm-session.md へ) / 0049 (266 行 → DynamoDB 時代の実装詳細を 08-DB 設計書へ分離 + 削除) / 0010 (219 行 → §7 Phase 由来細則を Issue テンプレへ)
- **統合候補の再評価**: 0008 (設計ポリシー先行確認) ↔ 0010 の統合可否 / DSQL 系 (0063 / 0064 / 0065) の EPIC #3424 完遂後 1 本化
- forbidden-escape-language.md の機械検証 (`check-no-escape-language.mjs`) は未実装のまま — 実装するか SSOT を check-pr-body 系に統合するかを次回判断

active 総数: **36 件** (棚卸後、-4: 0016 / 0051 削除 + 0046 / 0047 → 0048 統合)。archive: **6 件**。
