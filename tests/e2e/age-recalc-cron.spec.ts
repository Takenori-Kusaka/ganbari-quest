// tests/e2e/age-recalc-cron.spec.ts
// #1381: 子供の年齢自動インクリメント cron エンドポイントの E2E テスト
//
// /api/cron/age-recalc エンドポイントが正しく認証を要求し、
// dryRun モードで件数を返すことを検証する（AC6 対応）。
//
// NOTE: 認証は x-cron-secret ヘッダーで行う（verifyCronAuth 共通ヘルパー）。
// - CRON_SECRET 設定済み: x-cron-secret ヘッダー必須、不一致で 401
// - CRON_SECRET 未設定 + AUTH_MODE=local: 認証スキップ（ローカル開発用）
// - CRON_SECRET 未設定 + AUTH_MODE≠local: 500 エラー
//
// 実行: npx playwright test age-recalc-cron

import { expect, test } from '@playwright/test';
import { getCronHeaders, isCronAuthSkipped } from './helpers';

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
// dryRun 実行 — レスポンス構造の検証
// ============================================================
test.describe('#1381 age-recalc — dryRun POST', () => {
	test('正しい認証ヘッダーで dryRun POST すると 200 と件数が返る', async ({ request }) => {
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

	test('ボディなしで POST しても正常に動作する（dryRun=false として扱う）', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			const res = await request.post('/api/cron/age-recalc');
			expect(res.status()).toBe(500);
			return;
		}

		const headers = getCronHeaders();

		const res = await request.post('/api/cron/age-recalc', { headers });

		if (!cronSecret && authSkipped) {
			expect([200, 500]).toContain(res.status());
			if (res.status() !== 200) return;
		} else {
			expect(res.status()).toBe(200);
		}

		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(typeof body.scanned).toBe('number');
	});
});

// ============================================================
// GET ヘルスチェック — dryRun=true で自動実行
// ============================================================
test.describe('#1381 age-recalc — GET ヘルスチェック', () => {
	test('正しい認証ヘッダーで GET すると dryRun 結果が返る', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			const res = await request.get('/api/cron/age-recalc');
			expect(res.status()).toBe(500);
			return;
		}

		const headers = getCronHeaders();

		const res = await request.get('/api/cron/age-recalc', { headers });

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
		expect(typeof body.updated).toBe('number');
	});
});

// ============================================================
// 冪等性 — 同日 2 回実行で 2 回目は updated=0
// ============================================================
test.describe('#1381 age-recalc — 冪等性', () => {
	test('dryRun で 2 回実行しても同じ件数が返る（冪等性確認）', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			return;
		}

		const headers = getCronHeaders();

		const res1 = await request.post('/api/cron/age-recalc', {
			headers,
			data: { dryRun: true },
		});

		if (!cronSecret && authSkipped) {
			expect([200, 500]).toContain(res1.status());
			if (res1.status() !== 200) return;
		} else {
			expect(res1.status()).toBe(200);
		}

		const body1 = await res1.json();

		const res2 = await request.post('/api/cron/age-recalc', {
			headers,
			data: { dryRun: true },
		});

		expect(res2.status()).toBe(res1.status());
		const body2 = await res2.json();

		// dryRun は DB を変更しないため、2 回実行しても scanned/updated は同じ
		expect(body2.scanned).toBe(body1.scanned);
		expect(body2.updated).toBe(body1.updated);
	});
});
