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
import { findVisibleElement, focusElement, waitForElement } from './useStepHighlight.svelte';

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
			// #4651: step が変わったら**まず前 step の rect を捨てる**。
			// 旧実装は解決 (最大 3 秒) まで前 step の rect を残しており、その間だけ
			// 「前の step の位置が光ったまま新しい step の文言が出る」状態になっていた。
			targetRect = null;
			targetResolved = false;

			// #4651: 対象が見つからない step は「明示的な中央表示」に切り替える。
			// 旧実装は 200×40 の偽 rect を作って spotlight を描いていたため、顧客には
			// 「画面中央の何もない場所が光る」ように見え、開発側にも何も伝わらなかった。
			// rect は null のままにして overlay 側が cutout / ring を描かないようにし、
			// dev では console.warn で「ガイドが指す対象が画面に無い」ことを可視化する。
			const showCenteredWithoutSpotlight = () => {
				targetRect = null;
				targetResolved = false;
				animKey++;
				if (import.meta.env.DEV && typeof console !== 'undefined') {
					console.warn(
						`[tutorial] step "${step.id}" の対象要素が見つかりません (selector: ${step.selector}). ` +
							'中央表示に切り替えました。selector を実要素へ再アンカーするか、selector 無しの説明 step にしてください。',
					);
				}
			};

			const onFocus = (el: Element) => {
				focusElement(el, (rect) => {
					targetRect = rect;
					targetResolved = true;
					animKey++;
				});
			};

			if (step.selector) {
				// セレクタ指定あり — MutationObserver で要素出現を待機 (timeout 後も監視継続、#4651 d)
				waitForElement(step.selector, onFocus, controller.signal, showCenteredWithoutSpotlight);
			} else {
				// セレクタなし — 概要 step。中央表示が正 (spotlight は描かない)
				requestAnimationFrame(() => {
					if (!controller.signal.aborted) {
						targetRect = null;
						targetResolved = false;
						animKey++;
					}
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
				targetResolved = true;
			} else if (targetResolved) {
				// #4651: resize / scroll で対象が非表示になったら spotlight を消す
				// (breakpoint 切替で消えた要素の位置を光らせ続けない)。
				targetRect = null;
				targetResolved = false;
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
