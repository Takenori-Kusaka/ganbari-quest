// tests/unit/routes/root-page-redirect.test.ts
// #576: ルート `/` の優先順位ロジックを検証する。
//
// 優先順位:
//   1. Cookie selectedChildId が有効 → /${uiMode}/home
//   2. tenant の default_child_id が有効 → /${uiMode}/home
//   3. 子供が 1 人 → 自動選択
//   4. 子供が複数 & 既定未設定 → /switch
//   5. 子供 0 人 → /admin/children

import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- モックの準備（import 前に定義する必要あり） ---
const mockGetChildById = vi.fn();
const mockGetAllChildren = vi.fn();
const mockGetDefaultChildId = vi.fn();

vi.mock('$lib/server/services/child-service', () => ({
	getChildById: mockGetChildById,
	getAllChildren: mockGetAllChildren,
}));

vi.mock('$lib/server/services/default-child-service', () => ({
	getDefaultChildId: mockGetDefaultChildId,
}));

// normalizeUiMode は実物を使う（副作用なし）
// 実物を後から動的 import で読む
const { load } = await import('../../../src/routes/+page.server');

/** `redirect()` は throw で制御フローを抜けるため、throw された Response から location を取り出す */
function captureRedirect(fn: () => unknown): { status: number; location: string } {
	try {
		const result = fn();
		if (result instanceof Promise) {
			throw new Error('captureRedirect does not support promises — await first');
		}
		throw new Error('Expected redirect but load() returned normally');
	} catch (e) {
		// SvelteKit の redirect は { status, location } 形式
		if (e && typeof e === 'object' && 'status' in e && 'location' in e) {
			return e as { status: number; location: string };
		}
		throw e;
	}
}

async function captureAsyncRedirect(
	fn: () => unknown,
): Promise<{ status: number; location: string }> {
	try {
		await fn();
		throw new Error('Expected redirect but load() returned normally');
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e && 'location' in e) {
			return e as { status: number; location: string };
		}
		throw e;
	}
}

function makeEvent(opts: { tenantId?: string | null; cookieValue?: string | null } = {}) {
	const cookies: Partial<Cookies> = {
		get: (key: string) => (key === 'selectedChildId' ? (opts.cookieValue ?? undefined) : undefined),
	};
	return {
		cookies: cookies as Cookies,
		locals: {
			context: opts.tenantId === null ? null : { tenantId: opts.tenantId ?? 'test-tenant' },
		},
	} as unknown as Parameters<typeof load>[0];
}

beforeEach(() => {
	mockGetChildById.mockReset();
	mockGetAllChildren.mockReset();
	mockGetDefaultChildId.mockReset();
});

