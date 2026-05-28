/**
 * scripts/capture-specs/flows/admin-activities-marketplace-unification-2558.mjs
 *
 * #2558 段階2 (PO 方針: マーケットプレイス一本化) SS 撮影フロー。
 *
 * 顧客クレーム bug-2/3/4 根治後の admin/activities UX を視覚的に確認する:
 *  1. default 一覧 (header「+ 追加」「︙」の 2 要素のみ、トップレベルの「一括追加」「別の子からコピー」
 *     独立ボタンが child タブ row から撤去されたこと = bug-2 解消の確認)
 *  2. + 追加 メニュー展開 (5 項目: 手動で1つ追加 / AI で提案してもらう / みんなのテンプレートから探す /
 *     別のお子さまからコピー / 複数のお子さまにまとめて追加 = bug-2 統合 + bug-3 謎用語撤廃の確認)
 *  3. ︙ overflow メニュー展開 (restore / export / clear-all、restore = バックアップから復元の
 *     独立配置確認)
 *  4. バックアップから復元 ダイアログ (旧 UnifiedImportHub file セクションを独立ダイアログ化、
 *     marketplace browse UI とは別概念であることの視覚明示)
 *
 * 注: 「みんなのテンプレートから探す」click は /marketplace?type=activity-pack への画面遷移であり、
 *     admin 内で開く UI は無い (= bug-4 根治、二重管理 UI 撤去の構造確認)。SS は遷移先の
 *     marketplace 画面そのものを別途撮る場合は --url /marketplace?type=activity-pack を使う。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5173 node scripts/capture.mjs \
 *     --flow admin-activities-marketplace-unification-2558 \
 *     --url /admin/activities?screenshot=all \
 *     --actions scripts/capture-specs/flows/admin-activities-marketplace-unification-2558.mjs \
 *     --presets desktop,mobile \
 *     --pr 2560
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

/**
 * Ark UI Menu trigger を click して menu を開く helper。
 *
 * tests/e2e/helpers/goal-flows.ts §openMenu と同型 — `aria-expanded` の polling では
 * Ark UI 5.x の hydration 待ち時間が読みづらく flaky になるため、**指定の menu item が
 * visible になるまで click を retry** する方式に統一する (web-first assertion 整合)。
 */
async function waitForMenuOpen(page, triggerTestId, menuItemTestId) {
	const btn = page.getByTestId(triggerTestId);
	await btn.waitFor({ state: 'visible', timeout: 15_000 });
	const item = page.getByTestId(menuItemTestId);
	for (let attempt = 0; attempt < 6; attempt++) {
		await btn.click();
		try {
			await item.waitFor({ state: 'visible', timeout: 2_000 });
			// transition / layout commit
			await page.evaluate(
				() =>
					new Promise((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
					),
			);
			return;
		} catch {
			// 次の attempt で再 click (open/close トグル耐性)
		}
	}
	// 最終 attempt は長め timeout で fail させる (詳細エラー出力)
	await btn.click();
	await item.waitFor({ state: 'visible', timeout: 10_000 });
}

async function closeMenu(page) {
	await page.keyboard.press('Escape');
	// transition / layout commit
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
	// --- 1) default 一覧 (トップレベル独立「一括追加」「別の子からコピー」が撤去されたこと、bug-2 解消) ---
	await page.goto(`${BASE_URL}/admin/activities?screenshot=all`);
	await page.getByTestId('header-add-activity-btn').waitFor({ state: 'visible', timeout: 15_000 });
	// child タブ row が存在し、隣接していた standalone buttons (bulk-create-btn / copy-from-child-btn) が無い
	await page
		.getByTestId('admin-activities-child-tabs')
		.waitFor({ state: 'visible', timeout: 5_000 })
		.catch(() => {});
	await capture('2558-stage2-admin-activities-default');

	// --- 2) + 追加 dropdown menu 展開 (5 項目、bug-3 謎用語撤廃 + copy/bulk 統合) ---
	// anchor = menu-item-browse (新規 #2558 段階2 項目、必ず存在する)
	await waitForMenuOpen(page, 'header-add-activity-btn', 'menu-item-browse');
	await capture('2558-stage2-admin-activities-add-menu-open');
	await closeMenu(page);

	// --- 3) ︙ overflow menu 展開 (restore = バックアップから復元 を独立配置) ---
	await waitForMenuOpen(page, 'header-overflow-menu-btn', 'menu-item-restore');
	await capture('2558-stage2-admin-activities-overflow-open');
	await closeMenu(page);

	// --- 4) バックアップから復元 ダイアログ (旧 UnifiedImportHub file セクション独立化) ---
	await waitForMenuOpen(page, 'header-overflow-menu-btn', 'menu-item-restore');
	await page.getByTestId('menu-item-restore').click();
	await page
		.getByTestId('restore-activities-dialog')
		.waitFor({ state: 'visible', timeout: 5_000 });
	// transition / layout commit
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
	await capture('2558-stage2-admin-activities-restore-dialog');
};
