// tests/unit/services/image-service.test.ts
// キャラクター画像生成サービスのユニットテスト

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Mocks ----------

const mockFindChildForImage = vi.fn();
const mockFindCachedImage = vi.fn();
const mockInsertCharacterImage = vi.fn();
const mockUpdateChildAvatarUrl = vi.fn();

vi.mock('$lib/server/db/image-repo', () => ({
	findChildForImage: (...args: unknown[]) => mockFindChildForImage(...args),
	findCachedImage: (...args: unknown[]) => mockFindCachedImage(...args),
	insertCharacterImage: (...args: unknown[]) => mockInsertCharacterImage(...args),
	updateChildAvatarUrl: (...args: unknown[]) => mockUpdateChildAvatarUrl(...args),
}));

const mockSaveFile = vi.fn();
const mockFileExists = vi.fn();

vi.mock('$lib/server/storage', () => ({
	saveFile: (...args: unknown[]) => mockSaveFile(...args),
	fileExists: (...args: unknown[]) => mockFileExists(...args),
}));

vi.mock('$lib/server/storage-keys', () => ({
	generatedImageKey: (_tenant: string, childId: number, hash: string, ext: string) =>
		`generated/${childId}/${hash}.${ext}`,
	storageKeyToPublicUrl: (key: string) => `/${key}`,
}));

const mockGenerateContent = vi.fn();

vi.mock('@google/generative-ai', () => {
	return {
		GoogleGenerativeAI: class {
			getGenerativeModel() {
				return { generateContent: mockGenerateContent };
			}
		},
	};
});

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// image-prompt はそのまま使う（純粋関数）
// vi.mock なしで実際の関数を使用

// ---------- Import after mocks ----------

import {
	generateAvatar,
	generateFavicon,
	getAvatarUrl,
	getFaviconPath,
} from '../../../src/lib/server/services/image-service';

// ---------- Helpers ----------

const TENANT = 'test-tenant';
const CHILD_ID = 1;

function makeChild(overrides: Record<string, unknown> = {}) {
	return {
		id: CHILD_ID,
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
	// デフォルト: GEMINI_API_KEY なし（フォールバック動作）
	process.env.GEMINI_API_KEY = undefined;
	mockFindChildForImage.mockResolvedValue(makeChild());
	mockFindCachedImage.mockResolvedValue(null);
	mockFileExists.mockResolvedValue(false);
	mockSaveFile.mockResolvedValue(undefined);
	mockInsertCharacterImage.mockResolvedValue(undefined);
	mockUpdateChildAvatarUrl.mockResolvedValue(undefined);
});

// ==========================================================
// generateAvatar
// ==========================================================

