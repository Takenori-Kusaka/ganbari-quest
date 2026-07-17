// tests/unit/architecture/schema-range-ssot.test.ts
// #3151 slice1/slice2/slice3/slice4 (ADR-0066): export/import 値域ドリフト根絶の fitness function。
//
// root class (#3104→#3132 の 2 サイクル連続 blocker): domain validation (Zod) と
// wire schema (Valibot) が別ファイル・別ライブラリで値域を二重定義し、
// 「アプリが許容する値域 ⊆ export/import が往復できる値域 (domain⊆wire)」という
// 不変条件がどこにも機械表明されていなかった。
//
// 本テストの表明:
//   (1) no-silent-gap: marketplace 全 type が「値域 SSOT 適用済 (COVERED)」か
//       「explicit TODO (RANGE_SSOT_TODO)」のいずれかに分類される。
//       新 type 追加時に本分類へ登録しなければ CI で fail する (silent skip 禁止、
//       admin-resource-model-registry の NON_CANONICAL 方式と同型)。slice4 (#3151) で
//       challenge-set / rule-preset を COVERED 化し RANGE_SSOT_TODO を空にした = 5 type 全 COVERED。
//   (2) 全 5 type (COVERED): domain Zod (createActivitySchema / grantSpecialRewardSchema /
//       checklistItemSchema / challengeSetItemSchema / rulePresetItemSchema) と wire Valibot
//       (ActivityPackItemSchema / RewardSetItemSchema / ChecklistItemSchema / ChallengeSetItemSchema /
//       RulePresetItemSchema) が値域 SSOT 定数
//       (`$lib/domain/validation/{activity,special-reward,checklist,challenge-set,rule-preset}.ts`)
//       の同一境界で受理/拒否する (boundary probe による behavior-level の同値表明)。実 validator を
//       oracle として呼ぶため、どちらか一方が SSOT 定数を離れて literal を直書き (再ドリフト) すると
//       必ず fail する (#3153 oracle 方式の拡張)。

import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { asChildId } from '$lib/domain/ids';
import {
	ACTIVITY_AGE_MAX,
	ACTIVITY_AGE_MIN,
	ACTIVITY_BASE_POINTS_MAX,
	ACTIVITY_BASE_POINTS_MIN,
	ACTIVITY_DESCRIPTION_MAX,
	ACTIVITY_ICON_MAX_GRAPHEMES,
	ACTIVITY_NAME_MAX,
	ACTIVITY_TRIGGER_HINT_MAX,
	createActivitySchema,
} from '$lib/domain/validation/activity';
import {
	CHALLENGE_BASE_TARGET_MAX,
	CHALLENGE_BASE_TARGET_MIN,
	CHALLENGE_DESCRIPTION_MAX,
	CHALLENGE_DURATION_DAYS_MAX,
	CHALLENGE_DURATION_DAYS_MIN,
	CHALLENGE_ICON_MAX_GRAPHEMES,
	CHALLENGE_REWARD_POINTS_MAX,
	CHALLENGE_REWARD_POINTS_MIN,
	CHALLENGE_TITLE_MAX,
	challengeSetItemSchema,
} from '$lib/domain/validation/challenge-set';
import {
	CHECKLIST_ICON_MAX_GRAPHEMES,
	CHECKLIST_LABEL_MAX,
	CHECKLIST_ORDER_MIN,
	checklistItemSchema,
} from '$lib/domain/validation/checklist';
import {
	RULE_DESCRIPTION_MAX,
	RULE_ICON_MAX_GRAPHEMES,
	RULE_POINT_MAX,
	RULE_POINT_MIN,
	RULE_TITLE_MAX,
	rulePresetItemSchema,
} from '$lib/domain/validation/rule-preset';
import {
	grantSpecialRewardSchema,
	REWARD_CATEGORIES,
	REWARD_DESCRIPTION_MAX,
	REWARD_ICON_MAX_GRAPHEMES,
	REWARD_POINTS_MAX,
	REWARD_POINTS_MIN,
	REWARD_TITLE_MAX,
} from '$lib/domain/validation/special-reward';
import { ActivityPackItemSchema } from '$lib/marketplace/schemas/activity-pack-schema';
import { ChallengeSetItemSchema } from '$lib/marketplace/schemas/challenge-set-schema';
import { ChecklistItemSchema } from '$lib/marketplace/schemas/checklist-schema';
import { RewardSetItemSchema } from '$lib/marketplace/schemas/reward-set-schema';
import { RulePresetItemSchema } from '$lib/marketplace/schemas/rule-preset-schema';
import { MARKETPLACE_TYPE_CODES, type MarketplaceTypeCode } from '$lib/marketplace/types';

