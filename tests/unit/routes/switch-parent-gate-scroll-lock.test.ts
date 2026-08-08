// tests/unit/routes/switch-parent-gate-scroll-lock.test.ts
// /switch の全画面 overlay (`.login-overlay`) が body に付けるスクロールロックの回帰。
//
// 背景: PR #4439 (#4417 AC3) が overlay 表示中の背面スクロールを止めるため、
// `document.body` に `parent-gate-scroll-lock` (`overflow: hidden`) を `$effect` で付け外し
// する実装を入れた。付ける側だけが壊れると「背面が動く」だけだが、**外す側が壊れると
// ページ全体が二度とスクロールできなくなる** (子供はリロードでしか復帰できない)。
// #4439 の回帰対象は AC1 / AC2 (320px 横スクロール) のみで、この付け外しには自動検証が
// 無かったため、後追いで固定する。
//
// テスト層の選択 (component 層):
//   docs/DESIGN.md §5 は「Esc / 外側クリックの close 挙動は Ark UI のグローバル listener 依存で
//   jsdom では非決定のため Playwright 層で検証する」と定めるが、本件はその制約に当たらない。
//   検証対象は `$effect` → `document.body.classList` の付け外しだけで、Ark UI の listener も
//   実ブラウザ固有の合成イベントも介在しない。`+page.svelte` は既に jsdom で render 済
//   (switch-parent-gate-reopen.test.ts) のため、**破棄 (unmount) 時の cleanup** という
//   Playwright では作りにくい条件を含めて component 層で決定的に検証できる。
//   一方「class が付いた結果、実際に CSS が効いて overflow:hidden になる」ことは jsdom では
//   評価できない (Svelte の scoped style は当たらない) ため、その半分は
//   tests/e2e/parent-gate.spec.ts の #3089 fail-safe test に相乗りして実ブラウザで assert する。

import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({
	enhance: () => ({ destroy: () => {} }),
}));
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(async () => {}),
}));
// jsdom に AudioContext が無いため sound service を no-op stub にする
vi.mock('$lib/ui/sound/sound-service', () => ({
	soundService: { ensureContext: () => {}, play: () => {} },
}));

import Harness from './harness/SwitchPageScreenshotHarness.svelte';

/** 実装 (`+page.svelte`) が body に付けるクラス名 */
const LOCK_CLASS = 'parent-gate-scroll-lock';

function isLocked(): boolean {
	return document.body.classList.contains(LOCK_CLASS);
}

/** overlay 以外の分岐 (modal / banner) を鳴らさない最小 data */
function makeData() {
	return {
		children: [],
		adminLink: '/admin',
		parentGateInteractive: true,
		showAdminLink: true,
		reason: null,
		timedOut: false,
		pinRequired: false,
		nextPath: '/admin',
		onboarding: null,
		pinConfigured: true,
		pinResetAvailable: true,
	};
}

afterEach(() => {
	cleanup();
	// 後続 test へ状態を持ち越さない (lock が残っていたら次の test が誤検知するため)
	document.body.classList.remove(LOCK_CLASS);
});

describe('/switch 全画面 overlay のスクロールロック', () => {
	it('overlay が出ていないときは body をロックしない', async () => {
		const { queryByTestId } = render(Harness, {
			props: { mode: 'off' as const, data: makeData() },
		});

		expect(queryByTestId('parent-gate-navigating')).toBeNull();
		expect(isLocked()).toBe(false);
	});

	it('overlay が表示されると body がスクロールロックされる', async () => {
		const { getByTestId } = render(Harness, {
			props: { mode: 'all' as const, data: makeData() },
		});

		// vacuous PASS 防止: overlay が実際に描画されていることを先に確定させる
		expect(getByTestId('parent-gate-navigating')).toBeTruthy();
		await waitFor(() => expect(isLocked()).toBe(true));
	});

	it('overlay が閉じるとロックが解除される (画面がスクロール不能のまま残らない)', async () => {
		const { rerender, queryByTestId } = render(Harness, {
			props: { mode: 'all' as const, data: makeData() },
		});
		await waitFor(() => expect(isLocked()).toBe(true));

		// overlay を閉じる (component は mount されたまま)
		await rerender({ mode: 'off' as const, data: makeData() });

		await waitFor(() => expect(queryByTestId('parent-gate-navigating')).toBeNull());
		await waitFor(() => expect(isLocked()).toBe(false));
	});

	it('overlay 表示中に画面が破棄されてもロックが残らない ($effect cleanup)', async () => {
		const { unmount } = render(Harness, {
			props: { mode: 'all' as const, data: makeData() },
		});
		await waitFor(() => expect(isLocked()).toBe(true));

		// ページ遷移などで component ごと破棄されるケース。ここで class が残ると
		// 遷移先の画面が丸ごとスクロール不能になる。
		unmount();

		await waitFor(() => expect(isLocked()).toBe(false));
	});
});
