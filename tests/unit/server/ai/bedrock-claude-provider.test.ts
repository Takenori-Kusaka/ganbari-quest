// tests/unit/server/ai/bedrock-claude-provider.test.ts
// BedrockClaudeProvider の可用性申告 + 呼び出し (#4366)
//
// ## この test が塞ぐ死角
//
// #4366 まで `src/lib/server/ai/` を直接テストする file は 1 件も無く、`isAvailable()` が
// **true を返す側の分岐は一度も検証されていなかった**。その結果「権限も env も見ずに常に true」
// が本番で 1 度も検出されず、AI 提案が恒常的に無言で不作動になった。
//
// 実 API は叩かない (SDK を mock する)。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
	BedrockRuntimeClient: class {
		send = (...args: unknown[]) => mockSend(...args);
	},
	ConverseCommand: class {
		constructor(public readonly input: Record<string, unknown>) {}
	},
}));

const MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

const TOOL = {
	name: 'suggest',
	description: 'テスト用ツール',
	inputSchema: { type: 'object', properties: {}, required: [] },
};

/**
 * module graph を作り直して provider と latch を同じ graph から取る。
 * (latch は module 内 state なので、graph を跨ぐと別インスタンスになる)
 */
async function load() {
	vi.resetModules();
	const { BedrockClaudeProvider } = await import('$lib/server/ai/bedrock-claude-provider');
	const availability = await import('$lib/server/ai/availability');
	availability.resetAiAvailabilityLatch();
	return { provider: new BedrockClaudeProvider(), availability };
}

function toolUseResponse(input: Record<string, unknown>) {
	return { output: { message: { content: [{ toolUse: { name: TOOL.name, input } }] } } };
}

beforeEach(() => {
	vi.clearAllMocks();
	process.env.BEDROCK_MODEL_ID = MODEL_ID;
	delete process.env.BEDROCK_DISABLED;
});

describe('BedrockClaudeProvider.isAvailable()', () => {
	it('env が配られていれば true (true を返す側の経路)', async () => {
		const { provider } = await load();
		expect(provider.isAvailable()).toBe(true);
	});

	it('BEDROCK_MODEL_ID が配られていなければ false — 権限も env も無い本番 Lambda の状態 (#4366 再現)', async () => {
		delete process.env.BEDROCK_MODEL_ID;
		const { provider } = await load();
		expect(provider.isAvailable()).toBe(false);
	});

	it('BEDROCK_MODEL_ID が空文字なら false (配られていないのと同じ)', async () => {
		process.env.BEDROCK_MODEL_ID = '';
		const { provider } = await load();
		expect(provider.isAvailable()).toBe(false);
	});

	it('BEDROCK_DISABLED=true なら env が揃っていても false', async () => {
		process.env.BEDROCK_DISABLED = 'true';
		const { provider } = await load();
		expect(provider.isAvailable()).toBe(false);
	});

	it('権限エラーで 1 度落ちた後は false になる (毎回呼びに行かない)', async () => {
		const { provider } = await load();
		expect(provider.isAvailable()).toBe(true);

		const denied = new Error('User is not authorized to perform: bedrock:InvokeModel');
		denied.name = 'AccessDeniedException';
		mockSend.mockRejectedValueOnce(denied);

		await expect(
			provider.converseWithTool({ system: 's', userMessage: 'u', tool: TOOL }),
		).rejects.toThrow(/not authorized/);

		expect(provider.isAvailable()).toBe(false);
	});

	it('一時的なエラーでは false にしない (throttling で AI を恒久停止させない)', async () => {
		const { provider } = await load();
		const throttled = new Error('Too many requests');
		throttled.name = 'ThrottlingException';
		mockSend.mockRejectedValueOnce(throttled);

		await expect(
			provider.converseWithTool({ system: 's', userMessage: 'u', tool: TOOL }),
		).rejects.toThrow(/Too many requests/);

		expect(provider.isAvailable()).toBe(true);
	});
});

