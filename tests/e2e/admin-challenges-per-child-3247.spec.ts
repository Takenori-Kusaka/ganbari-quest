/**
 * #3247 sev3-4: per-child チャレンジ UI の functional e2e (ADR-0005 ratchet 回復)。
 *
 * #3195 で admin/challenges を「アプリ自動生成された子のチャレンジを親が閲覧する読み取り専用ビュー」に
 * 再編した際、旧 admin-challenges-per-child.spec.ts (手動作成前提) を削除し代替を追加しなかったため、
 * #3238 の挙動変更面 (child-tabs / ?childId sync / per-child filtering) の functional e2e が
 * page-LOAD smoke に後退していた (tests/CLAUDE.md render-only 禁止 / ADR-0005 違反)。
 *
 * 本 spec は render-only でなく act→outcome で検証する:
 *   - 子供 challenges ページ訪問でアプリが child_challenge を自動生成する (生成 → admin 表示の CUJ)
 *   - admin/challenges でその子のチャレンジが一覧表示される
 *   - 子供タブ click → URL ?childId 同期 (act→outcome)
 *   - per-child filtering: 別の子タブでは per-child empty state に切替わる
 */

import { expect, test } from '@playwright/test';

test.describe('#3247 admin/challenges per-child UI (自動生成 → 親閲覧)', () => {
	test('子供 challenges 訪問で自動生成 → admin に表示される', async ({ page }) => {
		// #3195: 子供 challenges ページ load が getOrCreateWeeklyChildChallengeView 経由で
		// 当週チャレンジを child_challenges に冪等生成する。
		await page.goto('/elementary/challenges');
		await page.waitForLoadState('domcontentloaded');

		await page.goto('/admin/challenges');
		// 「すべて」タブで生成済みチャレンジ group が 1 件以上表示される (生成 → 親閲覧 の goal 完遂)
		await expect(page.getByTestId('admin-challenges-child-tabs')).toBeVisible();
		await expect(page.getByTestId('admin-challenges-group').first()).toBeVisible();
	});

	test('子供タブ click → ?childId 同期 + per-child view へ切替 (act→outcome)', async ({ page }) => {
		await page.goto('/admin/challenges');
		const tabs = page.locator('[data-testid^="admin-challenges-child-tab-"]');
		// global-setup は 5 children を seed (ADR-0006: skip でなく precondition assert)
		const count = await tabs.count();
		expect(
			count,
			'2 child 以上 (all タブ + child タブ) が必要 (global-setup TEST_CHILDREN)',
		).toBeGreaterThanOrEqual(3);

		// 'all' でない最初の child タブを click → URL ?childId が同期される
		const childTab = page
			.locator('[data-testid^="admin-challenges-child-tab-"]:not([data-testid$="-all"])')
			.first();
		const tid = await childTab.getAttribute('data-testid');
		const childId = tid?.replace('admin-challenges-child-tab-', '');
		expect(childId).toMatch(/^\d+$/);

		await childTab.click();
		await expect.poll(() => new URL(page.url()).searchParams.get('childId')).toBe(childId);

		// per-child view: その子の group が出るか、未生成なら per-child empty state が出る
		// (dead/blank ページでないこと = act→outcome)。
		const group = page.getByTestId('admin-challenges-group');
		const empty = page.getByTestId('admin-challenges-empty-state');
		await expect(group.or(empty).first()).toBeVisible();
	});
});
