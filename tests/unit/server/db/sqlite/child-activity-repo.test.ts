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
	copyActivitiesAcrossChildren,
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
					childId: 1,
					name: 'はみがきした',
					categoryId: 1,
					icon: '🦷',
					basePoints: 5,
					priority: 'must',
				},
				TENANT,
			);
			expect(a1.id).toBeGreaterThan(0);
			expect(a1.childId).toBe(1);
			expect(a1.priority).toBe('must');

			const list = await findActivitiesByChild(1, TENANT);
			expect(list.length).toBe(1);
			expect(list[0]?.name).toBe('はみがきした');
		});

		it('#3422: dailyLimit / nameKana / nameKanji を persist する (旧 silent drop 回帰防止)', async () => {
			const a = await insertActivity(
				{
					childId: 1,
					name: 'おてつだい',
					categoryId: 1,
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

			// update でも persist される (1 日上限を 3→無制限(null) に変更)
			const updated = await updateActivity(
				a.id,
				1,
				{ dailyLimit: null, nameKana: 'かわった' },
				TENANT,
			);
			expect(updated?.dailyLimit).toBeNull();
			expect(updated?.nameKana).toBe('かわった');
		});

		it('別 child の activity は取得 list に出ない (cross-child isolation)', async () => {
			await insertActivity(
				{ childId: 1, name: 'たろう専用', categoryId: 1, icon: '🤸', basePoints: 5 },
				TENANT,
			);
			await insertActivity(
				{ childId: 2, name: 'はなこ専用', categoryId: 1, icon: '🎀', basePoints: 5 },
				TENANT,
			);

			const list1 = await findActivitiesByChild(1, TENANT);
			const list2 = await findActivitiesByChild(2, TENANT);

			expect(list1.length).toBe(1);
			expect(list1[0]?.name).toBe('たろう専用');
			expect(list2.length).toBe(1);
			expect(list2[0]?.name).toBe('はなこ専用');
		});

		it('findActivityById は id + childId の 2 軸で取得し、別 child の id は undefined', async () => {
			const inserted = await insertActivity(
				{ childId: 1, name: '本人の活動', categoryId: 1, icon: '⭐', basePoints: 5 },
				TENANT,
			);

			const ownChild = await findActivityById(inserted.id, 1, TENANT);
			expect(ownChild?.name).toBe('本人の活動');

			// 別 child から同 id を取りに行っても undefined (cross-child block)
			const otherChild = await findActivityById(inserted.id, 2, TENANT);
			expect(otherChild).toBeUndefined();
		});
	});

	// ---------------------------------------------------------------
	// updateActivity / setActivityVisibility / deleteActivity
	// ---------------------------------------------------------------

	describe('updateActivity + setActivityVisibility + deleteActivity', () => {
		it('updateActivity は同 child scope の activity のみ更新可能', async () => {
			const a = await insertActivity(
				{ childId: 1, name: '更新前', categoryId: 1, icon: '✏️', basePoints: 5 },
				TENANT,
			);

			const updated = await updateActivity(a.id, 1, { name: '更新後' }, TENANT);
			expect(updated?.name).toBe('更新後');

			// 別 child から同 id update は undefined (no-op)
			const blocked = await updateActivity(a.id, 2, { name: 'should not update' }, TENANT);
			expect(blocked).toBeUndefined();

			const after = await findActivityById(a.id, 1, TENANT);
			expect(after?.name).toBe('更新後');
		});

		it('setActivityVisibility は child scope で isVisible 切替', async () => {
			const a = await insertActivity(
				{ childId: 1, name: '表示', categoryId: 1, icon: '👁', basePoints: 5 },
				TENANT,
			);

			const hidden = await setActivityVisibility(a.id, 1, false, TENANT);
			expect(hidden?.isVisible).toBe(0);

			const shown = await setActivityVisibility(a.id, 1, true, TENANT);
			expect(shown?.isVisible).toBe(1);
		});

		it('deleteActivity は child scope で削除し、別 child では削除されない', async () => {
			const a = await insertActivity(
				{ childId: 1, name: '削除予定', categoryId: 1, icon: '🗑', basePoints: 5 },
				TENANT,
			);

			const blocked = await deleteActivity(a.id, 2, TENANT);
			expect(blocked).toBeUndefined();
			const stillExists = await findActivityById(a.id, 1, TENANT);
			expect(stillExists).toBeDefined();

			const deleted = await deleteActivity(a.id, 1, TENANT);
			expect(deleted?.id).toBe(a.id);
			const gone = await findActivityById(a.id, 1, TENANT);
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
					{ childId: 1, name: '一括A', categoryId: 1, icon: '📦', basePoints: 5 },
					{ childId: 2, name: '一括A', categoryId: 1, icon: '📦', basePoints: 5 },
				],
				TENANT,
			);
			expect(rows.length).toBe(2);
			expect(rows[0]?.childId).toBe(1);
			expect(rows[1]?.childId).toBe(2);

			const list1 = await findActivitiesByChild(1, TENANT);
			const list2 = await findActivitiesByChild(2, TENANT);
			expect(list1.length).toBe(1);
			expect(list2.length).toBe(1);
		});

		it('空配列を渡しても安全 (no-op)', async () => {
			const rows = await insertActivitiesBulk([], TENANT);
			expect(rows).toEqual([]);
		});
	});

	// ---------------------------------------------------------------
	// copyActivitiesAcrossChildren (兄弟共通化 UX)
	// ---------------------------------------------------------------

	describe('copyActivitiesAcrossChildren', () => {
		it('source child の全活動を target child に複製し、id は別採番される', async () => {
			await insertActivity(
				{ childId: 1, name: 'コピー元A', categoryId: 1, icon: '📚', basePoints: 5 },
				TENANT,
			);
			await insertActivity(
				{ childId: 1, name: 'コピー元B', categoryId: 2, icon: '🎨', basePoints: 10 },
				TENANT,
			);

			const copied = await copyActivitiesAcrossChildren(1, 2, TENANT);
			expect(copied.length).toBe(2);
			expect(copied.every((a) => a.childId === 2)).toBe(true);

			// id は新規採番されており source 側と一致しない
			const sourceList = await findActivitiesByChild(1, TENANT);
			const targetList = await findActivitiesByChild(2, TENANT);
			expect(targetList.length).toBe(2);
			const sourceIds = new Set(sourceList.map((a) => a.id));
			expect(targetList.every((a) => !sourceIds.has(a.id))).toBe(true);

			// name / categoryId / basePoints は維持
			const targetByName = new Map(targetList.map((a) => [a.name, a]));
			expect(targetByName.get('コピー元A')?.basePoints).toBe(5);
			expect(targetByName.get('コピー元B')?.basePoints).toBe(10);
			expect(targetByName.get('コピー元B')?.categoryId).toBe(2);
		});

		it('source child に活動が無い場合は empty array', async () => {
			const copied = await copyActivitiesAcrossChildren(1, 2, TENANT);
			expect(copied).toEqual([]);
		});
	});

	// ---------------------------------------------------------------
	// archive / restore (#783)
	// ---------------------------------------------------------------

	describe('archiveActivities + restoreArchivedActivities', () => {
		it('archive 後はデフォルトで find 除外、includeArchived で取得可能', async () => {
			const a = await insertActivity(
				{ childId: 1, name: 'archiveテスト', categoryId: 1, icon: '🗄', basePoints: 5 },
				TENANT,
			);

			// Phase 7 PR-2a (#2688): ArchivedReason 型強制で任意文字列 → ARCHIVED_REASONS 正規値
			await archiveActivities([a.id], 'trial_expired', TENANT);

			const defaultList = await findActivitiesByChild(1, TENANT);
			expect(defaultList.length).toBe(0);

			const includeArchivedList = await findActivitiesByChild(1, TENANT, {
				includeArchived: true,
			});
			expect(includeArchivedList.length).toBe(1);
			expect(includeArchivedList[0]?.isArchived).toBe(1);
			expect(includeArchivedList[0]?.archivedReason).toBe('trial_expired');
		});

		it('restoreArchivedActivities は reason 一致で復活', async () => {
			const a = await insertActivity(
				{ childId: 1, name: 'restoreテスト', categoryId: 1, icon: '♻', basePoints: 5 },
				TENANT,
			);
			// Phase 7 PR-2a (#2688): ArchivedReason 型強制 (ARCHIVED_REASONS SSOT)
			await archiveActivities([a.id], 'downgrade_user_selected', TENANT);
			await restoreArchivedActivities('downgrade_user_selected', TENANT);

			const list = await findActivitiesByChild(1, TENANT);
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
				{ childId: 1, name: 'メイン1', categoryId: 1, icon: '🏆', basePoints: 10, isMainQuest: 1 },
				TENANT,
			);
			await insertActivity(
				{ childId: 1, name: 'メイン2', categoryId: 1, icon: '🏅', basePoints: 10, isMainQuest: 1 },
				TENANT,
			);
			await insertActivity(
				{ childId: 1, name: 'サブ', categoryId: 1, icon: '🔸', basePoints: 5 },
				TENANT,
			);
			// 別 child の main quest は別 count
			await insertActivity(
				{
					childId: 2,
					name: 'はなこのメイン',
					categoryId: 1,
					icon: '🌸',
					basePoints: 10,
					isMainQuest: 1,
				},
				TENANT,
			);

			expect(await countMainQuestActivities(1, TENANT)).toBe(2);
			expect(await countMainQuestActivities(2, TENANT)).toBe(1);
			expect(await countMainQuestActivities(999, TENANT)).toBe(0);
		});
	});

	// ---------------------------------------------------------------
	// findChildById (convenience)
	// ---------------------------------------------------------------

	describe('findChildById', () => {
		it('存在する child を返す', async () => {
			const c = await findChildById(1, TENANT);
			expect(c?.nickname).toBe('たろう');
		});

		it('存在しない id は undefined', async () => {
			const c = await findChildById(999, TENANT);
			expect(c).toBeUndefined();
		});
	});

	// ---------------------------------------------------------------
	// visibleOnly option
	// ---------------------------------------------------------------

	describe('findActivitiesByChild visibleOnly option', () => {
		it('visibleOnly=true で isVisible=1 のみ返す', async () => {
			const visible = await insertActivity(
				{ childId: 1, name: '表示', categoryId: 1, icon: '👁', basePoints: 5 },
				TENANT,
			);
			const hidden = await insertActivity(
				{ childId: 1, name: '非表示', categoryId: 1, icon: '🙈', basePoints: 5 },
				TENANT,
			);
			await setActivityVisibility(hidden.id, 1, false, TENANT);

			const visibleOnly = await findActivitiesByChild(1, TENANT, { visibleOnly: true });
			expect(visibleOnly.length).toBe(1);
			expect(visibleOnly[0]?.id).toBe(visible.id);

			const all = await findActivitiesByChild(1, TENANT);
			expect(all.length).toBe(2);
		});
	});
});
