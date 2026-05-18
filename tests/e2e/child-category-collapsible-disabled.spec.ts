// tests/e2e/child-category-collapsible-disabled.spec.ts
// #2148 — 子供画面 CategorySection のカテゴリヘッダー誤タップで活動グリッドが全消失する不具合の回帰テスト
//
// 業界 prior art 調査 (docs/reference/07-research-child-collapsible-prior-art.md):
// - Khan Academy Kids / Duolingo ABC / ABCmouse / Prodigy Math / SplashLearn /
//   Code.org Hour of Code / スマイルゼミ・進研ゼミ の 7 サービス全件で
//   子供画面のカテゴリヘッダー誤タップによる全コンテンツ消失は存在しない
// - Code.org のみ教師管理画面 (= 親管理画面) で折りたたみ機能を保持 (C2 パターン)
//
// γ 採用方針: 子供画面では collapsible 機能を削除、親管理画面のみで保持
// 関連 ADR: ADR-0010 (Pre-PMF) / ADR-0012 (Anti-engagement) / WCAG 2.5.2 (Pointer Cancellation)
//
// AC 検証:
// - AC4: 子供画面 5 年齢モード全件で `data-testid="category-header-{categoryId}"` button
//   click → 活動グリッドが消えないことを assert

import { expect, test } from '@playwright/test';
import {
	selectBabyChild,
	selectElementaryChildAndDismiss,
	selectJuniorChildAndDismiss,
	selectKinderChildAndDismiss,
	selectSeniorChildAndDismiss,
} from './helpers';

type Page = import('@playwright/test').Page;

/**
 * カテゴリヘッダーをタップ → 活動グリッドが消えないことを検証する共通関数。
 * #2148 (γ 採用): collapsible=false の場合、CategorySection は <button> を <div> で描画し、
 * tap で何も起きないことを期待する。
 */
async function assertCategoryHeaderTapDoesNotHideGrid(page: Page) {
	const headers = page.locator('[data-testid^="category-header-"]');
	const headerCount = await headers.count();
	expect(headerCount, 'カテゴリヘッダーが少なくとも 1 件描画されている').toBeGreaterThan(0);

	// 最初のカテゴリヘッダー直下の activity-card 数を tap 前に記録
	const firstHeader = headers.first();
	const firstSection = firstHeader.locator('..');
	const cardsBefore = await firstSection.locator('[data-testid^="activity-card-"]').count();
	expect(cardsBefore, '最初のカテゴリに活動カードが少なくとも 1 件存在').toBeGreaterThan(0);

	// ヘッダーを tap (誤タップを再現)。<div> 描画なら何も起きない、<button> 描画でも
	// expanded が true 固定のため visible 数は変わらない (二重防御)。
	await firstHeader.evaluate((el) => (el as HTMLElement).click());

	// tap 直後に activity-card 数を再カウント (アニメーション無しで即評価可能)
	// 旧バグでは折り畳みで 0 件になっていた
	const cardsAfter = await firstSection.locator('[data-testid^="activity-card-"]').count();
	expect(cardsAfter, 'カテゴリヘッダー tap 後も活動カードが消えない (#2148 γ 採用)').toBe(
		cardsBefore,
	);

	// expect(...).toBeVisible() で auto-retry 込みの最終 assertion
	await expect(
		firstSection.locator('[data-testid^="activity-card-"]').first(),
		'tap 後も最初の活動カードが visible',
	).toBeVisible();
}

test.describe('#2148 子供画面 カテゴリヘッダー誤タップで活動グリッドが消えない (γ 採用)', () => {
	test('preschool: ヘッダー tap で活動グリッドが消えない', async ({ page }) => {
		await selectKinderChildAndDismiss(page);
		await assertCategoryHeaderTapDoesNotHideGrid(page);
	});

	test('elementary: ヘッダー tap で活動グリッドが消えない', async ({ page }) => {
		await selectElementaryChildAndDismiss(page);
		await assertCategoryHeaderTapDoesNotHideGrid(page);
	});

	test('junior: ヘッダー tap で活動グリッドが消えない', async ({ page }) => {
		await selectJuniorChildAndDismiss(page);
		await assertCategoryHeaderTapDoesNotHideGrid(page);
	});

	test('senior: ヘッダー tap で活動グリッドが消えない', async ({ page }) => {
		await selectSeniorChildAndDismiss(page);
		await assertCategoryHeaderTapDoesNotHideGrid(page);
	});

	test('baby: ヘッダー tap で活動グリッドが消えない (準備モード、ADR-0011)', async ({ page }) => {
		await selectBabyChild(page);
		// baby モードは親準備モードで `ProdDashboardSections` 経由でカテゴリ表示される
		// （activity-card が描画されない設計の可能性もあるため、ヘッダーが無い場合は skip）
		const headers = page.locator('[data-testid^="category-header-"]');
		const headerCount = await headers.count();
		if (headerCount === 0) {
			test.skip(true, 'baby モードはカテゴリ非表示の設計のため skip');
			return;
		}
		await assertCategoryHeaderTapDoesNotHideGrid(page);
	});
});

test.describe('#2148 CategorySection 構造的検証 — header が button ではなく div で描画される', () => {
	test('elementary: カテゴリヘッダーが button タグではなく div タグで描画されている', async ({
		page,
	}) => {
		await selectElementaryChildAndDismiss(page);
		const header = page.locator('[data-testid^="category-header-"]').first();
		await expect(header).toBeVisible();
		// #2148: collapsible=false 時は <div> で描画される (button onclick による全消失を物理排除)
		const tagName = await header.evaluate((el) => el.tagName.toLowerCase());
		expect(tagName, 'カテゴリヘッダーは button ではなく div で描画される (#2148 γ 採用)').toBe(
			'div',
		);
	});
});