describe('generateAvatar', () => {
	it('子供が見つからない → NOT_FOUND', async () => {
		mockFindChildForImage.mockResolvedValue(null);
		const result = await generateAvatar(999, { characterType: 'beginner', level: 1 }, TENANT);
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	it('キャッシュがある場合 → キャッシュを返す', async () => {
		mockFindCachedImage.mockResolvedValue({ filePath: 'generated/1/abc.png' });
		mockFileExists.mockResolvedValue(true);

		const result = await generateAvatar(CHILD_ID, { characterType: 'beginner', level: 1 }, TENANT);

		expect(result).toEqual({
			filePath: '/generated/1/abc.png',
			isGenerated: true,
		});
		expect(mockGenerateContent).not.toHaveBeenCalled();
	});

	it('キャッシュのファイルが存在しない場合 → 再生成', async () => {
		mockFindCachedImage.mockResolvedValue({ filePath: 'generated/1/abc.png' });
		mockFileExists.mockResolvedValue(false);
		// Gemini API キーなし → フォールバックSVG
		process.env.GEMINI_API_KEY = '';

		const result = await generateAvatar(CHILD_ID, { characterType: 'beginner', level: 1 }, TENANT);

		expect(result).toHaveProperty('filePath');
		expect(result).toHaveProperty('isGenerated', false);
		expect(mockSaveFile).toHaveBeenCalledTimes(1);
	});

	it('Gemini APIキーなし → フォールバックSVG', async () => {
		process.env.GEMINI_API_KEY = '';

		const result = await generateAvatar(CHILD_ID, { characterType: 'beginner', level: 1 }, TENANT);

		expect(result).toHaveProperty('isGenerated', false);
		expect(mockSaveFile).toHaveBeenCalledWith(
			expect.stringContaining('.svg'),
			expect.any(Buffer),
			'image/svg+xml',
		);
		expect(mockInsertCharacterImage).toHaveBeenCalledTimes(1);
		expect(mockUpdateChildAvatarUrl).toHaveBeenCalledTimes(1);
	});

	it('Gemini API成功 → 生成画像を保存', async () => {
		process.env.GEMINI_API_KEY = 'test-key';
		const imageBuffer = Buffer.from('fake-image-data');
		mockGenerateContent.mockResolvedValue({
			response: {
				candidates: [
					{
						content: {
							parts: [
								{
									inlineData: {
										mimeType: 'image/png',
										data: imageBuffer.toString('base64'),
									},
								},
							],
						},
					},
				],
			},
		});

		const result = await generateAvatar(CHILD_ID, { characterType: 'skilled', level: 10 }, TENANT);

		expect(result).toHaveProperty('isGenerated', true);
		expect(mockSaveFile).toHaveBeenCalledWith(
			expect.stringContaining('.png'),
			expect.any(Buffer),
			'image/png',
		);
	});

	it('Gemini APIが画像なしで返す → フォールバック', async () => {
		process.env.GEMINI_API_KEY = 'test-key';
		mockGenerateContent.mockResolvedValue({
			response: {
				candidates: [
					{
						content: {
							parts: [{ text: 'テキストのみ' }],
						},
					},
				],
			},
		});

		const result = await generateAvatar(CHILD_ID, { characterType: 'beginner', level: 1 }, TENANT);

		expect(result).toHaveProperty('isGenerated', false);
	});

	it('Gemini API例外 → フォールバック', async () => {
		process.env.GEMINI_API_KEY = 'test-key';
		mockGenerateContent.mockRejectedValue(new Error('API rate limit'));

		const result = await generateAvatar(CHILD_ID, { characterType: 'beginner', level: 1 }, TENANT);

		expect(result).toHaveProperty('isGenerated', false);
	});
});

// ==========================================================
// getAvatarUrl
// ==========================================================

describe('getAvatarUrl', () => {
	it('子供が見つからない → null', async () => {
		mockFindChildForImage.mockResolvedValue(null);
		const result = await getAvatarUrl(999, TENANT);
		expect(result).toBeNull();
	});

	it('avatarUrl未設定 → null', async () => {
		mockFindChildForImage.mockResolvedValue(makeChild({ avatarUrl: null }));
		const result = await getAvatarUrl(CHILD_ID, TENANT);
		expect(result).toBeNull();
	});

	it('avatarUrl設定済み → URL返却', async () => {
		mockFindChildForImage.mockResolvedValue(makeChild({ avatarUrl: '/generated/1/abc.png' }));
		const result = await getAvatarUrl(CHILD_ID, TENANT);
		expect(result).toBe('/generated/1/abc.png');
	});
});

// ==========================================================
// generateFavicon
// ==========================================================

describe('generateFavicon', () => {
	it('既に生成済みfavicon → キャッシュ返却', async () => {
		mockFileExists.mockImplementation((path: string) =>
			Promise.resolve(path === 'generated/favicon.png'),
		);

		const result = await generateFavicon(TENANT);
		expect(result).toEqual({
			filePath: '/generated/favicon.png',
			isGenerated: true,
		});
	});

	it('icon-character.png が存在 → フォールバック', async () => {
		mockFileExists.mockImplementation((path: string) =>
			Promise.resolve(path === 'icon-character.png'),
		);

		const result = await generateFavicon(TENANT);
		expect(result).toEqual({
			filePath: '/icon-character.png',
			isGenerated: false,
		});
	});

	it('何もない + APIキーなし → 静的アイコンフォールバック', async () => {
		mockFileExists.mockResolvedValue(false);
		process.env.GEMINI_API_KEY = '';

		const result = await generateFavicon(TENANT);
		expect(result).toEqual({
			filePath: '/icon-character.png',
			isGenerated: false,
		});
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
