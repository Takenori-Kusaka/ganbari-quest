// tests/unit/db/dsql-migration-async-poll.test.ts
// EPIC #3424 / M4-B① カスタム migration runner — ASYNC build poll ロジック test。
// 設計 SSOT: docs/design/dsql/m4-implementation-plan.md §3.2 責務 3 (F3)
//   実測根拠: docs/research/dsql-poc-phase1-results-2026-07-05.md 検証 3 (#3427)
//
// sys.jobs クエリ結果を mock し、completed 待ち / timeout / failed / **多行 stale-row 混在**の
// 保守的判定を検証する。実 DSQL への接続は不要 (poll ロジックのオフライン検証)。
//
// ⚠️ 過剰主張の禁止: sys.jobs の履歴保持セマンティクス (過去 build 行が残るか / start_time 列名)
//    は PoC 未検証。poll は watermark + ORDER BY start_time DESC LIMIT 1 + 最新 1 行のみ判定で
//    **fail-open (stale completed で即 done) を構造的に排除**する防御設計。実挙動は M4 後半の
//    使い捨てクラスタで実測する follow-up 推奨 (本テストは判定ロジックの正しさのみを担保)。

import { describe, expect, it, vi } from 'vitest';
import {
	captureIndexBuildWatermark,
	pollAsyncIndexBuild,
	type RawSqlExecutor,
} from '../../../src/lib/server/db/dsql/migration/async-index-poll';

/** 各 poll で単一 status 行 (または空) を順に返す mock。呼ばれた query を記録する。 */
function mockStatuses(seq: Array<string | null>): RawSqlExecutor & { queries: string[] } {
	let i = 0;
	const queries: string[] = [];
	return {
		queries,
		execute: async (sqlText: string) => {
			queries.push(sqlText);
			const status = seq[Math.min(i, seq.length - 1)];
			i += 1;
			return { rows: status === null ? [] : [{ status }] };
		},
	};
}

/** 各 poll で「行配列」を順に返す mock (多行 stale-row 混在の検証用)。 */
function mockRowSets(
	seq: Array<Array<{ status: string }>>,
): RawSqlExecutor & { queries: string[] } {
	let i = 0;
	const queries: string[] = [];
	return {
		queries,
		execute: async (sqlText: string) => {
			queries.push(sqlText);
			const rows = seq[Math.min(i, seq.length - 1)];
			i += 1;
			return { rows };
		},
	};
}

const noSleep = async () => {};

describe('pollAsyncIndexBuild — 責務 3 (F3) 基本判定', () => {
	it('completed が即現れたら resolve する', async () => {
		const exec = mockStatuses(['completed']);
		await expect(
			pollAsyncIndexBuild(exec, 'members_uq', { sleep: noSleep }),
		).resolves.toBeUndefined();
		expect(exec.queries).toHaveLength(1);
	});

	it("sys.jobs を INDEX_BUILD + object_name='public.<idx>' + ORDER BY start_time DESC LIMIT 1 で query する", async () => {
		const exec = mockStatuses(['completed']);
		await pollAsyncIndexBuild(exec, 'members_uq', { sleep: noSleep });
		expect(exec.queries[0]).toMatch(/job_type = 'INDEX_BUILD'/);
		expect(exec.queries[0]).toMatch(/object_name = 'public\.members_uq'/);
		expect(exec.queries[0]).toMatch(/ORDER BY start_time DESC LIMIT 1/);
	});

	it('afterWatermark 指定時は start_time > <watermark> フィルタを付ける (今回 build 限定)', async () => {
		const exec = mockStatuses(['completed']);
		await pollAsyncIndexBuild(exec, 'idx', {
			sleep: noSleep,
			afterWatermark: '2026-07-06T00:00:00Z',
		});
		expect(exec.queries[0]).toMatch(/start_time > '2026-07-06T00:00:00Z'/);
	});

	it('row 未登録 → processing → completed の遷移を待って resolve する', async () => {
		const exec = mockStatuses([null, 'processing', 'completed']);
		const sleep = vi.fn(async () => {});
		await expect(pollAsyncIndexBuild(exec, 'idx', { sleep })).resolves.toBeUndefined();
		expect(exec.queries).toHaveLength(3);
		expect(sleep).toHaveBeenCalledTimes(2);
	});

	it('failed が現れたら throw する (dedup すり抜け防止、F3 hard 制約)', async () => {
		const exec = mockStatuses(['processing', 'failed']);
		await expect(pollAsyncIndexBuild(exec, 'idx', { sleep: noSleep })).rejects.toThrow(/FAILED/);
	});

	it('timeout 超過で throw する (build 完了前に書込を開放しない)', async () => {
		let t = 0;
		const exec = mockStatuses(['processing']); // 永遠に processing
		const now = () => {
			const v = t;
			t += 400;
			return v;
		};
		await expect(
			pollAsyncIndexBuild(exec, 'idx', { sleep: noSleep, now, timeoutMs: 1000, intervalMs: 400 }),
		).rejects.toThrow(/TIMEOUT/);
	});
});

