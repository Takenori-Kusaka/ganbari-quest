// tests/unit/routes/admin-cheer-grant.test.ts
// EPIC #2266 / #2267: /admin/cheer?/grant action のバリデーション + 正常系テスト
//
// テスト観点:
// - childId 未指定は 400
// - reason 空 / 文字数オーバーは 400
// - points 範囲外は 400
// - category 不正は 400
// - 正常系: grantCheer() が呼ばれ、granted: true が返る

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- mocks ----------

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		if (!locals.context?.tenantId) throw new Error('Unauthorized');
		return locals.context.tenantId;
	},
}));

const mockGrantCheer = vi.fn();
vi.mock('$lib/server/services/cheer-service', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/services/cheer-service')>(
		'$lib/server/services/cheer-service',
	);
	return {
		...actual,
		grantCheer: (...args: unknown[]) => mockGrantCheer(...args),
	};
});

vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: vi.fn().mockResolvedValue([]),
}));

vi.mock('$lib/server/services/message-service', () => ({
	getMessageHistory: vi.fn().mockResolvedValue([]),
	STAMP_PRESETS: [],
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { actions } = await import('../../../src/routes/(parent)/admin/cheer/+page.server');

// ---------- helpers ----------

function createRequest(formValues: Record<string, string>): Request {
	const fd = new FormData();
	for (const [k, v] of Object.entries(formValues)) fd.set(k, v);
	return {
		formData: () => Promise.resolve(fd),
	} as unknown as Request;
}

function createEvent(formValues: Record<string, string>, tenantId = 't-test') {
	return {
		request: createRequest(formValues),
		locals: {
			context: { tenantId },
		},
	} as unknown as Parameters<NonNullable<typeof actions.grant>>[0];
}

const validForm = {
	childId: '1',
	reason: 'うんどうかいで 1いに なったね！',
	points: '100',
	category: 'うんどう',
	icon: '🎉',
};

// ---------- tests ----------

describe('POST /admin/cheer?/grant (#2267)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGrantCheer.mockResolvedValue({
			messageId: 1,
			pointEntryAmount: 100,
			description: '🎉 応援: うんどうかいで 1いに なったね！',
		});
	});

	it('正常系: grantCheer() が呼ばれて granted: true が返る', async () => {
		const result = await actions.grant!(createEvent(validForm));
		expect(result).toMatchObject({
			granted: true,
			points: 100,
			reason: 'うんどうかいで 1いに なったね！',
			category: 'うんどう',
			icon: '🎉',
		});
		expect(mockGrantCheer).toHaveBeenCalledWith(
			expect.objectContaining({
				childId: 1,
				reason: 'うんどうかいで 1いに なったね！',
				points: 100,
				category: 'うんどう',
				icon: '🎉',
			}),
			't-test',
		);
	});

	it('childId 未指定は 400', async () => {
		const result = await actions.grant!(createEvent({ ...validForm, childId: '0' }));
		expect(result).toMatchObject({
			status: 400,
			data: { error: 'こどもを選択してください' },
		});
		expect(mockGrantCheer).not.toHaveBeenCalled();
	});

	it('reason 空は 400', async () => {
		const result = await actions.grant!(createEvent({ ...validForm, reason: '   ' }));
		expect(result).toMatchObject({
			status: 400,
			data: { error: '応援の理由を入力してください' },
		});
		expect(mockGrantCheer).not.toHaveBeenCalled();
	});

	it('reason 文字数オーバーは 400', async () => {
		const longReason = 'あ'.repeat(101);
		const result = await actions.grant!(createEvent({ ...validForm, reason: longReason }));
		expect(result).toMatchObject({
			status: 400,
			data: { error: '理由は100文字以内で入力してください' },
		});
		expect(mockGrantCheer).not.toHaveBeenCalled();
	});

	it('points 0 は 400', async () => {
		const result = await actions.grant!(createEvent({ ...validForm, points: '0' }));
		expect(result).toMatchObject({
			status: 400,
			data: { error: 'ポイントは1〜10000の範囲で入力してください' },
		});
		expect(mockGrantCheer).not.toHaveBeenCalled();
	});

	it('points 上限超過は 400', async () => {
		const result = await actions.grant!(createEvent({ ...validForm, points: '10001' }));
		expect(result).toMatchObject({
			status: 400,
			data: { error: 'ポイントは1〜10000の範囲で入力してください' },
		});
		expect(mockGrantCheer).not.toHaveBeenCalled();
	});

	it('category 不正は 400', async () => {
		const result = await actions.grant!(createEvent({ ...validForm, category: 'invalid' }));
		expect(result).toMatchObject({
			status: 400,
			data: { error: 'カテゴリを選択してください' },
		});
		expect(mockGrantCheer).not.toHaveBeenCalled();
	});

	it('grantCheer() が NOT_FOUND を返したら 404', async () => {
		mockGrantCheer.mockResolvedValue({ error: 'NOT_FOUND', target: 'child' });
		const result = await actions.grant!(createEvent(validForm));
		expect(result).toMatchObject({ status: 404 });
	});

	it('付随スタンプとメッセージは grantCheer() に渡される', async () => {
		await actions.grant!(
			createEvent({
				...validForm,
				stampCode: 'sugoi',
				body: 'がんばったね',
			}),
		);
		expect(mockGrantCheer).toHaveBeenCalledWith(
			expect.objectContaining({
				stampCode: 'sugoi',
				body: 'がんばったね',
			}),
			't-test',
		);
	});
});
