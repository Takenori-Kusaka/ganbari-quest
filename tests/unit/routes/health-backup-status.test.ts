// tests/unit/routes/health-backup-status.test.ts
// #3977 — `/api/health` の backup フィールドの配線を固定する。
//
// 本 Issue の root class は「**成果物はあるが呼ばれていない**」だった:
// `getPgliteBackupStatus` は「運用調査から読む口」として export されたが caller も test も
// 0 件で、doc comment だけが読み手の存在を前提にしていた。同 class は短期間に 2 件出ている
// (#3962 の check-pr-body を実行する CI job 不在も同型)。
//
// したがって本 test は「backup が返る」ことより先に **「誰が読むか」が壊れたら落ちる**
// ことを目的にする。具体的には:
//   - pglite のときだけ載る (クラウド公開 Lambda の露出を増やしていないことの固定)
//   - 状態ファイルが読めなくても liveness は落ちない (probe の意味を変えない)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const probeResult = { tables: 1 };

vi.mock('$lib/server/db/probe', () => ({
	probePg: vi.fn(async () => probeResult),
	probeSqlite: vi.fn(async () => probeResult),
}));

const getPgliteBackupStatus = vi.fn();
vi.mock('$lib/server/services/pglite-backup-service', () => ({
	getPgliteBackupStatus: (...args: unknown[]) => getPgliteBackupStatus(...args),
}));

const STATUS = {
	lastSuccessAt: '2026-07-27T00:00:00.000Z',
	lastSuccessFilename: 'pglite-20260727T000000Z.tgz',
	lastSuccessBytes: 1234,
	lastSuccessDurationMs: 567,
	lastFailureAt: null,
	lastFailureMessage: null,
	consecutiveFailures: 0,
};

/** DATA_SOURCE は module top-level で読まれるため、毎回 module registry ごと作り直す。 */
async function callHealth(dataSource: string) {
	vi.resetModules();
	process.env.DATA_SOURCE = dataSource;
	const mod = await import('../../../src/routes/api/health/+server');
	const res = await mod.GET({} as never);
	return { status: res.status, body: await res.json() };
}

describe('#3977 /api/health の backup フィールド', () => {
	const original = process.env.DATA_SOURCE;

	beforeEach(() => {
		getPgliteBackupStatus.mockReset();
		getPgliteBackupStatus.mockResolvedValue(STATUS);
	});

	afterEach(() => {
		if (original === undefined) delete process.env.DATA_SOURCE;
		else process.env.DATA_SOURCE = original;
	});

	// #4087: 生の status に加えて **判定結果** (backupHealth) も同じ条件で載る。
	// 生値だけだと「lastSuccessAt が 3 日前」を読んだ人が毎回自分で深刻度を判断することになり、
	// 実際 2026-07-31 は 18 日間誰もその判断をしなかった (#4119)。
	// 判定そのものは tests/unit/domain/backup-health.test.ts が固定するので、
	// ここが固定するのは **判定結果が endpoint まで出ている** ことだけ。
	it('[H5] pglite では backupHealth も載る (#4087)', async () => {
		const { status, body } = await callHealth('pglite');
		expect(status).toBe(200);
		expect(body.backupHealth).toMatchObject({
			level: expect.any(String),
			reason: expect.any(String),
			notificationMissing: expect.any(Boolean),
		});
	});

	it.each([
		['dsql'],
		['sqlite'],
	])('[H6] %s では backupHealth を載せない (backup と同条件、公開範囲を広げない)', async (dataSource) => {
		const { body } = await callHealth(dataSource);
		expect(body).not.toHaveProperty('backupHealth');
	});

	it('[H7] 状態ファイルが読めなければ backupHealth も省略する (fail-open で ok を偽らない)', async () => {
		// 「読めない = 正常に見える」は起点の事故 (18 日気づかなかった) と同型なので、
		// 判定できないときは **判定結果を出さない**。ok を偽って返さない。
		getPgliteBackupStatus.mockRejectedValue(new Error('ENOENT'));
		const { status, body } = await callHealth('pglite');
		expect(status).toBe(200);
		expect(body).not.toHaveProperty('backup');
		expect(body).not.toHaveProperty('backupHealth');
	});

	it('[H1] pglite では backup が載り、getPgliteBackupStatus が呼ばれる (dead export の解消)', async () => {
		const { status, body } = await callHealth('pglite');
		expect(status).toBe(200);
		expect(getPgliteBackupStatus).toHaveBeenCalledTimes(1);
		expect(body.backup).toEqual(STATUS);
	});

	// クラウド (dsql) の /api/health は**未認証で公開**されている。ここに運用情報を足すと
	// 「いつからバックアップが止まっているか」を外部に教えることになるため、載せない判断
	// (PO 決裁を要さない範囲に収める) を test で固定する。
	it.each([
		'dsql',
		'sqlite',
		'demo',
	])('[H2] %s では backup を載せず、状態ファイルも読まない (公開範囲を広げない)', async (dataSource) => {
		const { status, body } = await callHealth(dataSource);
		expect(status).toBe(200);
		expect(body).not.toHaveProperty('backup');
		expect(getPgliteBackupStatus).not.toHaveBeenCalled();
	});

	it('[H3] 状態ファイルが読めなくても liveness は 200 のまま (probe の意味を変えない)', async () => {
		getPgliteBackupStatus.mockRejectedValue(new Error('ENOENT'));
		const { status, body } = await callHealth('pglite');
		expect(status).toBe(200);
		expect(body.status).toBe('ok');
		expect(body).not.toHaveProperty('backup');
	});

	it('[H4] 失敗が記録されていればそのまま見える (成功だけ見せて沈黙させない)', async () => {
		getPgliteBackupStatus.mockResolvedValue({
			...STATUS,
			lastFailureAt: '2026-07-27T01:00:00.000Z',
			lastFailureMessage: 'verify failed',
		});
		const { body } = await callHealth('pglite');
		expect(body.backup.lastFailureAt).toBe('2026-07-27T01:00:00.000Z');
		expect(body.backup.lastFailureMessage).toBe('verify failed');
	});
});
