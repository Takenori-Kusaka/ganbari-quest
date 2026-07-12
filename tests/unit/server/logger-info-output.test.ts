// tests/unit/server/logger-info-output.test.ts
// #3692: logger.info / debug が console (stdout) に出力されることを保証する回帰テスト。
//
// 背景: writeLog の console 分岐が error→console.error / warn→console.warn のみで、
// info / debug は空 else に落ちて **一切出力されなかった** (本番 CloudWatch に info ログが
// 出ず、restore 504 の observability が全滅していた根因)。MIN_LOG_LEVEL=info を通過して
// いるのに出力先が無い握りつぶしを、console.log 呼び出しの有無で機械検証する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../src/lib/server/logger';

describe('#3692 logger.info / debug は console に出力される', () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let warnSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		logSpy.mockRestore();
		warnSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it('info は console.log に出力される (握りつぶし回帰ガード)', () => {
		logger.info('[import] インポート開始', { context: { rows: 1978 } });
		expect(logSpy).toHaveBeenCalledTimes(1);
		expect(String(logSpy.mock.calls[0][0])).toContain('[import] インポート開始');
	});

	it('warn は console.warn に出力される (既存挙動維持)', () => {
		logger.warn('warn メッセージ');
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(logSpy).not.toHaveBeenCalled();
	});

	it('error は console.error に出力される (既存挙動維持)', () => {
		logger.error('error メッセージ');
		expect(errorSpy).toHaveBeenCalled();
		expect(logSpy).not.toHaveBeenCalled();
	});
});
