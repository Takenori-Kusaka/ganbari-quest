// tests/unit/services/reward-suggest-service.test.ts
// AIごほうび提案サービスのユニットテスト（フォールバック） (#719)

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@google/generative-ai', () => ({
	GoogleGenerativeAI: vi.fn(),
}));
vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

beforeAll(() => {
	process.env.GEMINI_API_KEY = undefined;
});

import { suggestReward } from '../../../src/lib/server/services/reward-suggest-service';

describe('suggestReward (fallback)', () => {
	it('おもちゃ系キーワードで「もの」カテゴリになる', async () => {
		const result = await suggestReward('すきなおもちゃ');
		expect(result.category).toBe('もの');
		expect(result.icon).toBe('🧸');
		expect(result.points).toBe(500);
		expect(result.source).toBe('fallback');
	});

	it('お菓子系キーワードで「もの」カテゴリ・100P', async () => {
		const result = await suggestReward('おかしを買ってもらう');
		expect(result.category).toBe('もの');
		expect(result.icon).toBe('🍬');
		expect(result.points).toBe(100);
	});

	it('外食系キーワードで「たいけん」カテゴリ', async () => {
		const result = await suggestReward('がいしょくに行く');
		expect(result.category).toBe('たいけん');
		expect(result.icon).toBe('🍽️');
		expect(result.points).toBe(500);
	});

	it('映画系キーワードで「たいけん」カテゴリ', async () => {
		const result = await suggestReward('えいがを見に行く');
		expect(result.category).toBe('たいけん');
		expect(result.icon).toBe('🎬');
		expect(result.points).toBe(500);
	});

	it('ゲーム時間キーワードで「たいけん」カテゴリ・200P', async () => {
		const result = await suggestReward('ゲーム時間を延長');
		expect(result.category).toBe('たいけん');
		expect(result.icon).toBe('🎮');
		expect(result.points).toBe(200);
	});

	it('おこづかい系キーワードで「おこづかい」カテゴリ', async () => {
		const result = await suggestReward('おこづかい');
		expect(result.category).toBe('おこづかい');
		expect(result.icon).toBe('💰');
		expect(result.points).toBe(200);
	});

	it('500円キーワードで「おこづかい」カテゴリ・500P', async () => {
		const result = await suggestReward('500円もらう');
		expect(result.category).toBe('おこづかい');
		expect(result.icon).toBe('💴');
		expect(result.points).toBe(500);
	});

	it('夜更かし系キーワードで「とくべつ」カテゴリ', async () => {
		const result = await suggestReward('よふかしする');
		expect(result.category).toBe('とくべつ');
		expect(result.icon).toBe('🌙');
		expect(result.points).toBe(300);
	});

	it('旅行系キーワードで「たいけん」カテゴリ・1000P', async () => {
		const result = await suggestReward('りょこうに行きたい');
		expect(result.category).toBe('たいけん');
		expect(result.icon).toBe('✈️');
		expect(result.points).toBe(1000);
	});

	it('プリセットのタイトル完全一致でプリセット値を返す', async () => {
		const result = await suggestReward('すきなシール');
		expect(result.title).toBe('すきなシール');
		expect(result.points).toBe(50);
		expect(result.icon).toBe('⭐');
		expect(result.category).toBe('もの');
	});

	it('マッチしない入力はデフォルト値を返す', async () => {
		const result = await suggestReward('なにかいいもの');
		expect(result.category).toBe('とくべつ');
		expect(result.icon).toBe('🎁');
		expect(result.points).toBe(200);
		expect(result.source).toBe('fallback');
	});

	it('sourceが常にfallbackになる', async () => {
		const result = await suggestReward('何でもいい');
		expect(result.source).toBe('fallback');
	});

	it('長い入力は50文字にトリミングされる', async () => {
		const longText = 'あ'.repeat(100);
		const result = await suggestReward(longText);
		expect(result.title.length).toBeLessThanOrEqual(50);
	});
});
