/**
 * #3499 — edit 再遷移の stale form ({#key} guard) + childIdOverride の per-child scope 境界
 *
 * PR #3498 QM adversarial が検出した 2 つの seed-once $state 境界の回帰 spec:
 *
 *   AC1: /admin/activities/[id]/edit は同一 route の param 変更 (edit/A → edit/B) で
 *        component を remount しないため、seed-once の編集欄が古い activity を指す
 *        stale form になる。`{#key data.activity.id}` guard (ActivityEditForm 分割) で
 *        再遷移時に必ず再 seed されることを verify する。
 *   AC2: admin/activities・admin/rewards の childIdOverride (tab click 上書き) は
 *        client-side の `?childId` 変更 (load 再実行) で URL を優先して破棄され、
 *        marketplace 取込 → admin 復帰 (invalidateAll) 後も選択中 child scope が
 *        維持されることを verify する。
 *
 * 実装 note: UI 上に edit→edit / ?childId 変更の直接 link は無いため、SvelteKit router に
 * intercept させる anchor を app container 内に注入して client-side 遷移を再現する。
 * `window.__spaMarker` が遷移後も残ることを assert し、「full reload で偶然 PASS する」
 * false-green を排除する (full reload なら marker が消えて必ず fail)。
 */

import { expect, type Page, test } from '@playwright/test';
import { asCategoryId } from '../../src/lib/domain/ids';

/** dedicated activity を API 経由で作成 (seed 非破壊、admin-activities-delete.spec と同型) */
async function createDedicatedActivity(
	request: import('@playwright/test').APIRequestContext,
	name: string,
): Promise<number> {
	const res = await request.post('/api/v1/activities', {
		data: {
			name,
			icon: '🧪',
			basePoints: 1,
			categoryId: asCategoryId(1),
			ageMin: null,
			ageMax: null,
		},
	});
	expect(res.status()).toBe(201);
	const body = await res.json();
	expect(body.id).toBeDefined();
	return body.id as number;
}

/** SvelteKit router に intercept させる client-side 遷移 (app container 内 anchor 注入 + click) */
async function clientSideNavigate(page: Page, href: string): Promise<void> {
	await page.evaluate((h) => {
		// SvelteKit の click listener 圏内 (app container 内) に anchor を注入する
		const container = document.body.querySelector('div') ?? document.body;
		const a = document.createElement('a');
		a.href = h;
		a.textContent = 'e2e-nav';
		a.setAttribute('data-testid', 'e2e-injected-nav');
		container.appendChild(a);
		a.click();
		a.remove();
	}, href);
}

async function setSpaMarker(page: Page): Promise<void> {
	await page.evaluate(() => {
		(window as unknown as { __spaMarker?: number }).__spaMarker = 1;
	});
}

async function expectSpaMarkerAlive(page: Page): Promise<void> {
	const marker = await page.evaluate(
		() => (window as unknown as { __spaMarker?: number }).__spaMarker,
	);
	expect(marker, 'client-side 遷移であること (full reload なら marker が消える)').toBe(1);
}

test.describe('#3499 AC1: edit 再遷移の stale form guard', () => {
	test('edit/A → edit/B の client-side 再遷移でフォームが B の値に再 seed される', async ({
		page,
		request,
	}) => {
		test.slow(); // Vite dev コールドコンパイル耐性
		const nameA = `#3499-reseed-A-${Date.now()}`;
		const nameB = `#3499-reseed-B-${Date.now()}`;
		const idA = await createDedicatedActivity(request, nameA);
		const idB = await createDedicatedActivity(request, nameB);

		try {
			// full load で A の編集画面 → seed 値 = A
			await page.goto(`/admin/activities/${idA}/edit`, { waitUntil: 'domcontentloaded' });
			const nameInput = page.locator('input[name="name"]');
			await expect(nameInput).toHaveValue(nameA, { timeout: 30_000 });

			// client-side で edit/B へ再遷移 (同一 route param 変更 = component 非 remount 経路)
			await setSpaMarker(page);
			await clientSideNavigate(page, `/admin/activities/${idB}/edit`);
			await page.waitForURL(`**/admin/activities/${idB}/edit`, { timeout: 15_000 });
			await expectSpaMarkerAlive(page);

			// {#key data.activity.id} guard により B の値へ再 seed される
			// (guard 無しの旧実装では A の値が残り fail する = #3498 stale form)
			await expect(nameInput).toHaveValue(nameB, { timeout: 10_000 });
		} finally {
			// cleanup: worker DB 共有 spec のため dedicated fixture を除去 (tests/CLAUDE.md #3163)
			await request.delete(`/api/v1/activities/${idA}`);
			await request.delete(`/api/v1/activities/${idB}`);
		}
	});
});

