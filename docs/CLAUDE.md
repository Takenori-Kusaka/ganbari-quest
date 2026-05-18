# docs/ — 設計書・ADR・画像アセット管理

**SSOT**: ADR 一覧 → @docs/decisions/README.md / 画像アセット → @docs/design/asset-catalog.md / 撮影 KB → @docs/troubleshoot/screenshot_capture.md / CI 失敗 KB → @docs/troubleshoot/github_actions.md

## 設計書更新ルール（ADR-0001、Done 基準に含む）

設計書は実装の SSOT。書かれていない仕様は「存在しない仕様」と同じ。会話で決まった仕様は必ず設計書に反映する（Issue 起票だけでは不十分）。

| 変更種別 | 更新すべき設計書 |
|---|---|
| API エンドポイント | `07-API設計書.md` |
| DB テーブル・カラム | `08-データベース設計書.md` |
| UI 機能・画面・オーバーレイ | `06-UI設計書.md` |
| UI プラン仕様 (#743) | `06-UI設計書.md §10` |
| アカウント削除フロー (#746) | `account-deletion-flow.md` |
| プラン変更フロー (#747) | `plan-change-flow.md` |
| AWS インフラ | `13-AWSサーバレスアーキテクチャ設計書.md` |
| 認証・セキュリティ | `14-セキュリティ設計書.md` |
| デザイン・ビジュアル | `15-ブランドガイドライン.md` |
| LP IA (#1163) | `lp-content-map.md` |
| LP sitemap.xml (#1908) | 自動生成: `scripts/generate-sitemap.mjs` (pages.yml main push 毎再生成、手動編集禁止) |

**禁忌**: 会話で確定した仕様を反映せずに実装進行 / 「設計書は後で」と先送り / 設計書更新を別 Issue 切出しで本体 Done。アーキ図は drawio (`docs/design/diagrams/`)、ASCII 図禁止。

## LP メトリクス ratchet (#1163)

`site/**` 変更 PR は `scripts/measure-lp-dimensions.mjs` の閾値必達。CI (`lp-metrics.yml`) 自動 FAIL:

| 指標 | 閾値 | 方針 |
|---|---|---|
| `mobileHeight` | 15000 px | 引上げ禁止 |
| `desktopHeight` | 8000 px | 同上 |
| `desktopHeightWarn` (#1840) | 7800 px | 累積 gate warning 帯 |
| `forbiddenTerms` | 0 | 開発者語彙 / 射幸性語彙の追加禁止 |
| `ctaVariants` | 3 以下 | `無料で始める` / `デモを見る` / `ログイン` の 3 種のみ |
| `presetActivityCountClaimedMin` (#1803) | 300 以上 | LP 訴求 ≤ 実数 (ADR-0013 LP truth) |
| `lp-removal-residue` (#1790) | 新規違反 0 | baseline 19 件、新規 1 件で fail |
| `lp-inline-style` (#1851) | baseline 超過 0 | `--lp-*` Semantic トークン未経由の padding/margin 直書き、新規 1 件で fail (ADR-0042 Phase 2) |

閾値緩和は ADR 合意後に `THRESHOLDS` / `lp-removal-residue-baseline.json` / `lp-inline-style-baseline.json` 更新。

### LP 累積 desktopHeight gate (#1840)

`cumulative-lp-metrics` ジョブ: PR HEAD checkout → `git merge --no-commit --no-ff origin/main` → `measure-lp-dimensions.mjs` で擬似 main 累積を計測。8000 超で fail / 7800-8000 で warning。Phase 1 は warn-only (`continue-on-error: true`)、Phase 2 で required 化判断。

conflict 時は判定 skip + warning 通知（PR 側で main rebase 必要）。詳細は ADR-0042 / `lp-metrics.yml`。

## ADR 管理

- 作成: `docs/decisions/NNNN-kebab-case-title.md`（テンプレート: `docs/decisions/README.md`）
- 記録対象: 技術選定根拠 / インシデント教訓 / 機能仕様の正仕様 / 品質プロセス決定
- Claude Code memory はユーザーローカル。**チーム共有知識は必ず ADR に置く**
- ADR 追加/変更時は CLAUDE.md / `.github/copilot-instructions.md` も同時更新

**ADR 一覧の SSOT**: [`docs/decisions/README.md`](decisions/README.md)（インベントリ + supersede 関係）。本ファイルでは個別の ADR 番号は列挙しない。

## 設計書 3 部構成化原則 (#1329)

新規・改訂設計書は §1 設計背景 / §2 設計原則 / §3 仕様以降 の 3 部構成必須。背景には「この設計がなかった場合に何が困るか」を記述。`docs/design/_template.md` を骨格に使用。既存設計書も改訂時に §1-§2 を追加（後回し禁止）。

適用済み: `01-企画書.md` / `26-ゲーミフィケーション設計書.md` / `34-V2MOM.md`。漸進適用: `06-UI設計書.md` / `07-API設計書.md` / `08-データベース設計書.md` / `15-ブランドガイドライン.md`。

## 機能別 rationale (`docs/rationale/`)

ADR (横断ポリシー) と設計書 (結論) の間に「なぜそう決めたか」を保存する層。複数代替案の比較・棄却理由・残懸念など narrative を記録。命名: `NN-機能名-rationale.md`。テンプレート / 運用ルール: `docs/rationale/01-README.md`。

書くタイミング: ① 複雑な新機能実装 / ② 既存機能の大方向転換 / ③ 過去議論再発の兆し。軽微変更には不要。

**使い分け**: 横断ポリシー → ADR / 機能仕様の結論 → 設計書 / 機能設計の経緯・理由 → rationale / ユーザーローカル作業メモ → memory（チーム共有不可）

## ローカル Cognito 認証検証環境 (#1026)

認証画面 (login / signup / 管理 / ops / プラン別 UI) は `npm run dev:cognito` を使う（`npm run dev` は `/auth/login` を 302 redirect）。

```bash
npm run dev:cognito         # AUTH_MODE=cognito + COGNITO_DEV_MODE=true、port 5174 (--strictPort)
npm run dev:cognito-signup  # signup ページは COGNITO_DEV_MODE 無しが必要
```

`DEV_USERS` SSOT: `src/lib/server/auth/providers/cognito-dev.ts`。owner / parent / child / free / standard / family / trial-expired / ops の 8 アカウントが定義されている（password / role / プラン状態は SSOT 参照）。

使用必須: 認証画面変更 PR の Ready 前 / SS 撮影 / login / signup / ops group / プラン別 UI / 管理画面の変更時。

## 巨大 docs refactor PR 分割ガイドライン (#2225)

#2223 (Epic 2 / 142 file) / #2224 (Epic 3 / 146 file) で連続発生した「docs/sessions/ SSOT 削除 + 60+ ファイル参照未更新 + 機械生成ツール暴走」(両 PR BLOCK / Close) の構造的再発防止。

| ルール | 内容 |
|---|---|
| **50 ファイル超で警告 / 100 ファイル超で BLOCK** | docs/ 配下の変更ファイル数が 50 超で QM レビュー警告、100 超は Epic 級として事前分割必須 (5-10 PR 推奨、Stacked PR 推奨) |
| **SSOT ファイル削除は別 PR 必須** | `docs/sessions/*` / `docs/decisions/*` / `*CLAUDE.md` の削除は移動先を別 PR で先に整備してから削除。同一 PR で削除 + rename + 参照更新を混ぜない |
| **機械生成ツール一括適用後は diff 全件目視レビュー** | textlint `--fix` / markdownlint `--fix` / prh は誤変換検知のため全 diff 目視必須。「ユーザーローカル → ユーザーーローカル」等の機械的誤変換 / `- - text` (CommonMark 仕様外) 等の不正整形を commit 前に検知 |
| **rename PR は参照リンク一括更新を同 PR で完結** | `grep -r "<old path>"` で CLAUDE.md / ADR / SKILL.md / scripts / `.github/` 全件洗い出し → 同一 PR 内で全参照更新。「rename だけ先 commit、参照更新は次 PR」を禁止 |

### 該当 Issue 起票時の確認手順

1. 変更予定 docs/ ファイル数を事前見積 (50 超なら起票時点で分割計画を Issue 本文に明記)
2. SSOT ファイル削除を含む場合は「移動先 PR 番号」を Blocked by に記載 (上流の移動先 PR が merge 済みになるまで削除 PR を着手しない)
3. 機械生成ツールを使う場合は事前に dry-run + diff 件数確認、100 件超の一括適用は分割 commit 推奨

詳細: `feedback_qm_continuous_responsibility.md` / Issue #2225 の Phase 2 (CI gate スクリプト「check-large-docs-pr」「check-ssot-deletion」を `scripts/` 配下に追加予定、未実装) と Phase 3 (`.github/PULL_REQUEST_TEMPLATE.md` 「巨大変更時の分割計画」セクション追加) は別 follow-up Issue で段階導入判断。

## サブディレクトリ別局所テストコマンド SSOT (#2184)

Anthropic 公式「サブディレクトリごとに適切なテスト・リント範囲を限定」整合 + Claude Code セッションで context 効率化。全体実行 (`npm run test` / `npm run pre-ready`) を待たずに局所変更を高速検証可能化。

| サブディレクトリ | 局所テストコマンド | 用途 |
|---|---|---|
| `src/routes/` | `npx vitest run src/routes/` | routes 配下の unit test |
| `src/lib/server/services/` | `npx vitest run src/lib/server/services/` | service 層 unit test |
| `src/lib/server/db/` | `npx vitest run src/lib/server/db/` | DB 層 unit test |
| `src/lib/domain/` | `npx vitest run src/lib/domain/` | domain 層 unit test |
| `src/lib/ui/` | `npx vitest run src/lib/ui/` | UI primitives / components unit test |
| `tests/unit/` | `npx vitest run tests/unit/<subdir>/` | unit test 個別実行 |
| `tests/e2e/` | `npx playwright test tests/e2e/<spec>.spec.ts` | E2E 個別 spec 実行 |
| `infra/` | `cd infra && npx vitest run` | CDK 単体テスト (該当時) |

**SSOT 原則**: 各 CLAUDE.md は自分のディレクトリの局所コマンドを明示する。本表が全体 SSOT、各 CLAUDE.md は本表のサブセットを抜粋。`package.json` への専用 script 大量追加は不採用 (肥大化回避、CLI 直接実行で十分)。

## Issue 運用 SSOT

Issue 起票運用・依存 3 分割 / 工程 phase / admin bypass 等は [.github/CLAUDE.md](../.github/CLAUDE.md) が SSOT。特に設計書同期に直結:

- 依存 3 分割 (`blocked_by` / `blocks` / `related`) — #1261
- 工程 phase (P0-P7 / N/A) — 下流は上流 close まで着手しない
- ADR-0010 Pre-PMF / ADR-0004 AC 検証 / ADR-0003 Issue 品質
