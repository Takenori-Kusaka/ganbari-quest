// tests/unit/server/db/demo/battle-repo.test.ts
// #2097 Phase B-5b + battle fixture: 日次バトル fixture が読み出せること、
// /demo/lower/battle 等の RPG バトル画面が demo 環境で稼働できることを検証。

import { describe, expect, it } from 'vitest';
import * as battleRepo from '../../../../../src/lib/server/db/demo/battle-repo';
import { DEMO_BATTLES, TODAY } from '../../../../../src/lib/server/demo/demo-data';

describe('demo/battle-repo (Phase B-5b)', () => {
	it('DEMO_BATTLES fixture は battle UI 対象 (903/904/906) で 5 件以上', () => {
		const battleTargetChildren = [903, 904, 906];
		for (const childId of battleTargetChildren) {
			const childBattles = DEMO_BATTLES.filter((b) => b.childId === childId);
			expect(childBattles.length).toBeGreaterThanOrEqual(5);
		}
	});

	it('findTodayBattle は 903 (elementary) で pending battle を返す', async () => {
		const battle = await battleRepo.findTodayBattle(903, TODAY, 'demo');
		expect(battle).toBeDefined();
		expect(battle?.childId).toBe(903);
		expect(battle?.date).toBe(TODAY);
		expect(battle?.status).toBe('pending');
	});

	it('findTodayBattle は 904 (junior) で当日 active battle を返す', async () => {
		const battle = await battleRepo.findTodayBattle(904, TODAY, 'demo');
		expect(battle).toBeDefined();
		expect(battle?.status).toBe('pending');
	});

	it('findTodayBattle は 906 (senior) で当日 active battle を返す', async () => {
		const battle = await battleRepo.findTodayBattle(906, TODAY, 'demo');
		expect(battle).toBeDefined();
		expect(battle?.status).toBe('pending');
	});

	it('findTodayBattle は battle 対象外 child (902 preschool) で undefined', async () => {
		expect(await battleRepo.findTodayBattle(902, TODAY, 'demo')).toBeUndefined();
	});

	it('findTodayBattle は別日付で undefined', async () => {
		expect(await battleRepo.findTodayBattle(903, '2099-01-01', 'demo')).toBeUndefined();
	});

	it('findRecentBattles は 903 で limit 件分を新しい順に返す', async () => {
		const battles = await battleRepo.findRecentBattles(903, 5, 'demo');
		expect(battles.length).toBe(5);
		expect(battles.every((b) => b.childId === 903)).toBe(true);
		// date DESC 順
		for (let i = 0; i < battles.length - 1; i++) {
			const current = battles[i];
			const next = battles[i + 1];
			if (current && next) {
				expect(current.date >= next.date).toBe(true);
			}
		}
	});

	it('findRecentBattles は 904 で過去 + 当日合計 5 件以上', async () => {
		const battles = await battleRepo.findRecentBattles(904, 10, 'demo');
		expect(battles.length).toBeGreaterThanOrEqual(5);
	});

	it('findRecentBattles は battle 対象外 child (902) で空配列', async () => {
		const battles = await battleRepo.findRecentBattles(902, 5, 'demo');
		expect(battles).toEqual([]);
	});

	it('insertDailyBattle は 0 を返す (stub、fixture immutable)', async () => {
		const before = DEMO_BATTLES.length;
		const id = await battleRepo.insertDailyBattle(
			903,
			1,
			TODAY,
			{ hp: 100, atk: 30, def: 20, spd: 25, rec: 15 },
			'demo',
		);
		expect(id).toBe(0);
		// ADR-0048 §決定 §2: fixture immutable
		expect(DEMO_BATTLES.length).toBe(before);
	});

	it('completeBattle / upsertCollectionEntry は no-op で例外を投げない', async () => {
		await expect(battleRepo.completeBattle(1, 'win', 20, 5, 'demo')).resolves.toBeUndefined();
		await expect(battleRepo.upsertCollectionEntry(903, 1, 'demo')).resolves.toBeUndefined();
	});

	it('countConsecutiveLosses は 0 (集計 stub)', async () => {
		expect(await battleRepo.countConsecutiveLosses(903, 'demo')).toBe(0);
	});
});
