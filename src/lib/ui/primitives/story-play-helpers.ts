// story-play-helpers.ts — Storybook play 関数共有ヘルパ (#3687)
//
// Ark UI Menu 系 primitive (Menu / OverflowMenu) は open transition 中、content が
// `pointer-events: none` になる。`userEvent.click` は click 前に pointer-events を検査する
// ため、CI runner の遅い描画では「item visible 直後の click」が transition 完了前に発火し
// 「Unable to perform pointer interaction as the element has pointer-events: none」で fail
// する (ローカルの速い描画では再現しない timing flake、Issue #3687 / 統合 PR #3686 CI)。
//
// 対策: item click 前に `waitFor(() => assertPointerInteractive(item))` を挟み、
// transition 完了 (= pointer-events 解除) を明示的に待つ。waitFor は条件成立まで poll する
// ため、描画遅延の大小に依らず決定的に pass する (固定待ち waitForTimeout は不採用、
// tests/CLAUDE.md 禁止事項)。
//
// 本ヘルパは `storybook/test` に依存しない純粋な同期 assert として切り出し、
// - stories 側: `await waitFor(() => assertPointerInteractive(el))` で使用
// - unit test 側: `tests/unit/ui/story-play-helpers.test.ts` が遅延注入で決定性を検証
// の両方から単一 SSOT として参照する (Menu / OverflowMenu の同一ロジック重複を排除)。

/**
 * 要素が pointer 操作可能 (pointer-events !== 'none') であることを assert する。
 * open transition 中 (pointer-events: none) は throw し、`waitFor` の retry 対象になる。
 *
 * @throws {Error} 要素がまだ open transition 中 (pointer-events: none) の場合
 */
export function assertPointerInteractive(element: Element): void {
	if (getComputedStyle(element).pointerEvents === 'none') {
		throw new Error('element is still in open transition (pointer-events: none)');
	}
}
