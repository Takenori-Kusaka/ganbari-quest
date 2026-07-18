// tests/unit/routes/home-cookie-guard.test.ts
// #3581 ②: child home の POST action (selectedChildId cookie 直読) の trust 境界 wiring 検証。
//
// home/+page.server.ts の stampCard / loginStamp action は stampToday → getOrCreateCurrentCard →
// findCardByChildAndWeek へ raw cookie id を直達させ、dsql backend では 22P02 → 500 になる (CWE-20)。
// requireValidChildCookieFormat が action 冒頭で非 uuid を cookie delete + /switch redirect に正規化し、
// service (stampToday / claimLoginBonus) に生 id を一切流さないことを end-to-end で確認する。
// checklist toggle の wiring 検証 (child-cookie-guard.test.ts) と同型。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockIsDsqlBackend = vi.fn();
vi.mock('$lib/server/db/backend', () => ({
	isDsqlBackend: () => mockIsDsqlBackend(),
}));

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: () => 't-1',
}));

const mockStampToday = vi.fn();
const mockRedeemStampCard = vi.fn();
const mockAutoRedeemPreviousWeek = vi.fn();
vi.mock('$lib/server/services/stamp-card-service', () => ({
	stampToday: (...args: unknown[]) => mockStampToday(...args),
	redeemStampCard: (...args: unknown[]) => mockRedeemStampCard(...args),
	autoRedeemPreviousWeek: (...args: unknown[]) => mockAutoRedeemPreviousWeek(...args),
	getStampCardStatus: vi.fn(),
}));

const mockClaimLoginBonus = vi.fn();
vi.mock('$lib/server/services/login-bonus-service', () => ({
	claimLoginBonus: (...args: unknown[]) => mockClaimLoginBonus(...args),
	getLoginBonusStatus: vi.fn(),
}));

import { actions as homeActions } from '../../../src/routes/(child)/[uiMode=uiMode]/home/+page.server';

const VALID_UUID = '00000000-0000-4000-8000-0000000000a1';

function makeCookies(value?: string) {
	const jar = new Map<string, string>();
	if (value !== undefined) jar.set('selectedChildId', value);
	return {
		jar,
		cookies: {
			get: (name: string) => jar.get(name),
			set: (name: string, v: string) => {
				jar.set(name, v);
			},
			delete: vi.fn((name: string) => {
				jar.delete(name);
			}),
		},
	};
}

/** action を実行し、redirect() throw は catch して location を返す。 */
async function runAction(
	name: 'stampCard' | 'loginStamp',
	cookieValue: string | undefined,
): Promise<{
	result?: unknown;
	redirect?: { status?: number; location?: string };
	cookies: ReturnType<typeof makeCookies>['cookies'];
}> {
	const { cookies } = makeCookies(cookieValue);
	const action = homeActions[name];
	if (typeof action !== 'function') throw new Error(`${name} action が未定義`);
	try {
		const result = await action({ cookies, locals: {} } as never);
		return { result, cookies };
	} catch (e) {
		const r = e as { status?: number; location?: string };
		if (typeof r.location !== 'string') throw e;
		return { redirect: r, cookies };
	}
}

describe('child home POST action の trust 境界 wiring (#3581 ②)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('dsql backend + 非 uuid cookie → repo 到達前に redirect + cookie clear', () => {
		beforeEach(() => {
			mockIsDsqlBackend.mockReturnValue(true);
		});

		it('stampCard: 非 uuid は /switch redirect し stampToday を呼ばない (22P02/500 回避)', async () => {
			const { redirect, cookies } = await runAction('stampCard', '3');
			expect(redirect?.location).toBe('/switch');
			expect(cookies.delete).toHaveBeenCalledWith('selectedChildId', { path: '/' });
			expect(mockStampToday).not.toHaveBeenCalled();
		});

		it('loginStamp: 非 uuid は /switch redirect し stampToday / claimLoginBonus を呼ばない', async () => {
			const { redirect, cookies } = await runAction('loginStamp', 'not-a-uuid');
			expect(redirect?.location).toBe('/switch');
			expect(cookies.delete).toHaveBeenCalledWith('selectedChildId', { path: '/' });
			expect(mockStampToday).not.toHaveBeenCalled();
			expect(mockClaimLoginBonus).not.toHaveBeenCalled();
		});
	});

	describe('dsql backend + 有効 uuid cookie → 従来どおり service に到達する', () => {
		beforeEach(() => {
			mockIsDsqlBackend.mockReturnValue(true);
		});

		it('stampCard: 有効 uuid は stampToday に cookie 値を渡す', async () => {
			mockStampToday.mockResolvedValue({
				stamp: { name: 'star', rarity: 'N', omikujiRank: null },
			});
			const { result } = await runAction('stampCard', VALID_UUID);
			expect(mockStampToday).toHaveBeenCalledTimes(1);
			expect(mockStampToday.mock.calls[0]?.[0]).toBe(VALID_UUID);
			expect((result as { success?: boolean }).success).toBe(true);
		});

		it('loginStamp: 有効 uuid は claimLoginBonus / stampToday に cookie 値を渡す', async () => {
			mockClaimLoginBonus.mockResolvedValue({
				consecutiveLoginDays: 1,
				multiplier: 1,
			});
			mockStampToday.mockResolvedValue({
				stamp: { name: 'star', rarity: 'N', omikujiRank: null },
				instantPoints: 5,
				cardData: null,
			});
			mockAutoRedeemPreviousWeek.mockResolvedValue(null);
			const { result } = await runAction('loginStamp', VALID_UUID);
			expect(mockClaimLoginBonus.mock.calls[0]?.[0]).toBe(VALID_UUID);
			expect(mockStampToday.mock.calls[0]?.[0]).toBe(VALID_UUID);
			expect((result as { success?: boolean }).success).toBe(true);
		});
	});

	describe('非 dsql backend (demo/anonymous) → loginStamp の no-op 契約を保持', () => {
		beforeEach(() => {
			mockIsDsqlBackend.mockReturnValue(false);
		});

		it('loginStamp: 空 cookie は redirect せず no-child-selected no-op を返す (retry storm 回避)', async () => {
			const { result, cookies } = await runAction('loginStamp', '');
			expect(cookies.delete).not.toHaveBeenCalled();
			expect(mockStampToday).not.toHaveBeenCalled();
			expect(result).toMatchObject({
				success: false,
				loginStamp: false,
				reason: 'no-child-selected',
			});
		});
	});
});
