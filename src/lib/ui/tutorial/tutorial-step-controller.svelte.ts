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
	isQuickCompleteShown,
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
let animKey = $state(0);
let showExitConfirm = $state(false);

// ── Derived state ──
const active = $derived(isTutorialActive());
const step = $derived(getCurrentStep());
const showResume = $derived(isResumePromptShown());
const showQuickComplete = $derived(isQuickCompleteShown());

// ── Getters (for external consumers) ──
export function getTargetRect(): DOMRect | null {
	return targetRect;
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

export function getShowQuickComplete(): boolean {
	return showQuickComplete;
}

// ── Actions ──
export function handleOverlayClick(e: MouseEvent) {
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
				animKey++;
			};

			const onFocus = (el: Element) => {
				focusElement(el, (rect) => {
					targetRect = rect;
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
