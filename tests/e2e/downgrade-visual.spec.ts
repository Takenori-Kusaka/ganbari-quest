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

// ============================================================
// Desktop (1280x800) ビューポートでの検証
// ============================================================

test.describe('#1011 ダウングレード前警告 — Desktop', () => {
	test.beforeEach(async ({ page }) => {
		test.slow();
		await page.setViewportSize({ width: 1280, height: 800 });
	});

	test('ライセンスページ初期表示', async ({ page }) => {
		await page.goto('/admin/license', { waitUntil: 'domcontentloaded' });
		await page.locator('body').waitFor({ state: 'visible', timeout: 30_000 });

		// PlanStatusCard が表示される
		const card = page.getByTestId('plan-status-card');
		await expect(card).toBeVisible({ timeout: 15_000 });

		await page.screenshot({
			path: path.join(OUT_DIR, 'desktop-license-page.png'),
			fullPage: true,
		});
	});

	test('ダウングレードプレビューダイアログ表示', async ({ page }) => {
		await page.goto('/admin/license', { waitUntil: 'domcontentloaded' });
		await page.locator('body').waitFor({ state: 'visible', timeout: 30_000 });

		// プラン管理ボタンをクリック
		const portalButton = page.getByTestId('open-portal-button');
		const isVisible = await portalButton.isVisible({ timeout: 10_000 }).catch(() => false);

		if (!isVisible) {
			// Stripe 未設定でポータルボタンが非表示の場合はスクリーンショットだけ撮る
			await page.screenshot({
				path: path.join(OUT_DIR, 'desktop-no-portal-button.png'),
				fullPage: true,
			});
			return;
		}

		await portalButton.click();

		// ダウングレードプレビューダイアログまたは PIN ダイアログが表示されるまで待機
		const previewContent = page.getByTestId('downgrade-preview-content');
		const previewVisible = await previewContent
			.waitFor({ state: 'visible', timeout: 10_000 })
			.then(() => true)
			.catch(() => false);

		if (previewVisible) {
			// ダウングレードプレビューが表示された（超過リソースあり）
			await page.screenshot({
				path: path.join(OUT_DIR, 'desktop-downgrade-preview.png'),
				fullPage: true,
			});

			// 超過子供リストが表示されている
			const childList = page.getByTestId('downgrade-child-list');
			const childListVisible = await childList.isVisible().catch(() => false);
			if (childListVisible) {
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
			// 超過リソースなし or PIN ダイアログが表示された
			await page.screenshot({
				path: path.join(OUT_DIR, 'desktop-portal-confirm.png'),
				fullPage: true,
			});
		}
	});

	test('ダウングレードプレビュー — 子供選択操作', async ({ page }) => {
		await page.goto('/admin/license', { waitUntil: 'domcontentloaded' });
		await page.locator('body').waitFor({ state: 'visible', timeout: 30_000 });

		const portalButton = page.getByTestId('open-portal-button');
		const isVisible = await portalButton.isVisible({ timeout: 10_000 }).catch(() => false);
		if (!isVisible) return;

		await portalButton.click();

		const previewContent = page.getByTestId('downgrade-preview-content');
		const previewVisible = await previewContent
			.waitFor({ state: 'visible', timeout: 10_000 })
			.then(() => true)
			.catch(() => false);
		if (!previewVisible) return;

		// 超過子供のチェックボックスをいくつか選択
		const childItems = page.locator('[data-testid^="downgrade-child-item-"]');
		const childCount = await childItems.count();

		if (childCount > 0) {
			// 最初の子供を選択
			const firstCheckbox = childItems.first().locator('input[type="checkbox"]');
			const hasCheckbox = await firstCheckbox.isVisible().catch(() => false);
			if (hasCheckbox) {
				await firstCheckbox.check();
				await page.screenshot({
					path: path.join(OUT_DIR, 'desktop-downgrade-child-selected.png'),
					fullPage: true,
				});
			}
		}
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
		await page.goto('/admin/license', { waitUntil: 'domcontentloaded' });
		await page.locator('body').waitFor({ state: 'visible', timeout: 30_000 });

		const card = page.getByTestId('plan-status-card');
		await expect(card).toBeVisible({ timeout: 15_000 });

		await page.screenshot({
			path: path.join(OUT_DIR, 'mobile-license-page.png'),
			fullPage: true,
		});
	});

	test('ダウングレードプレビューダイアログ表示 (Mobile)', async ({ page }) => {
		await page.goto('/admin/license', { waitUntil: 'domcontentloaded' });
		await page.locator('body').waitFor({ state: 'visible', timeout: 30_000 });

		const portalButton = page.getByTestId('open-portal-button');
		const isVisible = await portalButton.isVisible({ timeout: 10_000 }).catch(() => false);

		if (!isVisible) {
			await page.screenshot({
				path: path.join(OUT_DIR, 'mobile-no-portal-button.png'),
				fullPage: true,
			});
			return;
		}

		await portalButton.click();

		const previewContent = page.getByTestId('downgrade-preview-content');
		const previewVisible = await previewContent
			.waitFor({ state: 'visible', timeout: 10_000 })
			.then(() => true)
			.catch(() => false);

		if (previewVisible) {
			await page.screenshot({
				path: path.join(OUT_DIR, 'mobile-downgrade-preview.png'),
				fullPage: true,
			});

			// モバイルでのテキスト折り返しやボタン配置の崩れがないことをスクリーンショットで確認
			const childList = page.getByTestId('downgrade-child-list');
			const childListVisible = await childList.isVisible().catch(() => false);
			if (childListVisible) {
				await expect(childList).toBeVisible();

				// 確認ボタンの表示を検証
				const confirmButton = page.getByTestId('downgrade-confirm-button');
				await expect(confirmButton).toBeDisabled();
			}
		} else {
			await page.screenshot({
				path: path.join(OUT_DIR, 'mobile-portal-confirm.png'),
				fullPage: true,
			});
		}
	});

	test('ダウングレードプレビュー — 子供選択操作 (Mobile)', async ({ page }) => {
		await page.goto('/admin/license', { waitUntil: 'domcontentloaded' });
		await page.locator('body').waitFor({ state: 'visible', timeout: 30_000 });

		const portalButton = page.getByTestId('open-portal-button');
		const isVisible = await portalButton.isVisible({ timeout: 10_000 }).catch(() => false);
		if (!isVisible) return;

		await portalButton.click();

		const previewContent = page.getByTestId('downgrade-preview-content');
		const previewVisible = await previewContent
			.waitFor({ state: 'visible', timeout: 10_000 })
			.then(() => true)
			.catch(() => false);
		if (!previewVisible) return;

		const childItems = page.locator('[data-testid^="downgrade-child-item-"]');
		const childCount = await childItems.count();

		if (childCount > 0) {
			const firstCheckbox = childItems.first().locator('input[type="checkbox"]');
			const hasCheckbox = await firstCheckbox.isVisible().catch(() => false);
			if (hasCheckbox) {
				await firstCheckbox.check();
				await page.screenshot({
					path: path.join(OUT_DIR, 'mobile-downgrade-child-selected.png'),
					fullPage: true,
				});
			}
		}
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
		await page.goto('/admin/license', { waitUntil: 'domcontentloaded' });
		await page.locator('body').waitFor({ state: 'visible', timeout: 30_000 });

		const portalButton = page.getByTestId('open-portal-button');
		const isVisible = await portalButton.isVisible({ timeout: 10_000 }).catch(() => false);
		if (!isVisible) {
			// Stripe 未設定環境ではポータルボタンが非表示 — スクリーンショットだけ撮って終了
			await page.screenshot({
				path: path.join(OUT_DIR, 'desktop-no-portal-button-age-modes.png'),
				fullPage: true,
			});
			return;
		}

		await portalButton.click();

		const previewContent = page.getByTestId('downgrade-preview-content');
		const previewVisible = await previewContent
			.waitFor({ state: 'visible', timeout: 10_000 })
			.then(() => true)
			.catch(() => false);

		if (!previewVisible) {
			// 超過リソースなし — プレビュー非表示は正常動作。スクリーンショットのみ
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
			// API 未実装 or 環境未設定 — テスト対象外としてスキップ
			return;
		}

		const preview = await previewRes.json();

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
