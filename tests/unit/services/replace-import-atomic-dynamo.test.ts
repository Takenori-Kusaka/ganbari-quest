// tests/unit/services/replace-import-atomic-dynamo.test.ts
// #3326: DynamoDB backend (本番) の置換インポート原子化 = backup-before-clear (補償トランザクション)。
//
// DynamoDB は単一 tx で全 import を包めない (PK に tenant を焼き込み staging 間接層が無い +
// TransactWriteItems 100 item 上限) ため、clear 前に snapshot を取得し import 失敗時に復元する。
// 実 DynamoDB を使わず、補償ロジック (snapshot 取得失敗で中止 / import 失敗で復元) を service 依存の
// mock で決定的に検証する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvForTesting } from '../../../src/lib/runtime/env';

const { clearAllFamilyData, importFamilyData, exportFamilyData, saveFile, sendDiscordAlert } =
	vi.hoisted(() => ({
		clearAllFamilyData: vi.fn(async () => ({ deleted: {} })),
		importFamilyData: vi.fn(async () => ({ errors: [] }) as unknown),
		exportFamilyData: vi.fn(async () => ({ snapshot: true }) as unknown),
		saveFile: vi.fn(async () => {}),
		// 引数を 1 つ受ける形で型付け (mock.calls[0][0] の tuple index アクセスを型安全にする)。
		sendDiscordAlert: vi.fn(async (_opts: Record<string, unknown>) => {}),
	}));

vi.mock('$lib/server/services/data-service', () => ({ clearAllFamilyData }));
vi.mock('$lib/server/services/import-service', () => ({ importFamilyData }));
vi.mock('$lib/server/services/export-service', () => ({ exportFamilyData }));
vi.mock('$lib/server/storage', () => ({ saveFile }));
vi.mock('$lib/server/discord-alert', () => ({ sendDiscordAlert }));
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

	it('復元自体の成功時は Discord alert を送らない (一次故障からの自動復元はノイズにしない、#3520)', async () => {
		importFamilyData
			.mockRejectedValueOnce(new Error('import 途中失敗'))
			.mockResolvedValueOnce({ errors: [] } as unknown);

		await expect(replaceImportAtomic(DATA, T)).rejects.toThrow('import 途中失敗');

		expect(sendDiscordAlert).not.toHaveBeenCalled();
	});

	it('二次故障 (復元自体が失敗) 時は critical Discord alert を送り元エラーを再送出する (#3520)', async () => {
		// 本体 import 失敗 → 復元 import も失敗 (二次故障)。復元前 clear は成功させ、
		// 復元 importFamilyData が reject するケース (最終防衛線が崩れる状況)。
		importFamilyData
			.mockRejectedValueOnce(new Error('import 途中失敗'))
			.mockRejectedValueOnce(new Error('復元も失敗'));

		// 呼び出し側には一次故障の元エラーが再送出される (復元失敗で隠蔽しない)。
		await expect(replaceImportAtomic(DATA, T)).rejects.toThrow('import 途中失敗');

		// 二次故障パスに限定して即時 alert を送る (手動復旧が必要な状態の可視化)。
		expect(sendDiscordAlert).toHaveBeenCalledTimes(1);
		const alertArg = sendDiscordAlert.mock.calls[0]?.[0] as unknown as {
			level: string;
			message: string;
			tenantId: string;
			errorSummary: string;
		};
		expect(alertArg.level).toBe('critical');
		expect(alertArg.tenantId).toBe(T);
		expect(alertArg.message).toContain('手動復旧');
		// errorSummary に二次故障と一次故障の両方を残す (オンコール診断用)。
		expect(alertArg.errorSummary).toContain('復元も失敗');
		expect(alertArg.errorSummary).toContain('import 途中失敗');
	});

	it('復元経路の migrateExportData 失敗 (snapshot version 不一致) も二次故障として alert する (#3521)', async () => {
		// #3521: restoreFromSnapshot の最終防衛線 importFamilyData(snapshot) が内部で呼ぶ
		// migrateExportData が「移行経路未定義」で throw するケースを、復元 import の reject として
		// 再現する (version 不一致を人工的に発生させた状況を表す)。二次故障として alert される。
		importFamilyData
			.mockRejectedValueOnce(new Error('import 途中失敗'))
			.mockRejectedValueOnce(
				new Error('[export-migrations] version 99.0.0 → 1.6.0 の移行経路が未定義です'),
			);

		await expect(replaceImportAtomic(DATA, T)).rejects.toThrow('import 途中失敗');

		expect(sendDiscordAlert).toHaveBeenCalledTimes(1);
		const alertArg = sendDiscordAlert.mock.calls[0]?.[0] as unknown as {
			level: string;
			errorSummary: string;
		};
		expect(alertArg.level).toBe('critical');
		expect(alertArg.errorSummary).toContain('移行経路が未定義');
	});
});
