// tests/unit/server/logger-error-context-output.test.ts
// #4918: 本番で `auth-entitlement-db-unavailable` が発生した際、DB 側の cause
// (`e.message`) を `logger.error(msg, { error, context })` の meta で渡していたにも
// かかわらず、CloudWatch (console 出力) にはその meta が一切出ていなかった。
//
// 原因: `writeLog()` の console 向け `msg` 組み立てが `entry.message` (固定文言) だけを
// 使い、`entry.error` / `entry.context` を無視していた。Lambda はファイル出力を行わない
// (`isProduction && !isLambda` は常に false) ため、meta の到達経路は console 出力の
// この 1 箇所だけであり、ここに乗らない情報は本番からは原理的に見えない。
//
// 本 test は「meta で渡した error / context が console 出力に含まれる」ことを固定する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../src/lib/server/logger';

describe('#4918 logger の error / context meta が console 出力に含まれる', () => {
	let errorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		errorSpy.mockRestore();
	});

	it('error meta (DB 例外の cause) が console.error の出力文字列に含まれる', () => {
		logger.error('[AUTH] auth-entitlement-db-unavailable: Failed to resolve tenant entitlement', {
			error: 'connection terminated unexpectedly',
			context: { kind: 'auth-entitlement-db-unavailable', tenantId: 't-1' },
		});

		expect(errorSpy).toHaveBeenCalledTimes(1);
		const output = String(errorSpy.mock.calls[0][0]);
		expect(output).toContain('connection terminated unexpectedly');
		expect(output).toContain('t-1');
	});

	it('context の JSON 内容が console 出力にそのまま出る (Logs Insights から検索可能)', () => {
		logger.error('boom', {
			requestId: 'req-42',
			tenantId: 'tenant-abc',
			context: { path: '/admin', errorSummary: 'connection refused' },
		});

		const output = String(errorSpy.mock.calls[0][0]);
		expect(output).toContain('req-42');
		expect(output).toContain('tenant-abc');
		expect(output).toContain('connection refused');
	});

	it('error / context 未指定なら従来どおり message のみで、余計な suffix を付けない', () => {
		logger.error('シンプルなエラー');

		const output = String(errorSpy.mock.calls[0][0]);
		expect(output.endsWith('シンプルなエラー')).toBe(true);
		expect(output).not.toContain('undefined');
		expect(output).not.toContain('error=');
		expect(output).not.toContain('context=');
	});
});
