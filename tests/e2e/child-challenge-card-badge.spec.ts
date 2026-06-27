// tests/e2e/child-challenge-card-badge.spec.ts
// #3333 — 子供 UI チャレンジ対象「カード演出」統合 E2E
//
// 旧 ChallengeBanner 横長バナー (`[data-testid="challenge-banners"]`) を撤廃し、チャレンジ対象は
// 対象カテゴリの CategorySection ヘッダーに静的バッジ (`[data-testid^="challenge-target-badge-"]`)
// + インライン進捗で表示する設計（#2146/#2168 カード演出統合思想への整合）。
//
// AC 検証:
// - AC1: 旧横長バナー (`[data-testid="challenge-banners"]`) は描画されない (0 件、全 5 age mode)
// - AC2: 当週チャレンジ対象カテゴリのヘッダーに challenge-target-badge が表示される
//        (auto:weekly はホーム load で冪等生成されるため demo fixture でも 1 件は存在する)
// - AC3: バッジは flow inline（モーダル禁止、ADR-0012 anti-engagement）

import { expect, test } from '@playwright/test';
import {
	expandAllCategories,
	selectBabyChild,
	selectElementaryChildAndDismiss,
	selectJuniorChildAndDismiss,
	selectKinderChildAndDismiss,
	selectSeniorChildAndDismiss,
} from './helpers';

test.describe('#3333 チャレンジ カード演出統合 — 旧横長バナー撤廃 (AC1)', () => {
	test('preschool: 旧 challenge-banners が描画されない', async ({ page }) => {
		await selectKinderChildAndDismiss(page);
		await expect(page.locator('[data-testid="challenge-banners"]')).toHaveCount(0);
	});

	test('elementary: 旧 challenge-banners が描画されない', async ({ page }) => {
		await selectElementaryChildAndDismiss(page);
		await expect(page.locator('[data-testid="challenge-banners"]')).toHaveCount(0);
	});

	test('junior: 旧 challenge-banners が描画されない', async ({ page }) => {
		await selectJuniorChildAndDismiss(page);
		await expect(page.locator('[data-testid="challenge-banners"]')).toHaveCount(0);
	});

	test('senior: 旧 challenge-banners が描画されない', async ({ page }) => {
		await selectSeniorChildAndDismiss(page);
		await expect(page.locator('[data-testid="challenge-banners"]')).toHaveCount(0);
	});

	test('baby: 旧 challenge-banners が描画されない（親準備モード）', async ({ page }) => {
		await selectBabyChild(page);
		await expect(page.locator('[data-testid="challenge-banners"]')).toHaveCount(0);
	});
});

test.describe('#3333 チャレンジ カード演出統合 — チャレンジ対象バッジ (AC2)', () => {
	test('elementary: チャレンジ対象カテゴリに challenge-target-badge が表示される', async ({
		page,
	}, testInfo) => {
		await selectElementaryChildAndDismiss(page);
		await expandAllCategories(page);
		const badge = page.locator('[data-testid^="challenge-target-badge-"]').first();
		await expect(badge).toBeVisible();
		await page.screenshot({
			path: `docs/screenshots/pr-3333/elementary-challenge-badge-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});

	test('preschool: チャレンジ対象カテゴリに challenge-target-badge が表示される', async ({
		page,
	}, testInfo) => {
		await selectKinderChildAndDismiss(page);
		await expandAllCategories(page);
		const badge = page.locator('[data-testid^="challenge-target-badge-"]').first();
		await expect(badge).toBeVisible();
		await page.screenshot({
			path: `docs/screenshots/pr-3333/preschool-challenge-badge-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});
});

test.describe('#3333 Anti-engagement (ADR-0012)', () => {
	test('challenge target badge は flow inline で描画される（モーダル禁止）', async ({ page }) => {
		await selectElementaryChildAndDismiss(page);
		await expandAllCategories(page);
		const badge = page.locator('[data-testid^="challenge-target-badge-"]').first();
		await expect(badge).toBeVisible();
		await expect(badge).not.toHaveAttribute('role', 'dialog');
	});
});
