// src/lib/server/services/receipt-ocr-service.ts
// 領収書画像から Bedrock Claude Haiku で金額を読み取るサービス (#721)

import { POINTS_LABELS } from '$lib/domain/labels';
import { isAiUnavailableError, reportAiUnavailableAtGuard } from '$lib/server/ai/availability';
import { getAiProvider, isAiAvailable } from '$lib/server/ai/factory';
import { logger } from '$lib/server/logger';

/**
 * 領収書 OCR 画像の受理上限 (bytes)。NUC / local はこの 5MB がそのまま実効上限。
 * aws-prod では base64 JSON body が Function URL 6MB request cap を超えないよう
 * `resolveMaxBase64DecodedBytes` が更に下方整合する (~4.1MB)。OCR route の reject 判定と
 * 撮影ボタン note の表示 MB を同一値から導出する SSOT (#3775 ②)。
 */
export const RECEIPT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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

/**
 * OCR の失敗理由。**顧客に伝える内容が変わるので、丸めてはいけない** (#4366)。
 *
 * - `AI_UNAVAILABLE`: AI 側の事情 (未設定 / 権限なし / キー不正)。顧客の画像は無関係なので
 *   撮り直しを促さず、手入力へ誘導する。
 * - `OCR_FAILED`: 画像から金額が読めなかった。撮り直しか手入力を促す。
 */
export type ReceiptOcrError =
	| { error: 'AI_UNAVAILABLE' }
	| { error: 'OCR_FAILED'; message: string };

/** 領収書画像から金額をOCRで読み取る */
export async function ocrReceipt(
	imageBase64: string,
	mimeType: string,
): Promise<ReceiptOcrResult | ReceiptOcrError> {
	if (!isAiAvailable()) {
		// 顧客には「運営に通知済み」と出す。通知経路が無いままそう書くと嘘になるため、ここで
		// 観測可能にする (プロセス内で理由ごとに 1 回だけ。per-request では出さない)。
		reportAiUnavailableAtGuard(getAiProvider().name);
		return { error: 'AI_UNAVAILABLE' };
	}

	try {
		const provider = getAiProvider();
		const result = await provider.converseWithImageAndTool({
			system: SYSTEM_PROMPT,
			userText: 'この画像の領収書から合計金額を読み取ってください。',
			imageBase64,
			imageMimeType: mimeType,
			tool: RECEIPT_TOOL,
		});

		const amount = Math.floor(Number(result.input.amount) || 0);
		const rawText = String(result.input.rawText ?? '');

		logger.info('[receipt-ocr] AI response', { context: { amount, rawText } });

		if (amount <= 0) {
			return { error: 'OCR_FAILED', message: rawText || POINTS_LABELS.receiptAmountNotFound };
		}

		return { amount, rawText };
	} catch (err) {
		logger.error('[receipt-ocr] AI API error', {
			error: err instanceof Error ? err.message : String(err),
			stack: err instanceof Error ? err.stack : undefined,
		});
		// AI が使えないことに起因する失敗を「画像の読み取りに失敗」と言うと、顧客は自分の写真が
		// 悪いと誤解して撮り直す (#4366 害 b)。原因が AI 側なら撮り直しを促さない。
		// 例外メッセージ自体は顧客に露出させない (ADR-0062 §2)。
		if (isAiUnavailableError(err)) {
			return { error: 'AI_UNAVAILABLE' };
		}
		return { error: 'OCR_FAILED', message: POINTS_LABELS.receiptOcrFailed };
	}
}
