// tests/e2e/multi-age-mode.spec.ts
// 全5年齢モード対応 E2E テスト
// 各年齢モードでホーム画面表示・活動記録が正常に動作することを検証する

import { expect, test } from '@playwright/test';
import {
	clearDialogGhosts,
	dismissOverlays,
	expandFirstCategory,
	getAvailableActivities,
	selectChildByName,
} from './helpers';

// ファイル全体を直列実行（fullyParallel: true + workers: 2 環境でもモード間の並列実行を防止）
// 全モードが同一ローカル DB に対してデータ変更を行うため、並列実行はデータ衝突の原因になる
test.describe.configure({ mode: 'serial' });

// 全5年齢モードの定義
// ui_mode は age-tier.ts の UI_MODES と一致: baby, preschool, elementary, junior, senior
const AGE_MODES = [
	{
		name: 'baby',
		childName: 'はなこちゃん',
		urlPattern: /\/baby\/home/,
		usesConfirmDialog: false,
	},
	{
		name: 'preschool',
		childName: 'たろうくん',
		urlPattern: /\/preschool\/home/,
		usesConfirmDialog: true,
	},
	{
		name: 'elementary',
		childName: 'けんたくん',
		urlPattern: /\/elementary\/home/,
		usesConfirmDialog: true,
	},
	{
		name: 'junior',
		childName: 'ゆうこちゃん',
		urlPattern: /\/junior\/home/,
		usesConfirmDialog: true,
	},
	{
		name: 'senior',
		childName: 'まさとくん',
		urlPattern: /\/senior\/home/,
		usesConfirmDialog: true,
	},
] as const;

/**
 * 記録後のダイアログチェーン（結果→コンボ→スタンプ→レベルアップ）を
 * 順次閉じながら、同時に2つ以上のダイアログが開かないことを検証する。
 *
 * @returns 閉じたダイアログの数（検証レポート用）
 */
async function dismissAndVerifyDialogChain(page: import('@playwright/test').Page): Promise<number> {
	let closedCount = 0;

	for (let i = 0; i < 6; i++) {
		// 開いているダイアログを検出
		const openDialogs = page.locator('[data-scope="dialog"][data-state="open"]');
		const openCount = await openDialogs.count().catch(() => 0);

		// ダイアログが存在しなければ終了
		if (openCount === 0) break;

		// 同時に2つ以上のダイアログが開いていないことを検証
		// （Ark UI のダイアログキューが正しく動作していることの確認）
		const visibleCount = await page
			.evaluate(() => {
				const dialogs = document.querySelectorAll(
					'[data-scope="dialog"][data-state="open"][data-part="content"]',
				);
				let visible = 0;
				for (const d of dialogs) {
					const style = window.getComputedStyle(d);
					if (style.display !== 'none' && style.visibility !== 'hidden') {
						visible++;
					}
				}
				return visible;
			})
			.catch(() => 0);
		expect(visibleCount).toBeLessThanOrEqual(1);

		const closeBtn = openDialogs
			.getByRole('button', { name: /やったー|やったね|とじる|閉じる|OK|つぎへ/ })
			.or(page.getByTestId('activity-confirm-btn'))
			.or(page.getByTestId('login-bonus-confirm'));

		const btnVisible = await closeBtn
			.first()
			.isVisible()
			.catch(() => false);
		if (!btnVisible) {
			await page.keyboard.press('Escape');
			await openDialogs
				.first()
				.waitFor({ state: 'hidden', timeout: 2000 })
				.catch(() => {});
			closedCount++;
			continue;
		}

		await closeBtn.first().click();
		closedCount++;

		// ダイアログが閉じるのを待つ
		await openDialogs
			.first()
			.waitFor({ state: 'hidden', timeout: 3000 })
			.catch(() => {});

		// 次のダイアログが表示されるまで少し待機（ダイアログキューの遷移時間）
		const nextDialog = page.locator('[data-scope="dialog"][data-state="open"]');
		await nextDialog
			.first()
			.waitFor({ state: 'visible', timeout: 1000 })
			.catch(() => {
				// 次のダイアログがなければ正常終了
			});
	}

	await clearDialogGhosts(page);
	return closedCount;
}

