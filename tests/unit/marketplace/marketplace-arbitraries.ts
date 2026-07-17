// tests/unit/marketplace/marketplace-arbitraries.ts
// #3847 (EPIC #3151): export/import round-trip の property-based 化に使う fast-check arbitrary 群。
//
// 設計原則 (ADR-0066 / ADR-0061 shift-left):
//   - **generator は値域 SSOT 定数から導出する**。各 domain validation file
//     (`$lib/domain/validation/{activity,special-reward,checklist,challenge-set,rule-preset}.ts`)
//     が export する `*_MIN` / `*_MAX` 定数 + picklist SSOT (CATEGORY_CODES / GRADE_LEVELS /
//     REWARD_CATEGORIES / SHOP_CATEGORIES / CATEGORY_NUMERIC_IDS / CHECKLIST_TIMINGS / RULE_TYPES)
//     を直接参照して値域を作る。literal 直書きは #3132 値域ドリフトの root class のため禁止。
//   - **Unicode-aware**: name / title / label / description は ASCII / ひらがな / 漢字 / 絵文字 /
//     ZWJ 連結絵文字 / 結合文字 (combining mark) を混ぜた grapheme token から組み、schema の
//     maxLength (UTF-16 code unit 基準) を厳守する。#3104 (日本語 / 絵文字の往復破損) を機械探索する。
//   - **canonical payload のみ生成**: 各 schema (`v.object`) は未知キーを strip し optional 欠落を
//     欠落のまま返すため、生成 payload は「schema が受理する既知キーのみ + optional は present/absent」
//     に限定する。これにより `parse(payload)` が identity になり `import(export(x)) == x` が成立する。
//
// icon は 5 type とも「1〜2 grapheme」判定 (isValid*Icon、#3151) に統一済のため単一 iconArb を共有する。
// 生成 icon の grapheme 数不変は `export-import-roundtrip-property.test.ts` の meta self-check で表明する。
//
// Unicode リテラルは editor 正規化 (NFC) や不可視文字混入に依存しないよう、combining / ZWJ / 絵文字は
// 全て `\u` escape で明示する (ZWJ = U+200D、variation selector = U+FE0F、skin tone = U+1F3FD)。

import * as fc from 'fast-check';
import { CATEGORY_NUMERIC_IDS } from '$lib/domain/categories';
import { SHOP_CATEGORIES } from '$lib/domain/shop-category';
import {
	ACTIVITY_AGE_MAX,
	ACTIVITY_AGE_MIN,
	ACTIVITY_BASE_POINTS_MAX,
	ACTIVITY_BASE_POINTS_MIN,
	ACTIVITY_DESCRIPTION_MAX,
	ACTIVITY_NAME_MAX,
	ACTIVITY_NAME_MIN,
	ACTIVITY_TRIGGER_HINT_MAX,
	CATEGORY_CODES,
	GRADE_LEVELS,
} from '$lib/domain/validation/activity';
import {
	CHALLENGE_BASE_TARGET_MAX,
	CHALLENGE_BASE_TARGET_MIN,
	CHALLENGE_DESCRIPTION_MAX,
	CHALLENGE_DESCRIPTION_MIN,
	CHALLENGE_DURATION_DAYS_MAX,
	CHALLENGE_DURATION_DAYS_MIN,
	CHALLENGE_REWARD_POINTS_MAX,
	CHALLENGE_REWARD_POINTS_MIN,
	CHALLENGE_TITLE_MAX,
	CHALLENGE_TITLE_MIN,
} from '$lib/domain/validation/challenge-set';
import {
	CHECKLIST_LABEL_MAX,
	CHECKLIST_LABEL_MIN,
	CHECKLIST_ORDER_MIN,
} from '$lib/domain/validation/checklist';
import {
	RULE_DESCRIPTION_MAX,
	RULE_DESCRIPTION_MIN,
	RULE_POINT_MAX,
	RULE_POINT_MIN,
	RULE_TITLE_MAX,
	RULE_TITLE_MIN,
} from '$lib/domain/validation/rule-preset';
import {
	REWARD_CATEGORIES,
	REWARD_DESCRIPTION_MAX,
	REWARD_POINTS_MAX,
	REWARD_POINTS_MIN,
	REWARD_TITLE_MAX,
	REWARD_TITLE_MIN,
} from '$lib/domain/validation/special-reward';
import { CHECKLIST_TIMINGS, type MarketplaceTypeId, RULE_TYPES } from '$lib/marketplace/schemas';

const ZWJ = '‍';

// ── Unicode-aware 文字列 arbitrary ─────────────────────────────────

