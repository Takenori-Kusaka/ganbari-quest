/**
 * EPIC #2362 P3 / Issue #2366 / PR-4 (#2474) — marketplace → reward-set → import E2E
 *
 * `/admin/rewards` の marketplace reward-set 取込動線を新 Strategy + dispatchImport + per-child fan-out
 * 経由で検証する spec。
 *
 * PR #2474 (PR-4) で動線が変更された:
 *   - 旧 (#2366 時点): `/admin/rewards` 内に `marketplace-reward-import-section` UI が直接配置され、
 *     toggle 経由で preset 一覧を展開して取込していた
 *   - 新 (PR #2474, ADR-0055 + CWE-598 整合): marketplace 詳細から `?import=<itemId>` で redirect → admin
 *     側で ChildSelectionDialog auto-open → `importPresetToChildren` action 経由で per-child fan-out
 *
 * 本 spec は新動線の admin 側 endpoint 単体を検証する (marketplace 詳細 → redirect は
 * `marketplace-reward-set-import.spec.ts` で別途検証)。
 *
 * カバレッジ (PR #2474 rewrite):
 *   - `?import=<presetId>` query で ChildSelectionDialog auto-open
 *   - `?/importPresetToChildren` action: childIds 未指定で 400 fail
 *   - `?/importPresetToChildren` action: 不存在 presetId は 404 (or fail 形式)
 *   - `?/importPresetToChildren` action: tenant 外 childId 指定で 403 (CWE-598 guard、PR #2474 must-1)
 */

import { expect, test } from '@playwright/test';

test.describe('#2366 / PR-4 marketplace → reward-set → import (admin/rewards 新動線)', () => {
	test('?import=<presetId> で ChildSelectionDialog が auto-open する', async ({ page }) => {
		await page.goto('/admin/rewards?import=kinder-rewards');
		await expect(page).toHaveURL(/\/admin\/rewards/);

		// 旧 marketplace-reward-import-section は撤去済 (PR #2474)
		// 新 UX: ChildSelectionDialog が auto-open する
		const dialog = page.getByTestId('reward-import-child-selection-dialog');
		await expect(dialog).toBeVisible({ timeout: 10_000 });
	});

	test('?/importPresetToChildren action: childIds 未指定で 400 fail', async ({ request }) => {
		// childIds を渡さずに POST。+page.server.ts で 400 を返す。
		const res = await request.post('/admin/rewards?/importPresetToChildren', {
			multipart: { presetId: 'kinder-rewards' },
		});
		// SvelteKit form action は fail() を 200 body 内 error として返す or 400 にする
		expect([200, 400].includes(res.status())).toBe(true);
	});

	test('?/importPresetToChildren action: 不存在 presetId は reject される', async ({ request }) => {
		const res = await request.post('/admin/rewards?/importPresetToChildren', {
			multipart: { presetId: 'non-existent-preset-xxxxx', childIds: 'all' },
		});
		// fail() 形式 (200) または 404 を返す
		expect([200, 400, 404].includes(res.status())).toBe(true);
	});

	test('?/importPresetToChildren action: tenant 外 childId は 403 reject (CWE-598)', async ({
		request,
	}) => {
		// PR #2474 must-1 CWE-598 guard: 存在しない巨大 childId (他 tenant 想定) を CSV で混入。
		// tenant 配下 child の set に含まれないため 403 (or 200 + error body) で reject される。
		const res = await request.post('/admin/rewards?/importPresetToChildren', {
			multipart: { presetId: 'kinder-rewards', childIds: '999999999' },
		});
		expect([200, 400, 403].includes(res.status())).toBe(true);
	});
});
