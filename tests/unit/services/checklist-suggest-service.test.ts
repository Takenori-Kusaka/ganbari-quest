// tests/unit/services/checklist-suggest-service.test.ts
// AIチェックリスト提案サービスのユニットテスト（フォールバック） (#720)

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

import { suggestChecklist } from '../../../src/lib/server/services/checklist-suggest-service';

describe('suggestChecklist (fallback)', () => {
	it('がっこうキーワードで学校プリセットを返す', async () => {
		const result = await suggestChecklist('がっこうのもちもの');
		expect(result.templateName).toBe('がっこうのもちもの');
		expect(result.templateIcon).toBe('🏫');
		expect(result.items.length).toBeGreaterThanOrEqual(5);
		expect(result.source).toBe('fallback');
	});

	it('プールキーワードでプールプリセットを返す', async () => {
		const result = await suggestChecklist('プールの日');
		expect(result.templateName).toBe('プールのもちもの');
		expect(result.templateIcon).toBe('🏊');
		expect(result.items.some((i) => i.name === 'みずぎ')).toBe(true);
		expect(result.source).toBe('fallback');
	});

	it('えんそくキーワードで遠足プリセットを返す', async () => {
		const result = await suggestChecklist('えんそくに行くよ');
		expect(result.templateName).toBe('えんそくのもちもの');
		expect(result.templateIcon).toBe('🚌');
		expect(result.items.some((i) => i.name === 'おべんとう')).toBe(true);
	});

	it('おとまりキーワードでお泊りプリセットを返す', async () => {
		const result = await suggestChecklist('おとまり会');
		expect(result.templateName).toBe('おとまりのもちもの');
		expect(result.templateIcon).toBe('🌙');
		expect(result.items.some((i) => i.name === 'パジャマ')).toBe(true);
	});

	it('たいいくキーワードで体育プリセットを返す', async () => {
		const result = await suggestChecklist('たいいくの日');
		expect(result.templateName).toBe('たいいくのもちもの');
		expect(result.templateIcon).toBe('🤸');
		expect(result.items.some((i) => i.name === 'たいそうぎ')).toBe(true);
	});

	it('小学校キーワードで学校プリセットにマッチする', async () => {
		const result = await suggestChecklist('小学3年生の月曜日');
		expect(result.templateName).toBe('がっこうのもちもの');
		expect(result.source).toBe('fallback');
	});

	it('水泳キーワードでプールプリセットにマッチする', async () => {
		const result = await suggestChecklist('水泳大会');
		expect(result.templateName).toBe('プールのもちもの');
	});

	it('遠足（漢字）キーワードで遠足プリセットにマッチする', async () => {
		const result = await suggestChecklist('遠足のもちもの');
		expect(result.templateName).toBe('えんそくのもちもの');
	});

	it('キャンプキーワードでお泊りプリセットにマッチする', async () => {
		const result = await suggestChecklist('キャンプに行く');
		expect(result.templateName).toBe('おとまりのもちもの');
	});

	it('カンマ区切りの個別アイテムをそのまま返す', async () => {
		const result = await suggestChecklist('えんぴつ、ノート、消しゴム');
		expect(result.templateName).toBe('もちものリスト');
		expect(result.templateIcon).toBe('📋');
		expect(result.items.length).toBe(3);
		// アイコン推定: えんぴつ → ✏️
		expect(result.items[0]?.icon).toBe('✏️');
		// ノート → 📓
		expect(result.items[1]?.icon).toBe('📓');
		expect(result.source).toBe('fallback');
	});

	it('マッチしない短い入力はデフォルトの学校プリセットを返す', async () => {
		const result = await suggestChecklist('なにか');
		expect(result.templateName).toBe('がっこうのもちもの');
		expect(result.source).toBe('fallback');
	});

	it('sourceが常にfallbackになる', async () => {
		const result = await suggestChecklist('何でもいい');
		expect(result.source).toBe('fallback');
	});

	it('全プリセットのアイテムにname/icon/frequency/directionが含まれる', async () => {
		const presetKeywords = ['がっこう', 'プール', 'えんそく', 'たいいく', 'おとまり'];
		for (const keyword of presetKeywords) {
			const result = await suggestChecklist(keyword);
			for (const item of result.items) {
				expect(item.name).toBeTruthy();
				expect(item.icon).toBeTruthy();
				expect(item.frequency).toBeTruthy();
				expect(item.direction).toMatch(/^(bring|return|both)$/);
			}
		}
	});

	it('スペース区切りの個別アイテムも処理される', async () => {
		const result = await suggestChecklist('ハンカチ ティッシュ 水筒');
		expect(result.items.length).toBe(3);
		// ハンカチ → 🧣
		expect(result.items[0]?.icon).toBe('🧣');
		// ティッシュ → 🧻
		expect(result.items[1]?.icon).toBe('🧻');
		// 水筒 → 💧
		expect(result.items[2]?.icon).toBe('💧');
	});
});
