/**
 * scripts/capture-specs/flows/child-challenge-celebration-once-4410.mjs (#4410)
 *
 * チャレンジ達成の祝福ダイアログを 4 つの子供向け年齢モードで撮る。
 * `AUTH_MODE=local` (`npm run dev`) で動作。baby は `showSiblingFeatures=false` で
 * 祝福自体が出ない年齢帯のため対象外 (ADR-0011)。
 *
 * ## 事前条件 (撮影者が用意する)
 *
 * dev DB (`data/ganbari-quest.db`) に「達成済・ごほうび未受取・祝福未表示」の
 * child_challenge が 4 モード分入っていること:
 *
 *   children: id 1=preschool / 3=elementary / 4=junior / 5=senior
 *   child_challenges: completed=1 / reward_claimed=0 / celebration_shown_at=NULL /
 *                     start_date <= 今日 <= end_date / source_template_id='ss-4410'
 *   settings: `pin_gate_onboarding_seen` = 'true' (初回訪問 dialog を出さない)
 *
 * develop (修正前) 側で撮る場合は `celebration_shown_at` 列を除いて同じ行を入れる。
 *
 * ## このフローが撮るもの
 *
 * 1 周目 (`*-shown`) — 祝福が出ている状態 (修正後も出る = 出なくなりすぎていない証跡)
 * 2 周目 (`*-revisit`) — 閉じたあとホームに入り直した状態
 *   - 修正後: 出ない
 *   - 修正前 (develop): **また出る** = 本 Issue の症状そのもの
 *
 * 「見せた」記録 (`?/markChallengeCelebrationShown`) のレスポンスを待ってから次に進むため、
 * 固定待ちを使わずに 2 周目の状態が決定的になる (修正前は同 action が無いので待たない)。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5292 node scripts/capture.mjs --pr <N> \
 *     --flow child-challenge-celebration-once-4410 \
 *     --url /switch \
 *     --actions scripts/capture-specs/flows/child-challenge-celebration-once-4410.mjs \
 *     --presets mobile
 */

const CHILDREN = [
	{ childId: 1, uiMode: 'preschool' },
	{ childId: 3, uiMode: 'elementary' },
	{ childId: 4, uiMode: 'junior' },
	{ childId: 5, uiMode: 'senior' },
];

const CELEBRATION = '[data-testid="sibling-celebration"]';
const CLOSE_BTN = '[data-testid="sibling-celebration-close"]';
const LOGIN_BONUS_CONFIRM = '[data-testid="login-bonus-confirm"]';

/** 修正前 (develop) を撮るときは `CAPTURE_LABEL_PREFIX=before` を渡す。既定は after。 */
const PREFIX = process.env.CAPTURE_LABEL_PREFIX || 'after';
/**
 * 同じ flow を preset 違いで 2 回流すと step 名が衝突し、後の run が前の run の SS を
 * 上書きする (screenshots branch は file 名で同定する)。`CAPTURE_LABEL_SUFFIX` で分ける。
 */
const SUFFIX = process.env.CAPTURE_LABEL_SUFFIX ? `-${process.env.CAPTURE_LABEL_SUFFIX}` : '';

/** @param {import('playwright').Page} page */
async function selectChild(page, childId, uiMode) {
	// FlowRecorder の context は baseURL を持たないため絶対 URL で遷移する
	await page.goto(new URL('/switch', page.url()).href, { waitUntil: 'domcontentloaded' });
	await page.locator(`[data-testid="child-select-${childId}"]`).click();
	await page.locator(`[data-testid="${uiMode}-home-page"]`).waitFor({ state: 'visible' });
}

/**
 * ログインボーナス (おみくじ) overlay を閉じる。
 * 本 overlay は祝福の上に重なって click を intercept するため、実ユーザーと同じ順序で先に閉じる。
 */
async function dismissLoginBonus(page) {
	const confirm = page.locator(LOGIN_BONUS_CONFIRM);
	await confirm.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
	if (await confirm.isVisible().catch(() => false)) {
		await confirm.click();
		await page
			.locator('[data-testid="stamp-press-overlay"]')
			.waitFor({ state: 'hidden', timeout: 10_000 })
			.catch(() => {});
	}
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
			for (const id of [1, 2, 3, 4, 5]) localStorage.setItem(`child_tutorial_hint_shown_${id}`, '1');
		} catch {
			/* localStorage 不可の環境では何もしない */
		}
	});

	// 1 周目: 未表示 → 祝福が出る。閉じるところまでやる
	for (const { childId, uiMode } of CHILDREN) {
		await selectChild(page, childId, uiMode);
		await page.locator(CELEBRATION).waitFor({ state: 'visible' });
		await capture(`${PREFIX}-${uiMode}-celebration-shown${SUFFIX}`);

		await dismissLoginBonus(page);
		// 修正後は閉じる = 「見せた」の永続化。着地を待ってから離脱する
		// (修正前 = develop には本 action が無いので待たない)
		const marked =
			PREFIX === 'after'
				? page.waitForResponse((r) => r.url().includes('markChallengeCelebrationShown'))
				: Promise.resolve();
		await page.locator(CLOSE_BTN).click();
		await marked;
		await page.locator(CELEBRATION).waitFor({ state: 'detached' });
	}

	// 2 周目: 閉じたあとホームに入り直す
	//   修正後 = 出ない / 修正前 = また出る (本 Issue の症状)
	for (const { childId, uiMode } of CHILDREN) {
		await selectChild(page, childId, uiMode);
		if (PREFIX === 'after') {
			await page.locator(CELEBRATION).waitFor({ state: 'detached' });
		} else {
			await page.locator(CELEBRATION).waitFor({ state: 'visible' });
		}
		await capture(`${PREFIX}-${uiMode}-celebration-revisit${SUFFIX}`);
	}
};
