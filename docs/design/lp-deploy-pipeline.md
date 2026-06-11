# LP デプロイパイプライン設計書

**関連 Issue**: #1157 / **前提 Issue**: #1164 (LP マイクロコピー) / **拡張 Issue**: #1893 (demo seed 刷新 + `?screenshot=all` mode + 鮮度 CI、PO-4-7) / **SSOT**: [lp-content-map.md](lp-content-map.md)

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

## 6.5 `?screenshot` mode 仕様 (#1893)

LP 配信 SS が本番 NUC ユーザの実画面と乖離する問題（PO 直接指摘 8 回連続再発）への構造的解決として、
demo (`/demo/**`) 配下に 3 段階の `?screenshot` mode を導入。SSOT は `src/routes/demo/+layout.svelte`
の 1 箇所、配下は `getScreenshotMode()` / `getScreenshotModeKind()` で参照する。詳細は
[src/routes/CLAUDE.md](../../src/routes/CLAUDE.md) §「demo 配下の `?screenshot` モード」も併読。

| URL パラメータ | mode 値 | demo 固有 UI | 本番一致演出 (MilestoneBanner 等) | 用途 |
|---|---|---|---|---|
| (なし) | `'off'` | 表示 | 通常 (localStorage 依存) | 通常デモ表示 |
| `?screenshot=1` | `'noise-only'` | **非表示** | 通常 (localStorage 依存) | 旧挙動、後方互換 |
| `?screenshot=all` | `'all'` | **非表示** | **強制 ON (`bypassSeenCheck`)** | LP 配信 SS 用 (#1893 で追加) |

### `?screenshot=all` の責務

- `MilestoneBanner` を `bypassSeenCheck` prop で localStorage 無視で強制表示（demo (child) layout で `records_10` 達成済 milestone を生成）
- demo seed (`src/lib/server/demo/demo-data.ts`) の 902 番ペルソナは「ひなちゃん」（旧「ゆうきちゃん」、13 日分活動ログ ≥ 10 件で `records_10` マイルストーン達成済）に固定し、本番 NUC ユーザ視覚と一致させる
- `scripts/capture-hp-screenshots.mjs` の `withScreenshotParam(path)` のデフォルトは `screenshot=all` (#1893 で変更)。後方互換で `?screenshot=1` (noise-only) が必要な場合は `withScreenshotParam(path, { mode: 'noise-only' })` を使う

### 日付依存演出の抑止（決定的撮影、#3017）

screenshot mode の「演出強制 ON」は **撮影日に依らず決定的に再現可能な演出のみ** を対象とする。撮影日で表示が変わる日付依存演出は、visual regression baseline (LP / child-home / app の 3 層、[docs/CLAUDE.md §visual regression 3 層](../CLAUDE.md)) との比較決定性を壊すため、screenshot mode 中（`noise-only` / `all` 両方）は **OFF** にする。

- **誕生日ボーナス banner** (`BirthdayBanner`、子供 home 最上部): demo fixture 5 子の birthDate は固定のため、撮影日が誕生日 window（誕生日から 3 日間、`birthday-bonus-service.ts` の `CLAIM_WINDOW_DAYS`）に入ると banner が全要素を押し下げ、baseline と diff >10% で誤 fail する。`src/routes/(child)/[uiMode=uiMode]/home/+page.svelte` で `isScreenshotMode` 中は非 render（通常表示の挙動は不変）
- 回帰検証: `tests/e2e/demo-lambda/visual-equality.spec.ts` が `?screenshot=all` / `?screenshot=1` で `birthday-banner` testid 0 件を assert
- 新規の日付依存演出（季節・記念日等）を子供画面に追加する場合は、同様に screenshot mode 中の抑止を併せて実装する

### 並行実装

`?screenshot` mode 仕様変更時は以下を同時更新する（[parallel-implementations.md](parallel-implementations.md)）:

- `src/lib/features/demo/screenshot-mode.ts` — `ScreenshotMode` 型定義 + `resolveScreenshotMode()`
- `src/routes/demo/+layout.svelte` — `setScreenshotModeContext(getter, modeGetter)` の context 配置
- `src/routes/demo/(child)/+layout.svelte` — `?screenshot=all` 時の本番一致演出（`MilestoneBanner` 等）
- `scripts/lib/screenshot-helpers.mjs` — `SCREENSHOT_QUERY` / `withScreenshotParam` の default
- `tests/e2e/demo-screenshot-mode.spec.ts` — E2E 検証（後方互換含む）

## 6.6 SS 鮮度 CI gate (#1893)

LP 配信 WebP が「撮影が黙ってスキップされて古い画像が GitHub Pages に配信される」事故への構造的ガード。
`scripts/check-screenshot-freshness.mjs` を `pages.yml` の `Capture LP screenshots` 直後に追加。

### ジョブ仕様

| 項目 | 値 |
|---|---|
| script | `scripts/check-screenshot-freshness.mjs` |
| 対象 | `site/screenshots/*.webp` 全件 |
| 閾値 | `--max-age-minutes` (default 30 分、`pages.yml` 実行時間 ~10 分想定 + 余裕) |
| 空 dir 時 | exit 0 skip（PR-level の lp-metrics 経路と整合） |
| stale 検出時 | exit 1 + workflow fail（ADR-0006: 撮影スキップ事故を黙認しない） |
| ユニットテスト | `scripts/__tests__/check-screenshot-freshness.test.mjs` (18 tests pass) |

### `pages.yml` 配置

```
pages.yml
  ├── Capture LP screenshots (capture-hp-screenshots.mjs --webp)
  ├── Verify screenshot freshness (#1893)            ← 追加 (本設計の §6.6)
  ├── Measure LP dimensions (measure-lp-dimensions.mjs)
  └── upload-pages-artifact / deploy-pages
```

§4 既存 fail 条件（preview 起動 / capture exit / 20 枚未満）に加え、**鮮度 CI** が
4 つ目の fail 条件として追加される。

### 視覚一致 baseline (#1893 Phase 2、別 Issue で対応予定)

`tests/e2e/lp-screenshot-baseline/` に PO 承認済 SS 4 枚を baseline として登録し、
撮影された SS との pixelmatch diff > 10% で warning を出す機構は #1893 Phase 2 で対応する。
本 PR (PR-2032) では運用 README + ディレクトリ + `pixelmatch@^7.2.0` devDependency を tracked
するに留め、実画像登録は PO 承認 SS 取得後の別 Issue に分割する（PO 承認なしで baseline 登録すると
本番乖離があっても警告にならない罠を再生産するため）。

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

## 9. Acceptance Criteria 対応表（#1893 demo seed 刷新 + `?screenshot=all` + 鮮度 CI）

| AC | 対応 |
|----|------|
| AC1 demo seed が「ひなちゃん」「テーマ pink」「マイルストーン進行中 (records_10 達成済)」「活動数 ≥ 10 件」 | `src/lib/server/demo/demo-data.ts` 902 番ペルソナを `はなこ` → `ひなちゃん` (旧 `ゆうきちゃん`、2026-05-16 リネーム) に変更、13 日分活動ログ (DEMO_ACTIVITY_LOGS 902 行) で 36 件達成済 |
| AC2 `?screenshot=all` 訪問時にマイルストーン演出が表示 | §6.5 参照。demo (child) layout で `getScreenshotModeKind() === 'all'` 時に `MilestoneBanner` を `bypassSeenCheck` prop で強制表示 |
| AC3 / AC6 視覚 baseline diff < 10% | §6.6 参照。Phase 2 (別 Issue) で対応。本 PR で運用 README + ディレクトリ + pixelmatch dev 依存を tracked |
| AC4 SS 鮮度 CI 新設、stale 時 exit 1 | §6.6 参照。`scripts/check-screenshot-freshness.mjs` 新規 + 18 unit tests |
| AC5 `pages.yml` に組込 | §6.6 参照。`Verify screenshot freshness (#1893)` step を `Capture LP screenshots` 直後に追加 |
| AC7 visual diff で PO 確認 OK | PR 本文 SS 4 枚比較 (before=`?screenshot=1`、after=`?screenshot=all`) で確認済 |
| AC8 no-touch-zones A-E 節 侵犯なし | demo / scripts / workflow / tests のみで本番認証・課金・データロジック非影響 |
| AC9 pre-ready 全 PASS | biome / svelte-check / vitest 4434/4434 全 PASS |
| 設計書更新 | 本ドキュメント §6.5 / §6.6 / §9（本表） |
