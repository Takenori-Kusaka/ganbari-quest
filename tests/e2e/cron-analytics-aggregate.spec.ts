// tests/e2e/cron-analytics-aggregate.spec.ts
// #1693 (#1639 follow-up): /api/cron/analytics-aggregate 認証 + dryRun 動作の E2E テスト
//
// /api/cron/analytics-aggregate が verifyCronAuth で認証され、dryRun で集計結果を返すことを検証する。
// 既存 cron-lifecycle-emails.spec.ts と同パターン。

import { expect, test } from '@playwright/test';
import { getCronHeaders, isCronAuthSkipped } from './helpers';

const cronSecret = process.env.CRON_SECRET;
const authSkipped = isCronAuthSkipped();

test.describe('#1693 analytics-aggregate — 認証ガード', () => {
	test('x-cron-secret なしで POST すると認証エラー', async ({ request }) => {
		const res = await request.post('/api/cron/analytics-aggregate');
		if (cronSecret) {
			expect(res.status()).toBe(401);
		} else if (authSkipped) {
			expect([200, 500]).toContain(res.status());
		} else {
			expect(res.status()).toBe(500);
		}
	});

	test('不正な x-cron-secret で POST すると認証エラー', async ({ request }) => {
		const res = await request.post('/api/cron/analytics-aggregate', {
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

	test('x-cron-secret なしで GET すると認証エラー', async ({ request }) => {
		const res = await request.get('/api/cron/analytics-aggregate');
		if (cronSecret) {
			expect(res.status()).toBe(401);
		} else if (authSkipped) {
			expect([200, 500]).toContain(res.status());
		} else {
			expect(res.status()).toBe(500);
		}
	});
});

test.describe('#1693 analytics-aggregate — dryRun POST', () => {
	test('正しい認証 + dryRun=true で 200 と集計が返る', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			const res = await request.post('/api/cron/analytics-aggregate', {
				data: { dryRun: true },
			});
			expect(res.status()).toBe(500);
			return;
		}

		const res = await request.post('/api/cron/analytics-aggregate', {
			headers: getCronHeaders(),
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
		expect(typeof body.targetDate).toBe('string');
		expect(body.funnel).toBeDefined();
		expect(typeof body.funnel.written).toBe('boolean');
		expect(body.funnel.written).toBe(false); // dryRun=true なので書込みなし
		expect(typeof body.funnel.uniqueTenantsByEvent).toBe('object');
		expect(body.cancellation).toBeDefined();
		expect(typeof body.cancellation.total30d).toBe('number');
		expect(typeof body.cancellation.total90d).toBe('number');
	});

	test('targetDate 指定で過去日を集計対象にできる', async ({ request }) => {
		if (!cronSecret && !authSkipped) return;

		const res = await request.post('/api/cron/analytics-aggregate', {
			headers: getCronHeaders(),
			data: { dryRun: true, targetDate: '2026-01-15' },
		});

		if (!cronSecret && authSkipped) {
			expect([200, 500]).toContain(res.status());
			if (res.status() !== 200) return;
		} else {
			expect(res.status()).toBe(200);
		}

		const body = await res.json();
		expect(body.targetDate).toBe('2026-01-15');
	});
});

test.describe('#1693 analytics-aggregate — GET ヘルスチェック', () => {
	test('正しい認証で GET すると dryRun 結果が返る', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			const res = await request.get('/api/cron/analytics-aggregate');
			expect(res.status()).toBe(500);
			return;
		}

		const res = await request.get('/api/cron/analytics-aggregate', {
			headers: getCronHeaders(),
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
