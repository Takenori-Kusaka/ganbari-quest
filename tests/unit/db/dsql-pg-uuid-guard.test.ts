// tests/unit/db/dsql-pg-uuid-guard.test.ts
// #3581 ②: uuid guard の observability (warnInvalidUuidId) を検証する。
//
// guard は「非 uuid = not-found」に静かに正規化するため、systematic な id バグが observability
// ゼロで進行しないよう rate-limited な logger.warn を出す。本 test は:
//   - isUuidFormat の判定境界 (uuid のみ true)
//   - warnInvalidUuidId が初回に logger.warn を発火する
//   - 同一 source の連続呼び出しは rate-limit 窓内で抑制される (log flooding 防止)
//   - 別 source は独立に発火する
// を検証する。rate-limit の module-level store 汚染を避けるため、各 test は unique な source key を使う。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { isUuidFormat, warnInvalidUuidId } from '../../../src/lib/server/db/dsql/pg-uuid';
import { logger } from '../../../src/lib/server/logger';

/** rate-limit store (module-level Map) の窓を跨がない unique な source を毎回生成する。 */
function uniqueSource(): string {
	return `test.${crypto.randomUUID()}`;
}

describe('pg-uuid guard observability (#3581 ②)', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('isUuidFormat: uuid 形式のみ true (空 / 数値 / 任意文字列は false)', () => {
		expect(isUuidFormat('00000000-0000-4000-8000-0000000000a1')).toBe(true);
		expect(isUuidFormat('3')).toBe(false);
		expect(isUuidFormat('')).toBe(false);
		expect(isUuidFormat('not-a-uuid')).toBe(false);
	});

	it('warnInvalidUuidId: 初回は logger.warn を発火する', () => {
		const spy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
		warnInvalidUuidId(uniqueSource());
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining('uuid guard'),
			expect.objectContaining({ service: 'pg-uuid-guard' }),
		);
	});

	it('warnInvalidUuidId: 同一 source の 2 回目以降は rate-limit 窓内で抑制される', () => {
		const spy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
		const source = uniqueSource();
		warnInvalidUuidId(source);
		warnInvalidUuidId(source);
		warnInvalidUuidId(source);
		expect(spy).toHaveBeenCalledTimes(1); // 窓内 (60s) は 1 回のみ = log flooding を防ぐ
	});

	it('warnInvalidUuidId: 別 source は独立に発火する', () => {
		const spy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
		warnInvalidUuidId(uniqueSource());
		warnInvalidUuidId(uniqueSource());
		expect(spy).toHaveBeenCalledTimes(2);
	});
});
