// tests/unit/db/dsql-stamp-mission-repos.test.ts
// EPIC #3424 / PR-R6 / 設計 SSOT: dsql-data-model.md §3 / §11.2 / §P9 / #3562 ①③
//
// DSQL IStampCardRepo + IDailyMissionRepo 実装のテスト。実 schema (pushSchema 適用、
// dsql-test-db helper):
//
// ── IStampCardRepo ──
//   [SC1] insertCard findOrCreate 冪等 (week UNIQUE、同一 card_id が返る + 行は 1 件)
//   [SC2] findCardByChildAndWeek round-trip + §P9 tenant 分離
//   [SC3] #3562 ①: PK は (family, child, card_id) で week_start を含まない +
//         週一意は droppable UNIQUE (stamp_cards_week_uq) — 「シーズンカード復活時は
//         UNIQUE DROP のみで PK 不変」の可逆性設計を catalog レベルで固定
//   [SM1] findEnabledStampMasters: in-memory SSOT 16 件 (stamp-master-defaults、dynamodb parity)
//   [SE1] insertEntry + findEntriesWithMasterByCardId (master join + 1日1押印 UNIQUE skip)
//   [SE2] #3562 ③: 他 family card / 存在しない card への entry 挿入拒否 (tenant 境界 assertion)
//   [SE3] findCardsByChild (week_start 順) / findEntriesByCardId (earnedAt raw 保全)
//   [SR1] insertCardForRestore / insertEntryForRestore: status・redeemed・日時 verbatim 保全 +
//         restore 経路も #3562 ③ の tenant 境界を通る
//   [SU1] updateCardStatus: (childId, cardId) composite addressing (他 child は no-op)
//   [SU2] updateCardStatusIfCollecting: collecting のみ 1、再実行 / 他 child は 0
//   [SD1] deleteByTenantId: cards+entries を tenant 限定削除、他 tenant 無傷
//   [SX1] UNIQUE / CHECK 実効: 不正 status 拒否 + week UNIQUE 直接 INSERT 拒否
//
// ── IDailyMissionRepo ──
//   [M1] insertDailyMission 冪等 (PK ON CONFLICT) + findTodayMissions (child_activities join)
//   [M2] findMissionByActivity + markMissionCompleted (conditional flip、completed_at 不変) +
//        §P9 / composite key no-op
//   [M3] findAllMissionStatuses (0/1 契約)
//   [M4] findMissionBonusRecord (type='daily_mission' filter、sqlite parity)
//   [M5] findVisibleActivities: is_visible + §P9 filter、ChildActivity shape (0/1)
//   [M6] findPreviousDayMissionIds / findRecentActivityIds (cancelled 除外) /
//        findAllRecordedActivityIds
//   [M7] findChildForMission round-trip + §P9
//   [M8] complete 委譲経路: repo 生成 mission → completeMissionAndMaybeGrantBonus
//        (daily-mission-complete.ts、fitness#10) が exactly-once で bonus 付与
//   [M9] deleteByTenantId tenant 限定削除

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ActivityId, asActivityId, type ChildId } from '../../../src/lib/domain/ids';
import { createDsqlChildRepo } from '../../../src/lib/server/db/dsql/child-repo';
import { completeMissionAndMaybeGrantBonus } from '../../../src/lib/server/db/dsql/daily-mission-complete';
import { createDsqlDailyMissionRepo } from '../../../src/lib/server/db/dsql/daily-mission-repo';
import { createDsqlTransactionRunner } from '../../../src/lib/server/db/dsql/run-in-transaction';
import type { SqlExecutor } from '../../../src/lib/server/db/dsql/sql-executor';
import { createDsqlStampCardRepo } from '../../../src/lib/server/db/dsql/stamp-card-repo';
import type { IChildRepo } from '../../../src/lib/server/db/interfaces/child-repo.interface';
import type { IDailyMissionRepo } from '../../../src/lib/server/db/interfaces/daily-mission-repo.interface';
import type { IStampCardRepo } from '../../../src/lib/server/db/interfaces/stamp-card-repo.interface';
import type { TransactionRunner } from '../../../src/lib/server/db/interfaces/transaction.interface';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

const FAMILY = '00000000-0000-4000-8000-0000000000c1';
const OTHER_FAMILY = '00000000-0000-4000-8000-0000000000c2';
const UUID_RE = /^[0-9a-f-]{36}$/;

