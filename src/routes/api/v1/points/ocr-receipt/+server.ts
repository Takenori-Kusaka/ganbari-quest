import { json } from '@sveltejs/kit';
import { POINTS_LABELS } from '$lib/domain/labels';
import { validationError } from '$lib/server/errors';
import { validateBase64ImageMagicBytes } from '$lib/server/security/magic-bytes';
import { resolveMaxBase64DecodedBytes } from '$lib/server/services/function-url-limit';
import { toDisplayMb } from '$lib/server/services/import-limit';
import { ocrReceipt, RECEIPT_MAX_IMAGE_BYTES } from '$lib/server/services/receipt-ocr-service';
import type { RequestHandler } from './$types';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const POST: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const body = await request.json();
	const { image, mimeType } = body as { image?: string; mimeType?: string };

	if (!image || !mimeType) {
		return validationError('画像データが不足しています');
	}

	if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
		return validationError('対応していない画像形式です。JPEG、PNG、WebPをお使いください。');
	}

	// base64サイズチェック（base64は元データの約1.33倍）。
	// #3694: AWS 本番は base64 JSON body が Function URL 6MB request cap を超えると edge で
	// 沈黙拒否されるため、デコード後上限を runtime 実効値に下方整合する (NUC / local は 5MB 維持)。
	const maxImageBytes = resolveMaxBase64DecodedBytes(RECEIPT_MAX_IMAGE_BYTES);
	const estimatedSize = (image.length * 3) / 4;
	if (estimatedSize > maxImageBytes) {
		return validationError(POINTS_LABELS.receiptImageTooLarge(String(toDisplayMb(maxImageBytes))));
	}

	// マジックバイト検証（Content-Type偽装対策）
	const magicCheck = validateBase64ImageMagicBytes(image, mimeType);
	if (!magicCheck.valid) {
		return validationError('ファイルの内容が宣言された形式と一致しません');
	}

	const result = await ocrReceipt(image, mimeType);

	if ('error' in result) {
		if (result.error === 'NO_API_KEY') {
			return json(
				{
					error: {
						code: 'AI_UNAVAILABLE',
						message: 'AI読み取り機能は現在利用できません。金額を手入力してください。',
					},
				},
				{ status: 503 },
			);
		}
		return json({ error: { code: 'OCR_FAILED', message: result.message } }, { status: 422 });
	}

	return json(result);
};
