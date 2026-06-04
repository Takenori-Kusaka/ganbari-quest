# Codebase Map — がんばりクエスト

> **AI エージェント・新規貢献者へ**: このファイルは「**どこに何があるか**」を 1 ファイルで俯瞰する SSOT。
> Claude Code session 初期 (`CLAUDE.md` auto-load 後) でこのファイルを参照すれば、目的地への最短経路が分かる。
> 詳細は各ディレクトリの `CLAUDE.md` に link しているのでそちらを参照。

**関連 Issue**: #2185 / **関連 ADR**: ADR-0001 (設計書 SSOT)

---

## 1. トップレベル ディレクトリ

| ディレクトリ | 役割 | 局所 SSOT |
|---|---|---|
| `src/` | SvelteKit アプリケーション本体 (SvelteKit 2 + Svelte 5 Runes + TypeScript strict) | [src/routes/CLAUDE.md](../src/routes/CLAUDE.md) |
| `tests/` | vitest (unit / integration) + Playwright (E2E) + helpers / fixtures | [tests/CLAUDE.md](../tests/CLAUDE.md) |
| `docs/` | 設計書 / ADR / rationale / runbooks / sessions ロール定義 | [docs/CLAUDE.md](CLAUDE.md) |
| `infra/` | AWS CDK 構成 (Lambda / DynamoDB / CloudFront / Cognito) + NUC ローカル構成 | [infra/CLAUDE.md](../infra/CLAUDE.md) |
| `site/` | LP (GitHub Pages 配信、`site/index.html` 等 10 ページ) + 共通 CSS / labels | (SSOT 統合: ADR-0013 LP truth / ADR-0042 LP Spacing) |
| `scripts/` | CI / dev / 検証用スクリプト (`capture.mjs` / `measure-lp-dimensions.mjs` / `pre-ready` 等 ~75 本) | (汎用化原則: 使い捨て禁止 #1442) |
| `.github/` | Issue Templates / workflows / PR Template / CODEOWNERS / Dependabot | [.github/CLAUDE.md](../.github/CLAUDE.md) |
| `.claude/` | Skills (13) / agents (3 = po/dev/qa session) / settings.json / worktrees | (各 skill が `SKILL.md` を持つ) |
| `static/` | 静的アセット (画像 / favicon / brand / manifest / sounds / tenants) | [docs/design/asset-catalog.md](design/asset-catalog.md) |
| `.storybook/` | Storybook 設定 (UI primitives 視覚回帰) | (運用: `npm run test:storybook` 必須化、#1168) |
| `eslint-plugin-local/` | プロジェクト固有 ESLint ルール | (Tier T2、ADR-0007) |

---

## 2. 主要サブディレクトリ (`src/` 配下)

| ディレクトリ | 役割 |
|---|---|
| `src/routes/` | ファイルベースルーティング: `(parent)` / `(child)` / `api/` / `demo/` / `auth/` / `ops/` / `marketplace/` / `legal/` / `setup/` / `consent/` / `survey/` / `view/` 等 → [src/routes/CLAUDE.md](../src/routes/CLAUDE.md) |
| `src/lib/server/` | サーバー専用: `db/` (Drizzle ORM) / `services/` (Service 層) / `auth/` (Cognito + local) / `security/` (rate-limiter) / `cron/` / `demo/` / `stripe/` / `routing/` (legacy-url-map) / `discord-alert.ts` / `logger.ts` |
| `src/lib/features/` | 機能別コンポーネント: `admin/` / `child-home/` / `value-preview/` / `auto-sleep/` / `battle/` / `birthday/` / `certificate/` / `challenge/` / `character/` / `child/` / `demo/` / `loyalty/` / `usage/` |
| `src/lib/ui/` | UI primitives + 共有 components: `primitives/` (Button / Card / Dialog / FormField 等、ADR-0009 / DESIGN.md §5) / `components/` (共通) / `sound/` / `styles/` (app.css = カラートークン SSOT) / `tutorial/` |
| `src/lib/domain/` | ドメイン: `labels.ts` (compound SSOT、ADR-0045) / `terms.ts` (atom SSOT) / `validation/` (age-tier 等) / 型定義 |
| `src/lib/policy/` | 認可ポリシー (`authorization.ts` の補助、ルート × ロール × ライセンス三軸判定) |
| `src/lib/runtime/` | 実行モード判定 (cognito / local / demo 環境) |
| `src/lib/analytics/` | 分析 (内部メトリクス、PMF 計測) |
| `src/lib/services/` | client-side service (BFF 呼び出しラッパ) |
| `src/lib/data/` | static data ロード (プリセット等) |
| `src/hooks.server.ts` | 全リクエスト前処理: 認証 / 認可 / セキュリティヘッダ / レートリミット |
| `src/service-worker.ts` | Service Worker (Push 通知 + offline) |
| `src/params/` | SvelteKit URL パラメータ matcher (`uiMode` 等) |
| `src/stories/` | Storybook stories (`*.stories.svelte`、STORYBOOK_LABELS 経由) |

---

## 3. 関連 SSOT 文書 (`docs/` 配下)

開発時に最も頻繁に参照するドキュメント:

| 文書 | 役割 |
|---|---|
| [docs/DESIGN.md](DESIGN.md) | デザインシステム SSOT (カラー 3 層トークン / primitives / 用語辞書 / 年齢帯 / z-index 階層) |
| [docs/decisions/README.md](decisions/README.md) | ADR インベントリ + supersede 関係 (TOP 10 active + archive) |
| [docs/design/parallel-implementations.md](design/parallel-implementations.md) | 並行実装ペア一覧 (修正前必須チェック: labels / 年齢モード / demo / ナビ / DB / チュートリアル) |
| [docs/sessions/po-session.md](sessions/po-session.md) | PO 補佐セッション (Issue 起票・優先度・事業判断) |
| [docs/sessions/dev-session.md](sessions/dev-session.md) | Dev セッション (実装・CI/CD・設計書同期、overall map) |
| [docs/sessions/dev-process/README.md](sessions/dev-process/README.md) | 開発プロセス運用知 各論 (完遂原則 / アンチパターン / QA fix / 並列 Agent / 調査規律 / 横展開、#2516) |
| [docs/sessions/qa-session.md](sessions/qa-session.md) | QA セッション (PR レビュー・品質ゲート) |
| [docs/sessions/branch-strategy.md](sessions/branch-strategy.md) | ブランチ戦略 SSOT (develop 二層 + gate 二層 + merge 責任分担、#2858) |
| [docs/sessions/audit-team.md](sessions/audit-team.md) | 外部品質監査チーム役割定義 SSOT (マネージャ + 8 チーム + ポリシー準拠判定、2 段 gate 境界、#2862 / EPIC #2861) |
| [docs/design/06-UI設計書.md](design/06-UI設計書.md) | UI 機能・画面・オーバーレイ仕様 |
| [docs/design/07-API設計書.md](design/07-API設計書.md) | API エンドポイント定義 |
| [docs/design/08-データベース設計書.md](design/08-データベース設計書.md) | DB テーブル・カラム仕様 |
| [docs/design/13-AWSサーバレスアーキテクチャ設計書.md](design/13-AWSサーバレスアーキテクチャ設計書.md) | AWS Lambda / DynamoDB / CloudFront 構成 |
| [docs/design/14-セキュリティ設計書.md](design/14-セキュリティ設計書.md) | 認可境界 / 認証 / セキュリティヘッダ / OWASP 対策 |
| [docs/design/15-ブランドガイドライン.md](design/15-ブランドガイドライン.md) | ブランド・ビジュアル詳細 |
| [docs/design/asset-catalog.md](design/asset-catalog.md) | 画像アセットカタログ |
| [docs/design/lp-content-map.md](design/lp-content-map.md) | LP IA (#1163) |
| [docs/reference/](reference/) | 技術リファレンス (ui_framework / backend_framework / gemini_image_generation_guide 等) |
| [docs/troubleshoot/](troubleshoot/) | トラブル対応 KB (screenshot_capture / github_actions 失敗) |
| [docs/rationale/](rationale/) | 機能別 rationale (なぜそう決めたか narrative) |
| [docs/runbooks/](runbooks/) | 運用 runbook (Stripe / 通知 / デプロイ) |
| [docs/research/](research/) | 調査資料 (Multi-Lambda / Demo / 比較分析) |
| [docs/operations/](operations/) | 運用ガイド |
| [docs/security/](security/) | セキュリティ補助文書 |

---

## 4. インフラ (`infra/` 配下)

| ディレクトリ / ファイル | 役割 |
|---|---|
| `infra/bin/` | CDK app entry point |
| `infra/lib/` | CDK Stack 定義 (ComputeStack / DataStack / NetworkStack 等) |
| `infra/lambda/` | Lambda Dockerfile / handler |
| `infra/cdk.json` | CDK 設定 (region / context) |
| `infra/error-pages/` | CloudFront カスタムエラーページ |
| `infra/gcp/` | GCP 連携 (Discord / 通知補助) |
| `infra/CLAUDE.md` | infra ローカル SSOT |

詳細: [infra/CLAUDE.md](../infra/CLAUDE.md) / [docs/design/13-AWSサーバレスアーキテクチャ設計書.md](design/13-AWSサーバレスアーキテクチャ設計書.md)

---

## 5. テスト (`tests/` 配下)

| ディレクトリ | 役割 |
|---|---|
| `tests/unit/` | vitest 単体テスト (Drizzle / Service / domain) |
| `tests/integration/` | API 統合テスト |
| `tests/e2e/` | Playwright E2E (5 年齢モード matrix / 認可境界 / 回帰) |
| `tests/fixtures/` | テストデータ |
| `tests/helpers/` | 共通ヘルパ (test-db.ts / global-setup 等) |
| `tests/CLAUDE.md` | テスト方針 SSOT (カバレッジ閾値・ADR-0005 / ADR-0006) |

詳細: [tests/CLAUDE.md](../tests/CLAUDE.md)

---

## 6. LP (`site/` 配下)

| ファイル / ディレクトリ | 役割 |
|---|---|
| `site/index.html` | LP トップ (hero / core-loop / machine-tour / soft-features / growth-roadmap / faq) |
| `site/pricing.html` | プラン比較・FAQ |
| `site/faq.html` | よくあるご質問 (full) |
| `site/pamphlet.html` | 1 枚パンフ |
| `site/selfhost.html` | NUC セルフホスト訴求 |
| `site/graduation.html` | 卒業ジャーニー訴求 |
| `site/privacy.html` / `terms.html` / `sla.html` / `tokushoho.html` | 法務文書 |
| `site/shared.css` | LP 共通 CSS (`:root` Base / Semantic spacing トークン、ADR-0042) |
| `site/shared-labels.js` | LP labels (terms.ts / labels.ts から `scripts/generate-lp-labels.mjs` で生成、ADR-0045) |
| `site/assets/` | LP 専用画像 (`trust-*.svg` / `cta-trust-*.svg` / hero 等) |
| `site/screenshots/` | LP 機能 SS (`scripts/capture-hp-screenshots.mjs` 自動撮影) |
| `site/sitemap.xml` | sitemap (`scripts/generate-sitemap.mjs` main push 毎再生成、#1908) |

---

## 7. 主要 NPM スクリプト

| コマンド | 役割 |
|---|---|
| `npm run dev` | 開発サーバー (port 5173、local モード) |
| `npm run dev:cognito` | Cognito 認証画面 (#1026、認証画面 PR Ready 前必須) |
| `npm run build` | SvelteKit production build |
| `npm run pre-ready -- --pr <num>` | Ready 化前 10 step 検証 (ADR-0030 / #1920) |
| `npx biome check .` | Biome lint (Tier T1) |
| `npx svelte-check` | Svelte 型チェック |
| `npx vitest run` | unit / integration テスト |
| `npx playwright test` | E2E テスト |
| `npm run test:storybook` | Storybook テスト (#1168) |
| `npm run capture` | SS 自動撮影 (`scripts/capture.mjs`) |
| `npm run capture:lp` | LP SS 撮影 (`scripts/capture-hp-screenshots.mjs`) |
| `npm run screenshots:lp` | LP 全グループ SS 撮影 |
| `npm run optimize:lp-images` | LP 画像最適化 (#1907) |
| `npm run generate:image` | 汎用画像生成 (Gemini) |
| `npm run generate:coreloop-summary` | core-loop summary 画像生成 (#1889) |

---

## 8. Claude 拡張 (`.claude/` 配下)

| ディレクトリ | 役割 |
|---|---|
| `.claude/agents/` | セッション ロール定義 (po-session.md / dev-session.md / qa-session.md、起動時自動活性化)。外部品質監査チームの役割定義は [docs/sessions/audit-team.md](sessions/audit-team.md) が SSOT (audit-manager + 8 チーム + ポリシー準拠判定、新設 skill = competitive-research / policy-compliance / audit-manager の 3 点に限定、実装は EPIC #2861 の B 系 sub-issue が担う) |
| `.claude/skills/` | タスク固有 Skills (14 件): `pr-review` / `issue-triage` / `pre-pmf-check` / `dev-open-pr` / `lp-review` / `db-migration` / `cost-review` / `age-mode-check` / `brand-check` / `customer-voice` / `deploy-verify` / `flake-hunt` / `regression-check` / **`impact-analysis`** (rename/モデル変更/大規模リファクタリングの Change Impact Analysis、4 layer 防御 + 21 カテゴリ checklist、2026-05-28 追加) |
| `.claude/settings.json` | 全体設定 (permissions / hooks / env) |
| `.claude/worktrees/` | 並行 Agent 用 worktree 分離 dir (Agent tool `isolation: "worktree"` 必須) |

各 Skill は `SKILL.md` を持ち、SSOT として用例・テンプレート・チェックリストを定義。

---

## 9. 役割マップ更新ルール

本ファイルはトップレベル ディレクトリ構造の SSOT。以下のタイミングで更新する:

- **新規トップレベル ディレクトリ追加時**: 必ず本ファイルに 1 行追記 + 役割記述
- **既存ディレクトリの大規模再編時**: 該当行を更新
- **新規 CLAUDE.md 追加時**: §1 / §2 の link を追加
- **新規 SSOT 文書 (docs/design 等) 追加時**: §3 に追記

### 4 半期 (3 ヶ月) ごとの retrospective

本ファイルは static な map ではなく、定期的な棚卸対象とする (CC-4 と統合):

- **3 ヶ月ごとに**: トップレベル / 主要サブディレクトリの整合性を確認、不要な記述・古い link を削除
- **コード変更時の同期忘れ対策**: PR レビューで「ディレクトリ追加・大規模再編があれば本ファイル更新確認」を 8 点チェックに追加 (4 半期 retrospective で適用検討)
- **次回 retrospective 予定**: 2026-08 (本ファイル作成: 2026-05)

---

## 10. クイック動線

| やりたいこと | 最初に見るファイル |
|---|---|
| 新規 UI 画面を作る | [docs/DESIGN.md](DESIGN.md) → [src/routes/CLAUDE.md](../src/routes/CLAUDE.md) |
| 用語 / ラベルを変える | [docs/DESIGN.md §6](DESIGN.md) → `src/lib/domain/terms.ts` (atom) → `src/lib/domain/labels.ts` (compound) |
| 認可ルールを変える | [docs/design/14-セキュリティ設計書.md §5](design/14-セキュリティ設計書.md) → `src/lib/policy/` |
| API エンドポイント追加 | [docs/design/07-API設計書.md](design/07-API設計書.md) → `src/routes/api/` → `src/lib/server/services/` |
| DB スキーマ変更 | [docs/design/08-データベース設計書.md](design/08-データベース設計書.md) → `src/lib/server/db/` + [parallel-implementations.md](design/parallel-implementations.md) |
| LP 文言を変える | [docs/DESIGN.md §6](DESIGN.md) → `src/lib/domain/labels.ts` → `scripts/generate-lp-labels.mjs` 再生成 |
| AWS インフラ変更 | [docs/design/13-AWSサーバレスアーキテクチャ設計書.md](design/13-AWSサーバレスアーキテクチャ設計書.md) → [infra/CLAUDE.md](../infra/CLAUDE.md) |
| Issue 起票 | [docs/sessions/po-session.md](sessions/po-session.md) + `.claude/skills/issue-triage/SKILL.md` |
| PR を出す | `.claude/skills/dev-open-pr/SKILL.md` + `npm run pre-ready -- --pr <num>` |
| PR レビュー | [docs/sessions/qa-session.md](sessions/qa-session.md) + `.claude/skills/pr-review/SKILL.md` |
| ADR 起票 | [docs/decisions/README.md](decisions/README.md) (10 枠 + 1-in-1-out + OSS 先調査ルール) |
