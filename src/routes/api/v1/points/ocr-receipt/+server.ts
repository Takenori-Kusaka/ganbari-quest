import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ocrReceipt } from '$lib/server/services/receipt-ocr-service';
import { validationError, apiError } from '$lib/server/errors';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { image, mimeType } = body as { image?: string; mimeType?: string };

	if (!image || !mimeType) {
		return validationError('image and mimeType are required');
	}

	if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
		return validationError('Unsupported image format. Use JPEG, PNG, or WebP.');
	}

	// base64サイズチェック（base64は元データの約1.33倍）
	const estimatedSize = (image.length * 3) / 4;
	if (estimatedSize > MAX_IMAGE_SIZE) {
		return validationError('Image size must be under 5MB');
	}

	const result = await ocrReceipt(image, mimeType);

	if ('error' in result) {
		if (result.error === 'NO_API_KEY') {
			return apiError('INTERNAL_ERROR', 'Gemini API key is not configured');
		}
		return json(
			{ error: { code: 'OCR_FAILED', message: result.message } },
			{ status: 422 },
		);
	}

	return json(result);
};
