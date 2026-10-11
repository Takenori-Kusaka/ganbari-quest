---
name: Brand Check
description: Use when creating or modifying UI elements to ensure brand consistency. Checks color tokens, typography, component primitives, and terminology against docs/DESIGN.md.
---

# ブランド/UI 一貫性チェック

## docs/DESIGN.md §9 禁忌事項（抜粋。全項目は §9 が SSOT）

- [ ] **hex 直書き禁止** — routes/features 内で `#fff`, `#667eea` 等を使わない。Semantic トークン（`var(--color-action-primary)` 等）を使用
- [ ] **プリミティブ再実装禁止** — `$lib/ui/primitives/` のコンポーネント（Button, Card, Alert 等）を必ず使用
- [ ] **内部コード UI 露出禁止** — `child.uiMode` ではなく `getAgeTierLabel(child.uiMode)` を表示
- [ ] **用語ハードコード禁止** — `src/lib/domain/terms.ts`（atom）/ labels 層（compound、`$lib/domain/labels` から import）の定数を使用（ADR-0045。置き場所は docs/DESIGN.md §6）
- [ ] **インラインスタイル禁止** — 動的値以外の `style=` は不可

## ブランドトーン確認

- [ ] 明るく温かい色使いか（ダークテーマは使用しない）
- [ ] 冒険/RPG テーマと整合しているか
- [ ] 対象年齢（コアターゲット 3〜18 歳、0〜2 歳は親向け準備モード。ADR-0011 / DESIGN.md §8）に適切か

## カラートークン使用チェック

```bash
# CSS ファイルの hex 直書き（CI と同じ対象）
npm run lint:css
# .svelte の style 属性 / Tailwind arbitrary hex / 日本語直書き（template ブロック）
npm run lint:svelte
# .svelte の <style> 内 hex は stylelint の対象外（.stylelintrc.json に svelte 構文が無く CssSyntaxError になる）。grep で目視する
grep -rnE "#[0-9a-fA-F]{3,8}\b" src/routes src/lib/features --include=*.svelte
```

## 用語辞書チェック

```bash
# プラン文字列の直書き（用語 lint は #4322 で削除済。それ以外の用語 SSOT 逸脱は lint:svelte の template 検出とレビューで担保）
node scripts/check-no-plan-literals.mjs
```

## スクリーンショットチェック

UI 変更時は `npm run dev:cognito` で以下を確認:
- [ ] 該当画面のスクリーンショットを撮影
- [ ] 他画面との一貫性を目視確認
- [ ] 5 年齢モードでの表示を確認（該当する場合）
