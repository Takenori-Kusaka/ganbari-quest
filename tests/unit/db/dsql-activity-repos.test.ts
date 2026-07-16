// tests/unit/db/dsql-activity-repos.test.ts
// EPIC #3424 / PR-R3 / 設計 SSOT: dsql-data-model.md §11.2 / §3 / §P9
//
// activity 系 3 repo (IChildActivityRepo / IActivityPrefRepo / IActivityMasteryRepo) の
// DSQL backend テスト。実 schema (pushSchema 適用、dsql-test-db helper) に対して:
//
// child-activity:
//   [A1] insert → findById round-trip (uuid 採番、0/1 数値契約、schema default)
//   [A2] findActivitiesByChild: sort_order 順 + archived 既定除外 + includeArchived/visibleOnly
//   [A3] §P9 tenant 分離: 他 family から不可視・更新/削除不能
//   [A4] countMainQuestActivities = main quest ∧ visible ∧ 非 archived のみ
//   [A5] update 部分更新 / setActivityVisibility / deleteActivity (返り値契約 undefined 含む)
//   [A6] insertActivitiesBulk + copyActivitiesAcrossChildren (archived 除外、sqlite parity の
//        copy 対象 subset、target childId 差替)
//   [A7] archive/restore (reason 束縛) + CHECK 実効 (priority / archived_reason 不正値 reject)
//   [A8] findChildById convenience (child-repo compute-on-read へ委譲)
// activity-pref:
//   [P1] togglePin: pin → MAX+1 採番 / unpin → pinOrder null / 未存在 unpin → isPinned=0 行作成
//   [P2] findPinnedByChild (pin_order 順) / findAllByChild (unpinned 含む、NULLS FIRST parity)
//   [P3] countPinnedInCategory (child_activities JOIN)
//   [P4] getUsageCounts: since 窓 + cancelled 除外 + GROUP BY
//   [P5] insertForRestore: pinOrder/日時 verbatim 保全 + 複合 PK UNIQUE 実効 (重複 throw)
//   [P6] §P9 tenant 分離 + deleteByTenantId が tenant scope
// activity-mastery:
//   [M1] upsert insert → find round-trip / 再 upsert は同一行更新 (複合 PK UNIQUE 実効)
//   [M2] findAllByChild / §P9 tenant 分離 / deleteByTenantId が tenant scope

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	type ActivityId,
	asCategoryId,
	asChildId,
	type ChildId,
} from '../../../src/lib/domain/ids';
import { createDsqlActivityMasteryRepo } from '../../../src/lib/server/db/dsql/activity-mastery-repo';
import { createDsqlActivityPrefRepo } from '../../../src/lib/server/db/dsql/activity-pref-repo';
import { createDsqlChildActivityRepo } from '../../../src/lib/server/db/dsql/child-activity-repo';
import { createDsqlTransactionRunner } from '../../../src/lib/server/db/dsql/run-in-transaction';
import type { IActivityMasteryRepo } from '../../../src/lib/server/db/interfaces/activity-mastery-repo.interface';
import type { IActivityPrefRepo } from '../../../src/lib/server/db/interfaces/activity-pref-repo.interface';
import type { IChildActivityRepo } from '../../../src/lib/server/db/interfaces/child-activity-repo.interface';
import type { InsertChildActivityInput } from '../../../src/lib/server/db/types';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

const FAMILY = '00000000-0000-4000-8000-0000000000b1';
const OTHER_FAMILY = '00000000-0000-4000-8000-0000000000b2';
const CAT_EXERCISE = asCategoryId('1');
const CAT_STUDY = asCategoryId('2');

let t: DsqlTestDb;
let activityRepo: IChildActivityRepo;
let prefRepo: IActivityPrefRepo;
let masteryRepo: IActivityMasteryRepo;

