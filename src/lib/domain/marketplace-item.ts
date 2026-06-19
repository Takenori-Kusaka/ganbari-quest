/**
 * Marketplace item domain types.
 * The marketplace aggregates multiple content types
 * (activity packs, reward sets, checklists, rule presets)
 * into a unified browsable catalog.
 */

import { AGE_TIER_LABELS } from './labels.js';
import type { ShopCategory } from './shop-category.js';
import { CONCEPT_ICONS } from './terms.js';
import type { CategoryCode, GradeLevel } from './validation/activity.js';
import type { UiMode } from './validation/age-tier-types.js';
import type { RewardCategory } from './validation/special-reward.js';

// ── Content Type ─────────────────────────────────────────────

// #2297 (EPIC #2294 ③): challenge-set 追加 (4 type → 5 type)。
// 案 B-γ 日本ローカライズ wedge: 日本年間行事パック (15 件入り) 等を配信し
// マーケプレ → /admin/challenges import 経路を確立。
export type MarketplaceItemType =
	| 'activity-pack'
	| 'reward-set'
	| 'checklist'
	| 'rule-preset'
	| 'challenge-set';

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
		// #3147: ショップ陳列系統 (physical/money/privilege)。省略時は取込側で推定 fallback。
		// RewardCategory(6値) とは直交する軸 (登録カテゴリとショップ陳列の分離)。
		shopCategory?: ShopCategory;
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

// #2297 (EPIC #2294 ③): challenge-set payload
// 協力タイプ固定 (EPIC #2294 ② で競争タイプ UI 削除のため challenge-set でも cooperative 固定)。
// startDate / endDate は 'MM-DD' 形式 (毎年同月日に開催される年間行事の論理表現)。
// import 時は service 側で当該年の日付に展開する。
export interface ChallengeSetPayload {
	challenges: {
		title: string;
		description: string;
		/** 'MM-DD' (例: '03-03' = ひな祭り) */
		monthDay: string;
		/** 期間 (日数)。startDate = monthDay の N 日前。endDate = monthDay。 */
		durationDays: number;
		/** 1=undou 2=benkyou 3=seikatsu 4=kouryuu 5=souzou */
		categoryId: 1 | 2 | 3 | 4 | 5;
		baseTarget: number;
		rewardPoints: number;
		icon: string;
	}[];
}

// ── Payload type map ─────────────────────────────────────────

export interface MarketplacePayloadMap {
	'activity-pack': ActivityPackPayload;
	'reward-set': RewardSetPayload;
	checklist: ChecklistPayload;
	'rule-preset': RulePresetPayload;
	'challenge-set': ChallengeSetPayload;
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

// #2899: type label はページタイトル「みんなのテンプレート」と重複させず、兄弟 type
// (ごほうびセット / チェックリスト / とくべつルール / チャレンジ集) と同型の単独名詞に
// する。「みんなのテンプレート（活動）」(旧) は page title と重複し命名規則も不一致
// だったため「活動セット」(= 活動の束、ごほうびセットと同型) に是正した。
// 命名規則は DESIGN.md §6「marketplace type 命名規則」を参照。
export const MARKETPLACE_TYPE_LABELS: Record<MarketplaceItemType, string> = {
	'activity-pack': '活動セット',
	'reward-set': 'ごほうびセット',
	checklist: 'チェックリスト',
	'rule-preset': 'とくべつルール',
	'challenge-set': 'チャレンジ集',
};

// #2899: 概念アイコンは CONCEPT_ICONS atom (terms.ts) を SSOT とする。
// activity = 📝 (旧 📦 段ボールは活動概念に不適合のため是正。📋 は checklist 概念の
// 正規アイコン ICON_CHECKLIST と衝突するため不採用)、checklist = 📋 (ICON_CHECKLIST と
// 同値)、他 3 type は既存値を維持。値の根拠は CONCEPT_ICONS 定義コメントを参照。
export const MARKETPLACE_TYPE_ICONS: Record<MarketplaceItemType, string> = {
	'activity-pack': CONCEPT_ICONS.activity,
	'reward-set': CONCEPT_ICONS.reward,
	checklist: CONCEPT_ICONS.checklist,
	'rule-preset': CONCEPT_ICONS.rule,
	'challenge-set': CONCEPT_ICONS.challenge,
};
