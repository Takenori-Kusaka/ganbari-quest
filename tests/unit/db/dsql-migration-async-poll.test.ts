// tests/unit/db/dsql-migration-async-poll.test.ts
// EPIC #3424 / M4-B① カスタム migration runner — ASYNC build poll ロジック test。
// 設計 SSOT: docs/design/dsql/m4-implementation-plan.md §3.2 責務 3 (F3)
//   実測根拠: docs/research/dsql-poc-phase1-results-2026-07-05.md 検証 3 (#3427)
//
// sys.jobs クエリ結果を mock し、completed 待ち / timeout / failed ハンドリングを検証する。
// 実 DSQL への接続は不要 (poll ロジックのオフライン検証)。

import { describe, expect, it, vi } from 'vitest';
import {
	pollAsyncIndexBuild,
	type RawSqlExecutor,
} from '../../../src/lib/server/db/dsql/migration/async-index-poll';

/** status 文字列の列を順に返す mock executor。呼ばれた query も記録する。 */
function mockExecutor(
	statusSequence: Array<string | null>,
): RawSqlExecutor & { queries: string[] } {
	let i = 0;
	const queries: string[] = [];
	return {
		queries,
		execute: async (sqlText: string) => {
			queries.push(sqlText);
			const status = statusSequence[Math.min(i, statusSequence.length - 1)];
			i += 1;
			return { rows: status === null ? [] : [{ status }] };
		},
	};
}

const noSleep = async () => {};

describe('pollAsyncIndexBuild — 責務 3 (F3)', () => {
	it('completed が即現れたら resolve する', async () => {
		const exec = mockExecutor(['completed']);
		await expect(
			pollAsyncIndexBuild(exec, 'members_uq', { sleep: noSleep }),
		).resolves.toBeUndefined();
		expect(exec.queries).toHaveLength(1);
	});

	it("sys.jobs を object_name='public.<idx>' + INDEX_BUILD で query する", async () => {
		const exec = mockExecutor(['completed']);
		await pollAsyncIndexBuild(exec, 'members_uq', { sleep: noSleep });
		expect(exec.queries[0]).toMatch(/job_type = 'INDEX_BUILD'/);
		expect(exec.queries[0]).toMatch(/object_name = 'public\.members_uq'/);
	});

	it('row 未登録 → processing → completed の遷移を待って resolve する', async () => {
		const exec = mockExecutor([null, 'processing', 'completed']);
		const sleep = vi.fn(async () => {});
		await expect(pollAsyncIndexBuild(exec, 'idx', { sleep })).resolves.toBeUndefined();
		expect(exec.queries).toHaveLength(3);
		expect(sleep).toHaveBeenCalledTimes(2);
	});

	it('failed が現れたら throw する (dedup すり抜け防止、F3 hard 制約)', async () => {
		const exec = mockExecutor(['processing', 'failed']);
		await expect(pollAsyncIndexBuild(exec, 'idx', { sleep: noSleep })).rejects.toThrow(/FAILED/);
	});

	it('timeout 超過で throw する (build 完了前に書込を開放しない)', async () => {
		// now() を単調増加させ intervalMs 経過ごとに時刻を進める。
		let t = 0;
		const exec = mockExecutor(['processing']); // 永遠に processing
		const now = () => {
			const v = t;
			t += 400; // 1 poll ごとに 400ms 進む
			return v;
		};
		await expect(
			pollAsyncIndexBuild(exec, 'idx', { sleep: noSleep, now, timeoutMs: 1000, intervalMs: 400 }),
		).rejects.toThrow(/TIMEOUT/);
	});

	it('不正な index 名 (識別子外の文字) は poll せず throw する', async () => {
		const exec = mockExecutor(['completed']);
		await expect(pollAsyncIndexBuild(exec, "idx'; DROP", { sleep: noSleep })).rejects.toThrow(
			/invalid index name/,
		);
		expect(exec.queries).toHaveLength(0);
	});
});
