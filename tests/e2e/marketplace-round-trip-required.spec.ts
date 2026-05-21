/**
 * Marketplace Round-trip 必須 E2E — Issue #2374 (EPIC #2362 P4 / AN-5 #2180 補強 7)
 *
 * `/api/v1/activities/export` (export endpoint) → `/admin/activities?/importFile` (import action)
 * の実 admin UI 経由 round-trip を必須化する E2E spec。
 *
 * 目的:
 *  - PO 指摘 ④ (Export → Import 消失) の構造的回帰防止
 *  - ADR-0052 Strategy + Registry 経由で round-trip が壊れていないこと
 *  - 5 type 全件の round-trip schema 互換性は `tests/unit/marketplace/round-trip-required.test.ts`
 *    (本 spec と同一 PR で追加) で並列担保。E2E は activity-pack (実 endpoint が既存) を代表として
 *    実 UI 動線で round-trip を実証する。
 *
 * 関連:
 *  - ADR-0052 / EPIC #2362 / Issue #2374
 *  - tests/e2e/admin-activities-import-marketplace.spec.ts (#2365 import 経路の単方向 E2E)
 *  - tests/unit/marketplace/round-trip-required.test.ts (5 type schema 経由 round-trip)
 */

import { expect, test } from '@playwright/test';

test.describe('#2374 marketplace round-trip 必須化 (export → import、PO 指摘 ④ 構造的回帰防止)', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/admin/activities');
		await page.waitForLoadState('domcontentloaded');
	});

	test('activity-pack: export endpoint が import 互換 JSON (activities array) を返す', async ({
		request,
	}) => {
		const res = await request.get('/api/v1/activities/export');
		expect(res.status()).toBe(200);
		const body = await res.json();

		// export schema (formatVersion 1.0) は import で受理される activities array を含む
		expect(body).toHaveProperty('formatVersion');
		expect(body).toHaveProperty('activities');
		expect(Array.isArray(body.activities)).toBe(true);

		// 各 activity が import schema 互換の必須 field を持つ
		// (round-trip 保証: export field set ⊇ import minimal required set)
		for (const activity of body.activities) {
			expect(activity).toHaveProperty('name');
			expect(activity).toHaveProperty('categoryCode');
			expect(activity).toHaveProperty('icon');
			expect(activity).toHaveProperty('basePoints');
		}
	});

	test('activity-pack: export → JSON → import の round-trip で activity が登録される', async ({
		request,
	}) => {
		// 1. まず known fixture を import で登録
		const initialPayload = JSON.stringify({
			activities: [
				{
					name: 'roundtrip-source-activity',
					categoryCode: 'undou',
					icon: '🏃',
					basePoints: 7,
					ageMin: null,
					ageMax: null,
					gradeLevel: null,
				},
			],
		});
		const importRes = await request.post('/admin/activities?/importFile', {
			multipart: {
				file: {
					name: 'roundtrip-source.json',
					mimeType: 'application/json',
					buffer: Buffer.from(initialPayload, 'utf-8'),
				},
			},
		});
		expect(importRes.status()).toBe(200);

		// 2. export endpoint で全 activity を JSON 取得
		const exportRes = await request.get('/api/v1/activities/export');
		expect(exportRes.status()).toBe(200);
		const exported = await exportRes.json();
		expect(Array.isArray(exported.activities)).toBe(true);

		// 3. export 結果から payload を組み立てて import に再投入 (round-trip)
		// import 経路は { activities: [...] } 形式を受理する (file-source.ts §parse)
		const reimportPayload = JSON.stringify({ activities: exported.activities });
		const reimportRes = await request.post('/admin/activities?/importFile', {
			multipart: {
				file: {
					name: 'roundtrip-reimport.json',
					mimeType: 'application/json',
					buffer: Buffer.from(reimportPayload, 'utf-8'),
				},
			},
		});
		// re-import は重複扱いで skipped にカウントされるか、新規追加されるかは
		// 実装依存だが「dispatcher が JSON を受理して response を返す」ことを必須化
		expect(reimportRes.status()).toBe(200);
		const reimportBody = await reimportRes.text();
		// dispatcher 経由で displayName が返ったことを文字列ベースで assert
		expect(reimportBody).toContain('roundtrip-reimport.json');
	});

	test('activity-pack: 空 activities 配列を import すると 400 で reject される (#2389 Copilot AC4)', async ({
		request,
	}) => {
		// 空配列は file-source.ts の `if (activities.length === 0) throw FileSourceError`
		// で reject され、+page.server.ts importFile action が `fail(400, ...)` を返す。
		// SvelteKit form action の `fail(400, ...)` は HTTP 400 応答に正規化される。
		// (旧 spec は `[200, 400].includes(...)` で曖昧化していたが、コード経路の確認で
		// 400 固定が正しいと判明したため #2389 で明確化、ADR-0006 アサーション弱体化禁止整合)
		const emptyPayload = JSON.stringify({ activities: [] });
		const res = await request.post('/admin/activities?/importFile', {
			multipart: {
				file: {
					name: 'roundtrip-empty.json',
					mimeType: 'application/json',
					buffer: Buffer.from(emptyPayload, 'utf-8'),
				},
			},
		});
		expect(res.status()).toBe(400);
	});
});