test.describe('#3499 AC2: childIdOverride の per-child scope 境界', () => {
	test('admin/activities: tab click 上書き後の client-side ?childId 遷移は URL を優先する', async ({
		page,
	}) => {
		test.slow();
		await page.goto('/admin/activities', { waitUntil: 'domcontentloaded' });
		const tabs = page.locator('[data-testid^="child-tab-"]');
		await expect(tabs.first()).toBeVisible({ timeout: 30_000 });
		const tabCount = await tabs.count();
		expect(
			tabCount,
			'2 child 以上の seed が必要 (global-setup.ts TEST_CHILDREN)',
		).toBeGreaterThanOrEqual(2);

		const idOf = async (i: number): Promise<string> => {
			const testid = await tabs.nth(i).getAttribute('data-testid');
			return (testid ?? '').replace('child-tab-', '');
		};
		const idFirst = await idOf(0);
		const idSecond = await idOf(1);

		// tab click で override = 2 人目
		await tabs.nth(1).click();
		await expect(page.getByTestId(`child-tab-${idSecond}`)).toHaveAttribute(
			'aria-selected',
			'true',
		);

		// client-side で ?childId=<1 人目> へ遷移 (load 再実行) → URL が override に勝つ
		await setSpaMarker(page);
		await clientSideNavigate(page, `/admin/activities?childId=${idFirst}`);
		await page.waitForURL(
			(u) => u.pathname.endsWith('/admin/activities') && u.searchParams.get('childId') === idFirst,
			{ timeout: 15_000 },
		);
		await expectSpaMarkerAlive(page);

		// 旧実装 (seed-once override) では 2 人目タブが active のまま残り fail する
		await expect(page.getByTestId(`child-tab-${idFirst}`)).toHaveAttribute(
			'aria-selected',
			'true',
			{
				timeout: 10_000,
			},
		);
		await expect(page.getByTestId(`child-tab-${idSecond}`)).toHaveAttribute(
			'aria-selected',
			'false',
		);
	});

	test('admin/rewards: tab click 上書き後の client-side ?childId 遷移は URL を優先する', async ({
		page,
	}) => {
		test.slow();
		await page.goto('/admin/rewards', { waitUntil: 'domcontentloaded' });
		const tabs = page.locator('[data-testid^="rewards-child-tab-"]');
		await expect(tabs.first()).toBeVisible({ timeout: 30_000 });
		expect(await tabs.count()).toBeGreaterThanOrEqual(2);

		const idOf = async (i: number): Promise<string> => {
			const testid = await tabs.nth(i).getAttribute('data-testid');
			return (testid ?? '').replace('rewards-child-tab-', '');
		};
		const idFirst = await idOf(0);
		const idSecond = await idOf(1);

		await tabs.nth(1).click();
		await expect(page.getByTestId(`rewards-child-tab-${idSecond}`)).toHaveAttribute(
			'aria-selected',
			'true',
		);

		await setSpaMarker(page);
		await clientSideNavigate(page, `/admin/rewards?childId=${idFirst}`);
		await page.waitForURL(
			(u) => u.pathname.endsWith('/admin/rewards') && u.searchParams.get('childId') === idFirst,
			{ timeout: 15_000 },
		);
		await expectSpaMarkerAlive(page);

		await expect(page.getByTestId(`rewards-child-tab-${idFirst}`)).toHaveAttribute(
			'aria-selected',
			'true',
			{ timeout: 10_000 },
		);
	});

	test('marketplace 取込 → admin 復帰 CUJ: 取込確定 (invalidateAll) 後も選択中 child scope が維持される', async ({
		page,
	}) => {
		test.slow();
		// marketplace 復帰時の URL 文脈 (?childId=<X>&import=<presetId>) を再現。
		// X には既定 fallback (1 人目) では検出できない 2 人目 child を使う。
		await page.goto('/admin/activities', { waitUntil: 'domcontentloaded' });
		const tabs = page.locator('[data-testid^="child-tab-"]');
		await expect(tabs.first()).toBeVisible({ timeout: 30_000 });
		expect(await tabs.count()).toBeGreaterThanOrEqual(2);
		const targetId = ((await tabs.nth(1).getAttribute('data-testid')) ?? '').replace(
			'child-tab-',
			'',
		);

		await page.goto(`/admin/activities?childId=${targetId}&import=kinder-starter`, {
			waitUntil: 'domcontentloaded',
		});

		// URL 由来 scope: 取込前から対象 child タブが active
		await expect(page.getByTestId(`child-tab-${targetId}`)).toHaveAttribute(
			'aria-selected',
			'true',
			{ timeout: 30_000 },
		);

		// ChildSelectionDialog auto-open → 対象 child を選択 → 確定 (act → outcome assert)
		const dialog = page.getByTestId('import-child-selection-dialog');
		await expect(dialog).toBeVisible({ timeout: 10_000 });
		const childOption = page.getByTestId(`child-selection-${targetId}`);
		await expect(childOption).toBeVisible();
		await childOption.check();

		const confirm = page.getByTestId('child-selection-confirm');
		await expect(confirm).toBeEnabled();
		const [resp] = await Promise.all([
			page.waitForResponse((r) => /\?\/importPackToChildren/.test(r.url())),
			confirm.click(),
		]);
		expect(
			resp.ok(),
			`importPackToChildren response not OK (status ${resp.status()})`,
		).toBeTruthy();

		// invalidateAll 後も per-child scope (対象 child タブ + context banner) が維持される
		await expect(page.getByTestId(`child-tab-${targetId}`)).toHaveAttribute(
			'aria-selected',
			'true',
			{ timeout: 10_000 },
		);
		const targetNickname = (await page.getByTestId(`child-tab-${targetId}`).textContent())?.replace(
			/\(\d+\)/,
			'',
		);
		await expect(page.getByTestId('child-context-banner')).toContainText(
			(targetNickname ?? '').trim(),
		);
	});
});
