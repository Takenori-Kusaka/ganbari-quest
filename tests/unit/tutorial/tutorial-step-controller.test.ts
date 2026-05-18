// tests/unit/tutorial/tutorial-step-controller.test.ts
// #2105: ガイドモード二重ダイアログ防止 — handleOverlayClick の FSM 排他ロジック
//
// 検証範囲 (unit):
// - 初期 showExitConfirm は false
// - confirmExit / cancelExit で false に戻る
// - handleOverlayClick: tutorial-overlay-bg クラスなら showExitConfirm=true 遷移
// - handleOverlayClick: 既に showExitConfirm=true なら noop (FSM 排他、#2105)
// - handleOverlayClick: showQuickComplete=true なら noop (FSM 排他、#2105)
// - handleOverlayClick: 別 class の要素では state 遷移なし

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(async () => {}),
}));

globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as typeof fetch;

import {
	cancelExit,
	confirmExit,
	getShowExitConfirm,
	handleOverlayClick,
} from '../../../src/lib/ui/tutorial/tutorial-step-controller.svelte';
import {
	endTutorial,
	nextStep,
	resetChapters,
	startTutorial,
} from '../../../src/lib/ui/tutorial/tutorial-store.svelte';

function makeBgClickEvent(): MouseEvent {
	const target = document.createElement('div');
	target.className = 'tutorial-overlay-bg';
	const ev = new MouseEvent('click', { bubbles: true });
	Object.defineProperty(ev, 'target', { value: target, writable: false });
	return ev;
}

function makeNonBgClickEvent(): MouseEvent {
	const target = document.createElement('div');
	target.className = 'tutorial-spotlight-ring';
	const ev = new MouseEvent('click', { bubbles: true });
	Object.defineProperty(ev, 'target', { value: target, writable: false });
	return ev;
}

describe('#2105 tutorial-step-controller (FSM 排他)', () => {
	beforeEach(() => {
		endTutorial();
		resetChapters();
		if (typeof localStorage !== 'undefined') {
			localStorage.clear();
		}
		// showExitConfirm を必ず false に戻す
		cancelExit();
		vi.clearAllMocks();
	});

	describe('getShowExitConfirm / confirmExit / cancelExit', () => {
		it('初期状態 showExitConfirm=false', () => {
			expect(getShowExitConfirm()).toBe(false);
		});

		it('confirmExit() で false に戻る', () => {
			// 一旦 backdrop click で true に遷移
			handleOverlayClick(makeBgClickEvent());
			expect(getShowExitConfirm()).toBe(true);
			confirmExit();
			expect(getShowExitConfirm()).toBe(false);
		});

		it('cancelExit() で false に戻る', () => {
			handleOverlayClick(makeBgClickEvent());
			expect(getShowExitConfirm()).toBe(true);
			cancelExit();
			expect(getShowExitConfirm()).toBe(false);
		});
	});

	describe('handleOverlayClick', () => {
		it('tutorial-overlay-bg クラスの要素を click すると showExitConfirm=true', () => {
			expect(getShowExitConfirm()).toBe(false);
			handleOverlayClick(makeBgClickEvent());
			expect(getShowExitConfirm()).toBe(true);
		});

		it('別 class (例 tutorial-spotlight-ring) では showExitConfirm は変化しない', () => {
			expect(getShowExitConfirm()).toBe(false);
			handleOverlayClick(makeNonBgClickEvent());
			expect(getShowExitConfirm()).toBe(false);
		});

		it('#2105 FSM 排他: 既に showExitConfirm=true なら handleOverlayClick は noop (再発火で state 揺れなし)', () => {
			handleOverlayClick(makeBgClickEvent());
			expect(getShowExitConfirm()).toBe(true);

			// もう一度 backdrop click を発火しても true のまま、再 click 自体で false 化しない
			handleOverlayClick(makeBgClickEvent());
			expect(getShowExitConfirm()).toBe(true);

			// 1 回だけ cancelExit で false 化することを確認 (再 click 影響なし)
			cancelExit();
			expect(getShowExitConfirm()).toBe(false);
		});

		it('#2105 FSM 排他: quickComplete dialog 表示中の backdrop click は無視される', async () => {
			// 親チャプター startTutorial() → 4 ステップ進めて quickComplete を出す (tutorial-store.test.ts 既存パターン)
			await startTutorial();
			for (let i = 0; i < 4; i++) {
				await nextStep();
			}
			// quickComplete 状態のはず — backdrop click しても exitConfirm は出ない
			expect(getShowExitConfirm()).toBe(false);
			handleOverlayClick(makeBgClickEvent());
			expect(getShowExitConfirm()).toBe(false);
		});
	});
});
