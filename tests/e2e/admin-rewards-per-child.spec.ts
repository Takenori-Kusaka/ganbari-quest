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
		// #2998 (EPIC #2897): プリセット選択 (REWARDS_LABELS.selectTemplateTitle = 'プリセットを選択') は
		// 本文常時露出から「+ 追加 → 手動で1つ追加」Dialog 内に移設された (activities / checklists と
		// 同型の dropdown → Dialog 起動)。Dialog を開いて family preset 動線が存在することを assert する。
		// Ark UI Menu は hydration 後に listener を attach するため data-state=open まで rAF 間隔で再 click。
		const addTrigger = page.getByTestId('rewards-add-menu');
		for (let i = 0; i < 30; i++) {
			await addTrigger.click();
			if ((await addTrigger.getAttribute('data-state')) === 'open') break;
			await page.evaluate(
				() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
			);
		}
		await page.getByTestId('menu-item-manual').click();
		await expect(page.getByTestId('rewards-add-dialog')).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('プリセットを選択', { exact: false }).first()).toBeVisible();
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
		// #2774 (5 type 統一): 旧 <form action="?/importRewardSet"> を <a href> に置換、
		// server action 撤去 (`importRewardSet` 削除済)。CTA は `<a>` 直接 navigation。
		await page.goto('/marketplace/reward-set/kinder-rewards');

		// 取込 CTA (data-testid="reward-set-import-cta")
		// #2774: testid 規約統一 (`<typeCode>-import-cta`)、typeCode は `reward-set`。
		const cta = page.getByTestId('reward-set-import-cta');
		await expect(
			cta,
			'reward-set-import-cta が表示されない (認証 / 子供登録 / プラン状態を確認)',
		).toBeVisible({ timeout: 10_000 });

		// href が `/admin/rewards?import=<itemId>` を指す (childId 露出ゼロ、CWE-598)
		const href = await cta.getAttribute('href');
		expect(href).toBe('/admin/rewards?import=kinder-rewards');
		expect(href).not.toContain('childId');

		// CTA click → client-side navigation で /admin/rewards?import=... へ遷移
		await cta.click();
		await page.waitForURL(/\/admin\/rewards\?import=kinder-rewards/, { timeout: 15_000 });

		// admin/rewards 側で ChildSelectionDialog が auto-open される
		await expect(page.getByTestId('reward-import-child-selection-dialog')).toBeVisible({
			timeout: 10_000,
		});
	});
});
