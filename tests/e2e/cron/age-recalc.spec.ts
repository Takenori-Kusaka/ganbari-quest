// tests/e2e/cron/age-recalc.spec.ts
// #1381: 子供の年齢自動インクリメント cron エンドポイントの E2E テスト
//
// /api/cron/age-recalc エンドポイントが正しく認証を要求し、
// dryRun モードで件数を返すことを検証する。
//
// NOTE: 認証は x-cron-secret ヘッダーで行う（verifyCronAuth 共通ヘルパー）。
// - CRON_SECRET 設定済み: x-cron-secret ヘッダー必須、不一致で 401
// - CRON_SECRET 未設定 + AUTH_MODE=local: 認証スキップ（ローカル開発用）
// - CRON_SECRET 未設定 + AUTH_MODE≠local: 500 エラー
//
// 実行: npx playwright test cron/age-recalc

import { expect, test } from '@playwright/test';
import { getCronHeaders, isCronAuthSkipped } from '../helpers';

const cronSecret = process.env.CRON_SECRET;
const authSkipped = isCronAuthSkipped();

// ============================================================
// 認証ガード
// ============================================================
test.describe('#1381 age-recalc — 認証ガード', () => {
	test('x-cron-secret ヘッダーなしで POST すると認証エラー（CRON_SECRET 設定時は 401）', async ({
		request,
	}) => {
		const res = await request.post('/api/cron/age-recalc');
		if (cronSecret) {
			expect(res.status()).toBe(401);
		} else if (authSkipped) {
			expect([200, 500]).toContain(res.status());
		} else {
			expect(res.status()).toBe(500);
		}
	});

	test('不正な x-cron-secret で POST すると認証エラー', async ({ request }) => {
		const res = await request.post('/api/cron/age-recalc', {
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
		const res = await request.get('/api/cron/age-recalc');
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
test.describe('#1381 age-recalc — dryRun', () => {
	test('dryRun=true で POST するとスキャン件数が返る', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			const res = await request.post('/api/cron/age-recalc', {
				data: { dryRun: true },
			});
			expect(res.status()).toBe(500);
			return;
		}

		const headers = getCronHeaders();

		const res = await request.post('/api/cron/age-recalc', {
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
		expect(typeof body.scanned).toBe('number');
		expect(typeof body.skipped).toBe('number');
		expect(typeof body.updated).toBe('number');
		expect(typeof body.failures).toBe('number');
	});

	test('GET ヘルスチェック（dryRun=true 相当）', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			const res = await request.get('/api/cron/age-recalc');
			expect(res.status()).toBe(500);
			return;
		}

		const headers = getCronHeaders();

		const res = await request.get('/api/cron/age-recalc', {
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

// ============================================================
// dryRun=false 正常系（テスト DB 環境）
// ============================================================
test.describe('#1381 age-recalc — 実行（dryRun=false）', () => {
	test('dryRun=false で POST すると age が更新される（冪等性確認）', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			const res = await request.post('/api/cron/age-recalc', {
				data: { dryRun: false },
			});
			expect(res.status()).toBe(500);
			return;
		}

		const headers = getCronHeaders();

		const res = await request.post('/api/cron/age-recalc', {
			headers,
			data: { dryRun: false },
		});

		if (!cronSecret && authSkipped) {
			expect([200, 500]).toContain(res.status());
			if (res.status() !== 200) return;
		} else {
			expect(res.status()).toBe(200);
		}

		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.dryRun).toBe(false);
		expect(typeof body.scanned).toBe('number');
		expect(typeof body.skipped).toBe('number');
		expect(typeof body.updated).toBe('number');
		expect(typeof body.failures).toBe('number');
		// 更新失敗件数は 0 であること
		expect(body.failures).toBe(0);
	});

	test('2 回連続実行しても failures が 0（冪等性）', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			return; // CRON_SECRET 未設定 + 非 local 環境はスキップ
		}

		const headers = getCronHeaders();

		// 1 回目
		const res1 = await request.post('/api/cron/age-recalc', {
			headers,
			data: { dryRun: false },
		});

		if (!cronSecret && authSkipped) {
			expect([200, 500]).toContain(res1.status());
			if (res1.status() !== 200) return;
		} else {
			expect(res1.status()).toBe(200);
		}

		const body1 = await res1.json();
		expect(body1.ok).toBe(true);
		expect(body1.failures).toBe(0);

		// 2 回目（冪等性確認 — 2 回目は updated=0 が期待値）
		const res2 = await request.post('/api/cron/age-recalc', {
			headers,
			data: { dryRun: false },
		});

		if (!cronSecret && authSkipped) {
			expect([200, 500]).toContain(res2.status());
			if (res2.status() !== 200) return;
		} else {
			expect(res2.status()).toBe(200);
		}

		const body2 = await res2.json();
		expect(body2.ok).toBe(true);
		expect(body2.failures).toBe(0);
		// 2 回目は age の変化がないため updated=0
		expect(body2.updated).toBe(0);
	});
});
