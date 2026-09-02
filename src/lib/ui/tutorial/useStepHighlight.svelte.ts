/**
 * useStepHighlight.svelte.ts
 *
 * チュートリアルステップ対象要素の DOMRect 計算・スクロール制御・リサイズ追従を担う runes ベースのフック。
 * TutorialOverlay から分離 (#996)。
 */

/**
 * セレクタに一致する**可視要素**を返す (レスポンシブで片方だけ描画される UI に対応)。
 *
 * #4651: 可視候補が 1 つも無いときに「先頭候補 (非表示要素)」を返していたため、
 * `md:hidden` の mobile nav が desktop で 0×0 の spotlight として採用されていた。
 * 可視候補が無いときは **null を返す** (呼び出し側が「対象なし」として扱えるようにする)。
 */
export function findVisibleElement(selector: string): Element | null {
	for (const el of document.querySelectorAll(selector)) {
		const rect = el.getBoundingClientRect();
		if (rect.width > 0 && rect.height > 0) return el;
	}
	return null;
}

/**
 * MutationObserver で対象要素の出現を待機し、位置安定後にコールバックを実行する。
 *
 * #4651: タイムアウト (既定 3 秒) しても**監視を止めない**。時間内に見つからなければ
 * `onFallback()` で「対象なし」を呼び出し側に伝えたうえで監視を継続し、後から要素が
 * 現れたら `callback` で spotlight に昇格する (ページ遷移が 3 秒を超えると以後ずっと
 * 中央のままだった不具合 = EPIC #4650 の付随不具合 d の解消)。監視の停止は `signal` の
 * abort (= step 変更 / ガイド終了) のみが行う。
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
		if (signal.aborted) return;
		const el = findVisibleElement(selector);
		if (el) {
			observer.disconnect();
			callback(el);
			return;
		}
		// 時間内に見つからない — 「対象なし」を呼び出し側に伝える。
		// observer は切らず、後から要素が現れたら callback で spotlight に昇格させる (#4651 d)。
		onFallback();
	}, timeoutMs);

	signal.addEventListener('abort', () => {
		observer.disconnect();
		clearTimeout(timer);
	});
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
