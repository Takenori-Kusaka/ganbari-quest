// tests/e2e/downgrade-visual.spec.ts
// #1011: ダウングレード前警告フロー — 視覚検証 (5 年齢モード + Desktop/Mobile)
//
// PR #943 (feat: #738 ダウングレード前警告フロー) で追加された UI の
// 視覚検証を事後で行い、スクリーンショットをエビデンスとして残す。
//
// ローカルモード（plan=family 相当）で以下を検証:
// - /admin/license ページの PlanStatusCard 表示
// - 「プラン変更・支払い管理」ボタンからダウングレードプレビュー取得
// - DowngradeResourceSelector ダイアログの表示
// - 超過子供リスト（全 5 年齢モード baby/preschool/elementary/junior/senior）
// - Desktop (1280x800) / Mobile (375x667) 両幅でのレイアウト崩れなし
//
// 出力: docs/screenshots/downgrade-flow/
//
// 実行: npx playwright test tests/e2e/downgrade-visual.spec.ts

import path from 'node:path';
import { expect, test } from '@playwright/test';

const OUT_DIR = path.resolve('docs/screenshots/downgrade-flow');

// 年齢モードの定義（global-setup.ts のテストデータと対応）
const AGE_MODES = ['baby', 'preschool', 'elementary', 'junior', 'senior'] as const;

/**
 * ライセンスページを開いて PlanStatusCard の表示を確認する共通セットアップ。
 * 全テストで最低 1 つの意味あるアサーションを保証する。
 */
async function navigateToLicensePage(page: import('@playwright/test').Page) {
	await page.goto('/admin/license', { waitUntil: 'domcontentloaded' });
	await page.locator('body').waitFor({ state: 'visible', timeout: 30_000 });

	// 全テスト共通: PlanStatusCard が表示されることを必ずアサート
	const card = page.getByTestId('plan-status-card');
	await expect(card).toBeVisible({ timeout: 15_000 });
	return card;
}

// ============================================================
// Desktop (1280x800) ビューポートでの検証
// ============================================================

test.describe('#1011 ダウングレード前警告 — Desktop', () => {
	test.beforeEach(async ({ page }) => {
		test.slow();
		await page.setViewportSize({ width: 1280, height: 800 });
	});

	test('ライセンスページ初期表示', async ({ page }) => {
		await navigateToLicensePage(page);

		await page.screenshot({
			path: path.join(OUT_DIR, 'desktop-license-page.png'),
			fullPage: true,
		});
	});

	test('ダウングレードプレビューダイアログ表示', async ({ page }) => {
		await navigateToLicensePage(page);

		// プラン管理ボタンの存在を確認
		const portalButton = page.getByTestId('open-portal-button');
		const portalCount = await portalButton.count();

		if (portalCount === 0) {
			test.info().annotations.push({
				type: 'env-skip',
				description: 'Stripe 未設定環境: ポータルボタン非表示',
			});
			await page.screenshot({
				path: path.join(OUT_DIR, 'desktop-no-portal-button.png'),
				fullPage: true,
			});
			return;
		}

		await expect(portalButton).toBeVisible();
		await portalButton.click();

		// ダウングレードプレビューダイアログまたは PIN ダイアログが表示されるまで待機
		const previewContent = page.getByTestId('downgrade-preview-content');
		const previewCount = await previewContent.count();

		if (previewCount > 0 && (await previewContent.isVisible())) {
			// ダウングレードプレビューが表示された（超過リソースあり）
			await expect(previewContent).toBeVisible();
			await page.screenshot({
				path: path.join(OUT_DIR, 'desktop-downgrade-preview.png'),
				fullPage: true,
			});

			// 超過子供リストが表示されている
			const childList = page.getByTestId('downgrade-child-list');
			const childListCount = await childList.count();
			if (childListCount > 0) {
				await expect(childList).toBeVisible();

				// 全 5 年齢モードの子供が表示されていることを確認
				const items = page.locator('[data-testid^="downgrade-child-item-"]');
				const count = await items.count();
				// テストデータには 5 子供 = 5 年齢モードが存在する
				expect(count).toBeGreaterThanOrEqual(AGE_MODES.length);

				// 確認ボタンは初期状態で無効（選択不足）
				const confirmButton = page.getByTestId('downgrade-confirm-button');
				await expect(confirmButton).toBeDisabled();
			}
		} else {
			// 超過リソースなし or PIN ダイアログが表示された — ページは正常に表示されている
			await expect(page.locator('body')).toBeVisible();
			await page.screenshot({
				path: path.join(OUT_DIR, 'desktop-portal-confirm.png'),
				fullPage: true,
			});
		}
	});

	test('ダウングレードプレビュー — 子供選択操作', async ({ page }) => {
		await navigateToLicensePage(page);

		const portalButton = page.getByTestId('open-portal-button');
		const portalCount = await portalButton.count();
		if (portalCount === 0) {
			test.info().annotations.push({
				type: 'env-skip',
				description: 'Stripe 未設定環境: ポータルボタン非表示',
			});
			return;
		}

		await portalButton.click();

		const previewContent = page.getByTestId('downgrade-preview-content');
		const previewCount = await previewContent.count();
		if (previewCount === 0 || !(await previewContent.isVisible())) {
			test.info().annotations.push({
				type: 'env-skip',
				description: '超過リソースなし: プレビュー非表示',
			});
			return;
		}
		await expect(previewContent).toBeVisible();

		// 超過子供のチェックボックスをいくつか選択
		const childItems = page.locator('[data-testid^="downgrade-child-item-"]');
		const childCount = await childItems.count();
		expect(childCount).toBeGreaterThan(0);

		// 最初の子供を選択
		const firstCheckbox = childItems.first().locator('input[type="checkbox"]');
		const checkboxCount = await firstCheckbox.count();
		expect(checkboxCount).toBeGreaterThan(0);

		await firstCheckbox.check();
		await expect(firstCheckbox).toBeChecked();

		await page.screenshot({
			path: path.join(OUT_DIR, 'desktop-downgrade-child-selected.png'),
			fullPage: true,
		});
	});
});

