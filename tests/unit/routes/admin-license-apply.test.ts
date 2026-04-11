// tests/unit/routes/admin-license-apply.test.ts
// #796: /admin/license の applyLicenseKey action 契約テスト
//
// テスト観点:
// - owner 以外は 403（throw error で落ちる）
// - 空入力は 400 + エラーメッセージ
// - validateLicenseKey が invalid なら 400（consumeLicenseKey は呼ばれない）
// - consumeLicenseKey が ok:false なら 400 + reason 返却
// - consumeLicenseKey 成功時は apply.success=true + plan 返却
// - consumeLicenseKey が throw した場合は 500

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockValidateLicenseKey = vi.fn();
const mockConsumeLicenseKey = vi.fn();
const mockGetLicenseInfo = vi.fn();
const mockGetLoyaltyInfo = vi.fn();
const mockGetAllChildren = vi.fn();
const mockGetTrialStatus = vi.fn();
const mockGetActivities = vi.fn();
const mockStartTrial = vi.fn();

vi.mock('$lib/server/services/license-key-service', () => ({
	validateLicenseKey: (...args: unknown[]) => mockValidateLicenseKey(...args),
	consumeLicenseKey: (...args: unknown[]) => mockConsumeLicenseKey(...args),
}));

vi.mock('$lib/server/services/license-service', () => ({
	getLicenseInfo: (...args: unknown[]) => mockGetLicenseInfo(...args),
}));

vi.mock('$lib/server/services/loyalty-service', () => ({
	getLoyaltyInfo: (...args: unknown[]) => mockGetLoyaltyInfo(...args),
}));

vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: (...args: unknown[]) => mockGetAllChildren(...args),
}));

vi.mock('$lib/server/services/trial-service', () => ({
	getTrialStatus: (...args: unknown[]) => mockGetTrialStatus(...args),
	startTrial: (...args: unknown[]) => mockStartTrial(...args),
}));

vi.mock('$lib/server/services/activity-service', () => ({
	getActivities: (...args: unknown[]) => mockGetActivities(...args),
}));

vi.mock('$lib/server/services/plan-limit-service', () => ({
	getPlanLimits: () => ({ maxActivities: 10, maxChildren: 3, historyRetentionDays: 90 }),
	// #732: admin/license/+page.server.ts は resolveFullPlanTier に移行済み
	resolveFullPlanTier: async () => 'free',
}));

vi.mock('$lib/server/stripe/client', () => ({
	isStripeEnabled: () => false,
}));

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		if (!locals.context?.tenantId) throw new Error('Unauthorized');
		return locals.context.tenantId;
	},
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { actions } = await import('../../../src/routes/(parent)/admin/license/+page.server');

// ---------- Helpers ----------

type Role = 'owner' | 'parent' | 'child';

function createRequest(formValues: Record<string, string>): Request {
	const fd = new FormData();
	for (const [k, v] of Object.entries(formValues)) fd.set(k, v);
	return {
		formData: () => Promise.resolve(fd),
	} as unknown as Request;
}

