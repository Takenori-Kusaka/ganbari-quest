// tests/unit/services/import-limit.test.ts
// #3325 AC3: import 受理上限の実態整合 SSOT (import-limit.ts) の runtime 分岐検証。
//
// AWS 本番 (aws-prod) は CloudFront → Lambda Function URL (BUFFERED) の 6MB hard cap が
// binding constraint のため 6MB 弱 (5.5MB) に下方整合し、NUC / local は Function URL 制約が
// 無いため export ZIP と整合する従来上限 (100MB) を維持することを assert する。

import { describe, expect, it } from 'vitest';
import type { TypedEnv } from '../../../src/lib/runtime/env';
import { MAX_ZIP_SIZE } from '../../../src/lib/server/services/backup-archive';
import {
	AWS_MAX_IMPORT_BYTES,
	LOCAL_MAX_IMPORT_BYTES,
	resolveMaxImportBytes,
	toDisplayMb,
} from '../../../src/lib/server/services/import-limit';

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

describe('#3325 import-limit — 実行環境別の受理上限', () => {
	it('aws-prod (AWS_LAMBDA_FUNCTION_NAME 設定) は Function URL 6MB 弱 (5.5MB) に整合する', () => {
		const env = envOf({ AWS_LAMBDA_FUNCTION_NAME: 'ganbari-quest-app' });
		expect(resolveMaxImportBytes(env)).toBe(AWS_MAX_IMPORT_BYTES);
		// 6MB hard cap 未満であること (multipart/encoding overhead margin)
		expect(AWS_MAX_IMPORT_BYTES).toBeLessThan(6 * 1024 * 1024);
		expect(AWS_MAX_IMPORT_BYTES).toBe(Math.floor(5.5 * 1024 * 1024));
	});

	it('nuc-prod (IS_NUC_DEPLOY=true) は Function URL 制約が無いため従来上限 100MB を維持する', () => {
		const env = envOf({ IS_NUC_DEPLOY: true });
		expect(resolveMaxImportBytes(env)).toBe(LOCAL_MAX_IMPORT_BYTES);
	});

	it('local-debug (既定) も従来上限 100MB を維持する', () => {
		expect(resolveMaxImportBytes(envOf({}))).toBe(LOCAL_MAX_IMPORT_BYTES);
	});

	it('APP_MODE=aws-prod の明示 override でも AWS 上限になる', () => {
		expect(resolveMaxImportBytes(envOf({ APP_MODE: 'aws-prod' }))).toBe(AWS_MAX_IMPORT_BYTES);
	});

	it('NUC/local 上限は export ZIP 構築上限 (backup-archive MAX_ZIP_SIZE) と整合する (SSOT)', () => {
		expect(LOCAL_MAX_IMPORT_BYTES).toBe(MAX_ZIP_SIZE);
	});

	it('toDisplayMb は小数 1 桁のユーザー向け MB 表示を返す', () => {
		expect(toDisplayMb(AWS_MAX_IMPORT_BYTES)).toBe(5.5);
		expect(toDisplayMb(LOCAL_MAX_IMPORT_BYTES)).toBe(100);
	});
});
