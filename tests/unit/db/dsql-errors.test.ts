// tests/unit/db/dsql-errors.test.ts
// EPIC #3424 / M4-E item 11 (#3435) / 設計 SSOT: dsql-data-model.md §8
//
// エラー分類集約点 (dsql-errors.ts) の契約テスト。**実 PGlite が投げる本物の pg error** で
// 分類器を検証する (合成 error object だけの検証は driver の error shape 変化を見逃すため):
//   - 23505: owner_guard (2 人目 owner) / weekly_auto_guard (同週 auto 重複) — constraint 名の抽出まで
//   - 23514: CHECK 違反 (enum SSOT 逸脱)
//   - 40001 との相互排他: 23505 を isOccConflict が誤 retry しない (二重付与の防止根拠)

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	isCheckViolation,
	isUniqueViolation,
	sqlstateOf,
	uniqueConstraintOf,
} from '../../../src/lib/server/db/dsql/dsql-errors';
import { isOccConflict } from '../../../src/lib/server/db/dsql/occ-retry';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

const FAMILY = '00000000-0000-4000-8000-0000000000e1';
const USER_A = '00000000-0000-4000-8000-0000000000e2';
const USER_B = '00000000-0000-4000-8000-0000000000e3';
const CHILD = '00000000-0000-4000-8000-0000000000e4';

async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
	try {
		await fn();
	} catch (err) {
		return err;
	}
	throw new Error('expected error was not thrown');
}

describe('dsql-errors 分類集約点 (実 PGlite error、§8)', () => {
	let t: DsqlTestDb;

	beforeAll(async () => {
		t = await createDsqlTestDb();
	}, 60_000);
	afterAll(async () => {
		await t.close();
	});

	it('[E1] owner_guard 2 人目 owner は 23505 + constraint 名抽出 (retry 対象外)', async () => {
		await t.db.execute(
			sql`INSERT INTO families (family_id, name, status) VALUES (${FAMILY}, 'f', 'active')`,
		);
		await t.db.execute(
			sql`INSERT INTO memberships (family_id, user_id, role) VALUES (${FAMILY}, ${USER_A}, 'owner')`,
		);
		const err = await captureError(() =>
			t.db.execute(
				sql`INSERT INTO memberships (family_id, user_id, role) VALUES (${FAMILY}, ${USER_B}, 'owner')`,
			),
		);
		expect(sqlstateOf(err)).toBe('23505');
		expect(isUniqueViolation(err)).toBe(true);
		expect(uniqueConstraintOf(err)).toMatch(/owner_guard/);
		// 相互排他: 23505 を OCC retry してはならない (二重付与化)
		expect(isOccConflict(err)).toBe(false);
		expect(isCheckViolation(err)).toBe(false);
	});

	it('[E2] weekly_auto_guard 同週 auto 重複は 23505 + constraint 名抽出', async () => {
		const insertAuto = () =>
			t.db.execute(sql`
				INSERT INTO child_challenges
					(family_id, child_id, title, start_date, end_date, target_config, reward_config,
					 source_template_id, target_value)
				VALUES (${FAMILY}, ${CHILD}, 'auto', '2026-07-06', '2026-07-12', '{}', '{}',
					'auto:weekly', 5)
			`);
		await insertAuto();
		const err = await captureError(insertAuto);
		expect(isUniqueViolation(err)).toBe(true);
		expect(uniqueConstraintOf(err)).toMatch(/weekly_auto_guard/);
	});

	it('[E3] CHECK 違反 (enum SSOT 逸脱) は 23514 (validation 層の欠陥として分類)', async () => {
		const err = await captureError(() =>
			t.db.execute(sql`
				INSERT INTO child_challenges
					(family_id, child_id, title, start_date, end_date, target_config, reward_config,
					 target_value, status)
				VALUES (${FAMILY}, ${CHILD}, 'bad', '2026-07-06', '2026-07-12', '{}', '{}', 5,
					'not-a-status')
			`),
		);
		expect(sqlstateOf(err)).toBe('23514');
		expect(isCheckViolation(err)).toBe(true);
		expect(isUniqueViolation(err)).toBe(false);
		expect(isOccConflict(err)).toBe(false);
	});

	it('[E4] cause 1 段 wrap でも SQLSTATE / constraint を抽出できる (drizzle wrap 対応)', () => {
		const raw = { code: '23505', constraint: 'users_email_lower_unique' };
		const wrapped = new Error('wrapped');
		(wrapped as unknown as { cause: unknown }).cause = raw;
		expect(sqlstateOf(wrapped)).toBe('23505');
		expect(isUniqueViolation(wrapped)).toBe(true);
		expect(uniqueConstraintOf(wrapped)).toBe('users_email_lower_unique');
	});

	it('[E5] 非 pg error は全分類 false (誤分類なし)', () => {
		for (const err of [new Error('plain'), null, undefined, 'string', 42]) {
			expect(sqlstateOf(err)).toBeUndefined();
			expect(isUniqueViolation(err)).toBe(false);
			expect(isCheckViolation(err)).toBe(false);
			expect(isOccConflict(err)).toBe(false);
		}
	});
});
