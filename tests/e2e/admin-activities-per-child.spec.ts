/**
 * #2362 PR-3 Phase 4 — admin/activities per-child UX E2E 回帰
 *
 * 子供別タブ切替 / ChildSelectionDialog auto-open (`?import=<presetId>`) /
 * 「他の子供から copy」 action / 「一括追加」 action を検証する。
 *
 * 既存 `admin-activities-add-ux.spec.ts` / `admin-activities-import-marketplace.spec.ts`
 * は family master 動線を継続検証。本 spec は per-child 動線専用。
 *
 * Phase 4 段階では family master と per-child の並存表示状態を前提とし、
 * Phase 6/7 で family master drop 後に rewrite 予定 (PR description 参照)。
 */

import { expect, test } from '@playwright/test';

test.describe('admin/activities per-child UX (Phase 4)', () => {
	test('子供タブ row + actions が表示される', async ({ page }) => {
		await page.goto('/admin/activities');
		// 子供タブ row は children >= 1 で表示
		const tabRow = page.getByTestId('admin-activities-child-tabs');
		await expect(tabRow).toBeVisible();
		// child tab ボタン (テストデータ最低 1 件以上)
		const firstTab = tabRow.locator('[data-testid^="child-tab-"]').first();
		await expect(firstTab).toBeVisible();
		// child context banner
		await expect(page.getByTestId('child-context-banner')).toBeVisible();
	});

	test('子供タブクリックで URL ?childId が同期される', async ({ page }) => {
		await page.goto('/admin/activities');
		const tabs = page.locator('[data-testid^="child-tab-"]');
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
		const childId = secondId?.replace('child-tab-', '');
		await secondTab.click();

		await expect.poll(() => new URL(page.url()).searchParams.get('childId')).toBe(childId);
	});

	test('?import=<presetId> で ChildSelectionDialog auto-open', async ({ page }) => {
		// `kinder-starter` は activity-pack marketplace SSOT に実在する preset id
		// (src/lib/data/marketplace/activity-packs/kinder-starter.json)。
		// 旧 spec は `simple-daily` (SSOT 不在) を使っていたため dialog は開くが
		// 取込実行は 404 になり、render-only assert で dead-end を見逃していた (#2558)。
		await page.goto('/admin/activities?import=kinder-starter');
		const dialog = page.getByTestId('import-child-selection-dialog');
		await expect(dialog).toBeVisible({ timeout: 5000 });
		await expect(page.getByTestId('child-selection-all')).toBeVisible();
		await expect(page.getByTestId('child-selection-confirm')).toBeVisible();
	});

	test('#2558 goal 完遂: 同一パックを 1 人目に取込済の状態で 2 人目に取込 → 2 人目に活動が追加される (「無反応」退行の捕捉)', async ({
		page,
	}) => {
		// 顧客クレーム: 「みんなのテンプレートで活動を追加しようとダイアログを操作して
		// 追加を押しても無反応」。根本原因は tenant 全体 dedup — 1 人目に同パックがあると
		// 2 人目への取込が全 skip → imported:0 → 「何も追加されず無反応」。
		//
		// 本 test は本 bug を faithful に再現する:
		//   step 1 (setup): kinder-starter を非 baby の子に取込 (= 1 人目がパックを保持)
		//   step 2 (UI 検証): 同パックを baby の子に取込 (= 2 人目)
		//   assert: baby の子に kinder-starter 由来の活動が存在する (= 0 件でない)
		// 退行 (tenant 全体 dedup) なら step1 の子に全名が在るため step2 が全 skip
		// → baby は 0 件のまま → 必ず fail する。
		// baby の子 (はなこちゃん) は global-setup が child_activities を seed しないため、
		// 取込が効かなければ確実に 0 件のまま留まる = 最も鋭敏な検出点。
		// render-only ではなく goal 完遂 (永続反映) を検証する (tests/CLAUDE.md §interactive flow / #2544)。
		await page.goto('/admin/activities');

		const tabs = page.locator('[data-testid^="child-tab-"]');
		const tabCount = await tabs.count();
		// global-setup.ts は 5 children を seed する (skip でなく precondition assert、ADR-0006)
		expect(
			tabCount,
			'2 child 以上の seed が必要 (global-setup.ts TEST_CHILDREN 参照)',
		).toBeGreaterThanOrEqual(2);

		// 1 人目 = けんたくん (elementary)、2 人目 = はなこちゃん (baby、空)。
		const firstTab = tabs.filter({ hasText: 'けんたくん' });
		const babyTab = tabs.filter({ hasText: 'はなこちゃん' });
		await expect(firstTab, '1 人目 (けんたくん) タブが存在すること').toHaveCount(1);
		await expect(babyTab, '2 人目 baby (はなこちゃん) タブが存在すること').toHaveCount(1);
		const firstChildId = (await firstTab.getAttribute('data-testid'))?.replace('child-tab-', '');
		const babyChildId = (await babyTab.getAttribute('data-testid'))?.replace('child-tab-', '');
		expect(firstChildId, '1 人目 child id 取得').toBeTruthy();
		expect(babyChildId, '2 人目 child id 取得').toBeTruthy();

		// step 1 (setup): 1 人目に kinder-starter を取込 (form action 直叩き、UI 検証対象外)
		const setupResp = await page.request.post('/admin/activities?/importPackToChildren', {
			headers: { 'x-sveltekit-action': 'true' },
			multipart: { packId: 'kinder-starter', childIds: String(firstChildId) },
		});
		expect(setupResp.ok(), `setup import 200 (status ${setupResp.status()})`).toBeTruthy();

		const parseTabCount = async (locator: typeof babyTab): Promise<number> => {
			const t = (await locator.textContent()) ?? '';
			const m = t.match(/\((\d+)\)/);
			return m ? Number(m[1]) : 0;
		};

		// step 2 (UI 検証): `?import=kinder-starter` で ChildSelectionDialog を auto-open
		await page.goto('/admin/activities?import=kinder-starter');
		const dialog = page.getByTestId('import-child-selection-dialog');
		await expect(dialog).toBeVisible({ timeout: 5000 });

		// 「全員」ではなく 2 人目 baby のみを選択
		const childOption = page.getByTestId(`child-selection-${babyChildId}`);
		await expect(childOption).toBeVisible();
		await childOption.check();

		// 追加ボタン enabled (dead-end でない前提) → click → form action 発火 (副作用 A)
		const confirm = page.getByTestId('child-selection-confirm');
		await expect(confirm).toBeEnabled();
		const [resp] = await Promise.all([
			page.waitForResponse((r) => /\?\/importPackToChildren/.test(r.url())),
			confirm.click(),
		]);
		expect(resp.ok(), `import response not OK (status ${resp.status()})`).toBeTruthy();

		// 副作用 C (永続反映): clean な /admin/activities に遷移し直し ($import= 残留での
		// dialog 再 open を避ける)、baby tab に活動が存在する (= 0 件でない) ことを assert。
		// 退行 (tenant 全体 dedup で全 skip) なら 1 人目に全名があるため baby は 0 件のまま
		// → 必ず fail する。これが本 bug の goal 完遂検証。
		await page.goto('/admin/activities');
		const babyTabAfter = page.locator('[data-testid^="child-tab-"]').filter({
			hasText: 'はなこちゃん',
		});
		await expect.poll(() => parseTabCount(babyTabAfter), { timeout: 30_000 }).toBeGreaterThan(0);
	});

	test('「他の子供から copy」 dialog open + radio 選択 → コピー実行', async ({ page }) => {
		await page.goto('/admin/activities');
		const tabs = page.locator('[data-testid^="child-tab-"]');
		const count = await tabs.count();
		// global-setup.ts は 5 children を seed する (上 test 参照)。skip ではなく
		// precondition assert で seed 破綻を検知する (ADR-0006)
		expect(
			count,
			'2 child 以上の seed が必要 (global-setup.ts TEST_CHILDREN 参照)',
		).toBeGreaterThanOrEqual(2);

		const copyBtn = page.getByTestId('copy-from-child-btn');
		await expect(copyBtn).toBeVisible();
		await copyBtn.click();

		await expect(page.getByTestId('copy-from-child-dialog')).toBeVisible();
		// 他の child が選択肢として並ぶ (selectedChild は除外される)
		const sourceOptions = page.locator('[data-testid^="copy-source-"]');
		expect(await sourceOptions.count()).toBeGreaterThan(0);

		const firstSource = sourceOptions.first();
		await firstSource.click();
		// confirm button enable 化
		await expect(page.getByTestId('copy-from-child-confirm')).toBeEnabled();
	});

	test('「一括追加」 dialog open + form 入力 + 全員選択', async ({ page }) => {
		await page.goto('/admin/activities');
		const bulkBtn = page.getByTestId('bulk-create-btn');
		await expect(bulkBtn).toBeVisible();
		await bulkBtn.click();

		const dialog = page.getByTestId('bulk-create-dialog');
		await expect(dialog).toBeVisible();

		// 名前入力 (FormField 内部の input)
		const nameInput = dialog.locator('input').first();
		await nameInput.fill('テスト一括活動');

		// 全員選択 radio (default)
		await expect(page.getByTestId('bulk-target-all')).toBeChecked();

		// confirm button enable 化
		await expect(page.getByTestId('bulk-create-confirm')).toBeEnabled();
	});

	test('per-child + family master 並存表示 (Phase 4 過渡期)', async ({ page }) => {
		await page.goto('/admin/activities');
		// Phase 4 では family master Activity と per-child ChildActivity が並存
		// per-child が 0 件でも family master は表示される
		const allTab = page.locator('[data-testid^="child-tab-"]').first();
		await expect(allTab).toBeVisible();
		// activity list は最低 1 件以上 (seed の family master が表示される)
		const list = page.locator('[data-tutorial="activity-list"]');
		await expect(list).toBeVisible();
	});
});
