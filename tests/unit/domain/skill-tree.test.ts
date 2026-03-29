// tests/unit/domain/skill-tree.test.ts
// パッシブスキルツリー ドメイン計算のユニットテスト

import { describe, expect, it } from 'vitest';
import {
	SKILL_NODE_MASTERS,
	calcComboMultiplier,
	calcLoginBonusAddition,
	calcPointBonus,
	calcXpMultiplier,
	canUnlockNode,
	hasStreakShield,
	isBalanceNodeUnlockable,
} from '../../../src/lib/domain/validation/skill-tree';
import type { SkillNode } from '../../../src/lib/server/db/types';

// ヘルパー: マスタデータからSkillNodeを生成
function makeNode(overrides: Partial<SkillNode> & { id: number }): SkillNode {
	const master = SKILL_NODE_MASTERS.find((n) => n.id === overrides.id);
	return {
		targetModes: '["lower","upper","teen"]',
		...(master ?? {
			id: overrides.id,
			categoryId: null,
			name: 'test',
			description: null,
			icon: '🔧',
			sortOrder: 0,
			spCost: 1,
			requiredNodeId: null,
			requiredCategoryLevel: 0,
			effectType: 'xp_multiplier',
			effectValue: 0,
		}),
		...overrides,
	};
}

describe('SKILL_NODE_MASTERS', () => {
	it('16ノードが定義されている', () => {
		expect(SKILL_NODE_MASTERS).toHaveLength(16);
	});

	it('IDが1〜16で一意', () => {
		const ids = SKILL_NODE_MASTERS.map((n) => n.id);
		expect(new Set(ids).size).toBe(16);
		expect(Math.min(...ids)).toBe(1);
		expect(Math.max(...ids)).toBe(16);
	});

	it('5カテゴリ×3ノード + 1バランスノード', () => {
		const byCategory = new Map<number | null, number>();
		for (const node of SKILL_NODE_MASTERS) {
			byCategory.set(node.categoryId, (byCategory.get(node.categoryId) ?? 0) + 1);
		}
		expect(byCategory.get(1)).toBe(3); // うんどう
		expect(byCategory.get(2)).toBe(3); // べんきょう
		expect(byCategory.get(3)).toBe(3); // せいかつ
		expect(byCategory.get(4)).toBe(3); // こうりゅう
		expect(byCategory.get(5)).toBe(3); // そうぞう
		expect(byCategory.get(null)).toBe(1); // バランス
	});

	it('バランスノードのSPコストは0', () => {
		const balance = SKILL_NODE_MASTERS.find((n) => n.categoryId === null);
		expect(balance?.spCost).toBe(0);
	});
});

describe('calcXpMultiplier', () => {
	it('ノード未解放では倍率1.0', () => {
		expect(calcXpMultiplier(1, [])).toBe(1);
	});

	it('うんどうブースト(+10%)で1.1倍', () => {
		const nodes = [makeNode({ id: 1 })];
		expect(calcXpMultiplier(1, nodes)).toBeCloseTo(1.1);
	});

	it('うんどうブースト+アスリート魂(+10%+XP無関係)でも1.1倍（streak_shieldはXPに影響なし）', () => {
		const nodes = [makeNode({ id: 1 }), makeNode({ id: 3 })];
		expect(calcXpMultiplier(1, nodes)).toBeCloseTo(1.1);
	});

	it('べんきょう全解放: +10% + +25% = 1.35倍', () => {
		const nodes = [makeNode({ id: 4 }), makeNode({ id: 5 }), makeNode({ id: 6 })];
		expect(calcXpMultiplier(2, nodes)).toBeCloseTo(1.35);
	});

	it('global_xp_multiplierは全カテゴリに適用', () => {
		const nodes = [makeNode({ id: 9 })]; // にちじょうのたつじん +5%
		expect(calcXpMultiplier(1, nodes)).toBeCloseTo(1.05);
		expect(calcXpMultiplier(2, nodes)).toBeCloseTo(1.05);
		expect(calcXpMultiplier(5, nodes)).toBeCloseTo(1.05);
	});

	it('カテゴリ別+グローバルの複合', () => {
		const nodes = [makeNode({ id: 1 }), makeNode({ id: 9 })]; // うんどう+10% + グローバル+5%
		expect(calcXpMultiplier(1, nodes)).toBeCloseTo(1.15); // 10% + 5%
		expect(calcXpMultiplier(2, nodes)).toBeCloseTo(1.05); // グローバル5%のみ
	});
});

