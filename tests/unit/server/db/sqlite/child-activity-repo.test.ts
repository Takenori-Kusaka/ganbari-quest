import { asCategoryId, asChildId } from '$lib/domain/ids';
// tests/unit/server/db/sqlite/child-activity-repo.test.ts
// per-child activity instance repository (sqlite 実装) のユニットテスト (#2362 PR-3, ADR-0055)

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../../../src/lib/server/db/schema';
import {
	closeDb,
	createTestDb,
	resetDb as resetAllTables,
	type TestDb,
	type TestSqlite,
} from '../../../helpers/test-db';

// ---- テスト用インメモリDB ----
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

import {
	archiveActivities,
	countMainQuestActivities,
	deleteActivity,
	findActivitiesByChild,
	findActivityById,
	findChildById,
	insertActivitiesBulk,
	insertActivity,
	restoreArchivedActivities,
	setActivityVisibility,
	updateActivity,
} from '../../../../../src/lib/server/db/sqlite/child-activity-repo';

const TENANT = 'test-tenant';

beforeAll(() => {
	const t = createTestDb();
	sqlite = t.sqlite;
	testDb = t.db;
});

afterAll(() => {
	closeDb(sqlite);
});

function resetDb() {
	resetAllTables(sqlite);
}

/**
 * Seed: 2 children (901 / 902), category 1 / 2, 旧 activities なし。
 */
function seedBase() {
	resetDb();
	testDb.insert(schema.children).values({ nickname: 'たろう', age: 7, theme: 'sky' }).run();
	testDb.insert(schema.children).values({ nickname: 'はなこ', age: 5, theme: 'pink' }).run();
}

