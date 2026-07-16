// tests/unit/db/sqlite/evaluation-week-unique-3782.test.ts
//
// #3782: evaluations の (child_id, week_start) 一意性 + 冪等 insertEvaluation を実 SQLite で固定する。
// 兄弟表 (rest_days / login_bonuses / stamp_cards) と同型に「1子1週1評価」を DB 層で物理一意化し、
// service 層 pre-fetch dedup (#3355) を経由しない別 insert 経路・並行ロードでも二重行を作らない
// (ADR-0061 push-down-pyramid)。#3245 auto:weekly unique と同型の回帰固定。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestSqlite } from '../../helpers/test-db';

const dbHolder: { sqlite: TestSqlite | null; db: ReturnType<typeof createTestDb>['db'] | null } = {
	sqlite: null,
	db: null,
};

vi.mock('$lib/server/db/client', () => ({
	get db() {
		if (!dbHolder.db) throw new Error('test db not initialized');
		return dbHolder.db;
	},
}));

import { asChildId } from '$lib/domain/ids';
import { children, evaluations as evaluationsTable } from '$lib/server/db/schema';
import { insertEvaluation } from '$lib/server/db/sqlite/evaluation-repo';

const TENANT = 't-3782';

function evalInput(childId: number, weekStart: string, scoresJson = '{"a":1}') {
	return {
		childId: asChildId(childId),
		weekStart,
		weekEnd: '2026-06-07',
		scoresJson,
		bonusPoints: 10,
	};
}

describe('#3782 evaluations (child, week) 一意性 / 冪等 insertEvaluation', () => {
	let childId: number;

	beforeEach(() => {
		const { sqlite, db } = createTestDb();
		dbHolder.sqlite = sqlite;
		dbHolder.db = db;
		childId = db
			.insert(children)
			.values({ nickname: 'けんた', age: 8, theme: 'default', uiMode: 'elementary' })
			.returning()
			.get().id;
	});

	it('同 (child, weekStart) の再 insert は冪等 — 二重行を作らず既存行を返す (throw しない)', async () => {
		const first = await insertEvaluation(evalInput(childId, '2026-06-01', '{"a":1}'), TENANT);
		// 内容が違っても新規行は作らない (並行ロード / restore backstop 相当)
		const second = await insertEvaluation(evalInput(childId, '2026-06-01', '{"a":999}'), TENANT);

		expect(second.id).toBe(first.id);
		expect(second.scoresJson).toBe('{"a":1}'); // 既存行が保全される (上書きしない)

		// DB 上も (child, weekStart) 行は 1 件のみ (= growth-book/reports の数値汚染源 = 二重行 が存在しない)
		const rows = dbHolder
			.db!.select()
			.from(evaluationsTable)
			.all()
			.filter((e) => e.childId === childId && e.weekStart === '2026-06-01');
		expect(rows.length).toBe(1);
	});

	it('並行 insert (Promise.all) が 1 行に収束する (二重計上なし)', async () => {
		await Promise.all(
			Array.from({ length: 5 }, () => insertEvaluation(evalInput(childId, '2026-06-08'), TENANT)),
		);
		const rows = dbHolder
			.db!.select()
			.from(evaluationsTable)
			.all()
			.filter((e) => e.childId === childId && e.weekStart === '2026-06-08');
		expect(rows.length).toBe(1);
	});

	it('別週 (別 weekStart) は別行として共存できる', async () => {
		await insertEvaluation(evalInput(childId, '2026-06-01'), TENANT);
		await insertEvaluation(evalInput(childId, '2026-06-08'), TENANT);
		const rows = dbHolder.db!.select().from(evaluationsTable).all();
		expect(rows.filter((e) => e.childId === childId).length).toBe(2);
	});

	it('生 INSERT の重複は unique index (idx_evaluations_child_week) で物理拒否される', () => {
		dbHolder
			.db!.insert(evaluationsTable)
			.values({ childId, weekStart: '2026-06-15', weekEnd: '2026-06-21', scoresJson: '{}' })
			.run();
		expect(() =>
			dbHolder
				.db!.insert(evaluationsTable)
				.values({ childId, weekStart: '2026-06-15', weekEnd: '2026-06-21', scoresJson: '{}' })
				.run(),
		).toThrow();
	});
});
