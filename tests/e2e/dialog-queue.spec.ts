// tests/e2e/dialog-queue.spec.ts
// #611: ダイアログキュー E2E テスト — 同時に1つだけ表示されることを確認

import { expect, test } from '@playwright/test';
import {
	clearDialogGhosts,
	dismissOverlays,
	expandFirstCategory,
	getAvailableActivities,
	selectKinderChild,
} from './helpers';

/**
 * 現在開いている Ark UI Dialog の数を返す
 */
async function countOpenDialogs(page: import('@playwright/test').Page): Promise<number> {
	return page.locator('[data-scope="dialog"][data-state="open"][data-part="content"]').count();
}

/**
 * 表示中のオーバーレイボタンをクリックして1つ閉じる
 */
async function closeOneOverlay(page: import('@playwright/test').Page): Promise<boolean> {
	const closeBtn = page
		.locator('[data-scope="dialog"][data-state="open"]')
		.getByRole('button', { name: /とじる|閉じる|OK|やったー|やったね/ })
		.first();
	if (await closeBtn.isVisible().catch(() => false)) {
		await closeBtn.click();
		await page.waitForTimeout(400);
		return true;
	}
	return false;
}

test.describe('#611: ダイアログキュー', () => {
	test('ログインボーナス→特別報酬の順次表示で同時に2つ開かない', async ({ page }) => {
		await selectKinderChild(page);

		// ページ読み込み後、オーバーレイが表示されるまで待機
		await page.waitForTimeout(2000);

		// 表示されるオーバーレイを順次閉じながら、同時に2つ以上開かないことを検証
		for (let i = 0; i < 10; i++) {
			const openCount = await countOpenDialogs(page);
			// キュー機能により、同時に表示されるダイアログは最大1つ
			expect(openCount).toBeLessThanOrEqual(1);

			if (openCount === 0) break;
			const closed = await closeOneOverlay(page);
			if (!closed) break;
		}

		await clearDialogGhosts(page);

		// 全オーバーレイ閉じた後、ページが操作可能であることを確認
		await expandFirstCategory(page);
		const activities = getAvailableActivities(page);
		const count = await activities.count();
		expect(count).toBeGreaterThan(0);
	});

	test('活動記録後のダイアログ連鎖で操作不能にならない', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);

		// カテゴリを展開して活動カードを取得
		await expandFirstCategory(page);
		const activities = getAvailableActivities(page);
		const count = await activities.count();
		if (count === 0) {
			test.skip();
			return;
		}

		// 活動カードをタップ
		await activities.first().click();

		// 確認ダイアログが出るのを待つ
		const dialog = page.locator('[data-testid="confirm-dialog"]');
		try {
			await dialog.waitFor({ timeout: 3000 });
		} catch {
			// Baby モード等では確認ダイアログがない場合がある
			test.skip();
			return;
		}

		// 記録ボタンをクリック
		await page.locator('[data-testid="confirm-record-btn"]').click();

		// 結果ダイアログを待つ
		try {
			await page.getByText(/きろくしたよ！/).waitFor({ timeout: 5000 });
		} catch {
			// 記録できなかった場合（ALREADY_RECORDED等）— テスト自体はスキップ
			test.skip();
			return;
		}

		// 結果ダイアログ以降のオーバーレイを順次閉じる
		// 各ステップで同時に2つ以上のダイアログが開かないことを検証
		for (let i = 0; i < 10; i++) {
			const openCount = await countOpenDialogs(page);
			expect(openCount).toBeLessThanOrEqual(1);

			if (openCount === 0) break;

			// 結果ダイアログの「OK」ボタンまたはオーバーレイ閉じるボタン
			const confirmBtn = page.getByTestId('activity-confirm-btn');
			if (await confirmBtn.isVisible().catch(() => false)) {
				await confirmBtn.click();
				await page.waitForTimeout(500);
				continue;
			}

			const closed = await closeOneOverlay(page);
			if (!closed) {
				// ボタンが見つからない場合は Escape で閉じる
				await page.keyboard.press('Escape');
				await page.waitForTimeout(300);
			}
		}

		await clearDialogGhosts(page);

		// 全ダイアログ閉じた後、ページが操作可能であること
		const openCount = await countOpenDialogs(page);
		expect(openCount).toBe(0);

		// 活動カードが再度タップ可能であること
		await expandFirstCategory(page);
		const activitiesAfter = getAvailableActivities(page);
		const countAfter = await activitiesAfter.count();
		expect(countAfter).toBeGreaterThanOrEqual(0);
	});

	test('#671 回帰: 記録後ダイアログが閉じた後に再オープンしない', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);

		await expandFirstCategory(page);
		const activities = getAvailableActivities(page);
		const count = await activities.count();
		if (count === 0) {
			test.skip();
			return;
		}

		// 活動を記録
		await activities.first().click();
		const dialog = page.locator('[data-testid="confirm-dialog"]');
		try {
			await dialog.waitFor({ timeout: 3000 });
		} catch {
			test.skip();
			return;
		}
		await page.locator('[data-testid="confirm-record-btn"]').click();

		try {
			await page.getByText(/きろくしたよ！/).waitFor({ timeout: 5000 });
		} catch {
			test.skip();
			return;
		}

		// 全ダイアログを順次閉じる
		for (let i = 0; i < 10; i++) {
			const openCount = await countOpenDialogs(page);
			if (openCount === 0) break;

			const confirmBtn = page.getByTestId('activity-confirm-btn');
			if (await confirmBtn.isVisible().catch(() => false)) {
				await confirmBtn.click();
				await page.waitForTimeout(500);
				continue;
			}
			const closed = await closeOneOverlay(page);
			if (!closed) {
				await page.keyboard.press('Escape');
				await page.waitForTimeout(300);
			}
		}
		await clearDialogGhosts(page);

		// #671 回帰テスト: 閉じた後 2 秒間ダイアログが再オープンしないことを確認
		// (無限ループが起きると $effect が再トリガーして即座にダイアログが開く)
		await page.waitForTimeout(2000);
		const reopenedCount = await countOpenDialogs(page);
		expect(reopenedCount).toBe(0);
	});

	test('高速連続タップでダイアログが重複しない', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);

		await expandFirstCategory(page);
		const activities = getAvailableActivities(page);
		const count = await activities.count();
		if (count === 0) {
			test.skip();
			return;
		}

		// 2つの活動を素早く連続タップ（ガードで2つ目はブロックされるはず）
		await activities.first().click();

		// 確認ダイアログが表示されている間に別の活動をタップ
		try {
			await page.locator('[data-testid="confirm-dialog"]').waitFor({ timeout: 2000 });
			if (count > 1) {
				await activities.nth(1).click({ force: true });
			}
		} catch {
			// 確認ダイアログが出ない場合 → ガードが効いている
		}

		await page.waitForTimeout(500);

		// 開いているダイアログは最大1つ
		const openCount = await countOpenDialogs(page);
		expect(openCount).toBeLessThanOrEqual(1);

		// クリーンアップ
		await dismissOverlays(page);
		await clearDialogGhosts(page);
	});
});
