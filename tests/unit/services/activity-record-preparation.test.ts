// tests/unit/services/activity-record-preparation.test.ts
// #4916: buildPointBreakdown() の純粋関数テスト。
// 記録結果ダイアログ / 履歴の内訳表示 SSOT。各 kind の itemize ルールと、
// 「items の合計 === totalPoints」不変条件を固定する。

import { describe, expect, it } from 'vitest';
import { asCategoryId } from '$lib/domain/ids';
import { buildPointBreakdown } from '../../../src/lib/server/services/activity-record-preparation';

/** buildPointBreakdown が必要とする PreparedActivityRecord の部分集合を組み立てる helper。 */
function makePrep(
	overrides: Partial<{
		isMainQuest: boolean;
		effectiveBasePoints: number;
		defaultStreakBonus: number;
		masteryBonus: number;
		bonusHookHits: {
			presetId: string;
			ruleTitle: string;
			bonusPoints: number;
			multiplier: number;
		}[];
	}> = {},
) {
	return {
		activity: {
			id: 1,
			name: 'たいそう',
			categoryId: asCategoryId(1),
			icon: '🤸',
			basePoints: 5,
			isMainQuest: overrides.isMainQuest ? 1 : 0,
			isArchived: 0,
			archivedReason: null,
			dailyLimit: null,
			sortOrder: 0,
			source: 'seed',
			nameKana: null,
			nameKanji: null,
			triggerHint: null,
			priority: 'optional' as const,
			createdAt: '2026-01-01T00:00:00Z',
		},
		effectiveBasePoints: overrides.effectiveBasePoints ?? 5,
		defaultStreakBonus: overrides.defaultStreakBonus ?? 0,
		bonusHookHits: overrides.bonusHookHits ?? [],
		masteryBonus: overrides.masteryBonus ?? 0,
		// biome-ignore lint/suspicious/noExplicitAny: buildPointBreakdown は Pick<> で必要 field のみ参照する
	} as any;
}

describe('buildPointBreakdown (#4916)', () => {
	it('ボーナスなしの単純記録は base のみを返す', () => {
		const items = buildPointBreakdown(makePrep());
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ kind: 'base', points: 5 });
		expect(items[0]?.multipliers).toBeUndefined();
	});

	it('メインクエスト (×2) は base の multipliers に mainQuest tag が乗る', () => {
		const items = buildPointBreakdown(makePrep({ isMainQuest: true, effectiveBasePoints: 10 }));
		const base = items.find((i) => i.kind === 'base');
		expect(base?.points).toBe(10);
		expect(base?.multipliers).toEqual([{ kind: 'mainQuest' }]);
	});

	it('bonusPoints=0 の倍率 hit (weekend 2倍等) は base の multipliers に乗り、独立行にならない', () => {
		const items = buildPointBreakdown(
			makePrep({
				effectiveBasePoints: 10,
				bonusHookHits: [
					{
						presetId: 'weekend-special',
						ruleTitle: 'しゅうまつ2ばいボーナス',
						bonusPoints: 0,
						multiplier: 2,
					},
				],
			}),
		);
		expect(items).toHaveLength(1); // base 行のみ (multiplier-only hit は独立 item にならない)
		const base = items[0];
		expect(base?.kind).toBe('base');
		expect(base?.multipliers).toEqual([
			{ kind: 'bonusHook', title: 'しゅうまつ2ばいボーナス', multiplier: 2 },
		]);
	});

	it('defaultStreakBonus > 0 は streakDefault item として itemize される', () => {
		const items = buildPointBreakdown(makePrep({ defaultStreakBonus: 4 }));
		const streak = items.find((i) => i.kind === 'streakDefault');
		expect(streak?.points).toBe(4);
	});

	it('defaultStreakBonus = 0 は streakDefault item を出さない', () => {
		const items = buildPointBreakdown(makePrep({ defaultStreakBonus: 0 }));
		expect(items.find((i) => i.kind === 'streakDefault')).toBeUndefined();
	});

	it('bonusPoints > 0 の hit は個別の bonusHook item として全件 itemize される (#4916 の core AC)', () => {
		const items = buildPointBreakdown(
			makePrep({
				bonusHookHits: [
					{
						presetId: 'category-challenge',
						ruleTitle: '3カテゴリチャレンジ',
						bonusPoints: 15,
						multiplier: 1,
					},
					{ presetId: 'early-bird', ruleTitle: 'はやおきボーナス', bonusPoints: 5, multiplier: 1 },
				],
			}),
		);
		const hooks = items.filter((i) => i.kind === 'bonusHook');
		expect(hooks).toHaveLength(2);
		expect(hooks.map((h) => [h.title, h.points])).toEqual([
			['3カテゴリチャレンジ', 15],
			['はやおきボーナス', 5],
		]);
	});

	it('masteryBonus > 0 は mastery item として itemize される', () => {
		const items = buildPointBreakdown(makePrep({ masteryBonus: 2 }));
		expect(items.find((i) => i.kind === 'mastery')?.points).toBe(2);
	});

	it('全種同時発火時、items の合計は effectiveBasePoints + defaultStreakBonus + hook合計 + masteryBonus と一致する (totalPoints 不変条件)', () => {
		const items = buildPointBreakdown(
			makePrep({
				isMainQuest: true,
				effectiveBasePoints: 20,
				defaultStreakBonus: 3,
				masteryBonus: 2,
				bonusHookHits: [
					{
						presetId: 'weekend-special',
						ruleTitle: 'しゅうまつ2ばいボーナス',
						bonusPoints: 0,
						multiplier: 2,
					},
					{
						presetId: 'category-challenge',
						ruleTitle: '3カテゴリチャレンジ',
						bonusPoints: 15,
						multiplier: 1,
					},
				],
			}),
		);
		const sum = items.reduce((acc, i) => acc + i.points, 0);
		expect(sum).toBe(20 + 3 + 15 + 2); // = totalPoints (activity-log-service.recordActivity と同じ式)
	});
});
