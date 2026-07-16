// tests/unit/routes/ocr-receipt-6mb-request-guard.test.ts
// #3694 AC2: OCR 画像 (base64 JSON body) の 6MB request cap 整合。
//
// AWS 本番 (aws-prod) は base64 が Function URL 6MB request cap を超えると edge で沈黙拒否される。
// デコード後上限を runtime 実効値 (約 4.14MB) に下方整合し、AWS では 4.14MB〜5MB の画像を明示
// エラー (400) で弾く。NUC / local は Function URL 制約が無いため従来 5MB 上限を維持する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockOcrReceipt = vi.fn();
vi.mock('$lib/server/services/receipt-ocr-service', () => ({
	ocrReceipt: (...args: unknown[]) => mockOcrReceipt(...args),
	// #3775 ②: route が受理上限定数を service から import するようになったため mock でも提供する。
	RECEIPT_MAX_IMAGE_BYTES: 5 * 1024 * 1024,
}));
vi.mock('$lib/server/security/magic-bytes', () => ({
	validateBase64ImageMagicBytes: () => ({ valid: true }),
}));

import { resetEnvForTesting } from '../../../src/lib/runtime/env';
import { POST } from '../../../src/routes/api/v1/points/ocr-receipt/+server';

const originalFnName = process.env.AWS_LAMBDA_FUNCTION_NAME;

/** decoded バイト数から base64 文字数 (= decoded * 4/3) 相当の文字列を作る。 */
function base64OfDecodedBytes(decodedBytes: number): string {
	return 'A'.repeat(Math.floor((decodedBytes * 4) / 3));
}

function makeEvent(image: string, awsMode: boolean) {
	if (awsMode) process.env.AWS_LAMBDA_FUNCTION_NAME = 'ganbari-quest-app';
	else delete process.env.AWS_LAMBDA_FUNCTION_NAME;
	resetEnvForTesting();
	return {
		request: new Request('https://x/api/v1/points/ocr-receipt', {
			method: 'POST',
			body: JSON.stringify({ image, mimeType: 'image/png' }),
		}),
		locals: { context: { tenantId: 't1' } },
		// biome-ignore lint/suspicious/noExplicitAny: minimal RequestEvent stub for handler unit test
	} as any;
}

beforeEach(() => {
	mockOcrReceipt.mockResolvedValue({ amount: 100 });
});

afterEach(() => {
	if (originalFnName === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME;
	else process.env.AWS_LAMBDA_FUNCTION_NAME = originalFnName;
	resetEnvForTesting();
	vi.clearAllMocks();
});

describe('#3694 OCR receipt — 6MB request cap guard', () => {
	// デコード後 4.5MB: AWS 実効上限 (約 4.14MB) 超だが従来 5MB 未満
	const decoded4_5MB = base64OfDecodedBytes(Math.floor(4.5 * 1024 * 1024));

	it('aws-prod: 4.5MB 画像は実効上限超で 400 (edge 沈黙拒否の前にアプリが明示)', async () => {
		const res = await POST(makeEvent(decoded4_5MB, true));
		expect(res.status).toBe(400);
		expect(mockOcrReceipt).not.toHaveBeenCalled();
	});

	it('local: 4.5MB 画像は従来 5MB 上限内で受理し OCR に進む', async () => {
		const res = await POST(makeEvent(decoded4_5MB, false));
		expect(res.status).toBe(200);
		expect(mockOcrReceipt).toHaveBeenCalledTimes(1);
	});

	it('local: 5MB 超はどの環境でも一貫して 400', async () => {
		const decoded6MB = base64OfDecodedBytes(6 * 1024 * 1024);
		const res = await POST(makeEvent(decoded6MB, false));
		expect(res.status).toBe(400);
		expect(mockOcrReceipt).not.toHaveBeenCalled();
	});
});
