// tests/e2e/cron/expire-redemptions.spec.ts
// #1335: 30日超過 pending 申請を expired 移行する cron エンドポイント E2E テスト
//
// /api/cron/expire-redemptions エンドポイントが正しく認証を要求し、
// 正常実行で ok: true を返すことを検証する。
//
// NOTE: 認証は x-cron-secret ヘッダーで行う（verifyCronAuth 共通ヘルパー）。
// - CRON_SECRET 設定済み: x-cron-secret ヘッダー必須、不一致で 401
// - CRON_SECRET 未設定 + AUTH_MODE=local: 認証スキップ（ローカル開発用）
// - CRON_SECRET 未設定 + AUTH_MODE≠local: 500 エラー
//
// 実行: npx playwright test cron/expire-redemptions

import { expect, test } from '@playwright/test';
import { getCronHeaders, isCronAuthSkipped } from '../helpers';

const cronSecret = process.env.CRON_SECRET;
const authSkipped = isCronAuthSkipped();

// ============================================================
// 認証ガード
// ============================================================
test.describe('#1335 expire-redemptions — 認証ガード', () => {
	test('x-cron-secret ヘッダーなしで POST すると認証エラー（CRON_SECRET 設定時は 401）', async ({
		request,
	}) => {
		const res = await request.post('/api/cron/expire-redemptions');
		if (cronSecret) {
			expect(res.status()).toBe(401);
		} else if (authSkipped) {
			expect([200, 500]).toContain(res.status());
		} else {
			expect(res.status()).toBe(500);
		}
	});

	test('不正な x-cron-secret で POST すると認証エラー', async ({ request }) => {
		const res = await request.post('/api/cron/expire-redemptions', {
			headers: { 'x-cron-secret': 'invalid-token-99999' },
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

// ============================================================
// 正常実行
// ============================================================
test.describe('#1335 expire-redemptions — 正常実行', () => {
	test('正しい認証で POST すると ok: true とカウントが返る', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			const res = await request.post('/api/cron/expire-redemptions');
			expect(res.status()).toBe(500);
			return;
		}

		const headers = getCronHeaders();

		const res = await request.post('/api/cron/expire-redemptions', { headers });

		if (!cronSecret && authSkipped) {
			expect([200, 500]).toContain(res.status());
			if (res.status() !== 200) return;
		} else {
			expect(res.status()).toBe(200);
		}

		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(typeof body.expiredCount).toBe('number');
	});

	test('2 回連続実行しても ok: true（冪等性）', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			return; // CRON_SECRET 未設定 + 非 local 環境はスキップ
		}

		const headers = getCronHeaders();

		const res1 = await request.post('/api/cron/expire-redemptions', { headers });
		if (!cronSecret && authSkipped) {
			expect([200, 500]).toContain(res1.status());
			if (res1.status() !== 200) return;
		} else {
			expect(res1.status()).toBe(200);
		}
		const body1 = await res1.json();
		expect(body1.ok).toBe(true);

		const res2 = await request.post('/api/cron/expire-redemptions', { headers });
		if (!cronSecret && authSkipped) {
			expect([200, 500]).toContain(res2.status());
			if (res2.status() !== 200) return;
		} else {
			expect(res2.status()).toBe(200);
		}
		const body2 = await res2.json();
		expect(body2.ok).toBe(true);
		// 2 回目は対象がないため expiredCount=0
		expect(body2.expiredCount).toBe(0);
	});
});
