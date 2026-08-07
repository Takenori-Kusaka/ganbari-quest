// tests/unit/server/ai/factory.test.ts
// AI provider factory の解決規則 + env schema との一致 (#4366 AC2 / AC3)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
	BedrockRuntimeClient: class {
		send = vi.fn();
	},
	ConverseCommand: class {
		constructor(public readonly input: Record<string, unknown>) {}
	},
}));

vi.mock('@google/generative-ai', () => ({
	GoogleGenerativeAI: class {
		constructor(public readonly apiKey: string) {}
		getGenerativeModel() {
			return { generateContent: vi.fn() };
		}
	},
}));

import { getAiProvider, isAiAvailable } from '$lib/server/ai/factory';

beforeEach(() => {
	delete process.env.AI_PROVIDER;
	delete process.env.BEDROCK_MODEL_ID;
	delete process.env.BEDROCK_DISABLED;
	delete process.env.GEMINI_API_KEY;
});

describe('getAiProvider()', () => {
	it('AI_PROVIDER 未指定なら bedrock (Lambda 既定)', () => {
		expect(getAiProvider().name).toBe('bedrock-claude');
	});

	it("AI_PROVIDER='bedrock' で bedrock", () => {
		process.env.AI_PROVIDER = 'bedrock';
		expect(getAiProvider().name).toBe('bedrock-claude');
	});

	it("AI_PROVIDER='gemini' で gemini", () => {
		process.env.AI_PROVIDER = 'gemini';
		expect(getAiProvider().name).toBe('gemini');
	});
});

describe('isAiAvailable()', () => {
	it('既定 (bedrock) で env が配られていなければ false', () => {
		expect(isAiAvailable()).toBe(false);
	});

	it('既定 (bedrock) で env が配られていれば true', () => {
		process.env.BEDROCK_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
		expect(isAiAvailable()).toBe(true);
	});

	it('gemini でキーが配られていなければ false', () => {
		process.env.AI_PROVIDER = 'gemini';
		expect(isAiAvailable()).toBe(false);
	});

	it('gemini でキーが配られていれば true', () => {
		process.env.AI_PROVIDER = 'gemini';
		process.env.GEMINI_API_KEY = 'test-api-key';
		expect(isAiAvailable()).toBe(true);
	});
});

/**
 * AC3: **env schema が受理する値を factory が必ず処理する**ことを機械で保証する。
 *
 * 以前は schema が `'mock'` を通す一方 factory が bedrock にフォールバックしており、設定した
 * 本人が「受理されたのに別 provider が動いている」ことに気づけなかった。schema 側に provider を
 * 足したのに factory の分岐を足し忘れる再発を、ここで落とす。
 */
describe('env schema と factory の一致 (fitness)', () => {
	it('AI_PROVIDER schema の全値が、それぞれ固有の provider に解決される', () => {
		const envSource = readFileSync(join(process.cwd(), 'src/lib/runtime/env.ts'), 'utf-8');
		const match = envSource.match(/AI_PROVIDER:\s*z\.enum\(\[([^\]]*)\]\)/);
		expect(match, 'env.ts の AI_PROVIDER schema を読み取れませんでした').not.toBeNull();

		const declared = [...(match?.[1] ?? '').matchAll(/'([^']+)'/g)]
			.map((m) => m[1])
			.filter((v): v is string => typeof v === 'string');
		expect(declared.length).toBeGreaterThan(0);

		const resolved = new Map<string, string>();
		for (const value of declared) {
			process.env.AI_PROVIDER = value;
			resolved.set(value, getAiProvider().name);
		}

		// 「schema が通すのに factory が別の provider に丸める」= 2 値が同じ provider に落ちる状態を落とす
		expect(new Set(resolved.values()).size).toBe(declared.length);
	});
});
