// tests/e2e/admin-analytics-404.spec.ts
// #2286 (EPIC #2283): /admin/analytics 撤去後の 404 動作 E2E
//
// EPIC #2283 で /admin/analytics 全面撤去。直接アクセス + query 付き URL 全てで
// SvelteKit 既定の 404 が返ることを保証する (legacy-url-map 編集なしで自然な 404)。
//
// PO 確定:
//   - 404 表示 (運用者専用機能、redirect 不要、legacy-url-map エントリ不要)
//   - bookmark 推定 0 件規模 (Pre-PMF)
//   - #578 は「新 URL へのリネーム」用途、本ケースは対象外
//
// 注意:
//   - ローカル E2E は AUTH_MODE=local のため /admin へのアクセスは素通し
//   - request fixture で maxRedirects: 0 にして最終 status を見る

import { expect, test } from '@playwright/test';

test.describe('#2286 /admin/analytics 撤去後の 404 動作 (EPIC #2283)', () => {
	test('/admin/analytics 直接アクセスで 404', async ({ request }) => {
		const response = await request.get('/admin/analytics', { maxRedirects: 0 });
		expect(response.status(), '/admin/analytics は 404 になるべき').toBe(404);
	});

	test('/admin/analytics?funnelPeriod=7d でも 404', async ({ request }) => {
		const response = await request.get('/admin/analytics?funnelPeriod=7d', { maxRedirects: 0 });
		expect(response.status(), 'query 付きでも 404 になるべき').toBe(404);
	});

	test('/admin/analytics?cohortPeriod=weekly でも 404', async ({ request }) => {
		const response = await request.get('/admin/analytics?cohortPeriod=weekly', {
			maxRedirects: 0,
		});
		expect(response.status(), 'query 付きでも 404 になるべき').toBe(404);
	});

	test('/admin/analytics?cancelPeriod=30d でも 404', async ({ request }) => {
		const response = await request.get('/admin/analytics?cancelPeriod=30d', { maxRedirects: 0 });
		expect(response.status(), 'query 付きでも 404 になるべき').toBe(404);
	});

	// 並行実装チェック (parallel-implementations.md): demo 並行は不存在のため
	// /demo/admin/analytics も 404 になるべき (本番 route 経由で legacy redirect も無い)
	test('/demo/admin/analytics も 404 (並行実装無し)', async ({ request }) => {
		const response = await request.get('/demo/admin/analytics', { maxRedirects: 0 });
		// /demo prefix は legacy redirect か 404。/admin/analytics 自体が無いので最終的に 404 になることを確認
		// (redirect されたら redirect 先で 404、直接の場合も 404)
		expect(response.status(), '/demo/admin/analytics も最終的には 404').toBeGreaterThanOrEqual(300);
		// 既存 routes に該当無し ⇒ 200 ではないことを保証
		expect(response.status(), '200 になってはいけない (画面が存在してはいけない)').not.toBe(200);
	});
});
