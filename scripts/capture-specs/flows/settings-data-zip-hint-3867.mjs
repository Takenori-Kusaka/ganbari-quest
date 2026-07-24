/**
 * scripts/capture-specs/flows/settings-data-zip-hint-3867.mjs
 *
 * #3867 バックアップ画面 (/admin/settings/data) の ZIP エクスポート推奨文言の
 * 環境別出し分け SS 撮影フロー。
 *
 * 「画像・音声ファイルも含める」を ON にすると ZIP hint 領域が描画される。
 * hint は cloud export セクション (authMode==='cognito' 専用) と同一条件でガードされ:
 *   - SaaS (dev:cognito, authMode='cognito') → data-export-zip-cloud-hint (「下のクラウドバックアップがおすすめ」)
 *   - NUC  (dev, authMode≠cognito)          → data-export-zip-local-hint  (クラウド非言及の安心文言)
 *
 * 使用例 (NUC 相当 = npm run dev):
 *   MSYS_NO_PATHCONV=1 node scripts/capture.mjs --flow settings-data-zip-hint-3867 \
 *     --url /admin/settings/data \
 *     --actions scripts/capture-specs/flows/settings-data-zip-hint-3867.mjs \
 *     --presets desktop --pr 3867
 *
 * 使用例 (SaaS 相当 = dev:cognito):
 *   同上 + --server-mode cognito
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

async function settle(page) {
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await page.goto(`${BASE_URL}/admin/settings/data`);

	// NUC local mode の初期 DB は子供 0 → hooks が /setup へ 302。
	// setup step1 (子供登録) を 1 件完了して setup gate を解除してから admin に戻る。
	if (/\/setup/.test(page.url())) {
		const nickname = page.locator('input[placeholder="たろうくん"]').first();
		await nickname.waitFor({ state: 'visible', timeout: 15_000 });
		await nickname.fill('たろうくん');
		await page.locator('input[type="number"]').first().fill('8');
		await Promise.all([
			page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 15_000 }),
			page.getByRole('button', { name: /追加する/ }).click(),
		]);
		await settle(page);
		await page.goto(`${BASE_URL}/admin/settings/data`);
	}

	// 「画像・音声ファイルも含める」チェックボックス (エクスポートカード内の先頭 checkbox) を ON にする。
	// label 経由 (getByLabel) だと Svelte bind:checked に伝播しないケースがあるため input を直接 click する。
	const includeFiles = page.locator('input[type="checkbox"]').first();
	await includeFiles.waitFor({ state: 'visible', timeout: 15_000 });
	await includeFiles.click();
	await settle(page);

	// ZIP hint 領域 (cloud / local どちらか一方が描画される) が出るまで待つ
	await page
		.locator(
			'[data-testid="data-export-zip-cloud-hint"], [data-testid="data-export-zip-local-hint"]',
		)
		.first()
		.waitFor({ state: 'visible', timeout: 10_000 });
	await settle(page);
	await capture('3867-settings-data-zip-hint');
};
