/**
 * Marketplace item domain types.
 * The marketplace aggregates multiple content types
 * (activity packs, reward sets, checklists, rule presets)
 * into a unified browsable catalog.
 */

import { AGE_TIER_LABELS } from './labels.js';
import type { CategoryCode, GradeLevel } from './validation/activity.js';
import type { UiMode } from './validation/age-tier-types.js';
import type { RewardCategory } from './validation/special-reward.js';

// ── Content Type ─────────────────────────────────────────────

export type MarketplaceItemType = 'activity-pack' | 'reward-set' | 'checklist' | 'rule-preset';

// ── Persona Tags ─────────────────────────────────────────────

export const PERSONA_TAGS = [
	'dual-income',
	'grandparent',
	'many-lessons',
	'game-oriented',
	'sports-oriented',
	'academic-oriented',
	'creative-oriented',
	'first-child',
	'sibling',
	'outdoor',
	'indoor',
	'self-care',
	'routine-focused',
	'achievement-focused',
	'relaxed',
] as const;

export type PersonaTag = (typeof PERSONA_TAGS)[number];

export const PERSONA_LABELS: Record<PersonaTag, string> = {
	'dual-income': '共働き家庭',
	grandparent: '祖父母同居',
	'many-lessons': '習い事多い',
	'game-oriented': 'ゲーム中心',
	'sports-oriented': 'スポーツ志向',
	'academic-oriented': '文系志向',
	'creative-oriented': '創造志向',
	'first-child': '第一子',
	sibling: 'きょうだいあり',
	outdoor: 'アウトドア派',
	indoor: 'インドア派',
	'self-care': '自立サポート',
	'routine-focused': '習慣づくり',
	'achievement-focused': '達成志向',
	relaxed: 'のんびり型',
};

// ── Age Band ─────────────────────────────────────────────────
// #1171: age-tier.ts の UiMode (baby/preschool/elementary/junior/senior) と統一。
// ラベルは labels.ts の AGE_TIER_LABELS を SSOT として参照する。

export type AgeBand = UiMode;

export const AGE_BANDS: { id: AgeBand; label: string; min: number; max: number }[] = [
	{ id: 'baby', label: AGE_TIER_LABELS.baby, min: 0, max: 2 },
	{ id: 'preschool', label: AGE_TIER_LABELS.preschool, min: 3, max: 5 },
	{ id: 'elementary', label: AGE_TIER_LABELS.elementary, min: 6, max: 12 },
	{ id: 'junior', label: AGE_TIER_LABELS.junior, min: 13, max: 15 },
	{ id: 'senior', label: AGE_TIER_LABELS.senior, min: 16, max: 18 },
];

// ── Item-type-specific payloads ──────────────────────────────

export interface ActivityPackPayload {
	activities: {
		name: string;
		categoryCode: CategoryCode;
		icon: string;
		basePoints: number;
		ageMin: number | null;
		ageMax: number | null;
		gradeLevel: GradeLevel | null;
		triggerHint?: string;
		description?: string;
		/** #1758 (#1709-D): import 時に親が選べる「今日のおやくそく」推奨候補 */
		mustDefault?: boolean;
	}[];
}

export interface RewardSetPayload {
	rewards: {
		title: string;
		points: number;
		icon: string;
		category: RewardCategory;
		description?: string;
	}[];
}

export interface ChecklistPayload {
	timing: 'morning' | 'evening' | 'weekend' | 'daily' | 'weekly';
	items: {
		label: string;
		icon: string;
		order: number;
	}[];
}

export interface RulePresetPayload {
	ruleType: 'exchange' | 'bonus' | 'penalty' | 'special';
	rules: {
		title: string;
		description: string;
		icon: string;
		pointCost?: number;
		pointBonus?: number;
	}[];
}

// ── Payload type map ─────────────────────────────────────────

export interface MarketplacePayloadMap {
	'activity-pack': ActivityPackPayload;
	'reward-set': RewardSetPayload;
	checklist: ChecklistPayload;
	'rule-preset': RulePresetPayload;
}

// ── Unified MarketplaceItem ──────────────────────────────────

// ── Gender target (#1171) ────────────────────────────────────

export type MarketplaceGender = 'boy' | 'girl' | 'neutral';

export interface MarketplaceItem<T extends MarketplaceItemType = MarketplaceItemType> {
	type: T;
	itemId: string;
	name: string;
	description: string;
	icon: string;
	targetAgeMin: number;
	targetAgeMax: number;
	tags: string[];
	personas: PersonaTag[];
	/** #1171: ターゲット性別。未指定 / 'neutral' は性別不問として扱う。 */
	gender?: MarketplaceGender;
	curator: 'official' | string;
	payload: MarketplacePayloadMap[T];
}

// ── Index entry (no payload, for listing) ────────────────────

export interface MarketplaceItemMeta {
	type: MarketplaceItemType;
	itemId: string;
	name: string;
	description: string;
	icon: string;
	targetAgeMin: number;
	targetAgeMax: number;
	tags: string[];
	personas: PersonaTag[];
	gender: MarketplaceGender;
	curator: 'official' | string;
	itemCount: number;
}

// ── Type labels ──────────────────────────────────────────────

export const MARKETPLACE_TYPE_LABELS: Record<MarketplaceItemType, string> = {
	'activity-pack': 'かつどうパック',
	'reward-set': 'ごほうびセット',
	checklist: 'チェックリスト',
	'rule-preset': 'とくべつルール',
};

export const MARKETPLACE_TYPE_ICONS: Record<MarketplaceItemType, string> = {
	'activity-pack': '📦',
	'reward-set': '🎁',
	checklist: '✅',
	'rule-preset': '📜',
};
