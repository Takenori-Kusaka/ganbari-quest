## 顧客価値・目的

<!-- LP / pricing / 販促文言を変更する PR。Aspirational 記載を LP に新規追加禁止 (ADR-0013)。 -->

**対象ユーザー**: <!-- LP 訪問者（未サインアップ）/ サインアップ後ユーザー -->

**解決する課題**: <!-- LP の何が伝わりにくかったか / 何を伝えるべきか -->

**期待される効果**: <!-- LP メトリクス改善 / Committed/Aspirational 整合 / SEO -->

## 関連 Issue

closes #{{ISSUE_NUMBER}}

## AC 検証マップ (ADR-0004)

{{AC_TABLE}}

## 変更タイプ

{{TYPE_CHECKBOXES}}

## 影響範囲・変更コンポーネント

**変更レイヤー**:
- [ ] LP サイト (`site/`)
- [ ] pricing page (`src/routes/pricing/` など)
- [ ] `plan-features.ts`
- [ ] `pricing-strategy.md`
- [ ] その他: <!-- 必要に応じて -->

**影響を受ける画面・機能**: <!-- 例: site/index.html hero / faq.html / pricing.html -->

## LP メトリクス結果（必須）

<!-- ADR-0042 / `scripts/measure-lp-dimensions.mjs` を実行し、本 PR の値を記載。
     CI `lp-metrics.yml` が自動 fail させる項目: mobile ≤ 15000 / desktop ≤ 8000 / forbidden 0 / cta ≤ 3 / preset ≥ 300 -->

| 指標 | 閾値 | 本 PR の値 | 結果 |
|---|---:|---:|---|
| `mobileHeight` | ≤ 15000 px | <!-- 値 --> | <!-- PASS / FAIL --> |
| `desktopHeight` | ≤ 8000 px | <!-- 値 --> | <!-- PASS / FAIL --> |
| `desktopHeight` (warn) | ≤ 7800 px | <!-- 値 --> | <!-- 警告帯確認 --> |
| `forbiddenTerms` | 0 | <!-- 値 --> | <!-- PASS / FAIL --> |
| `ctaVariants` | ≤ 3 | <!-- 値 --> | <!-- PASS / FAIL --> |
| `presetActivityCountClaimed` | ≥ 300 | <!-- 値 --> | <!-- PASS / FAIL --> |
| `lp-removal-residue` | 新規 0 | <!-- 値 --> | <!-- PASS / FAIL --> |

実行コマンド: `node scripts/measure-lp-dimensions.mjs`

## テスト & 安全装置セルフチェック

- [ ] **`npm run pre-ready -- --pr <num>` 全 Step PASS**（lp-dimensions step を含む）
- [ ] 追加・変更したテストの概要を以下に記載（テスト追加なしなら「N/A」）:
- [ ] **新規 env / secret 追加時**（ADR-0006）: 「N/A」または末尾に証跡記載
- [ ] **DynamoDB 実装変更時**: N/A（LP 系のため）
- [ ] **Critical バグ修正の場合**: N/A

## スクリーンショット / ビジュアルデモ

**4 スロット添付**（#1740）:

| | モバイル (375px) | PC (1440px) |
|---|---|---|
| **修正前** | <!-- ![before-mobile](URL) --> | <!-- ![before-pc](URL) --> |
| **修正後** | <!-- ![after-mobile](URL) --> | <!-- ![after-pc](URL) --> |

**インタラクティブ状態**: <!-- LP 内 FAQ 開閉 / floating CTA 表示状態など --> 該当なければ「N/A」。

## コード品質セルフレビュー (#1481)

- [ ] **DRY**: 同一文言が複数 LP ページにないか `grep` 確認（`shared-labels.js` SSOT 整合）
- [ ] **YAGNI**: 不要な hero subtext / 過剰な強調なし
- [ ] **Security**: `innerHTML` 注入箇所は DOMPurify を経由（ADR-0025）
- [ ] **アクセシビリティ**: 見出し階層 / alt / コントラスト
- [ ] **パフォーマンス**: 画像 webp / lazy / size 適正

## 横展開・影響波及チェック

**並行実装ペア**:

- [ ] LP ↔ アプリ双方向整合（ADR-0013、Aspirational 記載なし確認）
- [ ] labels SSOT (ADR-0009、`shared-labels.js` `data-label` 経由)
- [ ] 設計書同期（`lp-content-map.md` / `19-プライシング戦略書.md` 等）
- [ ] 並行 PR overlap 確認 (#1200)

**LP / 販促文言変更時** (ADR-0013、必須):

| 変更した文言 | 実装コードパス | Committed/Aspirational |
|------------|---------------|----------------------|
| <!-- 例: 「毎日のおみくじシール」 --> | <!-- 例: `src/lib/server/services/stamp-card-service.ts::stampToday` --> | <!-- Committed --> |

## レビュー依頼事項・破壊的変更

**破壊的変更**:
- [ ] このPRに破壊的変更は**含まれない**
- [ ] 含まれる → URL 変更・SEO 影響を以下に記載

**レビュー依頼事項・QA**:
<!-- LP 文言の「実装の事実」整合・no-touch-zones 侵犯なしの観点 -->

## 配布済み env / secret (ADR-0006)

- [ ] N/A — 新規 env / secret の追加なし

## Ready for Review チェックリスト

- [ ] **`npm run pre-ready -- --pr <num>` 全 Step PASS** をローカル確認した
- [ ] LP メトリクス全指標 PASS をローカル確認した（`measure-lp-dimensions.mjs`）
- [ ] セルフレビュー済み
- [ ] 全 AC が実装済み
- [ ] LP 変更 SS が GitHub 上で表示確認できる

## QM レビュー結果

[QM 5 手順 approve body は `docs/sessions/qa-session.md` を参照](../docs/sessions/qa-session.md)
