// tests/unit/services/checklist-suggest-service.test.ts
// AIチェックリスト提案サービスのユニットテスト (#720, #987: provider 層移行)

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mockIsAiAvailable = vi.fn(() => false);
const mockConverseWithTool = vi.fn();

// AI provider factory をモック
vi.mock('$lib/server/ai/factory', () => ({
	isAiAvailable: () => mockIsAiAvailable(),
	getAiProvider: () => ({
		converseWithTool: (...args: unknown[]) => mockConverseWithTool(...args),
	}),
}));
vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

beforeAll(() => {
	process.env.BEDROCK_DISABLED = 'true';
});

import { suggestChecklist } from '../../../src/lib/server/services/checklist-suggest-service';

describe('suggestChecklist (fallback)', () => {
	beforeEach(() => {
		mockIsAiAvailable.mockReturnValue(false);
	});

	it('がっこうキーワードで学校プリセットを返す', async () => {
		const result = await suggestChecklist('がっこうのもちもの');
		expect(result.templateName).toBe('がっこうのもちもの');
		expect(result.templateIcon).toBe('🏫');
		expect(result.items.length).toBe(8);
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
				expect(typeof item.name).toBe('string');
				expect(item.name.length).toBeGreaterThan(0);
				expect(typeof item.icon).toBe('string');
				expect(item.icon.length).toBeGreaterThan(0);
				expect(item.frequency).toBe('daily');
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

describe('suggestChecklist (AI provider)', () => {
	beforeEach(() => {
		mockIsAiAvailable.mockReturnValue(true);
		mockConverseWithTool.mockReset();
	});

	it('AI正常レスポンス時にテンプレート名・アイコン・itemsが正しく返る', async () => {
		mockConverseWithTool.mockResolvedValue({
			toolName: 'suggest_checklist',
			input: {
				templateName: 'すいえいのもちもの',
				templateIcon: '🏊',
				items: [
					{ name: 'みずぎ', icon: '🩱', frequency: 'daily', direction: 'both' },
					{ name: 'ぼうし', icon: '🧢', frequency: 'daily', direction: 'both' },
					{ name: 'タオル', icon: '🏖️', frequency: 'daily', direction: 'both' },
					{ name: 'ゴーグル', icon: '🥽', frequency: 'daily', direction: 'both' },
					{ name: 'すいとう', icon: '💧', frequency: 'daily', direction: 'bring' },
				],
			},
		});

		const result = await suggestChecklist('水泳の授業');
		expect(result.templateName).toBe('すいえいのもちもの');
		expect(result.templateIcon).toBe('🏊');
		expect(result.items.length).toBe(5);
		expect(result.items[0]?.name).toBe('みずぎ');
		expect(result.items[0]?.icon).toBe('🩱');
		expect(result.items[0]?.frequency).toBe('daily');
		expect(result.items[0]?.direction).toBe('both');
		expect(result.items[4]?.name).toBe('すいとう');
		expect(result.items[4]?.direction).toBe('bring');
		expect(result.source).toBe('gemini'); // API 互換性のため 'gemini' を維持
	});

	it('AI エラー時にフォールバックに切り替わる', async () => {
		mockConverseWithTool.mockRejectedValue(new Error('AI API error'));

		const result = await suggestChecklist('がっこうのもちもの');
		expect(result.templateName).toBe('がっこうのもちもの');
		expect(result.templateIcon).toBe('🏫');
		expect(result.source).toBe('fallback');
	});

	it('AI レスポンスの items が空の場合フォールバックに切り替わる', async () => {
		mockConverseWithTool.mockResolvedValue({
			toolName: 'suggest_checklist',
			input: {
				templateName: 'テスト',
				templateIcon: '📋',
				items: [],
			},
		});

		const result = await suggestChecklist('がっこうのもちもの');
		// items が空なので Error が throw され、フォールバックへ
		expect(result.source).toBe('fallback');
		expect(result.templateName).toBe('がっこうのもちもの');
	});

	it('isAiAvailable が false の場合フォールバックを使う', async () => {
		mockIsAiAvailable.mockReturnValue(false);

		const result = await suggestChecklist('プールの日');
		expect(result.templateName).toBe('プールのもちもの');
		expect(result.source).toBe('fallback');
		expect(mockConverseWithTool).not.toHaveBeenCalled();
	});

	it('AI レスポンスの direction が不正な場合 "both" にフォールバックする', async () => {
		mockConverseWithTool.mockResolvedValue({
			toolName: 'suggest_checklist',
			input: {
				templateName: 'テスト',
				templateIcon: '📋',
				items: [{ name: 'テスト', icon: '📦', frequency: 'daily', direction: 'invalid' }],
			},
		});

		const result = await suggestChecklist('テスト');
		expect(result.items[0]?.direction).toBe('both');
	});
});
