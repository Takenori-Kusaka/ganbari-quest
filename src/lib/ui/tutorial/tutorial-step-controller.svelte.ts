/**
 * tutorial-step-controller.svelte.ts
 *
 * チュートリアルオーバーレイの状態管理を担う runes ベースのコントローラー。
 * targetRect / animKey / showExitConfirm の管理、および各 $effect を提供する。
 * TutorialOverlay から分離 (#996)。
 */
import {
	endTutorial,
	getCurrentStep,
	isResumePromptShown,
	isTutorialActive,
} from './tutorial-store.svelte';
import {
	createCenteredRect,
	findVisibleElement,
	focusElement,
	waitForElement,
} from './useStepHighlight.svelte';

// ── Reactive state ──
let targetRect = $state<DOMRect | null>(null);
/**
 * 現在の step が**実要素に spotlight できているか** (#4652)。
 * selector 指定 step で false = 対象が見つからず中央 fallback で出ている状態
 * （顧客には「押せと言われたボタンが光らない」と見える）。E2E が
 * `.tutorial-overlay[data-tutorial-target]` で機械検証する。
 */
let targetResolved = $state(false);
let animKey = $state(0);
let showExitConfirm = $state(false);

// ── Derived state ──
const active = $derived(isTutorialActive());
const step = $derived(getCurrentStep());
const showResume = $derived(isResumePromptShown());

// ── Getters (for external consumers) ──
export function getTargetRect(): DOMRect | null {
	return targetRect;
}

/** 現 step が実要素に spotlight できているか (#4652)。selector 無し step では false */
export function isTargetResolved(): boolean {
	return targetResolved;
}

export function getAnimKey(): number {
	return animKey;
}

export function getShowExitConfirm(): boolean {
	return showExitConfirm;
}

export function isActive(): boolean {
	return active;
}

export function getStep() {
	return step;
}

export function getShowResume(): boolean {
	return showResume;
}

// ── Actions ──
export function handleOverlayClick(e: MouseEvent) {
	// #2105: FSM 排他 — resume / exit-confirm dialog 表示中は二重 state 遷移を防ぐ
	// (Dialog FSM 原則、archive ADR-0019)。既に exit-confirm が出ている場合は noop。
	if (showExitConfirm || showResume) return;
	// Show exit confirmation instead of closing immediately
	if ((e.target as HTMLElement).classList.contains('tutorial-overlay-bg')) {
		showExitConfirm = true;
	}
}

export function confirmExit() {
	showExitConfirm = false;
	endTutorial();
}

export function cancelExit() {
	showExitConfirm = false;
}

// ── Effects ──

/**
 * チュートリアル中はナビの z-index を抑制するため html 要素にフラグを付与。
 * コンポーネントの $effect 内で呼び出す。
 */
export function setupTutorialActiveFlag() {
	$effect(() => {
		if (active) {
			document.documentElement.setAttribute('data-tutorial-active', '');
			return () => document.documentElement.removeAttribute('data-tutorial-active');
		}
		document.documentElement.removeAttribute('data-tutorial-active');
		return;
	});
}

/**
 * ステップ変更時にターゲット要素を検索し targetRect を更新する。
 * コンポーネントの $effect 内で呼び出す。
 */
export function setupStepTracking() {
	$effect(() => {
		if (active && step) {
			const controller = new AbortController();

			const showCentered = () => {
				targetRect = createCenteredRect();
				targetResolved = false;
				animKey++;
			};

			const onFocus = (el: Element) => {
				focusElement(el, (rect) => {
					targetRect = rect;
					targetResolved = true;
					animKey++;
				});
			};

			if (step.selector) {
				// セレクタ指定あり — MutationObserver で要素出現を待機
				waitForElement(step.selector, onFocus, controller.signal, showCentered);
			} else {
				// セレクタなし — 中央表示
				requestAnimationFrame(() => {
					if (!controller.signal.aborted) showCentered();
				});
			}

			return () => controller.abort();
		}
		targetRect = null;
		targetResolved = false;
		return;
	});
}

/**
 * リサイズ・スクロール時に targetRect を再計算（バブル位置を動的に追従）。
 * コンポーネントの $effect 内で呼び出す。
 */
export function setupResizeScrollTracking() {
	$effect(() => {
		if (!active || !step?.selector) return;

		function recalc() {
			const el = step?.selector ? findVisibleElement(step.selector) : null;
			if (el) {
				targetRect = el.getBoundingClientRect();
			}
		}

		window.addEventListener('resize', recalc, { passive: true });
		window.addEventListener('scroll', recalc, { passive: true, capture: true });

		return () => {
			window.removeEventListener('resize', recalc);
			window.removeEventListener('scroll', recalc, { capture: true });
		};
	});
}
