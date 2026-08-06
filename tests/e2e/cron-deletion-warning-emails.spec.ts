// tests/e2e/cron-deletion-warning-emails.spec.ts
// #2399: アカウント削除予告メール cron エンドポイントの E2E テスト
//
// /api/cron/deletion-warning-emails が verifyCronAuth で認証され、dryRun で集計を返すことを検証する。
//
// 認証は tests/CLAUDE.md §cron E2E テストの 3 パターン分岐に従う:
// - CRON_SECRET 設定済み: ヘッダ必須、不一致で 401
// - CRON_SECRET 未設定 + AUTH_MODE=local: 認証スキップ
// - CRON_SECRET 未設定 + AUTH_MODE≠local: 500

import { expect, test } from '@playwright/test';
import { getCronHeaders, isCronAuthSkipped } from './helpers';

const cronSecret = process.env.CRON_SECRET;
const authSkipped = isCronAuthSkipped();

test.describe('#2399 deletion-warning-emails — 認証ガード', () => {
	test('x-cron-secret なしで POST すると認証エラー', async ({ request }) => {
		const res = await request.post('/api/cron/deletion-warning-emails');
		if (cronSecret) {
			expect(res.status()).toBe(401);
		} else if (authSkipped) {
			expect([200, 500]).toContain(res.status());
		} else {
			expect(res.status()).toBe(500);
		}
	});

	test('不正な x-cron-secret で POST すると認証エラー', async ({ request }) => {
		const res = await request.post('/api/cron/deletion-warning-emails', {
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
		const res = await request.get('/api/cron/deletion-warning-emails');
		if (cronSecret) {
			expect(res.status()).toBe(401);
		} else if (authSkipped) {
			expect([200, 500]).toContain(res.status());
		} else {
			expect(res.status()).toBe(500);
		}
	});
});

test.describe('#2399 deletion-warning-emails — dryRun POST', () => {
	test('正しい認証 + dryRun=true で 200 と集計が返る', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			const res = await request.post('/api/cron/deletion-warning-emails', {
				data: { dryRun: true },
			});
			expect(res.status()).toBe(500);
			return;
		}

		const res = await request.post('/api/cron/deletion-warning-emails', {
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
		// 持ち越し件数を含む全集計が返る (silent 持ち越し禁止、#3695)
		for (const key of [
			'scanned',
			'sent',
			'skippedNotSoftDeleted',
			'skippedNoThreshold',
			'skippedNotDue',
			'skippedAlreadySent',
			'skippedNoOwner',
			'errors',
			'tenantsRemaining',
		]) {
			expect(typeof body[key]).toBe('number');
		}
	});
});

test.describe('#2399 deletion-warning-emails — GET ヘルスチェック', () => {
	test('正しい認証で GET すると dryRun 結果が返る', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			const res = await request.get('/api/cron/deletion-warning-emails');
			expect(res.status()).toBe(500);
			return;
		}

		const res = await request.get('/api/cron/deletion-warning-emails', {
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
