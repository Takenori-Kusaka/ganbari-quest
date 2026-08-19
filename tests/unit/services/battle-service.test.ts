// tests/unit/services/battle-service.test.ts
// #4681: バトル報酬 (勝利 dropPoints / 敗北 consolationPoints) が point_ledger に計上される
// (act → outcome → persistence)。旧実装は daily_battles.reward_points に書くだけで台帳に
// 載らず、画面「+10ポイント」に対してヘッダー残高が一度も増えなかった。

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import { closeDb, createTestDb, resetDb, type TestDb, type TestSqlite } from '../helpers/test-db';

let sqlite: TestSqlite;
let testDb: TestDb;

vi.mock('$lib/server/db', () => ({
	get db() {
		return testDb;
	},
}));
vi.mock('$lib/server/db/client', () => ({
	get db() {
		return testDb;
	},
}));

import { asChildId } from '$lib/domain/ids';
import { getEnemyById } from '../../../src/lib/domain/battle-enemies';
import {
	BATTLE_LEDGER_TYPE,
	executeDailyBattle,
	getTodayBattle,
} from '../../../src/lib/server/services/battle-service';

const TENANT = 'test-tenant';
const CHILD = asChildId(1);
const CATEGORY_XP = { health: 100, study: 100, social: 100, life: 100, creative: 100 };

beforeAll(() => {
	const t = createTestDb();
	sqlite = t.sqlite;
	testDb = t.db;
});

afterAll(() => {
	closeDb(sqlite);
});

beforeEach(() => {
	resetDb(sqlite);
	testDb.insert(schema.children).values({ nickname: 'けんた', age: 8, theme: 'blue' }).run();
});

function ledgerRows() {
	return testDb.select().from(schema.pointLedger).where(eq(schema.pointLedger.childId, 1)).all();
}

describe('#4681 executeDailyBattle → point_ledger 計上', () => {
	it('勝敗に応じた報酬が type=battle で台帳に 1 行計上され、表示額と一致する', async () => {
		const info = await getTodayBattle(CHILD, 'elementary', CATEGORY_XP, TENANT);
		expect(info.completed).toBe(false);
		expect(ledgerRows()).toHaveLength(0);

		const result = await executeDailyBattle(CHILD, 'elementary', CATEGORY_XP, TENANT);
		const enemy = getEnemyById(info.enemy.id);
		if (!enemy) throw new Error('enemy not found');
		const expected =
			result.battleResult.outcome === 'win' ? enemy.dropPoints : enemy.consolationPoints;
		expect(result.rewardPoints).toBe(expected);
		expect(result.battleResult.rewardPoints).toBe(expected);

		const rows = ledgerRows();
		expect(rows).toHaveLength(1);
		const row = rows[0];
		if (!row) throw new Error('ledger row missing');
		expect(row.type).toBe(BATTLE_LEDGER_TYPE);
		expect(row.amount).toBe(expected);
		// 冪等キー (child, type, reference) = battleId で二重付与を DB 層が拒否する
		expect(String(row.referenceId)).toBe(info.battleId);

		// 残高 = SUM(ledger) が画面表示額と一致
		const sum = rows.reduce((acc, r) => acc + r.amount, 0);
		expect(sum).toBe(expected);
	});

	it('1 日 1 回制限: 2 回目は throw し、台帳は増えない', async () => {
		await getTodayBattle(CHILD, 'elementary', CATEGORY_XP, TENANT);
		await executeDailyBattle(CHILD, 'elementary', CATEGORY_XP, TENANT);
		await expect(executeDailyBattle(CHILD, 'elementary', CATEGORY_XP, TENANT)).rejects.toThrow(
			/既に完了/,
		);
		const rows = ledgerRows();
		expect(rows).toHaveLength(1);

		const again = await getTodayBattle(CHILD, 'elementary', CATEGORY_XP, TENANT);
		expect(again.completed).toBe(true);
		expect(again.result?.rewardPoints).toBe(rows[0]?.amount);
	});
});
