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
 *
 * 判別力 note (#3499 実測): 現行 SvelteKit バージョンは同一 route の client-side 遷移でも
 * page component を remount する (DOM identity probe で実測確認) ため、本 spec の遷移系
 * test は旧実装 (seed-once) でも PASS する「挙動契約の regression guard」である。
 * 非 remount で data prop だけが更新される経路 (invalidateAll / 将来の SvelteKit component
 * 再利用最適化 / shallow routing) の判別 (red→green) は unit test
 * `tests/unit/routes/activity-edit-reseed.test.ts` (rerender = 同一 instance への data 更新)
 * が担う。SvelteKit の remount 戦略は version 依存の実装詳細であり、本 spec は router
 * 挙動が変わっても「再遷移後に正しい値が表示される」ことを固定し続ける。
 *
 * hydration 耐性: Vite dev 環境では hydration 完了前の click が空振りする既知 race がある
 * (`admin-activities-add-ux.spec.ts` openMenu / `admin-activities-delete.spec.ts`
 * openDeleteDialog と同根)。本 spec は repo 前例に倣い「click → 観測可能な状態変化」を
 * bounded retry で待つ (ADR-0006 適合: assertion は弱めず interaction のみ retry)。
 */

import { expect, type Locator, type Page, test } from '@playwright/test';
import { asCategoryId } from '../../src/lib/domain/ids';
import { SUB_ICON_PRESETS } from '../../src/lib/features/admin/components/activity-types';

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

/**
 * 子供タブを click し aria-selected が反映されるまで bounded retry。
 * hydration 完了前の click 空振り (dev 環境の既知 race) を吸収する。
 * retry を使い切ったら最終 assert で hard fail (skip / weakening しない、ADR-0006)。
 */
async function clickTabUntilSelected(tab: Locator): Promise<void> {
	for (let attempt = 0; attempt < 10; attempt++) {
		await tab.click();
		try {
			await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 2_000 });
			return;
		} catch {
			// hydration 未完 / Vite dev cold compile 中の click 空振りを再 click で吸収
		}
	}
	await expect(tab, 'tab click not reflected after 10 attempts').toHaveAttribute(
		'aria-selected',
		'true',
		{ timeout: 5_000 },
	);
}

/**
 * edit フォームの hydration 完了を確認する probe。サブアイコン preset button を click し、
 * Svelte re-render (選択状態 class 付与) が観測できるまで bounded retry → none button で
 * 元の seed 状態 (editSubIcon='') に戻す。injected anchor の client-side 遷移は router
 * (hydration 後に attach) が前提のため、遷移前に本 probe で hydration を確定させる。
 */
async function ensureEditFormHydrated(page: Page): Promise<void> {
	const presetBtn = page.getByRole('button', { name: SUB_ICON_PRESETS[0], exact: true });
	for (let attempt = 0; attempt < 10; attempt++) {
		await presetBtn.click();
		try {
			await expect(presetBtn).toHaveClass(/brand-100/, { timeout: 2_000 });
			// editSubIcon を seed 値 ('') に戻す (none button click → 選択解除を確認)
			const noneBtn = presetBtn.locator('xpath=preceding-sibling::button[1]');
			await noneBtn.click();
			await expect(presetBtn).not.toHaveClass(/brand-100/);
			return;
		} catch {
			// hydration 未完 / Vite dev cold compile 中の click 空振りを再 click で吸収
		}
	}
	throw new Error('edit form hydration not detected after 10 attempts');
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

			// hydration 完了を確定させる (router attach 前に anchor click すると full reload になり
			// marker assert で fail する。dev 環境の hydration race を probe で吸収)
			await ensureEditFormHydrated(page);

			// client-side で edit/B へ再遷移 (同一 route param 変更 = component 非 remount 経路)
			await setSpaMarker(page);
			await clientSideNavigate(page, `/admin/activities/${idB}/edit`);
			await page.waitForURL(`**/admin/activities/${idB}/edit`, { timeout: 15_000 });
			await expectSpaMarkerAlive(page);

			// {#key data.activity.id} guard により B の値へ再 seed される (挙動契約の固定。
			// 非 remount 経路の判別は unit test 側 — 冒頭「判別力 note」参照)
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

		// tab click で override = 2 人目 (hydration race を bounded retry で吸収)
		await clickTabUntilSelected(page.getByTestId(`child-tab-${idSecond}`));

		// client-side で ?childId=<1 人目> へ遷移 (load 再実行) → URL が override に勝つ
		await setSpaMarker(page);
		await clientSideNavigate(page, `/admin/activities?childId=${idFirst}`);
		await page.waitForURL(
			(u) => u.pathname.endsWith('/admin/activities') && u.searchParams.get('childId') === idFirst,
			{ timeout: 15_000 },
		);
		await expectSpaMarkerAlive(page);

		// URL (?childId) が tab click 上書きより優先される契約を固定する
		// (非 remount 経路での seed-once stale 判別は冒頭「判別力 note」参照)
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

		// tab click で override = 2 人目 (hydration race を bounded retry で吸収)
		await clickTabUntilSelected(page.getByTestId(`rewards-child-tab-${idSecond}`));

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
