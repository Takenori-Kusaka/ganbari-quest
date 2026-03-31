import { validationError } from '$lib/server/errors';
import { validateBase64ImageMagicBytes } from '$lib/server/security/magic-bytes';
import { ocrReceipt } from '$lib/server/services/receipt-ocr-service';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { image, mimeType } = body as { image?: string; mimeType?: string };

	if (!image || !mimeType) {
		return validationError('画像データが不足しています');
	}

	if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
		return validationError('対応していない画像形式です。JPEG、PNG、WebPをお使いください。');
	}

	// base64サイズチェック（base64は元データの約1.33倍）
	const estimatedSize = (image.length * 3) / 4;
	if (estimatedSize > MAX_IMAGE_SIZE) {
		return validationError('画像サイズは5MB以下にしてください');
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
