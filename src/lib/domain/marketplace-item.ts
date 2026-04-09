/**
 * Marketplace item domain types.
 * The marketplace aggregates multiple content types
 * (activity packs, reward sets, checklists, rule presets)
 * into a unified browsable catalog.
 */

import type { CategoryCode, GradeLevel } from './validation/activity.js';
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

export type AgeBand = 'baby' | 'kinder' | 'elementary' | 'junior' | 'senior';

export const AGE_BANDS: { id: AgeBand; label: string; min: number; max: number }[] = [
	{ id: 'baby', label: '0〜2歳', min: 0, max: 2 },
	{ id: 'kinder', label: '3〜5歳', min: 3, max: 5 },
	{ id: 'elementary', label: '6〜9歳', min: 6, max: 9 },
	{ id: 'junior', label: '10〜12歳', min: 10, max: 12 },
	{ id: 'senior', label: '13〜18歳', min: 13, max: 18 },
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
