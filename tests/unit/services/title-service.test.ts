// tests/unit/services/title-service.test.ts
// 称号コレクションサービスのユニットテスト

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type TestDb, type TestSqlite, closeDb, createTestDb } from '../helpers/test-db';

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
	checkAndUnlockTitles,
	getActiveTitle,
	getChildTitles,
	setActiveTitle,
} from '../../../src/lib/server/services/title-service';

beforeAll(() => {
	const t = createTestDb();
	sqlite = t.sqlite;
	testDb = t.db;
});

afterAll(() => {
	closeDb(sqlite);
});

beforeEach(() => {
	// テストデータをクリア
	sqlite.exec('DELETE FROM child_titles');
	sqlite.exec('DELETE FROM activity_logs');
	sqlite.exec('DELETE FROM statuses');
	sqlite.exec('DELETE FROM status_history');
	sqlite.exec('DELETE FROM market_benchmarks');
	sqlite.exec('DELETE FROM titles');
	sqlite.exec('DELETE FROM activities');
	sqlite.exec('DELETE FROM children');

	// 子供
	sqlite.exec("INSERT INTO children (id, nickname, age) VALUES (1, 'テストちゃん', 4)");

	// 活動
	sqlite.exec(
		"INSERT INTO activities (id, name, category_id, icon, base_points, sort_order) VALUES (1, 'たいそう', 1, '🤸', 5, 1)",
	);

	// ベンチマーク（偏差値計算に必要）
	for (let catId = 1; catId <= 5; catId++) {
		sqlite.exec(
			`INSERT INTO market_benchmarks (age, category_id, mean, std_dev, source) VALUES (4, ${catId}, 25.0, 10.0, 'test')`,
		);
	}

	// 称号マスタ
	sqlite.exec(`
		INSERT INTO titles (id, code, name, description, icon, condition_type, condition_value, condition_extra, rarity, sort_order)
		VALUES
			(1, 'undou_master', 'うんどうマスター', 'うんどう偏差値65+', '🏋️', 'category_deviation', 65, '{"categoryId":1}', 'rare', 1),
			(2, 'renzoku_oni', 'れんぞくの鬼', '30日連続', '👹', 'streak_days', 30, NULL, 'epic', 2),
			(3, 'kami_level', 'かみさまのしもべ', 'レベル10', '✨', 'level_reach', 10, NULL, 'legendary', 3),
			(4, 'all_rounder', 'オールラウンダー', '全カテゴリ偏差値55+', '🌟', 'all_categories_deviation', 55, NULL, 'legendary', 4)
	`);
});

describe('checkAndUnlockTitles', () => {
	it('偏差値が条件未満なら称号は解除されない', async () => {
		// ステータス: うんどう=25 → 偏差値50 (mean=25, stdDev=10 → (25-25)/10*10+50=50)
		sqlite.exec(
			'INSERT INTO statuses (child_id, category_id, total_xp, level, peak_xp) VALUES (1, 1, 25, 2, 25)',
		);
		const result = await checkAndUnlockTitles(1, 'test-tenant');
		expect(result).toEqual([]);
	});

	it('偏差値が条件を満たすと称号が解除される', async () => {
		// ステータス: うんどう=40 → 偏差値65 (mean=25, stdDev=10 → (40-25)/10*10+50=65)
		sqlite.exec(
			'INSERT INTO statuses (child_id, category_id, total_xp, level, peak_xp) VALUES (1, 1, 40, 3, 40)',
		);
		const result = await checkAndUnlockTitles(1, 'test-tenant');
		expect(result.length).toBe(1);
		expect(result[0]?.code).toBe('undou_master');
		expect(result[0]?.rarity).toBe('rare');
	});

	it('既に解除済みなら重複解除しない', async () => {
		sqlite.exec(
			'INSERT INTO statuses (child_id, category_id, total_xp, level, peak_xp) VALUES (1, 1, 40, 3, 40)',
		);
		await checkAndUnlockTitles(1, 'test-tenant'); // 1回目
		const result = await checkAndUnlockTitles(1, 'test-tenant'); // 2回目
		expect(result).toEqual([]);
	});

	it('全カテゴリ偏差値条件: 全部55以上でオールラウンダー解除', async () => {
		// 偏差値55 → value = 25 + (55-50)/10*10 = 30
		for (let catId = 1; catId <= 5; catId++) {
			sqlite.exec(
				`INSERT INTO statuses (child_id, category_id, total_xp, level, peak_xp) VALUES (1, ${catId}, 30, 2, 30)`,
			);
		}
		const result = await checkAndUnlockTitles(1, 'test-tenant');
		const allRounder = result.find((t) => t.code === 'all_rounder');
		expect(allRounder).toBeDefined();
	});

	it('全カテゴリ偏差値条件: 1つでも足りないと解除されない', async () => {
		for (let catId = 1; catId <= 4; catId++) {
			sqlite.exec(
				`INSERT INTO statuses (child_id, category_id, total_xp, level, peak_xp) VALUES (1, ${catId}, 30, 2, 30)`,
			);
		}
		// カテゴリ5は偏差値40 (value=15)
		sqlite.exec(
			'INSERT INTO statuses (child_id, category_id, total_xp, level, peak_xp) VALUES (1, 5, 15, 2, 15)',
		);
		const result = await checkAndUnlockTitles(1, 'test-tenant');
		const allRounder = result.find((t) => t.code === 'all_rounder');
		expect(allRounder).toBeUndefined();
	});
});

