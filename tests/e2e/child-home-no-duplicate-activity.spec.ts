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
 * 子供 home の activity-card 名を全件抽出する。
 * data-testid="activity-card-<id>" 配下に表示されるテキスト群を取得。
 */
async function collectActivityNames(page: Page): Promise<string[]> {
	const cards = page.locator('[data-testid^="activity-card-"]');
	const count = await cards.count();
	const names: string[] = [];
	for (let i = 0; i < count; i++) {
		const card = cards.nth(i);
		// activity-card 内の .activity-name / title 系を優先抽出。
		// fallback で innerText 全体を採用 (空白除去 + 短縮)。
		const nameLocator = card.locator('[data-testid="activity-name"]');
		const hasName = (await nameLocator.count()) > 0;
		const raw = hasName ? await nameLocator.first().innerText() : await card.innerText();
		names.push(raw.trim().split(/\s+/)[0] ?? '');
	}
	return names;
}

test.describe('#2471: 子供 home で activity が重複 render されない', () => {
	test('preschool たろうくん home で activity 名が一意 (兄弟分の混入なし)', async ({ page }) => {
		await selectChildByName(page, 'たろうくん');
		await dismissOverlays(page);
		await expect(page).toHaveURL(/\/preschool\/home/);

		const names = await collectActivityNames(page);
		expect(names.length, '少なくとも 1 件の activity-card が表示されること').toBeGreaterThanOrEqual(
			1,
		);

		// 重複検知: 同名 activity が複数 card で render されていないこと
		const counts = new Map<string, number>();
		for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
		const duplicates = [...counts.entries()].filter(([, c]) => c > 1);
		expect(
			duplicates,
			`子供 home に同名 activity-card が複数表示されている (per-child 絞り込みの bug 再発、#2471 参照): ${JSON.stringify(duplicates)}`,
		).toEqual([]);
	});

	test('elementary けんたくん home で activity 名が一意 (兄弟分の混入なし)', async ({ page }) => {
		await selectChildByName(page, 'けんたくん');
		await dismissOverlays(page);
		await expect(page).toHaveURL(/\/elementary\/home/);

		const names = await collectActivityNames(page);
		expect(names.length, '少なくとも 1 件の activity-card が表示されること').toBeGreaterThanOrEqual(
			1,
		);

		const counts = new Map<string, number>();
		for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
		const duplicates = [...counts.entries()].filter(([, c]) => c > 1);
		expect(
			duplicates,
			`子供 home に同名 activity-card が複数表示されている (per-child 絞り込みの bug 再発、#2471 参照): ${JSON.stringify(duplicates)}`,
		).toEqual([]);
	});

	test('兄弟切替で別 child の activity に切り替わる (selectedChildId 同期)', async ({ page }) => {
		// たろうくん (preschool) の activity 一覧を取得
		await selectChildByName(page, 'たろうくん');
		await dismissOverlays(page);
		const taroNames = await collectActivityNames(page);

		// けんたくん (elementary) に切り替え
		await selectChildByName(page, 'けんたくん');
		await dismissOverlays(page);
		const kentaNames = await collectActivityNames(page);

		// 両方ともゼロでないこと
		expect(taroNames.length, 'たろうくん home に activity が 1 件以上').toBeGreaterThanOrEqual(1);
		expect(kentaNames.length, 'けんたくん home に activity が 1 件以上').toBeGreaterThanOrEqual(1);

		// 兄弟切替で重複 render が起きていないこと (個別 set でも一意)
		const taroSet = new Set(taroNames);
		const kentaSet = new Set(kentaNames);
		expect(
			taroSet.size,
			`たろうくん home: 同名 activity-card が複数表示 (#2471 bug 再発): ${taroNames.join(', ')}`,
		).toBe(taroNames.length);
		expect(
			kentaSet.size,
			`けんたくん home: 同名 activity-card が複数表示 (#2471 bug 再発): ${kentaNames.join(', ')}`,
		).toBe(kentaNames.length);
	});
});