describe('#576 ルート `/` 優先順位ロジック', () => {
	it('未認証（tenantId なし） → /auth/login', async () => {
		const redirect = await captureAsyncRedirect(() => load(makeEvent({ tenantId: null })));
		expect(redirect.status).toBe(302);
		expect(redirect.location).toBe('/auth/login');
	});

	it('優先順位1: Cookie 有効 → その子供のホーム', async () => {
		mockGetChildById.mockResolvedValue({ id: 10, uiMode: 'preschool' });
		// defaultChildId は呼ばれないはず
		mockGetDefaultChildId.mockResolvedValue(null);

		const redirect = await captureAsyncRedirect(() => load(makeEvent({ cookieValue: '10' })));

		expect(redirect.location).toBe('/preschool/home');
		expect(mockGetChildById).toHaveBeenCalledWith(10, 'test-tenant');
		expect(mockGetDefaultChildId).not.toHaveBeenCalled();
	});

	it('優先順位1: Cookie が不正値（文字列）なら無視して次のステップへ', async () => {
		mockGetDefaultChildId.mockResolvedValue(null);
		mockGetAllChildren.mockResolvedValue([{ id: 1, uiMode: 'preschool' }]);

		const redirect = await captureAsyncRedirect(() => load(makeEvent({ cookieValue: 'abc' })));

		// 1人しかいないので自動選択に進む
		expect(redirect.location).toBe('/preschool/home');
		expect(mockGetChildById).not.toHaveBeenCalled();
	});

	it('優先順位1: Cookie の子供が DB に存在しないなら次のステップへ', async () => {
		mockGetChildById.mockResolvedValue(null); // 削除済み
		mockGetDefaultChildId.mockResolvedValue(null);
		mockGetAllChildren.mockResolvedValue([
			{ id: 1, uiMode: 'preschool' },
			{ id: 2, uiMode: 'elementary' },
		]);

		const redirect = await captureAsyncRedirect(() => load(makeEvent({ cookieValue: '999' })));

		// 既定未設定 + 複数 → /switch
		expect(redirect.location).toBe('/switch');
	});

	it('優先順位2: 既定の子供 → そのホーム', async () => {
		mockGetDefaultChildId.mockResolvedValue(5);
		mockGetChildById.mockResolvedValue({ id: 5, uiMode: 'elementary' });

		const redirect = await captureAsyncRedirect(() => load(makeEvent({})));

		expect(redirect.location).toBe('/elementary/home');
		expect(mockGetChildById).toHaveBeenCalledWith(5, 'test-tenant');
	});

	it('優先順位2: 既定 ID が無効（子供が削除済み）→ 次のステップへフォールバック', async () => {
		mockGetDefaultChildId.mockResolvedValue(999);
		mockGetChildById.mockResolvedValue(null);
		mockGetAllChildren.mockResolvedValue([{ id: 1, uiMode: 'junior' }]);

		const redirect = await captureAsyncRedirect(() => load(makeEvent({})));

		// 1人しかいないので自動選択
		expect(redirect.location).toBe('/junior/home');
	});

	it('優先順位3: 子供が1人 → 自動選択（/switch を経由しない）', async () => {
		mockGetDefaultChildId.mockResolvedValue(null);
		mockGetAllChildren.mockResolvedValue([{ id: 7, uiMode: 'senior' }]);

		const redirect = await captureAsyncRedirect(() => load(makeEvent({})));

		expect(redirect.location).toBe('/senior/home');
	});

	it('優先順位4: 子供が複数 & 既定未設定 → /switch', async () => {
		mockGetDefaultChildId.mockResolvedValue(null);
		mockGetAllChildren.mockResolvedValue([
			{ id: 1, uiMode: 'preschool' },
			{ id: 2, uiMode: 'elementary' },
		]);

		const redirect = await captureAsyncRedirect(() => load(makeEvent({})));

		expect(redirect.location).toBe('/switch');
	});

	it('優先順位5: 子供 0 人 → /admin/children', async () => {
		mockGetDefaultChildId.mockResolvedValue(null);
		mockGetAllChildren.mockResolvedValue([]);

		const redirect = await captureAsyncRedirect(() => load(makeEvent({})));

		expect(redirect.location).toBe('/admin/children');
	});

	it('#571 defense: 旧 ui_mode (kinder) を preschool に正規化', async () => {
		mockGetChildById.mockResolvedValue({ id: 10, uiMode: 'kinder' });
		mockGetDefaultChildId.mockResolvedValue(null);

		const redirect = await captureAsyncRedirect(() => load(makeEvent({ cookieValue: '10' })));

		// kinder → preschool に正規化される（404 再発防止）
		expect(redirect.location).toBe('/preschool/home');
	});

	it('#571 defense: uiMode が null なら preschool にフォールバック', async () => {
		mockGetChildById.mockResolvedValue({ id: 10, uiMode: null });
		mockGetDefaultChildId.mockResolvedValue(null);

		const redirect = await captureAsyncRedirect(() => load(makeEvent({ cookieValue: '10' })));

		expect(redirect.location).toBe('/preschool/home');
	});
});

// captureRedirect は同期版として定義しているが、
// このファイルでは使っていない。将来の参照用に export しない。
void captureRedirect;
