/**
 * scripts/capture-specs/flows/admin-children-add-4413.mjs
 *
 * #4413: 子供を新規登録し、その直後の `/admin/children` 一覧を撮る。
 * 仮アバター実装の前後で「登録した子供に色付きの頭文字アバターが付くか / 👤 のままか」を比較する。
 *
 * 登録するニックネームは環境変数 `CAPTURE_CHILD_NICKNAME` で指定する
 * (before / after で別名にすると、同じ一覧に両方が並び「既存の子供は backfill しない」ことも同時に写る)。
 *
 * 使用例:
 *   CAPTURE_CHILD_NICKNAME=あおい BASE_URL=http://localhost:5197 node scripts/capture.mjs \
 *     --flow admin-children-add-4413 --url /admin/children \
 *     --actions scripts/capture-specs/flows/admin-children-add-4413.mjs --presets desktop
 */

const NICKNAME = process.env.CAPTURE_CHILD_NICKNAME ?? 'あおい';
const AGE = process.env.CAPTURE_CHILD_AGE ?? '7';

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
	// capture recorder が既に --url へ navigate 済のため二重 goto しない。
	const addToggle = page.locator('[data-tutorial="add-child-btn"]');
	await addToggle.waitFor({ state: 'visible', timeout: 20_000 });

	// Svelte 5 hydration race を click retry で吸収する (フォームが開くまで押し直す)。
	const nickname = page.locator('#add-nickname');
	for (let attempt = 0; attempt < 5; attempt++) {
		await addToggle.click();
		const opened = await nickname
			.waitFor({ state: 'visible', timeout: 3_000 })
			.then(() => true)
			.catch(() => false);
		if (opened) break;
	}
	await nickname.waitFor({ state: 'visible', timeout: 20_000 });

	await nickname.fill(NICKNAME);
	await page.locator('#add-age').fill(AGE);

	// 送信 → 一覧に登録した子供が現れるまで待つ (use:enhance で partial update)。
	await page.getByRole('button', { name: '追加する' }).click();
	await page
		.getByText(NICKNAME, { exact: false })
		.first()
		.waitFor({ state: 'visible', timeout: 20_000 });

	// アバター画像 / 👤 プレースホルダの描画完了を待ってから撮る。
	await page
		.locator('.child-list-card__avatar')
		.first()
		.waitFor({ state: 'visible', timeout: 20_000 });
	await settle(page);

	await capture('admin-children-avatar');
};