/** 直接 INSERT で child を作る (child-repo は PR-R1 検証済のため seed は raw で十分)。 */
async function seedChild(familyId: string, nickname: string): Promise<ChildId> {
	const res = await t.db.execute(sql`
		INSERT INTO children (family_id, nickname, birth_date, theme, ui_mode)
		VALUES (${familyId}, ${nickname}, '2018-01-15', 'blue', 'preschool')
		RETURNING child_id
	`);
	return asChildId((res.rows[0] as { child_id: string }).child_id);
}

function activityInput(
	childId: ChildId,
	overrides: Partial<InsertChildActivityInput> = {},
): InsertChildActivityInput {
	return {
		childId,
		name: 'はみがき',
		categoryId: CAT_EXERCISE,
		icon: '🦷',
		basePoints: 5,
		...overrides,
	};
}

beforeAll(async () => {
	t = await createDsqlTestDb();
	const runner = createDsqlTransactionRunner(t.db, { maxAttempts: 3, baseDelayMs: 1 });
	activityRepo = createDsqlChildActivityRepo(t.db, runner);
	prefRepo = createDsqlActivityPrefRepo(t.db, runner);
	masteryRepo = createDsqlActivityMasteryRepo(t.db, runner);
}, 60_000);
afterAll(async () => {
	await t.close();
});

