import { asChildId, type ChildId } from '$lib/domain/ids';
// tests/unit/services/image-service.test.ts
// 画像 **参照系** サービスのユニットテスト。
//
// #4397: アバター / favicon の AI 生成 (Gemini 呼び出し) は機能ごと廃止したため、
// generateAvatar / generateFavicon の test は削除した。撤去が戻っていないことは
// tests/unit/architecture/external-ai-client-boundary.test.ts が固定する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Mocks ----------

const mockFindChildForImage = vi.fn();

vi.mock('$lib/server/db/image-repo', () => ({
	findChildForImage: (...args: unknown[]) => mockFindChildForImage(...args),
}));

const mockFileExists = vi.fn();

vi.mock('$lib/server/storage', () => ({
	fileExists: (...args: unknown[]) => mockFileExists(...args),
}));

// ---------- Import after mocks ----------

import { getAvatarUrl, getFaviconPath } from '../../../src/lib/server/services/image-service';

// ---------- Helpers ----------

const TENANT = 'test-tenant';
const CHILD_ID = asChildId(1);

function makeChild(overrides: Record<string, unknown> = {}) {
	return {
		id: CHILD_ID as ChildId,
		nickname: 'テスト太郎',
		age: 5,
		theme: 'blue',
		avatarUrl: null,
		...overrides,
	};
}

// ---------- Reset ----------

beforeEach(() => {
	vi.clearAllMocks();
	mockFindChildForImage.mockResolvedValue(makeChild());
	mockFileExists.mockResolvedValue(false);
});

// ==========================================================
// getAvatarUrl
// ==========================================================

describe('getAvatarUrl', () => {
	it('子供が見つからない → null', async () => {
		mockFindChildForImage.mockResolvedValue(null);
		const result = await getAvatarUrl(asChildId(999), TENANT);
		expect(result).toBeNull();
	});

	it('avatarUrl未設定 → null', async () => {
		mockFindChildForImage.mockResolvedValue(makeChild({ avatarUrl: null }));
		const result = await getAvatarUrl(CHILD_ID, TENANT);
		expect(result).toBeNull();
	});

	it('アップロード済みアバターは撤去後もそのまま返る (#4397 AC3)', async () => {
		mockFindChildForImage.mockResolvedValue(
			makeChild({ avatarUrl: '/tenants/t/avatars/1/abc.png' }),
		);
		const result = await getAvatarUrl(CHILD_ID, TENANT);
		expect(result).toBe('/tenants/t/avatars/1/abc.png');
	});

	it('過去に保存されたフォールバック SVG も引き続き返る (#4397 AC3)', async () => {
		mockFindChildForImage.mockResolvedValue(makeChild({ avatarUrl: '/generated/1/abc.svg' }));
		const result = await getAvatarUrl(CHILD_ID, TENANT);
		expect(result).toBe('/generated/1/abc.svg');
	});
});

// ==========================================================
// getFaviconPath
// ==========================================================

describe('getFaviconPath', () => {
	it('生成済みfavicon存在 → パス返却', async () => {
		mockFileExists.mockImplementation((path: string) =>
			Promise.resolve(path === 'generated/favicon.png'),
		);
		const result = await getFaviconPath(TENANT);
		expect(result).toBe('/generated/favicon.png');
	});

	it('icon-character.png のみ存在 → フォールバック', async () => {
		mockFileExists.mockImplementation((path: string) =>
			Promise.resolve(path === 'icon-character.png'),
		);
		const result = await getFaviconPath(TENANT);
		expect(result).toBe('/icon-character.png');
	});

	it('何もない → 空文字列', async () => {
		mockFileExists.mockResolvedValue(false);
		const result = await getFaviconPath(TENANT);
		expect(result).toBe('');
	});
});
