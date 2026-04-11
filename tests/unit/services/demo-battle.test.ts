import { describe, expect, it } from 'vitest';
import { getDemoBattleData } from '$lib/server/demo/demo-service';

describe('getDemoBattleData', () => {
	it('returns null battle for unknown childId', () => {
		const result = getDemoBattleData(0);
		expect(result.battle).toBeNull();
	});

	it('returns valid battle data for たろう (preschool)', () => {
		const result = getDemoBattleData(902);
		expect(result.battle).not.toBeNull();
		if (!result.battle) return;

		expect(result.battle.enemy).toBeDefined();
		expect(result.battle.enemy.id).toBeGreaterThan(0);
		expect(result.battle.enemy.name).not.toBe('');
		expect(result.battle.enemy.rarity).toMatch(/^(common|uncommon|rare|boss)$/);

		expect(result.battle.playerStats.hp).toBeGreaterThan(0);
		expect(result.battle.playerStats.atk).toBeGreaterThan(0);

		expect(result.battle.scaledEnemyMaxHp).toBeGreaterThan(0);
		expect(result.battle.completed).toBe(false);
		expect(result.battle.result).toBeNull();
	});

	it('returns scaled enemy HP based on age mode', () => {
		// baby (scaling 0.3) should have lower enemy HP than junior (scaling 1.0)
		const baby = getDemoBattleData(901);
		const junior = getDemoBattleData(904);

		expect(baby.battle).not.toBeNull();
		expect(junior.battle).not.toBeNull();
		if (!baby.battle || !junior.battle) return;

		// Same enemy selection (deterministic seed 0.5), so same base enemy
		// But scaling differs
		expect(baby.battle.scaledEnemyMaxHp).toBeLessThan(junior.battle.scaledEnemyMaxHp);
	});

	it('returns valid battle data for all demo children', () => {
		const childIds = [901, 902, 903, 905, 904];
		for (const id of childIds) {
			const result = getDemoBattleData(id);
			expect(result.battle).not.toBeNull();
			if (!result.battle) continue;
			expect(result.battle.playerStats.hp).toBeGreaterThan(0);
			expect(result.battle.enemy.name).not.toBe('');
		}
	});

	it('playerStats reflect category XP differences between children', () => {
		// はなこ (baby, low XP) vs じろう (junior, high XP)
		const baby = getDemoBattleData(901);
		const junior = getDemoBattleData(904);

		expect(baby.battle).not.toBeNull();
		expect(junior.battle).not.toBeNull();
		if (!baby.battle || !junior.battle) return;

		// じろう has much higher XP, so stats should be higher
		expect(junior.battle.playerStats.atk).toBeGreaterThan(baby.battle.playerStats.atk);
	});
});
