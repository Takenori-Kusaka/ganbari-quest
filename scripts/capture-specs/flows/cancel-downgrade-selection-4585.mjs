/**
 * scripts/capture-specs/flows/cancel-downgrade-selection-4585.mjs (#4585-1)
 *
 * 解約フロー (/admin/subscription/cancel) を「どの記録を残すか」の選択 UI に合流させた
 * 変更を撮る。撮る 2 枚:
 *   1. 解約画面 … 「選ばずに進めた場合」に何が残るか (fallback 規則) の提示
 *   2. 送信直後 … DowngradeResourceSelector (請求パネルと同じ選択ダイアログ) が開くこと
 *
 * 変更前 (origin/develop) は 1 が存在せず、2 は開かずそのまま Stripe portal へ送っていた。
 *
 * AUTH_MODE=cognito (npm run dev:cognito、#1026) で動作させる。有料プランの実効 tier が
 * 要るため standard@example.com (dev-tenant-standard、licenseStatus=active) でログインする。
 *
 * 使用例 (Before は develop を checkout した状態で SS_PREFIX=before- を付けて実行):
 *   SS_PREFIX=after- node scripts/capture.mjs --pr <N> \
 *     --flow cancel-downgrade-selection-4585 \
 *     --url /admin/subscription/cancel \
 *     --actions scripts/capture-specs/flows/cancel-downgrade-selection-4585.mjs \
 *     --server-mode cognito --presets desktop
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const PREFIX = process.env.SS_PREFIX ?? '';

/** cognito-dev のログインフォームを通す (cancel-vs-deletion-4496.mjs と同型) */
async function loginAsStandardOwner(page) {
	await page.goto(`${BASE_URL}/auth/login`);
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForFunction(
		() => document.querySelector('input[name="email"]')?.getAttribute('type') === 'email',
		{ timeout: 15_000 },
	);

	await page.getByLabel('メールアドレス').click();
	await page.keyboard.type('standard@example.com', { delay: 20 });
	await page.getByLabel('パスワード', { exact: true }).click();
	await page.keyboard.type('Gq!Dev#Std2026xyz', { delay: 20 });

	await page
		.locator('button[type="submit"]:not([disabled])')
		.first()
		.waitFor({ state: 'visible', timeout: 30_000 });
	await page.getByRole('button', { name: 'ログイン' }).click();
	await page.waitForURL(/\/(admin|ops|setup|billing|switch|child)/, { timeout: 30_000 });
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await loginAsStandardOwner(page);

	// 1. 解約画面 — fallback (選ばずに進めた場合) の提示
	//    hydration 前に操作すると radio の change が Svelte state に載らず submit が disabled の
	//    ままになるため networkidle まで待つ。
	await page.goto(`${BASE_URL}/admin/subscription/cancel`, { waitUntil: 'networkidle' });
	await page
		.getByTestId('cancellation-form')
		.waitFor({ state: 'visible', timeout: 30_000 })
		.catch(() => {});
	await capture(`${PREFIX}cancel-fallback-notice`);

	// 2. 理由を選んで送信 → 選択ダイアログ (変更前は開かず portal へ送っていた)
	// hydration 完了前の click は Svelte state に載らず submit が disabled のまま残る。
	// 「一度クリックして待つ」だけだと撮影機の負荷次第で取りこぼすため、有効化を条件に押し直す。
	const submitBtn = page.getByTestId('cancellation-submit');
	await page.getByTestId('cancellation-category-churn').click();
	for (let i = 0; i < 20 && (await submitBtn.isDisabled()); i++) {
		await page.getByTestId('cancellation-category-churn').click();
		await page
			.locator('[data-testid="cancellation-submit"]:not([disabled])')
			.waitFor({ state: 'visible', timeout: 1_000 })
			.catch(() => {});
	}
	await page
		.locator('[data-testid="cancellation-submit"]:not([disabled])')
		.waitFor({ state: 'visible', timeout: 15_000 });
	await page.getByTestId('cancellation-submit').click();
	await page
		.getByTestId('downgrade-resource-selector')
		.waitFor({ state: 'visible', timeout: 15_000 })
		.catch(() => {});
	await capture(`${PREFIX}cancel-downgrade-selector`);

	// 3. ダイアログを閉じた状態 — 確定ボタンは超過分を選ぶまで押せないため、「どれも
	//    手放したくない」顧客はここで閉じるしかない。閉じたあと解約を続けられることを撮る。
	const dismiss = page.getByRole('button', { name: 'キャンセル' }).first();
	if (await dismiss.isVisible().catch(() => false)) {
		await dismiss.click();
		await page
			.getByTestId('cancellation-selection-skipped')
			.waitFor({ state: 'visible', timeout: 15_000 })
			.catch(() => {});
	}
	await capture(`${PREFIX}cancel-selection-skipped`);
};
