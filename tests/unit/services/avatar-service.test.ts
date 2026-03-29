// tests/unit/services/avatar-service.test.ts
// きせかえアバターサービスのテスト

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import { createTestDb, seedTestData } from '../../helpers/test-db';

// モック: db モジュール
vi.mock('$lib/server/db', () => ({ db: null as ReturnType<typeof createTestDb>['db'] | null }));
vi.mock('$lib/server/db/client', () => ({
	db: null as ReturnType<typeof createTestDb>['db'] | null,
}));

import * as dbModule from '$lib/server/db';
import * as dbClientModule from '$lib/server/db/client';

let testDbInstance: ReturnType<typeof createTestDb>;

function seedAvatarItems(db: ReturnType<typeof createTestDb>['db']) {
	const items = [
		{
			code: 'bg_default',
			name: 'しろ',
			category: 'background',
			icon: '⬜',
			cssValue: '#ffffff',
			price: 0,
			unlockType: 'free',
			rarity: 'common',
			sortOrder: 1,
		},
		{
			code: 'bg_sakura',
			name: 'さくらいろ',
			category: 'background',
			icon: '🌸',
			cssValue: 'linear-gradient(135deg, #fce4ec, #f8bbd0)',
			price: 100,
			unlockType: 'purchase',
			rarity: 'common',
			sortOrder: 2,
		},
		{
			code: 'bg_galaxy',
			name: 'うちゅう',
			category: 'background',
			icon: '🌌',
			cssValue: 'linear-gradient(135deg, #1a237e, #4a148c)',
			price: 500,
			unlockType: 'purchase',
			rarity: 'epic',
			sortOrder: 3,
		},
		{
			code: 'bg_legend',
			name: 'でんせつ',
			category: 'background',
			icon: '🌟',
			cssValue: 'linear-gradient(135deg, #e8eaf6, #7986cb)',
			price: 0,
			unlockType: 'level',
			unlockCondition: '{"level":10}',
			rarity: 'legendary',
			sortOrder: 4,
		},
		{
			code: 'frame_default',
			name: 'ふつう',
			category: 'frame',
			icon: '⬜',
			cssValue: '2px solid #bdbdbd',
			price: 0,
			unlockType: 'free',
			rarity: 'common',
			sortOrder: 1,
		},
		{
			code: 'frame_star',
			name: 'ほし',
			category: 'frame',
			icon: '⭐',
			cssValue: '3px solid #ffd700',
			price: 150,
			unlockType: 'purchase',
			rarity: 'common',
			sortOrder: 2,
		},
		{
			code: 'effect_none',
			name: 'なし',
			category: 'effect',
			icon: '➖',
			cssValue: '',
			price: 0,
			unlockType: 'free',
			rarity: 'common',
			sortOrder: 1,
		},
		{
			code: 'effect_sparkle',
			name: 'キラキラ',
			category: 'effect',
			icon: '✨',
			cssValue: 'sparkle',
			price: 200,
			unlockType: 'purchase',
			rarity: 'rare',
			sortOrder: 2,
		},
	];

	for (const item of items) {
		db.insert(schema.avatarItems).values(item).run();
	}

	return items;
}

function seedPointBalance(
	db: ReturnType<typeof createTestDb>['db'],
	childId: number,
	amount: number,
) {
	db.insert(schema.pointLedger)
		.values({ childId, amount, type: 'test', description: 'テスト' })
		.run();
}

function seedStatuses(db: ReturnType<typeof createTestDb>['db'], childId: number) {
	// ステータスとベンチマーク（偏差値計算に必要）
	for (let catId = 1; catId <= 5; catId++) {
		db.insert(schema.statuses).values({ childId, categoryId: catId, value: 50 }).run();
		db.insert(schema.marketBenchmarks)
			.values({ age: 4, categoryId: catId, mean: 50, stdDev: 10, source: 'test' })
			.run();
	}
}

beforeEach(() => {
	testDbInstance = createTestDb();
	(dbModule as { db: typeof testDbInstance.db }).db = testDbInstance.db;
	(dbClientModule as { db: typeof testDbInstance.db }).db = testDbInstance.db;
});

describe('getShopItems', () => {
	it('全アイテムを所持状態付きで返す', async () => {
		const { avatarService } = await setupWithData();
		const items = await avatarService.getShopItems(1, 'test-tenant');
		expect(items.length).toBe(8);
		expect(items.every((i) => typeof i.owned === 'boolean')).toBe(true);
	});

	it('無料アイテムは自動付与後にowned=true', async () => {
		const { avatarService } = await setupWithData();
		await avatarService.checkAndUnlockItems(1, 'test-tenant');
		const items = await avatarService.getShopItems(1, 'test-tenant');
		const freeItems = items.filter((i) => i.unlockType === 'free');
		expect(freeItems.every((i) => i.owned)).toBe(true);
	});

	it('レベルロックアイテムはlocked=true', async () => {
		const { avatarService } = await setupWithData();
		const items = await avatarService.getShopItems(1, 'test-tenant');
		const legend = items.find((i) => i.code === 'bg_legend');
		expect(legend?.locked).toBe(true);
		expect(legend?.lockReason).toContain('レベル10');
	});
});