describe('DSQL child-activity-repo (PR-R3、実 schema PGlite)', () => {
	it('[A1] insert → findById round-trip (uuid 採番、0/1 数値契約、default 反映)', async () => {
		const child = await seedChild(FAMILY, 'A1');
		const created = await activityRepo.insertActivity(activityInput(child), FAMILY);
		expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(created.childId).toBe(child);
		expect(created.name).toBe('はみがき');
		expect(created.categoryId).toBe(CAT_EXERCISE);
		expect(created.basePoints).toBe(5);
		// 0/1 数値契約 (sqlite 互換 shape) + schema default
		expect(created.isVisible).toBe(1);
		expect(created.isMainQuest).toBe(0);
		expect(created.isArchived).toBe(0);
		expect(created.sortOrder).toBe(0);
		expect(created.priority).toBe('optional');
		expect(created.dailyLimit).toBe(null);
		expect(created.archivedReason).toBe(null);
		expect(typeof created.createdAt).toBe('string');

		const found = await activityRepo.findActivityById(created.id, child, FAMILY);
		expect(found).toEqual(created);
	});

	it('[A1b] insert は #3358/#3422 の保全 field (visible/sort/archived/dailyLimit/kana) を persist する', async () => {
		const child = await seedChild(FAMILY, 'A1b');
		const created = await activityRepo.insertActivity(
			activityInput(child, {
				isVisible: 0,
				sortOrder: 7,
				isArchived: 1,
				archivedReason: 'trial_expired',
				dailyLimit: 3,
				nameKana: 'はみがき',
				nameKanji: '歯磨き',
				triggerHint: '朝ごはんのあと',
				isMainQuest: 1,
				priority: 'must',
				sourcePresetId: 'preset-1',
			}),
			FAMILY,
		);
		expect(created.isVisible).toBe(0);
		expect(created.sortOrder).toBe(7);
		expect(created.isArchived).toBe(1);
		expect(created.archivedReason).toBe('trial_expired');
		expect(created.dailyLimit).toBe(3);
		expect(created.nameKana).toBe('はみがき');
		expect(created.nameKanji).toBe('歯磨き');
		expect(created.triggerHint).toBe('朝ごはんのあと');
		expect(created.isMainQuest).toBe(1);
		expect(created.priority).toBe('must');
		expect(created.sourcePresetId).toBe('preset-1');
	});

	it('[A2] findActivitiesByChild: sort_order 順 + archived 既定除外 + option filter', async () => {
		const child = await seedChild(FAMILY, 'A2');
		const b = await activityRepo.insertActivity(
			activityInput(child, { name: '2番目', sortOrder: 2 }),
			FAMILY,
		);
		const a = await activityRepo.insertActivity(
			activityInput(child, { name: '1番目', sortOrder: 1 }),
			FAMILY,
		);
		const hidden = await activityRepo.insertActivity(
			activityInput(child, { name: '非表示', sortOrder: 3, isVisible: 0 }),
			FAMILY,
		);
		const archived = await activityRepo.insertActivity(
			activityInput(child, {
				name: 'アーカイブ済',
				sortOrder: 0,
				isArchived: 1,
				archivedReason: 'trial_expired',
			}),
			FAMILY,
		);

		const defaults = await activityRepo.findActivitiesByChild(child, FAMILY);
		expect(defaults.map((x) => x.id)).toEqual([a.id, b.id, hidden.id]); // sort_order 順、archived 除外

		const all = await activityRepo.findActivitiesByChild(child, FAMILY, {
			includeArchived: true,
		});
		expect(all.map((x) => x.id)).toEqual([archived.id, a.id, b.id, hidden.id]);

		const visible = await activityRepo.findActivitiesByChild(child, FAMILY, {
			visibleOnly: true,
		});
		expect(visible.map((x) => x.id)).toEqual([a.id, b.id]);
	});

	it('[A3] §P9 tenant 分離: 他 family から不可視・更新/削除不能', async () => {
		const child = await seedChild(FAMILY, 'A3');
		const mine = await activityRepo.insertActivity(activityInput(child), FAMILY);

		expect(await activityRepo.findActivityById(mine.id, child, OTHER_FAMILY)).toBeUndefined();
		expect(await activityRepo.findActivitiesByChild(child, OTHER_FAMILY)).toEqual([]);
		expect(
			await activityRepo.updateActivity(mine.id, child, { name: '乗っ取り' }, OTHER_FAMILY),
		).toBeUndefined();
		expect(await activityRepo.deleteActivity(mine.id, child, OTHER_FAMILY)).toBeUndefined();

		const intact = await activityRepo.findActivityById(mine.id, child, FAMILY);
		expect(intact?.name).toBe('はみがき');
	});

	it('[A3b] cross-child 分離: 別 child の id 指定では取得/更新できない (3 軸契約)', async () => {
		const child1 = await seedChild(FAMILY, 'A3b-1');
		const child2 = await seedChild(FAMILY, 'A3b-2');
		const act = await activityRepo.insertActivity(activityInput(child1), FAMILY);
		expect(await activityRepo.findActivityById(act.id, child2, FAMILY)).toBeUndefined();
		expect(
			await activityRepo.updateActivity(act.id, child2, { name: 'x' }, FAMILY),
		).toBeUndefined();
	});

	it('[A4] countMainQuestActivities: main quest ∧ visible ∧ 非 archived のみ', async () => {
		const child = await seedChild(FAMILY, 'A4');
		await activityRepo.insertActivity(activityInput(child, { isMainQuest: 1 }), FAMILY);
		await activityRepo.insertActivity(activityInput(child, { isMainQuest: 1 }), FAMILY);
		await activityRepo.insertActivity(
			activityInput(child, { isMainQuest: 1, isVisible: 0 }),
			FAMILY,
		);
		await activityRepo.insertActivity(
			activityInput(child, { isMainQuest: 1, isArchived: 1, archivedReason: 'trial_expired' }),
			FAMILY,
		);
		await activityRepo.insertActivity(activityInput(child), FAMILY); // not main quest
		expect(await activityRepo.countMainQuestActivities(child, FAMILY)).toBe(2);
		expect(await activityRepo.countMainQuestActivities(child, OTHER_FAMILY)).toBe(0);
	});

	it('[A5] update 部分更新 / setActivityVisibility / deleteActivity の返り値契約', async () => {
		const child = await seedChild(FAMILY, 'A5');
		const act = await activityRepo.insertActivity(activityInput(child), FAMILY);

		const updated = await activityRepo.updateActivity(
			act.id,
			child,
			{ name: '歯みがき改', categoryId: CAT_STUDY, dailyLimit: 2, nameKana: 'はみがきかい' },
			FAMILY,
		);
		expect(updated?.name).toBe('歯みがき改');
		expect(updated?.categoryId).toBe(CAT_STUDY);
		expect(updated?.dailyLimit).toBe(2);
		expect(updated?.nameKana).toBe('はみがきかい');
		expect(updated?.icon).toBe('🦷'); // 未指定 field 不変
		expect(updated?.basePoints).toBe(5);

		// 空 update は現状値を返す (sqlite parity: SET 句なしでも row を返す)
		const noop = await activityRepo.updateActivity(act.id, child, {}, FAMILY);
		expect(noop?.name).toBe('歯みがき改');

		const hidden = await activityRepo.setActivityVisibility(act.id, child, false, FAMILY);
		expect(hidden?.isVisible).toBe(0);
		const shown = await activityRepo.setActivityVisibility(act.id, child, true, FAMILY);
		expect(shown?.isVisible).toBe(1);

		const deleted = await activityRepo.deleteActivity(act.id, child, FAMILY);
		expect(deleted?.id).toBe(act.id);
		expect(await activityRepo.findActivityById(act.id, child, FAMILY)).toBeUndefined();
		expect(await activityRepo.deleteActivity(act.id, child, FAMILY)).toBeUndefined();
	});

	it('[A6] insertActivitiesBulk: 空 [] / 入力順維持 / 全行 persist', async () => {
		const source = await seedChild(FAMILY, 'A6-src');

		expect(await activityRepo.insertActivitiesBulk([], FAMILY)).toEqual([]);

		const bulk = await activityRepo.insertActivitiesBulk(
			[
				activityInput(source, { name: 'bulk-1', sortOrder: 1 }),
				activityInput(source, { name: 'bulk-2', sortOrder: 2, priority: 'must' }),
			],
			FAMILY,
		);
		expect(bulk).toHaveLength(2);
		expect(bulk.map((x) => x.name)).toEqual(['bulk-1', 'bulk-2']); // 入力順維持
		expect(bulk[1]?.priority).toBe('must');
		expect(await activityRepo.findActivitiesByChild(source, FAMILY)).toHaveLength(2);
	});

	it('[A6b] copyActivitiesAcrossChildren: 空 source は []、copy は sqlite parity subset', async () => {
		const source = await seedChild(FAMILY, 'A6b-src');
		const target = await seedChild(FAMILY, 'A6b-dst');

		expect(await activityRepo.copyActivitiesAcrossChildren(source, target, FAMILY)).toEqual([]);

		await activityRepo.insertActivity(
			activityInput(source, {
				name: 'コピー元',
				sortOrder: 5,
				dailyLimit: 4,
				triggerHint: 'ヒント',
				isMainQuest: 1,
				priority: 'must',
				sourcePresetId: 'p-9',
				isVisible: 0,
			}),
			FAMILY,
		);
		await activityRepo.insertActivity(
			activityInput(source, {
				name: 'アーカイブは対象外',
				isArchived: 1,
				archivedReason: 'trial_expired',
			}),
			FAMILY,
		);

		const copied = await activityRepo.copyActivitiesAcrossChildren(source, target, FAMILY);
		expect(copied).toHaveLength(1);
		const c = copied[0];
		expect(c?.childId).toBe(target);
		expect(c?.name).toBe('コピー元');
		expect(c?.triggerHint).toBe('ヒント');
		expect(c?.isMainQuest).toBe(1);
		expect(c?.priority).toBe('must');
		expect(c?.sourcePresetId).toBe('p-9');
		// sqlite parity: isVisible/sortOrder/dailyLimit は copy 対象外 → schema default
		expect(c?.isVisible).toBe(1);
		expect(c?.sortOrder).toBe(0);
		expect(c?.dailyLimit).toBe(null);
		// source 側は不変
		const srcAfter = await activityRepo.findActivitiesByChild(source, FAMILY);
		expect(srcAfter).toHaveLength(1);
	});

	it('[A7] archive → 既定一覧から消え restore (reason 束縛) で復帰', async () => {
		const child = await seedChild(FAMILY, 'A7');
		const a1 = await activityRepo.insertActivity(activityInput(child, { name: 'a1' }), FAMILY);
		const a2 = await activityRepo.insertActivity(activityInput(child, { name: 'a2' }), FAMILY);
		await activityRepo.archiveActivities([], 'trial_expired', FAMILY); // 空は no-op
		await activityRepo.archiveActivities([a1.id, a2.id], 'trial_expired', FAMILY);

		expect(await activityRepo.findActivitiesByChild(child, FAMILY)).toEqual([]);
		const archived = await activityRepo.findActivitiesByChild(child, FAMILY, {
			includeArchived: true,
		});
		expect(archived.every((x) => x.isArchived === 1 && x.archivedReason === 'trial_expired')).toBe(
			true,
		);

		// 別 reason の restore は効かない (reason 束縛)
		await activityRepo.restoreArchivedActivities('downgrade_user_selected', FAMILY);
		expect(await activityRepo.findActivitiesByChild(child, FAMILY)).toEqual([]);

		await activityRepo.restoreArchivedActivities('trial_expired', FAMILY);
		const restored = await activityRepo.findActivitiesByChild(child, FAMILY);
		expect(restored.map((x) => x.id).sort()).toEqual([a1.id, a2.id].sort());
		expect(restored.every((x) => x.archivedReason === null)).toBe(true);
	});

	it('[A7b] tenant 越境 archive 不能 + CHECK 実効 (priority / archived_reason 不正値)', async () => {
		const child = await seedChild(FAMILY, 'A7b');
		const act = await activityRepo.insertActivity(activityInput(child), FAMILY);
		await activityRepo.archiveActivities([act.id], 'trial_expired', OTHER_FAMILY);
		const intact = await activityRepo.findActivityById(act.id, child, FAMILY);
		expect(intact?.isArchived).toBe(0);

		// CHECK 制約の実効性 (schema SSOT の enumCheck が実 DB に効いている)。
		// drizzle は DB error を「Failed query: …」に wrap するため message でなく
		// 「reject + 行が残らない」で CHECK の実効を assert する。
		await expect(
			t.db.execute(sql`
				INSERT INTO child_activities (family_id, child_id, name, category_id, icon, priority)
				VALUES (${FAMILY}, ${String(child)}, 'bad', '1', 'x', 'urgent')
			`),
		).rejects.toThrow();
		await expect(
			t.db.execute(sql`
				INSERT INTO child_activities (family_id, child_id, name, category_id, icon, archived_reason)
				VALUES (${FAMILY}, ${String(child)}, 'bad', '1', 'x', 'bogus_reason')
			`),
		).rejects.toThrow();
		const bad = await t.db.execute(sql`
			SELECT count(*)::int AS c FROM child_activities WHERE family_id = ${FAMILY} AND name = 'bad'
		`);
		expect((bad.rows[0] as { c: number }).c).toBe(0);
	});

	it('[A8] findChildById convenience: child-repo と同じ compute-on-read 契約', async () => {
		const child = await seedChild(FAMILY, 'A8');
		const found = await activityRepo.findChildById(child, FAMILY);
		expect(found?.nickname).toBe('A8');
		expect(found?.age).toBe(8); // 2018-01-15 生まれ → compute-on-read
		expect(found?.uiMode).toBe('elementary'); // stored 'preschool' でなく年齢再導出 (§11.1)
		expect(await activityRepo.findChildById(child, OTHER_FAMILY)).toBeUndefined();
	});
});

