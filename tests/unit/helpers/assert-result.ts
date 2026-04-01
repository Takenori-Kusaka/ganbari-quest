// tests/unit/helpers/assert-result.ts
// サービス層の Result 型（success | error の discriminated union）用アサーションヘルパー
// `if (!('error' in result))` ガード内のアサーションがサイレントスキップされる問題を防ぐ

import { expect } from 'vitest';

/**
 * Result がエラーでないことを assert し、型を絞り込む。
 * エラーの場合は `expect` で即座に失敗させる（サイレントスキップしない）。
 *
 * @example
 * const result = await getPointBalance(db, 1);
 * const success = assertSuccess(result);
 * expect(success.balance).toBe(250);
 */
export function assertSuccess<T extends object>(
	result: T | { error: string },
): Exclude<T, { error: string }> {
	expect(
		'error' in result,
		`Expected success but got error: ${'error' in result ? (result as { error: string }).error : ''}`,
	).toBe(false);
	return result as Exclude<T, { error: string }>;
}

/**
 * Result がエラーであることを assert し、エラー型を返す。
 *
 * @example
 * const result = await convertPoints(db, 999, 500);
 * const err = assertError(result);
 * expect(err.error).toBe('NOT_FOUND');
 */
export function assertError<T extends object>(
	result: T | { error: string },
): { error: string } & Record<string, unknown> {
	expect('error' in result, 'Expected error but got success').toBe(true);
	return result as { error: string } & Record<string, unknown>;
}