/** 単一絵文字 (2 UTF-16 CU): U+1F3C3 走る人。 */
const EMOJI_RUN = '\u{1F3C3}';
/** ZWJ 連結家族絵文字 (11 UTF-16 CU、1 grapheme): man+woman+girl+boy。 */
const EMOJI_FAMILY = `\u{1F468}${ZWJ}\u{1F469}${ZWJ}\u{1F467}${ZWJ}\u{1F466}`;
/** 'e' + combining acute accent U+0301 (2 CU, 1 grapheme, decomposed)。 */
const COMBINING_E_ACUTE = 'é';
/** 'か' U+304B + combining voiced sound mark U+3099 (2 CU, 1 grapheme, decomposed)。 */
const COMBINING_KA_DAKUTEN = 'が';

/**
 * name / title / label / description 用の grapheme token。JSON 往復で壊れやすい代表を集める:
 * ASCII / ひらがな / 漢字 / 長音 / 全角空白 / 単一絵文字 (2 CU) / ZWJ 連結絵文字 (11 CU) /
 * 結合文字 sequence (base + combining mark = 2 CU)。いずれも complete な unit (lone surrogate /
 * lone combining mark 単独 は含めない) なので連結しても壊れず、`JSON.stringify` → `JSON.parse` で
 * 完全に復元される。
 */
export const TEXT_TOKENS: readonly string[] = [
	'a',
	'Z',
	'7',
	'あ', // あ
	'漢', // 漢
	'ぽ', // ぽ
	'ー', // ー (長音)
	'　', // 全角スペース
	EMOJI_RUN,
	EMOJI_FAMILY,
	COMBINING_E_ACUTE,
	COMBINING_KA_DAKUTEN,
];

/**
 * UTF-16 code unit 長が `[min, max]` に収まる Unicode-aware 文字列を生成する。
 * schema の minLength/maxLength は `String.prototype.length` (= UTF-16 CU) 基準のため、
 * `s.length` を積算して max を超える token を skip し、不足分は ASCII 1 文字で pad する。
 */
export function boundedText(min: number, max: number): fc.Arbitrary<string> {
	return fc
		.array(fc.constantFrom(...TEXT_TOKENS), { minLength: 1, maxLength: Math.max(max, 8) })
		.map((tokens) => {
			let s = '';
			for (const t of tokens) {
				if (s.length + t.length <= max) s += t;
			}
			while (s.length < min) s += 'a';
			return s;
		});
}

// ── icon arbitrary (1〜2 grapheme、5 type 共有) ────────────────────

/**
 * 連結しても各々が独立 grapheme に留まる complete emoji のみ (skin-tone / ZWJ family 含む)。
 * lone regional indicator / lone ZWJ / lone skin-tone modifier は grapheme 合流を起こすため除外。
 * 全て `\u` escape で editor 正規化・不可視文字混入に非依存にする。
 */
export const ICON_EMOJI: readonly string[] = [
	'\u{1F3C3}', // running
	'\u{1F4DA}', // books
	'\u{1F381}', // gift
	'\u{1F3AF}', // target
	'\u{1F4CB}', // clipboard
	'\u{1F366}', // soft ice cream
	'\u{1F3AC}', // clapper
	'\u{1FAA5}', // toothbrush
	'\u{1F455}', // t-shirt
	'\u{1F35A}', // cooked rice
	'✏️', // pencil (+ VS16)
	'\u{1F38E}', // dolls
	'\u{1F31F}', // glowing star
	'⚔️', // crossed swords (+ VS16)
	'\u{1F409}', // dragon
	'\u{1F984}', // unicorn
	'\u{1F36A}', // cookie
	'\u{1F3AE}', // video game
	'\u{1F60A}', // smiling
	'\u{1F44D}', // thumbs up
	'⭐', // star
	'❤️', // red heart (+ VS16)
	'\u{1F4AA}', // flexed biceps
	'\u{1F680}', // rocket
	'\u{1F451}', // crown
	'\u{1F3C6}', // trophy
	'\u{1F308}', // rainbow
	'☀️', // sun (+ VS16)
	`\u{1F468}${ZWJ}\u{1F469}${ZWJ}\u{1F467}${ZWJ}\u{1F466}`, // family (ZWJ, 1 grapheme)
	'\u{1F44D}\u{1F3FD}', // thumbs up + medium skin tone
	`\u{1F9D1}${ZWJ}\u{1F680}`, // astronaut (ZWJ)
];

/** 1〜2 個の complete emoji を連結した icon (isValid*Icon = 1〜2 grapheme を満たす)。 */
export const iconArb: fc.Arbitrary<string> = fc
	.array(fc.constantFrom(...ICON_EMOJI), { minLength: 1, maxLength: 2 })
	.map((parts) => parts.join(''));

// ── monthDay (challenge-set) ──────────────────────────────────────

