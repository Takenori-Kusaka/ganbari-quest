// tests/unit/routes/admin-messages-send.test.ts
// #772: /admin/messages?/send action の自由テキストプランゲートテスト
//
// テスト観点:
// - free プランで text メッセージを送ると 403（ファミリー限定エラー）
// - standard プランで text メッセージを送ると 403（ファミリー限定エラー）
// - family プランなら text メッセージを送信できる
// - stamp メッセージはプランに関係なく送信できる（ゲートされない）
// - messageType バリデーション / body 必須などの基本バリデーション

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- mocks ----------

const mockResolveFullPlanTier = vi.fn();
const mockGetPlanLimits = vi.fn();
vi.mock('$lib/server/services/plan-limit-service', () => ({
	resolveFullPlanTier: (...args: unknown[]) => mockResolveFullPlanTier(...args),
	getPlanLimits: (...args: unknown[]) => mockGetPlanLimits(...args),
}));

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		if (!locals.context?.tenantId) throw new Error('Unauthorized');
		return locals.context.tenantId;
	},
}));

const mockSendMessage = vi.fn();
const mockGetMessageHistory = vi.fn();
vi.mock('$lib/server/services/message-service', () => ({
	sendMessage: (...args: unknown[]) => mockSendMessage(...args),
	getMessageHistory: (...args: unknown[]) => mockGetMessageHistory(...args),
	STAMP_PRESETS: [],
}));

vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: vi.fn(),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { actions } = await import('../../../src/routes/(parent)/admin/messages/+page.server');

// ---------- helpers ----------

type PlanTier = 'free' | 'standard' | 'family';

function createRequest(formValues: Record<string, string>): Request {
	const fd = new FormData();
	for (const [k, v] of Object.entries(formValues)) fd.set(k, v);
	return {
		formData: () => Promise.resolve(fd),
	} as unknown as Request;
}

function createEvent(tier: PlanTier, formValues: Record<string, string>, tenantId = 't-test') {
	mockResolveFullPlanTier.mockResolvedValue(tier);
	mockGetPlanLimits.mockImplementation((t: PlanTier) => ({
		maxChildren: null,
		maxActivities: null,
		historyRetentionDays: null,
		canExport: t !== 'free',
		canFreeTextMessage: t === 'family',
		canCustomReward: t !== 'free',
		canSiblingRanking: t === 'family',
		maxCloudExports: 0,
	}));
	return {
		request: createRequest(formValues),
		locals: {
			context: { tenantId, licenseStatus: tier === 'free' ? 'none' : 'active', plan: tier },
		},
	} as unknown as Parameters<NonNullable<typeof actions.send>>[0];
}

// ---------- tests ----------

describe('POST /admin/messages?/send (#772)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSendMessage.mockResolvedValue({ id: 1, childId: 1, messageType: 'text', body: 'ok' });
	});

	it('free プランで text メッセージを送ると 403（ファミリー限定、PlanLimitError 形式）', async () => {
		// #787: エラー形式は PlanLimitError オブジェクト
		// biome-ignore lint/style/noNonNullAssertion: send is defined
		const result = await actions.send!(
			createEvent('free', {
				childId: '1',
				messageType: 'text',
				body: 'がんばったね',
			}),
		);
		expect(result).toMatchObject({
			status: 403,
			data: {
				error: {
					code: 'PLAN_LIMIT_EXCEEDED',
					message: '自由テキストメッセージはファミリープラン限定です',
					currentTier: 'free',
					requiredTier: 'family',
					upgradeUrl: '/admin/license',
				},
			},
		});
		expect(mockSendMessage).not.toHaveBeenCalled();
	});

	it('standard プランで text メッセージを送ると 403（ファミリー限定、PlanLimitError 形式）', async () => {
		// #787: currentTier は standard、requiredTier は family
		// biome-ignore lint/style/noNonNullAssertion: send is defined
		const result = await actions.send!(
			createEvent('standard', {
				childId: '1',
				messageType: 'text',
				body: 'がんばったね',
			}),
		);
		expect(result).toMatchObject({
			status: 403,
			data: {
				error: {
					code: 'PLAN_LIMIT_EXCEEDED',
					currentTier: 'standard',
					requiredTier: 'family',
					upgradeUrl: '/admin/license',
				},
			},
		});
		expect(mockSendMessage).not.toHaveBeenCalled();
	});

	it('family プランなら text メッセージを送信できる', async () => {
		// biome-ignore lint/style/noNonNullAssertion: send is defined
		const result = await actions.send!(
			createEvent('family', {
				childId: '1',
				messageType: 'text',
				body: 'がんばったね',
			}),
		);
		expect(result).toMatchObject({ sent: true });
		expect(mockSendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				childId: 1,
				messageType: 'text',
				body: 'がんばったね',
				stampCode: null,
			}),
			't-test',
		);
	});

	it('free プランでも stamp メッセージは送信できる（ゲートされない）', async () => {
		// biome-ignore lint/style/noNonNullAssertion: send is defined
		const result = await actions.send!(
			createEvent('free', {
				childId: '1',
				messageType: 'stamp',
				stampCode: 'good_job',
			}),
		);
		expect(result).toMatchObject({ sent: true });
		expect(mockSendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				childId: 1,
				messageType: 'stamp',
				stampCode: 'good_job',
				body: null,
			}),
			't-test',
		);
		// stamp はプランゲートを通らないので resolveFullPlanTier は呼ばれない
		expect(mockResolveFullPlanTier).not.toHaveBeenCalled();
	});

	it('standard プランでも stamp メッセージは送信できる', async () => {
		// biome-ignore lint/style/noNonNullAssertion: send is defined
		const result = await actions.send!(
			createEvent('standard', {
				childId: '1',
				messageType: 'stamp',
				stampCode: 'good_job',
			}),
		);
		expect(result).toMatchObject({ sent: true });
		expect(mockSendMessage).toHaveBeenCalled();
	});

	it('family プランで空本文の text は 400', async () => {
		// biome-ignore lint/style/noNonNullAssertion: send is defined
		const result = await actions.send!(
			createEvent('family', {
				childId: '1',
				messageType: 'text',
				body: '   ',
			}),
		);
		expect(result).toMatchObject({
			status: 400,
			data: { error: 'メッセージを入力してください' },
		});
		expect(mockSendMessage).not.toHaveBeenCalled();
	});

	it('childId 未指定は 400', async () => {
		// biome-ignore lint/style/noNonNullAssertion: send is defined
		const result = await actions.send!(
			createEvent('family', {
				messageType: 'text',
				body: 'hi',
			}),
		);
		expect(result).toMatchObject({
			status: 400,
			data: { error: 'こどもを選択してください' },
		});
		expect(mockSendMessage).not.toHaveBeenCalled();
	});

	it('不正な messageType は 400', async () => {
		// biome-ignore lint/style/noNonNullAssertion: send is defined
		const result = await actions.send!(
			createEvent('family', {
				childId: '1',
				messageType: 'voice',
				body: 'hi',
			}),
		);
		expect(result).toMatchObject({
			status: 400,
			data: { error: 'メッセージ種別が不正です' },
		});
		expect(mockSendMessage).not.toHaveBeenCalled();
	});
});
