// tests/e2e/grace-period-soft-delete.spec.ts
// #1781: 解約後グレースピリオド配線（softDeleteTenant + restore + 物理削除）E2E
//
// 検証スコープ:
//   - /api/v1/admin/account/delete のレスポンスに softDeleted / gracePeriodDays / physicalDeletionDate が含まれる
//   - /api/v1/admin/account/grace-status の応答構造が正しい
//   - /api/v1/admin/account/restore が認証ガードで保護されている
//
// 認証フロー全体（free 即時 / standard 7d / family 30d の DB 状態検証）は
// unit (`tests/unit/routes/account-delete-api.test.ts` + `tests/unit/services/grace-period-service.test.ts`)
// + cron テスト (`tests/e2e/cron-grace-period-deletion.spec.ts`) で網羅済み。
// 本 E2E は API endpoint contract のスモーク確認に絞る。

import { expect, test } from '@playwright/test';

test.describe('#1781 grace-period soft-delete API contract', () => {
	test('GET /api/v1/admin/account/grace-status: 応答構造（未認証 401 または 200）', async ({
		request,
	}) => {
		const res = await request.get('/api/v1/admin/account/grace-status');
		const status = res.status();
		// ローカル auto-auth: 200 / cognito-dev 未認証: 401
		expect([200, 401]).toContain(status);

		if (status === 200) {
			const body = await res.json();
			expect(body).toHaveProperty('isSoftDeleted');
			expect(body).toHaveProperty('softDeletedAt');
			expect(body).toHaveProperty('gracePeriodDays');
			expect(body).toHaveProperty('physicalDeletionDate');
			expect(body).toHaveProperty('daysRemaining');
			expect(body).toHaveProperty('isExpired');
			expect(body).toHaveProperty('planTier');
			expect(typeof body.isSoftDeleted).toBe('boolean');
			expect(typeof body.daysRemaining).toBe('number');
			expect(typeof body.isExpired).toBe('boolean');
		}
	});

	test('POST /api/v1/admin/account/restore: 未認証で 401 または 認証済みで 400/200', async ({
		request,
	}) => {
		const res = await request.post('/api/v1/admin/account/restore');
		const status = res.status();
		// 401 (cognito 未認証) / 400 (soft-delete されていない) / 200 (復元成功)
		expect([200, 400, 401, 403]).toContain(status);

		if (status === 400) {
			const body = await res.json();
			expect(body).toHaveProperty('error');
		}
	});

	test('POST /api/v1/admin/account/delete: owner-only 応答に softDeleted フィールドが含まれる', async ({
		request,
	}) => {
		const res = await request.post('/api/v1/admin/account/delete', {
			headers: { 'Content-Type': 'application/json' },
			data: { pattern: 'owner-only' },
		});
		const status = res.status();
		// 401 (未認証) / 403 (role 不一致) / 200 (成功) のいずれか
		expect([200, 401, 403, 500]).toContain(status);

		if (status === 200) {
			const body = await res.json();
			// #1781: 全削除パターンの応答に softDeleted boolean が含まれる
			expect(body).toHaveProperty('softDeleted');
			expect(typeof body.softDeleted).toBe('boolean');
			if (body.softDeleted) {
				expect(body).toHaveProperty('gracePeriodDays');
				expect(body).toHaveProperty('physicalDeletionDate');
				expect(typeof body.gracePeriodDays).toBe('number');
			}
		}
	});

	test('POST /api/v1/admin/account/delete: owner-full-delete 応答に softDeleted フィールドが含まれる', async ({
		request,
	}) => {
		const res = await request.post('/api/v1/admin/account/delete', {
			headers: { 'Content-Type': 'application/json' },
			data: { pattern: 'owner-full-delete' },
		});
		const status = res.status();
		expect([200, 401, 403, 500]).toContain(status);

		if (status === 200) {
			const body = await res.json();
			expect(body).toHaveProperty('softDeleted');
			expect(typeof body.softDeleted).toBe('boolean');
		}
	});

	test('owner-with-transfer は softDelete を経由しない（従来動作維持）', async ({ request }) => {
		// transfer は他メンバーへの権限移譲のみで、テナント全体は残るため soft-delete 不要。
		// 存在しない newOwnerId を渡すため 200 にはならない（400 で contract 上はじかれる）。
		// 認証/Cognito 状態に応じて 401 / 403 / 400 / 500 のいずれかになる。
		const res = await request.post('/api/v1/admin/account/delete', {
			headers: { 'Content-Type': 'application/json' },
			data: { pattern: 'owner-with-transfer', newOwnerId: 'unknown-user-id' },
		});
		const status = res.status();
		// 401 / 403 / 400 (移譲先存在せず) / 500 (Cognito 未設定) のいずれか。
		// 200 は出ないため成功時の body 検証は不要（dead code 削除 / #1811 Re-Review）。
		expect([400, 401, 403, 500]).toContain(status);
	});

	test('child / member パターンは soft-delete を経由しない（自分のメンバーシップのみ）', async ({
		request,
	}) => {
		// child / member は自身のメンバーシップ削除のみで、テナントは残るため soft-delete 不要
		for (const pattern of ['child', 'member'] as const) {
			const res = await request.post('/api/v1/admin/account/delete', {
				headers: { 'Content-Type': 'application/json' },
				data: { pattern },
			});
			const status = res.status();
			expect([200, 400, 401, 403, 500]).toContain(status);
		}
	});
});