/** 'MM-DD' (CHALLENGE_MONTH_DAY_REGEX: MM=01-12 / DD=01-31)。schema は regex のみ検証。 */
const monthDayArb: fc.Arbitrary<string> = fc
	.tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 31 }))
	.map(([m, d]) => `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

// ── item arbitrary (値域は全て SSOT 定数から導出) ──────────────────

const activityItemArb = fc.record(
	{
		name: boundedText(ACTIVITY_NAME_MIN, ACTIVITY_NAME_MAX),
		categoryCode: fc.constantFrom(...CATEGORY_CODES),
		icon: iconArb,
		basePoints: fc.integer({ min: ACTIVITY_BASE_POINTS_MIN, max: ACTIVITY_BASE_POINTS_MAX }),
		ageMin: fc.option(fc.integer({ min: ACTIVITY_AGE_MIN, max: ACTIVITY_AGE_MAX }), { nil: null }),
		ageMax: fc.option(fc.integer({ min: ACTIVITY_AGE_MIN, max: ACTIVITY_AGE_MAX }), { nil: null }),
		gradeLevel: fc.option(fc.constantFrom(...GRADE_LEVELS), { nil: null }),
		// optional 群 (present/absent を fast-check が探索し、absent は parse 出力の欠落と一致)
		triggerHint: boundedText(1, ACTIVITY_TRIGGER_HINT_MAX),
		description: boundedText(1, ACTIVITY_DESCRIPTION_MAX),
		mustDefault: fc.boolean(),
	},
	{
		requiredKeys: ['name', 'categoryCode', 'icon', 'basePoints', 'ageMin', 'ageMax', 'gradeLevel'],
	},
);

const rewardItemArb = fc.record(
	{
		title: boundedText(REWARD_TITLE_MIN, REWARD_TITLE_MAX),
		points: fc.integer({ min: REWARD_POINTS_MIN, max: REWARD_POINTS_MAX }),
		icon: iconArb,
		category: fc.constantFrom(...REWARD_CATEGORIES),
		description: boundedText(1, REWARD_DESCRIPTION_MAX),
		shopCategory: fc.constantFrom(...SHOP_CATEGORIES),
	},
	{ requiredKeys: ['title', 'points', 'icon', 'category'] },
);

const checklistItemArb = fc.record({
	label: boundedText(CHECKLIST_LABEL_MIN, CHECKLIST_LABEL_MAX),
	icon: iconArb,
	order: fc.integer({ min: CHECKLIST_ORDER_MIN, max: CHECKLIST_ORDER_MIN + 999 }),
});

const challengeItemArb = fc.record({
	title: boundedText(CHALLENGE_TITLE_MIN, CHALLENGE_TITLE_MAX),
	description: boundedText(CHALLENGE_DESCRIPTION_MIN, CHALLENGE_DESCRIPTION_MAX),
	monthDay: monthDayArb,
	durationDays: fc.integer({ min: CHALLENGE_DURATION_DAYS_MIN, max: CHALLENGE_DURATION_DAYS_MAX }),
	categoryId: fc.constantFrom(...CATEGORY_NUMERIC_IDS),
	baseTarget: fc.integer({ min: CHALLENGE_BASE_TARGET_MIN, max: CHALLENGE_BASE_TARGET_MAX }),
	rewardPoints: fc.integer({ min: CHALLENGE_REWARD_POINTS_MIN, max: CHALLENGE_REWARD_POINTS_MAX }),
	icon: iconArb,
});

const ruleItemArb = fc.record(
	{
		title: boundedText(RULE_TITLE_MIN, RULE_TITLE_MAX),
		description: boundedText(RULE_DESCRIPTION_MIN, RULE_DESCRIPTION_MAX),
		icon: iconArb,
		pointCost: fc.integer({ min: RULE_POINT_MIN, max: RULE_POINT_MAX }),
		pointBonus: fc.integer({ min: RULE_POINT_MIN, max: RULE_POINT_MAX }),
	},
	{ requiredKeys: ['title', 'description', 'icon'] },
);

// ── payload arbitrary (typeCode 別) ───────────────────────────────

const ITEM_ARRAY = { minLength: 1, maxLength: 4 } as const;

export const activityPackPayloadArb = fc.record({
	activities: fc.array(activityItemArb, ITEM_ARRAY),
});
export const rewardSetPayloadArb = fc.record({
	rewards: fc.array(rewardItemArb, ITEM_ARRAY),
});
export const checklistPayloadArb = fc.record({
	timing: fc.constantFrom(...CHECKLIST_TIMINGS),
	items: fc.array(checklistItemArb, ITEM_ARRAY),
});
export const rulePresetPayloadArb = fc.record({
	ruleType: fc.constantFrom(...RULE_TYPES),
	rules: fc.array(ruleItemArb, ITEM_ARRAY),
});
export const challengeSetPayloadArb = fc.record({
	challenges: fc.array(challengeItemArb, ITEM_ARRAY),
});

/** typeCode → payload arbitrary の SSOT map (property test が 5 type を横断反復する)。 */
export const PAYLOAD_ARBITRARIES: Record<MarketplaceTypeId, fc.Arbitrary<unknown>> = {
	'activity-pack': activityPackPayloadArb,
	'reward-set': rewardSetPayloadArb,
	checklist: checklistPayloadArb,
	'rule-preset': rulePresetPayloadArb,
	'challenge-set': challengeSetPayloadArb,
};
