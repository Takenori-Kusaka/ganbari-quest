// tests/e2e/child-must-card-badge.spec.ts
// #2146 — 子供 UI 「今日のおやくそく」カード演出統合 E2E
//
// 旧 MustProgressBar 専用セクション (tests/e2e/child-must-progress-bar.spec.ts) を撤廃し、
// ActivityCard 自身が priority='must' を riboon badge + data-must='1' 属性で識別する設計
// （#2146 AC1 / AC2 / AC3 検証）。
//
// AC 検証:
// - AC1: must バー (`[data-testid="must-progress-bar"]`) は描画されない (0 件)
// - AC2: priority='must' 活動カードに riboon (`[data-must="1"]`) が付く
// - AC3: 4 年齢コアモード (preschool/elementary/junior/senior) で同一仕様

import { expect, test } from '@playwright/test';
import {
	selectBabyChild,
	selectElementaryChildAndDismiss,
	selectJuniorChildAndDismiss,
	selectKinderChildAndDismiss,
	selectSeniorChildAndDismiss,
} from './helpers';

test.describe('#2146 must カード演出統合 — 旧バー撤廃確認 (AC1)', () => {
	test('preschool: ホーム上部に旧 must バーが描画されない', async ({ page }) => {
		await selectKinderChildAndDismiss(page);
		const oldBar = page.locator('[data-testid="must-progress-bar"]');
		await expect(oldBar).toHaveCount(0);
	});

	test('elementary: ホーム上部に旧 must バーが描画されない', async ({ page }) => {
		await selectElementaryChildAndDismiss(page);
		const oldBar = page.locator('[data-testid="must-progress-bar"]');
		await expect(oldBar).toHaveCount(0);
	});

	test('junior: ホーム上部に旧 must バーが描画されない', async ({ page }) => {
		await selectJuniorChildAndDismiss(page);
		const oldBar = page.locator('[data-testid="must-progress-bar"]');
		await expect(oldBar).toHaveCount(0);
	});

	test('senior: ホーム上部に旧 must バーが描画されない', async ({ page }) => {
		await selectSeniorChildAndDismiss(page);
		const oldBar = page.locator('[data-testid="must-progress-bar"]');
		await expect(oldBar).toHaveCount(0);
	});

	test('baby: 旧 must バーが描画されない（親準備モード）', async ({ page }) => {
		await selectBabyChild(page);
		const oldBar = page.locator('[data-testid="must-progress-bar"]');
		await expect(oldBar).toHaveCount(0);
	});
});

test.describe('#2146 must カード演出統合 — ActivityCard riboon badge (AC2 / AC3)', () => {
	test('preschool: priority="must" 活動カードに data-must="1" 属性が付く', async ({
		page,
	}, testInfo) => {
		await selectKinderChildAndDismiss(page);
		const mustCard = page.locator('[data-testid^="activity-card-"][data-must="1"]').first();
		await expect(mustCard).toBeVisible();
		// 同 card 内に riboon span が存在
		const ribbon = mustCard.locator('[data-testid^="must-ribbon-"]');
		await expect(ribbon).toBeVisible();
		await expect(ribbon).toHaveText('⭐ おやくそく');
		await page.screenshot({
			path: `docs/screenshots/pr-2146/preschool-must-card-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});

	test('elementary: priority="must" 活動カードに riboon badge が表示される', async ({
		page,
	}, testInfo) => {
		await selectElementaryChildAndDismiss(page);
		const mustCard = page.locator('[data-testid^="activity-card-"][data-must="1"]').first();
		await expect(mustCard).toBeVisible();
		const ribbon = mustCard.locator('[data-testid^="must-ribbon-"]');
		await expect(ribbon).toBeVisible();
		await page.screenshot({
			path: `docs/screenshots/pr-2146/elementary-must-card-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});

	test('junior: priority="must" 活動カードに riboon badge が表示される', async ({
		page,
	}, testInfo) => {
		await selectJuniorChildAndDismiss(page);
		const mustCard = page.locator('[data-testid^="activity-card-"][data-must="1"]').first();
		await expect(mustCard).toBeVisible();
		const ribbon = mustCard.locator('[data-testid^="must-ribbon-"]');
		await expect(ribbon).toBeVisible();
		await page.screenshot({
			path: `docs/screenshots/pr-2146/junior-must-card-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});

	test('senior: priority="must" 活動カードに riboon badge が表示される', async ({
		page,
	}, testInfo) => {
		await selectSeniorChildAndDismiss(page);
		const mustCard = page.locator('[data-testid^="activity-card-"][data-must="1"]').first();
		await expect(mustCard).toBeVisible();
		const ribbon = mustCard.locator('[data-testid^="must-ribbon-"]');
		await expect(ribbon).toBeVisible();
		await page.screenshot({
			path: `docs/screenshots/pr-2146/senior-must-card-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});
});

test.describe('#2146 Anti-engagement (ADR-0012)', () => {
	test('must badge は flow inline で描画される（モーダル禁止）', async ({ page }) => {
		await selectKinderChildAndDismiss(page);
		const mustCard = page.locator('[data-testid^="activity-card-"][data-must="1"]').first();
		await expect(mustCard).toBeVisible();
		// card 自身に role="dialog" は付かない
		await expect(mustCard).not.toHaveAttribute('role', 'dialog');
	});
});