describe('BedrockClaudeProvider.converseWithTool()', () => {
	it('tool_use ブロックを抽出して返す', async () => {
		const { provider } = await load();
		mockSend.mockResolvedValueOnce(toolUseResponse({ categoryId: '1' }));

		const result = await provider.converseWithTool({
			system: 'system',
			userMessage: 'サッカーの練習',
			tool: TOOL,
		});

		expect(result).toEqual({ toolName: 'suggest', input: { categoryId: '1' } });
	});

	it('配られた BEDROCK_MODEL_ID を呼び出しに使う (module 読込時に固定しない)', async () => {
		process.env.BEDROCK_MODEL_ID = 'custom.model-id';
		const { provider } = await load();
		mockSend.mockResolvedValueOnce(toolUseResponse({ ok: true }));

		await provider.converseWithTool({ system: 's', userMessage: 'u', tool: TOOL });

		const command = mockSend.mock.calls[0]?.[0] as { input: { modelId: string } };
		expect(command.input.modelId).toBe('custom.model-id');
	});

	it('既定モデルは US inference profile (呼べない base model ID を既定に残さない、#4726)', async () => {
		// #4726: Claude Haiku 4.5 は base model ID の on-demand 呼び出しを受け付けず
		// `ValidationException: ... with on-demand throughput isn't supported` になる。
		// #4367 AC3 が既定にした base model ID は本番で 1 回も成立せず、AI 提案は 100% fallback
		// だった。ここが base model ID に戻ると同じ罠を再生産するため既定値そのものを固定する。
		// `global.` は米国外を含みうる (privacy 第 10 条の移転先国「米国」が崩れる) ので除外する。
		//
		// env 未配布時は isAvailable() === false (#4366) だが、converseWithTool は可用性判定と
		// 独立に既定値を使うため、ここで既定値そのものを固定できる。
		delete process.env.BEDROCK_MODEL_ID;
		const { provider } = await load();
		mockSend.mockResolvedValueOnce(toolUseResponse({ ok: true }));

		await provider.converseWithTool({ system: 's', userMessage: 'u', tool: TOOL });

		const command = mockSend.mock.calls[0]?.[0] as { input: { modelId: string } };
		expect(command.input.modelId).toBe('us.anthropic.claude-haiku-4-5-20251001-v1:0');
		// base model ID (prefix 無し) / 米国外を含む global. に戻った瞬間に落ちる
		expect(command.input.modelId).toMatch(/^us\./);
	});

	it('tool_use ブロックが無い応答は例外にする (握り潰さない)', async () => {
		const { provider } = await load();
		mockSend.mockResolvedValueOnce({ output: { message: { content: [{ text: 'hello' }] } } });

		await expect(
			provider.converseWithTool({ system: 's', userMessage: 'u', tool: TOOL }),
		).rejects.toThrow(/No tool_use block/);
	});
});

describe('BedrockClaudeProvider.converseWithImageAndTool()', () => {
	it('画像を渡して tool_use ブロックを抽出する', async () => {
		const { provider } = await load();
		mockSend.mockResolvedValueOnce(toolUseResponse({ amount: 1980, rawText: '合計 1980' }));

		const result = await provider.converseWithImageAndTool({
			system: 's',
			userText: 'u',
			imageBase64: Buffer.from('image-bytes').toString('base64'),
			imageMimeType: 'image/png',
			tool: TOOL,
		});

		expect(result.input).toEqual({ amount: 1980, rawText: '合計 1980' });
		const command = mockSend.mock.calls[0]?.[0] as {
			input: { messages: Array<{ content: Array<{ image?: { format: string } }> }> };
		};
		expect(command.input.messages[0]?.content[0]?.image?.format).toBe('png');
	});

	it('画像経路の権限エラーも以降の isAvailable() を false にする', async () => {
		const { provider } = await load();
		const denied = new Error('access denied');
		denied.name = 'AccessDeniedException';
		mockSend.mockRejectedValueOnce(denied);

		await expect(
			provider.converseWithImageAndTool({
				system: 's',
				userText: 'u',
				imageBase64: 'AAAA',
				imageMimeType: 'image/jpeg',
				tool: TOOL,
			}),
		).rejects.toThrow(/access denied/);

		expect(provider.isAvailable()).toBe(false);
	});
});
