// tests/unit/services/receipt-ocr-service.test.ts
// receipt-ocr-service ユニットテスト — Gemini Vision APIによる領収書OCR

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
	logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { ocrReceipt } from '$lib/server/services/receipt-ocr-service';

function geminiResponse(text: string) {
	return {
		response: {
			text: () => text,
		},
	};
}

describe('receipt-ocr-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.GEMINI_API_KEY = 'test-api-key-12345';
	});

	describe('APIキー未設定', () => {
		it('GEMINI_API_KEYが空の場合 NO_API_KEY を返す', async () => {
			process.env.GEMINI_API_KEY = '';
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({ error: 'NO_API_KEY' });
			expect(mockGenerateContent).not.toHaveBeenCalled();
		});

		it('GEMINI_API_KEYが未定義の場合 NO_API_KEY を返す', async () => {
			process.env.GEMINI_API_KEY = '';
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({ error: 'NO_API_KEY' });
		});

		it('GEMINI_API_KEYがプレースホルダーの場合 NO_API_KEY を返す', async () => {
			process.env.GEMINI_API_KEY = 'your_gemini_api_key_here';
			const result = await ocrReceipt('base64data', 'image/png');
			expect(result).toEqual({ error: 'NO_API_KEY' });
		});
	});

	describe('正常系', () => {
		it('有効なJSON応答で金額とrawTextを返す', async () => {
			mockGenerateContent.mockResolvedValueOnce(
				geminiResponse('{"amount": 1980, "rawText": "合計 ¥1,980"}'),
			);
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({ amount: 1980, rawText: '合計 ¥1,980' });
		});

		it('金額が小数の場合は切り捨てて整数にする', async () => {
			mockGenerateContent.mockResolvedValueOnce(
				geminiResponse('{"amount": 1234.99, "rawText": "合計 1234.99円"}'),
			);
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({ amount: 1234, rawText: '合計 1234.99円' });
		});

		it('JSONの前後にテキストがある場合でも正常に抽出する', async () => {
			mockGenerateContent.mockResolvedValueOnce(
				geminiResponse(
					'読み取り結果は以下です:\n{"amount": 500, "rawText": "合計 500円"}\n以上です。',
				),
			);
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({ amount: 500, rawText: '合計 500円' });
		});

		it('Geminiに正しい引数（プロンプトと画像データ）を渡す', async () => {
			mockGenerateContent.mockResolvedValueOnce(
				geminiResponse('{"amount": 100, "rawText": "合計100円"}'),
			);
			await ocrReceipt('dGVzdC1iYXNlNjQ=', 'image/png');
			expect(mockGenerateContent).toHaveBeenCalledWith([
				{ text: expect.stringContaining('この画像は領収書またはレシートです') },
				{
					inlineData: {
						mimeType: 'image/png',
						data: 'dGVzdC1iYXNlNjQ=',
					},
				},
			]);
		});
	});

	describe('OCR失敗', () => {
		it('金額が0の場合 OCR_FAILED を返す', async () => {
			mockGenerateContent.mockResolvedValueOnce(
				geminiResponse('{"amount": 0, "rawText": "読み取り不可"}'),
			);
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({ error: 'OCR_FAILED', message: '読み取り不可' });
		});

		it('金額が負数の場合 OCR_FAILED を返す', async () => {
			mockGenerateContent.mockResolvedValueOnce(
				geminiResponse('{"amount": -100, "rawText": "不正な金額"}'),
			);
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({ error: 'OCR_FAILED', message: '不正な金額' });
		});

		it('rawTextが空の場合はフォールバックメッセージを使う', async () => {
			mockGenerateContent.mockResolvedValueOnce(geminiResponse('{"amount": 0, "rawText": ""}'));
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({
				error: 'OCR_FAILED',
				message: '金額を読み取れませんでした',
			});
		});

		it('レスポンスにJSONが含まれない場合 OCR_FAILED を返す', async () => {
			mockGenerateContent.mockResolvedValueOnce(
				geminiResponse('この画像からは金額を読み取れませんでした。'),
			);
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({
				error: 'OCR_FAILED',
				message: 'レスポンスからJSONを抽出できませんでした',
			});
		});

		it('amountが数値でない場合 OCR_FAILED を返す', async () => {
			mockGenerateContent.mockResolvedValueOnce(
				geminiResponse('{"amount": "abc", "rawText": "読み取り不可"}'),
			);
			const result = await ocrReceipt('base64data', 'image/jpeg');
			// Number("abc") → NaN, Math.floor(NaN || 0) → 0 → OCR_FAILED
			expect(result).toEqual({
				error: 'OCR_FAILED',
				message: '読み取り不可',
			});
		});
	});

	describe('API例外', () => {
		it('Gemini APIがエラーを投げた場合 OCR_FAILED を返す', async () => {
			mockGenerateContent.mockRejectedValueOnce(new Error('API rate limit exceeded'));
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({
				error: 'OCR_FAILED',
				message: '画像の読み取りに失敗しました',
			});
		});

		it('非Errorオブジェクトがスローされた場合も OCR_FAILED を返す', async () => {
			mockGenerateContent.mockRejectedValueOnce('network timeout');
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({
				error: 'OCR_FAILED',
				message: '画像の読み取りに失敗しました',
			});
		});
	});
});
