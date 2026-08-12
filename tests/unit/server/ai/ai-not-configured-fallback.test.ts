// tests/unit/server/ai/ai-not-configured-fallback.test.ts
// AC5: AI 未設定環境で 5 service が全てフォールバックする (#4366)
//
// 既存の service test は `$lib/server/ai/factory` 自体を mock して「AI 無効」を作っていたため、
// **factory / provider の実際の判定は一度も通っていなかった**。ここでは factory を mock せず、
// env が配られていない状態から実 provider の `isAvailable()` を経由させ、5 service の縮退を確かめる。

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
	BedrockRuntimeClient: class {
		send = vi.fn(() => {
			throw new Error('AI 未設定のはずなのに Bedrock を呼びに行きました');
		});
	},
	ConverseCommand: class {
		constructor(public readonly input: Record<string, unknown>) {}
	},
}));

vi.mock('@google/generative-ai', () => ({
	GoogleGenerativeAI: class {
		getGenerativeModel() {
			return {
				generateContent: vi.fn(() => {
					throw new Error('AI 未設定のはずなのに Gemini を呼びに行きました');
				}),
			};
		}
	},
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { isAiAvailable } from '$lib/server/ai/factory';
import { suggestActivity } from '$lib/server/services/activity-suggest-service';
import { suggestChecklist } from '$lib/server/services/checklist-suggest-service';
import { suggestCheer } from '$lib/server/services/cheer-suggest-service';
import { ocrReceipt } from '$lib/server/services/receipt-ocr-service';
import { suggestReward } from '$lib/server/services/reward-suggest-service';

beforeEach(() => {
	// 本番 Lambda の実状態: AI_PROVIDER も BEDROCK_* も GEMINI_API_KEY も配られていない
	delete process.env.AI_PROVIDER;
	delete process.env.BEDROCK_MODEL_ID;
	delete process.env.BEDROCK_DISABLED;
	delete process.env.GEMINI_API_KEY;
});

describe('AI 未設定環境 (env が何も配られていない)', () => {
	it('isAiAvailable() が false を申告する (嘘をつかない)', () => {
		expect(isAiAvailable()).toBe(false);
	});

	it('活動提案はキーワード提案に縮退する', async () => {
		const result = await suggestActivity('サッカーの練習');
		expect(result.source).toBe('fallback');
	});

	it('チェックリスト提案はプリセットに縮退する', async () => {
		const result = await suggestChecklist('プールに行く');
		expect(result.source).toBe('fallback');
	});

	it('応援提案はキーワード提案に縮退する', async () => {
		const result = await suggestCheer('テストで100点をとった');
		expect(result.source).toBe('fallback');
	});

	it('ごほうび提案はキーワード提案に縮退する', async () => {
		const result = await suggestReward('アイスを食べる');
		expect(result.source).toBe('fallback');
	});

	it('領収書 OCR は AI_UNAVAILABLE を返す (画像のせいにしない)', async () => {
		const result = await ocrReceipt('AAAA', 'image/jpeg');
		expect(result).toEqual({ error: 'AI_UNAVAILABLE' });
	});
});
