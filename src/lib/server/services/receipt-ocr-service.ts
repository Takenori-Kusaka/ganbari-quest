// src/lib/server/services/receipt-ocr-service.ts
// 領収書画像から Bedrock Claude Haiku で金額を読み取るサービス (#721)

import { converseWithImageAndTool, isBedrockAvailable } from '$lib/server/ai/bedrock-client';
import { logger } from '$lib/server/logger';

export interface ReceiptOcrResult {
	amount: number;
	rawText: string;
}

const SYSTEM_PROMPT = `あなたは領収書やレシートの画像から金額を読み取るアシスタントです。
画像を分析し、read_receipt ツールを使って結果を返してください。

ルール:
- 合計金額が複数ある場合は、最終的な支払合計額を返す
- 小数点以下は切り捨て（整数、円単位）
- 金額が読み取れない場合は amount=0, rawText="読み取り不可"
- 領収書でない画像の場合は amount=0, rawText="領収書ではありません"`;

const RECEIPT_TOOL = {
	name: 'read_receipt',
	description: '領収書画像から読み取った金額と元テキストを返す',
	inputSchema: {
		type: 'object' as const,
		properties: {
			amount: { type: 'number', description: '合計金額（整数、円単位）' },
			rawText: { type: 'string', description: '読み取った合計行のテキスト' },
		},
		required: ['amount', 'rawText'],
	},
};

/** 領収書画像から金額をOCRで読み取る */
export async function ocrReceipt(
	imageBase64: string,
	mimeType: string,
): Promise<ReceiptOcrResult | { error: 'NO_API_KEY' } | { error: 'OCR_FAILED'; message: string }> {
	if (!isBedrockAvailable()) {
		return { error: 'NO_API_KEY' };
	}

	try {
		const result = await converseWithImageAndTool({
			system: SYSTEM_PROMPT,
			userText: 'この画像の領収書から合計金額を読み取ってください。',
			imageBase64,
			imageMimeType: mimeType,
			tool: RECEIPT_TOOL,
		});

		const amount = Math.floor(Number(result.input.amount) || 0);
		const rawText = String(result.input.rawText ?? '');

		logger.info('[receipt-ocr] Bedrock response', { context: { amount, rawText } });

		if (amount <= 0) {
			return { error: 'OCR_FAILED', message: rawText || '金額を読み取れませんでした' };
		}

		return { amount, rawText };
	} catch (err) {
		logger.error('[receipt-ocr] Bedrock API error', {
			error: err instanceof Error ? err.message : String(err),
			stack: err instanceof Error ? err.stack : undefined,
		});
		return { error: 'OCR_FAILED', message: '画像の読み取りに失敗しました' };
	}
}
