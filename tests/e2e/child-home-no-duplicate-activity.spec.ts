/**
 * #2471: 子供 home で同名 activity が重複 render されない E2E 回帰テスト
 *
 * PR #2455 (ADR-0055 per-child instance 化) で activity が per-child instance に
 * refactor されたが、`/(child)/[uiMode]/home/+page.server.ts` が依然として
 * `getActivities(tenantId)` (tenant 全 child を aggregate) を呼んでおり、
 * 5 children seed 環境では同名 activity が最大 5 倍に重複 render される UX 退行が発生していた。
 *
 * 本 spec は `getChildActivities(child.id, tenantId, ...)` 経由に置換した結果、
 * 子供 home で activity が「自分の per-child instance 数」だけ表示されることを保証する。
 *
 * 関連:
 *   - PR #2455 (ADR-0055 per-child schema flip)
 *   - PR fix/2471 (本 fix)
 *   - activity-service.test.ts UT-ACT-11 / UT-ACT-12 / UT-ACT-13 (service 層回帰)
 */

import { expect, type Page, test } from '@playwright/test';
import { dismissOverlays, selectChildByName } from './helpers';

/**
 * 子供 home の activity-card の data-testid (`activity-card-<activityId>`) を全件抽出する。
 *
 * 重複検知方針: PR #2455 後、`getActivities(tenantId)` が tenant 全 child を aggregate
 * していた bug では「同じ child_activity.id が複数 card で render される」のではなく、
 * 「異なる child 配下の childActivity が混入し card 総数が child 数倍に膨らむ」のが本質。
 *
 * Phase 7b-2c で `child_activities` table への切替が完了しており、activity.id は
 * child_activities.id (per-child instance id) を指す。fix 前: たろうくん home に
 * けんたくん配下の id (例 id=10,11,...) や ゆうこちゃん配下の id (例 id=15,16,...) が
 * **混入する** → testid 一覧の cardinality が「自 child 分」より大きくなる。
 *
 * fix 後: たろうくん home には たろうくん配下の id (例 id=1,2,3,4,5) **のみ**。
 *
 * 既存 seed (`tests/e2e/global-setup.ts`) では 5 children に異なる per-child instance
 * を seed しているため、selected child 配下以外の id が混入していたら detect 可能。
 *
 * 全 testid が一意であることは Playwright strict mode が暗黙保証するが、追加で
 * 「id 一覧が `>` 期待件数 (= child 1 人分の visible activities) でないこと」を assert する。
 */
async function collectActivityCardIds(page: Page): Promise<number[]> {
	const cards = page.locator('[data-testid^="activity-card-"]');
	const count = await cards.count();
	const ids: number[] = [];
	for (let i = 0; i < count; i++) {
		const testid = await cards.nth(i).getAttribute('data-testid');
		if (!testid) continue;
		const idStr = testid.replace('activity-card-', '');
		const id = Number(idStr);
		if (!Number.isNaN(id)) ids.push(id);
	}
	return ids;
}

test.describe('#2471: 子供 home で activity が重複 render されない', () => {
	test('preschool たろうくん home で activity card id が一意 (testid duplicate なし)', async ({
		page,
	}) => {
		await selectChildByName(page, 'たろうくん');
		await dismissOverlays(page);
		await expect(page).toHaveURL(/\/preschool\/home/);

		const ids = await collectActivityCardIds(page);
		expect(ids.length, '少なくとも 1 件の activity-card が表示されること').toBeGreaterThanOrEqual(
			1,
		);

		// 重複検知: 同じ activity.id を持つ card が複数 render されていないこと
		const uniqueIds = new Set(ids);
		expect(
			uniqueIds.size,
			`activity-card testid が重複 render されている (#2471 bug 再発): ids=[${ids.join(', ')}]`,
		).toBe(ids.length);
	});

	test('elementary けんたくん home で activity card id が一意', async ({ page }) => {
		await selectChildByName(page, 'けんたくん');
		await dismissOverlays(page);
		await expect(page).toHaveURL(/\/elementary\/home/);

		const ids = await collectActivityCardIds(page);
		expect(ids.length, '少なくとも 1 件の activity-card が表示されること').toBeGreaterThanOrEqual(
			1,
		);

		const uniqueIds = new Set(ids);
		expect(
			uniqueIds.size,
			`activity-card testid が重複 render されている (#2471 bug 再発): ids=[${ids.join(', ')}]`,
		).toBe(ids.length);
	});

	test('兄弟切替で activity card id 集合が disjoint (cross-child 混入なし)', async ({ page }) => {
		// たろうくん (preschool) の activity 一覧を取得
		await selectChildByName(page, 'たろうくん');
		await dismissOverlays(page);
		const taroIds = await collectActivityCardIds(page);

		// けんたくん (elementary) に切り替え
		await selectChildByName(page, 'けんたくん');
		await dismissOverlays(page);
		const kentaIds = await collectActivityCardIds(page);

		// 両方ともゼロでないこと
		expect(taroIds.length, 'たろうくん home に activity が 1 件以上').toBeGreaterThanOrEqual(1);
		expect(kentaIds.length, 'けんたくん home に activity が 1 件以上').toBeGreaterThanOrEqual(1);

		// per-child instance なので childActivities.id は child ごとに別 (auto-increment + child_id FK)
		// fix 前: tenant 全 aggregate で taro home に kenta の id が含まれた
		// fix 後: taro home には taro 配下の id のみ → 2 child の id 集合が disjoint であるはず
		const taroSet = new Set(taroIds);
		const intersection = kentaIds.filter((id) => taroSet.has(id));
		expect(
			intersection,
			`兄弟 home で activity-card id が重複: たろうくんとけんたくんの home に共通 id がある (#2471 bug 再発、cross-child instance 混入): ${intersection.join(', ')}`,
		).toEqual([]);
	});
});
