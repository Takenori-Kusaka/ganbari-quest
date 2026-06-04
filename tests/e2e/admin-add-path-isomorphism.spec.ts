/**
 * tests/e2e/admin-add-path-isomorphism.spec.ts
 *
 * #2903 (EPIC #2897): admin リソース管理ページの「+ 追加」経路 同型性固定テスト。
 *
 * PO 指摘 #6b の根治確認: 活動管理 (activities) は「+ 追加 → 手動 / AI / みんなのテンプレート」の
 * dropdown パターンだが、チェックリスト管理 (checklists) では AI 提案パネルがページ本文に直接露出し、
 * 操作の入口が異なっていた。本 PR で checklists も dropdown パターンに統一した。
 *
 * 本 spec は marketplace-bugs-analysis-2026-06-04.md 項目 6 の「テスト見逃し」(add-path lint は経路
 * 「数」を数えるが「配置パターンの同型性」を検査しない) への構造対応:
 *   - 経路数 lint ではなく **配置パターン (dropdown 内 item の種類と順序) の同型性** を assert する。
 *   - activities / checklists 両ページで「+ 追加」dropdown を開き、先頭 3 item (manual / ai / browse) が
 *     同一 id・同一順序で並ぶことを assert する (page 固有の末尾 item は許容)。
 *   - 両ページとも AI が「dropdown 内の選択肢 → Dialog」であり、ページ本文に AI パネルが直置きされて
 *     いないことを assert する (= 入口が同型)。
 *
 * Menu primitive (`src/lib/ui/primitives/Menu.svelte`) は各 item を `data-testid="menu-item-<id>"` で
 * render する。trigger testid は activities=`header-add-activity-btn` / checklists=`checklists-add-menu`。
 */

import { expect, type Page, test } from '@playwright/test';

/**
 * Ark UI Menu trigger を開く helper (admin-activities-add-ux.spec.ts と同型)。
 * Ark UI Menu は hydration 完了後に listener を attach するため、`data-state="open"` に
 * 遷移するまで rAF 間隔で再 click する (#2260 Fix-6 で確立した安定化パターン)。
 */
async function openMenu(page: Page, triggerTestid: string): Promise<void> {
	const trigger = page.getByTestId(triggerTestid);
	await expect(trigger).toBeVisible({ timeout: 15_000 });
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				if (document.readyState === 'complete') {
					requestAnimationFrame(() => resolve());
				} else {
					window.addEventListener('load', () => requestAnimationFrame(() => resolve()), {
						once: true,
					});
				}
			}),
	);
	const MAX_ATTEMPTS = 30;
	for (let i = 0; i < MAX_ATTEMPTS; i++) {
		await trigger.click();
		const state = await trigger.evaluate((el) => el.getAttribute('data-state'));
		if (state === 'open') return;
		await page.evaluate(
			() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
		);
	}
	await expect(trigger).toHaveAttribute('data-state', 'open');
}

/**
 * 「+ 追加」dropdown を開いた直後の menu item id 配列を順序保持で返す。
 *
 * 同一ページに複数の Ark Menu (add menu / overflow menu) が存在し、いずれも `menu-item-<id>`
 * testid を使う。グローバル query すると別 menu の item を巻き込むため、**現在 open している
 * menu content** (`[data-part="content"][data-state="open"]`) に scope して読み取る。
 */
async function readAddMenuItemIds(page: Page): Promise<string[]> {
	const openContent = page.locator('[data-part="content"][data-state="open"]');
	await expect(openContent.first()).toBeVisible({ timeout: 5_000 });
	const testids = await openContent
		.first()
		.locator('[data-testid^="menu-item-"]')
		.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') ?? ''));
	return testids.map((t) => t.replace('menu-item-', ''));
}

/**
 * activities / checklists が共有すべき add 経路の先頭 3 種 (順序固定)。
 * 「手動で1つ追加 / AI で提案してもらう / みんなのテンプレートから探す」。
 */
const SHARED_ADD_PATH_PREFIX = ['manual', 'ai', 'browse'] as const;

