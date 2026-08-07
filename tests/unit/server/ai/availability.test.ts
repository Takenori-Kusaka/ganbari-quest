// tests/unit/server/ai/availability.test.ts
// AI provider の可用性分類 + latch (#4366)
//
// 分類を誤ると実害が両方向に出る:
//   - 一時的な失敗を可用性クラスに入れる → 一過性の throttling で AI 機能がプロセス生存中ずっと止まる
//   - 権限エラーを一時的とみなす → 毎リクエスト無駄な往復 + logger.error が出続ける (#4366 害 c)
// 分類表を明示的に固定する。

import { beforeEach, describe, expect, it } from 'vitest';
import {
	isAiUnavailableError,
	isProviderLatchedUnavailable,
	markProviderUnavailable,
	resetAiAvailabilityLatch,
	withAvailabilityTracking,
} from '$lib/server/ai/availability';

/** AWS SDK 風のエラーを作る (name + $metadata.httpStatusCode を持つ)。 */
function sdkError(name: string, httpStatusCode?: number): Error {
	const err = new Error(`${name}: simulated`);
	err.name = name;
	if (httpStatusCode !== undefined) {
		(err as Error & { $metadata: { httpStatusCode: number } }).$metadata = { httpStatusCode };
	}
	return err;
}

describe('isAiUnavailableError — 可用性クラスの分類', () => {
	const unavailable: Array<[string, unknown]> = [
		['Bedrock 権限なし', sdkError('AccessDeniedException', 403)],
		['資格情報が解決できない', sdkError('CredentialsProviderError')],
		['モデル ID が存在しない', sdkError('ResourceNotFoundException', 404)],
		['資格情報が失効', sdkError('ExpiredTokenException', 403)],
		['署名不正', sdkError('InvalidSignatureException', 403)],
		['Gemini API キー不正 (名前なし)', new Error('[400 Bad Request] API key not valid')],
		['Gemini 権限拒否', new Error('PERMISSION_DENIED: caller does not have permission')],
		['HTTP 401 のみ', Object.assign(new Error('unauthenticated'), { status: 401 })],
		['provider 未設定', new Error('Gemini API key is not configured')],
	];

	for (const [label, err] of unavailable) {
		it(`可用性クラスとみなす: ${label}`, () => {
			expect(isAiUnavailableError(err)).toBe(true);
		});
	}

	const transient: Array<[string, unknown]> = [
		['throttling', sdkError('ThrottlingException', 429)],
		['タイムアウト', sdkError('TimeoutError')],
		['サーバ内部エラー', sdkError('InternalServerException', 500)],
		['サービス一時停止', sdkError('ServiceUnavailableException', 503)],
		['レスポンス形式不正', new Error('No tool_use block in Bedrock response')],
		['JSON パース失敗', new SyntaxError('Unexpected token < in JSON at position 0')],
		['null', null],
		['undefined', undefined],
	];

	for (const [label, err] of transient) {
		it(`可用性クラスとみなさない (一時的・入力起因): ${label}`, () => {
			expect(isAiUnavailableError(err)).toBe(false);
		});
	}
});

describe('latch', () => {
	beforeEach(() => {
		resetAiAvailabilityLatch();
	});

	it('記録するまでは latch されていない', () => {
		expect(isProviderLatchedUnavailable('bedrock-claude')).toBe(false);
	});

	it('記録した provider だけが latch される (他 provider を巻き添えにしない)', () => {
		markProviderUnavailable('bedrock-claude');
		expect(isProviderLatchedUnavailable('bedrock-claude')).toBe(true);
		expect(isProviderLatchedUnavailable('gemini')).toBe(false);
	});

	it('withAvailabilityTracking は成功時に latch しない', async () => {
		const result = await withAvailabilityTracking('bedrock-claude', async () => 'ok');
		expect(result).toBe('ok');
		expect(isProviderLatchedUnavailable('bedrock-claude')).toBe(false);
	});

	it('withAvailabilityTracking は可用性クラスの失敗を latch し、例外はそのまま投げ直す', async () => {
		await expect(
			withAvailabilityTracking('bedrock-claude', async () => {
				throw sdkError('AccessDeniedException', 403);
			}),
		).rejects.toThrow(/AccessDeniedException/);
		expect(isProviderLatchedUnavailable('bedrock-claude')).toBe(true);
	});

	it('withAvailabilityTracking は一時的な失敗では latch しない', async () => {
		await expect(
			withAvailabilityTracking('bedrock-claude', async () => {
				throw sdkError('ThrottlingException', 429);
			}),
		).rejects.toThrow(/ThrottlingException/);
		expect(isProviderLatchedUnavailable('bedrock-claude')).toBe(false);
	});
});
