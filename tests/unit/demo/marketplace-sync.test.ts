// tests/unit/demo/marketplace-sync.test.ts
// #2097 Phase B-7 M-2 (A-7 future-proofing): marketplace SSOT と demo seed の同期チェック。
//
// 目的:
//   新規 official marketplace pack 追加時に、demo seed (`demo-data.ts` の
//   ACTIVITY_PACKS_BY_CHILD / REWARD_SETS_BY_CHILD / CHECKLISTS_BY_CHILD)
//   への取込み判断を漏らさないようにする warn-level チェック。
//
// 運用:
//   - 新規 official pack 追加時、本テストの `KNOWN_DEMO_PACK_IDS` 集合を更新するか、
//     その pack を意図的に demo に含めない判断を comment で残す。
//   - 現状: warn (console.warn) で release blocker にしない (#2097 A-7 §5)。

import { describe, expect, it } from 'vitest';
import { getMarketplaceIndex } from '../../../src/lib/data/marketplace';

// 現在 demo seed に取り込まれている official pack ID 集合 (docs/research/2097-marketplace-default-import-spec.md §3)
const KNOWN_DEMO_PACK_IDS = new Set([
	// activity-packs
	'kinder-starter',
	'elementary-boy',
	'junior-girl',
	'senior-boy',
	// reward-sets
	'kinder-rewards',
	'elementary-rewards',
	'junior-rewards',
	'senior-rewards',
	// checklists
	'event-pool',
	'event-school-start',
]);

// 意図的に demo に含めない official pack (理由を comment で残す)
const INTENTIONALLY_EXCLUDED_PACK_IDS = new Set([
	// 性別バリアント (neutral starter で代表させているため): kinder-starter で代表、kinder-boy/girl/elementary-girl/elementary-challenge/junior-boy/junior-high-challenge/senior-girl/senior-high-challenge は重複表示を避けるため除外
	'kinder-boy',
	'kinder-girl',
	'elementary-girl',
	'elementary-challenge',
	'junior-boy',
	'junior-high-challenge',
	'senior-girl',
	'senior-high-challenge',
	// reward-sets: 年齢別 4 種で代表、補助 6 種 (toddler/experience/screen-time/creative/food/privilege) は除外
	'toddler-rewards',
	'experience-rewards',
	'screen-time-rewards',
	'creative-rewards',
	'food-rewards',
	'privilege-rewards',
	// checklists: 残り 1 種 (event-field-trip) は demo で過剰なので除外
	'event-field-trip',
	// rule-presets: demo では rule-preset を取り込まない (#2097 A-7 §3)
	'early-bird',
	'night-owl-pass',
	'self-study-reward',
	'screen-time-exchange',
	'streak-bonus',
	'weekend-special',
	'category-challenge',
	'chore-skip',
	'sibling-coop',
	'sleep-in-pass',
]);

describe('demo seed × marketplace sync (#2097 B-7 M-2)', () => {
	it('全 official pack が KNOWN_DEMO_PACK_IDS または INTENTIONALLY_EXCLUDED_PACK_IDS のいずれかに分類される', () => {
		const allOfficialPacks = getMarketplaceIndex().filter((m) => m.curator === 'official');
		const unclassified: string[] = [];
		for (const pack of allOfficialPacks) {
			if (KNOWN_DEMO_PACK_IDS.has(pack.itemId)) continue;
			if (INTENTIONALLY_EXCLUDED_PACK_IDS.has(pack.itemId)) continue;
			unclassified.push(`${pack.type}/${pack.itemId}`);
		}

		// warn-only: 新 pack 追加時のシグナルとして console.warn を出すが test は fail させない (#2097 A-7 §5)。
		// 旧実装は vi.spyOn で console.warn を no-op mock していたが、それでは A-7 §5 の
		// "CI ログにシグナルを残す" 目的に矛盾するため mock を撤廃 (Copilot [must] PR #2145)。
		// console.warn は実際に CI / test runner stdout に出力させる。
		if (unclassified.length > 0) {
			console.warn(
				`[marketplace-sync] 新 official pack が KNOWN_DEMO_PACK_IDS / INTENTIONALLY_EXCLUDED_PACK_IDS のどちらにも分類されていません: ${unclassified.join(', ')}\n` +
					`対応: tests/unit/demo/marketplace-sync.test.ts の集合を更新してください。`,
			);
		}

		// hard-fail にはしない (#2097 A-7 §5)。集合の自己整合性のみ assert
		expect(KNOWN_DEMO_PACK_IDS.size + INTENTIONALLY_EXCLUDED_PACK_IDS.size).toBeGreaterThanOrEqual(
			allOfficialPacks.length - 5, // 5 件以内の未分類は許容
		);
	});

	it('KNOWN_DEMO_PACK_IDS の全 pack が marketplace に実在する', () => {
		const allPackIds = new Set(getMarketplaceIndex().map((m) => m.itemId));
		const missing: string[] = [];
		for (const id of KNOWN_DEMO_PACK_IDS) {
			if (!allPackIds.has(id)) {
				missing.push(id);
			}
		}
		expect(missing).toEqual([]);
	});
});
