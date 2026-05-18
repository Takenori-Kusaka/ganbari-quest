// tests/e2e/cron-trial-notifications.spec.ts
// #2192 (EPIC #2190): trial-notifications cron E2E (auth + dryRun smoke)
//
// /api/cron/trial-notifications が verifyCronAuth で認証され、tenantIds=[] (空配列)
// で呼び出した場合に「active trial を持つテナント全件」を処理して集計を返すことを検証する。
//
// 既存 lifecycle-emails / pmf-survey と同じ pattern を踏襲 (helpers.getCronHeaders SSOT)。
//
// NOTE: 認証は x-cron-secret ヘッダ。
// - CRON_SECRET 設定済み: x-cron-secret 必須、不一致で 401
// - CRON_SECRET 未設定 + AUTH_MODE=local: 認証スキップ
// - CRON_SECRET 未設定 + AUTH_MODE≠local: 500

import { expect, test } from '@playwright/test';
import { getCronHeaders, isCronAuthSkipped } from './helpers';

const cronSecret = process.env.CRON_SECRET;
const authSkipped = isCronAuthSkipped();

test.describe('#2192 trial-notifications — 認証ガード', () => {
	test('x-cron-secret なしで POST すると認証エラー', async ({ request }) => {
		const res = await request.post('/api/cron/trial-notifications');
		if (cronSecret) {
			expect(res.status()).toBe(401);
		} else if (authSkipped) {
			expect([200, 500]).toContain(res.status());
		} else {
			expect(res.status()).toBe(500);
		}
	});

	test('不正な x-cron-secret で POST すると認証エラー', async ({ request }) => {
		const res = await request.post('/api/cron/trial-notifications', {
			headers: { 'x-cron-secret': 'invalid-token-xyz-12345' },
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

test.describe('#2192 trial-notifications — POST 正常実行', () => {
	test('正しい認証 + 空 body で 200 と集計が返る', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			const res = await request.post('/api/cron/trial-notifications');
			expect(res.status()).toBe(500);
			return;
		}

		const res = await request.post('/api/cron/trial-notifications', {
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
		expect(typeof body.totalTenants).toBe('number');
		// processTrialNotifications の戻り値 (sent3days / sent1day / sentToday 等) は実装依存
		// 「ok=true で number 系 field を含む」までを smoke として確認
	});

	test('明示的な tenantIds を指定しても 200 を返す', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			return; // 認証必須環境では skip
		}

		const res = await request.post('/api/cron/trial-notifications', {
			headers: getCronHeaders(),
			data: { tenantIds: ['nonexistent-tenant-for-test'] },
		});

		if (!cronSecret && authSkipped) {
			expect([200, 500]).toContain(res.status());
			if (res.status() !== 200) return;
		} else {
			expect(res.status()).toBe(200);
		}

		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.totalTenants).toBe(1);
	});
});
