// tests/unit/server/ai/gemini-provider.test.ts
// GeminiProvider の可用性申告 + JSON 抽出 (#4366)
//
// Gemini 側は #987 以来「API キーの実在を見る」正直な判定だったが、それを固定する test が無かった。
// #4366 で Bedrock を同粒度に揃えるにあたり、**Gemini の既存挙動が変わっていない**ことを回帰として
// 明示する。実 API は叩かない (SDK を mock する)。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGenerateContent = vi.fn();

vi.mock('@google/generative-ai', () => ({
	GoogleGenerativeAI: class {
		constructor(public readonly apiKey: string) {}
		getGenerativeModel() {
			return { generateContent: (...args: unknown[]) => mockGenerateContent(...args) };
		}
	},
}));

const TOOL = {
	name: 'suggest',
	description: 'テスト用ツール',
	inputSchema: {
		type: 'object',
		properties: { categoryId: { type: 'string', description: 'カテゴリ' } },
		required: ['categoryId'],
	},
};

async function load() {
	vi.resetModules();
	const { GeminiProvider } = await import('$lib/server/ai/gemini-provider');
	const availability = await import('$lib/server/ai/availability');
	availability.resetAiAvailabilityLatch();
	return { provider: new GeminiProvider(), availability };
}

function textResponse(text: string) {
	return { response: { text: () => text } };
}

beforeEach(() => {
	vi.clearAllMocks();
	process.env.GEMINI_API_KEY = 'test-api-key';
});

describe('GeminiProvider.isAvailable()', () => {
	it('API キーが配られていれば true (true を返す側の経路)', async () => {
		const { provider } = await load();
		expect(provider.isAvailable()).toBe(true);
	});

	it('API キーが無ければ false', async () => {
		delete process.env.GEMINI_API_KEY;
		const { provider } = await load();
		expect(provider.isAvailable()).toBe(false);
	});

	it('プレースホルダのままなら false (.env.example を丸写しした状態を有効扱いしない)', async () => {
		process.env.GEMINI_API_KEY = 'your_gemini_api_key_here';
		const { provider } = await load();
		expect(provider.isAvailable()).toBe(false);
	});

	it('空文字なら false', async () => {
		process.env.GEMINI_API_KEY = '';
		const { provider } = await load();
		expect(provider.isAvailable()).toBe(false);
	});

	it('キー不正で 1 度落ちた後は false になる', async () => {
		const { provider } = await load();
		expect(provider.isAvailable()).toBe(true);

		mockGenerateContent.mockRejectedValueOnce(new Error('[400] API key not valid'));
		await expect(
			provider.converseWithTool({ system: 's', userMessage: 'u', tool: TOOL }),
		).rejects.toThrow(/API key not valid/);

		expect(provider.isAvailable()).toBe(false);
	});

	it('一時的なエラーでは false にしない', async () => {
		const { provider } = await load();
		mockGenerateContent.mockRejectedValueOnce(new Error('503 Service temporarily overloaded'));
		await expect(
			provider.converseWithTool({ system: 's', userMessage: 'u', tool: TOOL }),
		).rejects.toThrow(/overloaded/);

		expect(provider.isAvailable()).toBe(true);
	});
});

describe('GeminiProvider.converseWithTool()', () => {
	it('生の JSON を抽出して返す', async () => {
		const { provider } = await load();
		mockGenerateContent.mockResolvedValueOnce(textResponse('{"categoryId":"1"}'));

		const result = await provider.converseWithTool({ system: 's', userMessage: 'u', tool: TOOL });
		expect(result).toEqual({ toolName: 'suggest', input: { categoryId: '1' } });
	});

	it('```json コードブロックからも抽出する', async () => {
		const { provider } = await load();
		mockGenerateContent.mockResolvedValueOnce(
			textResponse('説明文\n```json\n{"categoryId":"2"}\n```\n'),
		);

		const result = await provider.converseWithTool({ system: 's', userMessage: 'u', tool: TOOL });
		expect(result.input).toEqual({ categoryId: '2' });
	});

	it('JSON が含まれない応答は例外にする', async () => {
		const { provider } = await load();
		mockGenerateContent.mockResolvedValueOnce(textResponse('わかりません'));

		await expect(
			provider.converseWithTool({ system: 's', userMessage: 'u', tool: TOOL }),
		).rejects.toThrow(/No valid JSON/);
	});

	it('キー未配布のまま呼ぶと設定エラーになる', async () => {
		delete process.env.GEMINI_API_KEY;
		const { provider } = await load();

		await expect(
			provider.converseWithTool({ system: 's', userMessage: 'u', tool: TOOL }),
		).rejects.toThrow(/not configured/);
		expect(mockGenerateContent).not.toHaveBeenCalled();
	});
});

describe('GeminiProvider.converseWithImageAndTool()', () => {
	it('画像を inlineData で渡して JSON を抽出する', async () => {
		const { provider } = await load();
		mockGenerateContent.mockResolvedValueOnce(textResponse('{"amount":1980}'));

		const result = await provider.converseWithImageAndTool({
			system: 's',
			userText: 'u',
			imageBase64: 'AAAA',
			imageMimeType: 'image/png',
			tool: TOOL,
		});

		expect(result.input).toEqual({ amount: 1980 });
		const parts = mockGenerateContent.mock.calls[0]?.[0] as Array<{
			inlineData?: { mimeType: string; data: string };
		}>;
		expect(parts[1]?.inlineData).toEqual({ mimeType: 'image/png', data: 'AAAA' });
	});
});