test.describe('#2903 admin add 経路 同型性 (activities ⇔ checklists)', () => {
	test('両ページとも本文に AI 提案パネルが直置きされていない (ページ表示直後は非表示、入口は dropdown のみ)', async ({
		page,
	}) => {
		// AI panel は Dialog 内に格納されるため、closed 時も DOM 上には mount される (count > 0)。
		// 「本文直置きでない」= ページ表示直後に **visible でない** ことで判定する (旧実装は常時 visible だった)。

		// activities: AI panel (ai-suggest-panel) は dropdown → Dialog 経由でのみ visible になる (#2558 段階2)
		await page.goto('/admin/activities');
		await expect(page.getByTestId('admin-activities-child-tabs')).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId('ai-suggest-panel')).not.toBeVisible();

		// checklists: #2903 で AI panel (ai-suggest-checklist-panel) 直置きを撤去 → Dialog 内へ移動。
		// 旧実装ではページ表示直後に常時 visible だったが、本 PR 後は非表示 (dropdown → Dialog で開く)。
		await page.goto('/admin/checklists');
		await expect(page.getByTestId('admin-checklists-page')).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId('ai-suggest-checklist-panel')).not.toBeVisible();
	});

	test('checklists の「+ 追加」dropdown 先頭 3 item が activities と同一 id・同一順序 (manual / ai / browse)', async ({
		page,
	}) => {
		// activities の add 経路を取得
		await page.goto('/admin/activities');
		await expect(page.getByTestId('admin-activities-child-tabs')).toBeVisible({ timeout: 15_000 });
		await openMenu(page, 'header-add-activity-btn');
		const activitiesIds = await readAddMenuItemIds(page);

		// checklists の add 経路を取得
		await page.goto('/admin/checklists');
		await expect(page.getByTestId('admin-checklists-page')).toBeVisible({ timeout: 15_000 });
		await openMenu(page, 'checklists-add-menu');
		const checklistsIds = await readAddMenuItemIds(page);

		// 同型性: 両ページとも先頭 3 item が SHARED_ADD_PATH_PREFIX で一致する (配置パターンの同型)。
		expect(activitiesIds.slice(0, 3)).toEqual([...SHARED_ADD_PATH_PREFIX]);
		expect(checklistsIds.slice(0, 3)).toEqual([...SHARED_ADD_PATH_PREFIX]);
		// 念のため両者の先頭 3 が完全一致することも直接 assert する。
		expect(checklistsIds.slice(0, 3)).toEqual(activitiesIds.slice(0, 3));
	});

	test('checklists の「+ 追加 → AI」で AI ダイアログ + AI パネルが起動する (activities と同型)', async ({
		page,
	}) => {
		await page.goto('/admin/checklists');
		await expect(page.getByTestId('admin-checklists-page')).toBeVisible({ timeout: 15_000 });
		await openMenu(page, 'checklists-add-menu');
		await page.getByTestId('menu-item-ai').click();
		// dropdown → Dialog 内に AI 提案パネルが入る (本文直置きではない)
		await expect(page.getByTestId('checklists-ai-dialog')).toBeVisible({ timeout: 5_000 });
		await expect(page.getByTestId('ai-suggest-checklist-panel')).toBeVisible();
	});

	test('checklists の「+ 追加 → みんなのテンプレートから探す」で /marketplace に画面遷移する (activities と同型)', async ({
		page,
	}) => {
		await page.goto('/admin/checklists');
		await expect(page.getByTestId('admin-checklists-page')).toBeVisible({ timeout: 15_000 });
		await openMenu(page, 'checklists-add-menu');
		await Promise.all([
			page.waitForURL(/\/marketplace(\?|$)/, { timeout: 15_000 }),
			page.getByTestId('menu-item-browse').click(),
		]);
		// checklist に絞って遷移する (正規経路の入口、DESIGN.md §10 マーケットプレイス一本化)
		expect(new URL(page.url()).searchParams.get('type')).toBe('checklist');
	});
});
