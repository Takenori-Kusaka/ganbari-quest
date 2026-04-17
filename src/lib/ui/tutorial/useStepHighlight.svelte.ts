/**
 * useStepHighlight.svelte.ts
 *
 * チュートリアルステップ対象要素の DOMRect 計算・スクロール制御・リサイズ追従を担う runes ベースのフック。
 * TutorialOverlay から分離 (#996)。
 */

/** Find the first visible element matching a selector (handles responsive layouts) */
export function findVisibleElement(selector: string): Element | null {
	const candidates = document.querySelectorAll(selector);
	for (const el of candidates) {
		const rect = el.getBoundingClientRect();
		if (rect.width > 0 && rect.height > 0) return el;
	}
	return candidates[0] ?? null;
}

/**
 * MutationObserver で対象要素の出現を待機し、位置安定後にコールバックを実行する。
 * タイムアウト付き（最大3秒）で、要素が見つからなければ onFallback にフォールバック。
 */
export function waitForElement(
	selector: string,
	callback: (el: Element) => void,
	signal: AbortSignal,
	onFallback: () => void,
	timeoutMs = 3000,
) {
	// 即座に見つかる場合
	const existing = findVisibleElement(selector);
	if (existing) {
		requestAnimationFrame(() => {
			if (!signal.aborted) callback(existing);
		});
		return;
	}

	let timer: ReturnType<typeof setTimeout>;

	const observer = new MutationObserver(() => {
		const el = findVisibleElement(selector);
		if (el) {
			observer.disconnect();
			clearTimeout(timer);
			requestAnimationFrame(() => {
				if (!signal.aborted) callback(el);
			});
		}
	});

	observer.observe(document.body, { childList: true, subtree: true, attributes: true });

	timer = setTimeout(() => {
		observer.disconnect();
		if (!signal.aborted) {
			// 最終チェック
			const el = findVisibleElement(selector);
			if (el) {
				callback(el);
			} else {
				// 要素未発見 — フォールバック
				onFallback();
			}
		}
	}, timeoutMs);

	signal.addEventListener('abort', () => {
		observer.disconnect();
		clearTimeout(timer);
	});
}

/** 画面中央にバブルを表示するためのフォールバック DOMRect を生成する */
export function createCenteredRect(): DOMRect {
	return new DOMRect(window.innerWidth / 2 - 100, window.innerHeight / 3, 200, 40);
}

/** 対象要素をスクロールして DOMRect を返すコールバックを生成する */
export function focusElement(el: Element, onComplete: (rect: DOMRect) => void) {
	el.scrollIntoView({ behavior: 'smooth', block: 'center' });
	// スクロール完了を待って位置を取得
	requestAnimationFrame(() => {
		setTimeout(() => {
			onComplete(el.getBoundingClientRect());
		}, 300);
	});
}