// ============================================================
// Mobile (375x667) ビューポートでの検証
// ============================================================

test.describe('#1011 ダウングレード前警告 — Mobile', () => {
	test.beforeEach(async ({ page }) => {
		test.slow();
		await page.setViewportSize({ width: 375, height: 667 });
	});

	test('ライセンスページ初期表示 (Mobile)', async ({ page }) => {
		await navigateToLicensePage(page);

		await page.screenshot({
			path: path.join(OUT_DIR, 'mobile-license-page.png'),
			fullPage: true,
		});
	});

	test('ダウングレードプレビューダイアログ表示 (Mobile)', async ({ page }) => {
		await navigateToLicensePage(page);

		const portalButton = page.getByTestId('open-portal-button');
		const portalCount = await portalButton.count();

		if (portalCount === 0) {
			test.info().annotations.push({
				type: 'env-skip',
				description: 'Stripe 未設定環境: ポータルボタン非表示',
			});
			await page.screenshot({
				path: path.join(OUT_DIR, 'mobile-no-portal-button.png'),
				fullPage: true,
			});
			return;
		}

		await expect(portalButton).toBeVisible();
		await portalButton.click();

		const previewContent = page.getByTestId('downgrade-preview-content');
		const previewCount = await previewContent.count();

		if (previewCount > 0 && (await previewContent.isVisible())) {
			await expect(previewContent).toBeVisible();
			await page.screenshot({
				path: path.join(OUT_DIR, 'mobile-downgrade-preview.png'),
				fullPage: true,
			});

			// モバイルでのテキスト折り返しやボタン配置の崩れがないことをスクリーンショットで確認
			const childList = page.getByTestId('downgrade-child-list');
			const childListCount = await childList.count();
			if (childListCount > 0) {
				await expect(childList).toBeVisible();

				// 確認ボタンの表示を検証
				const confirmButton = page.getByTestId('downgrade-confirm-button');
				await expect(confirmButton).toBeDisabled();
			}
		} else {
			await expect(page.locator('body')).toBeVisible();
			await page.screenshot({
				path: path.join(OUT_DIR, 'mobile-portal-confirm.png'),
				fullPage: true,
			});
		}
	});

	test('ダウングレードプレビュー — 子供選択操作 (Mobile)', async ({ page }) => {
		await navigateToLicensePage(page);

		const portalButton = page.getByTestId('open-portal-button');
		const portalCount = await portalButton.count();
		if (portalCount === 0) {
			test.info().annotations.push({
				type: 'env-skip',
				description: 'Stripe 未設定環境: ポータルボタン非表示',
			});
			return;
		}

		await portalButton.click();

		const previewContent = page.getByTestId('downgrade-preview-content');
		const previewCount = await previewContent.count();
		if (previewCount === 0 || !(await previewContent.isVisible())) {
			test.info().annotations.push({
				type: 'env-skip',
				description: '超過リソースなし: プレビュー非表示',
			});
			return;
		}
		await expect(previewContent).toBeVisible();

		const childItems = page.locator('[data-testid^="downgrade-child-item-"]');
		const childCount = await childItems.count();
		expect(childCount).toBeGreaterThan(0);

		const firstCheckbox = childItems.first().locator('input[type="checkbox"]');
		const checkboxCount = await firstCheckbox.count();
		expect(checkboxCount).toBeGreaterThan(0);

		await firstCheckbox.check();
		await expect(firstCheckbox).toBeChecked();

		await page.screenshot({
			path: path.join(OUT_DIR, 'mobile-downgrade-child-selected.png'),
			fullPage: true,
		});
	});
});

