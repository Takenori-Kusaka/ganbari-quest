---
name: Brand Check
description: Use when creating or modifying UI elements to ensure brand consistency. Checks color tokens, typography, component primitives, and terminology against docs/DESIGN.md.
---

# ブランド/UI 一貫性チェック

## docs/DESIGN.md §9 禁忌事項 5 点

- [ ] **hex 直書き禁止** — routes/features 内で `#fff`, `#667eea` 等を使わない。Semantic トークン（`var(--color-action-primary)` 等）を使用
- [ ] **プリミティブ再実装禁止** — `$lib/ui/primitives/` のコンポーネント（Button, Card, Alert 等）を必ず使用
- [ ] **内部コード UI 露出禁止** — `child.uiMode` ではなく `getAgeTierLabel(child.uiMode)` を表示
- [ ] **用語ハードコード禁止** — `src/lib/domain/labels.ts` の定数を使用
- [ ] **インラインスタイル禁止** — 動的値以外の `style=` は不可

## ブランドトーン確認

- [ ] 明るく温かい色使いか（ダークテーマは使用しない）
- [ ] 冒険/RPG テーマと整合しているか
- [ ] 対象年齢（3-15歳）に適切か

## カラートークン使用チェック

```bash
# routes/features 配下の hex 使用を検出
npx stylelint "src/routes/**/*.svelte" "src/lib/features/**/*.svelte"
```

## 用語辞書チェック

```bash
# ハードコードされたラベルを検出
grep -r "がんばりクエスト\|スタンダード\|ファミリー" src/routes/ --include="*.svelte" | grep -v labels
```

## スクリーンショットチェック

UI 変更時は `npm run dev:cognito` で以下を確認:
- [ ] 該当画面のスクリーンショットを撮影
- [ ] 他画面との一貫性を目視確認
- [ ] 5 年齢モードでの表示を確認（該当する場合）
