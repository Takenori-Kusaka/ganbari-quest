# No-Touch Zones（「変えるな」境界宣言）

過去 3 ラウンド（lp-2026-04-30 / 05-01 / 05-02）で確立された A-E 節の境界。当ラウンドで Issue を起票する際、これらの境界に違反する変更案は**起票しない**。AC として「no-touch-zones の N 節を侵犯しない」を必須化。

## A 節: 既存 LP の構造的フレーム

以下は変更禁止（ADR-0013 LP truth + ADR-0025 LP SSOT 注入の前提）:

- `site/index.html` の `<head>` 構造（CSP meta tag / DOMPurify pin / GTM / favicon）
- `site/shared.css` の `:root` Base spacing / Semantic LP tokens（ADR-0042、変更には ADR supersede 必須）
- `site/shared-labels.js` のラベル injection 機構（ADR-0025）
- `site/index.html` の section 順序（hero → core-loop → machine-tour → soft-features → growth-roadmap → pricing → faq → cta → footer）

## B 節: ratchet 制約

LP メトリクスの数値は引き上げ禁止（`scripts/measure-lp-dimensions.mjs`）:

- `mobileHeight` ≤ 15000 px
- `desktopHeight` ≤ 8000 px（warning 帯 7800 px、ADR-0042 #1840）
- `forbiddenTerms`: 0（`ガチャ` / `抽選` / `コンプリート` / `git clone` / `docker compose` / `SaaS版` / `TLS` / `AES-256` / `AWS`）
- `ctaVariants` ≤ 3（`無料で始める` / `デモを見る` / `ログイン` のみ）
- `presetActivityCountClaimedMin` ≥ 300（LP 訴求 ≤ 実数、ADR-0013）

## C 節: Committed/Aspirational 区分（ADR-0013）

- LP に未実装機能を「実装済み」として書かない
- 新規 LP 訴求は実装パスが存在することを PR body の「LP / 販促文言変更時の実装パス明示」で証明
- Aspirational（将来計画）は LP に新規追加禁止、`docs/design/19-プライシング戦略書.md` 附則で管理

## D 節: Anti-engagement 原則（ADR-0012）

子供側 UI 滞在時間 = 価値毀損指標。以下は採用禁止:

- 連続ガチャ / インフィニットスクロール / 通知連打 / 自動再生 / サプライズ濫用
- 焦らせる文言・誤誘導ボタン配置・過剰な数値主張
- 滞在時間を意図的に伸ばす UI パターン

## E 節: Pre-PMF スコープ（ADR-0010）

- 過剰防衛設計（汎用監査ログ / S3+Athena / WAF / IP 単位ブルートフォース検知）追加禁止
- 新規 LP 機能は「サインアップ 20 名/月（V2MOM Q2）に貢献するか」判定必須
- 採用しないには ADR supersede が必要

## ラウンド固有追加項目

<!-- 当ラウンドで新たに追加する境界があれば以下に記述 -->

## F 節: <!-- ラウンド固有 --> （任意）