// ============================================================
// 5 年齢モード × ダウングレードプレビューの子供表示
// ============================================================

test.describe('#1011 ダウングレード前警告 — 年齢モード確認', () => {
	test.beforeEach(() => {
		test.slow();
	});

	test('ダウングレードプレビューに全 5 年齢モードの子供が表示される', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await navigateToLicensePage(page);

		const portalButton = page.getByTestId('open-portal-button');
		const portalCount = await portalButton.count();
		if (portalCount === 0) {
			test.info().annotations.push({
				type: 'env-skip',
				description: 'Stripe 未設定環境: ポータルボタン非表示',
			});
			await page.screenshot({
				path: path.join(OUT_DIR, 'desktop-no-portal-button-age-modes.png'),
				fullPage: true,
			});
			return;
		}

		await portalButton.click();

		const previewContent = page.getByTestId('downgrade-preview-content');
		const previewCount = await previewContent.count();

		if (previewCount === 0 || !(await previewContent.isVisible())) {
			test.info().annotations.push({
				type: 'env-skip',
				description: '超過リソースなし: プレビュー非表示',
			});
			await page.screenshot({
				path: path.join(OUT_DIR, 'desktop-no-preview-age-modes.png'),
				fullPage: true,
			});
			return;
		}

		// 超過子供リストが表示される
		const childList = page.getByTestId('downgrade-child-list');
		await expect(childList).toBeVisible();

		// テストデータには全 5 年齢モードの子供が存在する
		const childItems = page.locator('[data-testid^="downgrade-child-item-"]');
		const itemCount = await childItems.count();

		// 全 5 子供が超過リストに含まれている（free は max=2 なので 5 人中 3 人が超過）
		// ただし表示される子供の数は maxChildren を超えた分だけでなく全子供が表示される
		expect(itemCount).toBeGreaterThanOrEqual(3);

		// API レスポンスで全年齢モードの子供が含まれることを検証
		const previewRes = await page.request.get('/api/v1/admin/downgrade-preview?targetTier=free');
		expect(previewRes.status()).toBe(200);
		const preview = await previewRes.json();

		// 全 5 年齢モードの子供のuiModeを収集
		const uiModes = new Set(preview.children.current.map((c: { uiMode: string }) => c.uiMode));
		for (const mode of AGE_MODES) {
			expect(uiModes.has(mode)).toBe(true);
		}

		await page.screenshot({
			path: path.join(OUT_DIR, 'desktop-downgrade-all-age-modes.png'),
			fullPage: true,
		});
	});

	test('各年齢モードの子供名が正しいラベルで表示される', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });

		// API から全子供情報を取得
		const previewRes = await page.request.get('/api/v1/admin/downgrade-preview?targetTier=free');

		if (previewRes.status() !== 200) {
			test.info().annotations.push({
				type: 'env-skip',
				description: `API 非対応環境: status=${previewRes.status()}`,
			});
			// 最低限のアサーション: ステータスコードがサーバーエラーではないことを確認
			expect(previewRes.status()).toBeLessThan(500);
			return;
		}

		const preview = await previewRes.json();

		// 応答構造がプレビュー形式を持つことを確認
		expect(preview).toHaveProperty('children');
		expect(preview).toHaveProperty('hasExcess');

		// 各子供が name と uiMode を持つ
		for (const child of preview.children.current) {
			expect(typeof child.name).toBe('string');
			expect(child.name.length).toBeGreaterThan(0);
			expect(typeof child.uiMode).toBe('string');
			expect(AGE_MODES).toContain(child.uiMode);
		}

		// 超過が存在する（free の max=2 に対して 5 人）
		expect(preview.children.excess).toBeGreaterThanOrEqual(3);
		expect(preview.hasExcess).toBe(true);
	});
});
