// tests/unit/routes/admin-premium-welcome.test.ts
// #778: PremiumWelcome モーダル表示判定と dismiss アクションのユニットテスト
//
// 検証対象:
//   - load 関数が showPremiumWelcome を planTier × premium_welcome_shown 設定で正しく算出すること
//   - dismissPremiumWelcome アクションが premium_welcome_shown を 'true' に書き込むこと
//
// E2E ではなくユニットテストで担保する理由:
//   ローカル auth モードの E2E は常に plan=family に固定されるため、free / standard /
//   family の分岐を網羅できない。表示判定ロジックは load 内部の純粋な分岐なので、
//   plan-limit-service と settings-repo をモックすればロジック単位で検証可能。

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- モック ---
const mockRequireTenantId = vi.fn();
const mockGetAllChildren = vi.fn();
const mockGetOnboardingProgress = vi.fn();
const mockGetPointBalance = vi.fn();
const mockGetChildStatus = vi.fn();
const mockGetAllChildrenSimpleSummary = vi.fn();
const mockGetSettings = vi.fn();
const mockSetSetting = vi.fn();
const mockFindActiveEvents = vi.fn();
const mockGetMemoryTicketStatus = vi.fn();

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: mockRequireTenantId,
}));

vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: mockGetAllChildren,
}));

vi.mock('$lib/server/services/onboarding-service', () => ({
	getOnboardingProgress: mockGetOnboardingProgress,
	dismissOnboarding: vi.fn(),
}));

vi.mock('$lib/server/services/point-service', () => ({
	getPointBalance: mockGetPointBalance,
}));

vi.mock('$lib/server/services/status-service', () => ({
	getChildStatus: mockGetChildStatus,
}));

vi.mock('$lib/server/services/report-service', () => ({
	getAllChildrenSimpleSummary: mockGetAllChildrenSimpleSummary,
}));

vi.mock('$lib/server/db/settings-repo', () => ({
	getSettings: mockGetSettings,
	setSetting: mockSetSetting,
}));

vi.mock('$lib/server/db/season-event-repo', () => ({
	findActiveEvents: mockFindActiveEvents,
}));

vi.mock('$lib/server/services/seasonal-content-service', () => ({
	getMemoryTicketStatus: mockGetMemoryTicketStatus,
}));

vi.mock('$lib/server/services/plan-limit-service', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/services/plan-limit-service')>(
		'$lib/server/services/plan-limit-service',
	);
	return {
		...actual,
		// isPaidTier は実物の純関数を使う（trial 中も有料扱いされることを保証）
	};
});

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const mod = await import('../../../src/routes/(parent)/admin/+page.server');
const load = mod.load as unknown as (event: {
	locals: App.Locals;
	parent: () => Promise<{ planTier: 'free' | 'standard' | 'family' }>;
}) => Promise<{
	showPremiumWelcome: boolean;
	children: unknown[];
	monthlySummaries: unknown;
	currentMonth: string;
	seasonalInfo: unknown;
	onboarding: unknown;
}>;

const dismissAction = mod.actions.dismissPremiumWelcome as unknown as (event: {
	locals: App.Locals;
}) => Promise<{ dismissed?: boolean; status?: number; data?: { error?: string } }>;

function makeLocals(): App.Locals {
	return {
		context: {
			tenantId: 'tenant-1',
			licenseStatus: 'active',
			plan: 'family-monthly',
		},
	} as unknown as App.Locals;
}

function makeParent(tier: 'free' | 'standard' | 'family') {
	return async () => ({ planTier: tier });
}

