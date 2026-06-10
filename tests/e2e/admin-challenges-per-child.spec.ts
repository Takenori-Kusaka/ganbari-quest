/**
 * #2362 PR-7 — admin/challenges per-child UX + 兄弟連動表示 E2E 回帰
 *
 * per-child instance 化 (User §6) と兄弟連動 UI (SiblingChallengeComparison) の
 * 基本動線を検証する。
 *
 * 旧 `admin-challenges-import-marketplace.spec.ts` は legacy family-wide
 * (createSiblingChallenge) 動線を継続検証。本 spec は per-child + 兄弟連動 専用。
 *
 * cleanup PR (#2458) で旧 sibling_challenges drop 後に rewrite 予定。
 */

import { expect, test } from '@playwright/test';

const JAPAN_ANNUAL_EVENTS_PRESET = 'japan-annual-events';

test.describe('admin/challenges per-child UX (#2362 PR-7)', () => {
	test('admin/challenges ページ load (5xx で fail しない)', async ({ page }) => {
		const res = await page.goto('/admin/challenges');
		expect(res?.status()).toBeLessThan(500);
	});

	test('子供別タブ row が表示される (children >= 2 時)', async ({ page }) => {
		await page.goto('/admin/challenges');
		const tabRow = page.getByTestId('admin-challenges-child-tabs');
		// children 数によっては表示なし (1 child のみテナント)。ある場合のみ検証
		const exists = await tabRow.isVisible().catch(() => false);
		if (exists) {
			const allTab = page.getByTestId('admin-challenges-child-tab-all');
			await expect(allTab).toBeVisible();
		}
	});

	test('子供別タブクリックで URL ?childId が同期される', async ({ page }) => {
		await page.goto('/admin/challenges');
		const tabRow = page.getByTestId('admin-challenges-child-tabs');
		const exists = await tabRow.isVisible().catch(() => false);
		if (!exists) return;

		const childTabs = page.locator(
			'[data-testid^="admin-challenges-child-tab-"]:not([data-testid="admin-challenges-child-tab-all"])',
		);
		const count = await childTabs.count();
		if (count === 0) return;

		const firstChildTab = childTabs.first();
		const tabId = await firstChildTab.getAttribute('data-testid');
		const childId = tabId?.replace('admin-challenges-child-tab-', '');
		await firstChildTab.click();
		await expect.poll(() => new URL(page.url()).searchParams.get('childId')).toBe(childId);
	});

	test('#2896: ?import=<廃止 preset> でも page は 200 で開き dead-end しない (childId URL に出ない)', async ({
		page,
	}) => {
		// #2896: marketplace を 3 type に絞り challenge-set preset (japan-annual-events) を廃止したため、
		// `?import=` の server 受領経路は残置しつつも valid preset が無い。手動指定時も page は 200 で開き
		// invalid guidance を表示する (5xx で crash しない / dead-end しない)。
		const res = await page.goto(`/admin/challenges?import=${JAPAN_ANNUAL_EVENTS_PRESET}`);
		expect(res?.status()).toBeLessThan(500);
		// CWE-598: URL に childId / nickname なし
		const url = new URL(page.url());
		expect(url.searchParams.get('childId')).toBeNull();
		expect(url.searchParams.get('nickname')).toBeNull();
	});

	test('#2896: 廃止 challenge-set 詳細ページは marketplace から 404 (陳列外)', async ({ page }) => {
		// challenge-set は marketplace 陳列対象外 + 唯一の preset を廃止したため詳細ページは 404。
		const res = await page.goto(`/marketplace/challenge-set/${JAPAN_ANNUAL_EVENTS_PRESET}`);
		expect(res?.status()).toBe(404);
	});
});

test.describe('admin/challenges 兄弟連動表示 (SiblingChallengeComparison)', () => {
	test('challenge group の DOM 出力 (instance >= 2 で SiblingChallengeComparison 表示)', async ({
		page,
	}) => {
		await page.goto('/admin/challenges');
		// group 表示要素
		const groups = page.locator('[data-testid="admin-challenges-group"]');
		const groupCount = await groups.count();
		if (groupCount === 0) return; // 空 state では skip

		// 各 group は単一 instance なら admin-challenges-single-progress / 複数なら sibling-challenge-comparison
		for (let i = 0; i < groupCount; i++) {
			const group = groups.nth(i);
			const hasComparison =
				(await group.locator('[data-testid="sibling-challenge-comparison"]').count()) > 0;
			const hasSingle =
				(await group.locator('[data-testid="admin-challenges-single-progress"]').count()) > 0;
			expect(hasComparison || hasSingle).toBe(true);
		}
	});
});
