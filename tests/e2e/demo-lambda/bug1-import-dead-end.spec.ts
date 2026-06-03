// tests/e2e/demo-lambda/bug1-import-dead-end.spec.ts
//
// #2558 bug-1 (機能 dead-end、初顧客レビューで 1 分で発覚): demo Lambda 上で
// marketplace 取込の「追加」ボタンが無反応・dialog が閉じない回帰テスト。
//
// 根本原因 (`src/lib/server/demo/demo-mode.ts` §buildDemoNoopResponseBody 導入前):
//   - 取込 form action は POST (`x-sveltekit-action` header 付き fetch / use:enhance)
//   - hooks.server.ts の `shouldReturnDemoNoop` が素の `{ ok: true, demo: true }` を返していた
//   - SvelteKit クライアントは `deserialize()` で `result.type === undefined` となり、
//     UI の `result.type === 'success'` 分岐 (取込済 state 反映) が永久に発火しない
//   - 結果: 追加ボタンを押しても dialog が閉じず feedback も出ない (= dead-end)
//
// 修正 (#2558):
//   - form action リクエスト (`x-sveltekit-action: true`) には SvelteKit 認識可能な
//     正規 ActionResult (`{ type: 'success', status: 200, data: devalue({demo:true,...}) }`) を返す
//   - UI は `d.demo === true` を検出し「デモではお試し用です」feedback + state 反映
//
// #2773 段階3 — 検証対象切替 (marketplace 一本化、DESIGN.md §10):
//   admin 内 in-page marketplace 風 browse UI (UnifiedImportHub の per-preset button) を
//   全 5 admin page で撤去し、取込実行は marketplace 詳細 → `?import=<presetId>` →
//   `ChildSelectionDialog` auto-open → 配信先確定 → `?/importPresetToChildren` POST の
//   正規経路 (marketplace-import-flow.md §3.1) に一本化した。
//   本 spec は旧 in-page UI (`marketplace-preset-import-*` button) を検証していたため、
//   新 flow (`?import=` → ChildSelectionDialog → 確定) に検証対象を振り替える。dead-end
//   回帰ガードの意図 (User 指摘 #2「動作しないインポート機能」検出) は維持し、demo no-op
//   POST が SvelteKit action 形式で返り取込済 state に反映されることを引き続き検証する。
//
// 本 spec は demo Lambda 環境 (AUTH_MODE=anonymous + DATA_SOURCE=demo) 上で
// (1) `?/importPresetToChildren` POST が SvelteKit action 形式 (type=success + demo flag) で返ること
// (2) 実際の UI 操作 (?import= → dialog → 全員選択 → 確定) で取込済 state に反映されること
// (3) dialog の cancel 経路が機能すること (旧 dead-end では cancel も無反応だった、bug-4)
// を検証する。本番 cognito E2E では再現不可 (本番では実 import が走る) ため demo 専用 spec。

import { expect, type Page, test } from '@playwright/test';

// admin/checklists?import= で受け取る checklist preset。demo Lambda の checklist 一覧では
// 一部 preset が pre-imported だが、ChildSelectionDialog 経由の取込は preset の取込済/未取込に
// 関わらず実行され、結果メッセージ (imported / duplicate のいずれか) が必ず表示されるため、
// dead-end 検出には十分。安定のため event-pool を使う。
const IMPORT_PRESET_ID = 'event-pool';

/**
 * admin/checklists?import= で ChildSelectionDialog を auto-open させる。
 *
 * 本 spec は admin 側 demo no-op の挙動が検証対象のため、marketplace 詳細ページの CTA
 * レンダリングは検証対象外。直接 `?import=` で dialog を開く (CTA → 遷移は
 * marketplace-checklist-import.spec.ts が別途貫通検証している)。
 */
async function openImportDialog(page: Page) {
	await page.goto(`/admin/checklists?import=${IMPORT_PRESET_ID}`, {
		waitUntil: 'domcontentloaded',
	});
	const dialog = page.getByTestId('checklist-import-child-selection-dialog');
	await expect(dialog).toBeVisible({ timeout: 30_000 });
	return dialog;
}

test.describe('bug-1: marketplace 取込 dead-end (demo Lambda、#2558 / #2773)', () => {
	test('?/importPresetToChildren POST は SvelteKit action 形式 (type=success + demo flag) で返る (素の {ok,demo} ではない)', async ({
		page,
	}) => {
		test.slow();
		await openImportDialog(page);

		// ACT: 全員選択 → 確定で import POST を発火し、form action レスポンスを捕捉する。
		await page.getByTestId('child-selection-all').click();
		const [resp] = await Promise.all([
			page.waitForResponse(
				(r) => /\?\/importPresetToChildren/.test(r.url()) && r.request().method() === 'POST',
			),
			page.getByTestId('child-selection-confirm').click(),
		]);

		expect(resp.status()).toBe(200);
		const body = await resp.json();

		// 修正の核心: SvelteKit が認識する ActionResult 形式であること (dead-end 回帰検出)。
		// 旧 dead-end では body = `{ ok: true, demo: true }` (type 欠落) で
		// クライアントが result.type を解決できず取込済 state 反映が不発火だった。
		expect(body).toMatchObject({ type: 'success', status: 200 });
		// data は devalue stringified 文字列。demo フラグを含む (UI が feedback 表示に使う)。
		expect(typeof body.data).toBe('string');
		expect(body.data).toContain('demo');
		// 旧 no-op 形式 (type 欠落の素の {ok,demo}) ではないこと
		expect(body).not.toMatchObject({ ok: true, demo: true });
	});

	test('?import= → 全員選択 → 確定で取込済 state に反映される (無反応 dead-end なら fail)', async ({
		page,
	}) => {
		test.slow();
		await openImportDialog(page);

		await page.getByTestId('child-selection-all').click();
		await page.getByTestId('child-selection-confirm').click();

		// 副作用: 取込結果 feedback (action message banner) が表示されること。
		// 旧 dead-end ではここで永久に無反応だった。demo no-op でも UI feedback は出る。
		await expect(page.getByTestId('checklists-action-message')).toBeVisible({
			timeout: 30_000,
		});

		// 確定後は dialog が閉じること (旧 dead-end では dialog が閉じなかった)。
		await expect(page.getByTestId('checklist-import-child-selection-dialog')).toBeHidden({
			timeout: 15_000,
		});
	});

	test('取込 dialog の cancel で dialog が閉じる (無反応 cancel dead-end なら fail、bug-4)', async ({
		page,
	}) => {
		test.slow();
		const dialog = await openImportDialog(page);

		// cancel ボタンで dialog を閉じる (旧 dead-end では cancel も無反応で閉じなかった)。
		await page.getByRole('button', { name: 'キャンセル' }).click();

		await expect(dialog).toBeHidden({ timeout: 15_000 });
		// 取込は実行されていない (action message banner は出ない)。
		await expect(page.getByTestId('checklists-action-message')).toHaveCount(0);
	});
});