describe('DSQL activity-pref-repo (PR-R3、実 schema PGlite)', () => {
	let child: ChildId;
	let actA: ActivityId;
	let actB: ActivityId;
	let actC: ActivityId;

	beforeAll(async () => {
		child = await seedChild(FAMILY, 'pref');
		actA = (await activityRepo.insertActivity(activityInput(child, { name: 'pA' }), FAMILY)).id;
		actB = (
			await activityRepo.insertActivity(
				activityInput(child, { name: 'pB', categoryId: CAT_STUDY }),
				FAMILY,
			)
		).id;
		actC = (await activityRepo.insertActivity(activityInput(child, { name: 'pC' }), FAMILY)).id;
	});

	// [P1 並行性ガード] togglePin(pin=true) は同一 child の別 activity 並行 pin による pin_order
	// tie (write-skew) を txn 冒頭の children 行 FOR UPDATE で直列化して防ぐ (#3546 と同型)。
	// PGlite は単一接続ゆえ真の並行 txn を再現できず (#3546 [F10-4] と同じ制約)、本 spec は逐次
	// 採番 (MAX+1) の正当性のみを assert する。FOR UPDATE 直列化そのものの回帰は本番 DSQL / OCC
	// runner の統合検証に委ね、ここでは serialization anchor が採番ロジックを壊さないことを保証する。
	it('[P1] togglePin: pin は MAX+1 採番、unpin は pinOrder null、未存在 unpin は isPinned=0 行作成', async () => {
		const p1 = await prefRepo.togglePin(child, actA, true, FAMILY);
		expect(p1.isPinned).toBe(1);
		expect(p1.pinOrder).toBe(1);
		expect(p1.childId).toBe(child);
		expect(p1.activityId).toBe(actA);

		const p2 = await prefRepo.togglePin(child, actB, true, FAMILY);
		expect(p2.pinOrder).toBe(2); // MAX+1

		const un = await prefRepo.togglePin(child, actA, false, FAMILY);
		expect(un.isPinned).toBe(0);
		expect(un.pinOrder).toBe(null);

		// 再 pin で MAX+1 再採番 (既存行の upsert、行は増えない)
		const rePin = await prefRepo.togglePin(child, actA, true, FAMILY);
		expect(rePin.pinOrder).toBe(3);
		const rows = await t.db.execute(sql`
			SELECT count(*)::int AS c FROM child_activity_preferences
			WHERE family_id = ${FAMILY} AND child_id = ${String(child)} AND activity_id = ${String(actA)}
		`);
		expect((rows.rows[0] as { c: number }).c).toBe(1);

		// 未存在 activity の unpin → isPinned=0 で作成 (sqlite parity)
		const created = await prefRepo.togglePin(child, actC, false, FAMILY);
		expect(created.isPinned).toBe(0);
		expect(created.pinOrder).toBe(null);
	});

	it('[P2] findPinnedByChild は pin_order 順 / findAllByChild は unpinned 含む NULLS FIRST', async () => {
		// 現状: actB(order2) / actA(order3) が pinned、actC は unpinned
		const pinned = await prefRepo.findPinnedByChild(child, FAMILY);
		expect(pinned.map((p) => p.activityId)).toEqual([actB, actA]);

		const all = await prefRepo.findAllByChild(child, FAMILY);
		expect(all).toHaveLength(3);
		expect(all[0]?.activityId).toBe(actC); // pinOrder null が先頭 (sqlite NULL 順 parity)
		expect(all.map((p) => p.activityId).slice(1)).toEqual([actB, actA]);
	});

	it('[P3] countPinnedInCategory: child_activities JOIN で category filter', async () => {
		expect(await prefRepo.countPinnedInCategory(child, CAT_EXERCISE, FAMILY)).toBe(1); // actA
		expect(await prefRepo.countPinnedInCategory(child, CAT_STUDY, FAMILY)).toBe(1); // actB
		expect(await prefRepo.countPinnedInCategory(child, asCategoryId('99'), FAMILY)).toBe(0);
	});

	it('[P4] getUsageCounts: since 窓 + cancelled 除外 + GROUP BY 集計', async () => {
		const seedLog = (activityId: ActivityId, date: string, cancelled = false) =>
			t.db.execute(sql`
				INSERT INTO activity_logs (family_id, child_id, activity_id, points, recorded_date, recorded_at, cancelled)
				VALUES (${FAMILY}, ${String(child)}, ${String(activityId)}, 5, ${date}, now(), ${cancelled})
			`);
		await seedLog(actA, '2026-07-01');
		await seedLog(actA, '2026-07-02');
		await seedLog(actA, '2026-06-01'); // since 窓外
		await seedLog(actB, '2026-07-03');
		await seedLog(actB, '2026-07-03', true); // cancelled 除外

		const counts = await prefRepo.getUsageCounts(child, '2026-06-15', FAMILY);
		const byId = new Map(counts.map((c) => [c.activityId, c.usageCount]));
		expect(byId.get(actA)).toBe(2);
		expect(byId.get(actB)).toBe(1);
		expect(counts).toHaveLength(2);
	});

	it('[P5] insertForRestore: pinOrder/日時 verbatim 保全 + 複合 PK UNIQUE 実効', async () => {
		const c2 = await seedChild(FAMILY, 'pref-restore');
		const act = (await activityRepo.insertActivity(activityInput(c2, { name: 'restore' }), FAMILY))
			.id;
		const restored = await prefRepo.insertForRestore(
			{
				childId: c2,
				activityId: act,
				isPinned: 1,
				pinOrder: 42,
				createdAt: '2026-01-02T03:04:05.000Z',
				updatedAt: '2026-01-03T03:04:05.000Z',
			},
			FAMILY,
		);
		// #3394 統一冪等契約: fresh 行の restore は必ず non-null (null = 重複 skip)
		if (!restored) throw new Error('insertForRestore returned null for fresh row');
		expect(restored.isPinned).toBe(1);
		expect(restored.pinOrder).toBe(42);
		expect(Date.parse(restored.createdAt)).toBe(Date.parse('2026-01-02T03:04:05.000Z'));
		expect(Date.parse(restored.updatedAt)).toBe(Date.parse('2026-01-03T03:04:05.000Z'));

		// 複合 PK (family, child, activity) UNIQUE の実効。
		// #3394 統一冪等契約: 重複は 23505 throw ではなく ON CONFLICT DO NOTHING → null skip
		// (sqlite onConflictDoNothing / dynamodb attribute_not_exists と機能等価、count 整合)。
		const duplicate = await prefRepo.insertForRestore(
			{
				childId: c2,
				activityId: act,
				isPinned: 0,
				pinOrder: null,
				createdAt: '2026-01-02T03:04:05.000Z',
				updatedAt: '2026-01-02T03:04:05.000Z',
			},
			FAMILY,
		);
		expect(duplicate).toBeNull();
		// 既存行は上書きされず 1 行のまま (silent overwrite なし)
		const after = await prefRepo.findAllByChild(c2, FAMILY);
		expect(after).toHaveLength(1);
		expect(after[0]?.isPinned).toBe(1);
		expect(after[0]?.pinOrder).toBe(42);
	});

	it('[P6] §P9 tenant 分離 + deleteByTenantId は tenant scope のみ削除', async () => {
		// OTHER_FAMILY 側に 1 行作る
		const otherChild = await seedChild(OTHER_FAMILY, 'other-pref');
		const otherAct = (
			await activityRepo.insertActivity(activityInput(otherChild, { name: 'oA' }), OTHER_FAMILY)
		).id;
		await prefRepo.togglePin(otherChild, otherAct, true, OTHER_FAMILY);

		expect(await prefRepo.findAllByChild(child, OTHER_FAMILY)).toEqual([]);
		expect(await prefRepo.findPinnedByChild(child, OTHER_FAMILY)).toEqual([]);
		expect(await prefRepo.getUsageCounts(child, '2026-06-15', OTHER_FAMILY)).toEqual([]);
		expect(await prefRepo.countPinnedInCategory(child, CAT_EXERCISE, OTHER_FAMILY)).toBe(0);

		await prefRepo.deleteByTenantId(OTHER_FAMILY);
		expect(await prefRepo.findAllByChild(otherChild, OTHER_FAMILY)).toEqual([]);
		// FAMILY 側は残存
		expect((await prefRepo.findAllByChild(child, FAMILY)).length).toBeGreaterThan(0);
	});
});

