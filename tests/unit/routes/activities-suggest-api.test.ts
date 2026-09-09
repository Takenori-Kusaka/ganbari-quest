// tests/unit/routes/activities-suggest-api.test.ts
// #727: /api/v1/activities/suggest のプランゲート + 認証チェック

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asCategoryId } from '$lib/domain/ids';

// --- モック ---
const mockResolveFullPlanTier = vi.fn();
const mockSuggestActivity = vi.fn();

vi.mock('$lib/server/services/plan-limit-service', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/services/plan-limit-service')>(
		'$lib/server/services/plan-limit-service',
	);
	return {
		...actual,
		resolveFullPlanTier: mockResolveFullPlanTier,
	};
});

vi.mock('$lib/server/services/activity-suggest-service', () => ({
	suggestActivity: mockSuggestActivity,
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { POST } = await import('../../../src/routes/api/v1/activities/suggest/+server');

function makeEvent(
	opts: {
		text?: string;
		licenseStatus?: string;
		plan?: string;
		tenantId?: string | null;
		role?: string;
	} = {},
) {
	const body = JSON.stringify({ text: opts.text ?? '' });
	const request = new Request('http://localhost/api/v1/activities/suggest', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body,
	});
	// tenantId: null → context を undefined に（未認証シナリオ）
	const context =
		opts.tenantId === null
			? undefined
			: {
					licenseStatus: opts.licenseStatus ?? 'none',
					plan: opts.plan,
					tenantId: opts.tenantId ?? 'tenant-1',
					// #4866 系 / PO 差し戻し 2026-09-09: AI 提案は親限定になった
					// (共通 gate `validateSuggestRequest` で role を見る)。この test は
					// **plan gate の方**を見ているので、呼び手を保護者として明示する。
					// role の方は api-parent-only-role-guard.test.ts が固定する。
					role: opts.role ?? 'owner',
				};
	return {
		request,
		locals: { context },
	} as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/v1/activities/suggest', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('未認証ユーザー（context なし）は 401 を投げる', async () => {
		await expect(
			POST(
				makeEvent({
					text: 'サッカーの練習',
					tenantId: null,
				}),
			),
		).rejects.toMatchObject({ status: 401 });
	});

	it('無料プランでは PLAN_LIMIT_EXCEEDED 403 を返す', async () => {
		mockResolveFullPlanTier.mockResolvedValue('free');

		const response = await POST(makeEvent({ text: 'サッカーの練習', licenseStatus: 'none' }));

		expect(response.status).toBe(403);
		const body = await response.json();
		expect(body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
		// suggestActivity は呼ばれない（コスト流出防止）
		expect(mockSuggestActivity).not.toHaveBeenCalled();
	});

	it('スタンダードプランでは PLAN_LIMIT_EXCEEDED 403 を返す (#722 ファミリー限定化)', async () => {
		mockResolveFullPlanTier.mockResolvedValue('standard');

		const response = await POST(
			makeEvent({
				text: 'サッカーの練習',
				licenseStatus: 'active',
				plan: 'standard_monthly',
			}),
		);

		expect(response.status).toBe(403);
		const body = await response.json();
		expect(body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
		expect(mockSuggestActivity).not.toHaveBeenCalled();
	});

	it('ファミリープランでは suggestActivity を実行', async () => {
		mockResolveFullPlanTier.mockResolvedValue('family');
		mockSuggestActivity.mockResolvedValue({
			name: '公園で走る',
			categoryId: asCategoryId(1),
			icon: '🏃',
			basePoints: 5,
			source: 'ai',
		});

		const response = await POST(
			makeEvent({
				text: '公園で走った',
				licenseStatus: 'active',
				plan: 'family_monthly',
			}),
		);

		expect(response.status).toBe(200);
		expect(mockSuggestActivity).toHaveBeenCalledWith('公園で走った');
	});

	it('ファミリープランで���テキスト空は 400', async () => {
		mockResolveFullPlanTier.mockResolvedValue('family');

		await expect(
			POST(
				makeEvent({
					text: '',
					licenseStatus: 'active',
					plan: 'family_monthly',
				}),
			),
		).rejects.toMatchObject({ status: 400 });
		expect(mockSuggestActivity).not.toHaveBeenCalled();
	});

	it('ファミリープランでも200文字超は 400', async () => {
		mockResolveFullPlanTier.mockResolvedValue('family');

		const longText = 'あ'.repeat(201);
		await expect(
			POST(
				makeEvent({
					text: longText,
					licenseStatus: 'active',
					plan: 'family_monthly',
				}),
			),
		).rejects.toMatchObject({ status: 400 });
		expect(mockSuggestActivity).not.toHaveBeenCalled();
	});
});
