import { describe, expect, it } from 'vitest';
import { convertToBattleStats, getAgeScaling } from '$lib/domain/battle-stat-calculator';

describe('convertToBattleStats', () => {
	it('XP が 0 の場合は基礎値を返す', () => {
		const stats = convertToBattleStats({});
		expect(stats).toEqual({
			hp: 50,
			atk: 10,
			def: 8,
			spd: 10,
			rec: 5,
		});
	});

	it('カテゴリ XP をステータスに変換する', () => {
		const stats = convertToBattleStats({
			1: 100, // うんどう → HP
			2: 100, // べんきょう → ATK
		});
		// 100^0.6 ≈ 15.85 → floor = 15
		expect(stats.hp).toBe(50 + 15);
		expect(stats.atk).toBe(10 + 15);
		// 未指定カテゴリは基礎値
		expect(stats.def).toBe(8);
		expect(stats.spd).toBe(10);
		expect(stats.rec).toBe(5);
	});

	it('大量 XP でもインフレしすぎない（5000 XP → +168）', () => {
		const stats = convertToBattleStats({ 1: 5000 });
		expect(stats.hp).toBe(50 + Math.floor(5000 ** 0.6));
		expect(stats.hp).toBeLessThan(300);
	});

	it('負の XP は基礎値を返す', () => {
		const stats = convertToBattleStats({ 1: -50 });
		expect(stats.hp).toBe(50);
	});

	it('全カテゴリに XP がある場合', () => {
		const stats = convertToBattleStats({
			1: 200, // HP
			2: 300, // ATK
			3: 150, // SPD
			4: 250, // DEF
			5: 100, // REC
		});
		expect(stats.hp).toBe(50 + Math.floor(200 ** 0.6));
		expect(stats.atk).toBe(10 + Math.floor(300 ** 0.6));
		expect(stats.spd).toBe(10 + Math.floor(150 ** 0.6));
		expect(stats.def).toBe(8 + Math.floor(250 ** 0.6));
		expect(stats.rec).toBe(5 + Math.floor(100 ** 0.6));
	});

	it('未知のカテゴリ ID は無視される', () => {
		const stats = convertToBattleStats({ 99: 1000 });
		expect(stats).toEqual({
			hp: 50,
			atk: 10,
			def: 8,
			spd: 10,
			rec: 5,
		});
	});
});

describe('getAgeScaling', () => {
	it('baby → 0.3', () => {
		expect(getAgeScaling('baby')).toBe(0.3);
	});

	it('preschool → 0.5', () => {
		expect(getAgeScaling('preschool')).toBe(0.5);
	});

	it('elementary → 0.8', () => {
		expect(getAgeScaling('elementary')).toBe(0.8);
	});

	it('junior → 1.0', () => {
		expect(getAgeScaling('junior')).toBe(1.0);
	});

	it('senior → 1.2', () => {
		expect(getAgeScaling('senior')).toBe(1.2);
	});

	it('不明なモードは 1.0', () => {
		expect(getAgeScaling('unknown')).toBe(1.0);
	});
});
