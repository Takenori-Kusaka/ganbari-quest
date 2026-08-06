/**
 * scripts/capture-specs/flows/child-home-habit-notice-4261.mjs (#4261 ③)
 *
 * 習慣化告知バナーを 4 つの子供向け年齢モードで撮る。
 * `AUTH_MODE=local` (`npm run dev`) で動作。
 *
 * ## 事前条件 (撮影者が用意する)
 *
 * dev DB (`data/ganbari-quest.db`) に 4 モードの子供と pending の告知が入っていること:
 *
 *   children: id 1=preschool / 2=elementary / 3=junior / 4=senior
 *   settings: `habit_certificate_notice:<childId>` = {"yearMonth":"2026-08","points":50}
 *   settings: `pin_gate_onboarding_seen` = 'true' (初回訪問 dialog を出さない)
 *
 * ## このフローが撮るもの
 *
 * 1 周目 (`after-*`) — pending がある回。バナーが出る
 * 2 周目 (`before-*`) — 同じ画面を再訪。**表示した時点で既読になっている**ため出ない
 *   (= 修正前 / develop と同じ描画。かつ「1 回だけ」の実機証跡になる)
 *
 * 既読化 (`?/ackHabitCertificateNotice`) のレスポンスを待ってから次へ進むため、
 * 固定待ちを使わずに 2 周目の状態が決定的になる。
 *
 * 使用例:
 *   node scripts/capture.mjs --pr <N> \
 *     --flow child-home-habit-notice-4261 \
 *     --url /switch \
 *     --actions scripts/capture-specs/flows/child-home-habit-notice-4261.mjs \
 *     --presets mobile
 */

const CHILDREN = [
	{ childId: 1, uiMode: 'preschool' },
	{ childId: 2, uiMode: 'elementary' },
	{ childId: 3, uiMode: 'junior' },
	{ childId: 4, uiMode: 'senior' },
];

const NOTICE = '[data-testid="habit-certificate-notice"]';

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
	// 遷移完了後に waitForURL を呼ぶと取りこぼすため、home の testid 出現で待つ
	await page.locator(`[data-testid="${uiMode}-home-page"]`).waitFor({ state: 'visible' });
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
			for (const id of [1, 2, 3, 4]) localStorage.setItem(`child_tutorial_hint_shown_${id}`, '1');
		} catch {
			/* localStorage 不可の環境では何もしない */
		}
	});

	// 1 周目: pending あり → バナーが出る
	for (const { childId, uiMode } of CHILDREN) {
		const acked = page.waitForResponse((r) => r.url().includes('ackHabitCertificateNotice'));
		await selectChild(page, childId, uiMode);
		await page.locator(NOTICE).waitFor({ state: 'visible' });
		await capture(`after-${uiMode}${SUFFIX}`);
		// 既読化が着地するまで待つ (着地前に離脱すると 2 周目にまた出る)
		await acked;
	}

	// 2 周目: 既読化済 → 出ない (= 修正前と同じ描画 / 「1 回だけ」の実機証跡)
	for (const { childId, uiMode } of CHILDREN) {
		await selectChild(page, childId, uiMode);
		await page.locator(NOTICE).waitFor({ state: 'detached' });
		await capture(`before-${uiMode}${SUFFIX}`);
	}
};
