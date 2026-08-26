// tests/unit/routes/admin-layout-archive-trigger.test.ts
// #4585-2: `(parent)/admin/+layout.server.ts` が上限超過リソースの自動アーカイブを
// **どの状態で起動するか** の回帰。
//
// 旧実装は `trialUsed && !isTrialActive` を条件にしていたため、体験を経ずに直接課金した顧客が
// 解約して無料プランに戻っても永久に発火しなかった (#4585 ①)。#4603 が解約画面で
// 「選ばずに進めた場合はこう残ります」と提示した fallback が、その顧客には起きない状態だった。
//
// 判定そのものの網羅は `tests/unit/domain/free-plan-reversion.test.ts` が持つ。本 test は
// **layout が実際にその判定で archive を呼ぶ / 呼ばない**という配線を固定する。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';

const mockResolveFullPlanTier = vi.fn();
const mockArchiveExcessResources = vi.fn();
const mockGetArchivedResourceSummary = vi.fn();
const mockGetTrialStatus = vi.fn();

vi.mock('$lib/server/services/plan-limit-service', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/services/plan-limit-service')>(
		'$lib/server/services/plan-limit-service',
	);
	return {
		...actual,
		resolveFullPlanTier: (...args: unknown[]) => mockResolveFullPlanTier(...args),
	};
});

vi.mock('$lib/server/services/resource-archive-service', () => ({
	archiveExcessResources: (...args: unknown[]) => mockArchiveExcessResources(...args),
	getArchivedResourceSummary: (...args: unknown[]) => mockGetArchivedResourceSummary(...args),
}));

vi.mock('$lib/server/services/trial-service', () => ({
	getTrialStatus: (...args: unknown[]) => mockGetTrialStatus(...args),
}));

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		if (!locals.context?.tenantId) throw new Error('Unauthorized');
		return locals.context.tenantId;
	},
	getAuthMode: vi.fn(() => 'cognito'),
	// cognito-dev モード = 親 PIN gate 無効。本 test の関心は archive 起動条件のみ。
	isCognitoDevMode: vi.fn(() => true),
}));

vi.mock('$lib/server/db/settings-repo', () => ({
	getSettings: vi.fn().mockResolvedValue({}),
}));

vi.mock('$lib/server/services/grace-period-service', () => ({
	getGracePeriodStatus: vi.fn().mockResolvedValue(null),
}));

vi.mock('$lib/server/services/onboarding-service', () => ({
	getOnboardingProgress: vi.fn().mockResolvedValue(null),
}));

vi.mock('$lib/server/debug-plan', () => ({
	getDebugPlanSummary: vi.fn(() => null),
}));

vi.mock('$lib/server/stripe/client', () => ({
	isStripeEnabled: vi.fn(() => true),
}));

const { load } = await import('../../../src/routes/(parent)/admin/+layout.server');

const TENANT = 'tenant-4585';

function makeEvent(context: Record<string, unknown>) {
	return {
		locals: {
			context: { tenantId: TENANT, role: 'owner', ...context },
			runtimeMode: 'aws-prod',
		},
		cookies: {
			get: vi.fn(() => undefined),
			set: vi.fn(),
			delete: vi.fn(),
		},
		url: new URL('https://example.test/admin'),
		// biome-ignore lint/suspicious/noExplicitAny: SvelteKit の LayoutServerLoadEvent を最小構成で満たす
	} as any;
}

/** 体験を一度も使っていない (= 直接課金した顧客) */
function neverTrialed() {
	mockGetTrialStatus.mockResolvedValue({
		isTrialActive: false,
		trialUsed: false,
		trialStartDate: null,
		trialEndDate: null,
		trialTier: null,
		daysRemaining: 0,
		source: null,
	});
}

describe('(parent)/admin/+layout.server.ts — 上限超過リソースの自動アーカイブ起動 (#4585-2)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockResolveFullPlanTier.mockResolvedValue('free');
		mockArchiveExcessResources.mockResolvedValue({
			archivedChildIds: [],
			archivedActivityIds: [],
			archivedChecklistTemplateIds: [],
		});
		mockGetArchivedResourceSummary.mockResolvedValue({
			archivedChildCount: 2,
			hasArchivedResources: true,
		});
	});

	it('体験を使わず直接課金した顧客が解約 (S5) して無料プランに戻ると archive が発火する', async () => {
		neverTrialed();

		await load(
			makeEvent({
				licenseStatus: 'none',
				tenantStatus: SUBSCRIPTION_STATUS.SUSPENDED,
				plan: null,
				stripeSubscriptionId: null,
			}),
		);

		expect(mockArchiveExcessResources).toHaveBeenCalledWith(TENANT);
	});

	it('解約済みの顧客に archive 済みサマリを配布する (告知だけ体験基準に取り残さない)', async () => {
		neverTrialed();

		const result = await load(
			makeEvent({
				licenseStatus: 'none',
				tenantStatus: SUBSCRIPTION_STATUS.SUSPENDED,
				stripeSubscriptionId: null,
			}),
		);

		expect(result).toMatchObject({
			archivedSummary: { archivedChildCount: 2, hasArchivedResources: true },
		});
	});

	it('S4 停止 (契約が残り復帰しうる) では archive を発火しない', async () => {
		neverTrialed();

		await load(
			makeEvent({
				licenseStatus: 'suspended',
				tenantStatus: SUBSCRIPTION_STATUS.SUSPENDED,
				plan: 'standard_monthly',
				stripeSubscriptionId: 'sub_unpaid',
			}),
		);

		expect(mockArchiveExcessResources).not.toHaveBeenCalled();
	});

	it('S1 未課金のまま (体験も契約も無い) では archive を発火しない', async () => {
		neverTrialed();

		await load(
			makeEvent({
				licenseStatus: 'none',
				tenantStatus: SUBSCRIPTION_STATUS.ACTIVE,
				stripeSubscriptionId: null,
			}),
		);

		expect(mockArchiveExcessResources).not.toHaveBeenCalled();
	});

	it('体験終了で無料プランに戻った従来経路でも発火し続ける', async () => {
		mockGetTrialStatus.mockResolvedValue({
			isTrialActive: false,
			trialUsed: true,
			trialStartDate: '2026-07-01',
			trialEndDate: '2026-07-08',
			trialTier: 'standard',
			daysRemaining: 0,
			source: 'user_initiated',
		});

		await load(
			makeEvent({
				licenseStatus: 'none',
				tenantStatus: SUBSCRIPTION_STATUS.ACTIVE,
				stripeSubscriptionId: null,
			}),
		);

		expect(mockArchiveExcessResources).toHaveBeenCalledWith(TENANT);
	});
});