describe('sqlite/child-activity-repo', () => {
	beforeEach(() => {
		seedBase();
	});

	// ---------------------------------------------------------------
	// insertActivity / findActivitiesByChild / findActivityById
	// ---------------------------------------------------------------

	describe('insertActivity + findActivitiesByChild', () => {
		it('childId 必須で per-child instance を作成し、その child の一覧で取得できる', async () => {
			const a1 = await insertActivity(
				{
					childId: asChildId(1),
					name: 'はみがきした',
					categoryId: asCategoryId(1),
					icon: '🦷',
					basePoints: 5,
					priority: 'must',
				},
				TENANT,
			);
			expect(Number(a1.id)).toBeGreaterThan(0);
			expect(a1.childId).toBe('1');
			expect(a1.priority).toBe('must');

			const list = await findActivitiesByChild(asChildId(1), TENANT);
			expect(list.length).toBe(1);
			expect(list[0]?.name).toBe('はみがきした');
		});

		it('#3422: dailyLimit / nameKana / nameKanji を persist する (旧 silent drop 回帰防止)', async () => {
			const a = await insertActivity(
				{
					childId: asChildId(1),
					name: 'おてつだい',
					categoryId: asCategoryId(1),
					icon: '🧹',
					basePoints: 5,
					dailyLimit: 3,
					nameKana: 'おてつだい',
					nameKanji: 'お手伝い',
				},
				TENANT,
			);
			expect(a.dailyLimit).toBe(3);
			expect(a.nameKana).toBe('おてつだい');
			expect(a.nameKanji).toBe('お手伝い');

			// update でも persist される。dailyLimit semantics は null=1回 / 0=無制限 / N=N回
			// (activity-log-service.ts §daily limit 定義)。1 日上限を 3→1回(null) に変更する。
			const updated = await updateActivity(
				a.id,
				asChildId(1),
				{ dailyLimit: null, nameKana: 'かわった' },
				TENANT,
			);
			expect(updated?.dailyLimit).toBeNull();
			expect(updated?.nameKana).toBe('かわった');

			// dailyLimit=0 (無制限) を persist できる。0 を falsy 扱いで null へ落とさないことを固定。
			const unlimited = await updateActivity(a.id, asChildId(1), { dailyLimit: 0 }, TENANT);
			expect(unlimited?.dailyLimit).toBe(0);
		});

		it('別 child の activity は取得 list に出ない (cross-child isolation)', async () => {
			await insertActivity(
				{
					childId: asChildId(1),
					name: 'たろう専用',
					categoryId: asCategoryId(1),
					icon: '🤸',
					basePoints: 5,
				},
				TENANT,
			);
			await insertActivity(
				{
					childId: asChildId(2),
					name: 'はなこ専用',
					categoryId: asCategoryId(1),
					icon: '🎀',
					basePoints: 5,
				},
				TENANT,
			);

			const list1 = await findActivitiesByChild(asChildId(1), TENANT);
			const list2 = await findActivitiesByChild(asChildId(2), TENANT);

			expect(list1.length).toBe(1);
			expect(list1[0]?.name).toBe('たろう専用');
			expect(list2.length).toBe(1);
			expect(list2[0]?.name).toBe('はなこ専用');
		});

		it('findActivityById は id + childId の 2 軸で取得し、別 child の id は undefined', async () => {
			const inserted = await insertActivity(
				{
					childId: asChildId(1),
					name: '本人の活動',
					categoryId: asCategoryId(1),
					icon: '⭐',
					basePoints: 5,
				},
				TENANT,
			);

			const ownChild = await findActivityById(inserted.id, asChildId(1), TENANT);
			expect(ownChild?.name).toBe('本人の活動');

			// 別 child から同 id を取りに行っても undefined (cross-child block)
			const otherChild = await findActivityById(inserted.id, asChildId(2), TENANT);
			expect(otherChild).toBeUndefined();
		});
	});

	// ---------------------------------------------------------------
	// updateActivity / setActivityVisibility / deleteActivity
	// ---------------------------------------------------------------

	describe('updateActivity + setActivityVisibility + deleteActivity', () => {
		it('updateActivity は同 child scope の activity のみ更新可能', async () => {
			const a = await insertActivity(
				{
					childId: asChildId(1),
					name: '更新前',
					categoryId: asCategoryId(1),
					icon: '✏️',
					basePoints: 5,
				},
				TENANT,
			);

			const updated = await updateActivity(a.id, asChildId(1), { name: '更新後' }, TENANT);
			expect(updated?.name).toBe('更新後');

			// 別 child から同 id update は undefined (no-op)
			const blocked = await updateActivity(
				a.id,
				asChildId(2),
				{ name: 'should not update' },
				TENANT,
			);
			expect(blocked).toBeUndefined();

			const after = await findActivityById(a.id, asChildId(1), TENANT);
			expect(after?.name).toBe('更新後');
		});

		it('setActivityVisibility は child scope で isVisible 切替', async () => {
			const a = await insertActivity(
				{
					childId: asChildId(1),
					name: '表示',
					categoryId: asCategoryId(1),
					icon: '👁',
					basePoints: 5,
				},
				TENANT,
			);

			const hidden = await setActivityVisibility(a.id, asChildId(1), false, TENANT);
			expect(hidden?.isVisible).toBe(0);

			const shown = await setActivityVisibility(a.id, asChildId(1), true, TENANT);
			expect(shown?.isVisible).toBe(1);
		});

		it('deleteActivity は child scope で削除し、別 child では削除されない', async () => {
			const a = await insertActivity(
				{
					childId: asChildId(1),
					name: '削除予定',
					categoryId: asCategoryId(1),
					icon: '🗑',
					basePoints: 5,
				},
				TENANT,
			);

			const blocked = await deleteActivity(a.id, asChildId(2), TENANT);
			expect(blocked).toBeUndefined();
			const stillExists = await findActivityById(a.id, asChildId(1), TENANT);
			expect(stillExists).toBeDefined();

			const deleted = await deleteActivity(a.id, asChildId(1), TENANT);
			expect(deleted?.id).toBe(a.id);
			const gone = await findActivityById(a.id, asChildId(1), TENANT);
			expect(gone).toBeUndefined();
		});
	});

	// ---------------------------------------------------------------
	// insertActivitiesBulk
	// ---------------------------------------------------------------

	describe('insertActivitiesBulk', () => {
		it('複数 child に対し 1 回の call で per-child instance 配信できる', async () => {
			const rows = await insertActivitiesBulk(
				[
					{
						childId: asChildId(1),
						name: '一括A',
						categoryId: asCategoryId(1),
						icon: '📦',
						basePoints: 5,
					},
					{
						childId: asChildId(2),
						name: '一括A',
						categoryId: asCategoryId(1),
						icon: '📦',
						basePoints: 5,
					},
				],
				TENANT,
			);
			expect(rows.length).toBe(2);
			expect(rows[0]?.childId).toBe('1');
			expect(rows[1]?.childId).toBe('2');

			const list1 = await findActivitiesByChild(asChildId(1), TENANT);
			const list2 = await findActivitiesByChild(asChildId(2), TENANT);
			expect(list1.length).toBe(1);
			expect(list2.length).toBe(1);
		});

		it('空配列を渡しても安全 (no-op)', async () => {
			const rows = await insertActivitiesBulk([], TENANT);
			expect(rows).toEqual([]);
		});
	});

	// ---------------------------------------------------------------
	// archive / restore (#783)
	// ---------------------------------------------------------------

	describe('archiveActivities + restoreArchivedActivities', () => {
		it('archive 後はデフォルトで find 除外、includeArchived で取得可能', async () => {
			const a = await insertActivity(
				{
					childId: asChildId(1),
					name: 'archiveテスト',
					categoryId: asCategoryId(1),
					icon: '🗄',
					basePoints: 5,
				},
				TENANT,
			);

			// Phase 7 PR-2a (#2688): ArchivedReason 型強制で任意文字列 → ARCHIVED_REASONS 正規値
			await archiveActivities([a.id], 'trial_expired', TENANT);

			const defaultList = await findActivitiesByChild(asChildId(1), TENANT);
			expect(defaultList.length).toBe(0);

			const includeArchivedList = await findActivitiesByChild(asChildId(1), TENANT, {
				includeArchived: true,
			});
			expect(includeArchivedList.length).toBe(1);
			expect(includeArchivedList[0]?.isArchived).toBe(1);
			expect(includeArchivedList[0]?.archivedReason).toBe('trial_expired');
		});

		it('restoreArchivedActivities は reason 一致で復活', async () => {
			const a = await insertActivity(
				{
					childId: asChildId(1),
					name: 'restoreテスト',
					categoryId: asCategoryId(1),
					icon: '♻',
					basePoints: 5,
				},
				TENANT,
			);
			// Phase 7 PR-2a (#2688): ArchivedReason 型強制 (ARCHIVED_REASONS SSOT)
			await archiveActivities([a.id], 'downgrade_user_selected', TENANT);
			await restoreArchivedActivities('downgrade_user_selected', TENANT);

			const list = await findActivitiesByChild(asChildId(1), TENANT);
			expect(list.length).toBe(1);
			expect(list[0]?.isArchived).toBe(0);
			expect(list[0]?.archivedReason).toBeNull();
		});

		it('archive ids 空配列は no-op', async () => {
			// Phase 7 PR-2a (#2688): ArchivedReason 型強制 (ARCHIVED_REASONS SSOT)
			await archiveActivities([], 'trial_expired', TENANT);
			// no throw / no side effect
		});
	});

	// ---------------------------------------------------------------
	// countMainQuestActivities
	// ---------------------------------------------------------------

	describe('countMainQuestActivities', () => {
		it('isMainQuest=1 かつ visible/active のみカウント (per-child scope)', async () => {
			await insertActivity(
				{
					childId: asChildId(1),
					name: 'メイン1',
					categoryId: asCategoryId(1),
					icon: '🏆',
					basePoints: 10,
					isMainQuest: 1,
				},
				TENANT,
			);
			await insertActivity(
				{
					childId: asChildId(1),
					name: 'メイン2',
					categoryId: asCategoryId(1),
					icon: '🏅',
					basePoints: 10,
					isMainQuest: 1,
				},
				TENANT,
			);
			await insertActivity(
				{
					childId: asChildId(1),
					name: 'サブ',
					categoryId: asCategoryId(1),
					icon: '🔸',
					basePoints: 5,
				},
				TENANT,
			);
			// 別 child の main quest は別 count
			await insertActivity(
				{
					childId: asChildId(2),
					name: 'はなこのメイン',
					categoryId: asCategoryId(1),
					icon: '🌸',
					basePoints: 10,
					isMainQuest: 1,
				},
				TENANT,
			);

			expect(await countMainQuestActivities(asChildId(1), TENANT)).toBe(2);
			expect(await countMainQuestActivities(asChildId(2), TENANT)).toBe(1);
			expect(await countMainQuestActivities(asChildId(999), TENANT)).toBe(0);
		});
	});

	// ---------------------------------------------------------------
	// findChildById (convenience)
	// ---------------------------------------------------------------

	describe('findChildById', () => {
		it('存在する child を返す', async () => {
			const c = await findChildById(asChildId(1), TENANT);
			expect(c?.nickname).toBe('たろう');
		});

		it('存在しない id は undefined', async () => {
			const c = await findChildById(asChildId(999), TENANT);
			expect(c).toBeUndefined();
		});
	});

	// ---------------------------------------------------------------
	// visibleOnly option
	// ---------------------------------------------------------------

	describe('findActivitiesByChild visibleOnly option', () => {
		it('visibleOnly=true で isVisible=1 のみ返す', async () => {
			const visible = await insertActivity(
				{
					childId: asChildId(1),
					name: '表示',
					categoryId: asCategoryId(1),
					icon: '👁',
					basePoints: 5,
				},
				TENANT,
			);
			const hidden = await insertActivity(
				{
					childId: asChildId(1),
					name: '非表示',
					categoryId: asCategoryId(1),
					icon: '🙈',
					basePoints: 5,
				},
				TENANT,
			);
			await setActivityVisibility(hidden.id, asChildId(1), false, TENANT);

			const visibleOnly = await findActivitiesByChild(asChildId(1), TENANT, { visibleOnly: true });
			expect(visibleOnly.length).toBe(1);
			expect(visibleOnly[0]?.id).toBe(visible.id);

			const all = await findActivitiesByChild(asChildId(1), TENANT);
			expect(all.length).toBe(2);
		});
	});
});
