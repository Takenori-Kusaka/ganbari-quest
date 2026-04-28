// tests/e2e/cron-lifecycle-emails.spec.ts
// #1601: 期限切れ前リマインド + 休眠復帰メール cron エンドポイントの E2E テスト
//
// /api/cron/lifecycle-emails が verifyCronAuth で認証され、dryRun で集計を返すことを検証する。
//
// NOTE: 認証は x-cron-secret ヘッダ。
// - CRON_SECRET 設定済み: x-cron-secret 必須、不一致で 401
// - CRON_SECRET 未設定 + AUTH_MODE=local: 認証スキップ
// - CRON_SECRET 未設定 + AUTH_MODE≠local: 500

import { expect, test } from '@playwright/test';
import { getCronHeaders, isCronAuthSkipped } from './helpers';

const cronSecret = process.env.CRON_SECRET;
const authSkipped = isCronAuthSkipped();

test.describe('#1601 lifecycle-emails — 認証ガード', () => {
	test('x-cron-secret なしで POST すると認証エラー', async ({ request }) => {
		const res = await request.post('/api/cron/lifecycle-emails');
		if (cronSecret) {
			expect(res.status()).toBe(401);
		} else if (authSkipped) {
			expect([200, 500]).toContain(res.status());
		} else {
			expect(res.status()).toBe(500);
		}
	});

	test('不正な x-cron-secret で POST すると認証エラー', async ({ request }) => {
		const res = await request.post('/api/cron/lifecycle-emails', {
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
		const res = await request.get('/api/cron/lifecycle-emails');
		if (cronSecret) {
			expect(res.status()).toBe(401);
		} else if (authSkipped) {
			expect([200, 500]).toContain(res.status());
		} else {
			expect(res.status()).toBe(500);
		}
	});
});

test.describe('#1601 lifecycle-emails — dryRun POST', () => {
	test('正しい認証 + dryRun=true で 200 と集計が返る', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			const res = await request.post('/api/cron/lifecycle-emails', { data: { dryRun: true } });
			expect(res.status()).toBe(500);
			return;
		}

		const res = await request.post('/api/cron/lifecycle-emails', {
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
		expect(typeof body.scanned).toBe('number');
		expect(typeof body.renewalSent).toBe('number');
		expect(typeof body.dormantSent).toBe('number');
		expect(typeof body.skippedUnsubscribed).toBe('number');
		expect(typeof body.skippedRateLimit).toBe('number');
		expect(typeof body.skippedNoOwner).toBe('number');
		expect(typeof body.skippedAlreadySent).toBe('number');
		expect(typeof body.errors).toBe('number');
	});

	test('ボディなし POST も正常 (dryRun=false 扱い)', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			const res = await request.post('/api/cron/lifecycle-emails');
			expect(res.status()).toBe(500);
			return;
		}

		const res = await request.post('/api/cron/lifecycle-emails', {
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
	});
});

test.describe('#1601 lifecycle-emails — GET ヘルスチェック', () => {
	test('正しい認証で GET すると dryRun 結果が返る', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			const res = await request.get('/api/cron/lifecycle-emails');
			expect(res.status()).toBe(500);
			return;
		}

		const res = await request.get('/api/cron/lifecycle-emails', {
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