describe('/admin page.server — PremiumWelcome 表示制御 (#778)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRequireTenantId.mockReturnValue('tenant-1');
		mockGetAllChildren.mockResolvedValue([]);
		mockGetOnboardingProgress.mockResolvedValue({ completed: true });
		mockGetPointBalance.mockResolvedValue({ balance: 0 });
		mockGetChildStatus.mockResolvedValue({ level: 1, levelTitle: '' });
		mockGetAllChildrenSimpleSummary.mockResolvedValue(new Map());
		mockFindActiveEvents.mockResolvedValue([]);
		mockGetMemoryTicketStatus.mockResolvedValue(null);
		// デフォルトでは premium_welcome_shown は未設定（初回想定）
		mockGetSettings.mockResolvedValue({});
	});

	describe('load: showPremiumWelcome', () => {
		it('free プランでは showPremiumWelcome=false（getSettings も呼ばれない）', async () => {
			const result = await load({
				locals: makeLocals(),
				parent: makeParent('free'),
			});

			expect(result.showPremiumWelcome).toBe(false);
			// premium_welcome_shown のフェッチも発生しない（無料プランは判定不要）
			const premiumLookup = mockGetSettings.mock.calls.some(
				([keys]) => Array.isArray(keys) && keys.includes('premium_welcome_shown'),
			);
			expect(premiumLookup).toBe(false);
		});

		it('standard プラン × 未表示（settings なし） では showPremiumWelcome=true', async () => {
			mockGetSettings.mockImplementation(async (keys: string[]) => {
				if (keys.includes('premium_welcome_shown')) return {};
				return {};
			});

			const result = await load({
				locals: makeLocals(),
				parent: makeParent('standard'),
			});

			expect(result.showPremiumWelcome).toBe(true);
			expect(mockGetSettings).toHaveBeenCalledWith(['premium_welcome_shown'], 'tenant-1');
		});

		it('family プラン × 未表示 では showPremiumWelcome=true', async () => {
			mockGetSettings.mockImplementation(async (keys: string[]) => {
				if (keys.includes('premium_welcome_shown')) return {};
				return {};
			});

			const result = await load({
				locals: makeLocals(),
				parent: makeParent('family'),
			});

			expect(result.showPremiumWelcome).toBe(true);
		});

		it('standard プラン × 既に表示済（true） では showPremiumWelcome=false', async () => {
			mockGetSettings.mockImplementation(async (keys: string[]) => {
				if (keys.includes('premium_welcome_shown')) {
					return { premium_welcome_shown: 'true' };
				}
				return {};
			});

			const result = await load({
				locals: makeLocals(),
				parent: makeParent('standard'),
			});

			expect(result.showPremiumWelcome).toBe(false);
		});

		it('family プラン × 既に表示済（true） では showPremiumWelcome=false', async () => {
			mockGetSettings.mockImplementation(async (keys: string[]) => {
				if (keys.includes('premium_welcome_shown')) {
					return { premium_welcome_shown: 'true' };
				}
				return {};
			});

			const result = await load({
				locals: makeLocals(),
				parent: makeParent('family'),
			});

			expect(result.showPremiumWelcome).toBe(false);
		});

		it('standard プラン × 設定値 "false" でも showPremiumWelcome=true（"true" のみが既読フラグ）', async () => {
			mockGetSettings.mockImplementation(async (keys: string[]) => {
				if (keys.includes('premium_welcome_shown')) {
					return { premium_welcome_shown: 'false' };
				}
				return {};
			});

			const result = await load({
				locals: makeLocals(),
				parent: makeParent('standard'),
			});

			// '!== "true"' 判定なので、'false' でも未読扱い → モーダル表示
			expect(result.showPremiumWelcome).toBe(true);
		});
	});

	describe('dismissPremiumWelcome action', () => {
		it('premium_welcome_shown を "true" に書き込み { dismissed: true } を返す', async () => {
			mockSetSetting.mockResolvedValue(undefined);

			const result = await dismissAction({ locals: makeLocals() });

			expect(mockSetSetting).toHaveBeenCalledWith('premium_welcome_shown', 'true', 'tenant-1');
			expect(result.dismissed).toBe(true);
		});

		it('setSetting が失敗したら 500 を返し dismissed フラグは付かない', async () => {
			mockSetSetting.mockRejectedValue(new Error('DB エラー'));

			const result = await dismissAction({ locals: makeLocals() });

			expect(result.status).toBe(500);
			expect(result.data?.error).toBe('歓迎画面の非表示に失敗しました');
			expect(result.dismissed).toBeUndefined();
		});
	});
});
