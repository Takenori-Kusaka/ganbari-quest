/**
 * scripts/capture-specs/flows/admin-children-edit-avatar-4453.mjs
 *
 * #4453: 子供を登録 → **ニックネームを別の頭文字に変更** → `/admin/children` 一覧を撮る。
 * 修正前は仮アバターが古い頭文字のまま (名前だけ変わる)、修正後は新しい頭文字に追随する。
 *
 * ニックネームは環境変数で指定する (before / after で別の子供を作れば、同じ tenant の
 * DB を使い回しても互いの結果が混ざらない):
 *   CAPTURE_CHILD_NICKNAME       登録時の名前 (既定: あおい)
 *   CAPTURE_CHILD_NICKNAME_AFTER 変更後の名前 (既定: はると) — 頭文字を変えること
 *
 * 使用例:
 *   CAPTURE_CHILD_NICKNAME=あおい CAPTURE_CHILD_NICKNAME_AFTER=はると \
 *   BASE_URL=http://localhost:5174 node scripts/capture.mjs \
 *     --flow admin-children-edit-avatar-4453 --url /admin/children \
 *     --actions scripts/capture-specs/flows/admin-children-edit-avatar-4453.mjs --presets desktop
 */

const NICKNAME = process.env.CAPTURE_CHILD_NICKNAME ?? 'あおい';
const NICKNAME_AFTER = process.env.CAPTURE_CHILD_NICKNAME_AFTER ?? 'はると';
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
	// --- 1. 子供を登録する (仮アバターが付く) ---
	const addToggle = page.locator('[data-tutorial="add-child-btn"]');
	await addToggle.waitFor({ state: 'visible', timeout: 20_000 });

	// Svelte 5 hydration race を click retry で吸収する (admin-children-add-4413 と同じ理由)。
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
	await page.getByRole('button', { name: '追加する' }).click();

	const addedCard = page.getByText(NICKNAME, { exact: true }).first();
	await addedCard.waitFor({ state: 'visible', timeout: 20_000 });

	// --- 2. その子供を選んで編集モードに入り、ニックネームを変える ---
	await addedCard.click();
	const editButton = page.getByRole('button', { name: /編集/ }).first();
	await editButton.waitFor({ state: 'visible', timeout: 20_000 });
	await editButton.click();

	const editNickname = page.locator('input[name="nickname"]').first();
	await editNickname.waitFor({ state: 'visible', timeout: 20_000 });
	await editNickname.fill(NICKNAME_AFTER);
	await page.getByRole('button', { name: /保存/ }).first().click();

	// --- 3. 変更後の一覧を撮る (名前が変わった行のアバターに注目) ---
	await page
		.getByText(NICKNAME_AFTER, { exact: true })
		.first()
		.waitFor({ state: 'visible', timeout: 20_000 });
	await page
		.locator('.child-list-card__avatar')
		.first()
		.waitFor({ state: 'visible', timeout: 20_000 });
	await settle(page);

	await capture('admin-children-edit-avatar');
};
