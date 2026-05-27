// tests/e2e/demo-lambda/bug1-import-dead-end.spec.ts
//
// #2558 bug-1 (機能 dead-end、初顧客レビューで 1 分で発覚): demo Lambda 上で
// marketplace 取込ダイアログの「追加」ボタンが無反応・dialog が閉じない回帰テスト。
//
// 根本原因 (`src/lib/server/demo/demo-mode.ts` §buildDemoNoopResponseBody 導入前):
//   - `?/importPack` form action は POST (`use:enhance`、x-sveltekit-action header 付き)
//   - hooks.server.ts の `shouldReturnDemoNoop` が素の `{ ok: true, demo: true }` を返していた
//   - SvelteKit `use:enhance` は deserialize 後 `result.type === undefined` となり、
//     UI の `result.type === 'success'` 分岐 (onimported / onclose) が永久に発火しない
//   - 結果: 追加ボタンを押しても dialog が閉じず feedback も出ない (= dead-end)
//
// 修正 (#2558):
//   - form action リクエスト (`x-sveltekit-action: true`) には SvelteKit 認識可能な
//     正規 ActionResult (`{ type: 'success', status: 200, data: devalue({demo:true}) }`) を返す
//   - UI は `d.demo === true` を検出し「デモではお試し用です」feedback + dialog close
//
// 本 spec は demo Lambda 環境 (AUTH_MODE=anonymous + DATA_SOURCE=demo) 上で
// (1) 取込 POST が SvelteKit action 形式 (type=success + demo flag) で返ること
// (2) 実際の UI 操作で dialog が閉じること
// を検証する。本番 cognito E2E では再現不可 (本番では実 import が走る) ため demo 専用 spec。

import { expect, type Page, test } from '@playwright/test';

async function openImportDialog(page: Page): Promise<void> {
	await page.goto('/admin/activities', { waitUntil: 'domcontentloaded' });
	const addTrigger = page.getByTestId('header-add-activity-btn');
	await expect(addTrigger).toBeVisible({ timeout: 15_000 });

	const importItem = page.getByTestId('menu-item-import');
	// Ark Menu は press 連打で open/close トグルしうるため、menu item の visible を成功条件にする
	for (let attempt = 0; attempt < 6; attempt++) {
		await addTrigger.click();
		try {
			await expect(importItem).toBeVisible({ timeout: 2_000 });
			break;
		} catch {
			// 次の attempt で再 click
		}
	}
	await importItem.click();
	await expect(page.getByTestId('add-activity-dialog')).toBeVisible();
	await expect(page.getByTestId('activity-import-panel')).toBeVisible();
}

test.describe('bug-1: marketplace 取込 dead-end (demo Lambda、#2558)', () => {
	test('?/importPack POST は SvelteKit action 形式 (type=success + demo flag) で返る (素の {ok,demo} ではない)', async ({
		page,
	}) => {
		test.slow();
		await openImportDialog(page);

		const presetBtns = page.locator('[data-testid^="marketplace-preset-import-"]');
		await expect(presetBtns.first()).toBeVisible({ timeout: 15_000 });

		// ACT: import を実行し、form action レスポンスを捕捉する
		const [resp] = await Promise.all([
			page.waitForResponse(
				(r) => /\/admin\/activities\?\/importPack/.test(r.url()) && r.request().method() === 'POST',
			),
			presetBtns.first().click(),
		]);

		expect(resp.status()).toBe(200);
		const body = await resp.json();

		// 修正の核心: SvelteKit が認識する ActionResult 形式であること (dead-end 回帰検出)。
		// 旧 dead-end では body = `{ ok: true, demo: true }` (type 欠落) で
		// use:enhance が result.type を解決できず onclose / onimported が不発火だった。
		expect(body).toMatchObject({ type: 'success', status: 200 });
		// data は devalue stringified 文字列。demo フラグを含む (UI が feedback 表示に使う)。
		expect(typeof body.data).toBe('string');
		expect(body.data).toContain('demo');
		// 旧 no-op 形式 (type 欠落の素の {ok,demo}) ではないこと
		expect(body).not.toMatchObject({ ok: true, demo: true });
	});

	test('import preset を click すると dialog が閉じる (無反応 dead-end なら fail)', async ({
		page,
	}) => {
		test.slow();
		await openImportDialog(page);

		const presetBtns = page.locator('[data-testid^="marketplace-preset-import-"]');
		await expect(presetBtns.first()).toBeVisible({ timeout: 15_000 });
		await presetBtns.first().click();

		// 副作用: onclose 発火で dialog が閉じる (Ark Dialog は DOM 残存 + hidden 化)。
		// 旧 dead-end ではここで永久に開いたままだった。
		await expect(page.getByTestId('add-activity-dialog')).toBeHidden({ timeout: 30_000 });
	});
});