// ── (1) no-silent-gap 分類 ──────────────────────────────────────────

/** 値域 SSOT (domain 定数を domain/wire 両 schema が参照) 適用済の type */
const COVERED_TYPES: readonly MarketplaceTypeCode[] = [
	'activity-pack',
	'reward-set',
	'checklist',
	'challenge-set',
	'rule-preset',
];

/**
 * 値域 SSOT 未適用の type (explicit TODO)。理由なしにこのリストへ追加してはならない
 * (新 type は原則 COVERED で作る)。#3151 slice4 で challenge-set / rule-preset を COVERED 化した
 * 結果、marketplace 5 type すべてが COVERED となり本リストは空になった (EPIC #3151 値域 SSOT 完成)。
 */
const RANGE_SSOT_TODO: Partial<Record<MarketplaceTypeCode, string>> = {};

// ── (2) boundary probe 用の valid base item ────────────────────────

/** domain (createActivitySchema) 用 valid base */
const domainItem = (over: Record<string, unknown> = {}) => ({
	name: 'からだをうごかす',
	categoryId: 1,
	icon: '🏃',
	basePoints: 10,
	ageMin: null,
	ageMax: null,
	...over,
});

/** wire (ActivityPackItemSchema) 用 valid base */
const wireItem = (over: Record<string, unknown> = {}) => ({
	name: 'からだをうごかす',
	categoryCode: 'undou',
	icon: '🏃',
	basePoints: 10,
	ageMin: null,
	ageMax: null,
	gradeLevel: null,
	...over,
});

const domainOk = (data: unknown) => createActivitySchema.safeParse(data).success;
const wireOk = (data: unknown) => v.safeParse(ActivityPackItemSchema, data).success;

/** domain / wire 両 schema が同一 field 値で受理/拒否一致することを表明する */
function expectBothSchemas(field: string, value: unknown, expected: boolean) {
	expect(domainOk(domainItem({ [field]: value })), `domain ${field}=${value}`).toBe(expected);
	expect(wireOk(wireItem({ [field]: value })), `wire ${field}=${value}`).toBe(expected);
}

// ── (2b) reward-set boundary probe 用の valid base item ─────────────
// 注: domain (grantSpecialRewardSchema) は icon が optional だが、export 経路 (/api/v1/
// special-rewards/export) は DB の null icon を '🎁' へ既定化してから wire schema へ渡すため、
// round-trip では icon は常に present。よって本 probe は「present な icon 値」の境界のみ検証し、
// activity exemplar と同様に「icon 省略」ケースは domain⊆wire の対象外とする。

/** domain (grantSpecialRewardSchema) 用 valid base */
const rewardDomainItem = (over: Record<string, unknown> = {}) => ({
	childId: asChildId(1),
	title: 'ゲームのじかん',
	points: 50,
	icon: '🎁',
	category: REWARD_CATEGORIES[0],
	...over,
});

/** wire (RewardSetItemSchema) 用 valid base */
const rewardWireItem = (over: Record<string, unknown> = {}) => ({
	title: 'ゲームのじかん',
	points: 50,
	icon: '🎁',
	category: REWARD_CATEGORIES[0],
	...over,
});

const rewardDomainOk = (data: unknown) => v.safeParse(grantSpecialRewardSchema, data).success;
const rewardWireOk = (data: unknown) => v.safeParse(RewardSetItemSchema, data).success;

