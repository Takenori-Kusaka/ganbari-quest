/**
 * scripts/capture-specs/flows/child-celebration-click-intercept-4433.mjs (#4433)
 *
 * 「祝福ダイアログとログインボーナスが重なって click が届かない」の Before / After を
 * 子供向け 4 年齢モードで撮る。`AUTH_MODE=local` (`npm run dev`) で動作。
 * baby は `showSiblingFeatures=false` で祝福自体が出ない年齢帯のため対象外 (ADR-0011)。
 *
 * ## 事前条件 (撮影者が用意する)
 *
 * dev DB (`data/ganbari-quest.db`):
 *
 *   children: id 1=preschool / 3=elementary / 4=junior / 5=senior
 *   child_challenges: completed=1 / reward_claimed=0 / celebration_shown_at=NULL /
 *                     start_date <= 今日 <= end_date / source_template_id='ss-4433'
 *   login_streaks:   last_login_date を前日に戻す (= ログインボーナスが必ず発火する)
 *   settings:        `pin_gate_onboarding_seen` = 'true' (初回訪問 dialog を出さない)
 *
 * ## このフローが撮るもの
 *
 * 1. `*-landing` — ホーム着地直後
 *    - 修正前 (develop): 祝福とログインボーナスが**同時に開く**。祝福が手前に見えるのに
 *      pointer-events を失っていて閉じるボタンが押せない (本 Issue の症状)
 *    - 修正後: 開いているのは 1 枚だけ
 * 2. `*-celebration` — 祝福が操作可能な状態で見えているところ
 * 3. `*-closed` — 自動演出をすべて閉じ切ってホームに戻ったところ (子供が記録に進める)
 *
 * 固定待ちは使わず、overlay の visible / detached を待って進む。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5293 node scripts/capture.mjs --pr <N> \
 *     --flow child-celebration-click-intercept-4433 \
 *     --url /switch \
 *     --actions scripts/capture-specs/flows/child-celebration-click-intercept-4433.mjs \
 *     --presets mobile
 */

const CHILDREN = [
	{ childId: 1, uiMode: 'preschool' },
	{ childId: 3, uiMode: 'elementary' },
	{ childId: 4, uiMode: 'junior' },
	{ childId: 5, uiMode: 'senior' },
];

/** 子供ホームで自動的に開く全画面の演出と、その閉じるボタン。 */
const AUTO_OVERLAYS = [
	{ overlay: '[data-testid="stamp-press-overlay"]', close: '[data-testid="login-bonus-confirm"]' },
	{ overlay: '[data-testid="cheer-overlay"]', close: '[data-testid="cheer-overlay-close"]' },
	{
		overlay: '[data-testid="sibling-celebration"]',
		close: '[data-testid="sibling-celebration-close"]',
	},
];
const CELEBRATION = '[data-testid="sibling-celebration"]';

/** 修正前 (develop) を撮るときは `CAPTURE_LABEL_PREFIX=before` を渡す。既定は after。 */
const PREFIX = process.env.CAPTURE_LABEL_PREFIX || 'after';
/** 同 flow を preset 違いで流すときに step 名の衝突を避ける (#4410 flow と同方針)。 */
const SUFFIX = process.env.CAPTURE_LABEL_SUFFIX ? `-${process.env.CAPTURE_LABEL_SUFFIX}` : '';

/** @param {import('playwright').Page} page */
async function selectChild(page, childId, uiMode) {
	// FlowRecorder の context は baseURL を持たないため絶対 URL で遷移する
	await page.goto(new URL('/switch', page.url()).href, { waitUntil: 'domcontentloaded' });
	await page.locator(`[data-testid="child-select-${childId}"]`).click();
	await page.locator(`[data-testid="${uiMode}-home-page"]`).waitFor({ state: 'visible' });
}

/** いま見えている自動演出のうち先頭 1 件を返す (無ければ null)。 */
async function firstVisibleOverlay(page) {
	for (const o of AUTO_OVERLAYS) {
		if (
			await page
				.locator(o.overlay)
				.isVisible()
				.catch(() => false)
		) {
			return o;
		}
	}
	return null;
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// デモ Cookie が残っていると isDemo=true になり child 一覧が空になる
	await page.context().clearCookies();
	// 本 PR の対象ではない使い方ガイドのバナーを画面から外す (localStorage 由来)
	await page.addInitScript(() => {
		try {
			for (const id of [1, 2, 3, 4, 5])
				localStorage.setItem(`child_tutorial_hint_shown_${id}`, '1');
		} catch {
			/* localStorage 不可の環境では何もしない */
		}
	});

	for (const { childId, uiMode } of CHILDREN) {
		await selectChild(page, childId, uiMode);

		// ① 着地直後 — 修正前は祝福 + ログインボーナスが重なる / 修正後は 1 枚
		await page
			.locator(AUTO_OVERLAYS.map((o) => o.overlay).join(', '))
			.first()
			.waitFor({ state: 'visible', timeout: 20_000 });
		await capture(`${PREFIX}-${uiMode}-landing${SUFFIX}`);

		// ② 祝福が操作可能な状態になるまで、先に出ている演出を閉じていく
		let celebrationCaptured = false;
		for (let i = 0; i < AUTO_OVERLAYS.length + 1; i++) {
			const current = await firstVisibleOverlay(page);
			if (!current) break;

			if (current.overlay === CELEBRATION && !celebrationCaptured) {
				await capture(`${PREFIX}-${uiMode}-celebration${SUFFIX}`);
				celebrationCaptured = true;
			}
			await page.locator(current.close).click();
			await page.locator(current.overlay).waitFor({ state: 'detached', timeout: 15_000 });
		}

		// ③ 閉じ切ったホーム — 子供が活動の記録に進める状態
		await capture(`${PREFIX}-${uiMode}-closed${SUFFIX}`);
	}
};
