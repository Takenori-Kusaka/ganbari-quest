# docs/ — 設計書・ADR・画像アセット管理

## 設計書更新ルール（CRITICAL — Done 基準に含む）

設計書は実装の Single Source of Truth。書かれていない仕様は「存在しない仕様」と同じ。
会話で決まった仕様は必ず設計書に反映する（Issue 起票だけでは不十分）。

### 更新が必須なケース

| 変更種別 | 更新すべき設計書 |
|---------|---------------|
| API エンドポイントの追加・変更 | `07-API設計書.md` |
| DB テーブル・カラムの追加・変更 | `08-データベース設計書.md` |
| UI 機能・画面・オーバーレイの追加・変更 | `06-UI設計書.md` |
| **UI プラン仕様の追加・変更**（FeatureGate / TrialBanner / PlanStatusCard / PremiumWelcome / disabled パターン） | `06-UI設計書.md §10` (#743) |
| **アカウント削除フローの追加・変更**（5 パターン分岐 / fullTenantDeletion 順序 / Stripe 連動） | `account-deletion-flow.md` (#746) |
| **プラン変更フロー（アップグレード/ダウングレード/解約/月年額切替）** | `plan-change-flow.md` (#747) |
| AWS インフラ構成の変更 | `13-AWSサーバレスアーキテクチャ設計書.md` |
| 認証・セキュリティ関連の変更 | `14-セキュリティ設計書.md` |
| デザイン・ビジュアル変更 | `15-ブランドガイドライン.md` |
| **LP (`site/**`) の情報アーキテクチャ変更** | `docs/design/lp-content-map.md` (#1163) |
| 会話で確定した機能仕様 | 該当する設計書（なければ新設） |

### LP メトリクス ratchet ルール (#1163)

`site/**` を変更する PR は、`scripts/measure-lp-dimensions.mjs` が以下の閾値を破らないこと。CI (`.github/workflows/lp-metrics.yml`) が自動 FAIL する。

| 指標 | 現閾値 | 方針 |
|------|--------|------|
| `mobileHeight` | 15000 px | 引き上げ禁止（下げるのは自由） |
| `desktopHeight` | 8000 px | 同上 |
| `forbiddenTerms` | 全 0 | 新規の開発者語彙 (`git clone` / `docker compose` / `SaaS版` / `TLS` / `AES-256` / `AWS`) や射幸性語彙 (`ガチャ` / `抽選` / `コンプリート`) を追加しない |
| `ctaVariants` | 3 以下 | CTA 文言は `無料で始める` / `デモを見る` + NAV の `ログイン` の 3 種のみ |

閾値を緩める変更は ADR で合意を得てから `scripts/measure-lp-dimensions.mjs` の `THRESHOLDS` を更新する。

### 絶対にやってはいけないこと
- 会話で仕様が決まったのに設計書に反映しないまま実装を進めること
- Issue 本文に仕様を書いて「設計書は後で」と先送りすること
- 設計書の更新を別 Issue に切り出して本体を Done にすること

### アーキテクチャ図
- drawio 形式（`.drawio`）で `docs/design/diagrams/` に保存
- テキストベースの ASCII 図やマークダウン内の疑似図は禁止

## ADR (Architecture Decision Records)

重要な意思決定・教訓・仕様は `docs/decisions/` に ADR として記録する。

- 新規作成: `docs/decisions/NNNN-kebab-case-title.md`（テンプレートは `docs/decisions/README.md` 参照）
- 記録すべきもの: 技術選定の根拠、過去のインシデントの教訓、機能仕様の正仕様、品質プロセスの決定
- Claude Code の memory はユーザーローカル。チームで共有すべき知識は必ず ADR に置く
- ADR 追加/変更時は CLAUDE.md と `.github/copilot-instructions.md` も同時更新すること

### 現在の ADR 一覧（#1262 sub-A + sub-B 完了時点 + #1307 umbrella 派生で追加中）

- [ADR-0001](decisions/0001-design-doc-as-source-of-truth.md) — 設計書は Single Source of Truth
- [ADR-0002](decisions/0002-critical-fix-quality-gate.md) — Critical 修正の品質ゲート
- [ADR-0003](decisions/0003-issue-quality-standard.md) — Issue 起票・クローズ品質（根本原因 + 構造的解決）
- [ADR-0004](decisions/0004-review-and-ac-verification.md) — レビュー & AC 検証品質
- [ADR-0005](decisions/0005-test-quality-ratchet.md) — テスト品質 ratchet
- [ADR-0006](decisions/0006-safety-assertion-erosion-ban.md) — Safety Assertion Erosion Ban
- [ADR-0007](decisions/0007-static-analysis-tier-policy.md) — 静的解析 tier ポリシー (T1/T2/T3/T4)
- [ADR-0008](decisions/0008-design-policy-pre-approval.md) — 設計ポリシー先行確認フロー
- [ADR-0009](decisions/0009-labels-ssot-principle.md) — labels.ts SSOT 化原則
- [ADR-0010](decisions/0010-pre-pmf-scope-judgment.md) — Pre-PMF スコープ判断（3 バケット + セキュリティ最小化 + 優先度）
- [ADR-0011](decisions/0011-baby-mode-as-parent-preparation.md) — 0-2 歳 baby モードは「親の準備モード」（コアターゲット 3-18 歳に再定義）（#1299）
- [ADR-0012](decisions/0012-anti-engagement-principle.md) — Anti-engagement 原則（滞在時間 = 価値毀損）（#1309）
- [ADR-0013](decisions/0013-lp-truth-from-implementation.md) — LP 文言は実装の事実を SSOT とする（Committed/Aspirational 分離）（#1310）
- [ADR-0014](decisions/0014-labels-i18n-mechanism.md) — labels / i18n 機構選定（OSS 先調査）（proposed, #1346）
- [ADR-0015](decisions/0015-age-tier-variant-architecture.md) — 年齢帯 variant 管理アーキテクチャ（proposed, #1353）
- [ADR-0016](decisions/0016-japanese-text-wrap.md) — 日本語テキスト折り返し方針（proposed, #1353）
- [ADR-0017](decisions/0017-cognito-pool-recreation-email-mutable.md) — Cognito User Pool 再作成による email mutable 化（**rejected — deploy failed 2026-04-21**, superseded by ADR-0018）
- [ADR-0018](decisions/0018-cognito-user-pool-logical-id-replacement.md) — Cognito User Pool 論理 ID 変更による明示的 Replacement（accepted, #1366 再設計, 2026-04-21）
- [ADR-0019](decisions/0019-cdk-replacement-detection-gate.md) — CDK Replacement Detection Gate（accepted）
- [ADR-0020](decisions/0020-nuc-scheduler-choice.md) — NUC スケジューラ方式選定（node-cron + 専用コンテナ）（accepted, #1375, 2026-04-24）
- [ADR-0021](decisions/0021-cognito-pool-migration-user-preservation.md) — Cognito Pool 移行におけるユーザー保全戦略（email natural key + export/import scripts）（accepted, #1399, 2026-04-24）

> **注**: #1307 (B9) / #1298 (B3) / #1346 (labels/i18n) / #1353 (variant/text-wrap) / #1366 (Cognito email) 派生で ADR-0011〜0018 が同時期に提案されている。ADR-0017 は Rejected で 0018 に supersede 済み (active 件数には ADR-0017 は含めない扱い)。10 枠上限ルールの 1-in-1-out は、まとまって merge されるタイミングでまとめて棚卸する（PO 判断）。本 CLAUDE.md の 10-active 表現は一時的に 11+ に膨らむ可能性がある。
>
> 旧 0001-0044 のうち 25 件は `docs/decisions/archive/` に移動済み（archive ヘッダで supersede 先を明示）、5 件（旧 0002 / 0008 / 0009 / 0016 / 0027）は supersede chain 終端のため削除済み。詳細は `docs/decisions/README.md` と [adr-inventory-2026-04-20.md](decisions/adr-inventory-2026-04-20.md) を参照。

## ADR 棚卸レポート

- [adr-inventory-2026-04-19.md](decisions/adr-inventory-2026-04-19.md) — 旧 0001〜0039 の棚卸。0008 / 0009 / 0016 を supersede、active-primary 12 件特定
- [adr-inventory-2026-04-20.md](decisions/adr-inventory-2026-04-20.md) — 新体系 0001-0010 + archive 25 件の最終棚卸（#1262 sub-7 完了）

## Issue 起票・チケット運用ルール

Issue の起票運用・テンプレート（Blocked by / Blocks / Related / 工程区分 phase dropdown）・admin bypass 証跡等のルールは [`.github/CLAUDE.md`](../.github/CLAUDE.md) を SSOT とする。特に以下は設計書更新と密接に関わるため押さえておくこと:

- **依存関係 3 分割フィールド** (`blocked_by` / `blocks` / `related`) — 起票時に「待つべき Issue」「自分が詰まるとブロックする Issue」「参考のみ」を分離する（#1261）
- **工程区分 dropdown** (P0-P7 / N/A) — 下流 Phase は上流 Phase が閉じるまで着手しない（ADR / 企画 / アーキ未確定のまま実装に進まない）
- Pre-PMF スコープ判断（ADR-0010）/ レビュー & AC 検証品質（ADR-0004）/ Issue 起票・クローズ品質（ADR-0003）

## ローカル Cognito 認証検証環境 (#1026)

認証が絡む画面（login / signup / 管理画面 / ops / プラン別 UI）を目視検証するには `npm run dev:cognito` を使う。
`npm run dev` の自動認証モードでは `/auth/login` が 302 redirect されてログインフォームが描画されず、UI 検証に使えない。

### 起動

```bash
npm run dev:cognito
# → AUTH_MODE=cognito COGNITO_DEV_MODE=true vite dev --port 5174 --strictPort
# → http://localhost:5174 で Cognito モック認証が有効
# → 既に 5174 が使用中だと即 fail する（--strictPort: #1168 で 5175 fallback の 500 回避）
```

### DEV_USERS 一覧

| email | password | role | licenseStatus | plan | groups | 用途 |
|-------|----------|------|---------------|------|--------|------|
| `owner@example.com` | `Gq!Dev#Owner2026x` | owner | default (active) | - | - | 親管理画面の標準動作確認 |
| `parent@example.com` | `Gq!Dev#Parent2026` | parent | default | - | - | 親ロール (非オーナー) 動作確認 |
| `child@example.com` | `Gq!Dev#Child2026x` | child | default | - | - | 子供画面動作確認 |
| `free@example.com` | `Gq!Dev#Free2026xy` | owner | `none` | なし | - | Free プランの機能ゲート確認 (#751) |
| `standard@example.com` | `Gq!Dev#Std2026xyz` | owner | `active` | `standard_monthly` | - | Standard プラン機能疎通確認 (#779) |
| `family@example.com` | `Gq!Dev#Fam2026xyz` | owner | `active` | `family_monthly` | - | Family プラン機能疎通確認 (#779) |
| `trial-expired@example.com` | `Gq!Dev#TrialExp26` | owner | `none` | なし | - | トライアル期限切れフロー確認 (#752) |
| `ops@example.com` | `Gq!Dev#Ops2026xyz` | owner | default | - | `ops` | /ops ダッシュボード認可確認 (#820) |

(SSOT: `src/lib/server/auth/providers/cognito-dev.ts` の `DEV_USERS` 定義。追加・変更時は本表も更新すること)

### いつ使うか

- 認証が絡む画面を変更する PR の **Ready for Review 前のセルフチェック必須**
- スクリーンショットを PR 本文に添付する際の撮影源（`npm run dev` で撮ると本来の画面が撮れない）
- ログイン / サインアップ / パスワードリセット / ops group / プラン別 UI / 管理画面のどれかに触る場合は必ず起動

## 画像アセット

画像アセットを絵文字で代替してはならない（コアゲーム体験に関わるもの）。
判断基準・アセットカタログ・生成方法は `docs/design/asset-catalog.md` を参照。
Gemini API 画像生成ガイド: `docs/reference/gemini_image_generation_guide.md`
