// tests/unit/services/special-reward-service.test.ts
// 特別報酬サービスのユニットテスト

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';

let sqlite: InstanceType<typeof Database>;
let testDb: ReturnType<typeof drizzle>;

const SQL_TABLES = `
	CREATE TABLE children (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		nickname TEXT NOT NULL, age INTEGER NOT NULL, birth_date TEXT,
		theme TEXT NOT NULL DEFAULT 'pink',
		ui_mode TEXT NOT NULL DEFAULT 'kinder',
		avatar_url TEXT,
		active_title_id INTEGER,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE point_ledger (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		amount INTEGER NOT NULL, type TEXT NOT NULL,
		description TEXT, reference_id INTEGER,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX idx_point_ledger_child ON point_ledger(child_id, created_at);
	CREATE TABLE special_rewards (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		granted_by INTEGER,
		title TEXT NOT NULL, description TEXT,
		points INTEGER NOT NULL, icon TEXT,
		category TEXT NOT NULL,
		granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		shown_at TEXT
	);
	CREATE INDEX idx_special_rewards_child ON special_rewards(child_id, granted_at);
	CREATE TABLE settings (
		key TEXT PRIMARY KEY, value TEXT NOT NULL,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
`;

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
	getChildSpecialRewards,
	getRewardTemplates,
	getUnshownReward,
	grantSpecialReward,
	markRewardShown,
	saveRewardTemplates,
} from '../../../src/lib/server/services/special-reward-service';

beforeAll(() => {
	sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	sqlite.exec(SQL_TABLES);
	testDb = drizzle(sqlite, { schema });
});

afterAll(() => {
	sqlite.close();
});

function resetDb() {
	sqlite.exec('DELETE FROM special_rewards');
	sqlite.exec('DELETE FROM point_ledger');
	sqlite.exec('DELETE FROM settings');
	sqlite.exec('DELETE FROM children');
	sqlite.exec(
		"DELETE FROM sqlite_sequence WHERE name IN ('children','point_ledger','special_rewards')",
	);
}

function seedBase() {
	resetDb();
	testDb.insert(schema.children).values({ nickname: 'テストちゃん', age: 4, theme: 'pink' }).run();
}

describe('grantSpecialReward', () => {
	beforeEach(() => {
		seedBase();
	});

	it('正常に特別報酬を付与できる', () => {
		const result = grantSpecialReward({
			childId: 1,
			title: 'テスト100点',
			points: 100,
			category: 'academic',
		});

		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.id).toBe(1);
			expect(result.childId).toBe(1);
			expect(result.title).toBe('テスト100点');
			expect(result.points).toBe(100);
			expect(result.category).toBe('academic');
			expect(result.grantedAt).toBeDefined();
		}
	});

	it('オプションフィールド付きで付与できる', () => {
		const result = grantSpecialReward({
			childId: 1,
			title: '漢字検定合格',
			description: '漢字検定10級に合格！',
			points: 200,
			icon: '📜',
			category: 'academic',
		});

		expect('error' in result).toBe(false);
		if (!('error' in result)) {
			expect(result.description).toBe('漢字検定10級に合格！');
			expect(result.icon).toBe('📜');
		}
	});

	it('ポイント台帳に special_reward エントリが追加される', () => {
		grantSpecialReward({
			childId: 1,
			title: 'テスト満点',
			points: 50,
			category: 'academic',
		});

		const ledger = testDb.select().from(schema.pointLedger).all();
		expect(ledger).toHaveLength(1);
		expect(ledger[0]?.amount).toBe(50);
		expect(ledger[0]?.type).toBe('special_reward');
		expect(ledger[0]?.description).toBe('テスト満点');
	});

	it('存在しない子供にはエラーを返す', () => {
		const result = grantSpecialReward({
			childId: 999,
			title: 'テスト',
			points: 50,
			category: 'other',
		});

		expect('error' in result).toBe(true);
		if ('error' in result) {
			expect(result.error).toBe('NOT_FOUND');
			expect(result.target).toBe('child');
		}
	});

	it('複数回付与できる', () => {
		grantSpecialReward({ childId: 1, title: '1回目', points: 50, category: 'academic' });
		grantSpecialReward({ childId: 1, title: '2回目', points: 100, category: 'sports' });

		const ledger = testDb.select().from(schema.pointLedger).all();
		expect(ledger).toHaveLength(2);

		const total = ledger.reduce((sum, e) => sum + e.amount, 0);
		expect(total).toBe(150);
	});
});

