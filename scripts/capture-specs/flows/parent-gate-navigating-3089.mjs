/**
 * scripts/capture-specs/flows/parent-gate-navigating-3089.mjs (#3089)
 *
 * /switch ページの PIN 認証成功 → 親画面遷移中に表示される全画面 progress overlay
 * (data-testid="parent-gate-navigating") を撮影する flow。
 *
 * overlay は本来 window.location.href='/admin' のハードナビ直前の microtask だけ存在する
 * transient state のため静的撮影が困難。そこで既存の `?screenshot=all` モード
 * (src/routes/CLAUDE.md §?screenshot、MilestoneBanner の bypassSeenCheck と同型) に乗せ、
 * switch/+page.svelte 側で `getScreenshotModeKind()==='all'` のとき overlay を強制描画する。
 * 本 flow は `/switch?screenshot=all` を開いて real component を決定的に撮影する
 * (mock inject ではなく実物の overlay component を描画する正規手段)。
 *
 * 動作前提: PARENT_GATE_FORCE_ACTIVE=true npm run dev:cognito (port 5174)
 *   または capture.mjs --server-mode cognito で起動。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 PARENT_GATE_FORCE_ACTIVE=true node scripts/capture.mjs \
 *     --pr 3091 --server-mode cognito \
 *     --flow parent-gate-navigating-3089 \
 *     --url "/switch?screenshot=all" \
 *     --actions scripts/capture-specs/flows/parent-gate-navigating-3089.mjs \
 *     --presets mobile,desktop
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';

async function loginAs(page, email, password) {
	await page.goto(`${BASE_URL}/auth/login`);
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForFunction(
		() => {
			const input = document.querySelector('input[name="email"]');
			return input?.getAttribute('type') === 'email';
		},
		{ timeout: 15_000 },
	);

	const emailInput = page.getByLabel('メールアドレス');
	await emailInput.click();
	for (const ch of email) {
		await page.keyboard.type(ch, { delay: 20 });
	}

	const pwdInput = page.getByLabel('パスワード', { exact: true });
	await pwdInput.click();
	for (const ch of password) {
		await page.keyboard.type(ch, { delay: 20 });
	}

	await page.locator('button[type="submit"]:not([disabled])').first().waitFor({
		state: 'visible',
		timeout: 30_000,
	});
	await page.getByRole('button', { name: 'ログイン' }).click();
	await page.waitForURL(/\/(admin|ops|setup|billing|switch|child)/, { timeout: 30_000 });
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await loginAs(page, 'owner@example.com', 'Gq!Dev#Owner2026x');

	// screenshot mode で overlay を強制描画 (実 component)。ハードナビも PIN 入力も不要。
	await page.goto(`${BASE_URL}/switch?screenshot=all`);

	const overlay = page.getByTestId('parent-gate-navigating');
	await overlay.waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForFunction(
		() => {
			const el = document.querySelector('[data-testid="parent-gate-navigating"]');
			return !!(el?.textContent && el.textContent.includes('ひらいています'));
		},
		{ timeout: 5_000 },
	);

	await capture('parent-gate-navigating');
};
