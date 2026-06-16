/**
 * scripts/capture-specs/flows/admin-backup-restore-3079.mjs
 *
 * #3079 ごほうび・チェックリスト 個別 backup/restore SS 撮影フロー。
 *
 * 活動 (#2558) と機能対称化した overflow menu「エクスポート」「バックアップから復元」を
 * ごほうび・チェックリストで視覚確認する:
 *  1. ごほうび: ︙ overflow menu 展開 (restore / export が活動と同順序)
 *  2. ごほうび: バックアップから復元 dialog (ファイル選択 step)
 *  3. チェックリスト: OverflowMenu 展開 (restore / export 実機能化)
 *  4. チェックリスト: 復元 dialog / エクスポート (テンプレート選択) dialog
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5173 node scripts/capture.mjs \
 *     --flow admin-backup-restore-3079 \
 *     --url /admin/rewards \
 *     --actions scripts/capture-specs/flows/admin-backup-restore-3079.mjs \
 *     --presets desktop,mobile \
 *     --pr 3085
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

/** Ark UI Menu / OverflowMenu trigger を click → 指定 item が visible になるまで retry */
async function waitForMenuOpen(page, triggerTestId, menuItemTestId) {
	const btn = page.getByTestId(triggerTestId);
	await btn.waitFor({ state: 'visible', timeout: 15_000 });
	const item = page.getByTestId(menuItemTestId);
	for (let attempt = 0; attempt < 6; attempt++) {
		await btn.click();
		try {
			await item.waitFor({ state: 'visible', timeout: 2_000 });
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
	await btn.click();
	await item.waitFor({ state: 'visible', timeout: 10_000 });
}

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
	// ===== ごほうび =====
	await page.goto(`${BASE_URL}/admin/rewards`);
	await page.getByTestId('admin-rewards-child-tabs').waitFor({ state: 'visible', timeout: 15_000 });

	// 1) ︙ overflow menu 展開 (restore / export = 活動と同順序)
	await waitForMenuOpen(page, 'rewards-overflow-menu', 'menu-item-restore');
	await capture('3079-rewards-overflow-open');
	await page.keyboard.press('Escape');
	await settle(page);

	// 2) バックアップから復元 dialog
	await waitForMenuOpen(page, 'rewards-overflow-menu', 'menu-item-restore');
	await page.getByTestId('menu-item-restore').click();
	await page.getByTestId('restore-rewards-dialog').waitFor({ state: 'visible', timeout: 5_000 });
	await settle(page);
	await capture('3079-rewards-restore-dialog');
	await page.keyboard.press('Escape');
	await settle(page);

	// ===== チェックリスト =====
	await page.goto(`${BASE_URL}/admin/checklists`);
	await page.getByTestId('admin-checklists-page').waitFor({ state: 'visible', timeout: 15_000 });

	// 3) OverflowMenu 展開 (restore / export 実機能化)
	await waitForMenuOpen(page, 'checklists-overflow-menu', 'overflow-menu-item-restore');
	await capture('3079-checklists-overflow-open');
	await page.keyboard.press('Escape');
	await settle(page);

	// 4a) 復元 dialog
	await waitForMenuOpen(page, 'checklists-overflow-menu', 'overflow-menu-item-restore');
	await page.getByTestId('overflow-menu-item-restore').click();
	await page.getByTestId('restore-checklist-dialog').waitFor({ state: 'visible', timeout: 5_000 });
	await settle(page);
	await capture('3079-checklists-restore-dialog');
	await page.keyboard.press('Escape');
	await settle(page);

	// 4b) エクスポート (テンプレート選択) dialog
	await waitForMenuOpen(page, 'checklists-overflow-menu', 'overflow-menu-item-export');
	await page.getByTestId('overflow-menu-item-export').click();
	await page.getByTestId('export-checklist-dialog').waitFor({ state: 'visible', timeout: 5_000 });
	await settle(page);
	await capture('3079-checklists-export-dialog');
};