describe('getChildSpecialRewards', () => {
	beforeEach(() => {
		seedBase();
	});

	it('空の履歴を返す', () => {
		const result = getChildSpecialRewards(1);
		expect(result.rewards).toHaveLength(0);
		expect(result.totalPoints).toBe(0);
	});

	it('付与した報酬の履歴を返す', () => {
		grantSpecialReward({ childId: 1, title: 'テスト満点', points: 100, category: 'academic' });
		grantSpecialReward({ childId: 1, title: '大会入賞', points: 150, category: 'sports' });

		const result = getChildSpecialRewards(1);
		expect(result.rewards).toHaveLength(2);
		expect(result.totalPoints).toBe(250);
	});

	it('降順で返される', () => {
		grantSpecialReward({ childId: 1, title: '1番目', points: 50, category: 'other' });
		grantSpecialReward({ childId: 1, title: '2番目', points: 100, category: 'other' });

		const result = getChildSpecialRewards(1);
		// 最新が先頭
		expect(result.rewards[0]?.title).toBe('2番目');
		expect(result.rewards[1]?.title).toBe('1番目');
	});
});

describe('getUnshownReward / markRewardShown', () => {
	beforeEach(() => {
		seedBase();
	});

	it('未表示報酬がない場合nullを返す', () => {
		const result = getUnshownReward(1);
		expect(result).toBeNull();
	});

	it('未表示の報酬を1件返す', () => {
		grantSpecialReward({ childId: 1, title: 'テスト100点', points: 100, category: 'academic' });
		const result = getUnshownReward(1);
		expect(result).not.toBeNull();
		expect(result!.title).toBe('テスト100点');
	});

	it('表示済みにした報酬は返さない', () => {
		const reward = grantSpecialReward({ childId: 1, title: 'テスト100点', points: 100, category: 'academic' });
		if (!('error' in reward)) {
			markRewardShown(reward.id);
		}
		const result = getUnshownReward(1);
		expect(result).toBeNull();
	});

	it('複数の報酬がある場合、未表示のものだけ返す', () => {
		const r1 = grantSpecialReward({ childId: 1, title: '1回目', points: 50, category: 'academic' });
		grantSpecialReward({ childId: 1, title: '2回目', points: 100, category: 'sports' });

		// 1回目を表示済みにする
		if (!('error' in r1)) {
			markRewardShown(r1.id);
		}

		const result = getUnshownReward(1);
		expect(result).not.toBeNull();
		expect(result!.title).toBe('2回目');
	});

	it('新しいごほうびを付与すると再度表示される', () => {
		const r1 = grantSpecialReward({ childId: 1, title: '1回目', points: 50, category: 'academic' });
		if (!('error' in r1)) {
			markRewardShown(r1.id);
		}

		// 新しい報酬を付与
		grantSpecialReward({ childId: 1, title: '2回目', points: 100, category: 'sports' });
		const result = getUnshownReward(1);
		expect(result).not.toBeNull();
		expect(result!.title).toBe('2回目');
	});
});

describe('getRewardTemplates / saveRewardTemplates', () => {
	beforeEach(() => {
		seedBase();
	});

	it('テンプレート未設定時は空配列を返す', () => {
		const templates = getRewardTemplates();
		expect(templates).toEqual([]);
	});

	it('テンプレートを保存・取得できる', () => {
		const data = [
			{ title: 'テスト100点', points: 100, icon: '🎓', category: 'academic' as const },
			{ title: '大会入賞', points: 150, icon: '🏆', category: 'sports' as const },
		];

		saveRewardTemplates(data);
		const templates = getRewardTemplates();
		expect(templates).toHaveLength(2);
		expect(templates[0]?.title).toBe('テスト100点');
		expect(templates[1]?.category).toBe('sports');
	});

	it('テンプレートを上書きできる', () => {
		saveRewardTemplates([{ title: '旧テンプレ', points: 50, category: 'other' as const }]);

		saveRewardTemplates([
			{ title: '新テンプレ1', points: 100, category: 'academic' as const },
			{ title: '新テンプレ2', points: 200, category: 'sports' as const },
		]);

		const templates = getRewardTemplates();
		expect(templates).toHaveLength(2);
		expect(templates[0]?.title).toBe('新テンプレ1');
	});
});
