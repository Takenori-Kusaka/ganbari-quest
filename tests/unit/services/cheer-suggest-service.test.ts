// tests/unit/services/cheer-suggest-service.test.ts
// AI 応援提案サービスのユニットテスト（フォールバック） (#2273)

import { beforeAll, describe, expect, it, vi } from 'vitest';

// AI provider factory をモック — AI 無効でフォールバック経由にする
vi.mock('$lib/server/ai/factory', () => ({
	isAiAvailable: () => false,
	getAiProvider: vi.fn(),
}));
vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

beforeAll(() => {
	process.env.GEMINI_API_KEY = undefined;
});

import { suggestCheer } from '../../../src/lib/server/services/cheer-suggest-service';

describe('suggestCheer (fallback)', () => {
	it('運動会1位で「うんどう」カテゴリ・金メダル・500P', async () => {
		const result = await suggestCheer('運動会で1位');
		expect(result.category).toBe('うんどう');
		expect(result.icon).toBe('🥇');
		expect(result.points).toBe(500);
		expect(result.source).toBe('fallback');
	});

	it('テスト100点で「べんきょう」カテゴリ・満点絵文字・500P', async () => {
		const result = await suggestCheer('テストで100点');
		expect(result.category).toBe('べんきょう');
		expect(result.icon).toBe('💯');
		expect(result.points).toBe(500);
	});

	it('お皿洗いで「せいかつ」カテゴリ・100P', async () => {
		const result = await suggestCheer('お皿を進んで洗った');
		expect(result.category).toBe('せいかつ');
		expect(result.icon).toBe('🍽️');
		expect(result.points).toBe(100);
	});

	it('ピアノ演奏で「そうぞう」カテゴリ・200P', async () => {
		const result = await suggestCheer('ピアノの発表会');
		expect(result.category).toBe('そうぞう');
		expect(result.icon).toBe('🎹');
		expect(result.points).toBe(200);
	});

	it('挨拶で「こうりゅう」カテゴリ・50P', async () => {
		const result = await suggestCheer('挨拶をきちんとした');
		expect(result.category).toBe('こうりゅう');
		expect(result.icon).toBe('👋');
		expect(result.points).toBe(50);
	});

	it('宿題で「べんきょう」カテゴリ・100P', async () => {
		const result = await suggestCheer('宿題をひとりでやった');
		expect(result.category).toBe('べんきょう');
		expect(result.icon).toBe('✏️');
		expect(result.points).toBe(100);
	});

	it('リレーで「うんどう」カテゴリ・200P', async () => {
		const result = await suggestCheer('リレーで頑張った');
		expect(result.category).toBe('うんどう');
		expect(result.icon).toBe('🏃');
		expect(result.points).toBe(200);
	});

	it('お絵描きで「そうぞう」カテゴリ・100P', async () => {
		const result = await suggestCheer('お絵描きした');
		expect(result.category).toBe('そうぞう');
		expect(result.icon).toBe('🎨');
		expect(result.points).toBe(100);
	});

	it('マッチしない入力はデフォルト値を返す', async () => {
		const result = await suggestCheer('何かよくわからないこと');
		expect(result.category).toBe('とくべつ');
		expect(result.icon).toBe('✨');
		expect(result.points).toBe(100);
		expect(result.source).toBe('fallback');
	});

	it('sourceが常にfallbackになる（AI無効時）', async () => {
		const result = await suggestCheer('何でも');
		expect(result.source).toBe('fallback');
	});

	it('長い入力は50文字にトリミングされる', async () => {
		const longText = 'あ'.repeat(100);
		const result = await suggestCheer(longText);
		expect(result.reason.length).toBeLessThanOrEqual(50);
	});

	it('reason フィールドが入力テキストから生成される', async () => {
		const result = await suggestCheer('運動会で1位');
		expect(result.reason).toBe('運動会で1位');
	});
});
