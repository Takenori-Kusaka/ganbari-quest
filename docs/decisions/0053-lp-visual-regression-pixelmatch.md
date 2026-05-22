# 0053. LP visual regression: pixelmatch (OSS 6 件比較)

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-05-23 |
| 起票者 | Dev (Claude) |
| 関連 Issue | #2401 / PR #2435 / PR #1893 (Phase 1) |

## コンテキスト

LP (`site/**`) の visual regression を CI で構造的検出する gate が未整備で、demo 固有 UI 映り込み / dialog auto-open 干渉 / レイアウト破壊が手動レビュー依存（PO-4-7 で 8 回再発）。

PR #1893 (Phase 1) で `pixelmatch` + `pngjs` + `sharp` を dev 依存に追加し baseline ディレクトリを整備済。本 ADR は #2401 (Phase 2 = CI gate 実装) で導入する `scripts/check-lp-visual-regression.mjs` (305 行) の OSS 選定根拠を ADR-0014 / #1350 (10 行超 OSS 先調査ルール) に従って記録する。

## 検討した選択肢

### 選択肢 A: pixelmatch (採用)

- **概要**: `pixelmatch` npm パッケージ。MIT。Mapbox 製、stars 6k+、PNG diff の業界標準。pure JS pixel-by-pixel 比較。
- **メリット**:
  - 軽量 (依存は `pngjs` のみ)、CI で導入工数最小
  - threshold (0-1) で perceptual sensitivity を制御可能 (本 PR は 0.1 = 人間が知覚できる程度)
  - per-pixel diff PNG 出力で CI artifact として人間が確認しやすい
  - PR #1893 で既に dev 依存追加済 (Phase 1 で導入済)
- **デメリット**:
  - 大解像度 (2880×1800) の per-pixel 比較は CPU bound (~100ms/image)。51 枚で ~5s。CI 許容範囲内
  - SSIM (構造的類似度) ではなく単純 pixel diff のため、anti-aliasing 等の微差で false positive リスク (本 PR は threshold 0.1 + diff > 10% 閾値で吸収)
- **Pre-PMF コスト**: dev 依存 1 つ、bundle 増加 0 (本番不要)。学習コスト 0 (README 5 分)、長期保守性 ◎

### 選択肢 B: jest-image-snapshot

- **概要**: jest plugin、`__image_snapshots__/*.png` を保存して自動比較。stars 2k+、MIT。
- **メリット**: jest 統合で snapshot 更新 (`--updateSnapshot`) が簡単
- **デメリット**:
  - jest 依存 (本リポジトリは vitest)。導入工数 = jest 移行 or 並行 runner
  - 内部で `pixelmatch` を使用しているので、pixelmatch 直接利用と本質的に同じ動作
  - 抽象化レイヤーが厚い分、CI integration の制御が利かない (per-image diff PNG 出力経路を直接書きたい場合に詰む)
- **Pre-PMF コスト**: jest 移行 = 過大。本 Pre-PMF 段階で不採用

### 選択肢 C: Playwright `toHaveScreenshot()`

- **概要**: Playwright 公式の visual regression assertion。Playwright 1.40+ で `expect(page).toHaveScreenshot()` で自動撮影 + 自動比較。
- **メリット**:
  - 撮影と比較が 1 step に統合 (本 PR は capture → check の 2 step)
  - Playwright 内部 retry / waitForStable があり flake 耐性が高い
  - 既に本リポジトリで Playwright を使用しているため整合性 ◎
- **デメリット**:
  - **撮影戦略が固定**: Playwright fixture 経由でしか撮影できず、本 PR の `capture-hp-screenshots.mjs` (preview server + cookie injection + scrollTo + waitSplide) のような複雑な撮影 setup は再実装が必要
  - **baseline 配置が Playwright 固定** (`<test>.png-snapshots/<test>-chromium-linux.png`): git tracked SSOT として `scripts/lp-screenshot-baseline/` に集約する設計と矛盾
  - LP HTML 撮影は E2E test ではないため、Playwright test runner の overhead が無駄
- **Pre-PMF コスト**: 既存 capture-hp-screenshots.mjs (300+ 行) を全廃して Playwright spec 経由に書き直す = 過大。本 PR の scope 外。将来 Multi-Lambda demo 経由の visual regression を統合する場合に再検討候補

