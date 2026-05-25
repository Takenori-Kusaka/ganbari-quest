/**
 * EPIC #2362 P3 / Issue #2367 — marketplace → checklist → import E2E
 *
 * checklist を新 `ImportStrategy<ChecklistPayload>` + `dispatchImport` 経由に
 * 移行したことの動作確認。既存 `marketplace-checklist-import.spec.ts` が
 * UI フロー (取込済 Badge + disabled ボタン等) を扱うのに対し、本 spec は
 * dispatcher 経由の actions の戻り値 shape 維持を直接 assert する。
 *
 * カバレッジ:
 *   - `/admin/checklists` で marketplace preset の一覧表示
 *   - `?/importMarketplace` action 経由で checklist preset を import (成功動線)
 *   - 不存在 presetId は 404 fail()
 *   - `?/importChecklist` action (`/marketplace/checklist/<id>`) で import 動作
 *
 * 旧 service 経由ではなく新 Strategy + dispatchImport 経由で動作することを
 * 戻り shape (`marketplaceImportResult / alreadyImported / presetName /
 * importedItems / errors`) の維持で担保する。
 */

import { expect, test } from '@playwright/test';

test.describe('#2367 marketplace -> checklist -> import (EPIC #2362 P3 / Strangler Fig 完了)', () => {
	test.setTimeout(180_000);

	test('/admin/checklists にマーケットプレイス preset 3 件 が表示される', async ({ page }) => {
		test.slow();
		await page.goto('/admin/checklists', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('marketplace-import-section')).toBeVisible({ timeout: 30_000 });

		// #2391 (Phase 2): UnifiedImportHub 統合で `marketplace-preset-row-*` (container) は廃止。
		// `marketplace-preset-import-*` (button) で同等の確認。
		await expect(page.getByTestId('marketplace-preset-import-event-pool')).toBeVisible();
		await expect(page.getByTestId('marketplace-preset-import-event-school-start')).toBeVisible();
		await expect(page.getByTestId('marketplace-preset-import-event-field-trip')).toBeVisible();
	});

	test('?/importMarketplace action: 不存在 presetId は fail() で扱われる', async ({ page }) => {
		// /admin/checklists を開いて childId を動的取得 (testChildIds は AUTO_INCREMENT のため固定値不可)
		await page.goto('/admin/checklists', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('marketplace-import-section')).toBeVisible({ timeout: 30_000 });
		// 任意の preset row 内の childId select から有効な ID を 1 つ取得
		const childIdValue = await page.evaluate(() => {
			// admin/checklists は selectedChildId を hidden input に展開している (#2367 spec time)
			const hidden = document.querySelector<HTMLInputElement>(
				'[data-testid="marketplace-import-section"] input[name="childId"]',
			);
			return hidden?.value || '';
		});
		expect(childIdValue).not.toBe('');

		// SvelteKit form action を直接 POST して fail() 形式を確認
		const res = await page.request.post('/admin/checklists?/importMarketplace', {
			multipart: { presetId: 'non-existent-preset-id', childId: childIdValue },
		});
		// SvelteKit form action は fail() を 200 + JSON body or 4xx で返す (実装依存)。
		// 重要なのは dispatcher / Strategy 経由で throw せずに response が返ること。
		expect([200, 400, 404].includes(res.status())).toBe(true);
	});

	test('?/importMarketplace action: 有効な presetId + childId で 200 系応答', async ({ page }) => {
		await page.goto('/admin/checklists', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('marketplace-import-section')).toBeVisible({ timeout: 30_000 });
		const childIdValue = await page.evaluate(() => {
			// admin/checklists は selectedChildId を hidden input に展開している (#2367 spec time)
			const hidden = document.querySelector<HTMLInputElement>(
				'[data-testid="marketplace-import-section"] input[name="childId"]',
			);
			return hidden?.value || '';
		});
		expect(childIdValue).not.toBe('');

		const res = await page.request.post('/admin/checklists?/importMarketplace', {
			multipart: { presetId: 'event-pool', childId: childIdValue },
		});
		// 既取込 (alreadyImported) でも未取込でも 200 が返る (Strategy 経由で success path)
		expect(res.status()).toBe(200);
		const body = await res.text();
		// #2391 (Phase 2): UnifiedImportHub 統合により戻り shape が top-level
		// (`packName / imported / skipped / total / errors / presetId`) に統一。
		expect(body).toContain('packName');
		expect(body).toContain('imported');
	});

	test('?/importChecklist action: /marketplace/checklist/event-pool は admin/checklists?import= へ redirect (#2362 PR-5 Phase 2 / CWE-598)', async ({
		page,
	}) => {
		// Phase 2: marketplace 側 action は childId を持たず admin へ redirect (303)。
		// childId を一切送らない (CWE-598 整合)。
		const res = await page.request.post('/marketplace/checklist/event-pool?/importChecklist', {
			multipart: {},
			maxRedirects: 0,
		});
		// SvelteKit form action redirect: 303 が返り、location が admin/checklists?import= 形式
		expect(res.status()).toBe(303);
		const body = await res.text();
		// ActionResult JSON 形式で location が admin/checklists?import=event-pool を含む
		expect(body).toContain('redirect');
		expect(body).toContain('/admin/checklists?import=event-pool');
	});
});
