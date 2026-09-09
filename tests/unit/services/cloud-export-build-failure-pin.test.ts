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
import { SETTINGS_LABELS } from '../../../src/lib/domain/labels';

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

	it('親の画面に出る合成文字列が二重にならない', async () => {
		// #4867 adversarial round 8 実測: `cloudStatusFailed` は
		// `作成に失敗しました（${reason}）` なので、`reason` を文として完結させると
		// **「作成に失敗しました」が 1 行に 2 回**出る (39 字)。実際に画面へ出る合成を pin する。
		await drainPendingExports(5);

		const shown = SETTINGS_LABELS.cloudStatusFailed(savedFailureReasons[0] ?? '');
		expect(shown.match(/作成に失敗しました/g)?.length ?? 0, `同じ句が 2 回出ている: ${shown}`).toBe(
			1,
		);
	});

	// #4867 adversarial round 8/9: 容量不足 / 権限を generic に潰すと、空きを作れば直る人が
	// 「もう一度お試しください」を何度も押すだけになる。**分岐ごとに固定する** —
	// round 9 実測では、この分岐を丸ごと削っても 131 passed だった (test 参照 0 件)。
	/** errno (`EACCES` 等) と path 区切りが文言に混ざっていないか。 */
	const ERRNO_OR_PATH = /E[A-Z]{3,}|[/\\]/;

	const ERRNO_CASES = [
		{ code: 'ENOSPC', label: () => SETTINGS_LABELS.cloudBuildFailedNoSpace },
		{ code: 'EACCES', label: () => SETTINGS_LABELS.cloudBuildFailedPermission },
		{ code: 'EPERM', label: () => SETTINGS_LABELS.cloudBuildFailedPermission },
		{ code: 'EROFS', label: () => SETTINGS_LABELS.cloudBuildFailedPermission },
	] as const;

	for (const c of ERRNO_CASES) {
		it(`親が自分で直せる失敗は名指しする (${c.code})`, async () => {
			state.saveFileError = Object.assign(new Error(`${c.code}: …`), { code: c.code });

			await drainPendingExports(5);

			expect(savedFailureReasons[0]).toBe(c.label());
		});
	}

	it('code を持たない失敗は既定文言 (AWS SDK の例外は code を持たない)', async () => {
		// S3 backend の `ServiceException` は `name` / `$metadata` を持ち `code` は無い。
		// AWS では常に既定に落ちるのが正しい (S3 障害で「空き容量」を出したら実行不能な指示になる)。
		state.saveFileError = Object.assign(new Error('AccessDenied'), { name: 'S3ServiceException' });

		await drainPendingExports(5);

		expect(savedFailureReasons[0]).toBe(SETTINGS_LABELS.cloudBuildFailedDefault);
	});

	it('どの文言も、画面に出る値 (errno / パス) を含まない', () => {
		// round 9 実測: 分岐の文言を `EACCES: /srv/... に書き込めません` にしても 131 passed
		// だった = round 7 の出発点 (errno が親の画面に出る) を新しい分岐から再び出せる。
		for (const label of [
			SETTINGS_LABELS.cloudBuildFailedDefault,
			SETTINGS_LABELS.cloudBuildFailedNoSpace,
			SETTINGS_LABELS.cloudBuildFailedPermission,
		]) {
			expect(label, `errno が親の画面に出る文言になっている: ${label}`).not.toMatch(ERRNO_OR_PATH);
		}
	});

	it('どの文言も、括弧の中に入れて二重にならない', () => {
		// `cloudStatusFailed` は `作成に失敗しました（${reason}）`。文として完結させると
		// 同じ句が 1 行に 2 回出る (round 8 で既定文言がそうなっていた)。
		for (const label of [
			SETTINGS_LABELS.cloudBuildFailedDefault,
			SETTINGS_LABELS.cloudBuildFailedNoSpace,
			SETTINGS_LABELS.cloudBuildFailedPermission,
		]) {
			const shown = SETTINGS_LABELS.cloudStatusFailed(label);
			expect(shown.match(/作成に失敗しました/g)?.length ?? 0, `二重になる: ${shown}`).toBe(1);
		}
	});

	it('親の画面にはサーバの例外を出さない (固定文言)', async () => {
		// #4867 adversarial round 7: `failureReason` は DB の `failure_reason` に入り、
		// `CloudExportStoredList` 経由で**保護者の画面**に出る。PIN を伏せてもなお
		// errno + **サーバの絶対パス** + tenant id が親に見えていた。ADR-0062 §2 は
		// PIN と無関係に「`err.message` をそのままレスポンスに載せない」を禁じており、
		// #3376 のコメント自身も「その他は generic なエラーメッセージを残す」と書いていた。
		await drainPendingExports(5);

		const reason = savedFailureReasons[0] ?? '';
		expect(reason).toBe(SETTINGS_LABELS.cloudBuildFailedDefault);
		expect(reason, 'サーバの例外 message が親の画面に出ている').not.toContain('EACCES');
		expect(reason, 'errno が親の画面に出ている').not.toContain('EACCES');
		expect(reason, 'サーバの絶対パスが親の画面に出ている').not.toContain('/srv/');
	});

	it('原因は運用側 (ログ) に読める形で残る', async () => {
		await drainPendingExports(5);

		const line = logged.find((l) => l.includes('build 失敗')) ?? '';
		expect(line, 'エラーコードまで消してはいけない (原因が読めなくなる)').toContain('EACCES');
		expect(line, 'どの家庭かは残す (運用が追える)').toContain(TENANT);
		// 置換文字列 `<pin>` 自身が次の `pin` として拾われると `backup.zip` が `<pin>.zip` に
		// 潰れる (round 6 で実際に起きた)。**どの成果物が消し残ったか**が読めなくなる。
		expect(line, 'file 名まで潰している').toContain('backup.zip');
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
