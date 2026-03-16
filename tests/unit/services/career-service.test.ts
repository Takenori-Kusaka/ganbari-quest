// tests/unit/services/career-service.test.ts
// キャリアプランニング サービスのユニットテスト

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, seedTestData } from '../../helpers/test-db';

// DB モック
vi.mock('$lib/server/db', () => ({
	db: null as ReturnType<typeof createTestDb>['db'] | null,
}));
vi.mock('$lib/server/db/client', () => ({
	db: null as ReturnType<typeof createTestDb>['db'] | null,
}));

import * as dbModule from '$lib/server/db';
import * as dbClientModule from '$lib/server/db/client';

let testDbInstance: ReturnType<typeof createTestDb>;

beforeAll(() => {
	testDbInstance = createTestDb();
	(dbModule as { db: typeof testDbInstance.db }).db = testDbInstance.db;
	(dbClientModule as { db: typeof testDbInstance.db }).db = testDbInstance.db;
});

afterAll(() => {
	testDbInstance.sqlite.close();
});

let childId: number;

beforeEach(() => {
	// テーブルを DROP & 再作成して AUTOINCREMENT をリセット
	testDbInstance.sqlite.pragma('foreign_keys = OFF');
	testDbInstance.sqlite.exec('DELETE FROM career_plan_history');
	testDbInstance.sqlite.exec('DELETE FROM career_plans');
	testDbInstance.sqlite.exec('DELETE FROM career_fields');
	testDbInstance.sqlite.exec('DELETE FROM point_ledger');
	testDbInstance.sqlite.exec('DELETE FROM activity_logs');
	testDbInstance.sqlite.exec('DELETE FROM activities');
	testDbInstance.sqlite.exec('DELETE FROM children');
	// AUTOINCREMENT シーケンスリセット
	testDbInstance.sqlite.exec("DELETE FROM sqlite_sequence WHERE name IN ('children', 'activities', 'career_fields', 'career_plans', 'career_plan_history', 'point_ledger')");
	testDbInstance.sqlite.pragma('foreign_keys = ON');

	// テストデータ投入
	const seed = seedTestData(testDbInstance.db);
	childId = seed.childId;

	// 職業分野マスタ投入
	testDbInstance.sqlite.exec(`
		INSERT INTO career_fields (id, name, description, icon, related_categories, min_age)
		VALUES (1, 'かがくしゃ', '実験や研究で新しい発見をする', '🔬', '[2, 5]', 6);
		INSERT INTO career_fields (id, name, description, icon, related_categories, min_age)
		VALUES (2, 'スポーツせんしゅ', 'スポーツの大会で活躍する', '⚽', '[1]', 6);
		INSERT INTO career_fields (id, name, description, icon, related_categories, min_age)
		VALUES (3, 'エンジニア', '機械やしくみを作る', '⚙️', '[2, 5]', 8);
	`);
});

// 動的インポート（モック適用後）
const { getCareerFields, getActiveCareerPlan, createCareerPlan, updateCareerPlanWithPoints } =
	await import('../../../src/lib/server/services/career-service');
const { findAllCareerFields, findCareerFieldsByAge } =
	await import('../../../src/lib/server/db/career-repo');

