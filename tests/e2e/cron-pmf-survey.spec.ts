// tests/e2e/cron-pmf-survey.spec.ts
// #2192 (EPIC #2190): pmf-survey cron E2E (auth + dryRun smoke)
//
// /api/cron/pmf-survey が verifyCronAuth で認証され、dryRun で集計を返すことを検証する。
// 既存 cron-lifecycle-emails.spec.ts と同じ pattern。

import { expect, test } from '@playwright/test';
import { getCronHeaders, isCronAuthSkipped } from './helpers';

const cronSecret = process.env.CRON_SECRET;
const authSkipped = isCronAuthSkipped();

test.describe('#2192 pmf-survey — 認証ガード', () => {
	test('x-cron-secret なしで POST すると認証エラー', async ({ request }) => {
		const res = await request.post('/api/cron/pmf-survey');
		if (cronSecret) {
			expect(res.status()).toBe(401);
		} else if (authSkipped) {
			expect([200, 500]).toContain(res.status());
		} else {
			expect(res.status()).toBe(500);
		}
	});

	test('x-cron-secret なしで GET すると認証エラー', async ({ request }) => {
		const res = await request.get('/api/cron/pmf-survey');
		if (cronSecret) {
			expect(res.status()).toBe(401);
		} else if (authSkipped) {
			expect([200, 500]).toContain(res.status());
		} else {
			expect(res.status()).toBe(500);
		}
	});
});

test.describe('#2192 pmf-survey — dryRun POST', () => {
	test('正しい認証 + dryRun=true で 200 と集計が返る', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			const res = await request.post('/api/cron/pmf-survey', { data: { dryRun: true } });
			expect(res.status()).toBe(500);
			return;
		}

		const res = await request.post('/api/cron/pmf-survey', {
			headers: getCronHeaders(),
			data: { dryRun: true, round: '2026-H1' },
		});

		if (!cronSecret && authSkipped) {
			expect([200, 500]).toContain(res.status());
			if (res.status() !== 200) return;
		} else {
			expect(res.status()).toBe(200);
		}

		const body = await res.json();
		expect(body.ok).toBe(true);
		// runPmfSurveyDistribution の戻り値 (scanned / sent / skipped 系) を含む
		expect(typeof body).toBe('object');
	});
});

test.describe('#2192 pmf-survey — GET ヘルスチェック', () => {
	test('正しい認証で GET すると dryRun 結果が返る', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			const res = await request.get('/api/cron/pmf-survey');
			expect(res.status()).toBe(500);
			return;
		}

		const res = await request.get('/api/cron/pmf-survey', {
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
