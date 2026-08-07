// tests/unit/services/receipt-ocr-service.test.ts
// receipt-ocr-service ユニットテスト — AI provider による領収書OCR (#721, #987: provider 層移行)

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConverseWithImageAndTool = vi.fn();
const mockIsAiAvailable = vi.fn();

vi.mock('$lib/server/ai/factory', () => ({
	isAiAvailable: () => mockIsAiAvailable(),
	getAiProvider: () => ({
		name: 'bedrock-claude',
		converseWithImageAndTool: (...args: unknown[]) => mockConverseWithImageAndTool(...args),
	}),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { POINTS_LABELS } from '$lib/domain/labels';
import {
	AI_PROVIDER_UNAVAILABLE_LOG_TERM,
	resetAiAvailabilityLatch,
} from '$lib/server/ai/availability';
import { logger } from '$lib/server/logger';
import { ocrReceipt } from '$lib/server/services/receipt-ocr-service';

describe('receipt-ocr-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetAiAvailabilityLatch();
		mockIsAiAvailable.mockReturnValue(true);
	});

	describe('AI 未利用時', () => {
		it('AI が無効の場合 AI_UNAVAILABLE を返す', async () => {
			mockIsAiAvailable.mockReturnValue(false);
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({ error: 'AI_UNAVAILABLE' });
			expect(mockConverseWithImageAndTool).not.toHaveBeenCalled();
		});

		// 顧客には「運営に通知済み」と出す。この分岐が silent のままだと嘘になる
		// (#4366 merge 時点は log が 1 行も出ていなかった)。
		// 同時に、毎リクエスト出して本物の異常を埋もれさせない (#4366 害 c) ことも固定する。
		it('AI が無効なことを運営に届ける log を、複数回呼んでも 1 行だけ出す', async () => {
			mockIsAiAvailable.mockReturnValue(false);

			await ocrReceipt('base64data', 'image/jpeg');
			await ocrReceipt('base64data', 'image/jpeg');
			await ocrReceipt('base64data', 'image/jpeg');

			const alerts = vi
				.mocked(logger.warn)
				.mock.calls.map((call) => String(call[0]))
				.filter((line) => line.includes(AI_PROVIDER_UNAVAILABLE_LOG_TERM));
			expect(alerts).toEqual([`${AI_PROVIDER_UNAVAILABLE_LOG_TERM} reason=not-configured`]);
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

		it('AI provider に正しい引数を渡す', async () => {
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
		it('画像起因・一時的な失敗は OCR_FAILED を返し、次アクションを示す', async () => {
			mockConverseWithImageAndTool.mockRejectedValueOnce(new Error('API rate limit exceeded'));
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({
				error: 'OCR_FAILED',
				message: POINTS_LABELS.receiptOcrFailed,
			});
		});

		it('非Errorオブジェクトがスローされた場合も OCR_FAILED を返す', async () => {
			mockConverseWithImageAndTool.mockRejectedValueOnce('network timeout');
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({
				error: 'OCR_FAILED',
				message: POINTS_LABELS.receiptOcrFailed,
			});
		});

		// #4366 (b): AI 側の事情 (権限なし / キー不正) を「画像の読み取りに失敗しました」に
		// 丸めると、顧客は自分の写真が悪いと誤解して撮り直す。原因が AI 側なら撮り直しを促さない。
		it.each([
			[
				'Bedrock 権限なし',
				Object.assign(new Error('not authorized'), { name: 'AccessDeniedException' }),
			],
			[
				'資格情報なし',
				Object.assign(new Error('Could not load credentials from any providers'), {
					name: 'CredentialsProviderError',
				}),
			],
			[
				'モデル未存在',
				Object.assign(new Error('model not found'), { name: 'ResourceNotFoundException' }),
			],
			['Gemini キー不正', new Error('[400 Bad Request] API key not valid')],
		])('AI 不作動 (%s) は AI_UNAVAILABLE を返し、撮り直しを促さない', async (_label, err) => {
			mockConverseWithImageAndTool.mockRejectedValueOnce(err);
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({ error: 'AI_UNAVAILABLE' });
			// 「画像の読み取りに失敗」と言わないこと自体を assert する (文言の丸めを再発させない)
			expect(JSON.stringify(result)).not.toContain('画像');
		});

		it('内部例外メッセージを顧客向け文言に載せない (ADR-0062 §2)', async () => {
			mockConverseWithImageAndTool.mockRejectedValueOnce(
				new Error('ValidationException: stack trace at /var/task/index.js:42'),
			);
			const result = await ocrReceipt('base64data', 'image/jpeg');
			expect(result).toEqual({
				error: 'OCR_FAILED',
				message: POINTS_LABELS.receiptOcrFailed,
			});
			expect(JSON.stringify(result)).not.toContain('/var/task');
		});
	});
});