test.describe('全年齢モード E2E', () => {
	for (const mode of AGE_MODES) {
		test.describe(`${mode.name} モード (${mode.childName})`, () => {

			test('ホーム画面が表示される', async ({ page }) => {
				await selectChildByName(page, mode.childName);
				await dismissOverlays(page);

				await expect(page).toHaveURL(mode.urlPattern);
				// ニックネームがヘッダーに表示される
				await expect(page.locator('header').getByText(mode.childName)).toBeVisible();
			});

			test('活動カードが表示される', async ({ page }) => {
				await selectChildByName(page, mode.childName);
				await dismissOverlays(page);

				// compactMode でカテゴリが折りたたまれている場合は展開する
				await expandFirstCategory(page);

				const activityCards = page.locator('[data-testid^="activity-card-"]');
				await expect(activityCards.first()).toBeVisible({ timeout: 5000 });
				const count = await activityCards.count();
				expect(count).toBeGreaterThan(0);
			});

			test('ボトムナビゲーションが表示される', async ({ page }) => {
				await selectChildByName(page, mode.childName);
				await dismissOverlays(page);

				const nav = page.locator('[data-testid="bottom-nav"]');
				await expect(nav).toBeVisible();
				// ナビリンクが4つ表示される（ホーム、チェックリスト、つよさ、かぞく）
				const links = nav.locator('a');
				expect(await links.count()).toBe(4);
			});

			test('活動を記録できる', async ({ page }) => {
				test.slow(); // 記録フローは複数ステップ + ダイアログチェーンあり
				await selectChildByName(page, mode.childName);
				await dismissOverlays(page);

				// compactMode でカテゴリが折りたたまれている場合は展開する
				await expandFirstCategory(page);

				const activities = getAvailableActivities(page);
				const count = await activities.count();
				expect(count).toBeGreaterThan(0);

				if (mode.usesConfirmDialog) {
					// preschool/elementary/junior/senior: 確認ダイアログ経由の記録
					let recorded = false;
					for (let i = 0; i < Math.min(count, 5); i++) {
						await activities.nth(i).click();

						// 確認ダイアログが出るのを待つ
						const dialog = page.locator('[data-testid="confirm-dialog"]');
						try {
							await dialog.waitFor({ state: 'visible', timeout: 2000 });
						} catch {
							continue;
						}

						// 「きろく！」ボタンをクリック
						await page.locator('[data-testid="confirm-record-btn"]').click();

						// 記録成功の結果を待つ
						try {
							await page.getByText(/きろくしたよ！|記録しました/).waitFor({ timeout: 5000 });
							recorded = true;
							break;
						} catch {
							// ALREADY_RECORDED — ダイアログを閉じて次の活動へ
							await dialog.waitFor({ state: 'hidden', timeout: 1000 }).catch(() => {});
						}
					}
					expect(recorded).toBe(true);
				} else {
					// baby: タップで直接記録（確認ダイアログなし）
					let recorded = false;
					for (let i = 0; i < Math.min(count, 5); i++) {
						await activities.nth(i).click();

						try {
							await page
								.getByText(/きろくしたよ！|やったね/)
								.or(page.locator('[data-testid="activity-confirm-btn"]'))
								.first()
								.waitFor({ timeout: 5000 });
							recorded = true;
							break;
						} catch {
							// まだ記録されていない場合、次の活動へ
						}
					}
					expect(recorded).toBe(true);
				}

				// ダイアログチェーン検証:
				// 結果 → コンボ → スタンプ → レベルアップを順次閉じながら、
				// 同時に2つ以上のダイアログが開かないことを検証する
				const closedDialogs = await dismissAndVerifyDialogChain(page);
				// 少なくとも結果ダイアログ（きろくしたよ！）は閉じたはず
				expect(closedDialogs).toBeGreaterThanOrEqual(1);

				// 全ダイアログ閉鎖後: 操作可能状態に戻ったことを確認
				await expect(page).toHaveURL(mode.urlPattern);

				// ダイアログが全て閉じていることを確認
				const remainingDialogs = page.locator('[data-scope="dialog"][data-state="open"]');
				await expect(remainingDialogs).toHaveCount(0, { timeout: 3000 });

				// ホーム画面に戻って操作可能であることを確認（活動カードが再びクリック可能）
				await expandFirstCategory(page);
				const postRecordCards = page.locator('[data-testid^="activity-card-"]');
				await expect(postRecordCards.first()).toBeVisible({ timeout: 3000 });
			});
		});
	}
});
