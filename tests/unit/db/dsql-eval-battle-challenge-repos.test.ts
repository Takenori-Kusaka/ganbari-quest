// tests/unit/db/dsql-eval-battle-challenge-repos.test.ts
// EPIC #3424 / PR-R9 → M4-E PR8b / 設計 SSOT: m2-logical-model.md §1.6 / m3-physical-model.md §4.2 / §P9
//
// DSQL IBattleRepo + IChildChallengeRepo 実装のテスト (実 schema, pushSchema 適用、dsql-test-db helper)。
//
// scope note (R9 時点の保留は M4-C schema 確定で解消済):
//   R9 時点では frozen schema の JSON 解体 (evaluation_scores 子表 / child_challenges 列展開) が
//   対象 JSON の実 shape を表現できず IEvaluationRepo / IChildChallengeRepo を保留していた。
//   M4-C (M3 §10 / §4.2 [must]A) で子表・列展開が撤去され text 据置に確定したため、
//   IEvaluationRepo は M4-D PR6 (dsql-evaluation-repo.test.ts)、IChildChallengeRepo は本 spec の
//   [C*] suite (M4-E PR8b) で実装・検証する。

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BattleStats } from '../../../src/lib/domain/battle-types';
import type { ChildId } from '../../../src/lib/domain/ids';
import { createDsqlBattleRepo } from '../../../src/lib/server/db/dsql/battle-repo';
import { createDsqlChildChallengeRepo } from '../../../src/lib/server/db/dsql/child-challenge-repo';
import { createDsqlChildRepo } from '../../../src/lib/server/db/dsql/child-repo';
import { createDsqlTransactionRunner } from '../../../src/lib/server/db/dsql/run-in-transaction';
import type { IBattleRepo } from '../../../src/lib/server/db/interfaces/battle-repo.interface';
import type { IChildChallengeRepo } from '../../../src/lib/server/db/interfaces/child-challenge-repo.interface';
import type { IChildRepo } from '../../../src/lib/server/db/interfaces/child-repo.interface';
import type { InsertChildChallengeInput } from '../../../src/lib/server/db/types';
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
		battleRepo = createDsqlBattleRepo(t.db, runner);
	}, 60_000);
	afterAll(async () => {
		await t.close();
	});

	// #4681: 完了 flip + 報酬 ledger の原子 primitive (claimRewardAndGrantPoints と同型)。
	it('[B0] completeBattleAndGrantPoints: flip 成立時のみ ledger + total_point を同一 txn で更新', async () => {
		const childId = await newChild('バトル原子');
		const battleId = await battleRepo.insertDailyBattle(childId, 3, '2026-07-09', STATS, FAMILY);

		const flipped = await battleRepo.completeBattleAndGrantPoints(
			battleId,
			'win',
			10,
			4,
			{ childId, amount: 10, description: '[2026-07-09] バトルしょうり キノコおばけ' },
			FAMILY,
		);
		expect(flipped).toBe(1);

		const ledger = await t.db.execute(
			sql`SELECT amount, type, reference_id FROM point_ledger WHERE family_id = ${FAMILY} AND child_id = ${childId}`,
		);
		expect(ledger.rows).toHaveLength(1);
		expect((ledger.rows[0] as { amount: number }).amount).toBe(10);
		expect((ledger.rows[0] as { type: string }).type).toBe('battle');
		expect((ledger.rows[0] as { reference_id: string }).reference_id).toBe(battleId);

		const child = await t.db.execute(
			sql`SELECT total_point FROM children WHERE family_id = ${FAMILY} AND child_id = ${childId}`,
		);
		expect((child.rows[0] as { total_point: number }).total_point).toBe(10);

		// 2 回目 (並行 2 連打) は flip が成立せず、ledger も増えない
		const again = await battleRepo.completeBattleAndGrantPoints(
			battleId,
			'win',
			10,
			4,
			{ childId, amount: 10, description: 'dup' },
			FAMILY,
		);
		expect(again).toBe(0);
		const ledger2 = await t.db.execute(
			sql`SELECT count(*)::int AS c FROM point_ledger WHERE family_id = ${FAMILY} AND child_id = ${childId}`,
		);
		expect((ledger2.rows[0] as { c: number }).c).toBe(1);
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
		// playerStats は player_stats_json text 据置 (M3 §10、battle-service が JSON.parse する契約)
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

// ============================================================
// IChildChallengeRepo (M4-E PR8b) — targetConfig/rewardConfig text 据置 + weekly_auto_guard
// ============================================================

const TARGET_CONFIG = JSON.stringify({
	metric: 'category_activities',
	categoryId: 1,
	baseTarget: 10,
	genMode: 'auto',
	genMissStreak: 2,
	ageAdjustments: { '6': 0.8 },
});
const REWARD_CONFIG = JSON.stringify({ points: 50, message: 'よくがんばりました' });

describe('DSQL child-challenge-repo (M4-E PR8b、実 schema PGlite)', () => {
	let t: DsqlTestDb;
	let childRepo: IChildRepo;
	let repo: IChildChallengeRepo;

	const newChild = async (nickname: string, family = FAMILY): Promise<ChildId> => {
		const c = await childRepo.insertChild({ nickname, age: 8, birthDate: '2018-01-15' }, family);
		return c.id;
	};

	const baseInput = (childId: ChildId, overrides?: Partial<InsertChildChallengeInput>) =>
		({
			childId,
			title: '週間チャレンジ',
			description: 'テスト用',
			startDate: '2026-07-06',
			endDate: '2026-07-12',
			targetConfig: TARGET_CONFIG,
			rewardConfig: REWARD_CONFIG,
			targetValue: 10,
			...overrides,
		}) satisfies InsertChildChallengeInput;

	beforeAll(async () => {
		t = await createDsqlTestDb();
		const runner = createDsqlTransactionRunner(t.db, { maxAttempts: 3, baseDelayMs: 1 });
		childRepo = createDsqlChildRepo(t.db, runner);
		repo = createDsqlChildChallengeRepo(t.db, runner);
	}, 60_000);
	afterAll(async () => {
		await t.close();
	});

	it('[C1] insert → findByChildId: shape + defaults + config JSON verbatim round-trip', async () => {
		const childId = await newChild('挑戦一郎');
		const created = await repo.insert(baseInput(childId), FAMILY);
		expect(created.id).toMatch(/^[0-9a-f-]{36}$/); // uuid 採番
		expect(created.childId).toBe(childId);
		expect(created.status).toBe('active');
		expect(created.isActive).toBe(1);
		expect(created.challengeType).toBe('cooperative');
		expect(created.periodType).toBe('weekly');
		expect(created.currentValue).toBe(0);
		expect(created.completed).toBe(0);
		expect(created.rewardClaimed).toBe(0);
		expect(created.completedAt).toBeNull();

		const rows = await repo.findByChildId(childId, FAMILY);
		expect(rows).toHaveLength(1);
		// M3 §4.2 [must]A: genMode/genMissStreak/ageAdjustments を含む実 shape が silent drop されない
		expect(JSON.parse(rows[0]?.targetConfig ?? '{}')).toEqual(JSON.parse(TARGET_CONFIG));
		expect(JSON.parse(rows[0]?.rewardConfig ?? '{}')).toEqual(JSON.parse(REWARD_CONFIG));
	});

	it('[C2] §P9 tenant 分離: 他 family からは find/findById とも不可視', async () => {
		const childId = await newChild('分離次郎');
		const created = await repo.insert(baseInput(childId), FAMILY);
		expect(await repo.findByChildId(childId, OTHER_FAMILY)).toHaveLength(0);
		expect(await repo.findById(created.id, OTHER_FAMILY)).toBeUndefined();
		expect(await repo.findById(created.id, FAMILY)).toBeDefined();
	});

	it('[C3] findActiveByChildId: 期間内 active のみ (期間外・inactive を除外)', async () => {
		const childId = await newChild('期間三郎');
		await repo.insert(baseInput(childId, { title: '期間内' }), FAMILY);
		await repo.insert(
			baseInput(childId, { title: '期間外', startDate: '2026-06-01', endDate: '2026-06-07' }),
			FAMILY,
		);
		const inactive = await repo.insert(baseInput(childId, { title: '停止中' }), FAMILY);
		await repo.update(inactive.id, { isActive: 0 }, FAMILY);

		const active = await repo.findActiveByChildId(childId, '2026-07-08', FAMILY);
		expect(active.map((c) => c.title)).toEqual(['期間内']);
	});

	it('[C4] findActiveOrUnclaimedByChildId (#2488): completed+未請求を含み、claim 後は消える', async () => {
		const childId = await newChild('請求四郎');
		const c = await repo.insert(baseInput(childId), FAMILY);
		await repo.markCompleted(c.id, FAMILY);

		// completed だが未請求 → 含まれる (claim ボタン render 契約)
		const before = await repo.findActiveOrUnclaimedByChildId(childId, '2026-07-08', FAMILY);
		expect(before.map((r) => r.id)).toContain(c.id);
		expect(before[0]?.status).toBe('completed');
		expect(before[0]?.completed).toBe(1);
		expect(before[0]?.completedAt).not.toBeNull();

		// claim 後 → 消える
		expect(
			await repo.claimRewardAndGrantPoints(
				c.id,
				{ childId, amount: 30, description: 'チャレンジ達成' },
				FAMILY,
			),
		).toBe(1);
		const after = await repo.findActiveOrUnclaimedByChildId(childId, '2026-07-08', FAMILY);
		expect(after.map((r) => r.id)).not.toContain(c.id);
	});

	it('[C5] getOrCreateWeeklyAuto (#3245): 同一 (child, week) は 1 行に収束 (weekly_auto_guard)', async () => {
		const childId = await newChild('自動五郎');
		const input = baseInput(childId, { sourceTemplateId: 'auto:weekly' });
		const first = await repo.getOrCreateWeeklyAuto(input, FAMILY);
		const second = await repo.getOrCreateWeeklyAuto(input, FAMILY);
		expect(second.id).toBe(first.id); // 勝者 1 行に収束
		expect(await repo.findByChildId(childId, FAMILY)).toHaveLength(1);

		// 別週は別行 (guard キーが異なる)
		const nextWeek = await repo.getOrCreateWeeklyAuto(
			baseInput(childId, {
				sourceTemplateId: 'auto:weekly',
				startDate: '2026-07-13',
				endDate: '2026-07-19',
			}),
			FAMILY,
		);
		expect(nextWeek.id).not.toBe(first.id);

		// 非 auto 行 (guard NULL) は同 week に複数共存できる (UNIQUE は NULL 複数許容)
		await repo.insert(baseInput(childId, { title: '手動1' }), FAMILY);
		await repo.insert(baseInput(childId, { title: '手動2' }), FAMILY);
		expect(await repo.findByChildId(childId, FAMILY)).toHaveLength(4);
	});

	it('[C6] claimRewardAndGrantPoints (#3284/#3342、#3333 後継): 未 completed 0 / completed 後 1 (ledger+total_point 同時) / 二重 claim 0 (無付与)', async () => {
		const childId = await newChild('原子六郎');
		const c = await repo.insert(baseInput(childId), FAMILY);
		const claim = () =>
			repo.claimRewardAndGrantPoints(
				c.id,
				{ childId, amount: 30, description: 'チャレンジ達成: テスト' },
				FAMILY,
			);
		const ledgerCount = async () => {
			const r = await t.db.execute(sql`
				SELECT count(*)::int AS c FROM point_ledger
				WHERE family_id = ${FAMILY} AND child_id = ${childId}
					AND type = 'child_challenge' AND reference_id = ${c.id}
			`);
			return Number((r.rows[0] as { c: number }).c);
		};
		const totalPoint = async () => {
			const r = await t.db.execute(sql`
				SELECT total_point FROM children WHERE family_id = ${FAMILY} AND child_id = ${childId}
			`);
			return Number((r.rows[0] as { total_point: number }).total_point);
		};

		expect(await claim()).toBe(0); // 未完了は flip しない (ledger も書かない)
		expect(await ledgerCount()).toBe(0);

		await repo.markCompleted(c.id, FAMILY);
		expect(await claim()).toBe(1); // 1 回目のみ成功 = flip + ledger + total_point が同一 txn
		expect(await ledgerCount()).toBe(1);
		expect(await totalPoint()).toBe(30);

		expect(await claim()).toBe(0); // 二重 claim は 0 行 → ledger / total_point とも増えない
		expect(await ledgerCount()).toBe(1);
		expect(await totalPoint()).toBe(30);

		const row = await repo.findById(c.id, FAMILY);
		expect(row?.rewardClaimed).toBe(1);
		expect(row?.rewardClaimedAt).not.toBeNull();
	});

	it('[C6b] fire→settle 並行 claim (#3284 AC): 同時 2 発でも ledger 1 行 / total_point 1 回分のみ', async () => {
		const childId = await newChild('並行六郎');
		const c = await repo.insert(baseInput(childId), FAMILY);
		await repo.markCompleted(c.id, FAMILY);

		// PGlite は単一接続のため fire→settle パターン (#3531): 2 claim を await せず発火し、
		// 後で settle して flip 勝者がちょうど 1 であることを確認する。
		const fire1 = repo.claimRewardAndGrantPoints(
			c.id,
			{ childId, amount: 30, description: '並行1' },
			FAMILY,
		);
		const fire2 = repo.claimRewardAndGrantPoints(
			c.id,
			{ childId, amount: 30, description: '並行2' },
			FAMILY,
		);
		const results = await Promise.all([fire1, fire2]);
		expect(results.filter((r) => r === 1)).toHaveLength(1);
		expect(results.filter((r) => r === 0)).toHaveLength(1);

		const ledger = await t.db.execute(sql`
			SELECT count(*)::int AS c FROM point_ledger
			WHERE family_id = ${FAMILY} AND child_id = ${childId}
				AND type = 'child_challenge' AND reference_id = ${c.id}
		`);
		expect(Number((ledger.rows[0] as { c: number }).c)).toBe(1);
		const tp = await t.db.execute(sql`
			SELECT total_point FROM children WHERE family_id = ${FAMILY} AND child_id = ${childId}
		`);
		expect(Number((tp.rows[0] as { total_point: number }).total_point)).toBe(30);
	});

	it('[C6c] point_ledger 冪等 UNIQUE (#3284): 事前に同一冪等キーの ledger があれば claim は throw し flip ごと rollback (lost-award 根治)', async () => {
		const childId = await newChild('冪等六郎');
		const c = await repo.insert(baseInput(childId), FAMILY);
		await repo.markCompleted(c.id, FAMILY);
		// 同一 (family, child, type, reference) の ledger 行を事前に仕込む
		await t.db.execute(sql`
			INSERT INTO point_ledger (family_id, child_id, amount, type, description, reference_id, recorded_date)
			VALUES (${FAMILY}, ${childId}, 30, 'child_challenge', 'pre-existing', ${c.id}, '2026-07-08')
		`);

		await expect(
			repo.claimRewardAndGrantPoints(c.id, { childId, amount: 30, description: 'dup' }, FAMILY),
		).rejects.toThrow();

		// flip は rollback され未請求のまま (恒久受取不能 = lost-award にならない)
		const row = await repo.findById(c.id, FAMILY);
		expect(row?.rewardClaimed).toBe(0);
	});

	it('[C7] updateProgress / update (partial) / deleteChallenge', async () => {
		const childId = await newChild('更新七郎');
		const c = await repo.insert(baseInput(childId), FAMILY);

		await repo.updateProgress(c.id, 7, FAMILY);
		expect((await repo.findById(c.id, FAMILY))?.currentValue).toBe(7);

		// status は CHILD_CHALLENGE_STATUSES (active/completed/expired) の CHECK 制約下
		await repo.update(c.id, { title: '改題', status: 'expired' }, FAMILY);
		const updated = await repo.findById(c.id, FAMILY);
		expect(updated?.title).toBe('改題');
		expect(updated?.status).toBe('expired');
		expect(updated?.endDate).toBe('2026-07-12'); // 未指定フィールドは不変

		await repo.deleteChallenge(c.id, FAMILY);
		expect(await repo.findById(c.id, FAMILY)).toBeUndefined();
	});

	it('[C8] copyAcrossChildren: メタ複製 + 進捗リセット (INSERT...SELECT 単文)', async () => {
		const source = await newChild('複製元八郎');
		const target = await newChild('複製先九郎');
		const c = await repo.insert(baseInput(source, { sourceTemplateId: 'preset:summer' }), FAMILY);
		await repo.updateProgress(c.id, 9, FAMILY);
		await repo.markCompleted(c.id, FAMILY);

		const copied = await repo.copyAcrossChildren(source, target, FAMILY);
		expect(copied).toHaveLength(1);
		expect(copied[0]?.childId).toBe(target);
		expect(copied[0]?.title).toBe('週間チャレンジ');
		expect(copied[0]?.sourceTemplateId).toBe('preset:summer');
		expect(JSON.parse(copied[0]?.targetConfig ?? '{}')).toEqual(JSON.parse(TARGET_CONFIG));
		// 進捗はリセット (source の 9/completed を引き継がない)
		expect(copied[0]?.currentValue).toBe(0);
		expect(copied[0]?.completed).toBe(0);
		expect(copied[0]?.status).toBe('active');
	});

	it('[C9] insertForRestore (#3329): 進捗・完了・請求・日時を保全して round-trip', async () => {
		const childId = await newChild('復元十郎');
		const restored = await repo.insertForRestore(
			{
				childId,
				title: '復元チャレンジ',
				description: null,
				challengeType: 'cooperative',
				periodType: 'weekly',
				startDate: '2026-06-01',
				endDate: '2026-06-07',
				targetConfig: TARGET_CONFIG,
				rewardConfig: REWARD_CONFIG,
				status: 'completed',
				isActive: 0,
				sourceTemplateId: 'preset:spring',
				currentValue: 10,
				targetValue: 10,
				completed: 1,
				completedAt: '2026-06-07T10:00:00.000Z',
				rewardClaimed: 1,
				rewardClaimedAt: '2026-06-07T11:00:00.000Z',
				// #4410: 祝福「見せた」記録は backup wire に載せないため復元時は常に未表示
				celebrationShownAt: null,
				createdAt: '2026-06-01T00:00:00.000Z',
				updatedAt: '2026-06-07T11:00:00.000Z',
			},
			FAMILY,
		);
		// #3394 統一冪等契約: fresh 行の restore は必ず non-null (null = 重複 skip)
		if (!restored) throw new Error('insertForRestore returned null for fresh row');
		expect(restored.status).toBe('completed');
		expect(restored.isActive).toBe(0);
		expect(restored.currentValue).toBe(10);
		expect(restored.completed).toBe(1);
		expect(restored.rewardClaimed).toBe(1);
		expect(restored.completedAt).not.toBeNull();
		expect(restored.rewardClaimedAt).not.toBeNull();
		// #4410: 復元直後は未表示 = 達成済で未受取なら祝福が 1 回だけ出る
		expect(restored.celebrationShownAt).toBeNull();
	});

	it('[C9b] insertForRestore (#3387/#3394): auto:weekly の (child, startDate) 重複は null skip (weekly_auto_guard)', async () => {
		const childId = await newChild('復元週次');
		const autoInput = (over: Record<string, unknown> = {}) =>
			({
				childId,
				title: '週次チャレンジ',
				description: null,
				challengeType: 'cooperative',
				periodType: 'weekly',
				startDate: '2026-06-08',
				endDate: '2026-06-14',
				targetConfig: TARGET_CONFIG,
				rewardConfig: REWARD_CONFIG,
				status: 'active',
				isActive: 1,
				sourceTemplateId: 'auto:weekly',
				currentValue: 3,
				targetValue: 5,
				completed: 0,
				completedAt: null,
				rewardClaimed: 0,
				rewardClaimedAt: null,
				createdAt: '2026-06-08T00:00:00.000Z',
				updatedAt: '2026-06-08T00:00:00.000Z',
				...over,
			}) as Parameters<typeof repo.insertForRestore>[0];

		const first = await repo.insertForRestore(autoInput(), FAMILY);
		expect(first).not.toBeNull();
		// 同 (child, startDate) の auto:weekly 重複 backup → ON CONFLICT DO NOTHING で null skip
		// (sqlite 部分 unique index / dynamodb AUTO# SK + attribute_not_exists と機能等価)。
		const dup = await repo.insertForRestore(autoInput({ currentValue: 0 }), FAMILY);
		expect(dup).toBeNull();
		// 既存行 (進捗 3) は上書きされない (silent last-writer-wins なし)
		const rows = await repo.findByChildId(childId, FAMILY);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.currentValue).toBe(3);
	});

	it('[C10] insertBulk + findAllByTenant + deleteByTenantId', async () => {
		const a = await newChild('一括 A');
		const b = await newChild('一括 B');
		const rows = await repo.insertBulk([baseInput(a), baseInput(b)], FAMILY);
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.childId).sort()).toEqual([a, b].sort());

		const all = await repo.findAllByTenant(FAMILY);
		expect(all.length).toBeGreaterThanOrEqual(2);

		await repo.deleteByTenantId(FAMILY);
		expect(await repo.findAllByTenant(FAMILY)).toHaveLength(0);
	});
});
