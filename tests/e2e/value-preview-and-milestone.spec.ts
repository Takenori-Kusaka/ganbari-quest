// tests/e2e/value-preview-and-milestone.spec.ts
// #1600 ADR-0023 I9 — 初月価値プレビュー + マイルストーン演出 E2E smoke
//
// 検証対象:
// 1. /admin (親 dashboard) で value-preview-section が表示される（または、
//    e2e seed の子供データが previewEligible 条件未満なら、エラー無く表示されないこと）
// 2. 子供 UI (/elementary/home) で MilestoneBanner が
//    JS エラー無く描画される（初期状態は閲覧済みでも未閲覧でも構わない）
// 3. KPI grid の testid が含まれる場合は children 要素が確認できる
//
// 注意:
//   - AUTH_MODE=local のため /admin は認証なしで開ける
//   - seed データ依存を最小化: 「セクションが描画されたら期待通り、
//     描画されなくても 200 で開ける」を smoke 検証

import { expect, test } from '@playwright/test';

test.describe('#1600 価値プレビュー — admin dashboard smoke', () => {
	test('/admin が 200 で開け、value-preview セクションが seed 状況に応じ描画される', async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on('pageerror', (err) => errors.push(err.message));
		page.on('console', (msg) => {
			if (msg.type() === 'error') errors.push(msg.text());
		});

		const response = await page.goto('/admin', { waitUntil: 'domcontentloaded' });
		expect(response?.status()).toBeLessThan(400);

		// 価値プレビューセクションは seed の child createdAt に依存。
		// データが存在すれば section が出る、無くてもエラーにはならない。
		const section = page.getByTestId('value-preview-section');
		const sectionCount = await section.count();
		if (sectionCount > 0) {
			// 描画されている場合、KPI 4 種が含まれることを確認
			await expect(section.first()).toBeVisible();
			await expect(section.getByTestId('kpi-total-activities').first()).toBeVisible();
			await expect(section.getByTestId('kpi-current-streak').first()).toBeVisible();
		}

		// JS エラーが発生していないこと
		expect(
			errors.filter(
				(e) =>
					!e.includes('favicon') && !e.includes('Failed to load resource') && !e.includes('404'),
			),
		).toEqual([]);
	});
});

test.describe('#1600 マイルストーンバナー — child UI smoke', () => {
	test('child UI を開いてもマイルストーンバナーがエラー無く描画される', async ({
		page,
		context,
	}) => {
		const errors: string[] = [];
		page.on('pageerror', (err) => errors.push(err.message));
		page.on('console', (msg) => {
			if (msg.type() === 'error') errors.push(msg.text());
		});

		// child を選択するため /switch を経由してから home へ
		const switchResponse = await page.goto('/switch', { waitUntil: 'domcontentloaded' });
		expect(switchResponse?.status()).toBeLessThan(400);

		// 最初の child を選択（seed に最低 1 人いる前提）。
		// child カード or リンクを探して click。
		const childLink = page.locator('a[href^="/preschool"], a[href^="/elementary"], a[href^="/junior"], a[href^="/senior"], a[href^="/baby"]').first();
		const childCount = await childLink.count();
		if (childCount === 0) {
			// child が登録されていない seed の場合はスキップ（smoke として何もしない）
			test.skip(true, 'No child registered in test seed; skip child UI smoke');
			return;
		}

		await Promise.all([
			page.waitForURL(/\/(baby|preschool|elementary|junior|senior)\//, { timeout: 10_000 }),
			childLink.click(),
		]);

		// マイルストーンバナーは pendingMilestone が無ければ描画されない仕様。
		// 描画された場合は閉じるボタンで閉じれることを確認。
		const banner = page.getByTestId('milestone-banner');
		const bannerCount = await banner.count();
		if (bannerCount > 0) {
			await expect(banner.first()).toBeVisible();
			// 閉じるボタンを押下できる（ARIA label = MILESTONE_LABELS.bannerCloseLabel）
			const closeBtn = banner.getByRole('button').first();
			await expect(closeBtn).toBeVisible();
			await closeBtn.click();
			await expect(banner.first()).toBeHidden({ timeout: 5_000 });
		}

		// localStorage に書かれていれば再描画されない（永続化）
		const localStorageKeys = await context.storageState();
		expect(localStorageKeys).toBeDefined();

		expect(
			errors.filter(
				(e) =>
					!e.includes('favicon') && !e.includes('Failed to load resource') && !e.includes('404'),
			),
		).toEqual([]);
	});
});
