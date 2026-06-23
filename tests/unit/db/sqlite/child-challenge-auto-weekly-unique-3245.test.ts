// tests/unit/db/sqlite/child-challenge-auto-weekly-unique-3245.test.ts
//
// #3245: auto:weekly の (child_id, start_date) 一意性 + atomic getOrCreateWeeklyAuto を
// 実 SQLite で固定する。旧 auto_challenges UNIQUE(child_id, week_start) を child_challenges
// 一本化で喪失していたため、concurrent 二重 INSERT (= ポイント二重付与) を DB レベルで不可能化する。

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

import { childChallenges, children } from '$lib/server/db/schema';
import { getOrCreateWeeklyAuto, insert } from '$lib/server/db/sqlite/child-challenge-repo';

const TENANT = 't-3245';
const WEEK = '2026-06-22';

function autoInput(childId: number, startDate = WEEK) {
	return {
		childId,
		title: `今週は「うんどう」を3回`,
		description: 'desc',
		challengeType: 'cooperative',
		periodType: 'weekly',
		startDate,
		endDate: '2026-06-28',
		targetConfig: '{"metric":"count","categoryId":1,"baseTarget":3}',
		rewardConfig: '{"points":30}',
		sourceTemplateId: 'auto:weekly',
		targetValue: 3,
	};
}

describe('#3245 child_challenges auto:weekly 一意性 / atomic getOrCreateWeeklyAuto', () => {
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

	it('concurrent な複数 getOrCreateWeeklyAuto が 1 行に収束する (二重 INSERT なし)', async () => {
		const results = await Promise.all(
			Array.from({ length: 5 }, () => getOrCreateWeeklyAuto(autoInput(childId), TENANT)),
		);

		// 全 caller が同一 id を受け取る
		const ids = new Set(results.map((r) => r.id));
		expect(ids.size).toBe(1);

		// DB 上も auto:weekly 行は 1 件のみ (= ポイント二重付与の源 = 二重行 が存在しない)
		const rows = dbHolder
			.db!.select()
			.from(childChallenges)
			.all()
			.filter((c) => c.childId === childId && c.startDate === WEEK);
		expect(rows.length).toBe(1);
	});

	it('別週 (別 start_date) は別行として共存できる', async () => {
		await getOrCreateWeeklyAuto(autoInput(childId, '2026-06-22'), TENANT);
		await getOrCreateWeeklyAuto(autoInput(childId, '2026-06-29'), TENANT);
		const rows = dbHolder.db!.select().from(childChallenges).all();
		expect(rows.filter((c) => c.sourceTemplateId === 'auto:weekly').length).toBe(2);
	});

	it('部分 index は auto:weekly 以外を制約しない (手動行は同一 child×date で複数可)', async () => {
		const manual = { ...autoInput(childId), sourceTemplateId: null };
		await insert(manual, TENANT);
		await insert(manual, TENANT);
		const rows = dbHolder.db!.select().from(childChallenges).all();
		expect(rows.filter((c) => c.sourceTemplateId === null).length).toBe(2);
	});
});
