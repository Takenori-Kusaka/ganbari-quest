# LP デプロイパイプライン設計書

**関連 Issue**: #1157 / **前提 Issue**: #1164 (LP マイクロコピー) / **SSOT**: [lp-content-map.md](lp-content-map.md)

## 1. 目的

LP (`site/`) で使用するアプリ画面スクリーンショット (`site/screenshots/*.webp`) の
**最新性を CI で強制**し、手動運用による陳腐化リスクを排除する。

### 解決する問題

- 撮影スクリプト `scripts/capture-hp-screenshots.mjs` は手動実行前提で放置されやすい
- 2026-04-18 時点で PO から「LP のスクリーンショットが古いバージョンに見える」と指摘（#1157）
- LP の訴求力が古い UI のまま発信されると V2MOM Q2 サインアップ 20 名/月目標に直接影響

## 2. パイプライン構成

```
push to main
  └── .github/workflows/pages.yml が起動
       ├── checkout & npm ci
       ├── Playwright install (cache あり)
       ├── npm run build                       # SvelteKit を adapter-node でビルド
       ├── npm run preview --port 5173         # NODE_ENV=production で preview 起動
       │   └── AWS_LICENSE_SECRET はダミー値     # preview 起動に必須 (#806)
       ├── curl で preview 起動待機 (60s max)
       ├── node scripts/capture-hp-screenshots.mjs --webp
       │   └── BASE_URL=http://localhost:5173 で撮影
       ├── Verify: site/screenshots/*.webp が 20 枚以上
       │   └── 不足時は workflow fail (ADR-0006: 無言で古い画像を残さない)
       ├── actions/upload-pages-artifact@v5    # site/ 配下を artifact に同梱
       └── actions/deploy-pages@v5              # GitHub Pages に反映
```

### トリガ条件

以下のいずれかで起動:

- `site/**` の変更（LP 本体の変更）
- `src/**` の変更（アプリ画面に影響する可能性）
- `scripts/capture-hp-screenshots.mjs` の変更
- `.github/workflows/pages.yml` の変更
- `workflow_dispatch` (手動起動)

## 3. git 管理方針

### `site/screenshots/` は git 管理対象外

- `.gitignore` に `site/screenshots/` を追加（#1157）
- **理由**: CI 内で毎回生成するため、commit 履歴に含める必要がない。含めると diff ノイズ + 陳腐化リスク再発
- 既存の commit 済み `site/screenshots/*.webp` は本 Issue で削除（36 ファイル）
- ローカル開発で撮影する場合も gitignored として扱う

### LP ソース本体はコミット

- `site/index.html` / `site/pamphlet.html` / `site/shared-labels.js` / `site/assets/` は引き続き git 管理
- スクリーンショット参照パス (`./screenshots/feature-xxx.webp`) は相対パスのまま変更なし

## 4. 撮影失敗時の挙動（ADR-0006 準拠）

| 事象 | 挙動 | 理由 |
|------|------|------|
| preview 起動失敗（60s timeout） | workflow fail | 撮影前提が崩れているため silent にできない |
| 撮影スクリプト exit code ≠ 0 | workflow fail | 一部でも失敗したら古い artifact を混ぜない |
| 生成された WebP が 20 枚未満 | workflow fail | 定義変更の可能性 — 明示的な更新を求める |

**閾値 20 枚の根拠**: 2026-04-18 時点のスクリーンショット定義（carousel 4×2 + feature 6×2 + age 5×3 = 36 枚想定）の下限バッファ。定義を減らす場合は本設計書と閾値を同時更新。

## 5. 既存 CI との関係

| 既存 workflow | 役割 | 本設計との関係 |
|--------------|------|---------------|
| `ci.yml` の e2e-test | Playwright で `npm run preview` 起動して E2E | 同じ preview + AWS_LICENSE_SECRET ダミー値パターンを踏襲 |
| `pr-ui-check.yml` | PR 本文にスクショ添付を強制 | 開発者セルフレビュー用途。本パイプラインは deploy 用途 |
| `lp-metrics.yml` | LP の寸法・禁止ワード・CTA 数を検証 | 本パイプラインとは独立 (source 側のガード) |

## 6. ローカル開発手順

スクリーンショット差分を事前確認したいとき:

```bash
npm run build
AWS_LICENSE_SECRET=local-dummy npm run preview -- --port 5173 &
BASE_URL=http://localhost:5173 node scripts/capture-hp-screenshots.mjs --webp
# → site/screenshots/*.webp が生成される (gitignored)
```

`npm run dev` は `/auth/login` を 302 redirect するため NG (#1026)。必ず preview build を使う。

## 7. 将来の拡張ポイント

- **PR ごとのプレビュー**: 現状 main push のみ。将来的に `deploy-preview.yml` を追加して PR ごとに preview URL を発行することも検討可能
- **差分検知**: 前回撮影との画像差分（Playwright snapshot）を保存して variation 検知する仕組みは未実装。#1162 系 Epic の次フェーズで検討
- **Cost Audit**: GitHub Actions 分数の増加が問題になった場合、`cost-audit.yml` に `pages.yml` の所要時間を計上する（現状 +5 分以内が AC 制約）

## 8. Acceptance Criteria 対応表（#1157）

| AC | 対応 |
|----|------|
| `pages.yml` に screenshot capture step を追加 | §2 参照。`Capture LP screenshots` step を追加 |
| 撮影 screenshot が Pages デプロイに含まれる | `site/` を `upload-pages-artifact` でアップロード（既存通り） |
| `site/screenshots/` を `.gitignore` に追加 | §3 参照 |
| 既存の commit 済み screenshot を削除 | 本 PR で 36 ファイルを `git rm` |
| LP デプロイ後、最新スクリーンショットが表示される | 手動確認 (PR merge 後 Pages URL で検証) |
| ワークフロー所要時間増加 +5 分以内 | preview 起動（~30s）+ 撮影（~3 分想定）で想定内 |
| 撮影失敗時は workflow fail | §4 参照。3 段階の fail 条件で担保 |
| 設計書更新 | 本ドキュメント |
