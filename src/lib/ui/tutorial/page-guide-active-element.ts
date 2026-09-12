// src/lib/ui/tutorial/page-guide-active-element.ts
// #4922: driver.js の `.driver-active-element` 系クラスの後始末を、driver.js 内部の
// アニメーションタイミングに依存せず構成的に保証するためのユーティリティ。
//
// 【根本原因】
// driver.js は highlight 遷移時に「直前の対象」の `.driver-active-element` クラスを
// 同期的に外す (`driver.js.mjs` の内部関数 `J`)。ただし「直前の対象」の判定に使う内部状態
// (`__activeElement`) は、highlight アニメーション (既定 `duration: 400`ms、本 overlay は
// `animate: true` で有効) の完了時にのみ更新される (rAF ベースの遅延タイマー内で確定)。
//
// 400ms 以内に次の step へ進む (❓ → つぎへ を通常の速度で連打する現実的なクリック速度で
// 普通に起こる、本番実測 #4922) と、直前の transition が完了する前に新しい transition で
// 上書きされ、直前対象のクラス除去が永久にスキップされる。step を進めるほど枠線付きの要素が
// 増え続ける (実測: /admin/status で 8 step 中最大 7 個)。
//
// 実証: `tests/unit/tutorial/page-guide-active-element-4922.test.ts` が実 driver.js を使い、
// gap 0ms (完全同期連打) でも本ユーティリティを `onHighlightStarted` に配線すれば
// `.driver-active-element` が常に 1 件に保たれることを検証する。
//
// 【対処方針】
// driver.js の `onHighlightStarted` フックは、新しい対象が解決された直後・実 DOM 操作 (クラス
// 追加/除去) の前に、`duration` に関係なく毎回同期的に呼ばれる (driver.js.mjs `J` 関数冒頭)。
// ここで「これから対象になる要素以外」から `.driver-active-element` 系クラスを一括除去する
// ことで、driver.js 内部のアニメーションタイミングに依存せず「唯一の active element」を
// 構成的に保証する (transferHighlight の成否を driver.js 自身の内部状態に委ねない)。
//
// 【ダミー要素の扱い (実機検証で判明、#4922)】
// driver.js は selector 省略 step (中央 modal) で `#driver-dummy-element` (0×0 placeholder) を
// 挿入するが、`onHighlightStarted` はダミーが対象のとき element 引数を `undefined` で渡す
// (driver.js.mjs: `d(c?void 0:t,n,h)`)。呼び出し側 (`PageGuideOverlay.svelte`) は
// `element ?? resolveActiveElementFallback()` でこの undefined を実 DOM 参照
// (`#driver-dummy-element`) に解決してから渡すこと。ここを `null` のまま渡すと、
// 「ダミーが対象の間はダミー自身を誤って除去しない」ための例外的スキップが必要になり、
// その結果「ダミーから実要素へ遷移した後もダミーの残留クラスを永久に除去できない」という
// 別の穴が生まれる (実機 SS 撮影で確認: dummy を除いても実要素 1 個は正しいが
// `.driver-active-element` 総数が 2 のまま = ダミーの残留)。呼び出し側で参照を解決すれば
// 本関数はダミーを特別扱いする必要がなく、`current` 判定 1 本で正しく動く。
export function clearStaleActiveElementClasses(current: Element | null): void {
	for (const el of document.querySelectorAll('.driver-active-element')) {
		if (el === current) continue;
		el.classList.remove('driver-active-element', 'driver-no-interaction');
		el.removeAttribute('aria-haspopup');
		el.removeAttribute('aria-expanded');
		el.removeAttribute('aria-controls');
	}
	for (const el of document.querySelectorAll('.driver-active-element-parent')) {
		el.classList.remove('driver-active-element-parent', 'driver-active-element-parent-no-scroll');
	}
}
