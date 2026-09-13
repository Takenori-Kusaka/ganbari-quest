// tests/e2e/admin-children-add-reflects-immediately.spec.ts
// #4919: /admin/children で子供を追加すると POST は成功するが一覧に反映されず、
// 手動リロードして初めて表示される不具合の回帰テスト。
//
// 本番 (DSQL) で観測された症状: `use:enhance` 既定の invalidateAll が実行されても
// 直後の再読込 (`getAllChildren`) がまだ新しい行を含まない (プールから別接続を引いた
// ことによる read-after-write の揺らぎと推測、ローカル SQLite / PGlite では再現しない)。
// 対策として action が返す `addedChild` を invalidateAll の鮮度に依存せず直接
// 一覧へ楽観追加するようにした (`src/routes/(parent)/admin/children/+page.svelte`)。
// 本 spec はこの楽観追加の「見た目の契約」(reload せずに一覧へ出る / 成功文言が出る) を固定する。

import { expect, test } from '@playwright/test';
import { ADMIN_CHILDREN_PAGE_LABELS } from '../../src/lib/domain/labels';

test.describe('#4919: 子供追加が reload なしで一覧に反映される', () => {
	test('追加成功直後に一覧へ反映され、成功文言が role="status" で出る', async ({ page }) => {
		await page.goto('/admin/children');

		const listItems = page.locator('[data-tutorial="children-list"] a');
		const beforeCount = await listItems.count();

		const nickname = `テスト太郎-${Date.now()}`;
		await page.getByRole('button', { name: ADMIN_CHILDREN_PAGE_LABELS.addButton }).first().click();
		await expect(page.getByText(ADMIN_CHILDREN_PAGE_LABELS.addFormTitle)).toBeVisible();
		await page.getByLabel(ADMIN_CHILDREN_PAGE_LABELS.nicknameLabel).fill(nickname);
		await page.locator('#add-age').fill('5');
		await page.getByRole('button', { name: ADMIN_CHILDREN_PAGE_LABELS.addButton }).last().click();

		// フォームが閉じる (既存挙動)
		await expect(page.getByText(ADMIN_CHILDREN_PAGE_LABELS.addFormTitle)).not.toBeVisible();

		// #4919 AC1: reload せずに一覧件数が +1 になり、追加した子供が見える
		//
		// #4950: locator は一覧に限定する。実装は成功 feedback を Toast + banner の 2 層で出す
		// (DESIGN.md §5「2 層防御パターン」) ため、page 全体の getByText(nickname) は
		// 「Toast / banner / 一覧カード」の 3 要素に一致して strict mode violation になる。
		// ここで確かめたいのは「一覧に出ていること」なので一覧の中だけを見る。
		await expect(listItems).toHaveCount(beforeCount + 1);
		await expect(listItems.filter({ hasText: nickname })).toHaveCount(1);

		// #4919 AC2: role="status" の成功文言が出る (admin/activities の action-message と同型)
		const banner = page.getByTestId('admin-children-action-message');
		await expect(banner).toBeVisible();
		await expect(banner).toContainText(ADMIN_CHILDREN_PAGE_LABELS.addedSuccess(nickname));

		// reload しても同じ件数のまま (楽観追加分がサーバー確定分に正しく差し替わり二重表示しない)
		await page.reload();
		await expect(listItems).toHaveCount(beforeCount + 1);
		await expect(listItems.filter({ hasText: nickname })).toHaveCount(1);
	});
});
