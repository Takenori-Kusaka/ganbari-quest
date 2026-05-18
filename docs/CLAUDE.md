# docs/ — 設計書・ADR・画像アセット管理 (ドキュメントレイヤー)

**SSOT**: ADR 一覧 → @docs/decisions/README.md / 画像アセット → @docs/design/asset-catalog.md / 撮影 KB → @docs/troubleshoot/screenshot_capture.md / CI 失敗 KB → @docs/troubleshoot/github_actions.md

## 設計書更新ルール（ADR-0001、Done 基準に含む）

設計書は実装の SSOT。書かれていない仕様は「存在しない仕様」と同じ。会話で決まった仕様は必ず設計書に反映する（Issue 起票だけでは不十分）。

| 変更種別 | 更新すべき設計書 |
|---|---|
| API エンドポイント | `docs/engineering/API設計書.md` |
| DB テーブル・カラム | `docs/engineering/データベース設計書.md` |
| UI 機能・画面 | `docs/engineering/UI設計書.md` |
| アカウント削除フロー | `docs/engineering/account-deletion-flow.md` |
| プラン変更フロー | `docs/engineering/plan-change-flow.md` |
| AWS インフラ | `docs/architecture/AWSサーバレスアーキテクチャ設計書.md` |
| 認証・セキュリティ | `docs/engineering/セキュリティ設計書.md` |
| デザイン・ビジュアル | `DESIGN.md` (ルート) および `docs/product/ブランドガイドライン.md` |
| LP IA | `docs/engineering/lp-content-map.md` |
| LP sitemap.xml | 自動生成: `scripts/generate-sitemap.mjs` |

**禁忌**: 会話で確定した仕様を反映せずに実装進行 / 「設計書は後で」と先送り / 設計書更新を別 Issue 切出しで本体 Done。アーキ図は drawio を使用、ASCII 図禁止。

## LP メトリクス ratchet (#1163)

`site/**` 変更 PR は `scripts/measure-lp-dimensions.mjs` の閾値必達。CI (`lp-metrics.yml`) 自動 FAIL:
- `mobileHeight` 15000 px 以下
- `desktopHeight` 8000 px 以下
- `forbiddenTerms` 0
- `ctaVariants` 3 以下

## ADR 管理

- 作成: `docs/decisions/NNNN-kebab-case-title.md`
- 記録対象: 技術選定根拠 / インシデント教訓 / 機能仕様の正仕様 / 品質プロセス決定
- チーム共有知識は必ず ADR に置くこと（ローカルのメモリには置かない）。
- **ADR 一覧の SSOT**: `docs/decisions/README.md`

## 設計書 3 部構成化原則 (#1329)

新規・改訂設計書は §1 設計背景 / §2 設計原則 / §3 仕様以降 の 3 部構成必須。
背景には「この設計がなかった場合に何が困るか」を記述。

## 機能別 rationale (`docs/rationale/`)

ADR (横断ポリシー) と設計書 (結論) の間に「なぜそう決めたか」を保存する層。
複数代替案の比較・棄却理由・残懸念など narrative を記録。

**使い分け**: 横断ポリシー → ADR / 機能仕様の結論 → 設計書 / 機能設計の経緯・理由 → rationale / ユーザーローカル作業メモ → memory（チーム共有不可）

## Issue 運用 SSOT

Issue 起票運用・依存 3 分割 / 工程 phase 等は `.github/CLAUDE.md` が SSOT。
