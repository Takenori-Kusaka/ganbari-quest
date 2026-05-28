// tests/e2e/demo-lambda/bug1-import-dead-end.spec.ts
//
// #2558 bug-1 (機能 dead-end、初顧客レビューで 1 分で発覚): demo Lambda 上で
// marketplace 取込ダイアログの「追加」ボタンが無反応・dialog が閉じない回帰テスト。
//
// 根本原因 (`src/lib/server/demo/demo-mode.ts` §buildDemoNoopResponseBody 導入前):
//   - `?/importMarketplace*` form action は POST (`use:enhance`、x-sveltekit-action header 付き)
//   - hooks.server.ts の `shouldReturnDemoNoop` が素の `{ ok: true, demo: true }` を返していた
//   - SvelteKit `use:enhance` は deserialize 後 `result.type === undefined` となり、
//     UI の `result.type === 'success'` 分岐 (onimported / onclose) が永久に発火しない
//   - 結果: 追加ボタンを押しても dialog が閉じず feedback も出ない (= dead-end)
//
// 修正 (#2558):
//   - form action リクエスト (`x-sveltekit-action: true`) には SvelteKit 認識可能な
//     正規 ActionResult (`{ type: 'success', status: 200, data: devalue({demo:true}) }`) を返す
//   - UI は `d.demo === true` を検出し「デモではお試し用です」feedback + state 反映
//
// #2558 段階2 retarget: admin/activities 内のマーケットプレイス風ブラウズ UI を撤去し
//   /marketplace への画面遷移に一本化したため、本 spec の検証対象を、UnifiedImportHub の
//   in-page browse UI を継続使用する `/admin/checklists` に振り替えた (同じ demo no-op response
//   形式 + 同じ UnifiedImportHub component の dead-end を検証する。`marketplace-preset-import-*`
//   testid は共通)。admin/activities の取込は marketplace 詳細 → ?import= → ChildSelectionDialog
//   の正規経路に移行済 (admin-activities-per-child.spec.ts の goal 完遂テストで担保)。
//
// 本 spec は demo Lambda 環境 (AUTH_MODE=anonymous + DATA_SOURCE=demo) 上で
// (1) 取込 POST が SvelteKit action 形式 (type=success + demo flag) で返ること
// (2) 実際の UI 操作で取込済 state に反映されること
// を検証する。本番 cognito E2E では再現不可 (本番では実 import が走る) ため demo 専用 spec。

import { expect, type Locator, type Page, test } from '@playwright/test';

async function firstImportButton(page: Page): Promise<Locator> {
	await page.goto('/admin/checklists', { waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('marketplace-import-section')).toBeVisible({ timeout: 30_000 });
	const presetBtns = page.locator('[data-testid^="marketplace-preset-import-"]');
	await expect(presetBtns.first()).toBeVisible({ timeout: 15_000 });
	return presetBtns.first();
}

test.describe('bug-1: marketplace 取込 dead-end (demo Lambda、#2558)', () => {
	test('?/importMarketplaceChecklist POST は SvelteKit action 形式 (type=success + demo flag) で返る (素の {ok,demo} ではない)', async ({
		page,
	}) => {
		test.slow();
		const importBtn = await firstImportButton(page);

		// ACT: import を実行し、form action レスポンスを捕捉する
		const [resp] = await Promise.all([
			page.waitForResponse(
				(r) => /\?\/importMarketplace/.test(r.url()) && r.request().method() === 'POST',
			),
			importBtn.click(),
		]);

		expect(resp.status()).toBe(200);
		const body = await resp.json();

		// 修正の核心: SvelteKit が認識する ActionResult 形式であること (dead-end 回帰検出)。
		// 旧 dead-end では body = `{ ok: true, demo: true }` (type 欠落) で
		// use:enhance が result.type を解決できず onimported / state 反映が不発火だった。
		expect(body).toMatchObject({ type: 'success', status: 200 });
		// data は devalue stringified 文字列。demo フラグを含む (UI が feedback 表示に使う)。
		expect(typeof body.data).toBe('string');
		expect(body.data).toContain('demo');
		// 旧 no-op 形式 (type 欠落の素の {ok,demo}) ではないこと
		expect(body).not.toMatchObject({ ok: true, demo: true });
	});

	test('import preset を click すると取込済 state に反映される (無反応 dead-end なら fail)', async ({
		page,
	}) => {
		test.slow();
		const importBtn = await firstImportButton(page);
		const presetTestid = (await importBtn.getAttribute('data-testid')) as string;
		expect(presetTestid, 'preset import button testid が取得できること').toBeTruthy();
		const itemId = presetTestid.replace('marketplace-preset-import-', '');

		await importBtn.click();

		// 副作用: 取込成功 feedback (success result メッセージ) が表示されること。
		// 旧 dead-end ではここで永久に無反応だった。demo no-op でも UI feedback は出る。
		await expect(page.getByTestId('marketplace-admin-result-success')).toBeVisible({
			timeout: 30_000,
		});
		// preset 行自体は引き続き表示されている (dialog ではなく in-page section のため)
		await expect(page.getByTestId(`marketplace-preset-import-${itemId}`)).toBeVisible();
	});
});
