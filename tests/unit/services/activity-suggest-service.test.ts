// tests/unit/services/activity-suggest-service.test.ts
// AI活動提案サービスのユニットテスト（フォールバック） (#721, #987: provider 層移行)

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
	process.env.BEDROCK_DISABLED = 'true';
});

import { suggestActivity } from '../../../src/lib/server/services/activity-suggest-service';

describe('suggestActivity (fallback)', () => {
	it('スポーツ系のキーワードで「うんどう」に分類される', async () => {
		const result = await suggestActivity('サッカーの練習');
		expect(result.categoryId).toBe(1); // うんどう
		expect(result.icon).toBe('⚽');
		expect(result.source).toBe('fallback');
	});

	it('学習系のキーワードで「べんきょう」に分類される', async () => {
		const result = await suggestActivity('宿題をした');
		expect(result.categoryId).toBe(2); // べんきょう
		expect(result.icon).toBe('📝');
	});

	it('生活系のキーワードで「せいかつ」に分類される', async () => {
		const result = await suggestActivity('おかたづけした');
		expect(result.categoryId).toBe(3); // せいかつ
		expect(result.icon).toBe('🧹');
		expect(result.basePoints).toBe(3);
	});

	it('社会性のキーワードで「こうりゅう」に分類される', async () => {
		const result = await suggestActivity('ともだちとあそんだ');
		expect(result.categoryId).toBe(4); // こうりゅう
	});

	it('創造系のキーワードで「そうぞう」に分類される', async () => {
		const result = await suggestActivity('おえかきした');
		expect(result.categoryId).toBe(5); // そうぞう
		expect(result.icon).toBe('🎨');
	});

	it('習い事系のキーワードは8Pになる', async () => {
		const result = await suggestActivity('ピアノの練習');
		expect(result.basePoints).toBe(8);
		expect(result.icon).toBe('🎹');
		expect(result.categoryId).toBe(5); // そうぞう
	});

	it('水泳は8Pでうんどうカテゴリ', async () => {
		const result = await suggestActivity('水泳の練習');
		expect(result.basePoints).toBe(8);
		expect(result.categoryId).toBe(1);
		expect(result.icon).toBe('🏊');
	});

	it('マッチしない入力はデフォルト値を返す', async () => {
		const result = await suggestActivity('いろいろやった');
		expect(result.categoryId).toBe(3); // せいかつ（デフォルト）
		expect(result.icon).toBe('📝');
		expect(result.basePoints).toBe(5);
	});

	it('ひらがな入力ではnameKanaが設定され、NAME_PAIR_TABLEでnameKanjiも推定される', async () => {
		const result = await suggestActivity('おかたづけした');
		expect(result.nameKana).toBe('おかたづけした');
		expect(result.nameKanji).toBe('お片付け');
	});

	it('漢字入力ではnameKanjiが設定され、NAME_PAIR_TABLEでnameKanaも推定される', async () => {
		const result = await suggestActivity('水泳の練習');
		expect(result.nameKanji).toBe('水泳の練習');
		expect(result.nameKana).toBe('すいえい');
	});

	it('sourceが常にfallbackになる', async () => {
		const result = await suggestActivity('なにか');
		expect(result.source).toBe('fallback');
	});
});
