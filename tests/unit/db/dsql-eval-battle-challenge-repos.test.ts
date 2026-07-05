// tests/unit/db/dsql-eval-battle-challenge-repos.test.ts
// EPIC #3424 / PR-R9 / 設計 SSOT: dsql-data-model.md §5 / §11.2 / §11.3 / §P9
//
// DSQL IBattleRepo 実装のテスト (実 schema, pushSchema 適用、dsql-test-db helper)。
//
// ⚠️ PR-R9 scope note (設計懸念により 保留):
//   本 spec は **IBattleRepo のみ green** を担保する。IEvaluationRepo / IChildChallengeRepo は
//   frozen schema の JSON 解体 (evaluation_scores 子表 / child_challenges 列展開) が対象 JSON の
//   実 shape を表現できず **可逆でない** ことが実装調査で判明したため保留 (最終報告 §設計懸念)。
//   - evaluations.scoresJson = Record<cat, {count,points,statusIncrease}> (入れ子) だが
//     evaluation_scores は score real 単値のみ → 3 値 → 1 値の不可逆。
//   - child_challenges.targetConfig = {metric,categoryId,activityId?,baseTarget,ageAdjustments?,
//     genMode?,genMissStreak?} だが列は 5 つ (target_metric/target_category_id/base_target/
//     reward_points/reward_message) のみ → activityId/ageAdjustments/genMode/genMissStreak 消失。
//     genMissStreak は auto:weekly の連続未達継続に必須 (child-challenge-service:507 が read)。
//   design doc §9.2.1 (line 272) 自身が「opaque blob(scoresJson/targetConfig...)は pg でも
//   text 据置」と規定しており §5/§11.3 の解体と矛盾する。schema 決着後に両 repo を実装する。

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BattleStats } from '../../../src/lib/domain/battle-types';
import type { ChildId } from '../../../src/lib/domain/ids';
import { createDsqlBattleRepo } from '../../../src/lib/server/db/dsql/battle-repo';
import { createDsqlChildRepo } from '../../../src/lib/server/db/dsql/child-repo';
import { createDsqlTransactionRunner } from '../../../src/lib/server/db/dsql/run-in-transaction';
import type { IBattleRepo } from '../../../src/lib/server/db/interfaces/battle-repo.interface';
import type { IChildRepo } from '../../../src/lib/server/db/interfaces/child-repo.interface';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

const FAMILY = '00000000-0000-4000-8000-0000000000c1';
const OTHER_FAMILY = '00000000-0000-4000-8000-0000000000c2';

const STATS: BattleStats = { hp: 100, atk: 20, def: 15, spd: 12, rec: 8 };

