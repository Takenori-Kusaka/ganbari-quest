// tests/unit/routes/child-cookie-guard.test.ts
// #3581 ②: POST action の trust 境界 (selectedChildId cookie) 形式検証。
//
// child 配下の form action は (child)/+layout.server.ts の getChildById gate を経ずに実行される
// ため、生の cookie id が repo に直達し dsql backend では 22P02 → 500 になる (CWE-20)。
// requireValidChildCookieFormat が dsql backend でのみ「非 uuid → cookie delete + /switch redirect」
// に正規化し、非 dsql backend では数値 id を誤って弾かないことを検証する。加えて実際の
// checklist toggle action に wiring されていることを end-to-end で確認する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockIsDsqlBackend = vi.fn();
vi.mock('$lib/server/db/backend', () => ({
	isDsqlBackend: () => mockIsDsqlBackend(),
}));

const mockRequireTenantId = vi.fn(() => 't-1');
vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: () => mockRequireTenantId(),
}));

const mockToggleCheckItem = vi.fn();
vi.mock('$lib/server/services/checklist-service', () => ({
	toggleCheckItem: (...args: unknown[]) => mockToggleCheckItem(...args),
	getChecklistsForChild: vi.fn(),
	getCurrentTimeSlot: vi.fn(() => 'morning'),
}));

import { requireValidChildCookieFormat } from '../../../src/lib/server/auth/child-cookie-guard';
import { actions as checklistActions } from '../../../src/routes/(child)/checklist/+page.server';

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

/** redirect() は throw されるので catch して location を返す。 */
function runGuard(cookies: unknown) {
	try {
		return { result: requireValidChildCookieFormat(cookies as never, 'route.test') };
	} catch (e) {
		const r = e as { status?: number; location?: string };
		if (typeof r.location !== 'string') throw e;
		return { redirect: r };
	}
}

const VALID_UUID = '00000000-0000-4000-8000-0000000000a1';

describe('requireValidChildCookieFormat (#3581 ②)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('dsql backend', () => {
		beforeEach(() => {
			mockIsDsqlBackend.mockReturnValue(true);
		});

		it('非 uuid の stale cookie は削除 + /switch redirect', () => {
			const { jar, cookies } = makeCookies('3'); // 旧 SQLite 数値 id
			const out = runGuard(cookies);
			expect(out.redirect?.status).toBe(302);
			expect(out.redirect?.location).toBe('/switch');
			expect(cookies.delete).toHaveBeenCalledWith('selectedChildId', { path: '/' });
			expect(jar.has('selectedChildId')).toBe(false);
		});

		it('空 cookie も削除 + /switch redirect (dsql では空文字も 22P02 を誘発するため)', () => {
			const { cookies } = makeCookies('');
			const out = runGuard(cookies);
			expect(out.redirect?.location).toBe('/switch');
			expect(cookies.delete).toHaveBeenCalled();
		});

		it('cookie 未設定も /switch redirect (未選択 = layout 契約と同一)', () => {
			const { cookies } = makeCookies(undefined);
			const out = runGuard(cookies);
			expect(out.redirect?.location).toBe('/switch');
		});

		it('有効な uuid cookie はそのまま値を返す (redirect しない)', () => {
			const { cookies } = makeCookies(VALID_UUID);
			const out = runGuard(cookies);
			expect(out.result).toBe(VALID_UUID);
			expect(cookies.delete).not.toHaveBeenCalled();
		});
	});

	describe('非 dsql backend (sqlite / demo / dynamodb)', () => {
		beforeEach(() => {
			mockIsDsqlBackend.mockReturnValue(false);
		});

		it('数値 id ("903") は redirect せずそのまま返す (有効 id を誤って弾かない)', () => {
			const { cookies } = makeCookies('903');
			const out = runGuard(cookies);
			expect(out.result).toBe('903');
			expect(cookies.delete).not.toHaveBeenCalled();
		});

		it('空 cookie も redirect せず空文字を返す (各 action の既存 empty 処理に委ねる)', () => {
			const { cookies } = makeCookies('');
			const out = runGuard(cookies);
			expect(out.result).toBe('');
			expect(cookies.delete).not.toHaveBeenCalled();
		});
	});
});

describe('checklist toggle action の trust 境界 wiring (#3581 ②)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function makeRequest(fields: Record<string, string>) {
		const formData = new FormData();
		for (const [k, v] of Object.entries(fields)) formData.append(k, v);
		return { formData: async () => formData };
	}

	async function runToggle(cookieValue: string | undefined) {
		const { cookies } = makeCookies(cookieValue);
		const request = makeRequest({ templateId: 't1', itemId: 'i1', checked: '1' });
		const toggle = checklistActions.toggle;
		if (typeof toggle !== 'function') throw new Error('toggle action が未定義');
		try {
			const result = await toggle({
				request,
				cookies,
				locals: {},
			} as never);
			return { result, cookies };
		} catch (e) {
			const r = e as { status?: number; location?: string };
			if (typeof r.location !== 'string') throw e;
			return { redirect: r, cookies };
		}
	}

	it('dsql backend + 非 uuid cookie → repo 到達前に redirect + cookie clear (22P02/500 を回避)', async () => {
		mockIsDsqlBackend.mockReturnValue(true);
		const { redirect, cookies } = await runToggle('3');
		expect(redirect?.location).toBe('/switch');
		expect(cookies.delete).toHaveBeenCalledWith('selectedChildId', { path: '/' });
		// guard で弾かれるため service は一切呼ばれない (生 id を repo に流さない)。
		expect(mockToggleCheckItem).not.toHaveBeenCalled();
	});

	it('dsql backend + 有効 uuid cookie → 従来どおり service に到達する', async () => {
		mockIsDsqlBackend.mockReturnValue(true);
		mockToggleCheckItem.mockResolvedValue({
			checkedCount: 1,
			totalCount: 3,
			completedAll: false,
			pointsAwarded: 0,
			newlyCompleted: false,
		});
		const { result } = await runToggle(VALID_UUID);
		expect(mockToggleCheckItem).toHaveBeenCalledTimes(1);
		expect(mockToggleCheckItem.mock.calls[0]?.[0]).toBe(VALID_UUID); // childId は cookie 値
		expect((result as { success?: boolean }).success).toBe(true);
	});
});
