// tests/e2e/email-notification-4-types.spec.ts
// #2192 (EPIC #2190): メール通知 4 系統横断 smoke
//
// 4 メール系統 (lifecycle / trial / pmf-survey / weekly-report) の cron API が
// 同一 auth ヘルパ (verifyCronAuth) で守られていることを横断的に検証する。
//
// 個別の dryRun 集計検証は以下 spec で網羅:
//   - tests/e2e/cron-lifecycle-emails.spec.ts (lifecycle)
//   - tests/e2e/cron-trial-notifications.spec.ts (trial)
//   - tests/e2e/cron-pmf-survey.spec.ts (pmf)
//
// 本 spec は「4 系統全てが同じ認証防御を持っている」「未認証で silent fail しない」
// という横断的不変条件を 1 ファイルで担保する (regression detector)。

import { expect, test } from '@playwright/test';
import { getCronHeaders, isCronAuthSkipped } from './helpers';

const cronSecret = process.env.CRON_SECRET;
const authSkipped = isCronAuthSkipped();

const EMAIL_ENDPOINTS = [
	{ name: 'lifecycle-emails', path: '/api/cron/lifecycle-emails', dryRun: true },
	{ name: 'trial-notifications', path: '/api/cron/trial-notifications', dryRun: false },
	{ name: 'pmf-survey', path: '/api/cron/pmf-survey', dryRun: true },
	// weekly-report は /api/v1/admin/weekly-report で別 namespace、body 必須
	{
		name: 'weekly-report',
		path: '/api/v1/admin/weekly-report',
		dryRun: true,
		body: {
			tenantId: 'nonexistent-test-tenant',
			ownerEmail: 'po@example.com',
			children: [],
		},
	},
];

test.describe('#2192 email 4 systems — 横断的 auth ガード', () => {
	for (const ep of EMAIL_ENDPOINTS) {
		test(`${ep.name}: x-cron-secret なしで認証エラー`, async ({ request }) => {
			const res = await request.post(ep.path, {
				data: ep.body ?? {},
			});
			if (cronSecret) {
				expect(res.status()).toBe(401);
			} else if (authSkipped) {
				// local モードでは認証 skip、ただし weekly-report は body 整合で 200/500 両方あり得る
				expect([200, 500]).toContain(res.status());
			} else {
				expect(res.status()).toBe(500);
			}
		});

		test(`${ep.name}: 不正な x-cron-secret で認証エラー`, async ({ request }) => {
			const res = await request.post(ep.path, {
				headers: { 'x-cron-secret': 'invalid-secret-cross-system' },
				data: ep.body ?? {},
			});
			if (cronSecret) {
				expect(res.status()).toBe(401);
			} else if (authSkipped) {
				expect([200, 500]).toContain(res.status());
			} else {
				expect(res.status()).toBe(500);
			}
		});
	}
});

test.describe('#2192 email 4 systems — 横断的 正常実行 smoke', () => {
	for (const ep of EMAIL_ENDPOINTS) {
		test(`${ep.name}: 正しい認証で 200 または 500 で silent fail しない`, async ({ request }) => {
			if (!cronSecret && !authSkipped) {
				const res = await request.post(ep.path, { data: ep.body ?? {} });
				expect(res.status()).toBe(500);
				return;
			}

			const res = await request.post(ep.path, {
				headers: getCronHeaders(),
				data: ep.body ?? (ep.dryRun ? { dryRun: true } : {}),
			});

			// 200 OK or 500 (DB 未初期化等の正当な internal error)
			// 401 / 403 は構造防御の漏れ → 厳密に否定
			expect([200, 500]).toContain(res.status());

			if (res.status() === 200) {
				const body = await res.json();
				// SvelteKit `json()` で返した object である
				expect(typeof body).toBe('object');
				expect(body).not.toBeNull();
			}
		});
	}
});

test.describe('#2192 email 4 systems — content-type 検証', () => {
	test('lifecycle-emails 200 応答は application/json', async ({ request }) => {
		if (!cronSecret && !authSkipped) return;

		const res = await request.post('/api/cron/lifecycle-emails', {
			headers: getCronHeaders(),
			data: { dryRun: true },
		});

		if (res.status() === 200) {
			const ct = res.headers()['content-type'] ?? '';
			expect(ct).toContain('application/json');
		}
	});
});
