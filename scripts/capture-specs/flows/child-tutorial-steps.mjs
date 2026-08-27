/**
 * scripts/capture-specs/flows/child-tutorial-steps.mjs
 *
 * 汎用: 子供ホームの ❓ から子供チュートリアルを起動し、全 step を順に撮影する (#4652、EPIC #4650)。
 * 子供チュートリアルを直す PR の before / after SS を同じ手順で撮るための共通フロー
 * (ページガイド用は page-guide-steps.mjs、#4677)。
 *
 * step ごとの label は `<CHILD_TUT_SS_PREFIX>-<CHILD_TUT_SS_PRESET>-<n>-<data-step-id>` になるため、
 * before / after で step 数が変わっても screenshots branch 上で basename が衝突しない。
 * PR body では `<!-- ss-pair: before=... after=... -->` で対応を宣言する。
 *
 * 使用例 (BASE_URL は認証済 dev server):
 *   CHILD_TUT_SS_PREFIX=after CHILD_TUT_SS_PRESET=preschool-mobile CHILD_TUT_SS_CHILD=たろうくん \
 *     MSYS_NO_PATHCONV=1 node scripts/capture.mjs --pr <N> --flow after-child-tut-preschool \
 *     --url /switch --actions scripts/capture-specs/flows/child-tutorial-steps.mjs --presets mobile
 *
 * env:
 *   CHILD_TUT_SS_PREFIX  before | after (既定 after)
 *   CHILD_TUT_SS_PRESET  label 用の識別子 (例 preschool-mobile)。viewport 自体は --presets で指定
 *   CHILD_TUT_SS_CHILD   /switch で選ぶお子さまの表示名 (必須)
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const PREFIX = process.env.CHILD_TUT_SS_PREFIX || 'after';
const PRESET = process.env.CHILD_TUT_SS_PRESET || 'child';
const CHILD = process.env.CHILD_TUT_SS_CHILD || '';

const HELP_BTN = '[data-testid="header-help-btn"]';
const BUBBLE = '.tutorial-bubble';
const NEXT_BTN = '.tutorial-nav-next';

/** rAF 2 回で spotlight の再配置 commit を待つ。 */
async function settleFrame(page) {
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
}

/** 子供ホーム到達時に auto-open する overlay 群を閉じ、チュートリアル起動を妨げないようにする。 */
async function dismissOverlays(page) {
	const testids = [
		'login-bonus-confirm',
		'pin-gate-onboarding-close',
		'weekly-redeem-confirm',
		'confirm-cancel-btn',
	];
	for (let pass = 0; pass < 4; pass++) {
		let dismissed = false;
		for (const id of testids) {
			const el = page.locator(`[data-testid="${id}"]`).first();
			if (await el.isVisible({ timeout: 300 }).catch(() => false)) {
				await el.click({ force: true, timeout: 2000 }).catch(() => {});
				dismissed = true;
			}
		}
		if (!dismissed) break;
	}
	await page.addStyleTag({
		content: `
			[data-scope="dialog"][data-part="positioner"],
			[data-scope="dialog"][data-part="backdrop"],
			[data-testid="stamp-press-overlay"],
			.sibling-cheer-overlay,
			.parent-message-overlay { pointer-events: none !important; }
		`,
	});
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// /switch から対象のお子さまを選ぶ (cold compile 中の click 落ちに備え 4 回まで再試行)
	for (let attempt = 0; attempt < 4; attempt++) {
		await page.goto(`${BASE_URL}/switch`, { waitUntil: 'domcontentloaded' });
		const btn = page.locator('[data-testid^="child-select-"]').filter({ hasText: CHILD });
		await btn.waitFor({ state: 'visible', timeout: 30_000 });
		await btn.click();
		const arrived = await page
			.waitForURL(/\/(baby|preschool|elementary|junior|senior)\/home/, { timeout: 10_000 })
			.then(() => true)
			.catch(() => false);
		if (arrived) break;
	}
	await dismissOverlays(page);
	// localStorage の進捗を消して常に最初から
	await page.evaluate(() => {
		localStorage.removeItem('tutorial-progress-chapter');
		localStorage.removeItem('tutorial-progress-step');
	});

	const helpBtn = page.locator(HELP_BTN);
	await helpBtn.waitFor({ state: 'visible', timeout: 15_000 });
	for (let attempt = 0; attempt < 3; attempt++) {
		await helpBtn.dispatchEvent('click');
		const started = await page
			.waitForFunction(() => document.documentElement.hasAttribute('data-tutorial-active'), null, {
				timeout: 3000,
			})
			.then(() => true)
			.catch(() => false);
		if (started) break;
	}

	const bubble = page.locator(BUBBLE);
	await bubble.waitFor({ state: 'visible', timeout: 15_000 });

	const MAX_STEPS = 12;
	for (let i = 0; i < MAX_STEPS; i++) {
		await settleFrame(page);
		await bubble.waitFor({ state: 'visible', timeout: 10_000 });
		const stepId = (await bubble.getAttribute('data-step-id')) ?? `step${i + 1}`;
		await capture(`${PREFIX}-${PRESET}-${String(i + 1).padStart(2, '0')}-${stepId}`);

		const nextBtn = bubble.locator(NEXT_BTN);
		const text = (await nextBtn.textContent().catch(() => '')) ?? '';
		if (text.includes('完了') || text.includes('おしまい')) break;
		await nextBtn.click();
		await page
			.waitForFunction(
				({ sel, prev }) => document.querySelector(sel)?.getAttribute('data-step-id') !== prev,
				{ sel: BUBBLE, prev: stepId },
				{ timeout: 5000 },
			)
			.catch(() => {});
	}
};
