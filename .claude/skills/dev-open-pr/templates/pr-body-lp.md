## 顧客価値・目的

<!-- LP / pricing / 販促文言を変更する PR。Aspirational 記載を LP に新規追加禁止 (ADR-0013) -->

**対象ユーザー**: <!-- LP 訪問者（未サインアップ）/ サインアップ後ユーザー -->

**解決する課題**: <!-- LP の何が伝わりにくかったか / 何を伝えるべきか -->

**期待される効果**: <!-- LP メトリクス改善 / Committed/Aspirational 整合 / SEO -->

## 関連 Issue

Closes #{{ISSUE_NUMBER}}

## AC 検証マップ (ADR-0004)

{{AC_TABLE}}

## 変更タイプ

{{TYPE_CHECKBOXES}}

## 影響範囲・横展開チェック

**影響を受ける画面・機能**: <!-- 例: site/index.html hero / faq.html / pricing.html -->

- [ ] **LP ↔ アプリ整合** (ADR-0013): Aspirational 記載を新規追加していない
- [ ] **labels SSOT** (ADR-0009): `shared-labels.js` の `data-label` 経由
- [ ] **設計書同期**: `lp-content-map.md` / `19-プライシング戦略書.md` 等
- [ ] **並行 PR overlap** 確認 (#1200)

**LP / 販促文言変更時** (ADR-0013、必須):

| 変更した文言 | 実装コードパス | Committed/Aspirational |
|------------|---------------|----------------------|
| <!-- 例: 「毎日のおみくじシール」 --> | <!-- 例: `src/lib/server/services/stamp-card-service.ts::stampToday` --> | <!-- Committed --> |

## LP メトリクス結果（必須）

<!-- `node scripts/measure-lp-dimensions.mjs` を実行し本 PR の値を記載。CI `lp-metrics.yml` が自動 fail させる項目 -->

| 指標 | 閾値 | 本 PR の値 | 結果 |
|---|---:|---:|---|
| `mobileHeight` | ≤ 15000 px | <!-- 値 --> | <!-- PASS / FAIL --> |
| `desktopHeight` | ≤ 8000 px | <!-- 値 --> | <!-- PASS / FAIL --> |
| `desktopHeight` (warn) | ≤ 7800 px | <!-- 値 --> | <!-- 警告帯確認 --> |
| `forbiddenTerms` | 0 | <!-- 値 --> | <!-- PASS / FAIL --> |
| `ctaVariants` | ≤ 3 | <!-- 値 --> | <!-- PASS / FAIL --> |
| `presetActivityCountClaimed` | ≥ 300 | <!-- 値 --> | <!-- PASS / FAIL --> |
| `lp-removal-residue` | 新規 0 | <!-- 値 --> | <!-- PASS / FAIL --> |

## テスト・品質セルフチェック

| テスト種別 | コマンド | 結果 |
|---|---|---|
| pre-ready | `npm run pre-ready -- --pr <num>` | <!-- PASS / FAIL --> |
| LP メトリクス | `node scripts/measure-lp-dimensions.mjs` | <!-- PASS / FAIL --> |

- [ ] **DRY**: 同一文言が複数 LP ページにないか `grep` 確認（`shared-labels.js` SSOT 整合）
- [ ] **YAGNI**: 不要な hero subtext / 過剰な強調なし
- [ ] **Security**: `innerHTML` 注入箇所は DOMPurify を経由（ADR-0025）
- [ ] **A11y・パフォーマンス**: 見出し階層 / alt / コントラスト / 画像 webp / lazy / size 適正

## スクリーンショット / ビジュアルデモ

| | モバイル (375px) | PC (1440px) |
|---|---|---|
| **修正前** | <!-- ![before-mobile](URL) --> | <!-- ![before-pc](URL) --> |
| **修正後** | <!-- ![after-mobile](URL) --> | <!-- ![after-pc](URL) --> |

**インタラクティブ状態**: <!-- LP 内 FAQ 開閉 / floating CTA 表示状態など --> 該当なければ「N/A」。

## レビュー依頼事項・破壊的変更

**破壊的変更**:
- [ ] 含まれない
- [ ] 含まれる → URL 変更・SEO 影響を以下に記載

**レビュー依頼事項**:
<!-- LP 文言の「実装の事実」整合・no-touch-zones 侵犯なしの観点 -->

## 配布済み env / secret (ADR-0006)

- [ ] N/A — 新規 env / secret の追加なし

## Ready for Review チェックリスト

<!-- pre-ready の実行証跡はチェック項目にしない（自己参照 deadlock、#4022）。ログのパスと結果を本文に記載する -->

- [ ] LP メトリクス全指標 PASS をローカル確認した（`measure-lp-dimensions.mjs`）
- [ ] セルフレビュー済み
- [ ] 全 AC が実装済み
- [ ] LP 変更 SS が GitHub 上で表示確認できる

## QM レビュー結果

[QM 5 手順 approve body は `docs/sessions/qa-session.md` を参照](../docs/sessions/qa-session.md)