### 選択肢 D: Percy / Chromatic (SaaS)

- **概要**: BrowserStack Percy / Chromatic (Storybook). visual regression SaaS。Cloud 上で baseline 管理 + diff レビュー UI。
- **メリット**: human-in-the-loop の diff レビュー UI、PR コメント自動投稿、cross-browser 対応
- **デメリット**:
  - **有料 SaaS** ($149/mo〜)。Pre-PMF 段階で fixed cost 追加は ADR-0010 Bucket B (LP 安定性) では過剰
  - baseline が cloud 管理 = git tracked SSOT (ADR-0013 LP truth) と矛盾
  - 個人開発のサインアップ 20 名/月段階で月 $149 は ROI 不明
- **Pre-PMF コスト**: 過大。PMF 達成後の B2B エンタープライズ展開フェーズで再検討候補

### 選択肢 E: BackstopJS

- **概要**: visual regression 専用 npm パッケージ、stars 7k+、MIT。`backstop reference` / `backstop test` の CLI で撮影 + 比較。
- **メリット**: visual regression に特化、HTML report 生成
- **デメリット**:
  - Puppeteer 依存 (本リポジトリは Playwright)。runner 二重化
  - 内部で `resemble.js` を使うが、pixelmatch とほぼ同等の pixel diff
  - HTML report は GitHub Actions では artifact ダウンロード経由で見るため Web UI 利点が薄い
- **Pre-PMF コスト**: runner 二重化が過大、不採用

### 選択肢 F: 独自実装 (sharp + canvas pixel diff)

- **概要**: `sharp` で raw pixel buffer 取得 → 自前 for-loop で diff カウント
- **メリット**: 完全制御
- **デメリット**:
  - **pixelmatch (110 行のコア) を再実装する意味なし**。anti-aliasing tolerance / YIQ 色空間変換 / threshold ロジックを自前で書くと 200+ 行
  - ADR-0014 / #1350 (10 行超 OSS 先調査ルール) 違反
- **Pre-PMF コスト**: 不採用 (ADR-0014 違反)

## 決定

**選択肢 A: pixelmatch** を採用。

**根拠**:

1. **PR #1893 (Phase 1) で既に dev 依存追加済**。本 PR (#2435) はその上位レイヤー (CI gate `scripts/check-lp-visual-regression.mjs` 305 行) を追加するだけ
2. 業界標準 (Mapbox 製 / stars 6k+ / MIT) で、内部実装を読めるサイズ (110 行のコア)
3. Pre-PMF 段階で SaaS 課金 (Percy / Chromatic) は ROI 不明、git tracked baseline (ADR-0013 LP truth) と矛盾しない
4. Playwright `toHaveScreenshot()` は撮影戦略 (preview server + cookie + scrollTo) が複雑すぎて統合困難 (capture-hp-screenshots.mjs 300+ 行を維持する設計判断)
5. 5 件比較 (B/C/D/E/F) で A が最適、独自実装 (F) は ADR-0014 / #1350 で禁止

**棄却した選択肢の総括**:
- B (jest-image-snapshot): jest 移行コストが過大
- C (Playwright `toHaveScreenshot`): 撮影戦略の再実装コストが過大、将来候補
- D (Percy / Chromatic): SaaS 課金が Pre-PMF 過剰
- E (BackstopJS): Puppeteer 依存で runner 二重化
- F (独自実装): ADR-0014 違反

## 結果

- **bundle size 影響**: 本番 0 byte (dev 依存のみ)
- **CI 実行時間**: ~5s/51 images (capture 5min + check 5s)
- **保守性**: PR #1893 で導入済の依存に薄いラッパー (305 行 + workflow 158 行) を追加するだけ。pixelmatch 自体は安定 OSS で API 変更リスク低
- **将来の拡張余地**: Playwright `toHaveScreenshot()` に統合する path は残されているが、Multi-Lambda demo + cookie injection + scrollTo 戦略の維持コストとトレードオフ
- **トレードオフ**: SSIM ベース比較 (pixel-level でなく構造的類似度) が必要になった場合は `looks-same` 等への移行を別 ADR で検討
