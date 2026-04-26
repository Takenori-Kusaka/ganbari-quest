// src/lib/features/auto-sleep.ts
// #1292 自動スリープ — タイマーロジック（document.hidden 依存注入可能）

export interface AutoSleepOptions {
	activeMs: number;
	inactiveResetMs: number;
	battleGraceMs: number;
	onSleep: () => void;
	getPathname: () => string;
	/** テスト時に上書き可能。デフォルトは document.hidden */
	getHidden?: () => boolean;
}

/**
 * 自動スリープタイマーを開始する。
 * 戻り値はクリーンアップ関数。
 */
export function startAutoSleep(options: AutoSleepOptions): () => void {
	const {
		activeMs,
		inactiveResetMs,
		battleGraceMs,
		onSleep,
		getPathname,
		getHidden = () => document.hidden,
	} = options;

	let lastActive = Date.now();
	let accumulated = 0;

	function onActivity() {
		lastActive = Date.now();
	}

	window.addEventListener('pointerdown', onActivity, { passive: true });
	window.addEventListener('keydown', onActivity, { passive: true });

	const timer = setInterval(() => {
		if (getHidden()) return;

		const now = Date.now();
		const isBattlePath = getPathname().includes('/battle');
		const threshold = activeMs + (isBattlePath ? battleGraceMs : 0);

		if (now - lastActive < inactiveResetMs) {
			accumulated += 1000;
			if (accumulated >= threshold) {
				accumulated = 0;
				onSleep();
			}
		} else {
			accumulated = 0;
		}
	}, 1000);

	return () => {
		clearInterval(timer);
		window.removeEventListener('pointerdown', onActivity);
		window.removeEventListener('keydown', onActivity);
	};
}
