/**
 * scripts/capture-specs/flows/admin-challenges-delete-confirm-4023.mjs
 *
 * Issue #4023 横展開: admin/challenges の削除確認が効いていなかった問題の before / after SS。
 *
 * 撮影する 2 コマ (どちらの build でも同じ操作列):
 *   1. 削除ボタン click 直後
 *      - 修正前 (origin/develop, SS_PHASE=before-*): native confirm は自動 dismiss (= キャンセル) され、
 *        画面には確認 UI が何も残らない
 *      - 修正後 (本 PR, SS_PHASE=after-*): Dialog primitive の確認が出て操作が止まる
 *   2. キャンセル後の一覧
 *      - 修正前: キャンセルしたのにチャレンジが消えている (use:enhance が defaultPrevented を見ないため)
 *      - 修正後: チャレンジが残っている
 *
 * 使用例 (dev server = AUTH_MODE=local を別途起動し、対象チャレンジを seed してから):
 *   MSYS_NO_PATHCONV=1 SS_PHASE=after-pc BASE_URL=http://localhost:5173 \
 *     node scripts/capture.mjs \
 *     --flow admin-challenges-4023-after-pc \
 *     --url /admin/challenges \
 *     --actions scripts/capture-specs/flows/admin-challenges-delete-confirm-4023.mjs \
 *     --presets desktop --pr 4023
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const PHASE = process.env.SS_PHASE || 'after';

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	const rafSettle = () =>
		page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
				),
		);

	await page.goto(`${BASE_URL}/admin/challenges`, { waitUntil: 'domcontentloaded' });

	// hydration 待ち。
	// 削除ボタンの data-testid は SSR 出力に含まれず client mount 後にのみ現れるため、
	// これを hydration gate として使う (Ark Portal の attach は gate にならない)。
	// hydration 前に押すと use:enhance 未装着で native submit = 確認なしで削除されてしまう。
	const hydratedDelete = page.locator('[data-testid^="admin-challenge-delete-"]').first();
	// 修正後 build では確認ダイアログ (Ark Portal) の attach が hydration 完了の直接シグナル。
	// 削除ボタンの testid は dev server の SSR 出力に現れないため、両方を待つ。
	await page
		.getByTestId('admin-challenges-confirm-dialog')
		.waitFor({ state: 'attached', timeout: 60_000 })
		.catch(() => {});
	const hydrated = await hydratedDelete
		.waitFor({ state: 'visible', timeout: 5_000 })
		.then(() => true)
		.catch(() => false);

	// 修正前 build には testid が無いため、削除ボタンのテキストで拾う fallback を使う。
	const target = hydrated ? hydratedDelete : page.getByText('削除').first();
	await target.waitFor({ state: 'visible', timeout: 15_000 });

	const dialog = page.getByTestId('admin-challenges-confirm-dialog');
	const dialogExists = (await dialog.count()) > 0;

	// 修正後 build (SS_PHASE=after-*) で hydration が終わっていない状態のまま撮ると、
	// native submit で削除された「確認が効いていない画面」を後 SS として貼ってしまう。
	// 握りつぶさず throw して撮影自体を失敗させる (SS 捏造の構造的防止)。
	if (PHASE.startsWith('after') && !dialogExists) {
		throw new Error(
			'[flow] 修正後 build なのに確認ダイアログが DOM に無い (hydration 未完了)。撮影を中止する。',
		);
	}

	await target.click();

	if (dialogExists) {
		// 修正後 build: 確認が出ないまま撮ると「効いていない画面」を後 SS として貼ってしまう。
		// 握りつぶさず throw して撮影を失敗させる。
		await dialog.waitFor({ state: 'visible', timeout: 10_000 });
	}
	await rafSettle();
	await capture(`pr4023-${PHASE}-challenges-delete-click`);

	// キャンセル (修正後のみ押せる。修正前は既に submit 済みで押す対象が無い)
	const cancel = page.getByTestId('admin-challenges-confirm-cancel');
	if ((await cancel.count()) > 0 && (await cancel.isVisible().catch(() => false))) {
		await cancel.click();
	}

	// キャンセル後の一覧 (修正前は消えている / 修正後は残っている)
	await page.goto(`${BASE_URL}/admin/challenges`, { waitUntil: 'domcontentloaded' });
	await page
		.getByRole('heading', { level: 2 })
		.first()
		.waitFor({ state: 'visible', timeout: 15_000 });
	await rafSettle();
	await capture(`pr4023-${PHASE}-challenges-after-cancel`);
};