describe('purchaseItem', () => {
	it('ポイントが足りていれば購入成功', async () => {
		const { avatarService, db } = await setupWithData();
		seedPointBalance(db, 1, 500);

		// bg_sakura (price=100)
		const sakura = (await avatarService.getShopItems(1, 'test-tenant')).find(
			(i) => i.code === 'bg_sakura',
		);
		const result = await avatarService.purchaseItem(1, sakura?.id, 'test-tenant');
		expect(result).toEqual({ success: true });

		const items = await avatarService.getShopItems(1, 'test-tenant');
		expect(items.find((i) => i.code === 'bg_sakura')?.owned).toBe(true);
	});

	it('ポイント不足でエラー', async () => {
		const { avatarService } = await setupWithData();
		// ポイントなし
		const sakura = (await avatarService.getShopItems(1, 'test-tenant')).find(
			(i) => i.code === 'bg_sakura',
		);
		const result = await avatarService.purchaseItem(1, sakura?.id, 'test-tenant');
		expect(result).toEqual({ error: 'INSUFFICIENT_POINTS' });
	});

	it('既に所持済みでエラー', async () => {
		const { avatarService, db } = await setupWithData();
		seedPointBalance(db, 1, 1000);

		const sakura = (await avatarService.getShopItems(1, 'test-tenant')).find(
			(i) => i.code === 'bg_sakura',
		);
		await avatarService.purchaseItem(1, sakura?.id, 'test-tenant');
		const result = await avatarService.purchaseItem(1, sakura?.id, 'test-tenant');
		expect(result).toEqual({ error: 'ALREADY_OWNED' });
	});

	it('ロック中でエラー', async () => {
		const { avatarService } = await setupWithData();
		const legend = (await avatarService.getShopItems(1, 'test-tenant')).find(
			(i) => i.code === 'bg_legend',
		);
		const result = await avatarService.purchaseItem(1, legend?.id, 'test-tenant');
		expect(result).toEqual({ error: 'LOCKED' });
	});

	it('存在しないアイテムでエラー', async () => {
		const { avatarService } = await setupWithData();
		const result = await avatarService.purchaseItem(1, 9999, 'test-tenant');
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});
});

describe('equipItem', () => {
	it('所持済みアイテムを装備できる', async () => {
		const { avatarService, db } = await setupWithData();
		await avatarService.checkAndUnlockItems(1, 'test-tenant'); // 無料アイテム付与
		seedPointBalance(db, 1, 500);

		const sakura = (await avatarService.getShopItems(1, 'test-tenant')).find(
			(i) => i.code === 'bg_sakura',
		);
		await avatarService.purchaseItem(1, sakura?.id, 'test-tenant');

		const result = await avatarService.equipItem(1, 'background', sakura?.id, 'test-tenant');
		expect(result).toEqual({ success: true });

		const config = await avatarService.getAvatarConfig(1, 'test-tenant');
		expect(config.bgCss).toContain('#fce4ec');
	});

	it('未所持アイテムは装備不可', async () => {
		const { avatarService } = await setupWithData();
		const sakura = (await avatarService.getShopItems(1, 'test-tenant')).find(
			(i) => i.code === 'bg_sakura',
		);
		const result = await avatarService.equipItem(1, 'background', sakura?.id, 'test-tenant');
		expect(result).toEqual({ error: 'NOT_OWNED' });
	});

	it('nullで装備解除（デフォルトに戻る）', async () => {
		const { avatarService } = await setupWithData();
		const result = await avatarService.equipItem(1, 'background', null, 'test-tenant');
		expect(result).toEqual({ success: true });

		const config = await avatarService.getAvatarConfig(1, 'test-tenant');
		expect(config.bgCss).toBe('#ffffff');
	});
});

describe('getAvatarConfig', () => {
	it('未装備時はデフォルト値を返す', async () => {
		const { avatarService } = await setupWithData();
		const config = await avatarService.getAvatarConfig(1, 'test-tenant');
		expect(config.bgCss).toBe('#ffffff');
		expect(config.frameCss).toBe('2px solid #bdbdbd');
		expect(config.effectClass).toBe('');
	});
});

describe('checkAndUnlockItems', () => {
	it('無料アイテムを自動付与する', async () => {
		const { avatarService } = await setupWithData();
		await avatarService.checkAndUnlockItems(1, 'test-tenant');

		const items = await avatarService.getShopItems(1, 'test-tenant');
		const freeItems = items.filter((i) => i.unlockType === 'free');
		expect(freeItems.length).toBeGreaterThan(0);
		expect(freeItems.every((i) => i.owned)).toBe(true);
	});
});

// ヘルパー
async function setupWithData() {
	const { db } = testDbInstance;
	seedTestData(db);
	seedStatuses(db, 1);
	seedAvatarItems(db);

	const avatarService = await import('$lib/server/services/avatar-service');
	return { avatarService, db };
}
