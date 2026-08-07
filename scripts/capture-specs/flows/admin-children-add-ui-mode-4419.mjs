/**
 * scripts/capture-specs/flows/admin-children-add-ui-mode-4419.mjs
 *
 * #4419: `/admin/children` から年長の子供 (15 歳) を登録した直後の表示を撮る。
 * 修正前は年齢に関わらず「幼児 (3-5歳)」= preschool になり、修正後は年齢どおり
 * 「中学生 (13-15歳)」= junior になる。
 *
 * **demo backend では再現しない** (demo の insertChild は元から getDefaultUiMode を通し、
 * かつ登録が永続しない stub)。そのため通常の SS 撮影環境 (DATA_SOURCE=demo) ではなく、
 * **sqlite backend (`dev:cognito`)** で撮る。sqlite も修正前は「3 歳以上は全部 preschool」
 * で同じ症状が出るため、顧客が踏む壊れ方をそのまま画面で再現できる。
 *
 * 使用例 (専用 port で dev:cognito を起動しておく):
 *   AUTH_MODE=cognito COGNITO_DEV_MODE=true npx vite dev --port 5192 --strictPort
 *   MSYS_NO_PATHCONV=1 node scripts/capture.mjs \
 *     --flow admin-children-add-ui-mode-4419 \
 *     --url "/admin/children" --base-url http://localhost:5192 --no-start-server \
 *     --actions scripts/capture-specs/flows/admin-children-add-ui-mode-4419.mjs \
 *     --presets desktop --pr 4419
 */

const DEV_OWNER = { email: 'owner@example.com', password: 'Gq!Dev#Owner2026x' };
const NICKNAME = 'ちゅうがく3ねん';

async function settle(page) {
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
}

async function loginIfNeeded(page) {
	if (!page.url().includes('/auth/login')) return;
	await page.fill('input[type="email"], input[name="email"]', DEV_OWNER.email);
	await page.fill('input[type="password"], input[name="password"]', DEV_OWNER.password);
	await page.getByRole('button', { name: /ログイン|サインイン/ }).first().click();
	await page.waitForURL((url) => !url.pathname.includes('/auth/login'), { timeout: 30_000 });
	if (!page.url().includes('/admin/children')) {
		await page.goto(new URL('/admin/children', page.url()).toString());
	}
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await loginIfNeeded(page);
	await page.waitForLoadState('networkidle');

	// 追加フォームは折りたたみ。「追加する」トグルを押して開く。
	// Svelte 5 の hydration 前に押すと無反応なので、hydration を待ってから retry する。
	await page.waitForTimeout(2_000);
	const toggle = page.getByRole('button', { name: '追加する' }).first();
	await toggle.waitFor({ state: 'visible', timeout: 30_000 });
	for (let attempt = 0; attempt < 6; attempt++) {
		await toggle.click({ timeout: 5_000 }).catch(() => {});
		if (await page.locator('input[name="nickname"]').first().isVisible()) break;
		await page.waitForTimeout(1_000);
	}

	// 登録フォーム: ニックネーム + 年齢 15 (誕生日は未入力 = 顧客が最短で登録する経路)
	const nickname = page.locator('input[name="nickname"]').first();
	await nickname.waitFor({ state: 'visible', timeout: 30_000 });
	await nickname.fill(NICKNAME);
	await page.locator('input[name="age"]').first().fill('15');

	// フォーム内の submit ボタン (「追加する」) を押す
	await page.locator('form[action="?/addChild"] button[type="submit"]').first().click();

	// 登録された子供のカードが一覧に出るまで待つ
	await page.getByText(NICKNAME, { exact: false }).first().waitFor({ timeout: 30_000 });
	await settle(page);

	// Before / After を同じ flow で撮り分ける (SS_LABEL=before-... / after-...)。
	await capture(process.env.SS_LABEL || 'issue-4419-admin-children-age15-registered');
};