describe('DSQL stamp-card-repo / daily-mission-repo (PR-R6、実 schema PGlite)', () => {
	let t: DsqlTestDb;
	let childRepo: IChildRepo;
	let stampRepo: IStampCardRepo;
	let missionRepo: IDailyMissionRepo;
	let runner: TransactionRunner<SqlExecutor>;

	/** 新規 child を作って id を返す (各テストは自分の child で分離)。 */
	const newChild = async (nickname: string, family = FAMILY): Promise<ChildId> => {
		const c = await childRepo.insertChild({ nickname, age: 8, birthDate: '2018-01-15' }, family);
		return c.id;
	};

	/** child_activities を直接 seed して activity_id を返す。 */
	const seedActivity = async (
		childId: ChildId,
		name: string,
		family = FAMILY,
		isVisible = true,
	): Promise<ActivityId> => {
		const r = await t.db.execute(sql`
			INSERT INTO child_activities (family_id, child_id, name, category_id, icon, is_visible)
			VALUES (${family}, ${String(childId)}, ${name}, 'exercise', '🏃', ${isVisible})
			RETURNING activity_id
		`);
		return asActivityId((r.rows[0] as { activity_id: string }).activity_id);
	};

	const countRows = async (query: ReturnType<typeof sql>): Promise<number> => {
		const r = await t.db.execute(query);
		return Number((r.rows[0] as { c: unknown }).c);
	};

	beforeAll(async () => {
		t = await createDsqlTestDb();
		runner = createDsqlTransactionRunner(t.db, { maxAttempts: 3, baseDelayMs: 1 });
		childRepo = createDsqlChildRepo(t.db, runner);
		stampRepo = createDsqlStampCardRepo(t.db, runner);
		missionRepo = createDsqlDailyMissionRepo(t.db);
	}, 60_000);
	afterAll(async () => {
		await t.close();
	});

	// ─────────────────── IStampCardRepo ───────────────────

	it('[SC1] insertCard: findOrCreate 冪等 (week UNIQUE、同一 card + 行 1 件)', async () => {
		const childId = await newChild('シール一郎');
		const first = await stampRepo.insertCard(
			{ childId, weekStart: '2026-06-29', weekEnd: '2026-07-05' },
			FAMILY,
		);
		expect(first.id).toMatch(UUID_RE);
		expect(first.childId).toBe(childId);
		expect(first.status).toBe('collecting'); // 既定 status
		expect(first.redeemedPoints).toBe(null);
		expect(typeof first.createdAt).toBe('string');

		// 同 (child, week) への再 insert は既存 card を返す (ON CONFLICT 冪等、#2565 と同思想)
		const second = await stampRepo.insertCard(
			{ childId, weekStart: '2026-06-29', weekEnd: '2026-07-05' },
			FAMILY,
		);
		expect(second.id).toBe(first.id);
		expect(
			await countRows(sql`
				SELECT count(*) AS c FROM stamp_cards
				WHERE family_id = ${FAMILY} AND child_id = ${String(childId)}
			`),
		).toBe(1);
	});

	it('[SC2] findCardByChildAndWeek: round-trip + §P9 tenant 分離', async () => {
		const childId = await newChild('シール二郎');
		const created = await stampRepo.insertCard(
			{ childId, weekStart: '2026-07-06', weekEnd: '2026-07-12', status: 'redeemable' },
			FAMILY,
		);
		expect(created.status).toBe('redeemable'); // input.status 尊重

		const found = await stampRepo.findCardByChildAndWeek(childId, '2026-07-06', FAMILY);
		expect(found?.id).toBe(created.id);
		expect(found?.weekEnd).toBe('2026-07-12');

		expect(await stampRepo.findCardByChildAndWeek(childId, '2026-07-06', OTHER_FAMILY)).toBe(
			undefined,
		);
		expect(await stampRepo.findCardByChildAndWeek(childId, '2000-01-03', FAMILY)).toBe(undefined);
	});

	it('[SC3] #3562①: week 一意は droppable UNIQUE、PK は week_start を含まない (可逆性設計)', async () => {
		// PK 列 = (family_id, child_id, card_id): シーズン/イベントカード復活時は
		// stamp_cards_week_uq を DROP するだけで PK 不変 (§P1 の PK 後変更不可に抵触しない)。
		const pk = await t.db.execute(sql`
			SELECT a.attname FROM pg_index i
			JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
			WHERE i.indrelid = 'stamp_cards'::regclass AND i.indisprimary
		`);
		const pkCols = (pk.rows as { attname: string }[]).map((r) => r.attname).sort();
		expect(pkCols).toEqual(['card_id', 'child_id', 'family_id']);

		// 週一意は PK と独立した UNIQUE 制約として存在する (= 単独 DROP 可能)
		const uq = await t.db.execute(sql`
			SELECT conname FROM pg_constraint
			WHERE conrelid = 'stamp_cards'::regclass AND contype = 'u'
		`);
		const names = (uq.rows as { conname: string }[]).map((r) => r.conname);
		expect(names).toContain('stamp_cards_week_uq');
	});

	it('[SM1] findEnabledStampMasters: in-memory SSOT 16 件 (dynamodb parity)', async () => {
		const masters = await stampRepo.findEnabledStampMasters(FAMILY);
		expect(masters).toHaveLength(16);
		expect(masters.every((m) => m.isEnabled === 1)).toBe(true);
		expect(masters.find((m) => m.id === '11')?.name).toBe('ドラゴン');
	});

	it('[SE1] insertEntry + findEntriesWithMasterByCardId: master join + 1日1押印 UNIQUE skip', async () => {
		const childId = await newChild('押印三郎');
		const card = await stampRepo.insertCard(
			{ childId, weekStart: '2026-06-01', weekEnd: '2026-06-07' },
			FAMILY,
		);
		await stampRepo.insertEntry(
			{
				cardId: card.id,
				stampMasterId: '11',
				omikujiRank: 'daikichi',
				slot: 1,
				loginDate: '2026-06-01',
			},
			FAMILY,
		);
		// 同 loginDate の重複押印は UNIQUE (family, card, login_date) で silent skip (sqlite parity)
		await stampRepo.insertEntry(
			{ cardId: card.id, stampMasterId: '3', omikujiRank: null, slot: 2, loginDate: '2026-06-01' },
			FAMILY,
		);
		await stampRepo.insertEntry(
			{ cardId: card.id, stampMasterId: '3', omikujiRank: null, slot: 2, loginDate: '2026-06-02' },
			FAMILY,
		);

		const entries = await stampRepo.findEntriesWithMasterByCardId(card.id, FAMILY);
		expect(entries).toHaveLength(2);
		expect(entries[0]).toEqual({
			slot: 1,
			stampMasterId: '11',
			omikujiRank: 'daikichi',
			loginDate: '2026-06-01',
			name: 'ドラゴン',
			emoji: '🐉',
			rarity: 'SR',
		});
		expect(entries[1]?.name).toBe('スター');
		// §P9: 他 tenant からは不可視
		expect(await stampRepo.findEntriesWithMasterByCardId(card.id, OTHER_FAMILY)).toEqual([]);
	});

	it('[SE2] #3562③: 他 family card / 存在しない card への entry 挿入は拒否 (tenant 境界)', async () => {
		const childId = await newChild('越境四郎');
		const card = await stampRepo.insertCard(
			{ childId, weekStart: '2026-06-08', weekEnd: '2026-06-14' },
			FAMILY,
		);
		// 他 family を名乗った insert: card は FAMILY 所有のため挿入されない
		await stampRepo.insertEntry(
			{ cardId: card.id, stampMasterId: '1', omikujiRank: null, slot: 1, loginDate: '2026-06-08' },
			OTHER_FAMILY,
		);
		// 存在しない card への insert: orphan entry を作らない
		await stampRepo.insertEntry(
			{
				cardId: '00000000-0000-4000-8000-00000000dead',
				stampMasterId: '1',
				omikujiRank: null,
				slot: 1,
				loginDate: '2026-06-08',
			},
			FAMILY,
		);
		expect(
			await countRows(sql`SELECT count(*) AS c FROM stamp_entries WHERE card_id = ${card.id}`),
		).toBe(0);
		expect(
			await countRows(
				sql`SELECT count(*) AS c FROM stamp_entries WHERE card_id = '00000000-0000-4000-8000-00000000dead'`,
			),
		).toBe(0);
	});

	it('[SE3] findCardsByChild (week_start 順) / findEntriesByCardId (earnedAt raw 保全)', async () => {
		const childId = await newChild('週次五郎');
		await stampRepo.insertCard({ childId, weekStart: '2026-06-15', weekEnd: '2026-06-21' }, FAMILY);
		const older = await stampRepo.insertCard(
			{ childId, weekStart: '2026-06-01', weekEnd: '2026-06-07' },
			FAMILY,
		);
		const cards = await stampRepo.findCardsByChild(childId, FAMILY);
		expect(cards.map((c) => c.weekStart)).toEqual(['2026-06-01', '2026-06-15']);
		expect(await stampRepo.findCardsByChild(childId, OTHER_FAMILY)).toEqual([]);

		await stampRepo.insertEntry(
			{
				cardId: older.id,
				stampMasterId: '5',
				omikujiRank: 'kichi',
				slot: 3,
				loginDate: '2026-06-03',
			},
			FAMILY,
		);
		const raw = await stampRepo.findEntriesByCardId(older.id, FAMILY);
		expect(raw).toHaveLength(1);
		expect(raw[0]?.stampMasterId).toBe('5');
		expect(raw[0]?.slot).toBe(3);
		expect(typeof raw[0]?.earnedAt).toBe('string');
		expect(await stampRepo.findEntriesByCardId(older.id, OTHER_FAMILY)).toEqual([]);
	});

	it('[SR1] insertCardForRestore / insertEntryForRestore: verbatim 保全 + tenant 境界', async () => {
		const childId = await newChild('復元六郎');
		const restored = await stampRepo.insertCardForRestore(
			{
				childId,
				weekStart: '2025-12-01',
				weekEnd: '2025-12-07',
				status: 'redeemed',
				redeemedPoints: 30,
				redeemedAt: '2025-12-07T09:00:00+00:00',
				createdAt: '2025-12-01T00:00:00+00:00',
				updatedAt: '2025-12-07T09:00:00+00:00',
			},
			FAMILY,
		);
		// #3394 統一冪等契約: fresh 行の restore は必ず non-null (null = 重複 skip)
		if (!restored) throw new Error('insertForRestore returned null for fresh row');
		expect(restored.id).toMatch(UUID_RE);
		expect(restored.status).toBe('redeemed');
		expect(restored.redeemedPoints).toBe(30);
		expect(restored.redeemedAt).toContain('2025-12-07');
		expect(restored.createdAt).toContain('2025-12-01'); // insertCard と違い verbatim 保全

		await stampRepo.insertEntryForRestore(
			{
				cardId: restored.id,
				stampMasterId: null,
				omikujiRank: 'daikichi',
				slot: 1,
				loginDate: '2025-12-01',
				earnedAt: '2025-12-01T08:30:00+00:00',
			},
			FAMILY,
		);
		const raw = await stampRepo.findEntriesByCardId(restored.id, FAMILY);
		// timestamptz の文字列表現は driver 依存 (PGlite はローカル offset 表記) のため、
		// verbatim 保全は瞬間 (epoch) 一致で assert する。
		expect(Date.parse(raw[0]?.earnedAt ?? '')).toBe(Date.parse('2025-12-01T08:30:00+00:00'));
		expect(raw[0]?.stampMasterId).toBe(null); // omikuji のみの押印 (master 無し)

		// restore 経路も #3562③ tenant 境界を通る (他 family card への restore は no-op = false)
		const crossTenant = await stampRepo.insertEntryForRestore(
			{
				cardId: restored.id,
				stampMasterId: null,
				omikujiRank: null,
				slot: 2,
				loginDate: '2025-12-02',
				earnedAt: '2025-12-02T08:30:00+00:00',
			},
			OTHER_FAMILY,
		);
		expect(crossTenant).toBe(false); // #3394: 実 insert なし = false (count 偽装防止)
		expect(await stampRepo.findEntriesByCardId(restored.id, FAMILY)).toHaveLength(1);

		// #3394 統一冪等契約: 同 (child, weekStart) の重複 card restore は null skip
		// (stamp_cards_week_uq、旧 23505 throw から機能等価契約へ)。既存行は上書きされない。
		const dupCard = await stampRepo.insertCardForRestore(
			{
				childId,
				weekStart: '2025-12-01',
				weekEnd: '2025-12-07',
				status: 'collecting',
				redeemedPoints: null,
				redeemedAt: null,
				createdAt: '2025-12-01T00:00:00+00:00',
				updatedAt: '2025-12-01T00:00:00+00:00',
			},
			FAMILY,
		);
		expect(dupCard).toBeNull();
		const cards = await stampRepo.findCardsByChild(childId, FAMILY);
		expect(cards).toHaveLength(1);
		expect(cards[0]?.status).toBe('redeemed'); // silent overwrite されていない

		// 同 (cardId, slot) の重複 entry restore は false skip (imported に加算しない)
		const dupEntry = await stampRepo.insertEntryForRestore(
			{
				cardId: restored.id,
				stampMasterId: null,
				omikujiRank: 'kichi',
				slot: 1,
				loginDate: '2025-12-03',
				earnedAt: '2025-12-03T08:30:00+00:00',
			},
			FAMILY,
		);
		expect(dupEntry).toBe(false);
		expect(await stampRepo.findEntriesByCardId(restored.id, FAMILY)).toHaveLength(1);
	});

	it('[SU1] updateCardStatus: (childId, cardId) composite addressing (#2845 課題①)', async () => {
		const childId = await newChild('更新七郎');
		const stranger = await newChild('他人八郎');
		const card = await stampRepo.insertCard(
			{ childId, weekStart: '2026-06-22', weekEnd: '2026-06-28' },
			FAMILY,
		);
		const input = {
			status: 'redeemable',
			redeemedPoints: null,
			redeemedAt: null,
			updatedAt: '2026-06-28T00:00:00+00:00',
		};
		// 他 child を名乗った update は no-op
		await stampRepo.updateCardStatus(stranger, card.id, input, FAMILY);
		expect((await stampRepo.findCardByChildAndWeek(childId, '2026-06-22', FAMILY))?.status).toBe(
			'collecting',
		);
		// 正しい composite key で更新される
		await stampRepo.updateCardStatus(childId, card.id, input, FAMILY);
		expect((await stampRepo.findCardByChildAndWeek(childId, '2026-06-22', FAMILY))?.status).toBe(
			'redeemable',
		);
	});

	it('[SU2] updateCardStatusIfCollecting: collecting のみ 1、再実行 / 他 child は 0', async () => {
		const childId = await newChild('冪等九郎');
		const stranger = await newChild('他人十郎');
		const card = await stampRepo.insertCard(
			{ childId, weekStart: '2026-07-13', weekEnd: '2026-07-19' },
			FAMILY,
		);
		const redeem = {
			status: 'redeemed',
			redeemedPoints: 25,
			redeemedAt: '2026-07-19T10:00:00+00:00',
			updatedAt: '2026-07-19T10:00:00+00:00',
		};
		expect(await stampRepo.updateCardStatusIfCollecting(stranger, card.id, redeem, FAMILY)).toBe(0);
		expect(
			await stampRepo.updateCardStatusIfCollecting(childId, card.id, redeem, OTHER_FAMILY),
		).toBe(0);
		expect(await stampRepo.updateCardStatusIfCollecting(childId, card.id, redeem, FAMILY)).toBe(1);
		// 二重 redeem は 0 (status ガード)
		expect(await stampRepo.updateCardStatusIfCollecting(childId, card.id, redeem, FAMILY)).toBe(0);
		const after = await stampRepo.findCardByChildAndWeek(childId, '2026-07-13', FAMILY);
		expect(after?.status).toBe('redeemed');
		expect(after?.redeemedPoints).toBe(25);
	});

	it('[SD1] deleteByTenantId: cards+entries を tenant 限定削除、他 tenant 無傷', async () => {
		const mine = await newChild('全削除十一郎', OTHER_FAMILY);
		const keep = await newChild('無傷十二郎');
		const mineCard = await stampRepo.insertCard(
			{ childId: mine, weekStart: '2026-06-29', weekEnd: '2026-07-05' },
			OTHER_FAMILY,
		);
		await stampRepo.insertEntry(
			{
				cardId: mineCard.id,
				stampMasterId: '1',
				omikujiRank: null,
				slot: 1,
				loginDate: '2026-06-29',
			},
			OTHER_FAMILY,
		);
		const keepCard = await stampRepo.insertCard(
			{ childId: keep, weekStart: '2026-06-29', weekEnd: '2026-07-05' },
			FAMILY,
		);
		await stampRepo.insertEntry(
			{
				cardId: keepCard.id,
				stampMasterId: '1',
				omikujiRank: null,
				slot: 1,
				loginDate: '2026-06-29',
			},
			FAMILY,
		);

		await stampRepo.deleteByTenantId(OTHER_FAMILY);

		expect(
			await countRows(sql`SELECT count(*) AS c FROM stamp_cards WHERE family_id = ${OTHER_FAMILY}`),
		).toBe(0);
		expect(
			await countRows(
				sql`SELECT count(*) AS c FROM stamp_entries WHERE family_id = ${OTHER_FAMILY}`,
			),
		).toBe(0);
		expect((await stampRepo.findCardsByChild(keep, FAMILY)).length).toBe(1);
		expect((await stampRepo.findEntriesByCardId(keepCard.id, FAMILY)).length).toBe(1);
	});

	it('[SX1] UNIQUE / CHECK 実効: 不正 status 拒否 + week UNIQUE 直接 INSERT 拒否', async () => {
		const childId = await newChild('制約十三郎');
		await expect(
			t.db.execute(sql`
				INSERT INTO stamp_cards (family_id, child_id, week_start, week_end, status)
				VALUES (${FAMILY}, ${String(childId)}, '2026-08-03', '2026-08-09', 'bogus')
			`),
		).rejects.toThrow(); // stamp_cards_status_ck
		await stampRepo.insertCard({ childId, weekStart: '2026-08-03', weekEnd: '2026-08-09' }, FAMILY);
		await expect(
			t.db.execute(sql`
				INSERT INTO stamp_cards (family_id, child_id, week_start, week_end)
				VALUES (${FAMILY}, ${String(childId)}, '2026-08-03', '2026-08-09')
			`),
		).rejects.toThrow(); // stamp_cards_week_uq
	});

	// ─────────────────── IDailyMissionRepo ───────────────────

	it('[M1] insertDailyMission 冪等 + findTodayMissions (child_activities join)', async () => {
		const childId = await newChild('ミッション一郎');
		const actId = await seedActivity(childId, 'なわとび');
		await missionRepo.insertDailyMission(childId, '2026-07-01', actId, FAMILY);
		// PK ON CONFLICT 冪等 (#2565 parity: 並行 generate でも UNIQUE violation を出さない)
		await missionRepo.insertDailyMission(childId, '2026-07-01', actId, FAMILY);

		const missions = await missionRepo.findTodayMissions(childId, '2026-07-01', FAMILY);
		expect(missions).toHaveLength(1);
		expect(missions[0]?.activityId).toBe(actId);
		expect(missions[0]?.activityName).toBe('なわとび');
		expect(missions[0]?.activityIcon).toBe('🏃');
		expect(missions[0]?.categoryId).toBe('exercise');
		expect(missions[0]?.completed).toBe(0); // 0/1 契約
		expect(typeof missions[0]?.id).toBe('string');
		// §P9 tenant 分離
		expect(await missionRepo.findTodayMissions(childId, '2026-07-01', OTHER_FAMILY)).toEqual([]);
	});

	it('[M2] findMissionByActivity + markMissionCompleted: conditional flip + composite no-op', async () => {
		const childId = await newChild('ミッション二郎');
		const actId = await seedActivity(childId, 'ほんよみ');
		const otherAct = await seedActivity(childId, 'そうじ');
		await missionRepo.insertDailyMission(childId, '2026-07-02', actId, FAMILY);

		const before = await missionRepo.findMissionByActivity(childId, '2026-07-02', actId, FAMILY);
		expect(before?.completed).toBe(0);
		// mission に無い activity は undefined
		expect(await missionRepo.findMissionByActivity(childId, '2026-07-02', otherAct, FAMILY)).toBe(
			undefined,
		);
		// §P9: 他 tenant からの mark は no-op
		await missionRepo.markMissionCompleted(childId, '2026-07-02', actId, OTHER_FAMILY);
		expect(
			(await missionRepo.findMissionByActivity(childId, '2026-07-02', actId, FAMILY))?.completed,
		).toBe(0);

		await missionRepo.markMissionCompleted(childId, '2026-07-02', actId, FAMILY);
		const after = await missionRepo.findMissionByActivity(childId, '2026-07-02', actId, FAMILY);
		expect(after?.completed).toBe(1);

		// 再 mark は conditional (completed=false→true) ガードで completed_at を上書きしない
		const at1 = await t.db.execute(sql`
			SELECT completed_at FROM daily_missions
			WHERE family_id = ${FAMILY} AND child_id = ${String(childId)}
				AND mission_date = '2026-07-02' AND activity_id = ${String(actId)}
		`);
		await missionRepo.markMissionCompleted(childId, '2026-07-02', actId, FAMILY);
		const at2 = await t.db.execute(sql`
			SELECT completed_at FROM daily_missions
			WHERE family_id = ${FAMILY} AND child_id = ${String(childId)}
				AND mission_date = '2026-07-02' AND activity_id = ${String(actId)}
		`);
		expect((at2.rows[0] as { completed_at: string }).completed_at).toBe(
			(at1.rows[0] as { completed_at: string }).completed_at,
		);
	});

	it('[M3] findAllMissionStatuses: 0/1 契約', async () => {
		const childId = await newChild('ミッション三郎');
		const a = await seedActivity(childId, 'たいそう');
		const b = await seedActivity(childId, 'おてつだい');
		await missionRepo.insertDailyMission(childId, '2026-07-03', a, FAMILY);
		await missionRepo.insertDailyMission(childId, '2026-07-03', b, FAMILY);
		await missionRepo.markMissionCompleted(childId, '2026-07-03', a, FAMILY);

		const statuses = await missionRepo.findAllMissionStatuses(childId, '2026-07-03', FAMILY);
		expect(statuses).toHaveLength(2);
		expect(statuses.map((s) => s.completed).sort()).toEqual([0, 1]);
		expect(await missionRepo.findAllMissionStatuses(childId, '2026-07-03', OTHER_FAMILY)).toEqual(
			[],
		);
	});

	it('[M4] findMissionBonusRecord: type=daily_mission filter (sqlite parity)', async () => {
		const childId = await newChild('ボーナス四郎');
		const id = String(childId);
		await t.db.execute(sql`
			INSERT INTO point_ledger (family_id, child_id, amount, type, description, recorded_date)
			VALUES
				(${FAMILY}, ${id}, 10, 'daily_mission', '[2026-07-04] ミッションボーナス', '2026-07-04'),
				(${FAMILY}, ${id}, 99, 'activity', '[2026-07-04] ミッションボーナス', '2026-07-04')
		`);
		const found = await missionRepo.findMissionBonusRecord(
			childId,
			'[2026-07-04] ミッションボーナス',
			FAMILY,
		);
		expect(found?.amount).toBe(10); // type filter で activity 行 (99) は拾わない
		expect(await missionRepo.findMissionBonusRecord(childId, 'ほかの説明', FAMILY)).toBe(undefined);
		expect(
			await missionRepo.findMissionBonusRecord(
				childId,
				'[2026-07-04] ミッションボーナス',
				OTHER_FAMILY,
			),
		).toBe(undefined);
	});

	it('[M5] findVisibleActivities: is_visible + §P9 filter、ChildActivity shape', async () => {
		const childId = await newChild('一覧五郎', OTHER_FAMILY);
		const visible = await seedActivity(childId, 'みえる', OTHER_FAMILY, true);
		await seedActivity(childId, 'みえない', OTHER_FAMILY, false);

		const acts = await missionRepo.findVisibleActivities(OTHER_FAMILY);
		const mine = acts.filter((a) => 'childId' in a && a.childId === childId);
		expect(mine).toHaveLength(1);
		expect(mine[0]?.id).toBe(visible);
		expect(mine[0]?.isVisible).toBe(1); // 0/1 契約
		expect(mine[0]?.basePoints).toBe(5);
		// §P9: 他 tenant の行は返さない
		expect(acts.every((a) => !('childId' in a) || String(a.childId) !== '')).toBe(true);
		const fromMyFamily = await missionRepo.findVisibleActivities(FAMILY);
		expect(fromMyFamily.some((a) => a.id === visible)).toBe(false);
	});

	it('[M6] findPreviousDayMissionIds / findRecentActivityIds (cancelled 除外) / findAllRecordedActivityIds', async () => {
		const childId = await newChild('履歴六郎');
		const a = await seedActivity(childId, 'かたづけ');
		const b = await seedActivity(childId, 'はみがき');
		await missionRepo.insertDailyMission(childId, '2026-07-04', a, FAMILY);

		expect(await missionRepo.findPreviousDayMissionIds(childId, '2026-07-04', FAMILY)).toEqual([a]);
		expect(
			await missionRepo.findPreviousDayMissionIds(childId, '2026-07-04', OTHER_FAMILY),
		).toEqual([]);

		const id = String(childId);
		await t.db.execute(sql`
			INSERT INTO activity_logs (family_id, child_id, activity_id, points, recorded_date, cancelled)
			VALUES
				(${FAMILY}, ${id}, ${String(a)}, 5, '2026-06-01', false),
				(${FAMILY}, ${id}, ${String(b)}, 5, '2026-07-01', false),
				(${FAMILY}, ${id}, ${String(b)}, 5, '2026-07-03', true)
		`);
		// sinceDate 以降 + cancelled 除外
		expect(await missionRepo.findRecentActivityIds(childId, '2026-06-15', FAMILY)).toEqual([b]);
		const all = await missionRepo.findAllRecordedActivityIds(childId, FAMILY);
		expect(all.sort()).toEqual([a, b].sort()); // cancelled 行は除外だが b は 07-01 の有効行で入る
	});

	it('[M7] findChildForMission: round-trip + §P9', async () => {
		const childId = await newChild('本人七郎');
		const child = await missionRepo.findChildForMission(childId, FAMILY);
		expect(child?.nickname).toBe('本人七郎');
		expect(child?.age).toBe(8);
		expect(await missionRepo.findChildForMission(childId, OTHER_FAMILY)).toBe(undefined);
	});

	it('[M8] complete 委譲経路: repo 生成 mission → completeMissionAndMaybeGrantBonus が exactly-once', async () => {
		// fitness#10: 完了 flip + bonus 付与 txn は daily-mission-complete.ts が正 (重複実装しない)。
		// repo の insertDailyMission で作った行がそのまま委譲経路の serialization point になる。
		const childId = await newChild('委譲八郎');
		const a = await seedActivity(childId, 'ランニング');
		const b = await seedActivity(childId, 'にっき');
		await missionRepo.insertDailyMission(childId, '2026-07-05', a, FAMILY);
		await missionRepo.insertDailyMission(childId, '2026-07-05', b, FAMILY);

		const base = {
			familyId: FAMILY,
			childId: String(childId),
			missionDate: '2026-07-05',
			bonusPoints: 10,
			bonusDescription: '[2026-07-05] ミッションボーナス',
			now: '2026-07-05T09:00:00+00:00',
		};
		const first = await completeMissionAndMaybeGrantBonus(runner, {
			...base,
			activityId: String(a),
		});
		expect(first).toEqual({ completedNow: true, allComplete: false, bonusGranted: false });

		const last = await completeMissionAndMaybeGrantBonus(runner, {
			...base,
			activityId: String(b),
		});
		expect(last).toEqual({ completedNow: true, allComplete: true, bonusGranted: true });

		// 二連打の 2 回目は flip も bonus も起きない (exactly-once)
		const dup = await completeMissionAndMaybeGrantBonus(runner, { ...base, activityId: String(b) });
		expect(dup).toEqual({ completedNow: false, allComplete: true, bonusGranted: false });

		expect(
			await countRows(sql`
				SELECT count(*) AS c FROM point_ledger
				WHERE family_id = ${FAMILY} AND child_id = ${String(childId)} AND type = 'mission_bonus'
			`),
		).toBe(1);
		// repo 読み出しにも完了が反映される (委譲経路と repo の整合)
		const statuses = await missionRepo.findAllMissionStatuses(childId, '2026-07-05', FAMILY);
		expect(statuses.map((s) => s.completed)).toEqual([1, 1]);
	});

	it('[M9] deleteByTenantId: tenant 限定削除、他 tenant 無傷', async () => {
		const mine = await newChild('掃除九郎', OTHER_FAMILY);
		const keep = await newChild('無傷十郎');
		const mineAct = await seedActivity(mine, 'すてる', OTHER_FAMILY);
		const keepAct = await seedActivity(keep, 'のこる');
		await missionRepo.insertDailyMission(mine, '2026-07-06', mineAct, OTHER_FAMILY);
		await missionRepo.insertDailyMission(keep, '2026-07-06', keepAct, FAMILY);

		await missionRepo.deleteByTenantId(OTHER_FAMILY);

		expect(
			await countRows(
				sql`SELECT count(*) AS c FROM daily_missions WHERE family_id = ${OTHER_FAMILY}`,
			),
		).toBe(0);
		expect((await missionRepo.findTodayMissions(keep, '2026-07-06', FAMILY)).length).toBe(1);
	});
});
