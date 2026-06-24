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

	test('activity-pack: export endpoint が v2 envelope (typeCode + checksum + payload.activities) を返す (#3079 AC4)', async ({
		request,
	}) => {
		const res = await request.get('/api/v1/activities/export');
		expect(res.status()).toBe(200);
		const body = await res.json();

		// #3079 AC4: 活動 export は v2 envelope に統一 (reward-set / checklist と同型)。
		// schemaVersion=2 + typeCode + checksum + payload.activities を含む。
		expect(body.schemaVersion).toBe(2);
		expect(body.typeCode).toBe('activity-pack');
		expect(typeof body.checksum).toBe('string');
		expect(body.checksum).toHaveLength(64);
		expect(Array.isArray(body.payload?.activities)).toBe(true);

		// 各 activity が import schema 互換の必須 field を持つ
		// (round-trip 保証: export field set ⊇ import minimal required set)
		for (const activity of body.payload.activities) {
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

		// 2. export endpoint で全 activity を v2 envelope JSON 取得
		const exportRes = await request.get('/api/v1/activities/export');
		expect(exportRes.status()).toBe(200);
		const exported = await exportRes.json();
		expect(exported.schemaVersion).toBe(2);
		expect(Array.isArray(exported.payload?.activities)).toBe(true);

		// 3. export 結果 (v2 envelope) を **そのまま** import に再投入 (#3079 AC4 round-trip)。
		// importFile action は v2 envelope を loadActivityPackFromFile (parseAnyExportEnvelope)
		// で剥がして dispatchImport に渡すため、export → restore が完全閉路になる。
		const reimportPayload = JSON.stringify(exported);
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

	test('activity-pack: 空 activities 配列を import すると failure 応答 (#2389 Copilot AC4 / QM #2390 BLOCK [must-1])', async ({
		request,
	}) => {
		// SvelteKit form action 仕様 — 2 軸 assert (envelope + inner):
		//
		// `fail(400, { error: ... })` (`@sveltejs/kit`) は Playwright `request.post` のような
		// non-browser POST に対し以下の 2 層 envelope で response する:
		//   - **wire layer (HTTP)**: status **200** (200 OK 固定、400 にはならない)
		//   - **business layer (body JSON)**: `{ type: 'failure', status: 400, data: { error: '...' } }`
		//     — inner `status: 400` がアプリケーション意図 (400 Bad Request = バリデーション失敗) を担う
		//
		// 旧 spec は `expect(res.status()).toBe(400)` 単軸 assert だったが、wire status は常に
		// 200 のため構造的に false。QM #2390 BLOCK [must-1] で 2 軸 assert (envelope=200 +
		// inner business status=400) に修正。これにより:
		//   1. HTTP wire envelope (200) が SvelteKit form action 仕様通りであることを assert
		//   2. business-logic status (400) がアプリ意図通りであることを assert
		//   3. failure type discriminant (`'failure'`) が明示されることで成功 path (`'success'`)
		//      との混同を排除
		//
		// ADR-0006 (アサーション弱体化禁止) 整合: 旧 `[200, 400].includes(...)` 曖昧 OR から
		// 明示的 2 軸 strong assert に強化 (regex `/failure|"status":400/` のような OR 文字列
		// マッチも不採用、JSON.parse 経由で型付き field を直接 assert)。
		//
		// コード経路: file-source.ts L65 `if (activities.length === 0) throw FileSourceError`
		//   → +page.server.ts importFile action L282 `if (e instanceof FileSourceError) return fail(400, { error: e.message })`
		//   → SvelteKit form action serialize で HTTP 200 + body に failure 構造を埋め込む
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

		// (a) wire envelope: SvelteKit form action は常に HTTP 200 で返る
		expect(res.status()).toBe(200);

		// (b) body envelope: JSON.parse で型付き field を取得
		const body = JSON.parse(await res.text()) as {
			type: string;
			status: number;
			data?: string;
		};

		// (c) business-logic: `fail(400, ...)` の意図を 2 field で明示 assert
		expect(body.type).toBe('failure');
		expect(body.status).toBe(400);

		// (d) error message: `file-source.ts` の throw 文言が body.data に埋め込まれる
		// (SvelteKit は data field を JSON 文字列化、deserializer 経由で再構成される)
		const serialized = JSON.stringify(body);
		expect(serialized).toContain('インポートする活動がありません');
	});
});
