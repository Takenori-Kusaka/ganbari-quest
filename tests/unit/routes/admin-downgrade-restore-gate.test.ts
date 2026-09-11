// tests/unit/routes/admin-downgrade-restore-gate.test.ts
// #4708: POST /api/v1/admin/downgrade-restore は有料プランのときだけ復元する。
// 無料プランのまま復元できると、無料プランの上限で archive した意味が無くなる (上限の素通り)。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolveFullPlanTier = vi.fn();
vi.mock('$lib/server/services/plan-limit-service', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/services/plan-limit-service')>(
		'$lib/server/services/plan-limit-service',
	);
	return {
		...actual,
		resolveFullPlanTier: (...args: unknown[]) => mockResolveFullPlanTier(...args),
	};
});

const mockRestoreArchivedResources = vi.fn();
vi.mock('$lib/server/services/resource-archive-service', () => ({
	restoreArchivedResources: (...args: unknown[]) => mockRestoreArchivedResources(...args),
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

const { POST } = await import('../../../src/routes/api/v1/admin/downgrade-restore/+server');

function event(licenseStatus: string, plan?: string) {
	return {
		locals: { context: { tenantId: 't1', role: 'owner', licenseStatus, plan } },
		// biome-ignore lint/suspicious/noExplicitAny: minimal RequestEvent stub for handler unit test
	} as any;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockRestoreArchivedResources.mockResolvedValue(undefined);
});

describe('#4708 downgrade-restore は有料プランのときだけ復元する', () => {
	it.each(['standard', 'family'] as const)('tier=%s → 復元して 200', async (tier) => {
		mockResolveFullPlanTier.mockResolvedValue(tier);
		const res = await POST(event('active', 'monthly'));
		expect(res.status).toBe(200);
		expect(mockRestoreArchivedResources).toHaveBeenCalledWith('t1');
	});

	it('tier=free → PLAN_LIMIT_EXCEEDED (403) で復元しない', async () => {
		mockResolveFullPlanTier.mockResolvedValue('free');
		const res = await POST(event('none'));
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
		expect(mockRestoreArchivedResources).not.toHaveBeenCalled();
	});
});
