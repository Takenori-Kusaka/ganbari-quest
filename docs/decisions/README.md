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
| LP テキスト折り返し (日本語) | BudouX (CDN Web Component) | ADR-0016 | OS-non-dependent + 0 KB (CDN) |
| LP SSOT 注入 (XSS 設計) | DOMPurify | ADR-0025 / #1683 | innerHTML 経路の XSS 防御、業界標準 |
| Parent-Gate session cookie 署名 | cookie-signature | ADR-0050 / #2310 | HMAC-SHA256 検証、4 OSS 比較 |
| **Marketplace schema validation (5 type SSOT)** | **Valibot + @standard-schema/spec** | **#2362 EPIC / #2364** | **bundle 92% 削減 (vs Zod v3)、Standard Schema spec で将来 Zod/ArkType 切替自由度** |
| **E2E Accessibility audit (WCAG 2.2 AA、CX-DoR #10)** | **@axe-core/playwright** | **Round 18 PR-A11Y-2 (A-5)** | **Deque 公式 (axe-core 同元)、Playwright `Page` を直接受ける AxeBuilder で inline inject 不要。dev dependency のみ (本番 bundle 0、ADR-0010)。既存 axe-runner.mjs の inline inject は Stagehand v3 専用回避策のため通常 E2E では本 OSS を採用** |
| **ページガイド positioning (collision-aware + spotlight)** | **driver.js (MIT)** | **#2926 (EPIC #2925 Sub-1)** | **side/align 宣言 + viewport 自動調整 + scroll-into-view + backdrop cutout (spotlight) を標準装備。手動 positioning (PageGuideOverlay 独自の targetRect 計測 / 固定クランプ / 自前 SVG spotlight) を撤去し本来機能に委譲。intro.js / shepherd.js は AGPL or 商用で商用 SaaS 不適、floating-ui は positioning のみ (spotlight + scroll は別実装) のため driver.js を採用 (research SSOT: `tmp/research-page-guide-redesign-2026-06-05.md` §3)。PR #2387 で callsite 0 を理由に一旦撤去 → #2930 で PageGuideOverlay の手動 positioning を実委譲し再採用 (Issue #2406 の「Driver.js 不使用」前提を supersede)** |

各採用 OSS の詳細根拠は対応する ADR / 設計書 (`docs/design/*-architecture.md`) を参照。本表は採用済み OSS の「インデックス」として機能し、新規実装者が `npm install` 前にまず参照する SSOT。

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

> **方針転換 (#2440 PR-A5)**: 役目を終えた record は archive ではなく **削除**する（履歴は git で追跡）。**今後の新規 archive 移動は行わない**。既存の `docs/decisions/archive/` 26 件は本 PR では触らず、月 1 棚卸（`docs/CLAUDE.md` §ADR 月 1 棚卸）で削除 / 残置を個別判断する。

`docs/decisions/archive/` は過去に退避された ADR の保管先（移行期の残存）。再活性化が必要になった場合は git 履歴または archive 配下から直下に戻す。新規退避は行わないため、以下の旧 archive 運用は既存 26 件の参照・再活性化時のみ適用する:

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
| 0007 | [静的解析 tier ポリシー (T1/T2/T3/T4)](0007-static-analysis-tier-policy.md) | accepted | 2026-04-20 |
| 0008 | [設計ポリシー先行確認フロー](0008-design-policy-pre-approval.md) | accepted | 2026-04-20 |
| 0010 | [Pre-PMF スコープ判断（3 バケット + セキュリティ最小化 + 優先度）](0010-pre-pmf-scope-judgment.md) | accepted | 2026-04-20 |
| 0011 | [0-2 歳 baby モードは「親の準備モード」](0011-baby-mode-as-parent-preparation.md) | accepted | 2026-04-21 |
| 0012 | [Anti-engagement 原則（滞在時間 = 価値毀損）](0012-anti-engagement-principle.md) | accepted | 2026-04-21 |
| 0013 | [LP 文言は実装の事実を SSOT とする](0013-lp-truth-from-implementation.md) | accepted | 2026-04-21 |
| 0016 | [日本語テキスト折り返し方針](0016-japanese-text-wrap.md) | accepted (2026-06-04 昇格、#2440 PR-A5) | 2026-04-21 |
| 0019 | [CDK Replacement 検知を deploy 前必須ゲートとして組み込む](0019-cdk-replacement-detection-gate.md) | accepted | 2026-04-24 |
| 0022 | [admin bypass 禁止と ganbariquestsupport-lab QM Approve 体制の確立](0022-admin-bypass-disable-qm-approve.md) | accepted (2026-06-04 amendment 4: lab merge 2 role 区別 + 統合 PR 作成者ルール、#2863) | 2026-04-25 |
| 0024 | [インフラ PR 必須要件 — ENV silent skip 禁止 + secrets validation + post-deploy smoke test + alarm](0024-infra-pr-required-baseline.md) | accepted | 2026-04-27 |
| 0025 | [LP SSOT 注入機構の innerHTML 化 + XSS 設計（DOMPurify）](0025-lp-ssot-html-injection-with-xss-protection.md) | **accepted (2026-04-30, #1683 完遂 + #1704)** | 2026-04-29 |
| 0026 | [致命修正コミットの force push による消失防止](0026-force-push-protection.md) | accepted | 2026-04-30 |
| 0029 | [LP CSP and CDN SRI Strategy](0029-lp-csp-and-cdn-sri-strategy.md) | **accepted (2026-05-01、2026-05-14 connect-src amendment #2068)** | 2026-05-01 |
| 0030 | [`npm run pre-ready` CLI 採用と pre-push hook 非採用](0030-pre-ready-cli-and-no-pre-push-hook.md) | accepted (2026-05-27 stale-context 補追) | 2026-05-01 |
| 0042 | [LP CSS Spacing/Layout 3 層トークン化 (Base → Semantic → Component SSOT)](0042-lp-spacing-layout-tokens.md) | accepted | 2026-05-02 |
| 0045 | [terms.ts SSOT 2 階層化原則 (atom / compound 責務分離)](0045-terms-ssot-2-layer.md) | accepted | 2026-05-07 |
| 0046 | [Svelte 5 Service Interface + Context DI による本番/デモ UI 統合 (POC)](0046-svelte5-service-interface-context-di.md) | accepted (POC: child home 1 ページ) | 2026-05-14 |
| 0047 | [Demo / 本番 UI Contract SSOT (ViewModel 型強制 + 禁止語 + 5 phase 分割)](0047-demo-prod-ui-contract-ssot.md) | accepted (Phase 1 = 型 + ADR + 禁止語 SSOT のみ) | 2026-05-14 |
| 0048 | [Multi-Lambda Demo Deployment (env 駆動 + IAM role 分離 + client-side state)](0048-multi-lambda-demo-deployment.md) | accepted | 2026-05-15 |
| 0049 | [プラン別履歴保持期間ポリシー — 物理削除対象テーブル拡張 (旧 ADR-0028 un-archived + 拡張)](0049-retention-physical-delete-extended.md) | accepted (un-archived 2026-05-19) | 2026-04-11 (initial) / 2026-05-19 (拡張) |
| 0050 | [Parent-Gate Session Cookie 署名方式: cookie-signature (OSS 4 件比較)](0050-parent-gate-session-cookie-signature.md) | accepted (2026-06-17 §7 改訂: federated PIN reset を email-OTP 化、#3070) | 2026-05-20 |
| 0051 | [NUC-SaaS Bifurcation (license/billing 領域、Edition badge + 簡略表示型採用)](0051-license-page-nuc-saas-bifurcation.md) | accepted | 2026-05-20 |
| 0052 | [MarketplaceTypeRegistry + ImportStrategy パターンによる 5 type 統一抽象化](0052-marketplace-type-registry.md) | accepted | 2026-05-21 |
| 0053 | [LP visual regression: pixelmatch (OSS 6 件比較)](0053-lp-visual-regression-pixelmatch.md) | accepted | 2026-05-23 |
| 0055 | [Per-child 主軸 + 限定 family master データモデル原則 (6 type SSOT)](0055-per-child-primary-data-model-pattern.md) | accepted | 2026-05-23 |
| 0056 | [QM Orchestrator role drift の構造的対処 (Adversarial Reviewer + PreToolUse Hook + JSON Schema 強制)](0056-qm-drift-prevention-by-structural-agent-constraint.md) | accepted | 2026-05-28 |
| 0060 | [「全対応完了」宣言の 10 項目検証義務 (チケット close ≠ 完了、DoD checklist + CI gate 併用)](0060-completion-definition-10-item-verification.md) | accepted | 2026-06-04 |
| 0061 | [band-aid サイクル打破 + shift-left の機械強制 (failing-test-first / same-class-N→guard / push-down-pyramid / fitness function)](0061-band-aid-breaking-shift-left-mechanization.md) | accepted | 2026-06-20 |
| 0062 | [統一エラー通知設計 (種別×手段マッピング + 内部例外非露出 + role/aria SSOT)](0062-unified-error-notification.md) | accepted | 2026-06-22 |
| 0063 | [DSQL pool マルチテナント分離 (信頼 claim/context + アプリ層単一強制点 + fitness function、RLS 非対応の代替防御線)](0063-dsql-pool-multitenant-isolation.md) | accepted | 2026-06-29 |

> 注 (2026-06-04 #2440 PR-A5): 番号は欠番を許容する（削除済 ADR の番号は再利用しない、git 履歴で追跡可能）。新規 ADR は最大番号 +1 で採番する。renumber 規約は §renumber 規約 を参照。
>
> **ADR-0055 番号衝突メモ (2026-05-23、QM Re-Review feedback #2449)**: 本 PR (#2449) で per-child データモデル原則 ADR を当初 0053 として起票したが、同日 PR #2435 で 0053 (LP visual regression pixelmatch) が確保済の番号衝突が QM Re-Review で発覚。0054 は別 PR (#2441 / #2443) の revert cycle で burn 済 (git 履歴のみ、active 不在) のため、renumber 規約 (§renumber 規約) に従い本 ADR を 0055 に振り直した。
>
> **ADR-0052 番号衝突メモ (2026-05-21)**: Issue #2363 は当初 ADR-0051 と指示されていたが、起票時点で既に ADR-0051 (NUC-SaaS Bifurcation) が確保済のため renumber 規約 (§renumber 規約) に従い 0052 に振り直した。1-in-1-out の履行は active 27 件超過の現状とあわせて別 follow-up Issue (#1924 系の継続棚卸) で扱う。

## archive 一覧（26 件）

`docs/decisions/archive/` 配下。現場の常時参照ルールではないが歴史的価値で保全。再活性化時は本 README の「archive 運用ルール」を参照。

### 技術選定の背景（7 件）

| # | タイトル |
|---|--------|
| 0011 | [SvelteKit 2 + Svelte 5 採用](archive/0011-sveltekit-svelte5.md) |
| 0012 | [DynamoDB シングルテーブル設計](archive/0012-dynamodb-single-table.md) |
| 0013 | [Cognito + Google OAuth](archive/0013-cognito-google-oauth.md) |
| 0014 | [3 層 CSS トークンアーキテクチャ](archive/0014-css-token-architecture.md) |
| 0015 | [Repository パターン](archive/0015-repository-pattern.md) |
| 0040 | [実行モード × ライセンス統括](archive/0040-runtime-mode-license-unified-architecture.md) |
| 0043 | [NativeSelect primitive](archive/0043-native-select-primitive.md) |

### 現行ルール（TOP10 落ち）（12 件）

| # | タイトル |
|---|--------|
| 0001 | [リネーム時の後方互換必須](archive/0001-rename-backward-compat.md) |
| 0004 | [スタンプカード正仕様](archive/0004-stamp-card-spec.md) |
| 0007 | [画像アセット保護](archive/0007-image-asset-protection.md) |
| 0009 | [labels.ts SSOT 化原則](archive/0009-labels-ssot-principle.md) — superseded by ADR-0045 (2026-05-07) |
| 0019 | [ダイアログ FSM](archive/0019-dialog-fsm-scrap-and-rebuild.md) |
| 0021 | [デプロイ検証ゲート](archive/0021-deploy-verification-gate.md) |
| 0022 | [課金 × データライフサイクル整合](archive/0022-billing-data-lifecycle-consistency.md) |
| 0023 | [LP マーケティングポリシー Pre-PMF](archive/0023-marketing-policy-pre-pmf.md) — deprecated by ADR-0031 (2026-05-01) |
| 0024 | [resolvePlanTier 責務分離](archive/0024-plan-tier-resolution-pattern.md) |
| 0025 | [License × Stripe 因果関係](archive/0025-license-subscription-causality.md) |
| 0026 | [ライセンスキーアーキテクチャ](archive/0026-license-key-architecture.md) |
| 0031 | [スキーマ互換テスト義務化](archive/0031-schema-change-compat-testing.md) |
| 0031 | [ADR-0023 廃案 + sub-Issue 7 件帰属マップ](archive/0031-adr-0023-deprecation-and-attribution-map.md) — archived 2026-05-28 (1-in-1-out for ADR-0056、内容統合済 historical record) |

### 実装ポリシー（5 件）

| # | タイトル |
|---|--------|
| 0030 | [Cognito E2E user lifecycle](archive/0030-cognito-e2e-user-lifecycle.md) |
| 0033 | [/ops Cognito ops group 認可](archive/0033-ops-dashboard-cognito-authz.md) |
| 0036 | [マーケット公開アクセス設計](archive/0036-marketplace-public-access.md) |
| 0039 | [デモモード統合](archive/0039-demo-mode-app-execution-mode.md) |
| 0044 | [admin bypass 証跡運用](archive/0044-admin-bypass-evidence.md) |

### 小規模方針（2 件）

| # | タイトル |
|---|--------|
| 0041 | [マーケット命名テンプレート](archive/0041-marketplace-naming-template.md) |
| 0042 | [マーケット性別バリアント方針](archive/0042-marketplace-gender-variant-policy.md) |

## 削除済み（git 履歴で追跡）

以下は #1262 sub-A / sub-B で削除。内容は TOP 10 に吸収済み、または supersede チェーン終結。

- **TOP 10 吸収**: 旧 0003 / 0005 / 0006 / 0010 / 0017 / 0018 / 0020 / 0023 / 0029 / 0032 / 0034 / 0035 / 0037 / 0038（14 件、sub-A）
- **supersede チェーン終結**: 旧 0002 / 0008 / 0009 / 0016 / 0027（5 件、sub-B）

### 2026-06-04 削除（#2440 PR-A5、削除主義への移行）

役目を終えた record 12 件を archive ではなく削除（履歴は git で追跡。番号は再利用しない）。内訳:

- **完了済 migration / インフラ復旧記録**: 0018（Cognito 論理 ID Replacement）/ 0021（Cognito Pool 移行ユーザー保全）/ 0058（プラン命名 family→premium rename、適用済）
- **採択されなかった / reference 化済の調査**: 0014（labels / i18n 機構選定、`.claude/skills/issue-triage/SKILL.md` の OSS 先調査テンプレートとして役割移管済）/ 0015（年齢帯 variant 管理アーキテクチャ）/ 0057（Vale vs Node prose linter 選定）
- **完遂済の一回限り決定記録**: 0020（NUC スケジューラ node-cron 選定、採用済）/ 0027（チェックリスト責務純化 + must 属性、実装済）/ 0028（Pre-PMF founder 直対応動線 LP 不要、適用済。retention 拡張は ADR-0049 が SSOT）/ 0032（LP 静的コンテンツ コンポーネント設計、適用済）/ 0044（Birthday Input Component Choice、`BirthdayInput.svelte` 実装済）/ 0059（Phase 7 cutover sequence、完遂済）

## 棚卸レポート

- [adr-inventory-2026-04-19.md](adr-inventory-2026-04-19.md) — 旧 0001〜0039 の棚卸（0008 / 0009 / 0016 を supersede）
- [adr-inventory-2026-04-20.md](adr-inventory-2026-04-20.md) — #1262 sub-7 完了時の刷新

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