/** reward の domain / wire 両 schema が同一 field 値で受理/拒否一致することを表明する */
function expectBothReward(field: string, value: unknown, expected: boolean) {
	expect(rewardDomainOk(rewardDomainItem({ [field]: value })), `domain ${field}=${value}`).toBe(
		expected,
	);
	expect(rewardWireOk(rewardWireItem({ [field]: value })), `wire ${field}=${value}`).toBe(expected);
}

// ── (2c) checklist boundary probe 用の valid base item ──────────────
// domain (checklistItemSchema) と wire (ChecklistItemSchema) は共に {label, icon, order} の同一
// shape のため base item を共有する。SSOT 化前は domain 側 validator が存在せず、admin authoring
// 経路 (addTemplateItem action) が label 長 / icon 長を無制限に受理していた (domain⊄wire)。
// checklistItemSchema 新設 + 両 schema を CHECKLIST_* 定数 / isValidChecklistIcon へ揃えたことで、
// 「authoring 可能な item ⊆ export/import 往復可能な item」が成立する。

const checklistItem = (over: Record<string, unknown> = {}) => ({
	label: 'はみがき',
	icon: '🦷',
	order: 0,
	...over,
});

const checklistDomainOk = (data: unknown) => checklistItemSchema.safeParse(data).success;
const checklistWireOk = (data: unknown) => v.safeParse(ChecklistItemSchema, data).success;

/** checklist の domain / wire 両 schema が同一 field 値で受理/拒否一致することを表明する */
function expectBothChecklist(field: string, value: unknown, expected: boolean) {
	expect(checklistDomainOk(checklistItem({ [field]: value })), `domain ${field}=${value}`).toBe(
		expected,
	);
	expect(checklistWireOk(checklistItem({ [field]: value })), `wire ${field}=${value}`).toBe(
		expected,
	);
}

// ── (2d) challenge-set boundary probe 用の valid base item ──────────
// domain (challengeSetItemSchema) と wire (ChallengeSetItemSchema) の共通 shape。base に categoryId
// を含めるのは wire 側 picklist が必須のため。domain schema は categoryId (意味的カテゴリ enum、
// 値域ではない) を対象外とし Zod default で無視する。SSOT 化前は domain 側 validator が存在せず、
// wire icon が maxLength(20) (UTF-16 units) で domain の grapheme 意図と非対称だった。

const challengeItem = (over: Record<string, unknown> = {}) => ({
	title: 'ひなまつりチャレンジ',
	description: 'ひな人形の飾りつけを家族でカウントアップ。',
	monthDay: '03-03',
	durationDays: 3,
	categoryId: 1,
	baseTarget: 3,
	rewardPoints: 30,
	icon: '🎎',
	...over,
});

const challengeDomainOk = (data: unknown) => challengeSetItemSchema.safeParse(data).success;
const challengeWireOk = (data: unknown) => v.safeParse(ChallengeSetItemSchema, data).success;

/** challenge の domain / wire 両 schema が同一 field 値で受理/拒否一致することを表明する */
function expectBothChallenge(field: string, value: unknown, expected: boolean) {
	expect(challengeDomainOk(challengeItem({ [field]: value })), `domain ${field}=${value}`).toBe(
		expected,
	);
	expect(challengeWireOk(challengeItem({ [field]: value })), `wire ${field}=${value}`).toBe(
		expected,
	);
}

// ── (2e) rule-preset boundary probe 用の valid base item ────────────
// domain (rulePresetItemSchema) と wire (RulePresetItemSchema) の共通 shape ({title, description,
// icon, pointCost?, pointBonus?})。ruleType は payload レベル (RulePresetPayloadSchema) の picklist の
// ため item probe の対象外。SSOT 化前は domain 側 validator が存在せず、wire icon が maxLength(20)
// (UTF-16 units) で domain の grapheme 意図と非対称だった。

const ruleItem = (over: Record<string, unknown> = {}) => ({
	title: 'ゲームじかんと交換',
	description: '30 pt でゲーム 30 分と交換できる。',
	icon: '🎮',
	...over,
});

const ruleDomainOk = (data: unknown) => rulePresetItemSchema.safeParse(data).success;
const ruleWireOk = (data: unknown) => v.safeParse(RulePresetItemSchema, data).success;