describe('career-service', () => {
	describe('getCareerFields', () => {
		it('全職業分野を取得できる', () => {
			const fields = getCareerFields();
			expect(fields).toHaveLength(3);
			expect(fields[0].name).toBe('かがくしゃ');
		});

		it('年齢フィルタで絞り込める', () => {
			const fields = getCareerFields(7);
			// minAge <= 7 のもの: かがくしゃ(6), スポーツ(6) = 2件
			expect(fields).toHaveLength(2);
			expect(fields.every((f) => f.minAge <= 7)).toBe(true);
		});

		it('年齢8以上ならエンジニアも取得', () => {
			const fields = getCareerFields(8);
			expect(fields).toHaveLength(3);
		});
	});

	describe('createCareerPlan', () => {
		it('マンダラチャート付きでプランを作成すると500pt付与', () => {
			const result = createCareerPlan(childId, {
				careerFieldId: 1,
				dreamText: 'かがくしゃになりたい！',
				mandalaChart: {
					center: 'かがくしゃになる',
					surrounding: [{ goal: 'じっけんする', actions: ['かがくのほんをよむ'] }],
				},
			});

			expect(result.plan).toBeDefined();
			expect(result.plan.childId).toBe(childId);
			expect(result.plan.careerFieldId).toBe(1);
			expect(result.pointsAwarded).toBe(500);
		});

		it('タイムライン付きだと追加で300pt', () => {
			const result = createCareerPlan(childId, {
				careerFieldId: 2,
				dreamText: 'サッカーせんしゅになる',
				mandalaChart: {
					center: 'サッカーせんしゅになる',
					surrounding: [],
				},
				timeline3y: 'チームでレギュラーになる',
				timeline5y: 'けんのたいかいにでる',
				timeline10y: 'プロになる',
			});

			expect(result.pointsAwarded).toBe(500 + 300);
		});

		it('マンダラなし・タイムラインなしなら0pt', () => {
			const result = createCareerPlan(childId, {
				careerFieldId: 1,
				dreamText: 'まだかんがえちゅう',
			});

			expect(result.pointsAwarded).toBe(0);
		});

		it('新規プラン作成で既存プランが非アクティブ化', () => {
			// 1回目
			createCareerPlan(childId, {
				careerFieldId: 1,
				mandalaChart: { center: 'プラン1', surrounding: [] },
			});

			// 2回目
			const result = createCareerPlan(childId, {
				careerFieldId: 2,
				mandalaChart: { center: 'プラン2', surrounding: [] },
			});

			const active = getActiveCareerPlan(childId);
			expect(active).not.toBeNull();
			expect(active!.careerFieldId).toBe(2);
			expect(JSON.parse(active!.mandalaChart).center).toBe('プラン2');
		});
	});

	describe('getActiveCareerPlan', () => {
		it('プラン未作成ならnull', () => {
			const plan = getActiveCareerPlan(childId);
			expect(plan).toBeNull();
		});

		it('プラン作成後に取得できる', () => {
			createCareerPlan(childId, {
				careerFieldId: 1,
				dreamText: 'かがくしゃ',
				mandalaChart: { center: 'テスト', surrounding: [] },
			});

			const plan = getActiveCareerPlan(childId);
			expect(plan).not.toBeNull();
			expect(plan!.dreamText).toBe('かがくしゃ');
			expect(plan!.careerField).not.toBeNull();
			expect(plan!.careerField!.name).toBe('かがくしゃ');
		});
	});

	describe('updateCareerPlanWithPoints', () => {
		it('マンダラ更新で月1回100pt', () => {
			const created = createCareerPlan(childId, {
				careerFieldId: 1,
				mandalaChart: { center: 'テスト', surrounding: [] },
			});

			const result = updateCareerPlanWithPoints(created.plan.id, childId, {
				mandalaChart: {
					center: 'テスト更新',
					surrounding: [{ goal: '新しいもくひょう', actions: [] }],
				},
			});

			expect(result.pointsAwarded).toBe(100);
			expect(result.plan).toBeDefined();
		});

		it('同月2回目のマンダラ更新は0pt', () => {
			const created = createCareerPlan(childId, {
				careerFieldId: 1,
				mandalaChart: { center: 'テスト', surrounding: [] },
			});

			// 1回目の更新
			updateCareerPlanWithPoints(created.plan.id, childId, {
				mandalaChart: { center: 'テスト更新1', surrounding: [] },
			});

			// 2回目の更新（同月）
			const result = updateCareerPlanWithPoints(created.plan.id, childId, {
				mandalaChart: { center: 'テスト更新2', surrounding: [] },
			});

			expect(result.pointsAwarded).toBe(0);
		});

		it('バージョンがインクリメントされる', () => {
			const created = createCareerPlan(childId, {
				careerFieldId: 1,
				mandalaChart: { center: 'テスト', surrounding: [] },
			});

			expect(created.plan.version).toBe(1);

			const updated = updateCareerPlanWithPoints(created.plan.id, childId, {
				dreamText: '夢を変更',
			});

			expect(updated.plan!.version).toBe(2);
		});
	});
});