describe('calcPointBonus', () => {
	it('ノード未解放では0', () => {
		expect(calcPointBonus(1, [])).toBe(0);
	});

	it('きたえろ(+1pt)で1', () => {
		const nodes = [makeNode({ id: 2 })];
		expect(calcPointBonus(1, nodes)).toBe(1);
	});

	it('べんきょうのしゅうちゅうりょくアップ(+2pt)で2', () => {
		const nodes = [makeNode({ id: 5 })];
		expect(calcPointBonus(2, nodes)).toBe(2);
	});

	it('異なるカテゴリのpoint_bonusは影響しない', () => {
		const nodes = [makeNode({ id: 2 })]; // うんどうの+1pt
		expect(calcPointBonus(2, nodes)).toBe(0); // べんきょうには影響なし
	});
});

describe('hasStreakShield', () => {
	it('未解放ではfalse', () => {
		expect(hasStreakShield([])).toBe(false);
	});

	it('アスリートのたましい解放でtrue', () => {
		const nodes = [makeNode({ id: 3 })];
		expect(hasStreakShield(nodes)).toBe(true);
	});
});

describe('calcComboMultiplier', () => {
	it('未解放では1.0', () => {
		expect(calcComboMultiplier([])).toBe(1);
	});

	it('なかよしさん(+20%)で1.2', () => {
		const nodes = [makeNode({ id: 11 })];
		expect(calcComboMultiplier(nodes)).toBeCloseTo(1.2);
	});
});

describe('calcLoginBonusAddition', () => {
	it('未解放では0', () => {
		expect(calcLoginBonusAddition([])).toBe(0);
	});

	it('ログインボーナス+(+3)で3', () => {
		const nodes = [makeNode({ id: 8 })];
		expect(calcLoginBonusAddition(nodes)).toBe(3);
	});
});

describe('canUnlockNode', () => {
	const catLevels: Record<number, number> = { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3 };

	it('前提なし・SPあり・レベルOK→解放可能', () => {
		const node = makeNode({ id: 1 }); // requiredNodeId=null, spCost=1, requiredCategoryLevel=1
		const result = canUnlockNode(node, new Set(), 5, catLevels);
		expect(result.canUnlock).toBe(true);
	});

	it('既に解放済み→不可', () => {
		const node = makeNode({ id: 1 });
		const result = canUnlockNode(node, new Set([1]), 5, catLevels);
		expect(result.canUnlock).toBe(false);
		expect(result.reason).toBe('ALREADY_UNLOCKED');
	});

	it('前提ノード未解放→不可', () => {
		const node = makeNode({ id: 2 }); // requiredNodeId=1
		const result = canUnlockNode(node, new Set(), 5, catLevels);
		expect(result.canUnlock).toBe(false);
		expect(result.reason).toBe('PREREQUISITE_NOT_MET');
	});

	it('SP不足→不可', () => {
		const node = makeNode({ id: 1 }); // spCost=1
		const result = canUnlockNode(node, new Set(), 0, catLevels);
		expect(result.canUnlock).toBe(false);
		expect(result.reason).toBe('INSUFFICIENT_SP');
	});

	it('カテゴリレベル不足→不可', () => {
		const node = makeNode({ id: 2 }); // requiredCategoryLevel=2
		const lowLevels: Record<number, number> = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 };
		const result = canUnlockNode(node, new Set([1]), 5, lowLevels);
		expect(result.canUnlock).toBe(false);
		expect(result.reason).toBe('CATEGORY_LEVEL_NOT_MET');
	});

	it('バランスノード: 全カテゴリLv2以上で解放可能', () => {
		const node = makeNode({ id: 16 }); // categoryId=null, requiredCategoryLevel=2, spCost=0
		const lvAll2: Record<number, number> = { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2 };
		const result = canUnlockNode(node, new Set(), 0, lvAll2);
		expect(result.canUnlock).toBe(true);
	});

	it('バランスノード: カテゴリ1つがLv1→不可', () => {
		const node = makeNode({ id: 16 });
		const lvMixed: Record<number, number> = { 1: 2, 2: 2, 3: 1, 4: 2, 5: 2 };
		const result = canUnlockNode(node, new Set(), 0, lvMixed);
		expect(result.canUnlock).toBe(false);
		expect(result.reason).toBe('CATEGORY_LEVEL_NOT_MET');
	});
});

describe('isBalanceNodeUnlockable', () => {
	it('全カテゴリLv2以上→true', () => {
		expect(isBalanceNodeUnlockable({ 1: 2, 2: 2, 3: 2, 4: 2, 5: 2 }, 2)).toBe(true);
	});

	it('1カテゴリ欠落→false', () => {
		expect(isBalanceNodeUnlockable({ 1: 2, 2: 2, 3: 2, 4: 2 }, 2)).toBe(false);
	});

	it('1カテゴリLv1→false', () => {
		expect(isBalanceNodeUnlockable({ 1: 2, 2: 1, 3: 2, 4: 2, 5: 2 }, 2)).toBe(false);
	});

	it('全カテゴリLv3以上でrequiredLevel=2→true', () => {
		expect(isBalanceNodeUnlockable({ 1: 3, 2: 3, 3: 3, 4: 3, 5: 3 }, 2)).toBe(true);
	});
});