// ── [must] fail-open 回帰ガード: 多行 stale-row 混在で保守的判定 ──
// poll は `ORDER BY start_time DESC LIMIT 1` で最新 1 行のみを評価する (rows[0]=最新)。
// driver が LIMIT を無視して多行返しても、stale completed を「completed だから done」と
// 信じないこと・stale failed で誤 throw しないことを検証する。
describe('pollAsyncIndexBuild — 多行 stale-row 保守的判定 (fail-open/fail-close ガード)', () => {
	it('(a) 最新=processing + stale completed → completed を返さず待機継続する', async () => {
		// 1 回目: [最新 processing, stale completed] → 待機。2 回目: [最新 completed] → done。
		const exec = mockRowSets([
			[{ status: 'processing' }, { status: 'completed' }],
			[{ status: 'completed' }],
		]);
		const sleep = vi.fn(async () => {});
		await expect(pollAsyncIndexBuild(exec, 'idx', { sleep })).resolves.toBeUndefined();
		// 1 回目で即 done しなかった (stale completed を信じなかった) こと。
		expect(sleep).toHaveBeenCalledTimes(1);
		expect(exec.queries).toHaveLength(2);
	});

	it('(b) 最新=completed + stale failed → stale failed で throw せず done する', async () => {
		const exec = mockRowSets([[{ status: 'completed' }, { status: 'failed' }]]);
		await expect(pollAsyncIndexBuild(exec, 'idx', { sleep: noSleep })).resolves.toBeUndefined();
	});

	it('(c) 最新=failed → throw する (今回 build の失敗)', async () => {
		const exec = mockRowSets([[{ status: 'failed' }, { status: 'completed' }]]);
		await expect(pollAsyncIndexBuild(exec, 'idx', { sleep: noSleep })).rejects.toThrow(/FAILED/);
	});
});

describe('pollAsyncIndexBuild — object_name の安全性', () => {
	it('制御文字を含む index 名は poll せず throw する', async () => {
		const exec = mockStatuses(['completed']);
		await expect(pollAsyncIndexBuild(exec, 'idx\nDROP', { sleep: noSleep })).rejects.toThrow(
			/invalid index name/,
		);
		expect(exec.queries).toHaveLength(0);
	});

	it('引用符を含む index 名は SQL literal escaping される (injection しない)', async () => {
		const exec = mockStatuses(['completed']);
		await pollAsyncIndexBuild(exec, "a'b", { sleep: noSleep });
		// 'public.a''b' のように単一引用が二重化されて埋め込まれる。
		expect(exec.queries[0]).toContain("object_name = 'public.a''b'");
	});
});

describe('captureIndexBuildWatermark', () => {
	it('既存 job の max(start_time) を watermark として返す', async () => {
		const queries: string[] = [];
		const exec: RawSqlExecutor = {
			execute: async (q: string) => {
				queries.push(q);
				return { rows: [{ watermark: '2026-07-06T01:00:00Z' }] };
			},
		};
		const wm = await captureIndexBuildWatermark(exec, 'idx');
		expect(wm).toBe('2026-07-06T01:00:00Z');
		expect(queries[0]).toMatch(/max\(start_time\) AS watermark/);
		expect(queries[0]).toMatch(/object_name = 'public\.idx'/);
	});

	it('既存 job が無ければ null を返す (発行後の最初の行が今回 build になる)', async () => {
		const exec: RawSqlExecutor = { execute: async () => ({ rows: [{ watermark: null }] }) };
		expect(await captureIndexBuildWatermark(exec, 'idx')).toBeNull();
	});

	it('行自体が無い応答でも null を返す', async () => {
		const exec: RawSqlExecutor = { execute: async () => ({ rows: [] }) };
		expect(await captureIndexBuildWatermark(exec, 'idx')).toBeNull();
	});
});
