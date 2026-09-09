// tests/unit/services/cloud-export-build-failure-pin.test.ts
//
// [C2] build 失敗経路を**実際に走らせて**、PIN が (1) ログ (2) DB の `failure_reason`
// (3) その先の**保護者の画面** のどこにも出ないことを固定する (#4867)。
//
// **なぜ source 検査では足りないか** (#4867 adversarial should-2):
// `pin-redaction-callsites-source.test.ts` の [S1] が見ているのは
// `const failureReason = …` の**組み立て式だけ**で、その下の
// `logger.error(..., { error: failureReason })` が**ほかに何を渡しているか**は見ていない。
// `error: \`${failureReason} ${s3Key}\`` のように別の値を足す形は素通りする。ここでは
// logger に渡った引数を丸ごと直列化して見るので、どのフィールドに混ぜても捕まる。
//
// **なぜ別 file か**: `pin-not-logged-callsites.test.ts` は退会経路 ([C1]) 用に
// `storage.purgeByPrefix` を throw させる mock を持つ。build 経路は `saveFile` を
// throw させたいので、mock の形が両立しない。同 file に同居させると
// 「どちらの経路も通っていないのに緑」を作りやすい。
//
// `failureReason` は `CloudExportStoredList.svelte` の
// `SETTINGS_LABELS.cloudStatusFailed(exp.failureReason)` 経由で親の画面に出る。
// NUC の local FS backend では Node の fs エラーが**解決済み絶対パス**
// (…/exports/<tenantId>/<PIN>/backup.zip) を必ず含むため、伏せないと
// **親の画面に自分の共有 PIN が出る**。

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** logger に渡った全引数を deep-serialize して貯める (どのフィールドに混ぜても捕まる)。 */
const logged: string[] = [];
const record = (...args: unknown[]) => {
	logged.push(JSON.stringify(args, (_k, v) => (v instanceof Error ? v.message : v)));
};
vi.mock('$lib/server/logger', () => ({
	logger: { info: record, warn: record, error: record, debug: record },
}));

const PIN = 'K7M2QX';
const TENANT = 't-owner';
const S3_KEY = `exports/${TENANT}/${PIN}/backup.zip`;

/** `updateStatus` に渡った `failureReason` (= DB の failure_reason = 親の画面)。 */
const savedFailureReasons: string[] = [];

const state = {
	/** local FS backend (NUC) の fs エラーは解決済み絶対パスを必ず含む。 */
	saveFileError: new Error(
		`EACCES: permission denied, open '/srv/ganbari/data/${S3_KEY}'`,
	) as unknown,
};

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		cloudExport: {
			findStaleBuildingExports: vi.fn(async () => []),
			findPendingBuilds: vi.fn(async () => [
				{ id: 'e-1', tenantId: TENANT, exportType: 'template', s3Key: S3_KEY },
			]),
			claimForBuild: vi.fn(async () => true),
			updateStatus: vi.fn(
				async (
					_id: string,
					_tenantId: string,
					_status: string,
					patch?: { failureReason?: string },
				) => {
					if (patch?.failureReason !== undefined) savedFailureReasons.push(patch.failureReason);
				},
			),
		},
		// exportType='template' の build は children が空なら他 repo に触れずに完成する。
		child: { findAllChildren: vi.fn(async () => []) },
		childActivity: { findActivitiesByChild: vi.fn(async () => []) },
		checklist: {
			findTemplatesByChild: vi.fn(async () => []),
			findTemplateItems: vi.fn(async () => []),
		},
		storage: {
			saveFile: vi.fn(async () => {
				throw state.saveFileError;
			}),
		},
	}),
}));

const { drainPendingExports } = await import(
	'../../../src/lib/server/services/cloud-export-service'
);

beforeEach(() => {
	logged.length = 0;
	savedFailureReasons.length = 0;
	state.saveFileError = new Error(`EACCES: permission denied, open '/srv/ganbari/data/${S3_KEY}'`);
	vi.clearAllMocks();
});

describe('[C2] build 失敗経路', () => {
	it('経路に到達している (failed が 1 件で、失敗ログが出ている)', async () => {
		const result = await drainPendingExports(5);

		expect(result.failed, 'build 失敗として数えられていない (この test が経路に届いていない)').toBe(
			1,
		);
		expect(
			logged.some((l) => l.includes('build 失敗')),
			'build 失敗ログが出ていない (silent failure)',
		).toBe(true);
		expect(savedFailureReasons.length, 'failureReason が DB に書かれていない').toBe(1);
	});

	it('ログのどこにも PIN が出ない (error フィールドに混ぜても捕まる)', async () => {
		await drainPendingExports(5);

		for (const line of logged) {
			expect(
				line.includes(PIN),
				`ログに PIN が出ている。他家庭の PII ZIP を引ける材料が CloudWatch に残る:\n${line}`,
			).toBe(false);
		}
	});

	it('DB の failureReason に PIN が出ない (この文字列は保護者の画面に出る)', async () => {
		await drainPendingExports(5);

		for (const reason of savedFailureReasons) {
			expect(
				reason.includes(PIN),
				`failureReason に PIN が出ている。親の画面に自分の共有 PIN が表示される:\n${reason}`,
			).toBe(false);
		}
	});

	it('原因は読める形で残る (伏せすぎて障害が追えなくならない)', async () => {
		await drainPendingExports(5);

		const reason = savedFailureReasons[0] ?? '';
		expect(reason, 'エラーコードまで消してはいけない (原因が読めなくなる)').toContain('EACCES');
		expect(reason, 'どの家庭かは残す (運用が追える)').toContain(TENANT);
	});

	it('Windows / NUC の `\\` 区切りパスでも PIN が残らない', async () => {
		state.saveFileError = new Error(
			`EPERM: operation not permitted, open 'C:\\srv\\ganbari\\data\\exports\\${TENANT}\\${PIN}\\backup.zip'`,
		);

		await drainPendingExports(5);

		for (const reason of savedFailureReasons) {
			expect(reason.includes(PIN), `failureReason に PIN が出ている:\n${reason}`).toBe(false);
		}
		for (const line of logged) {
			expect(line.includes(PIN), `ログに PIN が出ている:\n${line}`).toBe(false);
		}
	});

	it('Error でない throw (文字列) でも PIN が残らない', async () => {
		state.saveFileError = `upload failed for /srv/ganbari/data/${S3_KEY}`;

		await drainPendingExports(5);

		for (const reason of savedFailureReasons) {
			expect(reason.includes(PIN), `failureReason に PIN が出ている:\n${reason}`).toBe(false);
		}
	});
});
