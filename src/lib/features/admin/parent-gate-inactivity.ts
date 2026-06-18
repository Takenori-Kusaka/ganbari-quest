// src/lib/features/admin/parent-gate-inactivity.ts
//
// 親管理画面 (/admin/*) の inactivity タイマー。一定時間 (既定 15 分、parent-gate session の
// INACTIVITY_TIMEOUT_MS = 15 分 / NIST SP 800-63B-4 AAL1 と一致) 操作が無ければ onTimeout を
// 1 度だけ発火する。呼び出し側はそこで parent session を logout し /switch (子供選択画面) へ
// リダイレクトする。
//
// 背景: 旧来は parent session 失効を admin layout の server load (= ページ遷移時) でのみ判定して
// いたため、放置中はナビが起きず、画面が /admin のまま残り「操作だけ失敗する = 固まった」と
// ユーザに見えていた。本タイマーで「固める」のでなく「子供選択画面に戻す」挙動に変える
// (子供が放置画面を触れないという本来の意図を、固まらせずに達成。ADR-0012 anti-engagement 整合)。

/** parent-gate inactivity redirect の既定アイドル時間 (15 分)。server INACTIVITY_TIMEOUT_MS と一致。 */
export const PARENT_GATE_INACTIVITY_MS = 15 * 60 * 1000;

export interface ParentGateInactivityOptions {
	/** アイドル判定時間 (ms)。既定 15 分。 */
	timeoutMs?: number;
	/** タイマー満了時に 1 度だけ呼ばれる。logout + /switch リダイレクトを行う。 */
	onTimeout: () => void;
	/** チェック間隔 (ms)。既定 30 秒。 */
	tickMs?: number;
	/** テスト用に上書き可能。既定 Date.now。 */
	getNow?: () => number;
}

/**
 * inactivity タイマーを開始する。戻り値はクリーンアップ関数。
 * pointerdown / keydown / scroll / touchstart を「操作」とみなし lastActive を更新する。
 */
export function startParentGateInactivityRedirect(
	options: ParentGateInactivityOptions,
): () => void {
	const {
		timeoutMs = PARENT_GATE_INACTIVITY_MS,
		onTimeout,
		tickMs = 30_000,
		getNow = () => Date.now(),
	} = options;

	let lastActive = getNow();
	let fired = false;

	const onActivity = () => {
		lastActive = getNow();
	};

	const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
	for (const ev of events) {
		window.addEventListener(ev, onActivity, { passive: true });
	}

	const timer = setInterval(() => {
		if (fired) return;
		if (getNow() - lastActive >= timeoutMs) {
			fired = true;
			onTimeout();
		}
	}, tickMs);

	return () => {
		clearInterval(timer);
		for (const ev of events) {
			window.removeEventListener(ev, onActivity);
		}
	};
}
