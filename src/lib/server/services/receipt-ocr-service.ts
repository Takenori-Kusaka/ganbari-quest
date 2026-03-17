// src/lib/server/services/receipt-ocr-service.ts
// 領収書画像からGemini Vision APIで金額を読み取るサービス

import { logger } from '$lib/server/logger';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface ReceiptOcrResult {
	amount: number;
	rawText: string;
}

function getGeminiClient(): GoogleGenerativeAI | null {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey || apiKey === 'your_gemini_api_key_here') {
		return null;
	}
	return new GoogleGenerativeAI(apiKey);
}

const RECEIPT_PROMPT = `この画像は領収書またはレシートです。
合計金額（税込）を読み取り、以下のJSON形式のみで回答してください（説明不要）。

{"amount": 数値（整数、円単位）, "rawText": "読み取った合計行のテキスト"}

注意:
- 合計金額が複数ある場合は、最終的な支払合計額を回答してください
- 小数点以下は切り捨ててください
- 金額が読み取れない場合は {"amount": 0, "rawText": "読み取り不可"} と回答してください
- 領収書でない画像の場合も {"amount": 0, "rawText": "領収書ではありません"} と回答してください`;

/** 領収書画像から金額をOCRで読み取る */
export async function ocrReceipt(
	imageBase64: string,
	mimeType: string,
): Promise<ReceiptOcrResult | { error: 'NO_API_KEY' } | { error: 'OCR_FAILED'; message: string }> {
	const client = getGeminiClient();
	if (!client) {
		return { error: 'NO_API_KEY' };
	}

	try {
		const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });

		const result = await model.generateContent([
			{ text: RECEIPT_PROMPT },
			{
				inlineData: {
					mimeType,
					data: imageBase64,
				},
			},
		]);

		const responseText = result.response.text();
		logger.info('[receipt-ocr] Gemini response', { context: { responseText } });

		// JSONを抽出
		const jsonMatch = responseText.match(/\{[^}]*\}/);
		if (!jsonMatch) {
			return { error: 'OCR_FAILED', message: 'レスポンスからJSONを抽出できませんでした' };
		}

		const parsed = JSON.parse(jsonMatch[0]);
		const amount = Math.floor(Number(parsed.amount) || 0);
		const rawText = String(parsed.rawText ?? '');

		if (amount <= 0) {
			return { error: 'OCR_FAILED', message: rawText || '金額を読み取れませんでした' };
		}

		return { amount, rawText };
	} catch (err) {
		logger.error('[receipt-ocr] Gemini API error', {
			error: err instanceof Error ? err.message : String(err),
			stack: err instanceof Error ? err.stack : undefined,
		});
		return { error: 'OCR_FAILED', message: '画像の読み取りに失敗しました' };
	}
}
