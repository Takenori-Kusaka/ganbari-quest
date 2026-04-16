// tests/e2e/retention-filter.spec.ts
// #750: データ保持期間フィルタ（retention cleanup）の E2E テスト
//
// /api/cron/retention-cleanup エンドポイントが正しく認証を要求し、
// dryRun モードで件数を返すことを検証する。
//
// NOTE: このテストはローカル auth モードでも実行可能。
// CRON_SECRET 環境変数が設定されている場合のみ認証テストが有効。
// 未設定の場合はエンドポイント自体が 404 を返す（正しい挙動）。
//
// 実行: npx playwright test retention-filter

import { expect, test } from '@playwright/test';

// ============================================================
// 認証ガード
// ============================================================
test.describe('#750 retention-cleanup — 認証ガード', () => {
	test('Authorization ヘッダーなしで POST すると 401 または 404', async ({ request }) => {
		const res = await request.post('/api/cron/retention-cleanup');
		// CRON_SECRET 未設定 → 404, 設定済みだが認証なし → 401
		expect([401, 404]).toContain(res.status());
	});

	test('不正な Bearer トークンで POST すると 401 または 404', async ({ request }) => {
		const res = await request.post('/api/cron/retention-cleanup', {
			headers: { Authorization: 'Bearer invalid-token-12345' },
		});
		expect([401, 404]).toContain(res.status());
	});

	test('Authorization ヘッダーなしで GET すると 401 または 404', async ({ request }) => {
		const res = await request.get('/api/cron/retention-cleanup');
		expect([401, 404]).toContain(res.status());
	});
});

// ============================================================
// dryRun 実行（CRON_SECRET 設定時のみ）
// ============================================================
test.describe('#750 retention-cleanup — dryRun', () => {
	const cronSecret = process.env.CRON_SECRET;

	test('CRON_SECRET が設定されている場合、dryRun で正常レスポンスを返す', async ({ request }) => {
		test.skip(!cronSecret, 'CRON_SECRET が未設定のため dryRun テストをスキップ');

		const res = await request.post('/api/cron/retention-cleanup', {
			headers: { Authorization: `Bearer ${cronSecret}` },
			data: { dryRun: true },
		});
		expect(res.status()).toBe(200);

		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.dryRun).toBe(true);
		expect(typeof body.tenantsProcessed).toBe('number');
		expect(typeof body.tenantsSkipped).toBe('number');
		expect(typeof body.childrenProcessed).toBe('number');
		expect(typeof body.activityLogsDeleted).toBe('number');
	});

	test('CRON_SECRET が設定されている場合、GET（dry-run ヘルスチェック）で正常レスポンスを返す', async ({
		request,
	}) => {
		test.skip(!cronSecret, 'CRON_SECRET が未設定のため GET テストをスキップ');

		const res = await request.get('/api/cron/retention-cleanup', {
			headers: { Authorization: `Bearer ${cronSecret}` },
		});
		expect(res.status()).toBe(200);

		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.dryRun).toBe(true);
	});
});