/** rule の domain / wire 両 schema が同一 field 値で受理/拒否一致することを表明する */
function expectBothRule(field: string, value: unknown, expected: boolean) {
	expect(ruleDomainOk(ruleItem({ [field]: value })), `domain ${field}=${value}`).toBe(expected);
	expect(ruleWireOk(ruleItem({ [field]: value })), `wire ${field}=${value}`).toBe(expected);
}

describe('#3151 値域 SSOT fitness (domain⊆wire、ADR-0066)', () => {
	describe('(1) no-silent-gap: 全 marketplace type が COVERED / TODO に分類済', () => {
		it('MARKETPLACE_TYPE_CODES の全 type が分類されている (未分類 = fail)', () => {
			for (const code of MARKETPLACE_TYPE_CODES) {
				const classified = COVERED_TYPES.includes(code) || code in RANGE_SSOT_TODO;
				expect(
					classified,
					`type "${code}" が値域 SSOT fitness の分類外です。新 type は値域定数を domain 層 SSOT に置き ` +
						'COVERED_TYPES に登録するか、暫定なら RANGE_SSOT_TODO に理由付きで pin してください (silent skip 禁止)',
				).toBe(true);
			}
		});
		it('COVERED と TODO の二重分類がない', () => {
			for (const code of COVERED_TYPES) {
				expect(code in RANGE_SSOT_TODO, `type "${code}" が COVERED と TODO に二重分類`).toBe(false);
			}
		});
	});

	describe('(2) activity-pack: domain と wire が SSOT 境界で一致 (boundary probe)', () => {
		it('basePoints: SSOT max 受理 / max+1 拒否 / min 受理 / min-1 拒否 が両 schema で一致', () => {
			// #3132 root class の regression lock: 旧 wire maxValue(10000) は domain max(100) の 100 倍ドリフトだった
			expectBothSchemas('basePoints', ACTIVITY_BASE_POINTS_MAX, true);
			expectBothSchemas('basePoints', ACTIVITY_BASE_POINTS_MAX + 1, false);
			expectBothSchemas('basePoints', ACTIVITY_BASE_POINTS_MIN, true);
			expectBothSchemas('basePoints', ACTIVITY_BASE_POINTS_MIN - 1, false);
		});

		it('ageMin/ageMax: SSOT max (20) 受理 / max+1 拒否 / min-1 拒否 が両 schema で一致', () => {
			// #3151 是正の regression lock: 旧 wire maxValue(18) は domain max(20) が許す行の往復を破っていた
			for (const field of ['ageMin', 'ageMax']) {
				expectBothSchemas(field, ACTIVITY_AGE_MAX, true);
				expectBothSchemas(field, ACTIVITY_AGE_MAX + 1, false);
				expectBothSchemas(field, ACTIVITY_AGE_MIN, true);
				expectBothSchemas(field, ACTIVITY_AGE_MIN - 1, false);
			}
		});

		it('name: SSOT max 文字 受理 / max+1 拒否 が両 schema で一致', () => {
			expectBothSchemas('name', 'あ'.repeat(ACTIVITY_NAME_MAX), true);
			expectBothSchemas('name', 'あ'.repeat(ACTIVITY_NAME_MAX + 1), false);
		});

		it('triggerHint: SSOT max 文字 受理 / max+1 拒否 が両 schema で一致', () => {
			// #3151 是正: 旧 wire maxLength(200) は domain max(30) との二重定義ドリフトだった
			expectBothSchemas('triggerHint', 'あ'.repeat(ACTIVITY_TRIGGER_HINT_MAX), true);
			expectBothSchemas('triggerHint', 'あ'.repeat(ACTIVITY_TRIGGER_HINT_MAX + 1), false);
		});

		it('description: SSOT max 文字 受理 / max+1 拒否 が両 schema で一致', () => {
			// #3151 是正: 旧 wire maxLength(500) は domain max(200) との二重定義ドリフトだった
			expectBothSchemas('description', 'あ'.repeat(ACTIVITY_DESCRIPTION_MAX), true);
			expectBothSchemas('description', 'あ'.repeat(ACTIVITY_DESCRIPTION_MAX + 1), false);
		});

		it('icon: ZWJ 連結絵文字 2 個 (2 grapheme / 22 UTF-16 units) 受理 / 3 grapheme 拒否 が両 schema で一致', () => {
			// #3151 是正: 旧 wire maxLength(20) (UTF-16 units) は domain の 2 grapheme 許容 (家族絵文字 2 個
			// = 22 units) を弾き domain⊆wire を破っていた。isValidActivityIcon 共有 oracle で表現方式ごと統一。
			const zwjFamily = '👨‍👩‍👧‍👦';
			expect(ACTIVITY_ICON_MAX_GRAPHEMES).toBe(2);
			expectBothSchemas('icon', zwjFamily.repeat(ACTIVITY_ICON_MAX_GRAPHEMES), true);
			expectBothSchemas('icon', zwjFamily.repeat(ACTIVITY_ICON_MAX_GRAPHEMES + 1), false);
			expectBothSchemas('icon', '', false);
		});
	});

	describe('(2b) reward-set: domain と wire が SSOT 境界で一致 (boundary probe)', () => {
		it('points: SSOT max (10000) 受理 / max+1 拒否 / min (1) 受理 / min-1 拒否 が両 schema で一致', () => {
			// #3132 root class の regression lock: domain (grantSpecialRewardSchema) と wire
			// (RewardSetItemSchema) の points 上限が乖離すると export→restore 往復が境界値で破綻する。
			expectBothReward('points', REWARD_POINTS_MAX, true);
			expectBothReward('points', REWARD_POINTS_MAX + 1, false);
			expectBothReward('points', REWARD_POINTS_MIN, true);
			expectBothReward('points', REWARD_POINTS_MIN - 1, false);
		});

		it('title: SSOT max 文字 受理 / max+1 拒否 が両 schema で一致', () => {
			expectBothReward('title', 'あ'.repeat(REWARD_TITLE_MAX), true);
			expectBothReward('title', 'あ'.repeat(REWARD_TITLE_MAX + 1), false);
		});

		it('description: SSOT max 文字 受理 / max+1 拒否 が両 schema で一致', () => {
			expectBothReward('description', 'あ'.repeat(REWARD_DESCRIPTION_MAX), true);
			expectBothReward('description', 'あ'.repeat(REWARD_DESCRIPTION_MAX + 1), false);
		});

		it('icon: ZWJ 連結絵文字 (1 grapheme / 11 UTF-16 units) 受理 / 3 grapheme 拒否 が両 schema で一致', () => {
			// #3151 slice2 是正の regression lock (failing-test-first): 旧 domain icon max(10)
			// (UTF-16 units) は ZWJ 家族絵文字 1 個 (11 units) を拒否し、wire maxLength(20) は受理して
			// いたため両者が非対称 (=SSOT 化前は domain=false / wire=true でこの assert が fail していた)。
			// isValidRewardIcon 共有 oracle への統一で domain / wire を同一境界へ揃える。
			const zwjFamily = '👨‍👩‍👧‍👦';
			expect(REWARD_ICON_MAX_GRAPHEMES).toBe(2);
			expectBothReward('icon', zwjFamily, true);
			expectBothReward('icon', '🎁🎈', true); // 2 grapheme (境界内)
			expectBothReward('icon', zwjFamily.repeat(REWARD_ICON_MAX_GRAPHEMES + 1), false); // 3 grapheme
			expectBothReward('icon', '', false);
		});
	});

	describe('(2c) checklist: domain と wire が SSOT 境界で一致 (boundary probe)', () => {
		it('label: SSOT max 文字 受理 / max+1 拒否 が両 schema で一致', () => {
			// #3151 slice3 是正の regression lock (failing-test-first): SSOT 化前は domain 側 validator が
			// 存在せず admin authoring 経路が 100 文字超の label を無制限に受理していた (domain⊄wire)。
			// export は wire schema を再検証するため往復不能データの authoring を許していた。
			expectBothChecklist('label', 'あ'.repeat(CHECKLIST_LABEL_MAX), true);
			expectBothChecklist('label', 'あ'.repeat(CHECKLIST_LABEL_MAX + 1), false);
			expectBothChecklist('label', '', false);
		});

		it('order: SSOT min (0) 受理 / min-1 拒否 / 非整数 拒否 が両 schema で一致', () => {
			expectBothChecklist('order', CHECKLIST_ORDER_MIN, true);
			expectBothChecklist('order', CHECKLIST_ORDER_MIN - 1, false);
			expectBothChecklist('order', 1.5, false);
		});

		it('icon: ZWJ 連結絵文字 2 個 (2 grapheme / 22 UTF-16 units) 受理 / 3 grapheme 拒否 が両 schema で一致', () => {
			// #3151 slice3 是正: 旧 wire maxLength(20) (UTF-16 units) は ZWJ 家族絵文字 2 個 (22 units) を
			// 弾き / 絵文字 3 個 (🎁🎈🎀 = 6 units) を受理していた。domain 側は無制限だったため両者が非対称。
			// isValidChecklistIcon 共有 oracle への統一で domain / wire を同一境界へ揃える (activity / reward と同型)。
			const zwjFamily = '👨‍👩‍👧‍👦';
			expect(CHECKLIST_ICON_MAX_GRAPHEMES).toBe(2);
			expectBothChecklist('icon', zwjFamily.repeat(CHECKLIST_ICON_MAX_GRAPHEMES), true); // 2 grapheme / 22 units
			expectBothChecklist('icon', '🎁🎈', true); // 2 grapheme (境界内)
			expectBothChecklist('icon', '🎁🎈🎀', false); // 3 grapheme (旧 wire は 6 units で受理していた)
			expectBothChecklist('icon', '', false);
		});
	});

	describe('(2d) challenge-set: domain と wire が SSOT 境界で一致 (boundary probe)', () => {
		it('title: SSOT max 文字 受理 / max+1 拒否 が両 schema で一致', () => {
			expectBothChallenge('title', 'あ'.repeat(CHALLENGE_TITLE_MAX), true);
			expectBothChallenge('title', 'あ'.repeat(CHALLENGE_TITLE_MAX + 1), false);
			expectBothChallenge('title', '', false);
		});

		it('description: SSOT max 文字 受理 / max+1 拒否 が両 schema で一致', () => {
			expectBothChallenge('description', 'あ'.repeat(CHALLENGE_DESCRIPTION_MAX), true);
			expectBothChallenge('description', 'あ'.repeat(CHALLENGE_DESCRIPTION_MAX + 1), false);
			expectBothChallenge('description', '', false);
		});

		it('durationDays: SSOT max (90) 受理 / max+1 拒否 / min (1) 受理 / min-1 拒否 が両 schema で一致', () => {
			expectBothChallenge('durationDays', CHALLENGE_DURATION_DAYS_MAX, true);
			expectBothChallenge('durationDays', CHALLENGE_DURATION_DAYS_MAX + 1, false);
			expectBothChallenge('durationDays', CHALLENGE_DURATION_DAYS_MIN, true);
			expectBothChallenge('durationDays', CHALLENGE_DURATION_DAYS_MIN - 1, false);
			expectBothChallenge('durationDays', 1.5, false);
		});

		it('baseTarget: SSOT max (1000) 受理 / max+1 拒否 / min (1) 受理 / min-1 拒否 が両 schema で一致', () => {
			expectBothChallenge('baseTarget', CHALLENGE_BASE_TARGET_MAX, true);
			expectBothChallenge('baseTarget', CHALLENGE_BASE_TARGET_MAX + 1, false);
			expectBothChallenge('baseTarget', CHALLENGE_BASE_TARGET_MIN, true);
			expectBothChallenge('baseTarget', CHALLENGE_BASE_TARGET_MIN - 1, false);
		});

		it('rewardPoints: SSOT max (10000) 受理 / max+1 拒否 / min (0) 受理 / min-1 拒否 が両 schema で一致', () => {
			expectBothChallenge('rewardPoints', CHALLENGE_REWARD_POINTS_MAX, true);
			expectBothChallenge('rewardPoints', CHALLENGE_REWARD_POINTS_MAX + 1, false);
			expectBothChallenge('rewardPoints', CHALLENGE_REWARD_POINTS_MIN, true);
			expectBothChallenge('rewardPoints', CHALLENGE_REWARD_POINTS_MIN - 1, false);
		});

		it('icon: ZWJ 連結絵文字 2 個 (2 grapheme / 22 UTF-16 units) 受理 / 3 grapheme 拒否 が両 schema で一致', () => {
			// #3151 slice4 是正 (failing-test-first): 旧 wire maxLength(20) (UTF-16 units) は ZWJ 家族
			// 絵文字 2 個 (22 units) を弾き / 絵文字 3 個 (🎁🎈🎀 = 6 units) を受理していた。SSOT 化前は
			// domain 側 validator が存在せず両者が非対称。isValidChallengeIcon 共有 oracle で統一。
			const zwjFamily = '👨‍👩‍👧‍👦';
			expect(CHALLENGE_ICON_MAX_GRAPHEMES).toBe(2);
			expectBothChallenge('icon', zwjFamily.repeat(CHALLENGE_ICON_MAX_GRAPHEMES), true); // 2 grapheme / 22 units
			expectBothChallenge('icon', '🎁🎈', true); // 2 grapheme (境界内)
			expectBothChallenge('icon', '🎁🎈🎀', false); // 3 grapheme (旧 wire は 6 units で受理していた)
			expectBothChallenge('icon', '', false);
		});
	});

	describe('(2e) rule-preset: domain と wire が SSOT 境界で一致 (boundary probe)', () => {
		it('title: SSOT max 文字 受理 / max+1 拒否 が両 schema で一致', () => {
			expectBothRule('title', 'あ'.repeat(RULE_TITLE_MAX), true);
			expectBothRule('title', 'あ'.repeat(RULE_TITLE_MAX + 1), false);
			expectBothRule('title', '', false);
		});

		it('description: SSOT max 文字 受理 / max+1 拒否 が両 schema で一致', () => {
			expectBothRule('description', 'あ'.repeat(RULE_DESCRIPTION_MAX), true);
			expectBothRule('description', 'あ'.repeat(RULE_DESCRIPTION_MAX + 1), false);
			expectBothRule('description', '', false);
		});

		it('pointCost: SSOT max (10000) 受理 / max+1 拒否 / min (0) 受理 / min-1 拒否 が両 schema で一致', () => {
			expectBothRule('pointCost', RULE_POINT_MAX, true);
			expectBothRule('pointCost', RULE_POINT_MAX + 1, false);
			expectBothRule('pointCost', RULE_POINT_MIN, true);
			expectBothRule('pointCost', RULE_POINT_MIN - 1, false);
		});

		it('pointBonus: SSOT max (10000) 受理 / max+1 拒否 / min (0) 受理 / min-1 拒否 が両 schema で一致', () => {
			expectBothRule('pointBonus', RULE_POINT_MAX, true);
			expectBothRule('pointBonus', RULE_POINT_MAX + 1, false);
			expectBothRule('pointBonus', RULE_POINT_MIN, true);
			expectBothRule('pointBonus', RULE_POINT_MIN - 1, false);
		});

		it('icon: ZWJ 連結絵文字 2 個 (2 grapheme / 22 UTF-16 units) 受理 / 3 grapheme 拒否 が両 schema で一致', () => {
			// #3151 slice4 是正 (failing-test-first): 旧 wire maxLength(20) (UTF-16 units) は ZWJ 家族
			// 絵文字 2 個 (22 units) を弾き / 絵文字 3 個 (6 units) を受理していた。isValidRuleIcon 共有 oracle で統一。
			const zwjFamily = '👨‍👩‍👧‍👦';
			expect(RULE_ICON_MAX_GRAPHEMES).toBe(2);
			expectBothRule('icon', zwjFamily.repeat(RULE_ICON_MAX_GRAPHEMES), true); // 2 grapheme / 22 units
			expectBothRule('icon', '🎁🎈', true); // 2 grapheme (境界内)
			expectBothRule('icon', '🎁🎈🎀', false); // 3 grapheme (旧 wire は 6 units で受理していた)
			expectBothRule('icon', '', false);
		});
	});
});
