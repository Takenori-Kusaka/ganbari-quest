import { describe, expect, it } from 'vitest';
import { executeBattle, scaleEnemyStats } from '$lib/domain/battle-engine';
import type { BattleStats } from '$lib/domain/battle-types';

/** テスト用の固定乱数生成器 */
function createFixedRandom(values: number[]): () => number {
	let index = 0;
	return () => {
		const value = values[index % values.length] ?? 0.5;
		index++;
		return value;
	};
}

/** 標準的なプレイヤーステータス（ある程度活動した状態） */
const ACTIVE_PLAYER: BattleStats = {
	hp: 80,
	atk: 25,
	def: 15,
	spd: 20,
	rec: 10,
};

/** 活動ゼロのプレイヤー（BASE_STATS のみ） */
const INACTIVE_PLAYER: BattleStats = {
	hp: 50,
	atk: 10,
	def: 8,
	spd: 10,
	rec: 5,
};

/** 弱い敵 */
const WEAK_ENEMY: BattleStats = {
	hp: 40,
	atk: 8,
	def: 5,
	spd: 6,
	rec: 2,
};

/** 強い敵 */
const STRONG_ENEMY: BattleStats = {
	hp: 150,
	atk: 25,
	def: 18,
	spd: 12,
	rec: 8,
};

describe('executeBattle', () => {
	it('バトル結果が正しい構造を持つ', () => {
		const result = executeBattle(ACTIVE_PLAYER, WEAK_ENEMY, {
			random: createFixedRandom([0.5]),
		});
		expect(result).toHaveProperty('outcome');
		expect(result).toHaveProperty('turns');
		expect(result).toHaveProperty('totalTurns');
		expect(result).toHaveProperty('rewardPoints');
		expect(result).toHaveProperty('playerFinalHp');
		expect(result).toHaveProperty('enemyFinalHp');
		expect(['win', 'lose']).toContain(result.outcome);
		expect(result.totalTurns).toBeGreaterThanOrEqual(1);
		expect(result.totalTurns).toBeLessThanOrEqual(5);
	});

	it('ターンログが正しい構造を持つ', () => {
		const result = executeBattle(ACTIVE_PLAYER, WEAK_ENEMY, {
			random: createFixedRandom([0.5]),
		});
		for (const turn of result.turns) {
			expect(turn).toHaveProperty('turn');
			expect(turn).toHaveProperty('firstAttacker');
			expect(turn).toHaveProperty('playerAction');
			expect(turn).toHaveProperty('enemyAction');
			expect(turn).toHaveProperty('playerHpAfter');
			expect(turn).toHaveProperty('enemyHpAfter');
			expect(['player', 'enemy']).toContain(turn.firstAttacker);
			expect(turn.playerHpAfter).toBeGreaterThanOrEqual(0);
			expect(turn.enemyHpAfter).toBeGreaterThanOrEqual(0);
		}
	});

	it('活動したプレイヤーは弱い敵に勝てる', () => {
		// 固定乱数で安定した結果
		const result = executeBattle(ACTIVE_PLAYER, WEAK_ENEMY, {
			random: createFixedRandom([0.5, 0.5, 0.5]),
		});
		expect(result.outcome).toBe('win');
		expect(result.enemyFinalHp).toBe(0);
	});

	it('最大ターン数を超えない', () => {
		const result = executeBattle(ACTIVE_PLAYER, STRONG_ENEMY, {
			random: createFixedRandom([0.5]),
			maxTurns: 3,
		});
		expect(result.totalTurns).toBeLessThanOrEqual(3);
	});

	it('SPD が高い方が先攻する', () => {
		const fastPlayer: BattleStats = { ...ACTIVE_PLAYER, spd: 100 };
		const result = executeBattle(fastPlayer, WEAK_ENEMY, {
			random: createFixedRandom([0.5]),
		});
		// SPD 100 vs 6 → プレイヤー先攻
		expect(result.turns[0]?.firstAttacker).toBe('player');
	});

	it('SPD が低い方は後攻する', () => {
		const slowPlayer: BattleStats = { ...ACTIVE_PLAYER, spd: 1 };
		const result = executeBattle(slowPlayer, WEAK_ENEMY, {
			random: createFixedRandom([0.5]),
		});
		// SPD 1 vs 6 → 敵先攻
		expect(result.turns[0]?.firstAttacker).toBe('enemy');
	});

	it('SPD 同値は乱数で決まる', () => {
		const sameSpd: BattleStats = { ...ACTIVE_PLAYER, spd: 6 };
		// random < 0.5 → player
		const result1 = executeBattle(sameSpd, WEAK_ENEMY, {
			random: createFixedRandom([0.3]),
		});
		expect(result1.turns[0]?.firstAttacker).toBe('player');

		// random >= 0.5 → enemy
		const result2 = executeBattle(sameSpd, WEAK_ENEMY, {
			random: createFixedRandom([0.7]),
		});
		expect(result2.turns[0]?.firstAttacker).toBe('enemy');
	});

	it('HP が 0 以下にならない', () => {
		const result = executeBattle(INACTIVE_PLAYER, STRONG_ENEMY, {
			random: createFixedRandom([0.5]),
		});
		expect(result.playerFinalHp).toBeGreaterThanOrEqual(0);
		expect(result.enemyFinalHp).toBeGreaterThanOrEqual(0);
	});

	it('rewardPoints は 0 で返る（サービス層で計算）', () => {
		const result = executeBattle(ACTIVE_PLAYER, WEAK_ENEMY, {
			random: createFixedRandom([0.5]),
		});
		expect(result.rewardPoints).toBe(0);
	});

	it('どちらかの HP が 0 になったらバトル終了', () => {
		// 非常に強いプレイヤーなら 1 ターンで倒せる
		const superPlayer: BattleStats = { hp: 999, atk: 999, def: 999, spd: 999, rec: 0 };
		const result = executeBattle(superPlayer, WEAK_ENEMY, {
			random: createFixedRandom([0.5, 0.5]),
		});
		expect(result.totalTurns).toBe(1);
		expect(result.outcome).toBe('win');
	});

	it('ターン切れは HP 割合で勝敗決定', () => {
		// 両者とも倒れない場合、HP 割合の高い方が勝ち
		const tankPlayer: BattleStats = { hp: 200, atk: 1, def: 50, spd: 10, rec: 0 };
		const tankEnemy: BattleStats = { hp: 200, atk: 1, def: 50, spd: 10, rec: 0 };
		const result = executeBattle(tankPlayer, tankEnemy, {
			random: createFixedRandom([0.5]),
			maxTurns: 2,
		});
		// 最低 1 ダメージしか通らないので HP 割合は両者ほぼ同じ
		expect(['win', 'lose']).toContain(result.outcome);
		expect(result.totalTurns).toBe(2);
	});
});

