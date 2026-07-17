// tests/unit/routes/home-form-field-guard.test.ts
// #3799: child home の POST action で form-field 由来 opaque id (toChildId / cheerIds / activityId /
// logId / challengeId) が dsql の uuid 列へ直達し 22P02 → 500 (or 内部例外 leak) になる CWE-20 を、
// route 冒頭の isValidUuidFormField / areValidUuidFormFields guard が fail(400) に正規化し、service に
// 生 id を一切流さないことを end-to-end で確認する。cookie guard の wiring 検証 (home-cookie-guard.test.ts)
// と同型 (cookie は /switch redirect、form-field は自己誘発改竄なので 400 validation error 正規化)。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockIsDsqlBackend = vi.fn();
vi.mock('$lib/server/db/backend', () => ({
	isDsqlBackend: () => mockIsDsqlBackend(),
}));

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: () => 't-1',
}));

const mockRecordActivity = vi.fn();
const mockCancelActivityLog = vi.fn();
vi.mock('$lib/server/services/activity-log-service', () => ({
	recordActivity: (...args: unknown[]) => mockRecordActivity(...args),
	cancelActivityLog: (...args: unknown[]) => mockCancelActivityLog(...args),
	getTodayRecordedActivityCounts: vi.fn(),
	hasAnyActivityRecords: vi.fn(),
}));

const mockToggleActivityPin = vi.fn();
vi.mock('$lib/server/services/activity-pin-service', () => ({
	toggleActivityPin: (...args: unknown[]) => mockToggleActivityPin(...args),
	sortActivitiesWithPreferences: vi.fn(),
}));

const mockClaimChildChallengeReward = vi.fn();
vi.mock('$lib/server/services/child-challenge-service', () => ({
	claimChildChallengeReward: (...args: unknown[]) => mockClaimChildChallengeReward(...args),
	getActiveChildChallengesWithSiblings: vi.fn(),
	getOrCreateWeeklyChildChallenge: vi.fn(),
}));

const mockSendCheer = vi.fn();
const mockMarkCheersShown = vi.fn();
vi.mock('$lib/server/services/sibling-cheer-service', () => ({
	sendCheer: (...args: unknown[]) => mockSendCheer(...args),
	markCheersShown: (...args: unknown[]) => mockMarkCheersShown(...args),
	getUnshownCheers: vi.fn(),
}));

import { actions as homeActions } from '../../../src/routes/(child)/[uiMode=uiMode]/home/+page.server';

// cookie guard (requireValidChildCookieFormat) を通すための有効 uuid cookie。
const VALID_COOKIE_UUID = '00000000-0000-4000-8000-0000000000c0';
const VALID_FORM_UUID = '11111111-1111-4111-8111-1111111111f1';
const NON_UUID = '3'; // 旧 SQLite 数値 id / 改竄値。

function makeCookies(value: string | undefined) {
	const jar = new Map<string, string>();
	if (value !== undefined) jar.set('selectedChildId', value);
	return {
		get: (name: string) => jar.get(name),
		set: (name: string, v: string) => {
			jar.set(name, v);
		},
		delete: vi.fn((name: string) => {
			jar.delete(name);
		}),
	};
}

function makeRequest(fields: Record<string, string>): Request {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return { formData: async () => fd } as unknown as Request;
}

/** action を実行し、fail() の戻り値 (status/data) or redirect throw を正規化して返す。 */
async function runAction(
	name: string,
	fields: Record<string, string>,
	cookieValue: string | undefined,
): Promise<{ status?: number; data?: unknown; redirect?: string }> {
	const action = homeActions[name as keyof typeof homeActions];
	if (typeof action !== 'function') throw new Error(`${name} action が未定義`);
	try {
		const result = (await action({
			request: makeRequest(fields),
			cookies: makeCookies(cookieValue),
			locals: {},
		} as never)) as { status?: number; data?: unknown } | undefined;
		return { status: result?.status, data: result?.data ?? result };
	} catch (e) {
		const r = e as { status?: number; location?: string };
		if (typeof r.location === 'string') return { redirect: r.location };
		throw e;
	}
}