function createEvent(role: Role, formValues: Record<string, string>, tenantId = 't-test') {
	return {
		request: createRequest(formValues),
		locals: {
			context: { tenantId, role },
		},
	} as unknown as Parameters<NonNullable<typeof actions.applyLicenseKey>>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('POST /admin/license?/applyLicenseKey (#796)', () => {
	it('owner 以外は 403 エラーを投げる', async () => {
		await expect(
			// biome-ignore lint/style/noNonNullAssertion: applyLicenseKey is defined
			actions.applyLicenseKey!(createEvent('parent', { licenseKey: 'GQ-AAAA-BBBB-CCCC' })),
		).rejects.toMatchObject({ status: 403 });
		expect(mockValidateLicenseKey).not.toHaveBeenCalled();
		expect(mockConsumeLicenseKey).not.toHaveBeenCalled();
	});

	it('child ロールも 403 エラー', async () => {
		await expect(
			// biome-ignore lint/style/noNonNullAssertion: applyLicenseKey is defined
			actions.applyLicenseKey!(createEvent('child', { licenseKey: 'GQ-AAAA-BBBB-CCCC' })),
		).rejects.toMatchObject({ status: 403 });
	});

	it('空の licenseKey は 400 + エラーメッセージ', async () => {
		// biome-ignore lint/style/noNonNullAssertion: applyLicenseKey is defined
		const result = await actions.applyLicenseKey!(createEvent('owner', { licenseKey: '' }));
		expect(result).toMatchObject({ status: 400 });
		expect(mockValidateLicenseKey).not.toHaveBeenCalled();
		expect(mockConsumeLicenseKey).not.toHaveBeenCalled();
	});

	it('空白のみの licenseKey は 400', async () => {
		// biome-ignore lint/style/noNonNullAssertion: applyLicenseKey is defined
		const result = await actions.applyLicenseKey!(createEvent('owner', { licenseKey: '   ' }));
		expect(result).toMatchObject({ status: 400 });
	});

	it('validateLicenseKey が invalid なら 400 + reason、consumeLicenseKey は呼ばれない', async () => {
		mockValidateLicenseKey.mockResolvedValueOnce({
			valid: false,
			reason: 'ライセンスキーの形式が不正です',
		});
		// biome-ignore lint/style/noNonNullAssertion: applyLicenseKey is defined
		const result = await actions.applyLicenseKey!(createEvent('owner', { licenseKey: 'INVALID' }));
		expect(result).toMatchObject({ status: 400 });
		expect(mockConsumeLicenseKey).not.toHaveBeenCalled();
	});

	it('consumeLicenseKey が ok:false なら 400 + reason', async () => {
		mockValidateLicenseKey.mockResolvedValueOnce({
			valid: true,
			record: { licenseKey: 'GQ-AAAA-BBBB-CCCC', plan: 'monthly', status: 'active' },
		});
		mockConsumeLicenseKey.mockResolvedValueOnce({
			ok: false,
			reason: 'このライセンスキーは既に使用されています',
		});
		// biome-ignore lint/style/noNonNullAssertion: applyLicenseKey is defined
		const result = await actions.applyLicenseKey!(
			createEvent('owner', { licenseKey: 'GQ-AAAA-BBBB-CCCC' }),
		);
		expect(result).toMatchObject({ status: 400 });
		expect(mockConsumeLicenseKey).toHaveBeenCalledWith('GQ-AAAA-BBBB-CCCC', 't-test');
	});

	it('成功時は apply.success=true + plan 情報を返す', async () => {
		mockValidateLicenseKey.mockResolvedValueOnce({
			valid: true,
			record: { licenseKey: 'GQ-AAAA-BBBB-CCCC', plan: 'monthly', status: 'active' },
		});
		mockConsumeLicenseKey.mockResolvedValueOnce({
			ok: true,
			plan: 'monthly',
			planExpiresAt: '2026-05-11T00:00:00Z',
		});
		// biome-ignore lint/style/noNonNullAssertion: applyLicenseKey is defined
		const result = (await actions.applyLicenseKey!(
			createEvent('owner', { licenseKey: 'GQ-AAAA-BBBB-CCCC' }),
		)) as { apply: { success: boolean; plan: string; planExpiresAt: string } };
		expect(result).toEqual({
			apply: {
				success: true,
				plan: 'monthly',
				planExpiresAt: '2026-05-11T00:00:00Z',
			},
		});
	});

	it('lifetime プランは planExpiresAt=undefined で成功する', async () => {
		mockValidateLicenseKey.mockResolvedValueOnce({
			valid: true,
			record: { licenseKey: 'GQ-AAAA-BBBB-CCCC', plan: 'lifetime', status: 'active' },
		});
		mockConsumeLicenseKey.mockResolvedValueOnce({
			ok: true,
			plan: 'lifetime',
			planExpiresAt: undefined,
		});
		// biome-ignore lint/style/noNonNullAssertion: applyLicenseKey is defined
		const result = (await actions.applyLicenseKey!(
			createEvent('owner', { licenseKey: 'GQ-AAAA-BBBB-CCCC' }),
		)) as { apply: { success: boolean; plan: string } };
		expect(result.apply.success).toBe(true);
		expect(result.apply.plan).toBe('lifetime');
	});

	it('consumeLicenseKey が throw した場合は 500', async () => {
		mockValidateLicenseKey.mockResolvedValueOnce({
			valid: true,
			record: { licenseKey: 'GQ-AAAA-BBBB-CCCC', plan: 'monthly', status: 'active' },
		});
		mockConsumeLicenseKey.mockRejectedValueOnce(new Error('DB connection lost'));
		// biome-ignore lint/style/noNonNullAssertion: applyLicenseKey is defined
		const result = await actions.applyLicenseKey!(
			createEvent('owner', { licenseKey: 'GQ-AAAA-BBBB-CCCC' }),
		);
		expect(result).toMatchObject({ status: 500 });
	});

	it('前後の空白を trim してから validateLicenseKey に渡す', async () => {
		mockValidateLicenseKey.mockResolvedValueOnce({
			valid: true,
			record: { licenseKey: 'GQ-AAAA-BBBB-CCCC', plan: 'monthly', status: 'active' },
		});
		mockConsumeLicenseKey.mockResolvedValueOnce({
			ok: true,
			plan: 'monthly',
			planExpiresAt: '2026-05-11T00:00:00Z',
		});
		// biome-ignore lint/style/noNonNullAssertion: applyLicenseKey is defined
		await actions.applyLicenseKey!(createEvent('owner', { licenseKey: '  GQ-AAAA-BBBB-CCCC  ' }));
		expect(mockValidateLicenseKey).toHaveBeenCalledWith('GQ-AAAA-BBBB-CCCC');
		expect(mockConsumeLicenseKey).toHaveBeenCalledWith('GQ-AAAA-BBBB-CCCC', 't-test');
	});
});
