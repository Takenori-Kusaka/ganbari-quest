// tests/unit/routes/root-stale-child-cookie.test.ts
// #3709: ルート `/` の load が stale な selectedChildId Cookie で 500 にならず、
// Cookie を削除して優先順位 fallback (default_child_id → 1人自動 → /switch →
// /admin/children) に進むことを検証する。
//
// 背景 (2026-07-13 本番 NUC PGlite cutover 直後に PO が実機遭遇):
// cutover 前の旧 SQLite 数値 id が Cookie に残存 → pg backend の findChildById が
// 22P02 throw → `/` が 500。repo 層は #3709 で not-found (undefined) に正規化済みのため、
// route 層は「undefined → Cookie delete + fallback 継続」を担う (本テストの対象)。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetChildById = vi.fn();
const mockGetAllChildren = vi.fn();
vi.mock('$lib/server/services/child-service', () => ({
	getChildById: (...args: unknown[]) => mockGetChildById(...args),
	getAllChildren: (...args: unknown[]) => mockGetAllChildren(...args),
}));

const mockGetDefaultChildId = vi.fn();
vi.mock('$lib/server/services/default-child-service', () => ({
	getDefaultChildId: (...args: unknown[]) => mockGetDefaultChildId(...args),
}));

import { load } from '../../../src/routes/+page.server';

type LoadArgs = Parameters<typeof load>[0];

function makeCookies(initial: Record<string, string>) {
	const jar = new Map(Object.entries(initial));
	return {
		jar,
		cookies: {
			get: (name: string) => jar.get(name),
			set: (name: string, value: string) => {
				jar.set(name, value);
			},
			delete: vi.fn((name: string) => {
				jar.delete(name);
			}),
		},
	};
}

/** SvelteKit の redirect() は throw されるので catch して location を返す。 */
async function runLoad(args: {
	cookieValue?: string;
	children?: Array<{ id: string; uiMode: string | null }>;
}) {
	const { jar, cookies } = makeCookies(
		args.cookieValue !== undefined ? { selectedChildId: args.cookieValue } : {},
	);
	mockGetAllChildren.mockResolvedValue(args.children ?? []);
	let location: string | undefined;
	try {
		await load({
			cookies,
			locals: { context: { tenantId: 't-1' } },
		} as unknown as LoadArgs);
	} catch (e) {
		const redirect = e as { status?: number; location?: string };
		if (typeof redirect.location !== 'string') throw e;
		expect(redirect.status).toBe(302);
		location = redirect.location;
	}
	return { location, jar, cookies };
}

describe('/ load — stale selectedChildId Cookie の自動クリア (#3709)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetDefaultChildId.mockResolvedValue(null);
	});

	it('解決できない Cookie は削除され /switch へ fallback (子供複数)', async () => {
		mockGetChildById.mockResolvedValue(undefined); // stale id → not found (repo #3709 正規化)
		const { location, cookies, jar } = await runLoad({
			cookieValue: '3', // 旧 SQLite 数値 id
			children: [
				{ id: 'a', uiMode: 'preschool' },
				{ id: 'b', uiMode: 'elementary' },
			],
		});
		expect(location).toBe('/switch');
		expect(cookies.delete).toHaveBeenCalledWith('selectedChildId', { path: '/' });
		expect(jar.has('selectedChildId')).toBe(false);
	});

	it('解決できない Cookie でも子供 0 人なら /admin/children へ (500 にならない)', async () => {
		mockGetChildById.mockResolvedValue(undefined);
		const { location, cookies } = await runLoad({ cookieValue: 'not-a-uuid', children: [] });
		expect(location).toBe('/admin/children');
		expect(cookies.delete).toHaveBeenCalledWith('selectedChildId', { path: '/' });
	});

	it('有効な Cookie は従来どおり子供ホームへ redirect し Cookie は保持', async () => {
		mockGetChildById.mockResolvedValue({ id: 'a', uiMode: 'elementary' });
		const { location, cookies } = await runLoad({
			cookieValue: '00000000-0000-4000-8000-0000000000c1',
			children: [{ id: 'a', uiMode: 'elementary' }],
		});
		expect(location).toBe('/elementary/home');
		expect(cookies.delete).not.toHaveBeenCalled();
	});

	it('Cookie 無しは delete を呼ばず優先順位ロジックへ (回帰なし)', async () => {
		const { location, cookies } = await runLoad({
			children: [{ id: 'a', uiMode: 'junior' }],
		});
		expect(location).toBe('/junior/home'); // 1 人 → 自動選択
		expect(cookies.delete).not.toHaveBeenCalled();
	});
});
