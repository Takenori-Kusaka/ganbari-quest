// tests/e2e/cron/notification-delivery.spec.ts
// #4706: 通知 / 週次レポート配信 cron の endpoint 契約 E2E。
//
// 本 Issue の欠陥は「設定 UI は保存できるのに送信ジョブがどの runtime にも無い」だった。
// endpoint が実在し、cron 認証を要求し、dryRun で副作用なく走ることを外形で固定する
// (判定ロジックそのものは tests/unit/services/notification-delivery-service.test.ts)。
//
// 認証は x-cron-secret ヘッダー (verifyCronAuth 共通ヘルパー、tests/CLAUDE.md §cron E2E):
// - CRON_SECRET 設定済み: ヘッダー必須、不一致で 401
// - CRON_SECRET 未設定 + AUTH_MODE=local: 認証スキップ
// - CRON_SECRET 未設定 + AUTH_MODE≠local: 500
//
// 実行: npx playwright test cron/notification-delivery

import { expect, test } from '@playwright/test';
import { getCronHeaders, isCronAuthSkipped } from '../helpers';

const cronSecret = process.env.CRON_SECRET;
const authSkipped = isCronAuthSkipped();

const ENDPOINT = '/api/cron/notification-delivery';

test.describe('#4706 notification-delivery — 認証ガード', () => {
	test('x-cron-secret なしで POST すると認証エラー (CRON_SECRET 設定時は 401)', async ({
		request,
	}) => {
		const res = await request.post(ENDPOINT);
		if (cronSecret) {
			expect(res.status()).toBe(401);
		} else if (authSkipped) {
			expect([200, 500]).toContain(res.status());
		} else {
			expect(res.status()).toBe(500);
		}
	});

	test('不正な x-cron-secret で POST すると認証エラー', async ({ request }) => {
		const res = await request.post(ENDPOINT, {
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

test.describe('#4706 notification-delivery — 正常実行', () => {
	test('dryRun で 200 + 集計フィールドを返す (endpoint が実在し配線されている)', async ({
		request,
	}) => {
		if (!cronSecret && !authSkipped) {
			expect((await request.post(ENDPOINT)).status()).toBe(500);
			return;
		}

		const res = await request.post(ENDPOINT, {
			headers: getCronHeaders(),
			data: { dryRun: true },
		});

		if (!cronSecret && authSkipped) {
			expect([200, 500]).toContain(res.status());
			if (res.status() !== 200) return;
		} else {
			expect(res.status()).toBe(200);
		}

		const body = (await res.json()) as {
			ok: boolean;
			dryRun: boolean;
			scanned: number;
			weeklyReportSent: number;
			reminderSent: number;
			streakWarningSent: number;
			tenantsRemaining: number;
		};
		expect(body.ok).toBe(true);
		expect(body.dryRun).toBe(true);
		// 「持ち越しを silent にしない」契約 — 数値として必ず返る
		expect(typeof body.scanned).toBe('number');
		expect(typeof body.tenantsRemaining).toBe('number');
		expect(typeof body.weeklyReportSent).toBe('number');
		expect(typeof body.reminderSent).toBe('number');
		expect(typeof body.streakWarningSent).toBe('number');
	});

	test('GET ヘルスチェックは dryRun 固定で 200 を返す (副作用なし)', async ({ request }) => {
		if (!cronSecret && !authSkipped) {
			expect((await request.get(ENDPOINT)).status()).toBe(500);
			return;
		}

		const res = await request.get(ENDPOINT, { headers: getCronHeaders() });
		if (!cronSecret && authSkipped) {
			expect([200, 500]).toContain(res.status());
			if (res.status() !== 200) return;
		} else {
			expect(res.status()).toBe(200);
		}

		const body = (await res.json()) as { ok: boolean; dryRun: boolean };
		expect(body.ok).toBe(true);
		expect(body.dryRun).toBe(true);
	});
});
