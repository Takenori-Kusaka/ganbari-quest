// tests/integration/db/point-month-boundary-parity.test.ts
// #4697 follow-up: 月次レポートの「ポイント」(sumEarnedPointsBetween) の**月境界**を、
// pg-core backend (dsql repos を verbatim 再利用する pglite = NUC / cloud DSQL) 側で固定する。
//
// pg-core は `recorded_date` (書込時の JST 今日、NOT NULL) で絞るため、JST 00:00〜09:00 に
// 記録したポイントも JST 暦月に入る。sqlite backend の同じ表明
// (tests/unit/server/db/sqlite/point-repo-earned.test.ts) と **同一 fixture** を共有し、
// 「同じ台帳なら backend が違っても同じ月に同じ額」を 2 箇所から表明する
// (期待値のハードコードを backend ごとに散らさない)。
//
// 書込は実経路 (`insertPointEntry` → point-write の単一プリミティブ) を通す。recorded_date は
// `todayDateJST()` で導出されるため、fixture の瞬間へ時計を寄せて挿入する = 本番と同じ導出。

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { monthEndOfKey } from '$lib/domain/date-utils';
import type { asChildId } from '../../../src/lib/domain/ids';
import {
	expectedEarnedInJstMonth,
	POINT_MONTH_BOUNDARY_MONTHS,
	POINT_MONTH_BOUNDARY_ROWS,
} from '../../helpers/point-month-boundary-fixture';

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const TENANT = '00000000-0000-4000-8000-000000004697';
const originalDataSource = process.env.DATA_SOURCE;
const originalDataDir = process.env.PGLITE_DATA_DIR;

type PgliteConn = typeof import('../../../src/lib/server/db/pglite/connection');
let pgliteConn: PgliteConn;
let repos: ReturnType<typeof import('../../../src/lib/server/db/factory').getRepos>;
let childId: ReturnType<typeof asChildId>;

beforeAll(async () => {
	vi.resetModules();
	process.env.DATA_SOURCE = 'pglite';
	delete process.env.PGLITE_DATA_DIR;
	pgliteConn = await import('../../../src/lib/server/db/pglite/connection');
	await pgliteConn.resetPgliteConnectionForTesting();
	await pgliteConn.initPgliteConnection();
	const { getRepos } = await import('../../../src/lib/server/db/factory');
	repos = getRepos();
	const child = await repos.child.insertChild({ nickname: 'きょうかい', age: 8 }, TENANT);
	childId = child.id;

	// 各行を「その瞬間に記録した」状態で挿入する。Date のみ差し替え (pglite 内部の timer は温存)。
	vi.useFakeTimers({ toFake: ['Date'] });
	try {
		for (const row of POINT_MONTH_BOUNDARY_ROWS) {
			vi.setSystemTime(new Date(row.createdAtUtcIso));
			await repos.point.insertPointEntry(
				{ childId, amount: row.amount, type: 'activity', description: row.label },
				TENANT,
			);
		}
	} finally {
		vi.useRealTimers();
	}
}, 120_000);

afterAll(async () => {
	await pgliteConn?.resetPgliteConnectionForTesting();
	if (originalDataSource === undefined) delete process.env.DATA_SOURCE;
	else process.env.DATA_SOURCE = originalDataSource;
	if (originalDataDir === undefined) delete process.env.PGLITE_DATA_DIR;
	else process.env.PGLITE_DATA_DIR = originalDataDir;
});

describe('#4697 pg-core sumEarnedPointsBetween の月境界 (JST 暦日)', () => {
	it.each(POINT_MONTH_BOUNDARY_MONTHS)('%s の獲得合計が JST 暦月と一致する', async (monthKey) => {
		const total = await repos.point.sumEarnedPointsBetween(
			childId,
			`${monthKey}-01`,
			monthEndOfKey(monthKey),
			TENANT,
		);

		expect(total).toBe(expectedEarnedInJstMonth(monthKey));
	});

	it('JST 00:00〜09:00 の獲得を隣の月に取りこぼさない (合計が保存される)', async () => {
		const totals: number[] = [];
		for (const monthKey of POINT_MONTH_BOUNDARY_MONTHS) {
			totals.push(
				await repos.point.sumEarnedPointsBetween(
					childId,
					`${monthKey}-01`,
					monthEndOfKey(monthKey),
					TENANT,
				),
			);
		}

		expect(totals.reduce((a, b) => a + b, 0)).toBe(
			POINT_MONTH_BOUNDARY_ROWS.reduce((sum, r) => sum + r.amount, 0),
		);
	});
});