describe('DSQL battle-repo (PR-R9、実 schema PGlite)', () => {
	let t: DsqlTestDb;
	let childRepo: IChildRepo;
	let battleRepo: IBattleRepo;

	const newChild = async (nickname: string, family = FAMILY): Promise<ChildId> => {
		const c = await childRepo.insertChild({ nickname, age: 8, birthDate: '2018-01-15' }, family);
		return c.id;
	};

	beforeAll(async () => {
		t = await createDsqlTestDb();
		const runner = createDsqlTransactionRunner(t.db, { maxAttempts: 3, baseDelayMs: 1 });
		childRepo = createDsqlChildRepo(t.db, runner);
		battleRepo = createDsqlBattleRepo(t.db);
	}, 60_000);
	afterAll(async () => {
		await t.close();
	});

	it('[B1] insertDailyBattle → findTodayBattle: playerStats 5 列 round-trip + shape', async () => {
		const childId = await newChild('バトル太郎');
		const battleId = await battleRepo.insertDailyBattle(childId, 3, '2026-07-05', STATS, FAMILY);
		// 合成 id = `${childId}:${date}` (surrogate id 列が無いため自然キー埋め込み)
		expect(battleId).toBe(`${childId}:2026-07-05`);

		const battle = await battleRepo.findTodayBattle(childId, '2026-07-05', FAMILY);
		expect(battle).toBeDefined();
		expect(battle?.id).toBe(battleId);
		expect(battle?.childId).toBe(childId);
		expect(battle?.enemyId).toBe(3);
		expect(battle?.date).toBe('2026-07-05');
		expect(battle?.status).toBe('pending');
		expect(battle?.outcome).toBe(null);
		expect(battle?.rewardPoints).toBe(0);
		expect(battle?.turnsUsed).toBe(0);
		// playerStats は 5 列展開 → JSON 再構成 (battle-service が JSON.parse する契約)
		expect(JSON.parse(battle?.playerStatsJson ?? '{}')).toEqual(STATS);
		expect(typeof battle?.createdAt).toBe('string');
		expect(typeof battle?.updatedAt).toBe('string');
	});

	it('[B2] findTodayBattle: 該当なしは undefined', async () => {
		const childId = await newChild('未戦次郎');
		expect(await battleRepo.findTodayBattle(childId, '2026-07-05', FAMILY)).toBeUndefined();
	});

	it('[B3] completeBattle: token 復号 → status/outcome/reward/turns 更新', async () => {
		const childId = await newChild('決着三郎');
		const battleId = await battleRepo.insertDailyBattle(childId, 1, '2026-07-05', STATS, FAMILY);
		await battleRepo.completeBattle(battleId, 'win', 50, 4, FAMILY);

		const battle = await battleRepo.findTodayBattle(childId, '2026-07-05', FAMILY);
		expect(battle?.status).toBe('completed');
		expect(battle?.outcome).toBe('win');
		expect(battle?.rewardPoints).toBe(50);
		expect(battle?.turnsUsed).toBe(4);
	});

	it('[B4] findRecentBattles: date 降順 + limit', async () => {
		const childId = await newChild('履歴四郎');
		for (const date of ['2026-07-01', '2026-07-02', '2026-07-03']) {
			await battleRepo.insertDailyBattle(childId, 2, date, STATS, FAMILY);
		}
		const recent = await battleRepo.findRecentBattles(childId, 2, FAMILY);
		expect(recent.map((b) => b.date)).toEqual(['2026-07-03', '2026-07-02']);
	});

	it('[B5] countConsecutiveLosses: 先頭 lose 連鎖のみ数える (win で打切り)', async () => {
		const childId = await newChild('連敗五郎');
		// 古い→新しい: win, lose, lose (直近が lose 2 連)
		const setup: [string, 'win' | 'lose'][] = [
			['2026-07-01', 'win'],
			['2026-07-02', 'lose'],
			['2026-07-03', 'lose'],
		];
		for (const [date, outcome] of setup) {
			const id = await battleRepo.insertDailyBattle(childId, 2, date, STATS, FAMILY);
			await battleRepo.completeBattle(id, outcome, 0, 1, FAMILY);
		}
		expect(await battleRepo.countConsecutiveLosses(childId, FAMILY)).toBe(2);

		// pending (未完了) は集計対象外
		await battleRepo.insertDailyBattle(childId, 2, '2026-07-04', STATS, FAMILY);
		expect(await battleRepo.countConsecutiveLosses(childId, FAMILY)).toBe(2);
	});

	it('[B6] upsertCollectionEntry: 初回 defeatCount=1 → 再撃破で +1 (単文 upsert)', async () => {
		const childId = await newChild('図鑑六郎');
		await battleRepo.upsertCollectionEntry(childId, 7, FAMILY);
		let col = await battleRepo.findCollection(childId, FAMILY);
		expect(col).toHaveLength(1);
		expect(col[0]?.id).toBe(`${childId}:7`);
		expect(col[0]?.enemyId).toBe(7);
		expect(col[0]?.defeatCount).toBe(1);
		expect(typeof col[0]?.firstDefeatedAt).toBe('string');

		await battleRepo.upsertCollectionEntry(childId, 7, FAMILY);
		await battleRepo.upsertCollectionEntry(childId, 9, FAMILY);
		col = await battleRepo.findCollection(childId, FAMILY);
		expect(col).toHaveLength(2); // enemy 7 は重複行を作らない
		const e7 = col.find((c) => c.enemyId === 7);
		expect(e7?.defeatCount).toBe(2);
		expect(col.map((c) => c.enemyId)).toEqual([7, 9]); // enemy_id 昇順
	});

	it('[B7] §P9 tenant 分離: 他 family から battle / collection 不可視', async () => {
		const childId = await newChild('分離七郎');
		await battleRepo.insertDailyBattle(childId, 5, '2026-07-05', STATS, FAMILY);
		await battleRepo.upsertCollectionEntry(childId, 5, FAMILY);

		expect(await battleRepo.findTodayBattle(childId, '2026-07-05', OTHER_FAMILY)).toBeUndefined();
		expect(await battleRepo.findRecentBattles(childId, 10, OTHER_FAMILY)).toEqual([]);
		expect(await battleRepo.countConsecutiveLosses(childId, OTHER_FAMILY)).toBe(0);
		expect(await battleRepo.findCollection(childId, OTHER_FAMILY)).toEqual([]);

		// completeBattle も tenant 述語で他 family の行を touch しない
		const battleId = `${childId}:2026-07-05`;
		await battleRepo.completeBattle(battleId, 'win', 99, 1, OTHER_FAMILY);
		const untouched = await battleRepo.findTodayBattle(childId, '2026-07-05', FAMILY);
		expect(untouched?.status).toBe('pending'); // 無傷
		expect(untouched?.rewardPoints).toBe(0);
	});

	it('[B8] §P9: upsertCollectionEntry は tenant 毎に独立 (同 child/enemy でも family で分離)', async () => {
		const childId = await newChild('分離八郎', OTHER_FAMILY);
		await battleRepo.upsertCollectionEntry(childId, 2, OTHER_FAMILY);
		expect(await battleRepo.findCollection(childId, OTHER_FAMILY)).toHaveLength(1);
		// verify 直接 SQL: FAMILY 側には無い
		const cross = await t.db.execute(
			sql`SELECT count(*) AS c FROM enemy_collection WHERE family_id = ${FAMILY} AND child_id = ${String(childId)}`,
		);
		expect(Number((cross.rows[0] as { c: unknown }).c)).toBe(0);
	});
});
