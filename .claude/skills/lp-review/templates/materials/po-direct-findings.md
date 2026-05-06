# PO 直接指摘（修正前 / 修正後 SSOT）

このファイルは LP review ラウンドで PO がスクショを起点に指摘した内容を SSOT として一元管理する。各 Issue 本文では本ファイルの **PO 指摘 ID** + SSOT 1 行リンクのみ参照し、画像物理パス・「修正前/修正後」表記の二重貼りは禁止。

## 起票手順

1. PO がスクショを `tmp/reviews/lp-YYYY-MM-DD/screenshots/` に配置
2. 各指摘ごとに `## PO-N-1` 等の見出しで節を作成（N = ラウンド番号、1, 2, ... = 連番）
3. 修正前 / 修正後の SS 物理パス + 期待状態を記述
4. Issue 起票時は本ファイルの ID を `materials/po-direct-findings.md#po-n-1` 形式で 1 行リンク参照

## PO 指摘一覧

<!-- 例:

## PO-N-1: ヒーローセクションのキャッチコピー改善

**修正前**: `tmp/reviews/lp-YYYY-MM-DD/screenshots/po-1-before.png`
**修正後**: `tmp/reviews/lp-YYYY-MM-DD/screenshots/po-1-after.png`

**期待状態**: ヒーロー文言が「3 秒で価値が伝わる」基準を満たす（ADR-0012 / StoryBrand SB7-1 適合）

**該当ファイル**: `site/index.html` L42-58 / `site/shared-labels.js` `LP_HERO_LABELS.h1`

**起票 Issue**: #XXXX (作成後に追記)

-->

## PO-1-1: <!-- タイトル -->

**修正前**: <!-- screenshots/path -->
**修正後**: <!-- screenshots/path -->
**期待状態**: <!-- 説明 -->
**該当ファイル**: <!-- site/... -->
**起票 Issue**: <!-- #XXXX -->

## PO-1-2: <!-- タイトル -->

（同上のフォーマット）
