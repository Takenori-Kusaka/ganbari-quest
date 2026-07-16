// tests/unit/services/function-url-limit.test.ts
// #3694 fitness: AWS Lambda Function URL (BUFFERED) の request/response 各 6MB hard cap を
// 「同期に body を運ぶ」全経路 (import ZIP 受信 / export ZIP 送信 / OCR base64 受信) の
// アプリ側上限 SSOT にする。各実効上限が実際に転送されるバイト数で platform cap を超えない
// (= 上限定数 ≤ platform cap) ことを static assert する (ADR-0061 fitness function)。

import { describe, expect, it } from 'vitest';
import type { TypedEnv } from '../../../src/lib/runtime/env';
import {
	AWS_EFFECTIVE_BASE64_DECODED_BYTES,
	AWS_EFFECTIVE_PAYLOAD_BYTES,
	FUNCTION_URL_PAYLOAD_CAP_BYTES,
	resolveMaxBase64DecodedBytes,
	resolveMaxSyncResponseBytes,
} from '../../../src/lib/server/services/function-url-limit';
import { AWS_MAX_IMPORT_BYTES } from '../../../src/lib/server/services/import-limit';

/** resolveRuntimeMode が参照するフィールドのみ埋めた TypedEnv を作る。 */
function envOf(overrides: Partial<TypedEnv>): TypedEnv {
	return {
		NODE_ENV: 'test',
		APP_MODE: undefined,
		IS_NUC_DEPLOY: undefined,
		AWS_LAMBDA_FUNCTION_NAME: undefined,
		...overrides,
	} as TypedEnv;
}

describe('#3694 function-url-limit — platform cap 整合 fitness', () => {
	it('platform hard cap は Function URL BUFFERED の 6 MiB', () => {
		expect(FUNCTION_URL_PAYLOAD_CAP_BYTES).toBe(6 * 1024 * 1024);
	});

	it('AWS 実効 payload 上限 ≤ platform cap (request/response 共通)', () => {
		expect(AWS_EFFECTIVE_PAYLOAD_BYTES).toBeLessThan(FUNCTION_URL_PAYLOAD_CAP_BYTES);
	});

	it('import ZIP request 上限 (import-limit AWS_MAX_IMPORT_BYTES) ≤ platform cap', () => {
		// import-limit.ts の request-side SSOT が同一 platform cap に整合していること (横断 SSOT)。
		expect(AWS_MAX_IMPORT_BYTES).toBeLessThan(FUNCTION_URL_PAYLOAD_CAP_BYTES);
	});

	it('OCR base64 デコード後上限は、base64 化 (4/3 膨張) + wrapper 後も platform cap 未満', () => {
		// 実際に転送されるのは base64 文字列 (デコード後 * 4/3)。膨張後でも cap を超えないこと。
		const transportedBase64Bytes = Math.ceil((AWS_EFFECTIVE_BASE64_DECODED_BYTES * 4) / 3);
		expect(transportedBase64Bytes).toBeLessThan(FUNCTION_URL_PAYLOAD_CAP_BYTES);
	});

	it('resolveMaxSyncResponseBytes: aws-prod は AWS 実効上限、他は制約なし (Infinity)', () => {
		expect(
			resolveMaxSyncResponseBytes(envOf({ AWS_LAMBDA_FUNCTION_NAME: 'ganbari-quest-app' })),
		).toBe(AWS_EFFECTIVE_PAYLOAD_BYTES);
		expect(resolveMaxSyncResponseBytes(envOf({ APP_MODE: 'aws-prod' }))).toBe(
			AWS_EFFECTIVE_PAYLOAD_BYTES,
		);
		expect(resolveMaxSyncResponseBytes(envOf({ IS_NUC_DEPLOY: true }))).toBe(
			Number.POSITIVE_INFINITY,
		);
		expect(resolveMaxSyncResponseBytes(envOf({}))).toBe(Number.POSITIVE_INFINITY);
	});

	it('resolveMaxBase64DecodedBytes: aws-prod は localMax と AWS 上限の小さい方、他は localMax', () => {
		const localMax = 5 * 1024 * 1024;
		expect(resolveMaxBase64DecodedBytes(localMax, envOf({ AWS_LAMBDA_FUNCTION_NAME: 'app' }))).toBe(
			Math.min(localMax, AWS_EFFECTIVE_BASE64_DECODED_BYTES),
		);
		// AWS 実効上限は localMax (5MB) より小さいので、AWS では下方整合される
		expect(AWS_EFFECTIVE_BASE64_DECODED_BYTES).toBeLessThan(localMax);
		// NUC / local は Function URL 制約が無いため従来上限を維持
		expect(resolveMaxBase64DecodedBytes(localMax, envOf({ IS_NUC_DEPLOY: true }))).toBe(localMax);
		expect(resolveMaxBase64DecodedBytes(localMax, envOf({}))).toBe(localMax);
	});
});
