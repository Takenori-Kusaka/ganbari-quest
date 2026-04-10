import { describe, expect, it } from 'vitest';
import {
	ENEMIES,
	getAvailableEnemies,
	getEnemyById,
	selectDailyEnemy,
} from '$lib/domain/battle-enemies';

describe('ENEMIES マスタデータ', () => {
	it('12 体以上の敵が定義されている', () => {
		expect(ENEMIES.length).toBeGreaterThanOrEqual(12);
	});

	it('全敵が必須プロパティを持つ', () => {
		for (const enemy of ENEMIES) {
			expect(enemy.id).toBeGreaterThan(0);
			expect(enemy.name).toBeTruthy();
			expect(enemy.icon).toBeTruthy();
			expect(enemy.image).toMatch(/^\/assets\/battle\/enemies\//);
			expect(['common', 'uncommon', 'rare', 'boss']).toContain(enemy.rarity);
			expect(enemy.stats.hp).toBeGreaterThan(0);
			expect(enemy.stats.atk).toBeGreaterThan(0);
			expect(enemy.dropPoints).toBeGreaterThan(0);
			expect(enemy.consolationPoints).toBeGreaterThan(0);
			expect(Array.isArray(enemy.availableDays)).toBe(true);
		}
	});

	it('ID が一意である', () => {
		const ids = ENEMIES.map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('4 つのレアリティが含まれている', () => {
		const rarities = new Set(ENEMIES.map((e) => e.rarity));
		expect(rarities).toContain('common');
		expect(rarities).toContain('uncommon');
		expect(rarities).toContain('rare');
		expect(rarities).toContain('boss');
	});
});

describe('getEnemyById', () => {
	it('存在する ID で敵を取得', () => {
		const enemy = getEnemyById(1);
		expect(enemy).toBeDefined();
		expect(enemy?.name).toBe('スライム');
	});

	it('存在しない ID は undefined', () => {
		expect(getEnemyById(999)).toBeUndefined();
	});
});

describe('getAvailableEnemies', () => {
	it('毎日出現する敵は全曜日で取得できる', () => {
		for (let day = 0; day <= 6; day++) {
			const available = getAvailableEnemies(day);
			const commonAlways = available.filter(
				(e) => e.rarity === 'common' && e.availableDays.length === 0,
			);
			expect(commonAlways.length).toBeGreaterThan(0);
		}
	});

	it('日曜限定の敵は日曜のみ出現', () => {
		const sundayEnemies = getAvailableEnemies(0);
		const mondayEnemies = getAvailableEnemies(1);

		// まおうのかげ（日曜限定）は日曜に出現
		const bossOnSunday = sundayEnemies.find((e) => e.name === 'まおうのかげ');
		expect(bossOnSunday).toBeDefined();

		// 月曜には出現しない
		const bossOnMonday = mondayEnemies.find((e) => e.name === 'まおうのかげ');
		expect(bossOnMonday).toBeUndefined();
	});

	it('全曜日で最低 1 体は出現する', () => {
		for (let day = 0; day <= 6; day++) {
			const available = getAvailableEnemies(day);
			expect(available.length).toBeGreaterThan(0);
		}
	});
});

describe('selectDailyEnemy', () => {
	it('有効な敵を返す', () => {
		const enemy = selectDailyEnemy(1, 0.5);
		expect(enemy).toBeDefined();
		expect(enemy.id).toBeGreaterThan(0);
	});

	it('乱数 0 で最初の候補を返す', () => {
		const enemy = selectDailyEnemy(1, 0);
		expect(enemy).toBeDefined();
	});

	it('乱数 0.99 でも有効な敵を返す', () => {
		const enemy = selectDailyEnemy(1, 0.99);
		expect(enemy).toBeDefined();
	});

	it('2 連敗時は common の敵のみ選出（天井）', () => {
		// 100 回試行して全て common であることを確認
		for (let i = 0; i < 100; i++) {
			const enemy = selectDailyEnemy(0, Math.random(), 2);
			expect(enemy.rarity).toBe('common');
		}
	});

	it('3 連敗以上でも天井が適用される', () => {
		const enemy = selectDailyEnemy(1, 0.5, 5);
		expect(enemy.rarity).toBe('common');
	});

	it('0 連敗ではレアリティ制限なし', () => {
		// 乱数を高くして uncommon 以上を引く可能性を確認
		// （重みの構成上、common 以外も出現しうる）
		let hasNonCommon = false;
		for (let i = 0; i < 200; i++) {
			const enemy = selectDailyEnemy(0, i / 200, 0);
			if (enemy.rarity !== 'common') {
				hasNonCommon = true;
				break;
			}
		}
		expect(hasNonCommon).toBe(true);
	});

	it('曜日によって出現する敵が変わる', () => {
		// 日曜（boss あり）と月曜（boss なし）で出現候補が異なる
		const sundayPool = new Set<number>();
		const mondayPool = new Set<number>();

		for (let i = 0; i < 200; i++) {
			sundayPool.add(selectDailyEnemy(0, i / 200).id);
			mondayPool.add(selectDailyEnemy(1, i / 200).id);
		}

		// 日曜限定の敵（まおうのかげ id=11）
		expect(sundayPool.has(11)).toBe(true);
		expect(mondayPool.has(11)).toBe(false);
	});
});
