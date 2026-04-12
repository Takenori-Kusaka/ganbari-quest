// tests/unit/services/receipt-ocr-service.test.ts
// receipt-ocr-service ユニットテスト — Bedrock Claude Haiku による領収書OCR (#721)

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConverseWithImageAndTool = vi.fn();
const mockIsBedrockAvailable = vi.fn();

vi.mock('$lib/server/ai/bedrock-client', () => ({
	isBedrockAvailable: () => mockIsBedrockAvailable(),
	converseWithImageAndTool: (...args: unknown[]) => mockConverseWithImageAndTool(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { ocrReceipt } from '$lib/server/services/receipt-ocr-service';

describe('receipt-ocr-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsBedrockAvailable.mockReturnValue(true);
	});

	describe('Bedrock 未利用時', () => {
		it('Bedrock が無効の場合 NO_API_KEY を返す', async () => {
			mockIsBedrockAvailable.mockReturnValue(false);
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({ error: 'NO_API_KEY' });
			expect(mockConverseWithImageAndTool).not.toHaveBeenCalled();
		});
	});

	describe('正常系', () => {
		it('有効な応答で金額とrawTextを返す', async () => {
			mockConverseWithImageAndTool.mockResolvedValueOnce({
				toolName: 'read_receipt',
				input: { amount: 1980, rawText: '合計 ¥1,980' },
			});
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({ amount: 1980, rawText: '合計 ¥1,980' });
		});

		it('金額が小数の場合は切り捨てて整数にする', async () => {
			mockConverseWithImageAndTool.mockResolvedValueOnce({
				toolName: 'read_receipt',
				input: { amount: 1234.99, rawText: '合計 1234.99円' },
			});
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({ amount: 1234, rawText: '合計 1234.99円' });
		});

		it('Bedrock に正しい引数を渡す', async () => {
			mockConverseWithImageAndTool.mockResolvedValueOnce({
				toolName: 'read_receipt',
				input: { amount: 100, rawText: '合計100円' },
			});
			await ocrReceipt('dGVzdC1iYXNlNjQ=', 'image/png');
			expect(mockConverseWithImageAndTool).toHaveBeenCalledWith(
				expect.objectContaining({
					imageBase64: 'dGVzdC1iYXNlNjQ=',
					imageMimeType: 'image/png',
					tool: expect.objectContaining({ name: 'read_receipt' }),
				}),
			);
		});
	});

	describe('OCR失敗', () => {
		it('金額が0の場合 OCR_FAILED を返す', async () => {
			mockConverseWithImageAndTool.mockResolvedValueOnce({
				toolName: 'read_receipt',
				input: { amount: 0, rawText: '読み取り不可' },
			});
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({ error: 'OCR_FAILED', message: '読み取り不可' });
		});

		it('金額が負数の場合 OCR_FAILED を返す', async () => {
			mockConverseWithImageAndTool.mockResolvedValueOnce({
				toolName: 'read_receipt',
				input: { amount: -100, rawText: '不正な金額' },
			});
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({ error: 'OCR_FAILED', message: '不正な金額' });
		});

		it('rawTextが空の場合はフォールバックメッセージを使う', async () => {
			mockConverseWithImageAndTool.mockResolvedValueOnce({
				toolName: 'read_receipt',
				input: { amount: 0, rawText: '' },
			});
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({
				error: 'OCR_FAILED',
				message: '金額を読み取れませんでした',
			});
		});
	});

	describe('API例外', () => {
		it('Bedrock APIがエラーを投げた場合 OCR_FAILED を返す', async () => {
			mockConverseWithImageAndTool.mockRejectedValueOnce(new Error('API rate limit exceeded'));
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({
				error: 'OCR_FAILED',
				message: '画像の読み取りに失敗しました',
			});
		});

		it('非Errorオブジェクトがスローされた場合も OCR_FAILED を返す', async () => {
			mockConverseWithImageAndTool.mockRejectedValueOnce('network timeout');
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({
				error: 'OCR_FAILED',
				message: '画像の読み取りに失敗しました',
			});
		});
	});
});
