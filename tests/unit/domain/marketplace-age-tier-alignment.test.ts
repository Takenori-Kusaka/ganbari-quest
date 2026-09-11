/**
 * tests/unit/domain/marketplace-age-tier-alignment.test.ts
 *
 * #4695: 公式テンプレート (activity-pack / reward-set) の name に含まれる年齢帯語と
 * targetAgeMin / targetAgeMax が、アプリの年齢帯 SSOT (`AGE_TIER_CONFIG`、DESIGN.md §8:
 * 幼児 3-5 / 小学生 6-12 / 中学生 13-15 / 高校生 16-18) と整合していることを固定する
 * fitness function。
 *
 * 背景: 「中学生チャレンジ」が 10〜12 歳、「高校生」が 13〜18 歳、「しょうがくせい」が 6〜9 歳で、
 * `/marketplace?age=junior` (13-15) や年齢自動フィルタで「中学生」テンプレが消える /
 * gender variant (13-15) と矛盾して 3 枚並ぶ状態だった。
 *
 * ルール:
 *   1. name に年齢帯語 (ようじ / 幼児 / 小学生 / 中学生 / 高校生) を含む item は、
 *      targetAge が対応する年齢帯とちょうど一致する (qualifier なしの name は band と同値)
 *   2. 表記は type 内で揃える: 漢字の年齢帯語 (小学生 / 中学生 / 高校生) が 1 件でもあれば
 *      同じ年齢帯をひらがな (しょうがくせい / ちゅうがくせい / こうこうせい) で書かない
 *   3. activity-pack は per-activity ageMin / ageMax も pack の targetAge 内に収まる
 *   4. description の「N〜M歳」表記は targetAge と一致する
 */

import { describe, expect, it } from 'vitest';
import { getMarketplaceIndex, getMarketplaceItem } from '$lib/data/marketplace';
import type { ActivityPackPayload } from '$lib/domain/marketplace-item';
import { AGE_TIER_CONFIG } from '$lib/domain/validation/age-tier';

/** name に含まれる年齢帯語 → UiMode (SSOT の band に写像する) */
const AGE_WORD_TO_TIER: Array<{ words: string[]; tier: keyof typeof AGE_TIER_CONFIG }> = [
	{ words: ['ようじ', '幼児'], tier: 'preschool' },
	{ words: ['小学生', 'しょうがくせい'], tier: 'elementary' },
	{ words: ['中学生', 'ちゅうがくせい'], tier: 'junior' },
	{ words: ['高校生', 'こうこうせい'], tier: 'senior' },
];

const HIRAGANA_VARIANTS: Array<{ kanji: string; hiragana: string }> = [
	{ kanji: '小学生', hiragana: 'しょうがくせい' },
	{ kanji: '中学生', hiragana: 'ちゅうがくせい' },
	{ kanji: '高校生', hiragana: 'こうこうせい' },
];

const TARGET_TYPES = ['activity-pack', 'reward-set'] as const;

function itemsOf(type: (typeof TARGET_TYPES)[number]) {
	return getMarketplaceIndex().filter((i) => i.type === type);
}

describe('#4695 公式テンプレートの対象年齢 ⇄ 年齢帯 SSOT 整合', () => {
	for (const type of TARGET_TYPES) {
		describe(type, () => {
			const items = itemsOf(type);

			it('item が 1 件以上ある (fixture 読込の前提)', () => {
				expect(items.length).toBeGreaterThan(0);
			});

			for (const item of items) {
				const matched = AGE_WORD_TO_TIER.filter((m) => m.words.some((w) => item.name.includes(w)));
				if (matched.length === 0) continue;
				const tier = matched[0]?.tier;
				if (!tier) continue;
				const band = AGE_TIER_CONFIG[tier];

				it(`${item.itemId} (${item.name}) の targetAge は ${tier} (${band.ageMin}-${band.ageMax}) と一致する`, () => {
					expect(matched.length, 'name に複数の年齢帯語を含めない').toBe(1);
					expect({ min: item.targetAgeMin, max: item.targetAgeMax }).toEqual({
						min: band.ageMin,
						max: band.ageMax,
					});
				});

				it(`${item.itemId} の description の「N〜M歳」は targetAge と一致する`, () => {
					const m = item.description.match(/(\d+)〜(\d+)歳/);
					if (!m) return; // 年齢表記を持たない description は対象外
					expect({ min: Number(m[1]), max: Number(m[2]) }).toEqual({
						min: item.targetAgeMin,
						max: item.targetAgeMax,
					});
				});
			}

			it('年齢帯語の表記 (漢字 / ひらがな) が type 内で混在しない', () => {
				for (const { kanji, hiragana } of HIRAGANA_VARIANTS) {
					const hasKanji = items.some((i) => i.name.includes(kanji));
					const hasHiragana = items.some((i) => i.name.includes(hiragana));
					expect(
						hasKanji && hasHiragana,
						`${type}: 「${kanji}」と「${hiragana}」が name に混在`,
					).toBe(false);
				}
			});
		});
	}

	it('activity-pack の per-activity ageMin / ageMax は pack の targetAge 内に収まる', () => {
		for (const meta of itemsOf('activity-pack')) {
			const item = getMarketplaceItem('activity-pack', meta.itemId);
			expect(item).not.toBeNull();
			if (!item) continue;
			const payload = item.payload as ActivityPackPayload;
			for (const a of payload.activities) {
				if (a.ageMin != null) {
					expect(a.ageMin, `${meta.itemId} / ${a.name} ageMin`).toBeGreaterThanOrEqual(
						item.targetAgeMin,
					);
				}
				if (a.ageMax != null) {
					expect(a.ageMax, `${meta.itemId} / ${a.name} ageMax`).toBeLessThanOrEqual(
						item.targetAgeMax,
					);
				}
			}
		}
	});
});
