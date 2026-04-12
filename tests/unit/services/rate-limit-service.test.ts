// tests/unit/services/rate-limit-service.test.ts
// #813: ライセンスキー検証レート制限テスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockNotifyIncident = vi.fn();

vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyIncident: mockNotifyIncident,
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { checkLicenseKeyRateLimit, _resetForTest } = await import(
	'$lib/server/services/rate-limit-service'
);

describe('checkLicenseKeyRateLimit', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockNotifyIncident.mockResolvedValue(undefined);
		_resetForTest();
	});

	afterEach(() => {
		_resetForTest();
	});

	it('最初のリクエストは許可される', async () => {
		const result = await checkLicenseKeyRateLimit('192.168.1.1', 'user@example.com', 'signup');
		expect(result.allowed).toBe(true);
	});

	it('IP 上限（10回/分）以内は許可される', async () => {
		const ip = '10.0.0.1';
		for (let i = 0; i < 10; i++) {
			const result = await checkLicenseKeyRateLimit(ip, `user${i}@example.com`, 'signup');
			expect(result.allowed).toBe(true);
		}
	});

	it('IP 上限（10回/分）超過でブロックされる', async () => {
		const ip = '10.0.0.2';
		// 10回は成功
		for (let i = 0; i < 10; i++) {
			await checkLicenseKeyRateLimit(ip, `user${i}@test.com`, 'signup');
		}
		// 11回目はブロック
		const result = await checkLicenseKeyRateLimit(ip, 'user11@test.com', 'signup');
		expect(result.allowed).toBe(false);
		expect(result.retryAfterSec).toBeGreaterThan(0);
		expect(result.message).toContain('試行回数');
	});

	it('email 上限（20回/時）以内は許可される', async () => {
		const email = 'limit-test@example.com';
		for (let i = 0; i < 20; i++) {
			const result = await checkLicenseKeyRateLimit(`192.168.${i}.1`, email, 'signup');
			expect(result.allowed).toBe(true);
		}
	});

	it('email 上限（20回/時）超過でブロックされる', async () => {
		const email = 'brute-force@example.com';
		// 20回は成功（IP は毎回変える）
		for (let i = 0; i < 20; i++) {
			await checkLicenseKeyRateLimit(`10.1.${i}.1`, email, 'signup');
		}
		// 21回目はブロック
		const result = await checkLicenseKeyRateLimit('10.1.21.1', email, 'signup');
		expect(result.allowed).toBe(false);
		expect(result.message).toContain('試行回数');
	});

	it('異なる IP からのリクエストはそれぞれ独立してカウントされる', async () => {
		// IP-A で10回使い切る
		for (let i = 0; i < 10; i++) {
			await checkLicenseKeyRateLimit('1.1.1.1', `a${i}@test.com`, 'signup');
		}
		const blockedA = await checkLicenseKeyRateLimit('1.1.1.1', 'a11@test.com', 'signup');
		expect(blockedA.allowed).toBe(false);

		// IP-B はまだ使える
		const allowedB = await checkLicenseKeyRateLimit('2.2.2.2', 'b@test.com', 'signup');
		expect(allowedB.allowed).toBe(true);
	});

	it('email が空文字の場合は email チェックをスキップする', async () => {
		// IP チェックのみ
		const result = await checkLicenseKeyRateLimit('3.3.3.3', '', 'signup');
		expect(result.allowed).toBe(true);
	});

	it('レート制限超過時に Discord 通知が送信される', async () => {
		mockNotifyIncident.mockResolvedValue(undefined);
		const ip = '10.0.0.3';

		for (let i = 0; i < 10; i++) {
			await checkLicenseKeyRateLimit(ip, `n${i}@test.com`, 'signup');
		}
		// 11回目でブロック + 通知
		await checkLicenseKeyRateLimit(ip, 'n11@test.com', 'signup');
		expect(mockNotifyIncident).toHaveBeenCalledTimes(1);
		expect(mockNotifyIncident).toHaveBeenCalledWith(
			expect.stringContaining('レート制限超過'),
			expect.objectContaining({ path: '/auth/signup' }),
		);
	});

	it('Discord 通知は同じキーに対してクールダウン期間中は重複送信しない', async () => {
		mockNotifyIncident.mockResolvedValue(undefined);
		const ip = '10.0.0.4';

		// 10回消費
		for (let i = 0; i < 10; i++) {
			await checkLicenseKeyRateLimit(ip, `d${i}@test.com`, 'signup');
		}

		// 11回目: 通知あり
		await checkLicenseKeyRateLimit(ip, 'd11@test.com', 'signup');
		expect(mockNotifyIncident).toHaveBeenCalledTimes(1);

		// 12回目: クールダウン中なので通知なし
		await checkLicenseKeyRateLimit(ip, 'd12@test.com', 'signup');
		expect(mockNotifyIncident).toHaveBeenCalledTimes(1);
	});

	it('license-apply アクションの通知パスが /admin/license になる', async () => {
		mockNotifyIncident.mockResolvedValue(undefined);
		const ip = '10.0.0.5';

		for (let i = 0; i < 10; i++) {
			await checkLicenseKeyRateLimit(ip, `l${i}@test.com`, 'license-apply');
		}
		await checkLicenseKeyRateLimit(ip, 'l11@test.com', 'license-apply');

		expect(mockNotifyIncident).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ path: '/admin/license' }),
		);
	});
});
