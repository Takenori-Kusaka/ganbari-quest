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

	// #2558 段階3 (PR #2773): admin/checklists 内 in-page UnifiedImportHub browse UI を撤去
	// (DESIGN.md §10 構造的ルール「marketplace 取込はマーケットプレイス画面に一本化」)。
	// 旧期待 (`marketplace-preset-import-event-pool` 等 3 件 button visible) は永続的に意味を失う。
	//
	// 新規期待: `checklists-marketplace-browse-link` 経由で /marketplace?type=checklist へ画面遷移
	// する secondary link が visible (empty state / 運用期到達性、DESIGN.md §10「bulk import
	// bridge ルール」整合)。in-page browse UI が再導入されないことを併せて担保。
	test('/admin/checklists に marketplace browse link visible + in-page browse UI 不出 (二重 UI 不出 trip wire / #2558 段階3)', async ({
		page,
	}) => {
		test.slow();
		await page.goto('/admin/checklists', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('marketplace-import-section')).toBeVisible({ timeout: 30_000 });

		// 副作用 A.1: marketplace への secondary link が配置されている → href = /marketplace?type=checklist
		const browseLink = page.getByTestId('checklists-marketplace-browse-link');
		await expect(browseLink, 'marketplace browse link が visible (運用期到達性)').toBeVisible({
			timeout: 10_000,
		});
		await expect(browseLink).toHaveAttribute('href', '/marketplace?type=checklist');

		// 副作用 A.2: 旧 in-page browse UI (UnifiedImportHub の preset 一覧 button) は撤去済
		// (二重 UI 不出 trip wire)。DESIGN.md §10「marketplace 取込はマーケットプレイス画面に
		// 一本化、admin 内ブラウズ UI 二重管理禁止」明示禁忌。
		await expect(page.getByTestId('marketplace-preset-import-event-pool')).toHaveCount(0);
		await expect(page.getByTestId('marketplace-preset-import-event-school-start')).toHaveCount(0);
		await expect(page.getByTestId('marketplace-preset-import-event-field-trip')).toHaveCount(0);
	});

	test('?/importMarketplace action: 不存在 presetId は fail() で扱われる', async ({ page }) => {
		// /admin/checklists を開いて childId を動的取得 (testChildIds は AUTO_INCREMENT のため固定値不可)。
		// #2558 段階3 (PR #2773) で marketplace-import-section 内から in-page browse UI を撤去したため
		// hidden input は同 section 内には存在しない。template create / edit form 等の任意の
		// childId hidden input から有効値を取得する。
		await page.goto('/admin/checklists', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('marketplace-import-section')).toBeVisible({ timeout: 30_000 });
		const childIdValue = await page.evaluate(() => {
			// admin/checklists は selectedChildId を複数 form の hidden input に展開している
			// (template create form / per-template action form 等)。最初に見つかった有効値を採用。
			const hiddens = document.querySelectorAll<HTMLInputElement>('input[name="childId"]');
			for (const h of Array.from(hiddens)) {
				if (h.value && h.value !== '' && h.value !== 'all') return h.value;
			}
			return '';
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
		// #2558 段階3 (PR #2773): marketplace-import-section 内 hidden input は撤去済のため
		// page 全体の childId hidden input から有効値を取得する (上 test と同 pattern)。
		await page.goto('/admin/checklists', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('marketplace-import-section')).toBeVisible({ timeout: 30_000 });
		const childIdValue = await page.evaluate(() => {
			const hiddens = document.querySelectorAll<HTMLInputElement>('input[name="childId"]');
			for (const h of Array.from(hiddens)) {
				if (h.value && h.value !== '' && h.value !== 'all') return h.value;
			}
			return '';
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
		// Phase 2: marketplace 側 action は childId を持たず admin へ redirect する。
		// childId を一切送らない (CWE-598 整合)。
		// SvelteKit form action は redirect でも HTTP 200 + ActionResult JSON
		// (`{type: 'redirect', status: 303, location: '...'}`) を返す仕様
		// (https://kit.svelte.dev/docs/form-actions#redirects 経由の internal wrap)。
		// よって `status=200` + body に redirect type + location 文字列を assert する。
		const res = await page.request.post('/marketplace/checklist/event-pool?/importChecklist', {
			multipart: {},
			maxRedirects: 0,
		});
		expect(res.status()).toBe(200);
		const body = await res.text();
		// ActionResult JSON 形式で type=redirect + location が admin/checklists?import=event-pool を含む
		// (未ログイン時は /auth/login?redirect=... へ redirect される可能性も許容するため、
		// 「redirect type が返ること + final location が admin/checklists?import= か login redirect か」
		// のいずれかを assert する。本 E2E はログインなし fetch なので /auth/login redirect 経路。)
		expect(body).toContain('"type":"redirect"');
		// childId を含まない (CWE-598 整合の中核 assertion)
		expect(body).not.toContain('childId');
		// admin/checklists?import= OR /auth/login?redirect= のいずれかへ redirect
		const hasAdminRedirect = body.includes('/admin/checklists?import=event-pool');
		const hasLoginRedirect = body.includes(
			'/auth/login?redirect=/marketplace/checklist/event-pool',
		);
		expect(hasAdminRedirect || hasLoginRedirect).toBe(true);
	});
});