describe('getChildTitles', () => {
	it('全称号一覧を解除状態付きで返す', async () => {
		const titles = await getChildTitles(1, 'test-tenant');
		expect(titles.length).toBe(4);
		expect(titles.every((t) => t.unlockedAt === null)).toBe(true);
	});

	it('解除済み称号のunlockedAtが設定される', async () => {
		sqlite.exec(
			'INSERT INTO statuses (child_id, category_id, total_xp, level, peak_xp) VALUES (1, 1, 40, 3, 40)',
		);
		await checkAndUnlockTitles(1, 'test-tenant');

		const titles = await getChildTitles(1, 'test-tenant');
		const undouMaster = titles.find((t) => t.code === 'undou_master');
		expect(undouMaster?.unlockedAt).not.toBeNull();
	});

	it('進捗が正しく計算される', async () => {
		// うんどう偏差値50 (value=25) → 条件65に対して50/65*100 = 77%
		sqlite.exec(
			'INSERT INTO statuses (child_id, category_id, total_xp, level, peak_xp) VALUES (1, 1, 25, 2, 25)',
		);
		const titles = await getChildTitles(1, 'test-tenant');
		const undouMaster = titles.find((t) => t.code === 'undou_master');
		expect(undouMaster?.currentProgress).toBe(77); // Math.round(50/65*100)
	});

	it('条件ラベルが正しく生成される', async () => {
		const titles = await getChildTitles(1, 'test-tenant');
		const undouMaster = titles.find((t) => t.code === 'undou_master');
		expect(undouMaster?.conditionLabel).toBe('うんどうのへんさち65いじょう');
		const streak = titles.find((t) => t.code === 'renzoku_oni');
		expect(streak?.conditionLabel).toBe('30にちれんぞくかつどう');
	});
});

describe('setActiveTitle', () => {
	it('解除済み称号を装備できる', async () => {
		sqlite.exec(
			'INSERT INTO statuses (child_id, category_id, total_xp, level, peak_xp) VALUES (1, 1, 40, 3, 40)',
		);
		await checkAndUnlockTitles(1, 'test-tenant');

		const result = await setActiveTitle(1, 1, 'test-tenant');
		expect(result).toEqual({ success: true });

		const active = await getActiveTitle(1, 'test-tenant');
		expect(active?.name).toBe('うんどうマスター');
		expect(active?.icon).toBe('🏋️');
	});

	it('未解除の称号は装備できない', async () => {
		const result = await setActiveTitle(1, 1, 'test-tenant');
		expect(result).toEqual({ error: 'TITLE_NOT_UNLOCKED' });
	});

	it('nullで装備を外せる', async () => {
		sqlite.exec(
			'INSERT INTO statuses (child_id, category_id, total_xp, level, peak_xp) VALUES (1, 1, 40, 3, 40)',
		);
		await checkAndUnlockTitles(1, 'test-tenant');
		await setActiveTitle(1, 1, 'test-tenant');

		const result = await setActiveTitle(1, null, 'test-tenant');
		expect(result).toEqual({ success: true });

		const active = await getActiveTitle(1, 'test-tenant');
		expect(active).toBeNull();
	});
});

describe('getActiveTitle', () => {
	it('未設定ならnullを返す', async () => {
		const active = await getActiveTitle(1, 'test-tenant');
		expect(active).toBeNull();
	});
});