describe('DSQL activity-mastery-repo (PR-R3、実 schema PGlite)', () => {
	let child: ChildId;
	let actA: ActivityId;
	let actB: ActivityId;

	beforeAll(async () => {
		child = await seedChild(FAMILY, 'mastery');
		actA = (await activityRepo.insertActivity(activityInput(child, { name: 'mA' }), FAMILY)).id;
		actB = (await activityRepo.insertActivity(activityInput(child, { name: 'mB' }), FAMILY)).id;
	});

	it('[M1] upsert insert → find round-trip / 再 upsert は同一行更新', async () => {
		expect(await masteryRepo.findByChildAndActivity(child, actA, FAMILY)).toBeUndefined();

		const created = await masteryRepo.upsert(child, actA, 1, 1, FAMILY);
		expect(created.childId).toBe(child);
		expect(created.activityId).toBe(actA);
		expect(created.totalCount).toBe(1);
		expect(created.level).toBe(1);
		expect(typeof created.updatedAt).toBe('string');

		const updated = await masteryRepo.upsert(child, actA, 10, 2, FAMILY);
		expect(updated.totalCount).toBe(10);
		expect(updated.level).toBe(2);

		const found = await masteryRepo.findByChildAndActivity(child, actA, FAMILY);
		expect(found?.totalCount).toBe(10);
		expect(found?.level).toBe(2);

		const rows = await t.db.execute(sql`
			SELECT count(*)::int AS c FROM activity_mastery
			WHERE family_id = ${FAMILY} AND child_id = ${String(child)} AND activity_id = ${String(actA)}
		`);
		expect((rows.rows[0] as { c: number }).c).toBe(1); // 複合 PK で単一行維持
	});

	it('[M2] findAllByChild / §P9 tenant 分離 / deleteByTenantId は tenant scope', async () => {
		await masteryRepo.upsert(child, actB, 3, 1, FAMILY);
		const all = await masteryRepo.findAllByChild(child, FAMILY);
		expect(all.map((m) => m.activityId).sort()).toEqual([actA, actB].sort());

		expect(await masteryRepo.findByChildAndActivity(child, actA, OTHER_FAMILY)).toBeUndefined();
		expect(await masteryRepo.findAllByChild(child, OTHER_FAMILY)).toEqual([]);

		// OTHER_FAMILY に 1 行作って tenant scope 削除を検証
		const otherChild = await seedChild(OTHER_FAMILY, 'other-mastery');
		const otherAct = (
			await activityRepo.insertActivity(activityInput(otherChild, { name: 'oM' }), OTHER_FAMILY)
		).id;
		await masteryRepo.upsert(otherChild, otherAct, 1, 1, OTHER_FAMILY);

		await masteryRepo.deleteByTenantId(OTHER_FAMILY);
		expect(await masteryRepo.findAllByChild(otherChild, OTHER_FAMILY)).toEqual([]);
		expect((await masteryRepo.findAllByChild(child, FAMILY)).length).toBe(2); // FAMILY 残存
	});

	// [M3 write-value guard] #3592 ①: CRUD 契約の repo 層最終防衛線。不正値は書込前に throw し、
	// 行が作られない (監査証跡欠落を防ぐ) ことを検証する。M1/M2 が触らない専用 activity を使う。
	it('[M3] upsert は totalCount / level の負値・非整数を拒否し行を書かない', async () => {
		const actGuard = (
			await activityRepo.insertActivity(activityInput(child, { name: 'mGuard' }), FAMILY)
		).id;
		await expect(masteryRepo.upsert(child, actGuard, -1, 1, FAMILY)).rejects.toThrow(/totalCount/);
		await expect(masteryRepo.upsert(child, actGuard, 1, -1, FAMILY)).rejects.toThrow(/level/);
		await expect(masteryRepo.upsert(child, actGuard, 1.5, 1, FAMILY)).rejects.toThrow(/totalCount/);
		await expect(masteryRepo.upsert(child, actGuard, 1, 2.5, FAMILY)).rejects.toThrow(/level/);
		// 拒否された upsert は行を作らない。
		expect(await masteryRepo.findByChildAndActivity(child, actGuard, FAMILY)).toBeUndefined();
		// 境界: 0 は許容 (非負整数)。
		const zero = await masteryRepo.upsert(child, actGuard, 0, 0, FAMILY);
		expect(zero.totalCount).toBe(0);
		expect(zero.level).toBe(0);
	});
});
