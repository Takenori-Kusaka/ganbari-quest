// tests/e2e/demo-screenshot-mode.spec.ts
// #1209: `?screenshot=1` による demo 固有 UI 非表示機構が、layout / page の 2 箇所で
// context 経由で同期していることを E2E で担保する。リグレッションで再び別々に再導出
// されるのを検出する。
//
// - layout (`+layout.svelte`) 由来の UI: demo-back-to-lp banner, demo-plan-switcher
// - page 由来の UI: /demo/admin/* の黄色 DemoBanner / DemoCta（#1792 で別 describe）
//
// #2097 PR-B2 (#2187): /demo/(child)/* 撤去 (`/demo/checklist` を含む) に伴い、
// 旧 /demo/checklist 黄色注意書きカバレッジ 2 件は削除。/demo/checklist は本番 /checklist
// に 308 redirect され、本番 checklist には demo 専用注意書きが存在しないためテスト目的が消失。
// layout 由来 demo UI の context 同期は /demo トップ + /demo/admin/* (#1792 describe) で
// 引き続き担保される。

import { expect, test } from '@playwright/test';

test.describe('#1209 demo screenshot mode', () => {
	test('通常アクセス（?screenshot なし）では layout の demo UI が表示される', async ({ page }) => {
		await page.goto('/demo', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('demo-back-to-lp')).toBeVisible();
		await expect(page.getByTestId('demo-plan-switcher')).toBeVisible();
	});

	test('?screenshot=1 で layout の demo UI（banner / plan switcher）が非表示になる', async ({
		page,
	}) => {
		await page.goto('/demo?screenshot=1', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('demo-back-to-lp')).toHaveCount(0);
		await expect(page.getByTestId('demo-plan-switcher')).toHaveCount(0);
	});
});

// #1792: /demo/admin 配下のデモ独自 UI (plan-switcher / trial-cta / DemoBanner / DemoCta)
// が ?screenshot=1 で全て非表示になることを担保。LP scrshot 撮影で本番画面と同じ
// 見た目を保つために必要なガード（PR #1826 BLOCK 修正）。
test.describe('#1792 /demo/admin screenshot mode', () => {
	test('?screenshot=1 で /demo/admin の plan-switcher / trial-cta が非表示', async ({ page }) => {
		// ?plan=free で trial-cta を発火させた上で screenshot=1 を併用
		await page.goto('/demo/admin?plan=free&screenshot=1', { waitUntil: 'domcontentloaded' });
		// admin page 内の plan switcher 3 ボタン（layout 側の同名 testid と区別するため count=0 で
		// strict mode 違反を回避しつつ「全て非表示」を保証する）
		await expect(page.getByTestId('demo-plan-switch-free')).toHaveCount(0);
		await expect(page.getByTestId('demo-plan-switch-standard')).toHaveCount(0);
		await expect(page.getByTestId('demo-plan-switch-family')).toHaveCount(0);
		// trial CTA（free プラン時のみ表示）も消えていること
		await expect(page.getByTestId('demo-trial-cta')).toHaveCount(0);
		// layout 由来の demo-plan-switcher も同期して非表示
		await expect(page.getByTestId('demo-plan-switcher')).toHaveCount(0);
	});

	test('?screenshot なしで /demo/admin の plan-switcher / trial-cta は表示される', async ({
		page,
	}) => {
		await page.goto('/demo/admin?plan=free', { waitUntil: 'domcontentloaded' });
		// layout 側 (`demo-plan-switcher`) と admin page 側の `.plan-switcher` が両方 demo-plan-switch-free
		// testid を持つため、admin page の `.plan-switcher__button` クラスで絞り込んで strict mode 違反を回避する
		const adminSwitchFree = page.locator(
			'.plan-switcher__button[data-testid="demo-plan-switch-free"]',
		);
		await expect(adminSwitchFree).toBeVisible();
		await expect(page.getByTestId('demo-trial-cta')).toBeVisible();
	});

	test('?screenshot=1 で /demo/admin/checklists の DemoBanner / DemoCta が非表示', async ({
		page,
	}) => {
		await page.goto('/demo/admin/checklists?screenshot=1', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('demo-banner')).toHaveCount(0);
		await expect(page.getByTestId('demo-cta')).toHaveCount(0);
	});

	test('?screenshot なしで /demo/admin/checklists の DemoBanner / DemoCta は表示される', async ({
		page,
	}) => {
		await page.goto('/demo/admin/checklists', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('demo-banner')).toBeVisible();
		await expect(page.getByTestId('demo-cta')).toBeVisible();
	});
});
