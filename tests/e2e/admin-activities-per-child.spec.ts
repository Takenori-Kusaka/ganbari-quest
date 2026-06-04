/**
 * #2362 PR-3 Phase 4 / #2902 Phase A — admin/activities per-child UX E2E 回帰
 *
 * 子供別タブ切替 / ChildSelectionDialog auto-open (`?import=<presetId>`) /
 * 「他の子供から copy」 action / 「一括追加」 action を検証する。
 *
 * #2902 Phase A: activity-service の master 系 API は per-child repo 経由に rewrite 済で
 * 「family master table」は物理的に存在しない。admin 一覧は **選択中 child の per-child
 * instance のみ** を単一表示し (旧 family 集約並存を撤去)、全表示行がフル CRUD
 * (ActivityListItem) を持つ。本 spec はこの single-axis 表示の回帰と、AC5
 * (ユーザーメンタルモデル assert: 2 重表示なし / 全行から編集に到達 / 取込件数の整合) を検証する。
 */

import { expect, test } from '@playwright/test';
import { openMenu } from './helpers/goal-flows';

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

	// #2558 段階2: copy / bulk のトップレベル独立ボタンを撤去し header「+ 追加」メニューに統合 (bug-2 解消)。
	// dialog 起動経路を menu-item-copy / menu-item-bulk 経由に更新 (dialog 自体の挙動は不変)。
	test('「別のお子さまからコピー」 dialog open + radio 選択 → コピー実行 (+ 追加メニュー経由)', async ({
		page,
	}) => {
		await page.goto('/admin/activities');
		const tabs = page.locator('[data-testid^="child-tab-"]');
		const count = await tabs.count();
		// global-setup.ts は 5 children を seed する (上 test 参照)。skip ではなく
		// precondition assert で seed 破綻を検知する (ADR-0006)
		expect(
			count,
			'2 child 以上の seed が必要 (global-setup.ts TEST_CHILDREN 参照)',
		).toBeGreaterThanOrEqual(2);

		// #2558 段階2: copy 経路は + 追加メニュー内の menu-item-copy (children >= 2 でのみ提示)
		await openMenu(page, 'header-add-activity-btn', 'menu-item-copy');
		await page.getByTestId('menu-item-copy').click();

		await expect(page.getByTestId('copy-from-child-dialog')).toBeVisible();
		// 他の child が選択肢として並ぶ (selectedChild は除外される)
		const sourceOptions = page.locator('[data-testid^="copy-source-"]');
		expect(await sourceOptions.count()).toBeGreaterThan(0);

		const firstSource = sourceOptions.first();
		await firstSource.click();
		// confirm button enable 化
		await expect(page.getByTestId('copy-from-child-confirm')).toBeEnabled();
	});

	test('「複数のお子さまにまとめて追加」 dialog open + form 入力 + 全員選択 (+ 追加メニュー経由)', async ({
		page,
	}) => {
		await page.goto('/admin/activities');
		// #2558 段階2: bulk 経路は + 追加メニュー内の menu-item-bulk
		await openMenu(page, 'header-add-activity-btn', 'menu-item-bulk');
		await page.getByTestId('menu-item-bulk').click();

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

	// #2902 Phase A AC5: ユーザーメンタルモデル assert
	// (M3 対策: 旧 CUJ テストが「sum が grew」で並存を正として固定していた gap を埋める)

	test('#2902 AC5: 選択中 child タブで同名活動が 2 重表示されない (single-axis、件数水増しなし)', async ({
		page,
	}) => {
		// elementary fixture (けんたくん) は global-setup で per-child activity を複数 seed する。
		// 旧実装は「selected child の per-child」+「tenant 全 child 集約」を連結し、selected child の
		// instance が 2 重に出ていた (35+35=70)。single-axis 化後は各 activity 名が 1 行のみ。
		await page.goto('/admin/activities');
		const tabs = page.locator('[data-testid^="child-tab-"]');
		const elementaryTab = tabs.filter({ hasText: 'けんたくん' });
		await expect(elementaryTab, 'けんたくんタブが存在すること').toHaveCount(1);
		await elementaryTab.click();

		// 一覧に出る per-child 行 (data-testid="per-child-activity-<id>") を列挙し、
		// 表示名の重複が無いことを assert (2 重表示 = 名前が 2 回出る → 必ず fail)。
		const rows = page.locator('[data-testid^="per-child-activity-"]');
		const rowCount = await rows.count();
		expect(rowCount, '選択中 child に visible 活動が 1 件以上 (seed 前提)').toBeGreaterThan(0);

		// 活動名は ActivityListItem の最初の <p> (font-bold) に出る。row 全体の textContent は
		// 編集/表示/削除ボタン label を含み全 row 同一になるため、名前要素のみを抽出する。
		const names: string[] = [];
		for (let i = 0; i < rowCount; i++) {
			const nameEl = rows.nth(i).locator('p').first();
			names.push(((await nameEl.textContent()) ?? '').replace(/\s+/g, ' ').trim());
		}
		const uniqueNames = new Set(names);
		expect(uniqueNames.size, `同名活動が 2 重表示されている (名前: ${names.join(' / ')})`).toBe(
			names.length,
		);

		// 「すべて」フィルタ chip の件数 = 表示行数 (水増しなし)。
		const allChip = page.locator('[data-tutorial="category-filter"] button').first();
		const chipText = (await allChip.textContent()) ?? '';
		const m = chipText.match(/\((\d+)\)/);
		expect(m, 'すべてフィルタに件数表示がある').not.toBeNull();
		expect(Number(m?.[1]), 'カテゴリ「すべて」件数 = 表示行数 (水増しなし)').toBe(rowCount);
	});

	test('#2902 AC5: 全表示行が編集 UI (フル CRUD) に到達できる', async ({ page }) => {
		await page.goto('/admin/activities');
		const tabs = page.locator('[data-testid^="child-tab-"]');
		const elementaryTab = tabs.filter({ hasText: 'けんたくん' });
		await expect(elementaryTab).toHaveCount(1);
		await elementaryTab.click();

		const rows = page.locator('[data-testid^="per-child-activity-"]');
		const rowCount = await rows.count();
		expect(rowCount, '選択中 child に visible 活動が 1 件以上').toBeGreaterThan(0);

		// 各行に編集 link (activity-edit-link) + 削除ボタン (activity-delete-btn-*) が存在する。
		// 旧実装は per-child 行が read-only badge のみで編集 UI が欠落していた (ゴミデータに見える原因)。
		const editLinks = page.locator(
			'[data-testid^="per-child-activity-"] [data-testid="activity-edit-link"]',
		);
		await expect(editLinks).toHaveCount(rowCount);
		const deleteBtns = page.locator(
			'[data-testid^="per-child-activity-"] [data-testid^="activity-delete-btn-"]',
		);
		await expect(deleteBtns).toHaveCount(rowCount);

		// 1 行目の編集 link をクリック → 編集ページに遷移できる (dead-end でない)。
		const firstEdit = editLinks.first();
		const href = await firstEdit.getAttribute('href');
		expect(href, '編集 link が /admin/activities/<id>/edit を指す').toMatch(
			/\/admin\/activities\/\d+\/edit/,
		);
		await Promise.all([page.waitForURL(/\/admin\/activities\/\d+\/edit/), firstEdit.click()]);
		// 編集ページが描画され保存ボタンが操作可能 (dead-end でなく編集を完遂できる)。
		await expect(page.getByTestId('activity-edit-save')).toBeVisible();
	});

	test('#2902 AC5: 取込後に選択 child の件数が実増分のみ増える (水増しなし)', async ({ page }) => {
		test.slow();
		// baby (はなこちゃん) に kinder-starter を取込み、取込後に「タブ件数 = 表示行数」かつ
		// 「表示名が重複しない」ことを assert する。
		//
		// 設計判断 (worker-shared DB 耐性): 取込 imported 件数を response から数値抽出して
		// before+imported を厳密比較する旧 approach は、同 worker DB を共有する他 spec
		// (CUJ-A3 / #2558 goal 完遂) が同じ kinder-starter を baby/全員に取込済の場合
		// imported=0 (全 skip) となり SvelteKit ActionResult の serialize 形式依存で fragile。
		// 「水増し (= 同じ activity が 2 重カウント)」の本質的検出は、取込後の **タブ件数 ==
		// 選択中 child の表示行数 == ユニーク名数** が成立するか (= 重複なし) で行う。
		await page.goto('/admin/activities');
		const tabs = page.locator('[data-testid^="child-tab-"]');
		const babyTab = tabs.filter({ hasText: 'はなこちゃん' });
		await expect(babyTab).toHaveCount(1);
		const babyChildId = (await babyTab.getAttribute('data-testid'))?.replace('child-tab-', '');
		expect(babyChildId).toBeTruthy();

		// ?import=kinder-starter を baby のみに取込 (副作用 A: network 発火 + OK)
		await page.goto('/admin/activities?import=kinder-starter');
		const dialog = page.getByTestId('import-child-selection-dialog');
		await expect(dialog).toBeVisible({ timeout: 10_000 });
		const childOption = page.getByTestId(`child-selection-${babyChildId}`);
		await expect(childOption).toBeVisible();
		await childOption.check();
		const confirm = page.getByTestId('child-selection-confirm');
		await expect(confirm).toBeEnabled();
		const [resp] = await Promise.all([
			page.waitForResponse((r) => /\?\/importPackToChildren/.test(r.url())),
			confirm.click(),
		]);
		expect(resp.ok(), `import response not OK (status ${resp.status()})`).toBeTruthy();

		// 永続反映: clean な /admin/activities に遷移し baby タブを選択。
		await page.goto('/admin/activities');
		const babyTabAfter = page
			.locator('[data-testid^="child-tab-"]')
			.filter({ hasText: 'はなこちゃん' });
		await expect(babyTabAfter).toHaveCount(1);
		await babyTabAfter.click();

		// baby の表示行数を取得 (visible per-child instance)。取込後なので 1 件以上。
		const rows = page.locator('[data-testid^="per-child-activity-"]');
		await expect.poll(() => rows.count(), { timeout: 30_000 }).toBeGreaterThan(0);
		const rowCount = await rows.count();

		// (1) タブ件数 == 表示行数 (水増しなし: タブが行数の 2 倍等にならない)
		const tabText = (await babyTabAfter.textContent()) ?? '';
		const tabNum = Number(tabText.match(/\((\d+)\)/)?.[1] ?? '-1');
		expect(tabNum, `baby タブ件数 (${tabNum}) == 表示行数 (${rowCount}) で水増しなし`).toBe(
			rowCount,
		);

		// (2) 表示名が重複しない (取込で同名 instance が 2 重に並ばない)
		const names: string[] = [];
		for (let i = 0; i < rowCount; i++) {
			const nameEl = rows.nth(i).locator('p').first();
			names.push(((await nameEl.textContent()) ?? '').replace(/\s+/g, ' ').trim());
		}
		expect(
			new Set(names).size,
			`取込後の baby 一覧に同名活動の重複なし (${names.join(' / ')})`,
		).toBe(names.length);
	});
});