describe('child home POST action の form-field id trust 境界 guard (#3799)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('dsql backend + 非 uuid form-field → service 到達前に fail(400) (22P02/500 回避)', () => {
		beforeEach(() => {
			mockIsDsqlBackend.mockReturnValue(true);
		});

		it('record: 非 uuid activityId は fail(400) し recordActivity を呼ばない', async () => {
			const res = await runAction('record', { activityId: NON_UUID }, VALID_COOKIE_UUID);
			expect(res.status).toBe(400);
			expect(mockRecordActivity).not.toHaveBeenCalled();
		});

		it('cancelRecord: 非 uuid logId は fail(400) し cancelActivityLog を呼ばない', async () => {
			const res = await runAction('cancelRecord', { logId: NON_UUID }, VALID_COOKIE_UUID);
			expect(res.status).toBe(400);
			expect(mockCancelActivityLog).not.toHaveBeenCalled();
		});

		it('togglePin: 非 uuid activityId は fail(400) し toggleActivityPin を呼ばない', async () => {
			const res = await runAction(
				'togglePin',
				{ activityId: NON_UUID, pinned: 'true' },
				VALID_COOKIE_UUID,
			);
			expect(res.status).toBe(400);
			expect(mockToggleActivityPin).not.toHaveBeenCalled();
		});

		it('claimChallengeReward: 非 uuid challengeId は fail(400) し claimChildChallengeReward を呼ばない (内部例外 leak 回避)', async () => {
			const res = await runAction(
				'claimChallengeReward',
				{ challengeId: NON_UUID },
				VALID_COOKIE_UUID,
			);
			expect(res.status).toBe(400);
			expect(mockClaimChildChallengeReward).not.toHaveBeenCalled();
		});

		it('sendCheer: 非 uuid toChildId は fail(400) し sendCheer を呼ばない (uncaught 22P02→500 回避)', async () => {
			const res = await runAction(
				'sendCheer',
				{ toChildId: NON_UUID, stampCode: 'ganbare' },
				VALID_COOKIE_UUID,
			);
			expect(res.status).toBe(400);
			expect(mockSendCheer).not.toHaveBeenCalled();
		});

		it('markCheersShown: 1 件でも非 uuid cheerId が混ざれば fail(400) し markCheersShown を呼ばない', async () => {
			const res = await runAction(
				'markCheersShown',
				{ cheerIds: `${VALID_FORM_UUID},${NON_UUID}` },
				undefined,
			);
			expect(res.status).toBe(400);
			expect(mockMarkCheersShown).not.toHaveBeenCalled();
		});
	});

	describe('dsql backend + 有効 uuid form-field → 従来どおり service に到達する', () => {
		beforeEach(() => {
			mockIsDsqlBackend.mockReturnValue(true);
		});

		it('sendCheer: 有効 uuid toChildId は sendCheer に form 値を渡す', async () => {
			mockSendCheer.mockResolvedValue({ success: true, cheer: {} });
			const res = await runAction(
				'sendCheer',
				{ toChildId: VALID_FORM_UUID, stampCode: 'ganbare' },
				VALID_COOKIE_UUID,
			);
			expect(mockSendCheer).toHaveBeenCalledTimes(1);
			expect(mockSendCheer.mock.calls[0]?.[1]).toBe(VALID_FORM_UUID);
			expect((res.data as { success?: boolean }).success).toBe(true);
		});

		it('record: 有効 uuid activityId は recordActivity に form 値を渡す', async () => {
			mockRecordActivity.mockResolvedValue({
				id: 'log-1',
				activityName: 'a',
				totalPoints: 1,
				streakDays: 1,
			});
			const res = await runAction('record', { activityId: VALID_FORM_UUID }, VALID_COOKIE_UUID);
			expect(mockRecordActivity).toHaveBeenCalledTimes(1);
			expect(mockRecordActivity.mock.calls[0]?.[1]).toBe(VALID_FORM_UUID);
			expect((res.data as { success?: boolean }).success).toBe(true);
		});

		it('markCheersShown: 全件 uuid なら markCheersShown に渡す', async () => {
			mockMarkCheersShown.mockResolvedValue(undefined);
			const res = await runAction('markCheersShown', { cheerIds: VALID_FORM_UUID }, undefined);
			expect(mockMarkCheersShown).toHaveBeenCalledTimes(1);
			expect(mockMarkCheersShown.mock.calls[0]?.[0]).toEqual([VALID_FORM_UUID]);
			expect((res.data as { success?: boolean }).success).toBe(true);
		});
	});

	describe('非 dsql backend (sqlite/demo) → 数値 form-field id を弾かない (guard no-op)', () => {
		beforeEach(() => {
			mockIsDsqlBackend.mockReturnValue(false);
		});

		it('sendCheer: 数値 toChildId でも guard を通し sendCheer に到達する', async () => {
			mockSendCheer.mockResolvedValue({ success: true, cheer: {} });
			// 非 dsql は cookie guard も生 cookie を返すため数値 cookie で成立。
			await runAction('sendCheer', { toChildId: '905', stampCode: 'ganbare' }, '903');
			expect(mockSendCheer).toHaveBeenCalledTimes(1);
			expect(mockSendCheer.mock.calls[0]?.[1]).toBe('905');
		});

		it('record: 数値 activityId でも guard を通し recordActivity に到達する', async () => {
			mockRecordActivity.mockResolvedValue({
				id: 'log-1',
				activityName: 'a',
				totalPoints: 1,
				streakDays: 1,
			});
			await runAction('record', { activityId: '42' }, '903');
			expect(mockRecordActivity).toHaveBeenCalledTimes(1);
			expect(mockRecordActivity.mock.calls[0]?.[1]).toBe('42');
		});
	});
});
