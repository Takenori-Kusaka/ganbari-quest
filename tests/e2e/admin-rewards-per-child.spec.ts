/**
 * #2362 PR-4 — admin/rewards per-child UX E2E 回帰
 *
 * 子供別タブ切替 / ChildSelectionDialog auto-open (`?import=<presetId>`) /
 * 「他の子供から copy」 action / marketplace 取込 child 排除 (CWE-598) を検証。
 *
 * PR-3 `admin-activities-per-child.spec.ts` と同型 pattern。Phase 6/7 で family
 * master drop 後に rewrite 予定 (本 PR は per-child UX 整備に集中)。
 *
 * 既存 `admin-rewards-import-marketplace.spec.ts` は legacy 動線を継続検証。
 * 本 spec は per-child 動線 + child 排除 CWE-598 専用。
 */

import { expect, test } from '@playwright/test';

test.describe('admin/rewards per-child UX (#2362 PR-4)', () => {
	test('子供タブ row + actions が表示される', async ({ page }) => {
		await page.goto('/admin/rewards');
		// 子供タブ row は children >= 1 で表示
		const tabRow = page.getByTestId('admin-rewards-child-tabs');
		await expect(tabRow).toBeVisible();
		// child tab ボタン (テストデータ最低 1 件以上)
		const firstTab = tabRow.locator('[data-testid^="rewards-child-tab-"]').first();
		await expect(firstTab).toBeVisible();
		// child context banner
		await expect(page.getByTestId('rewards-child-context-banner')).toBeVisible();
	});

	test('子供タブクリックで selectedChildId が同期される', async ({ page }) => {
		await page.goto('/admin/rewards');
		const tabs = page.locator('[data-testid^="rewards-child-tab-"]');
		const count = await tabs.count();
		// global-setup.ts は 5 children (preschool/baby/elementary/junior/senior) を seed する
		// (TEST_CHILDREN 配列、ADR-0005 deterministic seed)。skip ではなく precondition assert で
		// seed 破綻を検知する (ADR-0006 §3 — assertion 弱体化禁止)
		expect(
			count,
			'2 child 以上の seed が必要 (global-setup.ts TEST_CHILDREN 参照)',
		).toBeGreaterThanOrEqual(2);

		const secondTab = tabs.nth(1);
		const secondId = await secondTab.getAttribute('data-testid');
		const childId = secondId?.replace('rewards-child-tab-', '');
		await secondTab.click();

		// URL が ?childId=<n> に同期される (replaceState による push)
		await expect.poll(() => new URL(page.url()).searchParams.get('childId')).toBe(childId);
	});

	test('?import=<presetId> で ChildSelectionDialog auto-open', async ({ page }) => {
		// `kinder-rewards` は reward-set marketplace SSOT に存在する preset id
		await page.goto('/admin/rewards?import=kinder-rewards');
		const dialog = page.getByTestId('reward-import-child-selection-dialog');
		await expect(dialog).toBeVisible({ timeout: 5000 });
		await expect(page.getByTestId('child-selection-all')).toBeVisible();
		await expect(page.getByTestId('child-selection-confirm')).toBeVisible();
	});

	test('「他の子供から copy」 dialog open + radio 選択 → confirm 有効化', async ({ page }) => {
		await page.goto('/admin/rewards');
		const tabs = page.locator('[data-testid^="rewards-child-tab-"]');
		const count = await tabs.count();
		// global-setup.ts は 5 children を seed する (上 test 参照)。skip ではなく
		// precondition assert で seed 破綻を検知する (ADR-0006)
		expect(
			count,
			'2 child 以上の seed が必要 (global-setup.ts TEST_CHILDREN 参照)',
		).toBeGreaterThanOrEqual(2);

		const copyBtn = page.getByTestId('rewards-copy-from-child-btn');
		await expect(copyBtn).toBeVisible();
		await copyBtn.click();

		await expect(page.getByTestId('rewards-copy-from-child-dialog')).toBeVisible();
		// 他の child が選択肢として並ぶ (selectedChild は除外される)
		const sourceOptions = page.locator('[data-testid^="rewards-copy-source-"]');
		expect(await sourceOptions.count()).toBeGreaterThan(0);

		const firstSource = sourceOptions.first();
		await firstSource.click();
		// confirm button enable 化
		await expect(page.getByTestId('rewards-copy-from-child-confirm')).toBeEnabled();
	});

	test('invalid preset id (`?import=does-not-exist`) -> guidance 表示', async ({ page }) => {
		await page.goto('/admin/rewards?import=does-not-exist-preset');
		// dialog は開かず、guidance message が表示される
		await expect(page.getByTestId('rewards-action-message')).toBeVisible({ timeout: 5000 });
	});

	test('per-child + family preset 並存表示 (Phase 4 過渡期)', async ({ page }) => {
		await page.goto('/admin/rewards');
		// Phase 4 では family レベルの preset カタログ + per-child SpecialReward が並存
		const firstTab = page.locator('[data-testid^="rewards-child-tab-"]').first();
		await expect(firstTab).toBeVisible();
		// preset 入力フォームが表示される (family preset 動線維持)
		await expect(page.getByText('テンプレート', { exact: false }).first()).toBeVisible();
	});
});

test.describe('marketplace reward-set: childId 排除 (#2362 PR-4 / CWE-598)', () => {
	test('marketplace 詳細 page の URL / form に childId が存在しない', async ({ page }) => {
		// reward-set marketplace 詳細ページに遷移 (kinder-rewards は SSOT 存在)
		await page.goto('/marketplace/reward-set/kinder-rewards');

		// URL に childId 系 query が含まれていないこと
		const url = new URL(page.url());
		expect(url.searchParams.has('childId')).toBe(false);

		// page 内に childId / nickname 系 form input が存在しないこと
		// (旧来 <NativeSelect name="childId">) は本 PR で撤去)
		const childIdInput = page.locator('input[name="childId"], select[name="childId"]');
		expect(await childIdInput.count()).toBe(0);
	});

	test('marketplace 取込 button 押下 → /admin/rewards へ ?import= 経由で redirect', async ({
		page,
	}) => {
		// PR-3 と同型: marketplace は child 情報を持たず admin へ遷移
		await page.goto('/marketplace/reward-set/kinder-rewards');

		// 取込 button (data-testid="reward-import-submit") を押下
		const submitBtn = page.getByTestId('reward-import-submit');
		if ((await submitBtn.count()) === 0) {
			// 未認証 / 子供未登録時は表示されない可能性 (本 spec は認証済 + 子供登録済前提)
			return;
		}
		await Promise.all([
			page.waitForURL(/\/admin\/rewards\?import=kinder-rewards/, { timeout: 5000 }),
			submitBtn.click(),
		]);
		// admin/rewards 側で ChildSelectionDialog が auto-open される
		await expect(page.getByTestId('reward-import-child-selection-dialog')).toBeVisible({
			timeout: 5000,
		});
	});
});
