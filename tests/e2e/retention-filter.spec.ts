// tests/e2e/retention-filter.spec.ts
// #750: データ保持期間フィルタ（retention cleanup）の E2E テスト
//
// /api/cron/retention-cleanup エンドポイントが正しく認証を要求し、
// dryRun モードで件数を返すことを検証する。
//
// NOTE: 認証は x-cron-secret ヘッダーで行う（verifyCronAuth 共通ヘルパー）。
// - CRON_SECRET 設定済み: x-cron-secret ヘッダー必須、不一致で 401
// - CRON_SECRET 未設定 + AUTH_MODE=local: 認証スキップ（ローカル開発用）
// - CRON_SECRET 未設定 + AUTH_MODE≠local: 500 エラー
//
// 実行: npx playwright test retention-filter

import { expect, test } from '@playwright/test';
import { getCronHeaders, isCronAuthSkipped } from './helpers';

const cronSecret = process.env.CRON_SECRET;
const authSkipped = isCronAuthSkipped();

// ============================================================
// 認証ガード
// ============================================================
test.describe('#750 retention-cleanup — 認証ガード', () => {
	test('x-cron-secret ヘッダーなしで POST すると認証エラー（CRON_SECRET 設定時は 401）', async ({
		request,
	}) => {
		const res = await request.post('/api/cron/retention-cleanup');
		if (cronSecret) {
			expect(res.status()).toBe(401);
		} else if (authSkipped) {
			expect([200, 500]).toContain(res.status());
		} else {
			expect(res.status()).toBe(500);
		}
	});

	test('不正な x-cron-secret で POST すると認証エラー', async ({ request }) => {
		const res = await request.post('/api/cron/retention-cleanup', {
			headers: { 'x-cron-secret': 'invalid-token-12345' },
		});
		if (cronSecret) {
			expect(res.status()).toBe(401);
		} else if (authSkipped) {
			expect([200, 500]).toContain(res.status());
		} else {
			expect(res.status()).toBe(500);
		}
	});

	test('x-cron-secret ヘッダーなしで GET すると認証エラー（CRON_SECRET 設定時は 401）', async ({
		request,
	}) => {
		const res = await request.get('/api/cron/retention-cleanup');
		if (cronSecret) {
			expect(res.status()).toBe(401);
		} else if (authSkipped) {
			expect([200, 500]).toContain(res.status());
		} else {
			expect(res.status()).toBe(500);
		}
	});
});

// ============================================================
// dryRun 実行
// ============================================================
test.describe('#750 retention-cleanup — dryRun', () => {
	test('dryRun POST', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			const res = await request.post('/api/cron/retention-cleanup', {
				data: { dryRun: true },
			});
			expect(res.status()).toBe(500);
			return;
		}

		const headers = getCronHeaders();

		const res = await request.post('/api/cron/retention-cleanup', {
			headers,
			data: { dryRun: true },
		});

		if (!cronSecret && authSkipped) {
			expect([200, 500]).toContain(res.status());
			if (res.status() !== 200) return;
		} else {
			expect(res.status()).toBe(200);
		}

		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.dryRun).toBe(true);
		expect(typeof body.tenantsProcessed).toBe('number');
		expect(typeof body.tenantsSkipped).toBe('number');
		expect(typeof body.childrenProcessed).toBe('number');
		expect(typeof body.activityLogsDeleted).toBe('number');
	});

	test('GET ヘルスチェック', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			const res = await request.get('/api/cron/retention-cleanup');
			expect(res.status()).toBe(500);
			return;
		}

		const headers = getCronHeaders();

		const res = await request.get('/api/cron/retention-cleanup', {
			headers,
		});

		if (!cronSecret && authSkipped) {
			expect([200, 500]).toContain(res.status());
			if (res.status() !== 200) return;
		} else {
			expect(res.status()).toBe(200);
		}

		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.dryRun).toBe(true);
	});
});
