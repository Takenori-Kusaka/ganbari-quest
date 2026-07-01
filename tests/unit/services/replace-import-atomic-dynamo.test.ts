// tests/unit/services/replace-import-atomic-dynamo.test.ts
// #3326: DynamoDB backend (本番) の置換インポート原子化 = backup-before-clear (補償トランザクション)。
//
// DynamoDB は単一 tx で全 import を包めない (PK に tenant を焼き込み staging 間接層が無い +
// TransactWriteItems 100 item 上限) ため、clear 前に snapshot を取得し import 失敗時に復元する。
// 実 DynamoDB を使わず、補償ロジック (snapshot 取得失敗で中止 / import 失敗で復元) を service 依存の
// mock で決定的に検証する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvForTesting } from '../../../src/lib/runtime/env';

const { clearAllFamilyData, importFamilyData, exportFamilyData, saveFile } = vi.hoisted(() => ({
	clearAllFamilyData: vi.fn(async () => ({ deleted: {} })),
	importFamilyData: vi.fn(async () => ({ errors: [] }) as unknown),
	exportFamilyData: vi.fn(async () => ({ snapshot: true }) as unknown),
	saveFile: vi.fn(async () => {}),
}));

vi.mock('$lib/server/services/data-service', () => ({ clearAllFamilyData }));
vi.mock('$lib/server/services/import-service', () => ({ importFamilyData }));
vi.mock('$lib/server/services/export-service', () => ({ exportFamilyData }));
vi.mock('$lib/server/storage', () => ({ saveFile }));
vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// biome-ignore lint/suspicious/noExplicitAny: テスト用の最小 ExportData スタブ
const DATA = {} as any;
const T = 't-dynamo';

import { replaceImportAtomic } from '../../../src/lib/server/services/replace-import-service';

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv('DATA_SOURCE', 'dynamodb');
	// getEnv() は cache を持つため、stubEnv 後に再 parse させる (ADR-0040 P1、
	// usage-log-service-dynamodb-noop.test.ts と同パターン)。
	resetEnvForTesting();
});
afterEach(() => {
	vi.unstubAllEnvs();
	resetEnvForTesting();
});

describe('#3326 DynamoDB backup-before-clear', () => {
	it('snapshot 取得が失敗したら clear せず安全に中止する (旧データを失わない)', async () => {
		exportFamilyData.mockRejectedValueOnce(new Error('Query 失敗'));

		await expect(replaceImportAtomic(DATA, T)).rejects.toThrow('置換前のバックアップ取得に失敗');

		// clear / import は一度も実行されない = 旧データ無傷
		expect(clearAllFamilyData).not.toHaveBeenCalled();
		expect(importFamilyData).not.toHaveBeenCalled();
	});

	it('import 失敗時は snapshot から復元し、元エラーを再送出する', async () => {
		// 1 回目 (本体 import) は throw、2 回目 (復元 import) は成功
		importFamilyData
			.mockRejectedValueOnce(new Error('import 途中失敗'))
			.mockResolvedValueOnce({ errors: [] } as unknown);

		await expect(replaceImportAtomic(DATA, T)).rejects.toThrow('import 途中失敗');

		// 補償: snapshot を退避 + clear(本体 + 復元前) 2 回 + import(本体失敗 + 復元) 2 回
		expect(saveFile).toHaveBeenCalledTimes(1);
		expect(clearAllFamilyData).toHaveBeenCalledTimes(2);
		expect(importFamilyData).toHaveBeenCalledTimes(2);
		// 復元 import には snapshot が渡される
		expect(importFamilyData).toHaveBeenLastCalledWith({ snapshot: true }, T);
	});
});