describe('scaleEnemyStats', () => {
	const baseStats: BattleStats = {
		hp: 100,
		atk: 20,
		def: 10,
		spd: 10,
		rec: 5,
	};

	it('スケーリング 1.0 はそのまま', () => {
		const scaled = scaleEnemyStats(baseStats, 1.0);
		expect(scaled).toEqual(baseStats);
	});

	it('スケーリング 0.5 で半減', () => {
		const scaled = scaleEnemyStats(baseStats, 0.5);
		expect(scaled).toEqual({
			hp: 50,
			atk: 10,
			def: 5,
			spd: 5,
			rec: 2,
		});
	});

	it('スケーリング 1.2 で 20% 増', () => {
		const scaled = scaleEnemyStats(baseStats, 1.2);
		expect(scaled).toEqual({
			hp: 120,
			atk: 24,
			def: 12,
			spd: 12,
			rec: 6,
		});
	});

	it('最低値が保証される（HP/ATK/DEF/SPD は 1 以上、REC は 0 以上）', () => {
		const scaled = scaleEnemyStats(baseStats, 0.001);
		expect(scaled.hp).toBeGreaterThanOrEqual(1);
		expect(scaled.atk).toBeGreaterThanOrEqual(1);
		expect(scaled.def).toBeGreaterThanOrEqual(1);
		expect(scaled.spd).toBeGreaterThanOrEqual(1);
		expect(scaled.rec).toBeGreaterThanOrEqual(0);
	});
});
