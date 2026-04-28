// tests/e2e/survey-pmf.spec.ts
// #1598 (ADR-0023 §5 I7): PMF 判定アンケート (Sean Ellis Test) E2E テスト
//
// 検証範囲:
//   - /api/cron/pmf-survey の認証ガード + dryRun レスポンス
//   - /survey/sean-ellis/<token> 不正トークンで invalid 表示
//
// アンケート回答 → ops/pmf-survey 集計の通しフローは PR #1598 ではトークン生成に
// production env (`OPS_SECRET_KEY`) が必須のため、ユニットテストでカバーする。

import { expect, test } from '@playwright/test';
import { getCronHeaders, isCronAuthSkipped } from './helpers';

const cronSecret = process.env.CRON_SECRET;
const authSkipped = isCronAuthSkipped();

test.describe('#1598 pmf-survey cron — 認証ガード', () => {
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

	test('不正な x-cron-secret で POST すると認証エラー', async ({ request }) => {
		const res = await request.post('/api/cron/pmf-survey', {
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
});

test.describe('#1598 pmf-survey cron — dryRun POST', () => {
	test('正しい認証 + dryRun=true で 200 と集計が返る', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			const res = await request.post('/api/cron/pmf-survey', { data: { dryRun: true } });
			expect(res.status()).toBe(500);
			return;
		}

		const res = await request.post('/api/cron/pmf-survey', {
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
		expect(typeof body.sent).toBe('number');
		expect(typeof body.skippedTenure).toBe('number');
		expect(typeof body.skippedAlreadySent).toBe('number');
		expect(typeof body.skippedRateLimit).toBe('number');
		expect(typeof body.skippedNoOwner).toBe('number');
		expect(typeof body.errors).toBe('number');
		expect(typeof body.round).toBe('string');
		expect(body.round).toMatch(/^\d{4}-H[12]$/);
	});

	test('round 指定があればその round で dryRun', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			const res = await request.post('/api/cron/pmf-survey', {
				data: { dryRun: true, round: '2026-H2' },
			});
			expect(res.status()).toBe(500);
			return;
		}

		const res = await request.post('/api/cron/pmf-survey', {
			headers: getCronHeaders(),
			data: { dryRun: true, round: '2026-H2' },
		});

		if (!cronSecret && authSkipped) {
			expect([200, 500]).toContain(res.status());
			if (res.status() !== 200) return;
		} else {
			expect(res.status()).toBe(200);
		}

		const body = await res.json();
		expect(body.round).toBe('2026-H2');
	});
});

test.describe('#1598 survey UI — 不正トークン', () => {
	test('不正トークンで invalid 画面が表示される', async ({ page }) => {
		await page.goto('/survey/sean-ellis/invalid-token-string');
		await expect(page.getByRole('heading', { name: '無効なリンクです' })).toBeVisible();
	});
});
