/**
 * scripts/capture-specs/flows/admin-children-avatar-4397.mjs
 *
 * #4397: アバターの AI 生成機能を廃止した SS。子供プロフィールの編集モードを開き、
 * 「プロフィール写真」セクションに **写真アップロードだけが残っている** ことを撮る。
 *
 * 本番ルート `/admin/children` を demo Lambda 同型 env (AUTH_MODE=anonymous + DATA_SOURCE=demo)
 * で起動した dev server 上で開き、`?screenshot=all` で demo 固有 UI を抑止する。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5188 node scripts/capture.mjs \
 *     --flow admin-children-avatar-4397 \
 *     --url "/admin/children?screenshot=all" \
 *     --actions scripts/capture-specs/flows/admin-children-avatar-4397.mjs \
 *     --presets desktop,mobile --pr 4397 --no-start-server
 */

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
	// 子供一覧カードの先頭を選択して詳細 (ChildProfileCard) を開く。
	const firstChildLink = page.locator('a[href^="/admin/children?id="]').first();
	await firstChildLink.waitFor({ state: 'visible', timeout: 20_000 });
	await firstChildLink.click();

	// 詳細カードの「編集」ボタン (view mode) が出るまで待つ。
	const editBtn = page.getByRole('button', { name: /編集/ }).first();
	await editBtn.waitFor({ state: 'visible', timeout: 20_000 });

	// Svelte 5 hydration race を click retry で吸収する。
	for (let attempt = 0; attempt < 5; attempt++) {
		await editBtn.click();
		const opened = await page
			.getByText('プロフィール写真', { exact: true })
			.first()
			.waitFor({ state: 'visible', timeout: 3_000 })
			.then(() => true)
			.catch(() => false);
		if (opened) break;
	}

	const section = page.getByText('プロフィール写真', { exact: true }).first();
	await section.waitFor({ state: 'visible', timeout: 20_000 });
	await section.scrollIntoViewIfNeeded();
	await settle(page);

	await capture('issue-4397-admin-children-avatar-section');
};
