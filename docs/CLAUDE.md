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
| `forbiddenTerms` | 全 0 | 新規の開発者語彙 (`git clone` / `docker compose` / `SaaS版` / `セルフホスト版` / `TLS` / `AES-256` / `AWS`) を追加しない |
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

### 現在の ADR 一覧
- [ADR-0001](decisions/0001-rename-backward-compat.md) — リネーム時の後方互換必須
- ~~[ADR-0002](decisions/0002-dialog-queue-required.md)~~ — ~~ダイアログキュー必須~~ → **ADR-0016 で実装指針追加**
- [ADR-0003](decisions/0003-design-doc-as-source-of-truth.md) — 設計書は Single Source of Truth
- [ADR-0004](decisions/0004-stamp-card-spec.md) — スタンプカード正仕様
- [ADR-0005](decisions/0005-critical-fix-quality-gate.md) — Critical 修正の品質ゲート
- [ADR-0006](decisions/0006-pr-review-must-document-findings.md) — PRレビューは文書化された指摘を必ず出力する
- [ADR-0007](decisions/0007-image-asset-protection.md) — 画像アセットを絵文字に戻すことは明示的デグレ
- ~~[ADR-0008](decisions/0008-age-mode-duplication-risk.md)~~ — ~~年齢モード5重複の変更リスク管理~~ → **#567 統合完了により 2026-04-19 supersede**
- ~~[ADR-0009](decisions/0009-server-client-type-contract.md)~~ — ~~server→client 型契約の安全性確保~~ → **2026-04-19 supersede（短期ガードは #567 完了で不要化、中期施策は ADR-0037/0031 で運用中）**
- [ADR-0010](decisions/0010-issue-close-quality.md) — Issue 起票・クローズの品質基準
- [ADR-0011](decisions/0011-sveltekit-svelte5.md) — SvelteKit 2 + Svelte 5 (Runes) 採用
- [ADR-0012](decisions/0012-dynamodb-single-table.md) — DynamoDB シングルテーブル設計
- [ADR-0013](decisions/0013-cognito-google-oauth.md) — Cognito + Google OAuth 認証
- [ADR-0014](decisions/0014-css-token-architecture.md) — 3層 CSS トークンアーキテクチャ
- [ADR-0015](decisions/0015-repository-pattern.md) — Repository パターンによる DB 抽象化
- ~~[ADR-0016](decisions/0016-dialog-overlay-management.md)~~ — ~~ダイアログ/オーバーレイの状態管理方針~~ → **ADR-0019 で 2026-04-19 supersede（OverlaysSection 内部キューは FSM に置換済み）**
- [ADR-0017](decisions/0017-test-quality-ratchet.md) — テスト品質の劣化を許容しない開発プロセス
- [ADR-0018](decisions/0018-issue-quality-standard.md) — Issue 起票は根本原因の特定と構造的解決策の提示を必須とする
- [ADR-0019](decisions/0019-dialog-fsm-scrap-and-rebuild.md) — ダイアログ管理は FSM でスクラップ＆ビルド
- [ADR-0020](decisions/0020-test-quality-ratchet-enforcement.md) — テスト品質の劣化を許容しない（強制プロセス）
- [ADR-0021](decisions/0021-deploy-verification-gate.md) — デプロイ検証ゲート（Issue完了前の本番確認必須化）
- [ADR-0022](decisions/0022-billing-data-lifecycle-consistency.md) — 課金サイクルとデータライフサイクルの整合性（アカウント削除時は Stripe を先にキャンセル）
- [ADR-0023](decisions/0023-pre-pmf-issue-priority-guidelines.md) — Pre-PMF Issue 優先度判断基準（エンジニアバイアス防止）
- [ADR-0024](decisions/0024-plan-tier-resolution-pattern.md) — プラン解決 (resolvePlanTier) の責務分離パターン
- [ADR-0025](decisions/0025-license-subscription-causality.md) — License ↔ Stripe Subscription 因果関係
- [ADR-0026](decisions/0026-license-key-architecture.md) — ライセンスキーアーキテクチャ
- ~~[ADR-0027](decisions/0027-retention-policy.md)~~ — ~~プラン別履歴保持期間ポリシー（retention = 表示フィルタ、物理削除禁止）~~ → **ADR-0028 で物理削除導入に変更**
- [ADR-0028](decisions/0028-retention-physical-delete.md) — プラン別履歴保持期間ポリシー（retention = 表示フィルタ + 物理削除 cron、ADR-0027 supersede）
- [ADR-0029](decisions/0029-safety-assertion-erosion-ban.md) — Safety Assertion Erosion Ban（既存セーフティの段階的弱体化を禁ずる + 新規 env/secret 配布証跡の自動チェック）
- [ADR-0030](decisions/0030-cognito-e2e-user-lifecycle.md) — Cognito E2E テストユーザーのライフサイクル基盤（Admin API バイパス採用、本番 User Pool を IAM で物理分離）
- [ADR-0031](decisions/0031-schema-change-compat-testing.md) — スキーマ変更時の既存データ互換性テスト義務化（NULL 混在行テスト + backfill UPDATE 必須）
- [ADR-0032](decisions/0032-static-analysis-tier-policy.md) — 静的解析ツール実行頻度ポリシー（T1 PR ゲート / T2 並行 / T3 nightly / T4 四半期、既存 CI baseline と新ツール判断フロー）
- [ADR-0033](decisions/0033-ops-dashboard-cognito-authz.md) — /ops ダッシュボード認可を Cognito ops group ベースに刷新（OPS_SECRET_KEY 廃止 / cron endpoint は CRON_SECRET に概念分離、移行期は両対応）
- [ADR-0034](decisions/0034-pre-pmf-security-minimum.md) — Pre-PMF セキュリティ最小化方針（HMAC + API Gateway throttling + Budgets / 監査ログ DynamoDB / WAF / ブルート検知は Pre-PMF では不採用）
- [ADR-0035](decisions/0035-design-policy-pre-approval.md) — 設計ポリシー先行確認フロー（新機能 / 新 interface は実装前に PO 合意を必須化）
- [ADR-0036](decisions/0036-marketplace-public-access.md) — マーケットプレイス公開アクセス設計（閲覧パブリック / インポート認証必須）
- [ADR-0037](decisions/0037-labels-ssot-principle.md) — 全ユーザー向け文言の SSOT 化原則（labels.ts + shared-labels.js を介さないハードコード禁止、BANNED_TERMS で CI 検出）
- [ADR-0038](decisions/0038-ac-verification-evidence.md) — AC 検証エビデンス必須化（Issue テンプレ ac-verification-plan / PR AC 検証マップ / CI による機械強制）
- [ADR-0039](decisions/0039-demo-mode-app-execution-mode.md) — デモモードをアプリ実行モードに統合（`?mode=demo` / `gq_demo` cookie / 本番ルート上で判定、`/demo/**` 別ルートを廃止）
- [ADR-0040](decisions/0040-runtime-mode-license-unified-architecture.md) — 実行モード × ライセンス統括アーキテクチャ（Typed env + EvaluationContext + Policy Gate の 3 層ハイブリッド）

## ADR 棚卸レポート

- [adr-inventory-2026-04-19.md](decisions/adr-inventory-2026-04-19.md) — 0001〜0039 の棚卸。0008 / 0009 / 0016 を supersede、active-primary 12 件特定

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
