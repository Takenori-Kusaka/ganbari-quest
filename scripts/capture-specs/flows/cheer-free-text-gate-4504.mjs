/**
 * scripts/capture-specs/flows/cheer-free-text-gate-4504.mjs (#4504)
 *
 * `/admin/cheer` の Step 6「付随スタンプ / メッセージ」を撮る。
 *
 *   before … 全プランで自由テキスト入力欄が出ていた (ゲート無し)
 *   after  … premium 以外は入力欄が消え、「スタンプは今のプランでも送れる」旨の説明に変わる
 *
 * `dev:cognito` の owner@example.com は **スタンダード** なので、この環境で
 * 「ロックされた側」が撮れる (premium 側は plan を切り替えないと出ない)。
 *
 * AUTH_MODE=cognito (npm run dev:cognito、#1026) で動作させる。
 *
 * 使用例:
 *   SS_PHASE=after BASE_URL=http://localhost:5187 node scripts/capture.mjs --pr <N> \
 *     --flow cheer-free-text-gate \
 *     --url /admin/cheer \
 *     --actions scripts/capture-specs/flows/cheer-free-text-gate-4504.mjs \
 *     --presets desktop
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const PHASE = process.env.SS_PHASE === 'before' ? 'before' : 'after';

/** cognito-dev のログインフォームを通す (cancel-vs-deletion-4496.mjs と同型) */
async function loginAsOwner(page) {
	await page.goto(`${BASE_URL}/auth/login`);
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForFunction(
		() => document.querySelector('input[name="email"]')?.getAttribute('type') === 'email',
		{ timeout: 15_000 },
	);

	await page.getByLabel('メールアドレス').click();
	await page.keyboard.type('owner@example.com', { delay: 20 });
	await page.getByLabel('パスワード', { exact: true }).click();
	await page.keyboard.type('Gq!Dev#Owner2026x', { delay: 20 });

	await page
		.locator('button[type="submit"]:not([disabled])')
		.first()
		.waitFor({ state: 'visible', timeout: 30_000 });
	await page.getByRole('button', { name: 'ログイン' }).click();
	await page.waitForURL(/\/(admin|ops|setup|billing|switch|child)/, { timeout: 30_000 });
}

/** 子供が 0 人なら 1 人だけ登録する (cheer フォームの描画条件を満たすため) */
async function ensureChild(page) {
	// login 直後は redirect が飛んでいる最中で goto が ERR_ABORTED になることがある
	await page.waitForLoadState('networkidle').catch(() => {});
	await page.goto(`${BASE_URL}/admin/children`, { waitUntil: 'domcontentloaded' }).catch(async () => {
		await page.waitForTimeout(1_000);
		await page.goto(`${BASE_URL}/admin/children`, { waitUntil: 'domcontentloaded' });
	});
	await page.waitForLoadState('networkidle').catch(() => {});
	const existing = page.getByText('はなちゃん', { exact: false }).first();
	if (await existing.isVisible().catch(() => false)) return;

	const addToggle = page.locator('[data-tutorial="add-child-btn"]');
	await addToggle.waitFor({ state: 'visible', timeout: 20_000 });
	const nickname = page.locator('#add-nickname');
	for (let attempt = 0; attempt < 5; attempt++) {
		await addToggle.click();
		const opened = await nickname
			.waitFor({ state: 'visible', timeout: 3_000 })
			.then(() => true)
			.catch(() => false);
		if (opened) break;
	}
	await nickname.fill('はなちゃん');
	await page.locator('#add-age').fill('8');
	await page.getByRole('button', { name: '追加する' }).click();
	await page
		.getByText('はなちゃん', { exact: false })
		.first()
		.waitFor({ state: 'visible', timeout: 20_000 });
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await loginAsOwner(page);

	// cheer の入力フォームは子供が 1 人も居ないと描画されない (empty state になる)。
	// local sqlite は空なので、撮影前に 1 人だけ作る (admin-children-add-4413.mjs と同型)。
	await ensureChild(page);

	await page.goto(`${BASE_URL}/admin/cheer`, { waitUntil: 'domcontentloaded' });
	await page
		.getByText('付随スタンプ', { exact: false })
		.first()
		.waitFor({ state: 'visible', timeout: 30_000 })
		.catch(() => {});
	await page
		.getByText('付随スタンプ', { exact: false })
		.first()
		.scrollIntoViewIfNeeded()
		.catch(() => {});
	await capture(`${PHASE}-cheer-extra-step`);
};
