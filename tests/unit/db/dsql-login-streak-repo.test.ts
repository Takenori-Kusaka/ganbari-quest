// tests/unit/db/dsql-login-streak-repo.test.ts
// #3330 (案 B counter 縮約) — 同時 claim race 回帰 (ADR-0061 failing-test-first)。
//
// 冪等の担保方式が旧 per-date PK 衝突 → counter への conditional write に変わるため、
// 「同時 claim 2 連発で 1 回のみ加点」を実 PGlite (実 schema) で検証する。
//
// failing-test-first の物理確認 (実装 PR で実施済):
//   claimToday を read-then-write (SELECT で claim 済判定 → 無条件 UPSERT) の naive 実装に
//   差し替えると、fire→settle の同時 2 claim が両方 read を先に済ませて両方 write に成功し
//   [R1] が fail する (勝者 2 = 二重加点相当)。単一 INSERT ... ON CONFLICT DO UPDATE ...
//   WHERE last_login_date <> excluded.last_login_date (conditional write) では statement
//   atomicity により勝者が常に 1 で green。
//
// ⚠️ PGlite は単一接続: tx 内で tx 外 db を await すると deadlock するため、並行性は
// fire→settle (先に全 promise を発火してから settle) で再現する (#3531 知見)。

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChildId } from '../../../src/lib/domain/ids';
import { createDsqlLoginBonusRepo } from '../../../src/lib/server/db/dsql/login-bonus-repo';
import type { ILoginBonusRepo } from '../../../src/lib/server/db/interfaces/login-bonus-repo.interface';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

const FAMILY = '00000000-0000-4000-8000-0000000000b1';

describe('DSQL login-streak claim race (#3330、実 schema PGlite)', () => {
	let t: DsqlTestDb;
	let repo: ILoginBonusRepo;
	let childId: ChildId;

	beforeAll(async () => {
		t = await createDsqlTestDb();
		repo = createDsqlLoginBonusRepo(t.db);
		const res = await t.db.execute(sql`
			INSERT INTO children (family_id, nickname) VALUES (${FAMILY}, 'レース太郎')
			RETURNING child_id
		`);
		childId = (res.rows[0] as { child_id: string }).child_id as ChildId;
	}, 60_000);
	afterAll(async () => {
		await t.close();
	});

	it('[R1] 同時 claim 2 連発 → 勝者は 1 つだけ (conditional write の statement atomicity)', async () => {
		// fire→settle: 両方を await せずに発火してから解決する (PGlite 単一接続下の並行再現)
		const p1 = repo.claimToday(childId, '2026-07-19', '2026-07-18', FAMILY);
		const p2 = repo.claimToday(childId, '2026-07-19', '2026-07-18', FAMILY);
		const [r1, r2] = await Promise.all([p1, p2]);

		const winners = [r1, r2].filter((r) => r !== undefined);
		expect(winners.length).toBe(1); // 二重加点相当 (勝者 2) を禁止
		expect(winners[0]).toEqual({ currentStreak: 1 });

		// counter は 1 行・streak 1 (二重 increment されない)
		const row = await t.db.execute(sql`
			SELECT current_streak FROM login_streaks
			WHERE family_id = ${FAMILY} AND child_id = ${childId}
		`);
		expect(row.rows.length).toBe(1);
		expect((row.rows[0] as { current_streak: number }).current_streak).toBe(1);
	});

	it('[R2] 翌日の同時 claim 2 連発 → increment も 1 回だけ', async () => {
		const p1 = repo.claimToday(childId, '2026-07-20', '2026-07-19', FAMILY);
		const p2 = repo.claimToday(childId, '2026-07-20', '2026-07-19', FAMILY);
		const [r1, r2] = await Promise.all([p1, p2]);

		const winners = [r1, r2].filter((r) => r !== undefined);
		expect(winners.length).toBe(1);
		expect(winners[0]).toEqual({ currentStreak: 2 }); // +1 が 1 回だけ適用される

		const row = await t.db.execute(sql`
			SELECT current_streak, last_login_date FROM login_streaks
			WHERE family_id = ${FAMILY} AND child_id = ${childId}
		`);
		expect((row.rows[0] as { current_streak: number }).current_streak).toBe(2);
		expect((row.rows[0] as { last_login_date: string }).last_login_date).toBe('2026-07-20');
	});
});
